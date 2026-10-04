import { Database } from "bun:sqlite";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { seed } from "../src/server/seed.ts";
import { taoServerTam } from "./helpers.ts";

// Harness smoke/integration: SQLite + thư mục data tạm, server thật, fetch thật.

let app: Awaited<ReturnType<typeof taoServerTam>>;

beforeAll(async () => {
  app = await taoServerTam();
  seed(app.db);
});

afterAll(async () => {
  await app.dong();
});

const post = (path: string, body: unknown) =>
  fetch(`${app.url}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

describe("envelope + validation", () => {
  test("thiếu trường bắt buộc → 400 VALIDATION theo envelope chuẩn", async () => {
    const res = await post("/api/nguon", { noi_dung: "abc" });
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
    const j = await res.json();
    expect(j.loi.ma).toBe("KHONG_TIM_THAY");
  });
});

describe("mutation + đọc + persistence", () => {
  test("tạo nguồn rồi liệt kê thấy lại", async () => {
    const res = await post("/api/nguon", { tieu_de: "Nguồn test", noi_dung: "Nội dung test" });
    expect(res.status).toBe(201);
    const j = await res.json();
    expect(j.ok).toBe(true);
    expect(j.du_lieu.tao_boi).toBe("demo");

    const ds = await (await fetch(`${app.url}/api/nguon`)).json();
    expect(ds.du_lieu.some((n: { id: string }) => n.id === j.du_lieu.id)).toBe(true);
  });

  test("dữ liệu còn nguyên khi mở lại db (persistence)", async () => {
    const db2 = new Database(join(app.dataDir, "mai.sqlite"));
    const c = (db2.query("SELECT COUNT(*) AS c FROM nguon").get() as { c: number }).c;
    expect(c).toBeGreaterThanOrEqual(2); // seed + nguồn vừa tạo
    db2.close();
  });

  test("context: PUT rồi GET thấy giá trị mới", async () => {
    const res = await fetch(`${app.url}/api/context`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ten: "Test", doi_tuong: "qa", giong_noi: "ngắn", gia_tri: "x" }),
    });
    expect(res.status).toBe(200);
    const j = await (await fetch(`${app.url}/api/context`)).json();
    expect(j.du_lieu.ten).toBe("Test");
  });
});

describe("revision + xung đột", () => {
  test("dua_tren_revision_id sai → 409 XUNG_DOT_REVISION", async () => {
    const res = await post("/api/ban-the-hien/seed-bth-1/revision", {
      noi_dung: "rev sai",
      dua_tren_revision_id: "khong-dung",
    });
    expect(res.status).toBe(409);
    const j = await res.json();
    expect(j.loi.ma).toBe("XUNG_DOT_REVISION");
  });

  test("dua_tren_revision_id đúng head → 201, so_thu_tu tăng", async () => {
    const res = await post("/api/ban-the-hien/seed-bth-1/revision", {
      noi_dung: "rev đúng",
      dua_tren_revision_id: "seed-rev-1",
    });
    expect(res.status).toBe(201);
    const j = await res.json();
    expect(j.du_lieu.so_thu_tu).toBe(2);
  });
});

describe("job nền trong process", () => {
  test("job sinh_ban_the_hien chạy xong và tạo bản thể hiện", async () => {
    const res = await post("/api/job", {
      loai: "sinh_ban_the_hien",
      payload: { nguon_id: "seed-nguon-1", dinh_dang: "newsletter" },
    });
    expect(res.status).toBe(201);
    const { du_lieu: job } = await res.json();

    let trangThai = "";
    for (let i = 0; i < 100; i++) {
      const ds = await (await fetch(`${app.url}/api/job`)).json();
      const j = ds.du_lieu.find((x: { id: string }) => x.id === job.id);
      trangThai = j.trang_thai;
      if (trangThai !== "cho" && trangThai !== "dang_chay") break;
      await Bun.sleep(30);
    }
    expect(trangThai).toBe("xong");

    const bth = await (
      await fetch(`${app.url}/api/ban-the-hien?nguon_id=seed-nguon-1`)
    ).json();
    const ban = bth.du_lieu.find((b: { dinh_dang: string }) => b.dinh_dang === "newsletter");
    expect(ban).toBeTruthy();
    expect(ban.head_revision_id).toBeTruthy();
  });

  test("job thiếu payload.nguon_id → 400 VALIDATION", async () => {
    const res = await post("/api/job", { loai: "sinh_ban_the_hien", payload: {} });
    expect(res.status).toBe(400);
    expect((await res.json()).loi.ma).toBe("VALIDATION");
  });
});
