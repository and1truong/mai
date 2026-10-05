// Test ticket #70: GET /api/khach filter q/tag/segment_id/trang_thai_doi/
// nguon/da_mua + paginate offset/limit; trang chi tiết đủ section cho
// person đủ data và person rỗng.
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

function put(url: string, path: string, body: Record<string, unknown>) {
  return api(url, path, { method: "PUT", body: JSON.stringify(body) });
}

async function taoKhach(
  url: string,
  nhap: { ten?: string; email?: string; sdt?: string; dinh_danh?: Record<string, unknown>[] },
) {
  const r = await post(url, "/api/khach", nhap);
  expect([200, 201]).toContain(r.status);
  return r.body.du_lieu.id as string;
}

async function dongY(url: string, khachId: string, trangThai = "cho") {
  const r = await put(url, `/api/khach/${khachId}/dong-y`, {
    kenh: "email",
    muc_dich: "marketing",
    trang_thai: trangThai,
    nguon: "form_web",
  });
  expect(r.status).toBe(200);
}

async function suKien(
  url: string,
  khachId: string,
  e: { loai: string; nguon: string; khoa: string } & Record<string, unknown>,
) {
  const r = await post(url, "/api/khach/su-kien", {
    khach_id: khachId,
    loai: e.loai,
    nguon: e.nguon,
    khoa_idem: e.khoa,
    xay_ra_luc: e.luc,
    campaign_id: e.campaign_id,
    ban_the_hien_id: e.ban_the_hien_id,
  });
  expect(r.status).toBe(201);
}

async function chuyenDoiMua(url: string, khachId: string, khoa: string) {
  const r = await post(url, "/api/khach/chuyen-doi", {
    khach_id: khachId,
    loai: "mua",
    nguon: "shopify",
    khoa_idem: khoa,
    gia_tri: 120,
    tien_te: "USD",
  });
  expect(r.status).toBe(201);
  return r.body.du_lieu;
}

describe("GET /api/khach — filter + paginate (#70)", () => {
  test("q khớp tên, email, sđt và giá trị identity; không khớp → rỗng", async () => {
    const app = await taoServerTam();
    try {
      const id = await taoKhach(app.url, {
        ten: "Lan Tìm",
        email: "lan.tim@example.com",
        sdt: "0912-555-001",
        dinh_danh: [{ loai: "external", gia_tri: "EXT-777", nguon: "crm" }],
      });
      for (const q of ["Lan Tìm", "lan.tim@", "0912-555", "EXT-777"]) {
        const r = await api(app.url, `/api/khach?q=${encodeURIComponent(q)}`);
        expect(r.status).toBe(200);
        expect(r.body.du_lieu.ds_khach.map((k: any) => k.id)).toContain(id);
      }
      const rong = await api(app.url, "/api/khach?q=khong-co-ai-nay");
      expect(rong.body.du_lieu.ds_khach).toHaveLength(0);
      expect(rong.body.du_lieu.tong).toBe(0);
    } finally {
      app.dong();
    }
  });

  test("tag + trang_thai_doi + nguon + da_mua + segment_id", async () => {
    const app = await taoServerTam();
    try {
      // A: có tag vip + consent (→ dang_ky) + conversion mua (→ khach_mua)
      const a = await taoKhach(app.url, {
        ten: "Khách A",
        dinh_danh: [{ loai: "email", gia_tri: "a@x.com", nguon: "pos" }],
      });
      const b = await taoKhach(app.url, {
        ten: "Khách B",
        dinh_danh: [{ loai: "email", gia_tri: "b@x.com", nguon: "web" }],
      });
      await put(app.url, `/api/khach/${a}/tags`, { them: ["Vip"], nguon: "tay" });
      await dongY(app.url, a);
      await chuyenDoiMua(app.url, a, "loc:dh:a");

      // tag=vip → chỉ A
      const tag = await api(app.url, "/api/khach?tag=vip");
      expect(tag.body.du_lieu.ds_khach.map((k: any) => k.id)).toEqual([a]);
      const tagKhac = await api(app.url, "/api/khach?tag=khac");
      expect(tagKhac.body.du_lieu.ds_khach).toHaveLength(0);

      // trang_thai_doi — A đã mua → khach_mua; B vãng lai
      const mua = await api(app.url, "/api/khach?trang_thai_doi=khach_mua");
      expect(mua.body.du_lieu.ds_khach.map((k: any) => k.id)).toContain(a);
      const vangLai = await api(app.url, "/api/khach?trang_thai_doi=khach_vang_lai");
      expect(vangLai.body.du_lieu.ds_khach.map((k: any) => k.id)).toContain(b);

      // nguon = nguon của identity ĐẦU — A 'pos', B 'web'
      const pos = await api(app.url, "/api/khach?nguon=pos");
      expect(pos.body.du_lieu.ds_khach.map((k: any) => k.id)).toEqual([a]);

      // da_mua co|khong
      const coMua = await api(app.url, "/api/khach?da_mua=co");
      expect(coMua.body.du_lieu.ds_khach.map((k: any) => k.id)).toEqual([a]);
      const chuaMua = await api(app.url, "/api/khach?da_mua=khong");
      expect(chuaMua.body.du_lieu.ds_khach.map((k: any) => k.id)).toEqual([b]);

      // segment_id → member của segment khach_mua; id lạ → 404
      const seg = await post(app.url, "/api/segment", {
        ten: "Đã mua",
        quy_tac: { all: [{ trang_thai_doi: "khach_mua" }] },
      });
      expect(seg.status).toBe(201);
      const segId = seg.body.du_lieu.id as string;
      const theoSeg = await api(app.url, `/api/khach?segment_id=${segId}`);
      expect(theoSeg.body.du_lieu.ds_khach.map((k: any) => k.id)).toEqual([a]);
      const segLa = await api(app.url, "/api/khach?segment_id=seg-khong-co");
      expect(segLa.status).toBe(404);
    } finally {
      app.dong();
    }
  });

  test("paginate offset/limit + tong là tổng khớp không phân trang", async () => {
    const app = await taoServerTam();
    try {
      for (let i = 0; i < 3; i++) {
        await taoKhach(app.url, {
          ten: `Khách ${i}`,
          dinh_danh: [{ loai: "email", gia_tri: `k${i}@x.com`, nguon: "web" }],
        });
      }
      const trang1 = await api(app.url, "/api/khach?limit=2&offset=0");
      expect(trang1.body.du_lieu.ds_khach).toHaveLength(2);
      expect(trang1.body.du_lieu.tong).toBe(3);
      const trang2 = await api(app.url, "/api/khach?limit=2&offset=2");
      expect(trang2.body.du_lieu.ds_khach).toHaveLength(1);
      expect(trang2.body.du_lieu.tong).toBe(3);
      // Trang không chồng lấn
      const ids1 = new Set(trang1.body.du_lieu.ds_khach.map((k: any) => k.id));
      expect(ids1.has(trang2.body.du_lieu.ds_khach[0].id)).toBe(false);
    } finally {
      app.dong();
    }
  });
});

