// Test ticket #69: GET /api/khach/:id/hanh-trinh — projection của tuong_tac,
// boundary xay_ra_luc <= conversion, dấu first/last_touch theo quy_ve.
import { describe, expect, test } from "bun:test";
import { taoServerTam } from "./helpers.ts";
import { seed } from "../src/server/seed.ts";

async function api(url: string, path: string, init?: RequestInit) {
  const res = await fetch(`${url}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  return { status: res.status, body: (await res.json()) as Record<string, any> };
}

function post(url: string, path: string, body: Record<string, unknown>) {
  return api(url, path, { method: "POST", body: JSON.stringify(body) });
}

async function suKien(
  url: string,
  khachId: string,
  e: { loai: string; nguon: string; khoa: string; luc?: string } & Record<string, unknown>,
) {
  const r = await post(url, "/api/khach/su-kien", {
    khach_id: khachId,
    loai: e.loai,
    nguon: e.nguon,
    khoa_idem: e.khoa,
    xay_ra_luc: e.luc,
    campaign_id: e.campaign_id,
    link_dich_id: e.link_dich_id,
    ban_the_hien_id: e.ban_the_hien_id,
    giao_hang_id: e.giao_hang_id,
  });
  expect(r.status).toBe(201);
  return r.body.du_lieu.su_kien.id as string;
}

async function chuyenDoi(
  url: string,
  khachId: string,
  d: { khoa: string; luc?: string } & Record<string, unknown>,
) {
  const r = await post(url, "/api/khach/chuyen-doi", {
    khach_id: khachId,
    loai: "mua",
    nguon: "shopify",
    khoa_idem: d.khoa,
    xay_ra_luc: d.luc,
    gia_tri: 10,
    tien_te: "USD",
    campaign_id: d.campaign_id,
  });
  expect(r.status).toBe(201);
  return r.body.du_lieu;
}

describe("hành trình tới conversion (#69)", () => {
  test("journey cross-channel + dấu first/last_touch theo quy_ve", async () => {
    const app = await taoServerTam();
    seed(app.db);
    app.db
      .query("INSERT INTO link_dich (id, token, url_dich, thong_diep_id, ban_the_hien_id, nhan, tao_luc, tao_boi) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run("lk-jt", "tokjt123", "https://example.com", "", "seed-bth-tb-web", "", "2026-01-01", "test");
    const k = (
      await post(app.url, "/api/khach", {
        dinh_danh: [{ loai: "email", gia_tri: "jt1@x.com" }],
      })
    ).body.du_lieu.id as string;

    // Cross-channel: web xem → link click → email mo → email click_mail.
    await suKien(app.url, k, {
      loai: "xem", nguon: "web", khoa: "j1",
      luc: "2026-02-01T00:00:00Z", ban_the_hien_id: "seed-bth-tb-web",
    });
    await suKien(app.url, k, {
      loai: "click", nguon: "web", khoa: "j2",
      luc: "2026-02-02T00:00:00Z", link_dich_id: "lk-jt",
    });
    await suKien(app.url, k, {
      loai: "mo", nguon: "email", khoa: "j3",
      luc: "2026-02-03T00:00:00Z",
    });
    await suKien(app.url, k, {
      loai: "click_mail", nguon: "email", khoa: "j4",
      luc: "2026-02-04T00:00:00Z", campaign_id: "seed-cp-so-002",
    });
    // Event SAU conversion không lọt vào journey.
    await suKien(app.url, k, {
      loai: "xem", nguon: "web", khoa: "j-sau",
      luc: "2026-02-10T00:00:00Z",
    });
    const cv = await chuyenDoi(app.url, k, { khoa: "cv-1", luc: "2026-02-05T00:00:00Z" });

    const r = await api(
      app.url,
      `/api/khach/${k}/hanh-trinh?chuyen_doi_id=${cv.chuyen_doi.id}`,
    );
    expect(r.status).toBe(200);
    const dl = r.body.du_lieu;
    expect(dl.chuyen_doi.id).toBe(cv.chuyen_doi.id);
    expect(dl.hanh_trinh.map((s: { loai: string }) => s.loai)).toEqual([
      "xem", "click", "mo", "click_mail",
    ]);
    // Mỗi bước kèm nguon + refs/provenance.
    expect(dl.hanh_trinh[2]).toMatchObject({ nguon: "email" });
    expect(dl.hanh_trinh[3]).toMatchObject({ nguon: "email", campaign_id: "seed-cp-so-002" });
    // first_touch = touch đầu có ref (bth); last_touch = gần nhất (campaign).
    const ft = dl.hanh_trinh.filter((s: { la_first_touch: boolean }) => s.la_first_touch);
    const lt = dl.hanh_trinh.filter((s: { la_last_touch: boolean }) => s.la_last_touch);
    expect(ft.length).toBe(1);
    expect(ft[0].ban_the_hien_id).toBe("seed-bth-tb-web");
    expect(lt.length).toBe(1);
    expect(lt[0].campaign_id).toBe("seed-cp-so-002");
    await app.dong();
  });

  test("nhiều conversion → journey tách theo boundary từng conversion", async () => {
    const app = await taoServerTam();
    const k = (
      await post(app.url, "/api/khach", {
        dinh_danh: [{ loai: "email", gia_tri: "jt2@x.com" }],
      })
    ).body.du_lieu.id as string;

    await suKien(app.url, k, {
      loai: "xem", nguon: "web", khoa: "m1", luc: "2026-03-01T00:00:00Z",
    });
    const cv1 = await chuyenDoi(app.url, k, { khoa: "cv-a", luc: "2026-03-02T00:00:00Z" });
    await suKien(app.url, k, {
      loai: "xem", nguon: "web", khoa: "m2", luc: "2026-03-03T00:00:00Z",
    });
    const cv2 = await chuyenDoi(app.url, k, { khoa: "cv-b", luc: "2026-03-04T00:00:00Z" });

    const j1 = await api(app.url, `/api/khach/${k}/hanh-trinh?chuyen_doi_id=${cv1.chuyen_doi.id}`);
    expect(j1.body.du_lieu.hanh_trinh.length).toBe(1);
    const j2 = await api(app.url, `/api/khach/${k}/hanh-trinh?chuyen_doi_id=${cv2.chuyen_doi.id}`);
    expect(j2.body.du_lieu.hanh_trinh.length).toBe(2);
    // Thiếu chuyen_doi_id → conversion MỚI NHẤT (lựa chọn đã ghi).
    const jMac = await api(app.url, `/api/khach/${k}/hanh-trinh`);
    expect(jMac.body.du_lieu.chuyen_doi.id).toBe(cv2.chuyen_doi.id);
    await app.dong();
  });

  test("edge: chưa conversion → 400; conversion người khác/không có → 404; cùng giây → ổn định", async () => {
    const app = await taoServerTam();
    const k1 = (
      await post(app.url, "/api/khach", {
        dinh_danh: [{ loai: "email", gia_tri: "jt3@x.com" }],
      })
    ).body.du_lieu.id as string;
    const k2 = (
      await post(app.url, "/api/khach", {
        dinh_danh: [{ loai: "email", gia_tri: "jt4@x.com" }],
      })
    ).body.du_lieu.id as string;

    // Chưa có conversion nào → 400 (đã chọn 400, ghi trong conventions).
    const r0 = await api(app.url, `/api/khach/${k1}/hanh-trinh`);
    expect(r0.status).toBe(400);

    const cv = await chuyenDoi(app.url, k2, { khoa: "cv-k2", luc: "2026-04-02T00:00:00Z" });
    // Conversion của person khác → 404.
    const rSai = await api(
      app.url,
      `/api/khach/${k1}/hanh-trinh?chuyen_doi_id=${cv.chuyen_doi.id}`,
    );
    expect(rSai.status).toBe(404);
    const rKhong = await api(
      app.url,
      `/api/khach/${k1}/hanh-trinh?chuyen_doi_id=khong-co`,
    );
    expect(rKhong.status).toBe(404);

    // Ba event cùng giây: thứ tự = thứ tự insert (tie-break rowid).
    const giay = "2026-04-01T00:00:00Z";
    const e1 = await suKien(app.url, k1, { loai: "xem", nguon: "web", khoa: "s1", luc: giay });
    const e2 = await suKien(app.url, k1, { loai: "click", nguon: "web", khoa: "s2", luc: giay });
    const e3 = await suKien(app.url, k1, { loai: "dang_ky", nguon: "email", khoa: "s3", luc: giay });
    // Journey boundary <= conversion ở 04-02 gồm cả 3 event cùng giây.
    const cv1 = await chuyenDoi(app.url, k1, { khoa: "cv-k1", luc: "2026-04-02T00:00:00Z" });
    const j = await api(app.url, `/api/khach/${k1}/hanh-trinh?chuyen_doi_id=${cv1.chuyen_doi.id}`);
    expect(j.body.du_lieu.hanh_trinh.map((s: { id: string }) => s.id)).toEqual([e1, e2, e3]);
    await app.dong();
  });
});
