import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chayMigration, moDb } from "../src/server/db.ts";
import { seed } from "../src/server/seed.ts";
import { docNoiDung, layDinhDang } from "../src/modules/formats/index.ts";
import {
  deXuatDauRa,
  factThieu,
  ghepNoiDungThongBao,
  layKeHoach,
} from "../src/modules/luong/index.ts";
import { thieuChungCu } from "../src/modules/generation/context.ts";
import { layBanTheHien, layThongDiep } from "../src/modules/content/index.ts";
import { taoServerTam } from "./helpers.ts";

// Test story #7 — tiệm bánh: một intake thông báo → bundle đầu ra đa kênh
// đã chọn, fact đã xác nhận nhất quán trên mọi bản, hỏi ngày cụ thể khi
// intake chỉ nói ngày tương đối, ảnh đính kèm thật / không bịa, đăng tay
// ghi rõ trên manifest export.

const INTAKE = "Tuần sau thứ Bảy tiệm ra mắt bánh croissant hạt dẻ.";
const DONG_CHUAN =
  "thời gian 2026-10-10T08:00 (Asia/Ho_Chi_Minh) — giá 45.000đ — còn hàng trong ngày — đặt hàng https://tiembanh.example.com/dat-hang";
const CLAIM_CAM = /không gluten|gluten[ -]?free|dị ứng|dinh dưỡng|tốt cho sức khỏe|khan hiếm|cháy hàng|hết hàng/i;

type App = Awaited<ReturnType<typeof taoServerTam>>;

function moDbTam() {
  const dataDir = mkdtempSync(join(tmpdir(), "mai-test-"));
  const db = moDb(dataDir);
  chayMigration(db);
  return { db, dataDir };
}

