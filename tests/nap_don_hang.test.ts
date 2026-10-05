// Test ticket #64: contract nạp đơn hàng commerce — identity matching có
// kiểm soát, idempotent, một txn tạo person+event+conversion, fixture.
import { expect, test } from "bun:test";
import { taoServerTam } from "./helpers.ts";
import { seed } from "../src/server/seed.ts";
import { napDonHangMau, docDonHangMau } from "../src/modules/khach/nap_fixture.ts";

async function post(url: string, path: string, body: Record<string, unknown>) {
  const res = await fetch(`${url}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

const DON = {
  he_thong: "shopify",
  khach_ngoai_id: "CUS-777",
  don_hang_ngoai_id: "ORD-9001",
  email: "khach@shop.com",
  ten: "Khách Sỉ",
  items: [{ ma: "SP-1", ten: "Sản phẩm 1", so_luong: 2, gia: 50000 }],
  gia_tri: 100000,
  tien_te: "VND",
  mua_luc: "2026-10-01T10:00:00Z",
};

test("#64 nạp đơn: person+identity+event+conversion một cụm; replay không nhân", async () => {
  const app = await taoServerTam();
  const r1 = await post(app.url, "/api/khach/nap-don-hang", DON);
  expect(r1.status).toBe(201);
  const khachId = r1.body.du_lieu.khach.id;
  expect(r1.body.du_lieu.su_kien.loai).toBe("mua");
  expect(r1.body.du_lieu.chuyen_doi.loai).toBe("mua");
  expect(r1.body.du_lieu.chuyen_doi.tien_te).toBe("VND");
  expect(r1.body.du_lieu.chuyen_doi.don_hang_ngoai_id).toBe("ORD-9001");
  // Identity external <he_thong>:<khach_ngoai_id> + email gắn person.
  const dd = await fetch(`${app.url}/api/khach/${khachId}/dinh-danh`).then((r) => r.json());
  const keys = dd.du_lieu.map((d: { loai: string; gia_tri_chuan: string }) => `${d.loai}:${d.gia_tri_chuan}`);
  expect(keys).toContain("external:shopify:CUS-777");
  expect(keys).toContain("email:khach@shop.com");

  const dem = (bang: string) =>
    (app.db.query(`SELECT COUNT(*) AS c FROM ${bang}`).get() as { c: number }).c;
  const n0 = { khach: dem("khach"), tt: dem("tuong_tac"), cd: dem("chuyen_doi") };

  // Gọi lại cùng khoa_idem dự phòng (không gửi khoa_idem — dùng he_thong+don_hang).
  const r2 = await post(app.url, "/api/khach/nap-don-hang", DON);
  expect(r2.status).toBe(200);
  expect(r2.body.du_lieu.da_tao).toBe(false);
  expect(r2.body.du_lieu.chuyen_doi.id).toBe(r1.body.du_lieu.chuyen_doi.id);
  expect(dem("khach")).toBe(n0.khach);
  expect(dem("tuong_tac")).toBe(n0.tt);
  expect(dem("chuyen_doi")).toBe(n0.cd);
  await app.dong();
});

test("#64 validation + conflict identity giữa hai person → 409", async () => {
  const app = await taoServerTam();
  // Thiếu tien_te.
  const thieu = await post(app.url, "/api/khach/nap-don-hang", { ...DON, tien_te: "" });
  expect(thieu.status).toBe(400);
  expect(thieu.body.loi.chi_tiet.join(" ")).toContain("tien_te");
  // items sai.
  const badItems = await post(app.url, "/api/khach/nap-don-hang", {
    ...DON,
    items: [{ ten: "", so_luong: 0, gia: -1 }],
    don_hang_ngoai_id: "ORD-X",
  });
  expect(badItems.status).toBe(400);

  // Person A có email a@x.com; đơn B đụng email đó nhưng external id khác
  // → resolveKhach thấy external mới + email của A → gắn vào A (không phải
  // conflict); conflict thật: external id đã thuộc B, email thuộc A.
  await post(app.url, "/api/khach/nap-don-hang", {
    ...DON,
    khach_ngoai_id: "CUS-A",
    don_hang_ngoai_id: "ORD-A",
    email: "a@x.com",
  });
  await post(app.url, "/api/khach/nap-don-hang", {
    ...DON,
    khach_ngoai_id: "CUS-B",
    don_hang_ngoai_id: "ORD-B",
    email: "b@x.com",
  });
  const conflict = await post(app.url, "/api/khach/nap-don-hang", {
    ...DON,
    khach_ngoai_id: "CUS-B", // external của B
    don_hang_ngoai_id: "ORD-C",
    email: "a@x.com", // email của A
  });
  expect(conflict.status).toBe(409);
  expect(conflict.body.loi.ma).toBe("XUNG_DOT_DINH_DANH");
  expect(conflict.body.loi.chi_tiet.khach_ids.length).toBe(2);
  await app.dong();
});

test("#64 fixture adapter deterministic: nạp mẫu hai lần không nhân", async () => {
  const app = await taoServerTam();
  const ds = docDonHangMau();
  expect(ds.length).toBeGreaterThanOrEqual(3);
  const lan1 = napDonHangMau(app.db, "test");
  expect(lan1.so_don_moi).toBe(3);
  // KH-1042 xuất hiện 2 đơn → cùng một person.
  const soKhach = (app.db.query("SELECT COUNT(*) AS c FROM khach").get() as { c: number }).c;
  expect(soKhach).toBe(2);
  // Replay fixture: không thêm gì.
  const lan2 = napDonHangMau(app.db, "test");
  expect(lan2.so_don_moi).toBe(0);
  expect((app.db.query("SELECT COUNT(*) AS c FROM chuyen_doi").get() as { c: number }).c).toBe(3);
  expect((app.db.query("SELECT COUNT(*) AS c FROM khach").get() as { c: number }).c).toBe(2);
  await app.dong();
});

test("#64 person có touch trước → đơn nạp quy về attribution", async () => {
  const app = await taoServerTam();
  seed(app.db);
  // Touch: click vào bản thể hiện trước khi mua.
  await post(app.url, "/api/khach/su-kien", {
    dinh_danh: { loai: "email", gia_tri: "khach@shop.com" },
    loai: "click", nguon: "web", khoa_idem: "touch-1",
    ban_the_hien_id: "seed-bth-tb-web", xay_ra_luc: "2026-09-30T00:00:00Z",
  });
  const r = await post(app.url, "/api/khach/nap-don-hang", DON);
  expect(r.status).toBe(201);
  // resolveKhach gắn external identity vào person đã có (qua email).
  const qv = r.body.du_lieu.quy_ve as { mo_hinh: string; loai_dich: string; do_tin: string }[];
  expect(qv[0]).toMatchObject({ mo_hinh: "first_touch", loai_dich: "ban_the_hien", do_tin: "chac" });
  expect(qv[1]).toMatchObject({ mo_hinh: "last_touch", loai_dich: "ban_the_hien", do_tin: "chac" });
  await app.dong();
});