describe("chi tiết khách hàng — đủ section (#70)", () => {
  test("person đủ data: identities/consent/timeline/journey/quy_ve/gia_tri/tags", async () => {
    const app = await taoServerTam();
    try {
      const id = await taoKhach(app.url, {
        ten: "Đủ Data",
        dinh_danh: [{ loai: "email", gia_tri: "du@x.com", nguon: "web" }],
      });
      seed(app.db);
      await dongY(app.url, id);
      await put(app.url, `/api/khach/${id}/tags`, { them: ["vip"], nguon: "tay" });
      await suKien(app.url, id, {
        loai: "xem",
        nguon: "web",
        khoa: "loc:xem",
        luc: "2026-10-01T10:00:00Z",
        ban_the_hien_id: "seed-bth-tb-web",
      });
      await suKien(app.url, id, {
        loai: "click_mail",
        nguon: "email",
        khoa: "loc:click",
        luc: "2026-10-02T10:00:00Z",
      });
      await chuyenDoiMua(app.url, id, "loc:dh:du");

      const ct = await api(app.url, `/api/khach/${id}`);
      expect(ct.body.du_lieu.dinh_danh.length).toBeGreaterThan(0);
      expect(["khach_mua", "khach_quen"]).toContain(ct.body.du_lieu.trang_thai_doi);

      const dy = await api(app.url, `/api/khach/${id}/dong-y`);
      expect(dy.body.du_lieu.hien_tai[0].trang_thai).toBe("cho");

      const tl = await api(app.url, `/api/khach/${id}/timeline`);
      expect(tl.body.du_lieu.tong).toBeGreaterThanOrEqual(2);

      const gt = await api(app.url, `/api/khach/${id}/gia-tri`);
      expect(gt.body.du_lieu.gia_tri.so_don).toBe(1);
      expect(gt.body.du_lieu.gia_tri.doanh_thu.USD.tong).toBe(120);

      const qv = await api(app.url, `/api/khach/${id}/quy-ve`);
      expect(qv.body.du_lieu.ds.length).toBe(1);

      const jt = await api(app.url, `/api/khach/${id}/hanh-trinh`);
      expect(jt.status).toBe(200);
      expect(jt.body.du_lieu.hanh_trinh.map((b: any) => b.loai)).toEqual([
        "xem",
        "click_mail",
      ]);
      expect(jt.body.du_lieu.hanh_trinh[0].la_first_touch).toBe(true);

      const tags = await api(app.url, `/api/khach/${id}/tags`);
      expect(tags.body.du_lieu.ds_tag.map((t: any) => t.tag)).toContain("vip");
    } finally {
      app.dong();
    }
  });

  test("person rỗng: detail 200, section trống, hành trình 400", async () => {
    const app = await taoServerTam();
    try {
      const id = await taoKhach(app.url, { ten: "Rỗng" });
      const ct = await api(app.url, `/api/khach/${id}`);
      expect(ct.status).toBe(200);
      expect(ct.body.du_lieu.trang_thai_doi).toBe("khach_vang_lai");
      expect(ct.body.du_lieu.dinh_danh).toHaveLength(0);

      const dy = await api(app.url, `/api/khach/${id}/dong-y`);
      expect(dy.body.du_lieu.hien_tai).toHaveLength(0);

      const tl = await api(app.url, `/api/khach/${id}/timeline`);
      expect(tl.body.du_lieu.tong).toBe(0);

      const gt = await api(app.url, `/api/khach/${id}/gia-tri`);
      expect(gt.body.du_lieu.gia_tri.so_don).toBe(0);

      const qv = await api(app.url, `/api/khach/${id}/quy-ve`);
      expect(qv.body.du_lieu.ds).toHaveLength(0);

      const jt = await api(app.url, `/api/khach/${id}/hanh-trinh`);
      expect(jt.status).toBe(400);
    } finally {
      app.dong();
    }
  });
});
