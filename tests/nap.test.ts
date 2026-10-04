import { Database } from "bun:sqlite";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chayMigration, moDb } from "../src/server/db.ts";
import { startServer } from "../src/server/index.ts";
import { seed } from "../src/server/seed.ts";
import { chuanHoaCacMuc, taoKhoByteMem, luuAsset } from "../src/modules/nap/index.ts";
import { taoServerTam } from "./helpers.ts";

// Test nạp nguồn + asset (#17): ingest text, upload file, idempotency,
// đính kèm tường minh, snapshot xuất bản, xóa/lưu trữ an toàn.

type App = Awaited<ReturnType<typeof taoServerTam>>;

function post(app: App, path: string, body: unknown) {
  return fetch(`${app.url}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function put(app: App, path: string, body: unknown) {
  return fetch(`${app.url}${path}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function upload(app: App, query: string, body: string | Uint8Array<ArrayBuffer>) {
  return fetch(`${app.url}/api/assets?${query}`, { method: "POST", body });
}

describe("chuanHoaCacMuc", () => {
  test("tách theo heading, id slug ổn định, giữ phần mở đầu", () => {
    const ds = chuanHoaCacMuc(
      ["Lời mở đầu.", "", "# Bối cảnh", "Nội dung bối cảnh.", "## Chi tiết kỹ thuật", "Sâu hơn."].join(
        "\n",
      ),
    );
    expect(ds.map((m) => m.id)).toEqual(["mo-dau", "s-boi-canh", "s-chi-tiet-ky-thuat"]);
    expect(ds[0]!.noi_dung).toBe("Lời mở đầu.");
    expect(ds[1]!.tieu_de).toBe("Bối cảnh");
    expect(ds[1]!.noi_dung).toBe("Nội dung bối cảnh.");
    expect(ds.every((m) => m.loai === "section")).toBe(true);
  });

  test("heading trùng tên nhận hậu tố; không heading → một mục noi-dung", () => {
    const trung = chuanHoaCacMuc("# Tin\nA\n# Tin\nB");
    expect(trung.map((m) => m.id)).toEqual(["s-tin", "s-tin-2"]);

    const phang = chuanHoaCacMuc("Chỉ một đoạn văn bản.");
    expect(phang).toEqual([
      { id: "noi-dung", loai: "section", tieu_de: undefined, noi_dung: "Chỉ một đoạn văn bản.", assets: [] },
    ]);

    expect(chuanHoaCacMuc("")).toEqual([]);
  });
});

describe("luuAsset (service + kho mem)", () => {
  let db: Database;
  const kho = taoKhoByteMem();

  beforeAll(() => {
    const dir = mkdtempSync(join(tmpdir(), "mai-nap-"));
    db = moDb(dir);
    chayMigration(db);
    seed(db);
  });
  afterAll(() => db.close());

  test("ghi → dedupe checksum → khoa_idem", async () => {
    const byte = new Uint8Array([1, 2, 3, 4]);
    const lan1 = await luuAsset(db, kho, { tenFile: "a.png", byte }, "demo");
    expect(lan1.da_tao).toBe(true);
    expect(kho.tonTai(lan1.asset.duong_dan)).toBe(true);
    expect(lan1.asset.checksum.length).toBe(64);
    expect(lan1.asset.ten_file).toBe("a.png");

    const lan2 = await luuAsset(db, kho, { tenFile: "ten-khac.png", byte }, "demo");
    expect(lan2.da_tao).toBe(false);
    expect(lan2.asset.id).toBe(lan1.asset.id);

    const lan3 = await luuAsset(
      db,
      kho,
      { tenFile: "b.png", byte: new Uint8Array([9, 9]), khoaIdem: "up-1" },
      "demo",
    );
    const lan4 = await luuAsset(
      db,
      kho,
      { tenFile: "c.png", byte: new Uint8Array([8, 8, 8]), khoaIdem: "up-1" },
      "demo",
    );
    expect(lan4.da_tao).toBe(false);
    expect(lan4.asset.id).toBe(lan3.asset.id);
  });

  test("tên file độc không thành đường dẫn; file văn bản non-UTF8 bị chặn", async () => {
    const { asset } = await luuAsset(
      db,
      kho,
      { tenFile: "../../etc/passwd.png", byte: new Uint8Array([1]) },
      "demo",
    );
    // tên gốc được làm sạch để hiển thị; đường dẫn lưu là uuid.ext do server đặt
    expect(asset.duong_dan).toMatch(/^[0-9a-f-]+\.png$/);
    expect(asset.duong_dan).not.toContain("..");

    await expect(
      luuAsset(db, kho, { tenFile: "x.md", byte: new Uint8Array([0xff, 0xfe, 0x00]) }, "demo"),
    ).rejects.toMatchObject({ ma: "VALIDATION" });
  });
});

describe("API nạp nguồn + asset", () => {
  let app!: App;
  beforeAll(async () => {
    app = await taoServerTam();
    seed(app.db);
  });
  afterAll(async () => {
    await app.dong();
  });

  test("POST /api/nguon/nhap tạo nguồn với cac_muc chuẩn hóa; retry cùng khoa_idem không trùng", async () => {
    const noiDung = "# Phần một\nNội dung 1\n# Phần hai\nNội dung 2";
    const res = await post(app, "/api/nguon/nhap", {
      tieu_de: "Bài nạp",
      noi_dung: noiDung,
      khoa_idem: "nap-1",
    });
    expect(res.status).toBe(201);
    const { du_lieu } = await res.json();
    expect(du_lieu.nguon.cac_muc.map((m: { id: string }) => m.id)).toEqual([
      "s-phan-mot",
      "s-phan-hai",
    ]);
    expect(du_lieu.nguon.noi_dung).toBe(noiDung); // bản gốc giữ nguyên

    const lai = await post(app, "/api/nguon/nhap", {
      tieu_de: "Bài nạp",
      noi_dung: noiDung,
      khoa_idem: "nap-1",
    });
    expect(lai.status).toBe(200);
    const j2 = await lai.json();
    expect(j2.du_lieu.nguon.id).toBe(du_lieu.nguon.id);
    expect(j2.du_lieu.revision.id).toBe(du_lieu.revision.id);
  });

  test("POST /api/nguon/:id/nhap tạo revision mới; retry không trùng; đổi text → revision mới", async () => {
    const tao = await post(app, "/api/nguon/nhap", {
      tieu_de: "Nguồn sửa",
      noi_dung: "v1",
      khoa_idem: "nap-up-0",
    });
    const { du_lieu: t } = await tao.json();
    const nguonId = t.nguon.id;

    const up = await post(app, `/api/nguon/${nguonId}/nhap`, {
      noi_dung: "# Mới\nv2",
      khoa_idem: "nap-up-1",
    });
    expect(up.status).toBe(201);
    const upJ = await up.json();
    expect(upJ.du_lieu.revision.so_thu_tu).toBe(2);
    expect(upJ.du_lieu.revision.cac_muc[0].id).toBe("s-moi");

    // Retry cùng khoa_idem → cùng revision 2, không tạo revision 3.
    const lai = await post(app, `/api/nguon/${nguonId}/nhap`, {
      noi_dung: "# Mới\nv2",
      khoa_idem: "nap-up-1",
    });
    expect((await lai.json()).du_lieu.revision.id).toBe(upJ.du_lieu.revision.id);

    // Cùng nội dung head, không khóa → không tạo revision mới.
    const gionh = await post(app, `/api/nguon/${nguonId}/nhap`, { noi_dung: "# Mới\nv2" });
    expect(gionh.status).toBe(200);
    expect((await gionh.json()).du_lieu.revision.so_thu_tu).toBe(2);

    // Revision cũ vẫn resolve được (provenance giữ nguyên).
    const rev1 = await (await fetch(`${app.url}/api/nguon-revision/${t.revision.id}`)).json();
    expect(rev1.du_lieu.noi_dung).toBe("v1");
  });

  test("upload .md tạo asset + nguồn liên kết; upload lại cùng byte → dedupe", async () => {
    const md = "# Chương một\nText chương một.";
    const res = await upload(app, "ten=tai-lieu.md", md);
    expect(res.status).toBe(201);
    const { du_lieu } = await res.json();
    expect(du_lieu.loai).toBe("van_ban");
    expect(du_lieu.nguon_id).toBeTruthy();
    expect(du_lieu.nguon.cac_muc[0].id).toBe("s-chuong-mot");

    const lai = await upload(app, "ten=tai-lieu.md", md);
    expect(lai.status).toBe(200);
    expect((await lai.json()).du_lieu.id).toBe(du_lieu.id);

    const trangThai = await fetch(`${app.url}/api/assets/${du_lieu.id}/noi-dung`);
    expect(trangThai.headers.get("content-type")).toContain("text/plain");
    expect(await trangThai.text()).toBe(md);
  });

  test("upload .md lên nguồn có sẵn → revision mới + asset gắn nguồn đó", async () => {
    const res = await upload(app, "ten=ghi-chu.txt&nguon_id=seed-nguon-1", "# Ghi chú\nnội dung");
    expect(res.status).toBe(201);
    const { du_lieu } = await res.json();
    expect(du_lieu.nguon_id).toBe("seed-nguon-1");
    expect(du_lieu.revision.so_thu_tu).toBe(2);
  });

  test("upload file text lỗi không để lại nguồn/revision", async () => {
    const truoc = await (await fetch(`${app.url}/api/nguon`)).json();
    const soTruoc = truoc.du_lieu.length;

    // rỗng → 400; quá 2MB → 413; non-UTF8 → 400 (không phải 500)
    expect((await upload(app, "ten=rong.txt", "")).status).toBe(400);
    const lon = new Uint8Array(2 * 1024 * 1024 + 1).fill(97);
    expect((await upload(app, "ten=lon.txt", lon)).status).toBe(413);
    expect((await upload(app, "ten=rac.txt", new Uint8Array([0xff, 0xfe, 0x00]))).status).toBe(400);

    const sau = await (await fetch(`${app.url}/api/nguon`)).json();
    expect(sau.du_lieu.length).toBe(soTruoc);
  });

  test("re-upload cùng file text không khóa → không tạo nguồn trùng", async () => {
    const md = "# Trùng\nnội dung trùng";
    const lan1 = await upload(app, "ten=trung.md", md);
    const { du_lieu: a1 } = await lan1.json();
    const lan2 = await upload(app, "ten=trung-2.md", md); // tên khác, cùng byte
    const { du_lieu: a2 } = await lan2.json();
    expect(lan2.status).toBe(200);
    expect(a2.id).toBe(a1.id);
    expect(a2.nguon.id).toBe(a1.nguon.id); // cùng nguồn đã gắn lần đầu
  });

  test("GET /api/assets mặc định ẩn asset lưu trữ; ?trang_thai=tat_ca hiện lại", async () => {
    const up = await upload(app, "ten=sau-nay-luu-tru.png", new Uint8Array([3, 3, 3]));
    const { du_lieu: asset } = await up.json();
    await post(app, `/api/assets/${asset.id}/luu-tru`, {});

    const macDinh = await (await fetch(`${app.url}/api/assets`)).json();
    expect(macDinh.du_lieu.map((a: { id: string }) => a.id)).not.toContain(asset.id);
    const tatCa = await (await fetch(`${app.url}/api/assets?trang_thai=tat_ca`)).json();
    expect(tatCa.du_lieu.map((a: { id: string }) => a.id)).toContain(asset.id);
  });

  test("dua_tren_revision_id cũ + nội dung giống head → 409 XUNG_DOT_REVISION", async () => {
    const tao = await post(app, "/api/nguon/nhap", { tieu_de: "A", noi_dung: "v1" });
    const { du_lieu: t } = await tao.json();
    const nguonId = t.nguon.id;
    const rev1 = t.revision.id;
    const up = await post(app, `/api/nguon/${nguonId}/nhap`, { noi_dung: "v2" });
    expect(up.status).toBe(201);

    // base = rev1 cũ nhưng nội dung trùng head → vẫn phải 409, không no-op 200.
    const cu = await post(app, `/api/nguon/${nguonId}/nhap`, {
      noi_dung: "v2",
      dua_tren_revision_id: rev1,
    });
    expect(cu.status).toBe(409);
    expect((await cu.json()).loi.ma).toBe("XUNG_DOT_REVISION");
  });

  test("đính kèm tường minh → xuất bản snapshot asset_ids; xóa asset được tham chiếu → 409", async () => {
    const up = await upload(app, "ten=san-pham.png", new Uint8Array([5, 5, 5]));
    const { du_lieu: asset } = await up.json();

    const gan = await put(app, "/api/ban-the-hien/seed-bth-1/assets", {
      asset_ids: [asset.id],
    });
    expect(gan.status).toBe(200);
    expect((await gan.json()).du_lieu[0].id).toBe(asset.id);

    const chiTiet = await (await fetch(`${app.url}/api/ban-the-hien/seed-bth-1`)).json();
    expect(chiTiet.du_lieu.assets.map((a: { id: string }) => a.id)).toEqual([asset.id]);

    const xb = await post(app, "/api/ban-the-hien/seed-bth-1/xuat-ban", {});
    expect(xb.status).toBe(201);
    expect((await xb.json()).du_lieu.asset_ids).toEqual([asset.id]);

    const xoa = await fetch(`${app.url}/api/assets/${asset.id}`, { method: "DELETE" });
    expect(xoa.status).toBe(409);
    expect((await xoa.json()).loi.ma).toBe("XUNG_DOT_TRANG_THAI");

    // Lưu trữ vẫn được → không mất provenance; không gắn vào đầu ra khác được.
    const luu = await post(app, `/api/assets/${asset.id}/luu-tru`, {});
    expect(luu.status).toBe(200);
    expect((await luu.json()).du_lieu.trang_thai).toBe("luu_tru");

    const ganLai = await put(app, "/api/ban-the-hien/seed-bth-1/assets", {
      asset_ids: [asset.id],
    });
    expect(ganLai.status).toBe(400);
  });

  test("asset nằm trong snapshot xuất bản → gỡ đính kèm vẫn không xóa được", async () => {
    const up = await upload(app, "ten=snap.png", new Uint8Array([6, 6]));
    const { du_lieu: asset } = await up.json();
    await put(app, "/api/ban-the-hien/seed-bth-1/assets", { asset_ids: [asset.id] });
    const xb = await post(app, "/api/ban-the-hien/seed-bth-1/xuat-ban", {});
    expect((await xb.json()).du_lieu.asset_ids).toEqual([asset.id]);

    // Gỡ khỏi đính kèm → vẫn còn tham chiếu trong record xuất bản → 409.
    await put(app, "/api/ban-the-hien/seed-bth-1/assets", { asset_ids: [] });
    const xoa = await fetch(`${app.url}/api/assets/${asset.id}`, { method: "DELETE" });
    expect(xoa.status).toBe(409);
  });

  test("xóa asset không được tham chiếu → file biến mất", async () => {
    const up = await upload(app, "ten=rac.png", new Uint8Array([7]));
    const { du_lieu: asset } = await up.json();
    const tep = join(app.dataDir, "assets", asset.duong_dan);
    expect(existsSync(tep)).toBe(true);

    const xoa = await fetch(`${app.url}/api/assets/${asset.id}`, { method: "DELETE" });
    expect(xoa.status).toBe(200);
    expect(existsSync(tep)).toBe(false);
  });

  test("restart giữ nguyên dữ liệu nạp (persistence)", async () => {
    const up = await upload(app, "ten=ben.txt", "giữ nguyên sau restart");
    const { du_lieu: asset } = await up.json();
    const db2 = new Database(join(app.dataDir, "mai.sqlite"));
    const row = db2.query("SELECT ten_file, nguon_id FROM asset WHERE id = ?").get(asset.id) as {
      ten_file: string;
      nguon_id: string;
    } | null;
    expect(row?.ten_file).toBe("ben.txt");
    expect(row?.nguon_id).toBeTruthy();
    db2.close();
  });
});
