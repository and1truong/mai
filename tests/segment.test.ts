// Ticket #66: segment động theo DSL + tag tay có audit nguồn.
import { describe, expect, test } from "bun:test";
import { thanhVienSegment, kiemTraQuyTac } from "../src/modules/khach/segment.ts";
import { taoServerTam } from "./helpers.ts";

async function post(url: string, path: string, body: Record<string, unknown>) {
  const r = await fetch(`${url}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: r.status, body: (await r.json()) as Record<string, any> };
}

async function taoKhachMoi(url: string, email: string): Promise<string> {
  const r = await post(url, "/api/khach", {
    dinh_danh: [{ loai: "email", gia_tri: email }],
    email, // đặt cả field profile để co_truong/khong_co_truong có ý nghĩa
  });
  return r.body.du_lieu.id as string;
}

async function taoSegmentMoi(url: string, quy_tac: unknown, ten = "seg-test"): Promise<string> {
  const r = await post(url, "/api/segment", { ten, quy_tac });
  return r.body.du_lieu.id as string;
}

async function xemTruoc(url: string, segId: string): Promise<{ so_luong: number; mau: string[] }> {
  const r = await (await fetch(`${url}/api/segment/${segId}/xem-truoc`)).json();
  return r.du_lieu;
}

async function ghiMua(url: string, email: string, khoa: string, giaTri = 10, tienTe = "USD") {
  return post(url, "/api/khach/chuyen-doi", {
    dinh_danh: { loai: "email", gia_tri: email },
    loai: "mua", gia_tri: giaTri, tien_te: tienTe, nguon: "test", khoa_idem: khoa,
  });
}

describe("DSL quy_tac (#66)", () => {
  test("mỗi loại điều kiện evaluate đúng trên một person", async () => {
    const app = await taoServerTam();
    const id = await taoKhachMoi(app.url, "dk@x.com");
    await post(app.url, "/api/khach/su-kien", {
      dinh_danh: { loai: "email", gia_tri: "dk@x.com" },
      loai: "click", nguon: "web", khoa_idem: "dk-1",
    });
    // Tag qua PUT:
    await (
      await fetch(`${app.url}/api/khach/${id}/tags`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ them: ["Vip"], nguon: "automation" }),
      })
    ).json();
    await ghiMua(app.url, "dk@x.com", "dk-m1", 150);

    const db = app.db;
    const check = (qt: Record<string, unknown>) => thanhVienSegment(db, id, qt as never);
    expect(check({ all: [{ trang_thai_doi: "khach_mua" }] })).toBe(true);
    expect(check({ all: [{ trang_thai_doi: ["dang_ky", "khach_mua"] }] })).toBe(true);
    expect(check({ all: [{ trang_thai_doi: "khach_quen" }] })).toBe(false);
    expect(check({ all: [{ co_truong: "email" }] })).toBe(true);
    expect(check({ all: [{ khong_co_truong: "sdt" }] })).toBe(true);
    expect(check({ all: [{ khong_co_truong: "email" }] })).toBe(false);
    expect(check({ all: [{ co_su_kien: { loai: "click" } }] })).toBe(true);
    expect(check({ all: [{ co_su_kien: { loai: "click", trong_ngay: 1 } }] })).toBe(true);
    expect(check({ all: [{ khong_co_su_kien: { loai: "xem" } }] })).toBe(true);
    expect(check({ all: [{ co_su_kien: { loai: "xem" } }] })).toBe(false);
    expect(check({ all: [{ co_tag: "vip" }] })).toBe(true); // tag chuẩn hóa lowercase
    expect(check({ all: [{ so_don_toi_thieu: 1 }] })).toBe(true);
    expect(check({ all: [{ so_don_toi_thieu: 2 }] })).toBe(false);
    expect(check({ all: [{ tong_doanh_thu_toi_thieu: { tien_te: "USD", gia_tri: 100 } }] })).toBe(true);
    expect(check({ all: [{ tong_doanh_thu_toi_thieu: { tien_te: "USD", gia_tri: 200 } }] })).toBe(false);
    expect(check({ all: [{ tong_doanh_thu_toi_thieu: { tien_te: "VND", gia_tri: 1 } }] })).toBe(false);
    expect(check({ all: [{ don_cuoi_truoc_ngay: "2099-01-01T00:00:00.000Z" }] })).toBe(true);
    expect(check({ all: [{ don_cuoi_truoc_ngay: "2020-01-01T00:00:00.000Z" }] })).toBe(false);
    // any: một đúng là đủ; all+any kết hợp.
    expect(check({ any: [{ trang_thai_doi: "khach_quen" }, { co_tag: "vip" }] })).toBe(true);
    expect(check({ all: [{ trang_thai_doi: "khach_mua" }], any: [{ trang_thai_doi: "ngu_dong" }] })).toBe(false);
    await app.dong();
  });

  test("kiemTraQuyTac bắt DSL xấu", () => {
    const ds: string[] = [];
    kiemTraQuyTac("chuoi", ds);
    kiemTraQuyTac({}, ds);
    kiemTraQuyTac({ all: "khong-phai-mang" }, ds);
    kiemTraQuyTac({ all: [{ hai_khoa: 1, nua: 2 }] }, ds);
    kiemTraQuyTac({ all: [{ dieu_kien_la: 1 }] }, ds);
    kiemTraQuyTac({ all: [{ trang_thai_doi: "sai" }] }, ds);
    kiemTraQuyTac({ all: [{ co_su_kien: {} }] }, ds);
    kiemTraQuyTac({ all: [{ tong_doanh_thu_toi_thieu: { tien_te: "usd1", gia_tri: 5 } }] }, ds);
    expect(ds.length).toBeGreaterThanOrEqual(8);
  });
});

describe("API segment (#66)", () => {
  test("CRUD + xem-truoc: 'click nhưng chưa mua' rớt khi mua", async () => {
    const app = await taoServerTam();
    const id = await taoKhachMoi(app.url, "pv@x.com");
    await post(app.url, "/api/khach/su-kien", {
      dinh_danh: { loai: "email", gia_tri: "pv@x.com" },
      loai: "click", nguon: "web", khoa_idem: "pv-1",
    });
    const segId = await taoSegmentMoi(app.url, {
      all: [{ co_su_kien: { loai: "click" } }, { so_don_toi_thieu: 0 }],
      any: [{ khong_co_su_kien: { loai: "mua" } }],
    }, "click-chua-mua");
    let pv = await xemTruoc(app.url, segId);
    expect(pv.so_luong).toBeGreaterThanOrEqual(1);
    expect(pv.mau).toContain(id);

    // Person mua → rớt khỏi segment (membership tính lại khi đọc).
    await post(app.url, "/api/khach/su-kien", {
      dinh_danh: { loai: "email", gia_tri: "pv@x.com" },
      loai: "mua", nguon: "pos", khoa_idem: "pv-m",
    });
    pv = await xemTruoc(app.url, segId);
    expect(pv.mau).not.toContain(id);

    // GET list + detail trả quy_tac đã parse.
    const list = await (await fetch(`${app.url}/api/segment`)).json();
    expect(list.du_lieu.ds.find((s: { id: string }) => s.id === segId).quy_tac.all).toHaveLength(2);

    // PUT đổi rule → membership theo rule mới.
    await (
      await fetch(`${app.url}/api/segment/${segId}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ quy_tac: { all: [{ co_su_kien: { loai: "mua" } }] } }),
      })
    ).json();
    pv = await xemTruoc(app.url, segId);
    expect(pv.mau).toContain(id);

    // DSL xấu → 400; xóa segment không campaign → ok.
    const bad = await post(app.url, "/api/segment", { ten: "x", quy_tac: { all: [{ bogus: 1 }] } });
    expect(bad.status).toBe(400);
    const del = await fetch(`${app.url}/api/segment/${segId}`, { method: "DELETE" });
    expect(del.status).toBe(200);
    const del2 = await fetch(`${app.url}/api/segment/${segId}`, { method: "DELETE" });
    expect(del2.status).toBe(404);
    await app.dong();
  });

  test("segment đang được campaign dùng → DELETE 409", async () => {
    const app = await taoServerTam();
    const segId = await taoSegmentMoi(app.url, { all: [{ co_truong: "email" }] });
    // Gắn segment cho campaign mới qua PUT.
    const cp = await post(app.url, "/api/campaign", { ten: "cp-seg", segment_id: segId });
    expect(cp.status).toBe(201);
    expect(cp.body.du_lieu.segment_id).toBe(segId);
    const del = await fetch(`${app.url}/api/segment/${segId}`, { method: "DELETE" });
    expect(del.status).toBe(409);
    expect((await del.json()).loi.ma).toBe("SEGMENT_DANG_DUNG");
    // segment_id ảo → PUT campaign 400; gỡ segment → DELETE được.
    const bad = await post(app.url, "/api/campaign", { ten: "c2", segment_id: "khong-co" });
    expect(bad.status).toBe(400);
    const cpId = cp.body.du_lieu.id;
    await (
      await fetch(`${app.url}/api/campaign/${cpId}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ten: "cp-seg", segment_id: "" }),
      })
    ).json();
    const del2 = await fetch(`${app.url}/api/segment/${segId}`, { method: "DELETE" });
    expect(del2.status).toBe(200);
    await app.dong();
  });
});

describe("tag (#66)", () => {
  test("PUT tags thêm/bỏ, chuẩn hóa, audit nguon; validate nguon", async () => {
    const app = await taoServerTam();
    const id = await taoKhachMoi(app.url, "tag@x.com");
    const put = async (body: Record<string, unknown>) =>
      (await fetch(`${app.url}/api/khach/${id}/tags`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }));

    let r = await put({ them: ["Vip", " vip ", "B2B"], nguon: "automation" });
    let j = await r.json();
    expect(r.status).toBe(200);
    expect(j.du_lieu.ds_tag.map((t: { tag: string }) => t.tag).sort()).toEqual(["b2b", "vip"]);
    expect(j.du_lieu.ds_tag[0].nguon).toBe("automation");

    // Idempotent: thêm lại không nhân; bỏ hoạt động.
    r = await put({ them: ["VIP"], nguon: "tay" });
    j = await r.json();
    expect(j.du_lieu.ds_tag).toHaveLength(2);
    r = await put({ bo: ["vip"] });
    j = await r.json();
    expect(j.du_lieu.ds_tag.map((t: { tag: string }) => t.tag)).toEqual(["b2b"]);

    // nguon sai → 400; tag nguồn 'import' được.
    r = await put({ them: ["x"], nguon: "ma-gic" });
    expect(r.status).toBe(400);
    r = await put({ them: ["imported"], nguon: "import" });
    expect(r.status).toBe(200);

    // GET tags; person lạ → 404.
    const g = await (await fetch(`${app.url}/api/khach/${id}/tags`)).json();
    expect(g.du_lieu.ds_tag.map((t: { tag: string }) => t.tag).sort()).toEqual(["b2b", "imported"]);
    const nf = await fetch(`${app.url}/api/khach/khong-co/tags`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ them: ["x"] }),
    });
    expect(nf.status).toBe(404);
    await app.dong();
  });
});
