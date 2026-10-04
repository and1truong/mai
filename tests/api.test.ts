import { Database } from "bun:sqlite";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { startServer } from "../src/server/index.ts";
import { chayMigration, moDb } from "../src/server/db.ts";
import { seed } from "../src/server/seed.ts";
import { taoServerTam } from "./helpers.ts";

// Mỗi describe một server + thư mục data tạm riêng → test độc lập, không phụ thứ tự.

type App = Awaited<ReturnType<typeof taoServerTam>>;

function post(app: App, path: string, body: unknown) {
  return fetch(`${app.url}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

// beforeAll của mỗi describe gán lại `app` → biến luôn trỏ server của describe đang chạy.
let app!: App;

function moApp(coSeed = true) {
  beforeAll(async () => {
    app = await taoServerTam();
    if (coSeed) seed(app.db);
  });
  afterAll(async () => {
    await app.dong();
  });
}

describe("envelope + validation", () => {
  moApp();

  test("thiếu trường bắt buộc → 400 VALIDATION theo envelope chuẩn", async () => {
    const res = await post(app, "/api/nguon", { noi_dung: "abc" });
    expect(res.status).toBe(400);
    const j = await res.json();
    expect(j.ok).toBe(false);
    expect(j.loi.ma).toBe("VALIDATION");
    expect(Array.isArray(j.loi.chi_tiet)).toBe(true);
    expect(j.loi.chi_tiet.join(" ")).toContain("tieu_de");
  });

  test("route lạ → 404 KHONG_TIM_THAY", async () => {
    const res = await fetch(`${app.url}/api/khong-co`);
    expect(res.status).toBe(404);
    expect((await res.json()).loi.ma).toBe("KHONG_TIM_THAY");
  });

  test("tham số URL méo → 400 envelope, không lộ stack", async () => {
    const res = await fetch(`${app.url}/api/ban-the-hien/%`);
    expect(res.status).toBe(400);
    const j = await res.json();
    expect(j.ok).toBe(false);
    expect(j.loi.ma).toBe("VALIDATION");
  });
});

describe("nguồn + persistence", () => {
  moApp();
  let idTao = "";

  test("tạo nguồn rồi liệt kê thấy lại", async () => {
    const res = await post(app, "/api/nguon", {
      tieu_de: "Nguồn test",
      noi_dung: "Nội dung test",
    });
    expect(res.status).toBe(201);
    const j = await res.json();
    expect(j.ok).toBe(true);
    expect(j.du_lieu.tao_boi).toBe("demo");
    idTao = j.du_lieu.id;

    const ds = await (await fetch(`${app.url}/api/nguon`)).json();
    expect(ds.du_lieu.some((n: { id: string }) => n.id === idTao)).toBe(true);
  });

  test("dữ liệu còn nguyên khi mở lại db (persistence)", async () => {
    const db2 = new Database(join(app.dataDir, "mai.sqlite"));
    const row = db2.query("SELECT COUNT(*) AS c FROM nguon WHERE id = ?").get(idTao) as {
      c: number;
    };
    expect(row.c).toBe(1);
    db2.close();
  });
});

describe("revision + xung đột", () => {
  moApp();

  test("dua_tren_revision_id sai → 409; đúng head → 201", async () => {
    const head = (
      await (await fetch(`${app.url}/api/ban-the-hien/seed-bth-1`)).json()
    ).du_lieu.head_revision_id;

    const sai = await post(app, "/api/ban-the-hien/seed-bth-1/revision", {
      noi_dung: "rev sai",
      dua_tren_revision_id: "khong-dung",
    });
    expect(sai.status).toBe(409);
    expect((await sai.json()).loi.ma).toBe("XUNG_DOT_REVISION");

    const dung = await post(app, "/api/ban-the-hien/seed-bth-1/revision", {
      noi_dung: "rev đúng",
      dua_tren_revision_id: head,
    });
    expect(dung.status).toBe(201);
    expect((await dung.json()).du_lieu.so_thu_tu).toBe(2);
  });
});

describe("trạng thái review", () => {
  moApp();

  test("chuyển sai → 409; chuyển đúng chuỗi → 200", async () => {
    const goi = (tt: string) =>
      post(app, "/api/ban-the-hien/seed-bth-1/trang-thai", { trang_thai: tt });

    const sai = await goi("da_duyet"); // nhap → da_duyet không hợp lệ
    expect(sai.status).toBe(409);
    expect((await sai.json()).loi.ma).toBe("XUNG_DOT_TRANG_THAI");

    const rac = await post(app, "/api/ban-the-hien/seed-bth-1/trang-thai", {
      trang_thai: "khong-co",
    });
    expect(rac.status).toBe(400);

    expect((await goi("cho_duyet")).status).toBe(200);
    expect((await goi("da_duyet")).status).toBe(200);
  });
});

describe("assets", () => {
  moApp();

  test("upload ảnh → GET noi-dung trả đúng byte", async () => {
    const res = await fetch(`${app.url}/api/assets?ten=anh.png`, {
      method: "POST",
      body: new Uint8Array([137, 80, 78, 71, 1, 2, 3]),
    });
    expect(res.status).toBe(201);
    const { du_lieu } = await res.json();
    expect(du_lieu.loai).toBe("hinh_anh");
    expect(du_lieu.kich_thuoc).toBe(7);

    const tai = await fetch(`${app.url}/api/assets/${du_lieu.id}/noi-dung`);
    expect(tai.status).toBe(200);
    expect(tai.headers.get("x-content-type-options")).toBe("nosniff");
    expect(new Uint8Array(await tai.arrayBuffer())).toEqual(
      new Uint8Array([137, 80, 78, 71, 1, 2, 3]),
    );
  });

  test("đuôi file lạ → 400; asset không có → 404", async () => {
    const res = await fetch(`${app.url}/api/assets?ten=doc.exe`, {
      method: "POST",
      body: "x",
    });
    expect(res.status).toBe(400);

    const miss = await fetch(`${app.url}/api/assets/khong-co/noi-dung`);
    expect(miss.status).toBe(404);
  });
});

describe("job nền trong process", () => {
  moApp();

  async function choJobXong(id: string): Promise<string> {
    for (let i = 0; i < 100; i++) {
      const ds = await (await fetch(`${app.url}/api/job`)).json();
      const j = ds.du_lieu.find((x: { id: string }) => x.id === id);
      if (j && j.trang_thai !== "cho" && j.trang_thai !== "dang_chay") return j.trang_thai;
      await Bun.sleep(30);
    }
    return "timeout";
  }

  test("job sinh_ban_the_hien chạy xong và tạo bản thể hiện", async () => {
    const res = await post(app, "/api/job", {
      loai: "sinh_ban_the_hien",
      payload: { thong_diep_id: "seed-td-1", dinh_dang: "newsletter" },
    });
    expect(res.status).toBe(201);
    const { du_lieu: job } = await res.json();
    expect(await choJobXong(job.id)).toBe("xong");

    const bth = await (
      await fetch(`${app.url}/api/ban-the-hien?nguon_id=seed-nguon-1`)
    ).json();
    const ban = bth.du_lieu.find((b: { dinh_dang: string }) => b.dinh_dang === "newsletter");
    expect(ban).toBeTruthy();
    expect(ban.head_revision_id).toBeTruthy();
  });

  test("job thiếu payload.thong_diep_id → 400 VALIDATION", async () => {
    const res = await post(app, "/api/job", { loai: "sinh_ban_the_hien", payload: {} });
    expect(res.status).toBe(400);
    expect((await res.json()).loi.ma).toBe("VALIDATION");
  });
});

describe("job mồ côi sau restart", () => {
  test("job 'dang_chay' được requeue và chạy lại khi runner khởi động", async () => {
    // Dựng data có sẵn một job mồ côi rồi mới start server.
    const dir = mkdtempSync(join(tmpdir(), "mai-orphan-"));
    const db0 = moDb(dir);
    chayMigration(db0);
    seed(db0);
    db0
      .query(
        `INSERT INTO job (id, loai, trang_thai, khoa_idem, entity_loai, entity_id, revision_id, payload, so_lan_thu, tao_luc)
         VALUES ('orphan-1', 'sinh_ban_the_hien', 'dang_chay', 'orphan-1', 'ban_the_hien', 'seed-bth-1', (SELECT head_revision_id FROM ban_the_hien WHERE id = 'seed-bth-1'), ?, 1, ?)`,
      )
      .run(
        JSON.stringify({ ban_the_hien_id: "seed-bth-1" }),
        new Date().toISOString(),
      );
    db0.close();

    const app2 = await startServer({ port: 0, dataDir: dir, chuKyJobMs: 10 });
    try {
      let trangThai = "";
      for (let i = 0; i < 100; i++) {
        const ds = await (await fetch(`${app2.url}/api/job`)).json();
        const j = ds.du_lieu.find((x: { id: string }) => x.id === "orphan-1");
        trangThai = j?.trang_thai ?? "";
        if (trangThai !== "cho" && trangThai !== "dang_chay") break;
        await Bun.sleep(30);
      }
      expect(trangThai).toBe("xong");
    } finally {
      await app2.dong();
    }
  });
});

describe("ràng buộc unique danh tính đầu ra", () => {
  moApp();

  test("tạo trùng bản thể hiện cùng (thông điệp, định dạng, ngôn ngữ, đối tượng, đích) → lỗi constraint", async () => {
    expect(() =>
      app.db
        .query(
          `INSERT INTO ban_the_hien
             (id, thong_diep_id, dinh_dang, ngon_ngu, phien_ban_dinh_dang, doi_tuong, dich_den, trang_thai, head_revision_id, tao_luc, tao_boi)
           VALUES ('trung', 'seed-td-1', 'bai-viet', 'vi', 1, 'chung', '', 'nhap', NULL, 'x', 'demo')`,
        )
        .run(),
    ).toThrow();
  });
});
