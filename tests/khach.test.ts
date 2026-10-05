import { expect, test } from "bun:test";
import { taoServerTam } from "./helpers.ts";

// Ticket #60: person + identity — resolve/unique rules, normalize,
// conflict tường minh, không auto-merge.

async function postKhach(url: string, body: unknown) {
  const r = await fetch(`${url}/api/khach`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: r.status, body: await r.json() };
}

test("tạo khách trống: id ổn định, property tùy chọn", async () => {
  const app = await taoServerTam();
  const { status, body } = await postKhach(app.url, { ten: "Bà Lan" });
  expect(status).toBe(201);
  expect(body.ok).toBe(true);
  const khach = body.du_lieu;
  expect(khach.id).toBeTruthy();
  expect(khach.ten).toBe("Bà Lan");
  expect(khach.email).toBe("");
  expect(khach.lan_dau_thay).toBe(khach.lan_cuoi_thay);
  await app.dong();
});

test("resolve theo email: tạo lần đầu rồi tìm lại cùng person", async () => {
  const app = await taoServerTam();
  const lan1 = await postKhach(app.url, {
    ten: "An Ba",
    dinh_danh: [{ loai: "email", gia_tri: "An@Example.COM ", nguon: "form_web" }],
  });
  expect(lan1.status).toBe(201);
  expect(lan1.body.du_lieu.da_tao).toBe(true);
  // Email đã normalize: nhập khác dạng → cùng person.
  const lan2 = await postKhach(app.url, {
    dinh_danh: [{ loai: "email", gia_tri: "an@example.com" }],
  });
  expect(lan2.status).toBe(200);
  expect(lan2.body.du_lieu.da_tao).toBe(false);
  expect(lan2.body.du_lieu.id).toBe(lan1.body.du_lieu.id);
  // Provenance identity giữ nguyên.
  const dd = lan2.body.du_lieu.dinh_danh[0];
  expect(dd.gia_tri_chuan).toBe("an@example.com");
  expect(dd.gia_tri_goc).toBe("An@Example.COM");
  expect(dd.nguon).toBe("form_web");
  await app.dong();
});

test("identity external khóa theo nguồn: hai hệ thống trùng id không đụng nhau", async () => {
  const app = await taoServerTam();
  const a = await postKhach(app.url, {
    dinh_danh: [{ loai: "external", gia_tri: "KH-100", nguon: "shopify" }],
  });
  const b = await postKhach(app.url, {
    dinh_danh: [{ loai: "external", gia_tri: "kh-100", nguon: "woo" }],
  });
  expect(a.status).toBe(201);
  expect(b.status).toBe(201);
  expect(a.body.du_lieu.id).not.toBe(b.body.du_lieu.id);
  // Thiếu nguon với external → 400 (provenance bắt buộc).
  const thieu = await postKhach(app.url, {
    dinh_danh: [{ loai: "external", gia_tri: "X-1" }],
  });
  expect(thieu.status).toBe(400);
  await app.dong();
});

test("gắn identity: thành công, đụng unique của person khác → 409", async () => {
  const app = await taoServerTam();
  const a = await postKhach(app.url, {
    dinh_danh: [{ loai: "email", gia_tri: "a@x.vn" }],
  });
  const b = await postKhach(app.url, { ten: "Người B" });
  const idB = b.body.du_lieu.id;
  // Gắn visitor + sdt vào B thành công.
  for (const dd of [
    { loai: "visitor", gia_tri: "v-abc-1", nguon: "web" },
    { loai: "sdt", gia_tri: "+84 901-234-567", nguon: "form_web" },
  ]) {
    const r = await fetch(`${app.url}/api/khach/${idB}/dinh-danh`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(dd),
    });
    expect(r.status).toBe(201);
  }
  // sdt đã normalize (bỏ khoảng trắng/gạch).
  const ds = await (
    await fetch(`${app.url}/api/khach/${idB}/dinh-danh`)
  ).json();
  expect(ds.du_lieu.map((d: { loai: string }) => d.loai).sort()).toEqual([
    "sdt",
    "visitor",
  ]);
  expect(ds.du_lieu.find((d: { loai: string }) => d.loai === "sdt").gia_tri_chuan).toBe(
    "+84901234567",
  );
  // Gắn email đã thuộc A vào B → 409 XUNG_DOT_DINH_DANH kèm khach_id của A.
  const xung = await fetch(`${app.url}/api/khach/${idB}/dinh-danh`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ loai: "email", gia_tri: "a@x.vn" }),
  });
  expect(xung.status).toBe(409);
  const xb = await xung.json();
  expect(xb.loi.ma).toBe("XUNG_DOT_DINH_DANH");
  expect(xb.loi.chi_tiet.khach_id).toBe(a.body.du_lieu.id);
  await app.dong();
});

test("resolve nhiều identity rải trên hai person → 409, không ghi nửa", async () => {
  const app = await taoServerTam();
  const a = await postKhach(app.url, {
    dinh_danh: [{ loai: "email", gia_tri: "m@x.vn" }],
  });
  const b = await postKhach(app.url, {
    dinh_danh: [{ loai: "sdt", gia_tri: "0901111222" }],
  });
  const r = await postKhach(app.url, {
    dinh_danh: [
      { loai: "email", gia_tri: "m@x.vn" },
      { loai: "sdt", gia_tri: "0901111222" },
    ],
  });
  expect(r.status).toBe(409);
  expect(r.body.loi.ma).toBe("XUNG_DOT_DINH_DANH");
  expect(r.body.loi.chi_tiet.khach_ids).toContain(a.body.du_lieu.id);
  expect(r.body.loi.chi_tiet.khach_ids).toContain(b.body.du_lieu.id);
  await app.dong();
});

