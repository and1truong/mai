import { expect, test } from "bun:test";
import { taoServerTam } from "./helpers.ts";

// Ticket #62: consent theo kênh + mục đích — transition ghi log,
// marketing/giao_dich tách, bridge từ subscribe/hủy nguoi_nhan.

async function taoKhachQuaApi(url: string) {
  const r = await fetch(`${url}/api/khach`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ten: "Khách A" }),
  });
  return (await r.json()).du_lieu.id as string;
}

async function datDongY(url: string, khachId: string, body: unknown) {
  const r = await fetch(`${url}/api/khach/${khachId}/dong-y`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: r.status, body: await r.json() };
}

test("đặt + rút + opt-in lại: history đầy đủ từng chuyển trạng thái", async () => {
  const app = await taoServerTam();
  const id = await taoKhachQuaApi(app.url);
  const cho = await datDongY(app.url, id, {
    kenh: "email",
    muc_dich: "marketing",
    trang_thai: "cho",
    nguon: "form_web",
  });
  expect(cho.status).toBe(200);
  expect(cho.body.du_lieu.da_ghi_log).toBe(true);
  // Khẳng định lại cùng trạng thái = no-op, không đẩy log rác.
  const lai = await datDongY(app.url, id, {
    kenh: "email",
    muc_dich: "marketing",
    trang_thai: "cho",
    nguon: "form_web",
  });
  expect(lai.body.du_lieu.da_ghi_log).toBe(false);
  await datDongY(app.url, id, {
    kenh: "email",
    muc_dich: "marketing",
    trang_thai: "tu_choi",
    nguon: "link_email",
  });
  await datDongY(app.url, id, {
    kenh: "email",
    muc_dich: "marketing",
    trang_thai: "cho",
    nguon: "form_web",
  });
  const dy = await (await fetch(`${app.url}/api/khach/${id}/dong-y`)).json();
  const lich = dy.du_lieu.lich_su;
  expect(lich).toHaveLength(3);
  expect(lich.map((l: { sang_trang_thai: string }) => l.sang_trang_thai)).toEqual([
    "cho",
    "tu_choi",
    "cho",
  ]);
  expect(lich[0].tu_trang_thai).toBe("");
  expect(lich[1].tu_trang_thai).toBe("cho");
  expect(lich[2].nguon).toBe("form_web");
  expect(dy.du_lieu.hien_tai[0].trang_thai).toBe("cho");
  await app.dong();
});

test("marketing và giao_dich là hai ô riêng — rút marketing không đụng transactional", async () => {
  const app = await taoServerTam();
  const id = await taoKhachQuaApi(app.url);
  await datDongY(app.url, id, {
    kenh: "email",
    muc_dich: "marketing",
    trang_thai: "cho",
    nguon: "form_web",
  });
  await datDongY(app.url, id, {
    kenh: "email",
    muc_dich: "giao_dich",
    trang_thai: "cho",
    nguon: "he_thong",
  });
  await datDongY(app.url, id, {
    kenh: "email",
    muc_dich: "marketing",
    trang_thai: "tu_choi",
    nguon: "link_email",
  });
  const dy = await (await fetch(`${app.url}/api/khach/${id}/dong-y`)).json();
  const tt = Object.fromEntries(
    dy.du_lieu.hien_tai.map((d: { muc_dich: string; trang_thai: string }) => [
      d.muc_dich,
      d.trang_thai,
    ]),
  );
  expect(tt.marketing).toBe("tu_choi");
  expect(tt.giao_dich).toBe("cho");
  await app.dong();
});

test("validation: nguon bắt buộc; kenh/muc_dich/trang_thai sai → 400", async () => {
  const app = await taoServerTam();
  const id = await taoKhachQuaApi(app.url);
  const thieuNguon = await datDongY(app.url, id, {
    kenh: "email",
    muc_dich: "marketing",
    trang_thai: "cho",
  });
  expect(thieuNguon.status).toBe(400);
  const sai = await datDongY(app.url, id, {
    kenh: "fax",
    muc_dich: "quang_cao",
    trang_thai: "co",
    nguon: "tay",
  });
  expect(sai.status).toBe(400);
  expect(sai.body.loi.chi_tiet.length).toBeGreaterThanOrEqual(3);
  // Person không tồn tại → 404.
  const vong = await datDongY(app.url, "kh-ao", {
    kenh: "email",
    muc_dich: "marketing",
    trang_thai: "cho",
    nguon: "tay",
  });
  expect(vong.status).toBe(404);
  await app.dong();
});

