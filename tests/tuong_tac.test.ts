import { expect, test } from "bun:test";
import { taoServerTam } from "./helpers.ts";
import { seed } from "../src/server/seed.ts";

// Ticket #61: ingestion sự kiện theo person (idempotent + provenance
// bắt buộc), timeline, và bridge visitor cookie từ trang public.

async function postSuKien(url: string, body: unknown) {
  const r = await fetch(`${url}/api/khach/su-kien`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: r.status, body: await r.json() };
}

test("ingestion: tạo person + event, delivery lặp cùng khóa không nhân", async () => {
  const app = await taoServerTam();
  const gui = {
    dinh_danh: { loai: "email", gia_tri: "khach@x.vn", nguon: "crm" },
    loai: "mua",
    nguon: "shopify",
    khoa_idem: "don-1",
    chi_tiet: { don_hang: "DH-1" },
  };
  const lan1 = await postSuKien(app.url, gui);
  expect(lan1.status).toBe(201);
  expect(lan1.body.du_lieu.da_tao_khach).toBe(true);
  expect(lan1.body.du_lieu.da_tao_su_kien).toBe(true);
  expect(lan1.body.du_lieu.su_kien.loai).toBe("mua");
  const lan2 = await postSuKien(app.url, gui);
  expect(lan2.status).toBe(200);
  expect(lan2.body.du_lieu.da_tao_su_kien).toBe(false);
  expect(lan2.body.du_lieu.su_kien.id).toBe(lan1.body.du_lieu.su_kien.id);
  await app.dong();
});

test("validation: thiếu nguon/khoa_idem/identity, loai sai, ref không tồn tại", async () => {
  const app = await taoServerTam();
  const thieu = await postSuKien(app.url, {
    dinh_danh: { loai: "email", gia_tri: "a@x.vn" },
    loai: "xem",
  });
  expect(thieu.status).toBe(400);
  expect(thieu.body.loi.chi_tiet.join(" ")).toContain("nguon");
  expect(thieu.body.loi.chi_tiet.join(" ")).toContain("khoa_idem");
  const saiLoai = await postSuKien(app.url, {
    dinh_danh: { loai: "email", gia_tri: "a@x.vn" },
    loai: "doc_bao",
    nguon: "web",
    khoa_idem: "k1",
  });
  expect(saiLoai.status).toBe(400);
  const saiRef = await postSuKien(app.url, {
    dinh_danh: { loai: "email", gia_tri: "a@x.vn" },
    loai: "xem",
    nguon: "web",
    khoa_idem: "k2",
    ban_the_hien_id: "bth-ao",
  });
  expect(saiRef.status).toBe(400);
  const khongPerson = await postSuKien(app.url, {
    loai: "xem",
    nguon: "web",
    khoa_idem: "k3",
  });
  expect(khongPerson.status).toBe(400);
  await app.dong();
});

test("khach_id trực tiếp: person phải tồn tại; timeline đúng thứ tự + lọc", async () => {
  const app = await taoServerTam();
  const tao = await (
    await fetch(`${app.url}/api/khach`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ten: "A" }),
    })
  ).json();
  const id = tao.du_lieu.id;
  const vong = await postSuKien(app.url, {
    khach_id: "kh-ao",
    loai: "xem",
    nguon: "web",
    khoa_idem: "k-ao",
  });
  expect(vong.status).toBe(404);
  // Ghi 3 event rải thời gian, thứ tự timeline tăng dần.
  await postSuKien(app.url, {
    khach_id: id,
    loai: "click",
    nguon: "web",
    khoa_idem: "e2",
    xay_ra_luc: "2026-01-02T00:00:00Z",
  });
  await postSuKien(app.url, {
    khach_id: id,
    loai: "xem",
    nguon: "web",
    khoa_idem: "e1",
    xay_ra_luc: "2026-01-01T00:00:00Z",
  });
  await postSuKien(app.url, {
    khach_id: id,
    loai: "mua",
    nguon: "crm",
    khoa_idem: "e3",
    xay_ra_luc: "2026-01-03T00:00:00Z",
  });
  const tl = await (
    await fetch(`${app.url}/api/khach/${id}/timeline`)
  ).json();
  expect(tl.du_lieu.tong).toBe(3);
  expect(tl.du_lieu.ds_su_kien.map((s: { loai: string }) => s.loai)).toEqual([
    "xem",
    "click",
    "mua",
  ]);
  // Lọc loai + khung thời gian.
  const loc = await (
    await fetch(
      `${app.url}/api/khach/${id}/timeline?loai=click&tu=2026-01-02&den=2026-01-02T23:59:59Z`,
    )
  ).json();
  expect(loc.du_lieu.tong).toBe(1);
  expect(loc.du_lieu.ds_su_kien[0].loai).toBe("click");
  await app.dong();
});