test("external khóa theo external_id: cùng id ngoài khác gia_tri vẫn một person", async () => {
  const app = await taoServerTam();
  const a = await postKhach(app.url, {
    dinh_danh: [
      { loai: "external", gia_tri: "Tên hiển thị A", nguon: "shop", external_id: "123" },
    ],
  });
  const b = await postKhach(app.url, {
    dinh_danh: [
      { loai: "external", gia_tri: "Tên hiển thị B", nguon: "shop", external_id: "123" },
    ],
  });
  expect(a.status).toBe(201);
  expect(b.status).toBe(200);
  expect(b.body.du_lieu.id).toBe(a.body.du_lieu.id);
  await app.dong();
});

test("identity trùng khóa trong cùng request: dedupe, không 500", async () => {
  const app = await taoServerTam();
  const r = await postKhach(app.url, {
    dinh_danh: [
      { loai: "email", gia_tri: "z@x.vn" },
      { loai: "email", gia_tri: " z@x.vn " },
    ],
  });
  expect(r.status).toBe(201);
  expect(r.body.du_lieu.dinh_danh).toHaveLength(1);
  await app.dong();
});

test("external_id phân biệt hoa-thường: hai id khác case là hai person", async () => {
  const app = await taoServerTam();
  // Id ngoài là opaque — không được merge ngầm hai id chỉ khác case.
  const a = await postKhach(app.url, {
    dinh_danh: [{ loai: "external", gia_tri: "X", nguon: "shop", external_id: "AbC-9" }],
  });
  const b = await postKhach(app.url, {
    dinh_danh: [{ loai: "external", gia_tri: "Y", nguon: "shop", external_id: "abc-9" }],
  });
  expect(a.status).toBe(201);
  expect(b.status).toBe(201);
  expect(b.body.du_lieu.id).not.toBe(a.body.du_lieu.id);
  await app.dong();
});

test("resolve gắn identity mới vào person có sẵn: ghi su_kien gan_dinh_danh", async () => {
  const app = await taoServerTam();
  const a = await postKhach(app.url, {
    dinh_danh: [{ loai: "email", gia_tri: "audit@x.vn" }],
  });
  const idA = a.body.du_lieu.id;
  await postKhach(app.url, {
    dinh_danh: [
      { loai: "email", gia_tri: "audit@x.vn" },
      { loai: "sdt", gia_tri: "0901222333" },
    ],
  });
  const ds = app.db
    .query("SELECT * FROM su_kien WHERE entity_loai = 'khach' AND entity_id = ? AND su_kien = 'gan_dinh_danh'")
    .all(idA);
  expect(ds.length).toBe(1);
  await app.dong();
});

test("gắn lại identity đã thuộc chính person: trả row cũ, không 409", async () => {
  const app = await taoServerTam();
  const a = await postKhach(app.url, {
    dinh_danh: [{ loai: "email", gia_tri: "goc@x.vn" }],
  });
  const idA = a.body.du_lieu.id;
  const ddGoc = a.body.du_lieu.dinh_danh[0];
  const r = await fetch(`${app.url}/api/khach/${idA}/dinh-danh`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ loai: "email", gia_tri: "goc@x.vn" }),
  });
  expect(r.status).toBe(201);
  const body = await r.json();
  expect(body.du_lieu.id).toBe(ddGoc.id); // row cũ, không tạo bản mới
  const ds = await (
    await fetch(`${app.url}/api/khach/${idA}/dinh-danh`)
  ).json();
  expect(ds.du_lieu).toHaveLength(1);
  await app.dong();
});

test("resolve với identity mới trên person đã có: gắn thêm, không tạo person mới", async () => {
  const app = await taoServerTam();
  const a = await postKhach(app.url, {
    dinh_danh: [{ loai: "email", gia_tri: "them@x.vn" }],
  });
  const idA = a.body.du_lieu.id;
  const r = await postKhach(app.url, {
    dinh_danh: [
      { loai: "email", gia_tri: "them@x.vn" },
      { loai: "visitor", gia_tri: "v-999", nguon: "web" },
    ],
  });
  expect(r.status).toBe(200);
  expect(r.body.du_lieu.id).toBe(idA);
  expect(r.body.du_lieu.dinh_danh).toHaveLength(2);
  // lan_cuoi_thay tăng sau khi gắn identity mới.
  const khach = await (await fetch(`${app.url}/api/khach/${idA}`)).json();
  expect(khach.du_lieu.lan_cuoi_thay >= a.body.du_lieu.lan_cuoi_thay).toBe(true);
  await app.dong();
});

test("validation: loai sai, email sai, gia_tri trống gom một response 400", async () => {
  const app = await taoServerTam();
  const r = await postKhach(app.url, {
    dinh_danh: [
      { loai: "fax", gia_tri: "1" },
      { loai: "email", gia_tri: "khong-phai-email" },
    ],
  });
  expect(r.status).toBe(400);
  expect(r.body.loi.ma).toBe("VALIDATION");
  expect(r.body.loi.chi_tiet.length).toBeGreaterThanOrEqual(2);
  const trong = await postKhach(app.url, { dinh_danh: [{ loai: "email", gia_tri: " " }] });
  expect(trong.status).toBe(400);
  await app.dong();
});