test("bridge subscribe: nguoi_nhan mới → person + consent cho + event dang_ky", async () => {
  const app = await taoServerTam();
  const r = await fetch(`${app.url}/api/nguoi-nhan`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "Sub@X.vn", ten: "Bà Sub", nguon: "form" }),
  });
  expect(r.status).toBe(200);
  const ds = await (await fetch(`${app.url}/api/khach`)).json();
  const khach = ds.du_lieu.find((k: { ten: string }) => k.ten === "Bà Sub");
  expect(khach).toBeTruthy();
  const dd = await (
    await fetch(`${app.url}/api/khach/${khach.id}/dinh-danh`)
  ).json();
  expect(dd.du_lieu[0].loai).toBe("email");
  expect(dd.du_lieu[0].gia_tri_chuan).toBe("sub@x.vn");
  const dy = await (await fetch(`${app.url}/api/khach/${khach.id}/dong-y`)).json();
  expect(dy.du_lieu.hien_tai[0].kenh).toBe("email");
  expect(dy.du_lieu.hien_tai[0].muc_dich).toBe("marketing");
  expect(dy.du_lieu.hien_tai[0].trang_thai).toBe("cho");
  const tl = await (
    await fetch(`${app.url}/api/khach/${khach.id}/timeline`)
  ).json();
  expect(tl.du_lieu.ds_su_kien[0].loai).toBe("dang_ky");
  // Re-add cùng email: da_tao=false → không sinh consent/event lần hai.
  const r2 = await fetch(`${app.url}/api/nguoi-nhan`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "sub@x.vn" }),
  });
  expect((await r2.json()).du_lieu.da_tao).toBe(false);
  const tl2 = await (
    await fetch(`${app.url}/api/khach/${khach.id}/timeline`)
  ).json();
  expect(tl2.du_lieu.tong).toBe(1);
  await app.dong();
});

test("bridge hủy qua link email: consent tu_choi + event huy_dang_ky ngay lập tức", async () => {
  const app = await taoServerTam();
  const them = await fetch(`${app.url}/api/nguoi-nhan`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "huy@x.vn" }),
  });
  const nn = (await them.json()).du_lieu.nguoi_nhan;
  const token = /token=([a-z0-9]+)/.exec(nn.url_huy_dang_ky)![1];
  const res = await fetch(`${app.url}/huy-dang-ky?token=${token}`);
  expect(res.status).toBe(200);
  const ds = await (await fetch(`${app.url}/api/khach`)).json();
  const khach = ds.du_lieu[0];
  const dy = await (
    await fetch(`${app.url}/api/khach/${khach.id}/dong-y`)
  ).json();
  expect(dy.du_lieu.hien_tai[0].trang_thai).toBe("tu_choi");
  const lich = dy.du_lieu.lich_su;
  expect(lich.map((l: { sang_trang_thai: string }) => l.sang_trang_thai)).toEqual([
    "cho",
    "tu_choi",
  ]);
  const tl = await (
    await fetch(`${app.url}/api/khach/${khach.id}/timeline`)
  ).json();
  expect(tl.du_lieu.ds_su_kien.map((s: { loai: string }) => s.loai)).toEqual([
    "dang_ky",
    "huy_dang_ky",
  ]);
  // Suppression nguoi_nhan giữ nguyên — re-add không hồi sinh consent.
  await fetch(`${app.url}/api/nguoi-nhan`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "huy@x.vn" }),
  });
  const dy2 = await (
    await fetch(`${app.url}/api/khach/${khach.id}/dong-y`)
  ).json();
  expect(dy2.du_lieu.hien_tai[0].trang_thai).toBe("tu_choi");
  await app.dong();
});