test("visitor cookie: /p/ đặt mai_v, person + event xem trên timeline", async () => {
  const app = await taoServerTam();
  seed(app.db);
  const r1 = await fetch(`${app.url}/p/seed-bth-tb-web`, {
    headers: { "user-agent": "UA-test-1" },
  });
  expect(r1.status).toBe(200);
  const cookie = r1.headers.get("set-cookie") ?? "";
  expect(cookie).toContain("mai_v=");
  const visitorId = /mai_v=([a-z0-9-]+)/.exec(cookie)![1];
  // Request thứ hai mang cookie → cùng person, event thứ hai cùng khung
  // bị khử trùng cả hai tầng (fingerprint 30' + khóa vt 30').
  const r2 = await fetch(`${app.url}/p/seed-bth-tb-web`, {
    headers: { "user-agent": "UA-test-1", cookie: `mai_v=${visitorId}` },
  });
  expect(r2.status).toBe(200);
  // Tra person qua identity visitor (không đoán theo thứ tự list — seed
  // #64 có person với lan_cuoi_thay mới hơn đứng trước).
  const row = app.db
    .query("SELECT khach_id FROM dinh_danh WHERE loai = 'visitor' AND gia_tri_chuan = ?")
    .get(visitorId) as { khach_id: string } | null;
  expect(row).toBeTruthy();
  const khach = { id: row!.khach_id };
  const dd = await (
    await fetch(`${app.url}/api/khach/${khach.id}/dinh-danh`)
  ).json();
  expect(dd.du_lieu.some((d: { loai: string; gia_tri_chuan: string }) =>
    d.loai === "visitor" && d.gia_tri_chuan === visitorId
  )).toBe(true);
  const tl = await (
    await fetch(`${app.url}/api/khach/${khach.id}/timeline`)
  ).json();
  expect(tl.du_lieu.tong).toBe(1);
  expect(tl.du_lieu.ds_su_kien[0].loai).toBe("xem");
  expect(tl.du_lieu.ds_su_kien[0].ban_the_hien_id).toBe("seed-bth-tb-web");
  await app.dong();
});

test("visitor trên /l/: click link ghi event click + mint cookie", async () => {
  const app = await taoServerTam();
  // Tạo link_dich trực tiếp trong db để có token.
  app.db
    .query(
      "INSERT INTO link_dich (id, token, url_dich, thong_diep_id, ban_the_hien_id, nhan, tao_luc, tao_boi) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .run("lk-test", "tok123456", "https://example.com", "", "seed-bth-tb-web", "", "2026-01-01", "test");
  const r = await fetch(`${app.url}/l/tok123456`, {
    headers: { "user-agent": "UA-test-2" },
    redirect: "manual",
  });
  expect(r.status).toBe(302);
  const cookie = r.headers.get("set-cookie") ?? "";
  expect(cookie).toContain("mai_v=");
  const visitorId = /mai_v=([a-z0-9-]+)/.exec(cookie)![1]!;
  const sk = app.db
    .query("SELECT * FROM tuong_tac WHERE loai = 'click' AND link_dich_id = 'lk-test'")
    .get() as { khach_id: string } | null;
  expect(sk).toBeTruthy();
  const dd = app.db
    .query("SELECT gia_tri_chuan FROM dinh_danh WHERE khach_id = ? AND loai = 'visitor'")
    .get(sk!.khach_id) as { gia_tri_chuan: string };
  expect(dd.gia_tri_chuan).toBe(visitorId);
  await app.dong();
});
