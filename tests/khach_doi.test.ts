// Ticket #65: lifecycle khách (visitor → subscriber → customer → repeat
// → dormant) có giải thích + chỉ số giá trị theo currency.
import { describe, expect, test } from "bun:test";
import { seed } from "../src/server/seed.ts";
import {
  giaTriKhach,
  tinhDoiKhach,
  capNhatDoiKhach,
  NGUONG_NGU_DONG_NGAY,
} from "../src/modules/khach/index.ts";
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
  });
  return r.body.du_lieu.id as string;
}

async function ghiMua(
  url: string,
  email: string,
  khoa: string,
  tienTe = "USD",
  giaTri = 10,
  luc?: string,
) {
  return post(url, "/api/khach/chuyen-doi", {
    dinh_danh: { loai: "email", gia_tri: email },
    loai: "mua",
    gia_tri: giaTri,
    tien_te: tienTe,
    nguon: "test",
    khoa_idem: khoa,
    ...(luc ? { xay_ra_luc: luc } : {}),
  });
}

describe("lifecycle (#65)", () => {
  test("visitor → subscriber → customer → repeat: mỗi bước có giải thích", async () => {
    const app = await taoServerTam();
    const khachId = await taoKhachMoi(app.url, "lc@x.com");

    // Person mới, chưa event/consent → khach_vang_lai.
    let k = await (await fetch(`${app.url}/api/khach/${khachId}`)).json();
    expect(k.du_lieu.trang_thai_doi).toBe("khach_vang_lai");

    // Consent 'cho' → dang_ky.
    await (
      await fetch(`${app.url}/api/khach/${khachId}/dong-y`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kenh: "email", muc_dich: "marketing", trang_thai: "cho", nguon: "test" }),
      })
    ).json();
    k = await (await fetch(`${app.url}/api/khach/${khachId}`)).json();
    expect(k.du_lieu.trang_thai_doi).toBe("dang_ky");
    expect(k.du_lieu.giai_thich_doi.co_dong_y_cho).toBe(true);

    // Mua 1 → khach_mua; mua 2 → khach_quen.
    await ghiMua(app.url, "lc@x.com", "lc-1");
    k = await (await fetch(`${app.url}/api/khach/${khachId}`)).json();
    expect(k.du_lieu.trang_thai_doi).toBe("khach_mua");
    await ghiMua(app.url, "lc@x.com", "lc-2");
    k = await (await fetch(`${app.url}/api/khach/${khachId}`)).json();
    expect(k.du_lieu.trang_thai_doi).toBe("khach_quen");
    // Transition có audit trail.
    const sk = app.db
      .query("SELECT * FROM su_kien WHERE entity_loai='khach' AND entity_id=? AND su_kien='doi_trang_thai_doi' ORDER BY rowid")
      .all(khachId) as { du_lieu: string }[];
    expect(sk.length).toBeGreaterThanOrEqual(3); // vang_lai→dang_ky→mua→quen
    await app.dong();
  });

  test("ngu_dong sau 90 ngày không event; event mới đánh thức", async () => {
    const app = await taoServerTam();
    const cu = new Date(Date.now() - 100 * 86400000).toISOString();
    const khachId = await taoKhachMoi(app.url, "dorm@x.com");
    // Event 100 ngày trước → dormant.
    await post(app.url, "/api/khach/su-kien", {
      dinh_danh: { loai: "email", gia_tri: "dorm@x.com" },
      loai: "xem", nguon: "web", khoa_idem: "d-1", xay_ra_luc: cu,
    });
    let k = await (await fetch(`${app.url}/api/khach/${khachId}`)).json();
    expect(k.du_lieu.trang_thai_doi).toBe("ngu_dong");
    expect(k.du_lieu.giai_thich_doi.ly_do).toContain("Không hoạt động");

    // Event mới → recompute, hết dormant (vẫn chưa mua → khach_vang_lai).
    await post(app.url, "/api/khach/su-kien", {
      dinh_danh: { loai: "email", gia_tri: "dorm@x.com" },
      loai: "xem", nguon: "web", khoa_idem: "d-2",
    });
    k = await (await fetch(`${app.url}/api/khach/${khachId}`)).json();
    expect(k.du_lieu.trang_thai_doi).toBe("khach_vang_lai");
    await app.dong();
  });

  test("khách quen cũng ngủ đông khi mất tích ≥90 ngày", async () => {
    const app = await taoServerTam();
    const khachId = await taoKhachMoi(app.url, "rpt@x.com");
    const cu = new Date(Date.now() - 120 * 86400000).toISOString();
    // Hoạt động cuối tính cả conversion: 2 đơn 120 ngày trước, không
    // event nào mới → dormant (khach_quen không thắng được tuổi tác).
    await ghiMua(app.url, "rpt@x.com", "r-1", "USD", 5, cu);
    await ghiMua(app.url, "rpt@x.com", "r-2", "USD", 7, cu);
    const k = await (await fetch(`${app.url}/api/khach/${khachId}`)).json();
    expect(k.du_lieu.trang_thai_doi).toBe("ngu_dong");
    // Event mới đánh thức → quay về khach_quen (2 đơn vẫn còn).
    await post(app.url, "/api/khach/su-kien", {
      dinh_danh: { loai: "email", gia_tri: "rpt@x.com" },
      loai: "mua", nguon: "pos", khoa_idem: "r-sk",
    });
    const k2 = await (await fetch(`${app.url}/api/khach/${khachId}`)).json();
    expect(k2.du_lieu.trang_thai_doi).toBe("khach_quen");
    await app.dong();
  });

  test("conversion mới nhất đánh thức dormant; hủy đăng ký hạ state", async () => {
    const app = await taoServerTam();
    const cu = new Date(Date.now() - 100 * 86400000).toISOString();
    const khachId = await taoKhachMoi(app.url, "w@x.com");
    await post(app.url, "/api/khach/su-kien", {
      dinh_danh: { loai: "email", gia_tri: "w@x.com" },
      loai: "xem", nguon: "web", khoa_idem: "w-1", xay_ra_luc: cu,
    });
    // Conversion mua hiện tại → khách vừa mua không dormant.
    await post(app.url, "/api/khach/chuyen-doi", {
      dinh_danh: { loai: "email", gia_tri: "w@x.com" },
      loai: "mua", gia_tri: 10, tien_te: "USD", nguon: "test", khoa_idem: "w-m",
    });
    let k = await (await fetch(`${app.url}/api/khach/${khachId}/gia-tri`)).json();
    expect(k.du_lieu.trang_thai_doi).toBe("khach_mua");

    // Đăng ký → dang_ky; hủy đăng ký sau đó → hạ về theo data còn lại.
    await post(app.url, "/api/khach/su-kien", {
      dinh_danh: { loai: "email", gia_tri: "w@x.com" },
      loai: "dang_ky", nguon: "web", khoa_idem: "w-dk",
    });
    k = await (await fetch(`${app.url}/api/khach/${khachId}/gia-tri`)).json();
    expect(k.du_lieu.trang_thai_doi).toBe("khach_mua"); // mua vẫn thắng dang_ky
    await post(app.url, "/api/khach/su-kien", {
      dinh_danh: { loai: "email", gia_tri: "unsub@x.com" },
      loai: "dang_ky", nguon: "web", khoa_idem: "u-dk", xay_ra_luc: cu,
    });
    const unsubId = await taoKhachMoi(app.url, "unsub@x.com");
    k = await (await fetch(`${app.url}/api/khach/${unsubId}/gia-tri`)).json();
    expect(k.du_lieu.trang_thai_doi).toBe("ngu_dong"); // event cũ → dormant
    await post(app.url, "/api/khach/su-kien", {
      dinh_danh: { loai: "email", gia_tri: "unsub@x.com" },
      loai: "huy_dang_ky", nguon: "web", khoa_idem: "u-h",
    });
    k = await (await fetch(`${app.url}/api/khach/${unsubId}/gia-tri`)).json();
    // huy_dang_ky mới hơn dang_ky → không còn dang_ky; event mới → hết dormant.
    expect(k.du_lieu.trang_thai_doi).toBe("khach_vang_lai");
    await app.dong();
  });

  test("dang_ky/huy_dang_ky cùng timestamp: insert sau thắng (rowid)", async () => {
    const app = await taoServerTam();
    const khachId = await taoKhachMoi(app.url, "tie@x.com");
    const ts = new Date().toISOString();
    for (const [i, loai] of ["dang_ky", "huy_dang_ky", "dang_ky"].entries()) {
      await post(app.url, "/api/khach/su-kien", {
        dinh_danh: { loai: "email", gia_tri: "tie@x.com" },
        loai, nguon: "web", khoa_idem: `tie-${i}`, xay_ra_luc: ts,
      });
    }
    const k = await (await fetch(`${app.url}/api/khach/${khachId}/gia-tri`)).json();
    expect(k.du_lieu.trang_thai_doi).toBe("dang_ky");
    // Thêm một huy_dang_ky cùng timestamp → lại là mới nhất → hạ state.
    await post(app.url, "/api/khach/su-kien", {
      dinh_danh: { loai: "email", gia_tri: "tie@x.com" },
      loai: "huy_dang_ky", nguon: "web", khoa_idem: "tie-3", xay_ra_luc: ts,
    });
    const k2 = await (await fetch(`${app.url}/api/khach/${khachId}/gia-tri`)).json();
    expect(k2.du_lieu.trang_thai_doi).toBe("khach_vang_lai");
    await app.dong();
  });
});

