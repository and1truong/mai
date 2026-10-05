// Test ticket #63: conversion + attribution — first-touch bất biến,
// last-touch theo dữ liệu thật, unattributed vẫn giữ, model lưu cùng kết quả.
import { expect, test } from "bun:test";
import { taoServerTam } from "./helpers.ts";
import { seed } from "../src/server/seed.ts";

async function api(url: string, path: string, init?: RequestInit) {
  const res = await fetch(`${url}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  return { status: res.status, body: await res.json() };
}

function post(url: string, path: string, body: Record<string, unknown>) {
  return api(url, path, { method: "POST", body: JSON.stringify(body) });
}

async function taoKhach(url: string, email: string): Promise<string> {
  const res = await post(url, "/api/khach", {
    dinh_danh: [{ loai: "email", gia_tri: email, nguon: "test" }],
  });
  return res.body.du_lieu.khach.id;
}

test("#63 ghi conversion: validation + idempotent + quy_ve hai model", async () => {
  const app = await taoServerTam();
  seed(app.db);
  // Thiếu nguon/khoa_idem, loai sai.
  const loi1 = await post(app.url, "/api/khach/chuyen-doi", { loai: "khong_co" });
  expect(loi1.status).toBe(400);
  expect(loi1.body.loi.chi_tiet.join(" ")).toContain("loai");
  // tien_te lẻ khi không gia_tri; gia_tri âm; mã tiền sai format.
  const loiTt = await post(app.url, "/api/khach/chuyen-doi", { loai: "mua", nguon: "shopify", khoa_idem: "a", tien_te: "USD" });
  expect(loiTt.status).toBe(400);
  expect(loiTt.body.loi.chi_tiet.join(" ")).toContain("tien_te");
  const loiGt = await post(app.url, "/api/khach/chuyen-doi", { loai: "mua", nguon: "s", khoa_idem: "a", gia_tri: -5, tien_te: "USD" });
  expect(loiGt.status).toBe(400);
  const loiMa = await post(app.url, "/api/khach/chuyen-doi", { loai: "mua", nguon: "s", khoa_idem: "a", gia_tri: 5, tien_te: "usd$" });
  expect(loiMa.status).toBe(400);

  // Unattributed (không person, không ref) → vẫn 201, hai quy_ve khong_chac.
  const cv0 = await post(app.url, "/api/khach/chuyen-doi", {
    loai: "mua", nguon: "shopify", khoa_idem: "ord-0", gia_tri: 10, tien_te: "usd",
  });
  expect(cv0.status).toBe(201);
  expect(cv0.body.du_lieu.chuyen_doi.khach_id).toBeNull();
  expect(cv0.body.du_lieu.chuyen_doi.tien_te).toBe("USD");
  expect(cv0.body.du_lieu.quy_ve.map((q: { do_tin: string }) => q.do_tin))
    .toEqual(["khong_chac", "khong_chac"]);

  // Person + một touch event trước → first_touch + last_touch từ event đó.
  const khachId = await taoKhach(app.url, "cd@x.com");
  await post(app.url, "/api/khach/su-kien", {
    dinh_danh: { loai: "email", gia_tri: "cd@x.com" },
    loai: "click", nguon: "web", khoa_idem: "t1",
    ban_the_hien_id: "seed-bth-tb-web", xay_ra_luc: "2026-01-01T00:00:00Z",
  });
  const cv = await post(app.url, "/api/khach/chuyen-doi", {
    dinh_danh: { loai: "email", gia_tri: "cd@x.com" },
    loai: "mua", nguon: "shopify", khoa_idem: "ord-1",
    gia_tri: 100, tien_te: "USD", xay_ra_luc: "2026-01-02T00:00:00Z",
  });
  expect(cv.status).toBe(201);
  expect(cv.body.du_lieu.chuyen_doi.khach_id).toBe(khachId);
  const qv = cv.body.du_lieu.quy_ve as { mo_hinh: string; loai_dich: string; dich_id: string; do_tin: string }[];
  expect(qv.length).toBe(2);
  expect(qv[0]).toMatchObject({ mo_hinh: "first_touch", loai_dich: "ban_the_hien", dich_id: "seed-bth-tb-web", do_tin: "chac" });
  expect(qv[1]).toMatchObject({ mo_hinh: "last_touch", loai_dich: "ban_the_hien", dich_id: "seed-bth-tb-web", do_tin: "chac" });

  // Replay cùng khoa_idem → 200, không nhân đôi.
  const rep = await post(app.url, "/api/khach/chuyen-doi", {
    loai: "mua", nguon: "shopify", khoa_idem: "ord-1", gia_tri: 100, tien_te: "USD",
  });
  expect(rep.status).toBe(200);
  expect(rep.body.du_lieu.chuyen_doi.id).toBe(cv.body.du_lieu.chuyen_doi.id);
  const ds = await api(app.url, "/api/chuyen-doi");
  expect(ds.body.du_lieu.tong).toBe(2);
  const chuaGan = await api(app.url, "/api/chuyen-doi?chua_gan=1");
  expect(chuaGan.body.du_lieu.tong).toBe(1);
  await app.dong();
});

test("#63 first_touch bất biến; last_touch theo event gần nhất", async () => {
  const app = await taoServerTam();
  seed(app.db);
  await taoKhach(app.url, "ft@x.com");
  app.db
    .query("INSERT INTO link_dich (id, token, url_dich, thong_diep_id, ban_the_hien_id, nhan, tao_luc, tao_boi) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .run("lk-cd", "tokcd123", "https://example.com", "", "seed-bth-tb-web", "", "2026-01-01", "test");
  await post(app.url, "/api/khach/su-kien", {
    dinh_danh: { loai: "email", gia_tri: "ft@x.com" },
    loai: "click", nguon: "web", khoa_idem: "ft-1",
    link_dich_id: "lk-cd", xay_ra_luc: "2026-01-01T00:00:00Z",
  });
  await post(app.url, "/api/khach/su-kien", {
    dinh_danh: { loai: "email", gia_tri: "ft@x.com" },
    loai: "click", nguon: "web", khoa_idem: "ft-2",
    ban_the_hien_id: "seed-bth-tb-web", xay_ra_luc: "2026-01-02T00:00:00Z",
  });
  const cv = await post(app.url, "/api/khach/chuyen-doi", {
    dinh_danh: { loai: "email", gia_tri: "ft@x.com" },
    loai: "mua", nguon: "shopify", khoa_idem: "ord-ft",
    gia_tri: 50, tien_te: "VND", xay_ra_luc: "2026-01-03T00:00:00Z",
  });
  expect(cv.status).toBe(201);
  const qv = cv.body.du_lieu.quy_ve as { mo_hinh: string; loai_dich: string; dich_id: string }[];
  // first_touch = touch đầu tiên (link_dich); last_touch = event gần nhất (ban_the_hien).
  expect(qv[0]).toMatchObject({ mo_hinh: "first_touch", loai_dich: "link_dich", dich_id: "lk-cd" });
  expect(qv[1]).toMatchObject({ mo_hinh: "last_touch", loai_dich: "ban_the_hien", dich_id: "seed-bth-tb-web" });

  // Conversion thứ hai sau một touch mới — first_touch vẫn giữ touch đầu.
  await post(app.url, "/api/khach/su-kien", {
    dinh_danh: { loai: "email", gia_tri: "ft@x.com" },
    loai: "click", nguon: "web", khoa_idem: "ft-3",
    campaign_id: "seed-cp-so-002", xay_ra_luc: "2026-01-04T00:00:00Z",
  });
  const cv2 = await post(app.url, "/api/khach/chuyen-doi", {
    dinh_danh: { loai: "email", gia_tri: "ft@x.com" },
    loai: "mua", nguon: "shopify", khoa_idem: "ord-ft2",
    xay_ra_luc: "2026-01-05T00:00:00Z",
  });
  const qv2 = cv2.body.du_lieu.quy_ve as { mo_hinh: string; loai_dich: string; dich_id: string }[];
  expect(qv2[0]).toMatchObject({ mo_hinh: "first_touch", loai_dich: "link_dich", dich_id: "lk-cd" });
  expect(qv2[1]).toMatchObject({ mo_hinh: "last_touch", loai_dich: "campaign", dich_id: "seed-cp-so-002" });
  await app.dong();
});

test("#63 last_touch ưu tiên ref trên conversion; event không ref → nguon/khong_chac", async () => {
  const app = await taoServerTam();
  seed(app.db);
  await taoKhach(app.url, "lt@x.com");
  await post(app.url, "/api/khach/su-kien", {
    dinh_danh: { loai: "email", gia_tri: "lt@x.com" },
    loai: "xem", nguon: "web", khoa_idem: "lt-1",
  });
  const cv = await post(app.url, "/api/khach/chuyen-doi", {
    dinh_danh: { loai: "email", gia_tri: "lt@x.com" },
    loai: "mua", nguon: "shopify", khoa_idem: "ord-lt",
    xay_ra_luc: "2099-01-01T00:00:00Z",
  });
  const qv = cv.body.du_lieu.quy_ve as { mo_hinh: string; loai_dich: string; dich_id: string; do_tin: string }[];
  // Không touch có ref → first_touch khong_ro; last_touch rơi về nguon event.
  expect(qv[0]).toMatchObject({ mo_hinh: "first_touch", loai_dich: "khong_ro", do_tin: "khong_chac" });
  expect(qv[1]).toMatchObject({ mo_hinh: "last_touch", loai_dich: "nguon", dich_id: "web", do_tin: "khong_chac" });

  // Conversion tự mang campaign → chac, không cần event.
  const cv2 = await post(app.url, "/api/khach/chuyen-doi", {
    dinh_danh: { loai: "email", gia_tri: "lt@x.com" },
    loai: "mua", nguon: "shopify", khoa_idem: "ord-lt2",
    campaign_id: "seed-cp-so-002", xay_ra_luc: "2099-02-01T00:00:00Z",
  });
  expect(cv2.body.du_lieu.quy_ve[1]).toMatchObject({
    mo_hinh: "last_touch", loai_dich: "campaign", dich_id: "seed-cp-so-002", do_tin: "chac",
  });
  await app.dong();
});

test("#63 refs phantom → 400; GET quy-ve của person", async () => {
  const app = await taoServerTam();
  seed(app.db);
  const cv = await post(app.url, "/api/khach/chuyen-doi", {
    loai: "mua", nguon: "s", khoa_idem: "k", ban_the_hien_id: "bth-khong-co",
  });
  expect(cv.status).toBe(400);
  expect(cv.body.loi.chi_tiet.join(" ")).toContain("ban_the_hien_id");
  const cvK = await post(app.url, "/api/khach/chuyen-doi", {
    loai: "mua", nguon: "s", khoa_idem: "k2", khach_id: "k-gia",
  });
  expect(cvK.status).toBe(400);

  const khachId = await taoKhach(app.url, "qv@x.com");
  await post(app.url, "/api/khach/chuyen-doi", {
    dinh_danh: { loai: "email", gia_tri: "qv@x.com" },
    loai: "mua", nguon: "shopify", khoa_idem: "ord-qv", gia_tri: 7, tien_te: "VND",
  });
  const res = await api(app.url, `/api/khach/${khachId}/quy-ve`);
  expect(res.status).toBe(200);
  expect(res.body.du_lieu.ds.length).toBe(1);
  expect(res.body.du_lieu.ds[0].chuyen_doi.loai).toBe("mua");
  expect(res.body.du_lieu.ds[0].quy_ve.length).toBe(2);
  const nf = await api(app.url, "/api/khach/khong-co/quy-ve");
  expect(nf.status).toBe(404);
  await app.dong();
});