function post(app: App, path: string, body: unknown, method = "POST") {
  return fetch(`${app.url}${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function getJson(app: App, path: string) {
  const r = await fetch(`${app.url}${path}`);
  return { status: r.status, json: await r.json() };
}

describe("Story #7 — tiệm bánh: seed và bundle đề xuất", () => {
  test("seed: kế hoạch đã chọn có 5 đầu ra đa kênh, fact nhất quán, không claim cấm", () => {
    const { db, dataDir } = moDbTam();
    seed(db, "demo", { dataDir });
    try {
      const kh = layKeHoach(db, "seed-kh-tiem-banh");
      expect(kh).toBeTruthy();
      expect(kh!.trang_thai).toBe("da_chon");
      expect(JSON.parse(kh!.fact).ngay_gio).toBe("2026-10-10T08:00");
      expect(JSON.parse(kh!.fact).mui_gio).toBe("Asia/Ho_Chi_Minh");
      // Fact đầy đủ → không còn ô nào thiếu.
      expect(factThieu(kh!)).toEqual([]);

      // Thông điệp ghép fact: dòng chuẩn đứng đầu, intake gốc giữ lại.
      const td = layThongDiep(db, "seed-td-tiem-banh")!;
      expect(td.noi_dung).toContain("## Sự thật đã xác nhận");
      expect(td.noi_dung).toContain(INTAKE);
      expect(td.noi_dung.split("\n")[0]).toBe(`${DONG_CHUAN} — Ghé tiệm hoặc đặt trước qua link đặt hàng.`);

      const dsBth = db
        .query("SELECT * FROM ban_the_hien WHERE thong_diep_id = 'seed-td-tiem-banh'")
        .all() as { id: string; dinh_dang: string; dich_den: string; trang_thai: string }[];
      // 5 đầu ra kế hoạch đã chọn + newsletter demo kênh sở hữu (#13).
      expect(dsBth.length).toBe(6);
      const theoDd = (dd: string) => dsBth.find((b) => b.dinh_dang === dd)!;
      expect(theoDd("bai-viet").trang_thai).toBe("da_duyet");
      expect(theoDd("caption").dich_den).toBe("instagram");
      expect(theoDd("script-ngan").dich_den).toBe("tiktok");
      expect(theoDd("google-business").dich_den).toBe("google-business");
      expect(theoDd("email-khach").dich_den).toBe("email");

      // Cùng ngày ra mắt, giá, CTA trên mọi bản — đọc nội dung canonical.
      for (const b of dsBth) {
        const rev = db
          .query("SELECT r.noi_dung FROM revision r JOIN ban_the_hien b ON b.head_revision_id = r.id WHERE b.id = ?")
          .get(b.id) as { noi_dung: string };
        const giaTri = docNoiDung(layDinhDang(b.dinh_dang)!, rev.noi_dung);
        const toanVan = Object.values(giaTri).flat().join("\n");
        expect(toanVan).toContain("2026-10-10T08:00");
        expect(toanVan).toContain("45.000đ");
        expect(toanVan.toLowerCase()).toContain("croissant");
        // Không claim không-căn-cứ: gluten/dị ứng/sức khỏe/khan hiếm/tồn kho.
        expect(CLAIM_CAM.test(toanVan)).toBe(false);
      }

      // Email có subject + preview + lịch gửi kèm múi giờ.
      const email = docNoiDung(
        layDinhDang("email-khach")!,
        (db
          .query("SELECT r.noi_dung FROM revision r JOIN ban_the_hien b ON b.head_revision_id = r.id WHERE b.id = 'seed-bth-tb-email'")
          .get() as { noi_dung: string }).noi_dung,
      );
      expect(email.tieu_de).toBeTruthy();
      expect(email.tom_tat).toBeTruthy();
      expect(String(email.lich_gui)).toContain("Asia/Ho_Chi_Minh");

      // Ảnh IG đính kèm thật; GBP cố ý không ảnh → ô yêu cầu/upload.
      const dsAssetIg = db
        .query("SELECT asset_id FROM ban_the_hien_asset WHERE ban_the_hien_id = 'seed-bth-tb-ig'")
        .all() as { asset_id: string }[];
      expect(dsAssetIg.length).toBe(1);
      const dsAssetGbp = db
        .query("SELECT asset_id FROM ban_the_hien_asset WHERE ban_the_hien_id = 'seed-bth-tb-gbp'")
        .all() as { asset_id: string }[];
      expect(dsAssetGbp.length).toBe(0);
    } finally {
      db.close();
    }
  });

  test("intake sự kiện → đề xuất bundle đa kênh ở nhóm Chung; intake thường giữ newsletter/caption", () => {
    const { db } = moDbTam();
    seed(db);
    try {
      const ds = deXuatDauRa(db, "vi", INTAKE);
      const chung = ds.filter((d) => d.doi_tuong_id === null);
      expect(chung.map((d) => `${d.dinh_dang}→${d.dich_den ?? ""}`)).toEqual([
        "bai-viet→",
        "caption→instagram",
        "script-ngan→tiktok",
        "google-business→google-business",
        "email-khach→email",
      ]);
      // Intake không phải sự kiện giữ mặc định cũ.
      const dsThuong = deXuatDauRa(db, "vi", "Bài viết chia sẻ kinh nghiệm viết blog.");
      const chungThuong = dsThuong.filter((d) => d.doi_tuong_id === null);
      expect(chungThuong.map((d) => d.dinh_dang)).toEqual(["newsletter", "caption"]);
    } finally {
      db.close();
    }
  });

  test("thieuChungCu: ngày tương đối mơ hồ bị hỏi ngày cụ thể", () => {
    expect(thieuChungCu(INTAKE)).toContain("ngay_gio_cu_the");
    // Giá kiểu Việt không bị nhầm là ngày cụ thể — vẫn hỏi ngày (review #7).
    expect(
      thieuChungCu("Tuần sau thứ Bảy tiệm ra mắt bánh croissant hạt dẻ giá 45.000đ."),
    ).toContain("ngay_gio_cu_the");
    expect(thieuChungCu("Cuối tuần này giảm giá 45.5đ.")).toContain("ngay_gio_cu_the");
    // Có ngày cụ thể thì hết hỏi.
    expect(thieuChungCu("Ra mắt bánh mới ngày 10/10/2026.")).not.toContain("ngay_gio_cu_the");
    expect(thieuChungCu("Thông báo bảo trì cuối tuần này ngày 05/10/2025.")).not.toContain(
      "ngay_gio_cu_the",
    );
    expect(thieuChungCu("Ra mắt ngày 1.2.2026.")).not.toContain("ngay_gio_cu_the");
    // Không liên quan ngày → không hỏi.
    expect(thieuChungCu("Bài viết chia sẻ kinh nghiệm.")).not.toContain("ngay_gio_cu_the");
  });

  test("ghepNoiDungThongBao: dòng chuẩn đứng đầu, fact rỗng giữ nguyên intake", () => {
    const noiDung = ghepNoiDungThongBao(INTAKE, { gia: "50k" }, "");
    expect(noiDung.split("\n")[0]).toBe("giá 50k");
    expect(noiDung).toContain("## Intake");
    expect(ghepNoiDungThongBao(INTAKE, {}, "")).toBe(INTAKE);
  });
});

describe("Story #7 — luồng API: hỏi ngày cụ thể, fact roundtrip, truy về nguồn", () => {
  test("POST intake mơ hồ → hỏi ngày + fact_thieu; PUT fact → hết hỏi, đề xuất bundle; sửa fact → revision mới + đầu ra đã cũ", async () => {
    const app = await taoServerTam();
    try {
      seed(app.db);

      // Intake chỉ nói "tuần sau thứ Bảy" — ngày tương đối mơ hồ.
      const r = await post(app, "/api/ke-hoach", { van_ban: INTAKE });
      expect(r.status).toBe(200);
      const ds = (await r.json()).du_lieu;
      expect(ds.cau_hoi.join(" ")).toContain("Ngày giờ cụ thể");
      expect(ds.fact_thieu).toContain("ngay_gio");
      expect(ds.fact_thieu).toContain("gia");
      const khId = ds.ke_hoach.id;

      // Đề xuất bundle sự kiện ngay từ intake.
      const chung = (ds.de_xuat as { doi_tuong_id: string | null; dinh_dang: string }[]).filter(
        (d) => d.doi_tuong_id === null,
      );
      expect(chung.length).toBe(5);

      // Xác nhận fact: ngày giờ cụ thể + múi giờ + giá.
      const put = await post(
        app,
        `/api/ke-hoach/${khId}`,
        {
          fact: {
            ngay_gio: "2026-10-10T08:00",
            mui_gio: "Asia/Ho_Chi_Minh",
            gia: "45.000đ",
            tinh_trang: "còn hàng trong ngày",
            link_dat_hang: "https://tiembanh.example.com/dat-hang",
          },
          cta: "Ghé tiệm hoặc đặt trước qua link đặt hàng.",
        },
        "PUT",
      );
      expect(put.status).toBe(200);
      const sau = (await put.json()).du_lieu;
      // Ngày cụ thể trong fact xóa câu hỏi ngày mơ hồ (vẫn còn câu khác).
      expect(sau.cau_hoi.join(" ")).not.toContain("Ngày giờ cụ thể");
      expect(sau.fact_thieu).toEqual([]);
      expect(JSON.parse(sau.ke_hoach.fact).mui_gio).toBe("Asia/Ho_Chi_Minh");

      // Thông điệp mang dòng chuẩn.
      const { json: tdJson } = await getJson(app, `/api/thong-diep/${sau.ke_hoach.thong_diep_id}`);
      expect(tdJson.du_lieu.noi_dung.split("\n")[0]).toContain("2026-10-10T08:00");
      expect(tdJson.du_lieu.noi_dung.split("\n")[0]).toContain("45.000đ");
      expect(tdJson.du_lieu.ke_hoach.fact.ngay_gio).toBe("2026-10-10T08:00");

      // PUT y hệt = no-op (review #7): cùng input không tạo revision mới,
      // không cờ đã cũ giả.
      const headTruoc = (
        await getJson(app, `/api/thong-diep/${sau.ke_hoach.thong_diep_id}`)
      ).json.du_lieu.head_revision_id;
      const putLap = await post(
        app,
        `/api/ke-hoach/${khId}`,
        {
          fact: {
            ngay_gio: "2026-10-10T08:00",
            mui_gio: "Asia/Ho_Chi_Minh",
            gia: "45.000đ",
            tinh_trang: "còn hàng trong ngày",
            link_dat_hang: "https://tiembanh.example.com/dat-hang",
          },
          cta: "Ghé tiệm hoặc đặt trước qua link đặt hàng.",
        },
        "PUT",
      );
      expect(putLap.status).toBe(200);
      const headSau = (
        await getJson(app, `/api/thong-diep/${sau.ke_hoach.thong_diep_id}`)
      ).json.du_lieu.head_revision_id;
      expect(headSau).toBe(headTruoc);

      // Chọn hai đầu ra → sinh → bản thể hiện gắn revision thông điệp hiện tại.
      const chon = [
        { doi_tuong_id: null, dinh_dang: "bai-viet", ngon_ngu: "vi" },
        { doi_tuong_id: null, dinh_dang: "email-khach", ngon_ngu: "vi", dich_den: "email" },
      ];
      const rChon = await post(app, `/api/ke-hoach/${khId}/chon`, { ds_chon: chon });
      expect(rChon.status).toBe(200);
      const dsBth = (await rChon.json()).du_lieu.ds_bth;
      await Bun.sleep(400);

      // Sửa fact (đổi giá) → revision thông điệp mới → các bản đã sinh cờ đã cũ.
      const revCu = (await getJson(app, `/api/thong-diep/${sau.ke_hoach.thong_diep_id}`)).json
        .du_lieu.head_revision_id;
      const put2 = await post(
        app,
        `/api/ke-hoach/${khId}`,
        { fact: { gia: "42.000đ" } },
        "PUT",
      );
      expect(put2.status).toBe(200);
      const { json: tdJson2 } = await getJson(app, `/api/thong-diep/${sau.ke_hoach.thong_diep_id}`);
      expect(tdJson2.du_lieu.head_revision_id).not.toBe(revCu);
      // fact PUT thay toàn bộ: chỉ còn giá mới.
      expect(tdJson2.du_lieu.noi_dung.split("\n")[0]).toContain("42.000đ");
      const dauRaCu = tdJson2.du_lieu.ds_dau_ra.find(
        (x: { id: string }) => x.id === dsBth[0].id,
      );
      expect(dauRaCu.la_cu).toBe(true);
    } finally {
      app.dong();
    }
  });

  test("GET thong-diep: ds_dau_ra có goi_y_asset + ds_asset; trang /p phục vụ; manifest đánh dấu đăng tay", async () => {
    const app = await taoServerTam();
    try {
      seed(app.db, "demo", { dataDir: app.dataDir });

      const { json } = await getJson(app, "/api/thong-diep/seed-td-tiem-banh");
      const d = json.du_lieu;
      expect(d.ke_hoach.fact.ngay_gio).toBe("2026-10-10T08:00");
      const theoId = (id: string) => d.ds_dau_ra.find((x: { id: string }) => x.id === id);
      expect(theoId("seed-bth-tb-ig").goi_y_asset).toBeTruthy();
      expect(theoId("seed-bth-tb-ig").ds_asset.length).toBe(1);
      expect(theoId("seed-bth-tb-ig").ds_asset[0].ten_file).toBe("croissant-hat-de.webp");
      expect(theoId("seed-bth-tb-gbp").goi_y_asset).toBeTruthy();
      expect(theoId("seed-bth-tb-gbp").ds_asset.length).toBe(0);
      expect(theoId("seed-bth-tb-web").url_trang).toBe("/p/seed-bth-tb-web");

      // Trang local phục vụ thông báo đã xuất; chưa xuất → 404.
      const trang = await fetch(`${app.url}/p/seed-bth-tb-web`);
      expect(trang.status).toBe(200);
      const html = await trang.text();
      expect(html).toContain("croissant hạt dẻ");
      expect(html).toContain("2026-10-10T08:00");
      expect((await fetch(`${app.url}/p/seed-bth-tb-email`)).status).toBe(404);

      // Manifest bundle: đầu ra có kênh đích ghi đăng tay; trang web thì không.
      const { json: xb } = await getJson(app, "/api/ban-the-hien/seed-bth-tb-ig/xuat-ban");
      const zip = await fetch(
        `${app.url}/api/ban-the-hien/seed-bth-tb-ig/xuat-ban/${xb.du_lieu[0].id}/tai-ve`,
      );
      expect(zip.status).toBe(200);
      const buf = new Uint8Array(await zip.arrayBuffer());
      // Giải nén manifest bằng unzip CLI — không thêm dependency đọc ZIP.
      const dir = mkdtempSync(join(tmpdir(), "mai-zip-"));
      const zipPath = join(dir, "b.zip");
      await Bun.write(zipPath, buf);
      const proc = Bun.spawnSync(["unzip", "-o", "-q", zipPath, "-d", dir]);
      expect(proc.exitCode).toBe(0);
      const manifest = JSON.parse(
        await Bun.file(join(dir, "manifest.json")).text(),
      ) as { dang_tay: boolean; dich_den: string; assets: { id: string; thieu: boolean; tep: string | null }[] };
      expect(manifest.dang_tay).toBe(true);
      expect(manifest.dich_den).toBe("instagram");
      expect(manifest.assets.length).toBe(1);
      expect(manifest.assets[0]!.tep).toContain("assets/");
    } finally {
      app.dong();
    }
  });
});