describe("chỉ số giá trị (#65)", () => {
  test("metrics theo currency tách riêng — hai currency không cộng chung", async () => {
    const app = await taoServerTam();
    const khachId = await taoKhachMoi(app.url, "fx@x.com");
    await ghiMua(app.url, "fx@x.com", "fx-1", "USD", 100);
    await ghiMua(app.url, "fx@x.com", "fx-2", "USD", 300);
    await ghiMua(app.url, "fx@x.com", "fx-3", "VND", 500000);
    // Đơn không gia_tri không tính doanh thu.
    await post(app.url, "/api/khach/chuyen-doi", {
      dinh_danh: { loai: "email", gia_tri: "fx@x.com" },
      loai: "mua", nguon: "test", khoa_idem: "fx-4",
    });

    const gt = await (await fetch(`${app.url}/api/khach/${khachId}/gia-tri`)).json();
    const g = gt.du_lieu.gia_tri;
    expect(g.so_don).toBe(4);
    expect(g.doanh_thu["USD"]!).toMatchObject({ tong: 400, so_don_co_gia: 2, gia_tri_tb: 200 });
    expect(g.doanh_thu["VND"]!).toMatchObject({ tong: 500000, so_don_co_gia: 1 });
    expect(g.doanh_thu["EUR"]).toBeUndefined();
    expect(g.don_dau_luc).toBeTruthy();
    expect(g.don_cuoi_luc >= g.don_dau_luc).toBe(true);
    // 4 đơn trong <90 ngày → tan_suat = 4/1.
    expect(g.tan_suat).toBe(4);
    expect(gt.du_lieu.trang_thai_doi).toBe("khach_quen");
    expect(gt.du_lieu.giai_thich.so_don_mua).toBe(4);
    await app.dong();
  });

  test("hàm derive gọi trực tiếp được (cho segment #66); tan_suat theo khung 90 ngày", async () => {
    const app = await taoServerTam();
    const khachId = await taoKhachMoi(app.url, "tv@x.com");
    const namNgoai = new Date(Date.now() - 200 * 86400000).toISOString();
    await ghiMua(app.url, "tv@x.com", "tv-1", "USD", 10, namNgoai);
    await ghiMua(app.url, "tv@x.com", "tv-2", "USD", 20);

    const g = giaTriKhach(app.db, khachId);
    expect(g.so_don).toBe(2);
    expect(g.doanh_thu["USD"]!.tong).toBe(30);
    // span ~200 ngày → ceil(200/90)=3 khung → 2/3.
    expect(g.tan_suat).toBeCloseTo(2 / 3, 5);

    // tinhDoiKhach thuần đọc: dormant vì event? — không có tuong_tac nên
    // không dormant; so_don 2 → khach_quen.
    const doi = tinhDoiKhach(app.db, khachId);
    expect(doi.trang_thai).toBe("khach_quen");
    expect(doi.giai_thich.so_don_mua).toBe(2);
    // capNhatDoiKhach idempotent: gọi lại không đổi gì, không thêm audit.
    const truoc = (app.db.query("SELECT COUNT(*) AS c FROM su_kien").get() as { c: number }).c;
    capNhatDoiKhach(app.db, khachId);
    const sau = (app.db.query("SELECT COUNT(*) AS c FROM su_kien").get() as { c: number }).c;
    expect(sau).toBe(truoc);
    expect(NGUONG_NGU_DONG_NGAY).toBe(90);
    await app.dong();
  });

  test("GET gia-tri person không tồn tại → 404; seed backfill lifecycle cho fixture", async () => {
    const app = await taoServerTam();
    seed(app.db); // seed sau startServer → backfill không chạy lại; kiểm route
    const nf = await fetch(`${app.url}/api/khach/khong-co/gia-tri`);
    expect(nf.status).toBe(404);
    // Person fixture KH-1042 có 2 đơn → khach_quen (cập nhật trong txn nạp).
    const dd = app.db
      .query("SELECT khach_id FROM dinh_danh WHERE gia_tri_chuan = 'pos-tiem-banh:KH-1042'")
      .get() as { khach_id: string } | null;
    expect(dd).toBeTruthy();
    const k = await (await fetch(`${app.url}/api/khach/${dd!.khach_id}`)).json();
    expect(k.du_lieu.trang_thai_doi).toBe("khach_quen");
    await app.dong();
  });
});
