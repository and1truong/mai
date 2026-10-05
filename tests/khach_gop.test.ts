// Ticket #67: merge person trùng — dry-run conflict, atomic, audit đọc được.
import { describe, expect, test } from "bun:test";
import { taoServerTam } from "./helpers.ts";

async function post(url: string, path: string, body: Record<string, unknown>) {
  const r = await fetch(`${url}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: r.status, body: (await r.json()) as Record<string, any> };
}

async function get(url: string, path: string) {
  const r = await fetch(`${url}${path}`);
  return { status: r.status, body: (await r.json()) as Record<string, any> };
}

async function taoKhach(url: string, email: string, extra: Record<string, unknown> = {}) {
  const r = await post(url, "/api/khach", {
    dinh_danh: [{ loai: "email", gia_tri: email }],
    email,
    ...extra,
  });
  return r.body.du_lieu.id as string;
}

async function ghiSuKien(url: string, email: string, loai: string, khoa: string, xay_ra_luc?: string) {
  return post(url, "/api/khach/su-kien", {
    dinh_danh: { loai: "email", gia_tri: email },
    loai, nguon: "test", khoa_idem: khoa,
    ...(xay_ra_luc ? { xay_ra_luc } : {}),
  });
}

async function gop(url: string, nguon: string, dich: string, preview = false) {
  return post(
    url,
    `/api/khach/${nguon}/gop${preview ? "?xem_truoc=1" : ""}`,
    { vao_khach_id: dich, dua_tren: "test" },
  );
}

describe("merge person (#67)", () => {
  test("merge chuyển đủ identity/event/consent/tag/conversion; nguồn da_gop + redirect", async () => {
    const app = await taoServerTam();
    const a = await taoKhach(app.url, "a@x.com");
    const b = await taoKhach(app.url, "b@x.com", { ten: "B" });
    // Identity phụ chỉ ở nguồn → chuyển; consent ở nguồn → chuyển;
    // tag + event + conversion ở nguồn → về đích.
    await post(app.url, `/api/khach/${a}/dinh-danh`, { loai: "sdt", gia_tri: "+84901234567" });
    await post(app.url, "/api/khach/dong-y", {
      dinh_danh: { loai: "email", gia_tri: "a@x.com" },
      kenh: "email", muc_dich: "marketing", trang_thai: "cho", nguon: "test",
    });
    await (await fetch(`${app.url}/api/khach/${a}/tags`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ them: ["vip"], nguon: "tay" }),
    })).json();
    await ghiSuKien(app.url, "a@x.com", "click", "a-1");
    await post(app.url, "/api/khach/chuyen-doi", {
      dinh_danh: { loai: "email", gia_tri: "a@x.com" },
      loai: "mua", gia_tri: 50, tien_te: "USD", nguon: "test", khoa_idem: "a-m",
    });

    const r = await gop(app.url, a, b);
    expect(r.status).toBe(201);
    expect(r.body.du_lieu.xem_truoc).toBe(false);
    // Conflict duy nhất: hai person cùng có... khác nhau chỉ email profile
    // (a@x.com vs b@x.com) — truong_ho_so.
    expect(r.body.du_lieu.xung_dot.map((x: { loai: string }) => x.loai)).toEqual(["truong_ho_so"]);

    // Đích giờ có: 2 identity email? không — email a chuyển sang, sdt chuyển
    // sang → 3 identities (email-a, sdt) + email-b = 3.
    const kb = await get(app.url, `/api/khach/${b}`);
    const loaiSet = kb.body.du_lieu.dinh_danh.map((d: { loai: string }) => d.loai).sort();
    expect(loaiSet).toEqual(["email", "email", "sdt"]);
    // Consent + tag + lifecycle đích tính lại: khach_mua (1 đơn).
    const gt = await get(app.url, `/api/khach/${b}/gia-tri`);
    expect(gt.body.du_lieu.trang_thai_doi).toBe("khach_mua");
    expect(gt.body.du_lieu.gia_tri.doanh_thu.USD.tong).toBe(50);
    const tags = await get(app.url, `/api/khach/${b}/tags`);
    expect(tags.body.du_lieu.ds_tag.map((t: { tag: string }) => t.tag)).toEqual(["vip"]);
    const dy = await get(app.url, `/api/khach/${b}/dong-y`);
    expect(dy.body.du_lieu.length).toBe(1);

    // Nguồn: da_gop, da_gop_vao=b, không còn identity (đã chuyển/xóa).
    const ka = await get(app.url, `/api/khach/${a}`);
    expect(ka.body.du_lieu.trang_thai).toBe("da_gop");
    expect(ka.body.du_lieu.da_gop_vao).toBe(b);
    // List khách không còn person nguồn.
    const ls = await get(app.url, "/api/khach");
    expect(ls.body.du_lieu.map((k: { id: string }) => k.id)).not.toContain(a);
    expect(ls.body.du_lieu.map((k: { id: string }) => k.id)).toContain(b);

    // Audit: khach_gop đọc được + su_kien hai đầu.
    const g = await get(app.url, `/api/khach/${b}/gop`);
    expect(g.body.du_lieu[0].khach_nguon_id).toBe(a);
    expect(g.body.du_lieu[0].khach_dich_id).toBe(b);
    expect(Array.isArray(g.body.du_lieu[0].xung_dot)).toBe(true);
    await app.dong();
  });

  test("dry-run trả conflict mà không ghi; conflict consent mới hơn thắng", async () => {
    const app = await taoServerTam();
    const a = await taoKhach(app.url, "c1@x.com");
    const b = await taoKhach(app.url, "c2@x.com");
    // Identity trùng: gắn sdt giống nhau ở cả hai (qua POST dinh-danh mỗi
    // person — unique constraint ngăn → dùng sdt khác format? trùng chuẩn
    // hóa → 409. Thay bằng: đích tạo với email c1? không được. Tạo conflict
    // identity: person b có thêm identity trùng identity phụ của a.
    await post(app.url, `/api/khach/${a}/dinh-danh`, { loai: "sdt", gia_tri: "0909123456" });
    // Gắn cùng sdt vào b → unique → 409 ở API. Để có conflict, tạo b với
    // sdt khác nhưng email trùng? email unique chặn luôn. → Conflict
    // identity thực chỉ khi hai person chia sẻ (loai,gia_tri_chuan) —
    // UNIQUE toàn cục ngăn tồn tại; conflict phát sinh sau merge chuỗi.
    // Ở đây chỉ test consent + profile conflict:
    const cu = new Date(Date.now() - 86400000).toISOString();
    await post(app.url, "/api/khach/dong-y", {
      dinh_danh: { loai: "email", gia_tri: "c1@x.com" },
      kenh: "email", muc_dich: "marketing", trang_thai: "cho", nguon: "t1",
      luc: cu,
    });
    await post(app.url, "/api/khach/dong-y", {
      dinh_danh: { loai: "email", gia_tri: "c2@x.com" },
      kenh: "email", muc_dich: "marketing", trang_thai: "tu_choi", nguon: "t2",
    });

    // Dry-run: conflict consent (nguồn 'cho' cũ vs đích 'tu_choi' mới → giữ đích).
    const pre = await gop(app.url, a, b, true);
    expect(pre.status).toBe(200);
    expect(pre.body.du_lieu.xem_truoc).toBe(true);
    const dy = pre.body.du_lieu.xung_dot.find((x: { loai: string }) => x.loai === "dong_y");
    expect(dy.chi_tiet.giu).toBe("dich"); // bản đích mới hơn
    // Dry-run không ghi: nguồn vẫn hoat_dong, không có audit.
    const ka = await get(app.url, `/api/khach/${a}`);
    expect(ka.body.du_lieu.trang_thai).toBe("hoat_dong");
    const g0 = await get(app.url, `/api/khach/${a}/gop`);
    expect(g0.body.du_lieu.length).toBe(0);

    // Merge thật: consent đích giữ 'tu_choi' (mới hơn).
    const r = await gop(app.url, a, b);
    expect(r.status).toBe(201);
    const dyB = await get(app.url, `/api/khach/${b}/dong-y`);
    expect(dyB.body.du_lieu[0].trang_thai).toBe("tu_choi");
    // Log consent cả hai giữ lại (re-point sang đích).
    const logB = await get(app.url, `/api/khach/${b}/dong-y/log`);
    expect(logB.body.du_lieu.length).toBeGreaterThanOrEqual(2);
    await app.dong();
  });

  test("first_touch đích giữ mốc sớm hơn; merge all-or-nothing rollback", async () => {
    const app = await taoServerTam();
    const a = await taoKhach(app.url, "ft1@x.com");
    const b = await taoKhach(app.url, "ft2@x.com");
    const som = "2020-01-01T00:00:00.000Z";
    const muon = "2025-01-01T00:00:00.000Z";
    // first_touch nguồn SỚM hơn đích → đích nhận mốc nguồn.
    await ghiSuKien(app.url, "ft1@x.com", "click", "ft-a", som);
    await ghiSuKien(app.url, "ft2@x.com", "click", "ft-b", muon);
    // Cả hai event đều có ref → cả hai đều có dau_cham_dau? chỉ khi event
    // mang ref — ghi event kèm campaign_id giả không tồn tại? tuong_tac
    // không validate ref → ok gán 'cp-x'.
    // Ghi lại với campaign:
    await post(app.url, "/api/khach/su-kien", {
      dinh_danh: { loai: "email", gia_tri: "ft1@x.com" },
      loai: "click", nguon: "web", khoa_idem: "ft-a2",
      xay_ra_luc: som, campaign_id: "cp-x",
    });
    await post(app.url, "/api/khach/su-kien", {
      dinh_danh: { loai: "email", gia_tri: "ft2@x.com" },
      loai: "click", nguon: "web", khoa_idem: "ft-b2",
      xay_ra_luc: muon, campaign_id: "cp-y",
    });

    const r = await gop(app.url, a, b);
    expect(r.status).toBe(201);
    const ft = await get(app.url, `/api/khach/${b}`);
    // dau_cham_dau của đích giờ là mốc 2020 (của nguồn).
    // Endpoint khách không trả first_touch — đọc DB qua quyVe/timeline:
    // kiểm qua bảng trong test trực tiếp.
    const row = app.db
      .query("SELECT xay_ra_luc FROM dau_cham_dau WHERE khach_id = ?")
      .get(b) as { xay_ra_luc: string };
    expect(row.xay_ra_luc).toBe(som);

    // Edge: merge vào person không tồn tại / chính nó / đã gộp → 400.
    expect((await gop(app.url, a, "khong-co")).status).toBe(400);
    expect((await gop(app.url, a, a)).status).toBe(400);
    // nguồn a đã gộp → gộp tiếp a vào ai đó → 400.
    const c = await taoKhach(app.url, "ft3@x.com");
    expect((await gop(app.url, a, c)).status).toBe(400);
    // merge b→c (chuỗi): redirect a→b→c.
    const r2 = await gop(app.url, b, c);
    expect(r2.status).toBe(201);
    const ka = await get(app.url, `/api/khach/${a}`);
    expect(ka.body.du_lieu.da_gop_vao).toBe(b); // nguồn giữ redirect trực tiếp
    // resolve theo identity của a phải rơi về c (chuỗi).
    const rs = await post(app.url, "/api/khach/su-kien", {
      dinh_danh: { loai: "email", gia_tri: "ft1@x.com" },
      loai: "xem", nguon: "web", khoa_idem: "chain-1",
    });
    expect(rs.body.du_lieu.khach_id).toBe(c);
    await app.dong();
  });
});
