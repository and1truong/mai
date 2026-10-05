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

async function datDongY(url: string, khachId: string, trangThai: string) {
  const r = await fetch(`${url}/api/khach/${khachId}/dong-y`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ kenh: "email", muc_dich: "marketing", trang_thai: trangThai, nguon: "test" }),
  });
  return r.status;
}

describe("merge person (#67)", () => {
  test("merge chuyển đủ identity/event/consent/tag/conversion; nguồn da_gop + redirect", async () => {
    const app = await taoServerTam();
    const a = await taoKhach(app.url, "a@x.com");
    const b = await taoKhach(app.url, "b@x.com", { ten: "B" });
    // Identity phụ chỉ ở nguồn → chuyển; consent ở nguồn → chuyển;
    // tag + event + conversion ở nguồn → về đích.
    await post(app.url, `/api/khach/${a}/dinh-danh`, { loai: "sdt", gia_tri: "+84901234567" });
    await datDongY(app.url, a, "cho");
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
    expect(dy.body.du_lieu.hien_tai.length).toBe(1);

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
    // Consent nguồn 'cho' CŨ hơn đích 'tu_choi' — ép cap_nhat_luc trực
    // tiếp qua db (API không nhận timestamp backdate).
    const cu = new Date(Date.now() - 86400000).toISOString();
    await datDongY(app.url, a, "cho");
    await datDongY(app.url, b, "tu_choi");
    app.db.query("UPDATE dong_y SET cap_nhat_luc = ? WHERE khach_id = ?").run(cu, a);

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

    // Tag trùng ở đích với metadata khác → conflict loai 'tag' (không
    // nuốt lặng nguon/tao_luc của nguồn).
    await fetch(`${app.url}/api/khach/${a}/tags`, {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({ them: ["vip"], nguon: "tay" }),
    });
    await fetch(`${app.url}/api/khach/${b}/tags`, {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({ them: ["vip"], nguon: "import" }),
    });
    const pre2 = await gop(app.url, a, b, true);
    const tagXd = pre2.body.du_lieu.xung_dot.find((x: { loai: string }) => x.loai === "tag");
    expect(tagXd.chi_tiet.tag).toBe("vip");
    expect(tagXd.chi_tiet.nguon.nguon).toBe("tay");
    expect(tagXd.chi_tiet.dich.nguon).toBe("import");

    // Merge thật: consent đích giữ 'tu_choi' (mới hơn); tag giữ metadata đích.
    const r = await gop(app.url, a, b);
    expect(r.status).toBe(201);
    const dyB = await get(app.url, `/api/khach/${b}/dong-y`);
    expect(dyB.body.du_lieu.hien_tai[0].trang_thai).toBe("tu_choi");
    // Log consent cả hai giữ lại (re-point sang đích).
    expect(dyB.body.du_lieu.lich_su.length).toBeGreaterThanOrEqual(2);
    const tagB = app.db
      .query("SELECT nguon FROM khach_tag WHERE khach_id = ? AND tag = 'vip'")
      .get(b) as { nguon: string };
    expect(tagB.nguon).toBe("import");
    await app.dong();
  });

  test("first_touch đích giữ mốc sớm hơn; edge 400; chuỗi redirect", async () => {
    const app = await taoServerTam();
    const a = await taoKhach(app.url, "ft1@x.com");
    const b = await taoKhach(app.url, "ft2@x.com");
    const som = "2020-01-01T00:00:00.000Z";
    const muon = "2025-01-01T00:00:00.000Z";
    // su-kien validate ref tồn tại — tạo campaign thật để event mang touch.
    const cp = await post(app.url, "/api/campaign", { loai: "cong_quyen", ten: "CP gộp" });
    const cpId = cp.body.du_lieu.id as string;
    // first_touch nguồn SỚM hơn đích → đích nhận mốc nguồn.
    await post(app.url, "/api/khach/su-kien", {
      dinh_danh: { loai: "email", gia_tri: "ft1@x.com" },
      loai: "click", nguon: "web", khoa_idem: "ft-a",
      xay_ra_luc: som, campaign_id: cpId,
    });
    await post(app.url, "/api/khach/su-kien", {
      dinh_danh: { loai: "email", gia_tri: "ft2@x.com" },
      loai: "click", nguon: "web", khoa_idem: "ft-b",
      xay_ra_luc: muon, campaign_id: cpId,
    });

    const r = await gop(app.url, a, b);
    expect(r.status).toBe(201);
    // dau_cham_dau của đích giờ là mốc 2020 (của nguồn). Endpoint khách
    // không trả first_touch — kiểm qua bảng trực tiếp.
    const row = app.db
      .query("SELECT xay_ra_luc FROM dau_cham_dau WHERE khach_id = ?")
      .get(b) as { xay_ra_luc: string };
    expect(row.xay_ra_luc).toBe(som);

    // Edge: đích/nguồn không tồn tại → 404; chính nó / đã gộp → 400.
    expect((await gop(app.url, a, "khong-co")).status).toBe(404);
    expect((await gop(app.url, "khong-co", b)).status).toBe(404);
    expect((await gop(app.url, a, a)).status).toBe(400);
    // nguồn a đã gộp → gộp tiếp a vào ai đó → 400.
    const c = await taoKhach(app.url, "ft3@x.com");
    expect((await gop(app.url, a, c)).status).toBe(400);
    // merge b→c (chuỗi): redirect a→b→c.
    const r2 = await gop(app.url, b, c);
    expect(r2.status).toBe(201);
    const ka = await get(app.url, `/api/khach/${a}`);
    expect(ka.body.du_lieu.da_gop_vao).toBe(c); // da_gop_vao = đích CUỐI chuỗi a→b→c
    // resolve theo identity của a phải rơi về c (chuỗi).
    const rs = await post(app.url, "/api/khach/su-kien", {
      dinh_danh: { loai: "email", gia_tri: "ft1@x.com" },
      loai: "xem", nguon: "web", khoa_idem: "chain-1",
    });
    expect(rs.body.du_lieu.khach.id).toBe(c);

    // Ghi trực tiếp theo khach_id của person đã gộp → redirect tới đích
    // cuối (invariant: dữ liệu mới luôn vào person đang hoạt động).
    const rsA = await post(app.url, "/api/khach/su-kien", {
      khach_id: a, loai: "xem", nguon: "web", khoa_idem: "chain-2",
    });
    expect(rsA.status).toBe(201);
    expect(rsA.body.du_lieu.khach.id).toBe(c);
    const rTag = await fetch(`${app.url}/api/khach/${a}/tags`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ them: ["sau-gop"], nguon: "tay" }),
    });
    expect(rTag.status).toBe(200);
    const tagC = await get(app.url, `/api/khach/${c}/tags`);
    expect(tagC.body.du_lieu.ds_tag.map((t: { tag: string }) => t.tag)).toContain("sau-gop");
    await app.dong();
  });

  test("merge all-or-nothing: lỗi giữa txn → rollback nguyên trạng", async () => {
    const app = await taoServerTam();
    const a = await taoKhach(app.url, "rb1@x.com");
    const b = await taoKhach(app.url, "rb2@x.com");
    await post(app.url, `/api/khach/${a}/dinh-danh`, { loai: "sdt", gia_tri: "+84900001111" });
    await datDongY(app.url, a, "cho");
    await ghiSuKien(app.url, "rb1@x.com", "click", "rb-1");
    // Ép lỗi: giấu bảng audit khach_gop → INSERT cuối txn hỏng → rollback.
    app.db.run("ALTER TABLE khach_gop RENAME TO khach_gop_x");
    let loi = "";
    try {
      const r = await gop(app.url, a, b);
      loi = `status ${r.status}`;
    } catch (e) {
      loi = String(e);
    } finally {
      app.db.run("ALTER TABLE khach_gop_x RENAME TO khach_gop");
    }
    expect(loi).not.toBe("status 201");
    // Nguồn nguyên trạng: hoat_dong, identity còn, event còn, consent còn.
    const ka = await get(app.url, `/api/khach/${a}`);
    expect(ka.body.du_lieu.trang_thai).toBe("hoat_dong");
    expect(ka.body.du_lieu.da_gop_vao).toBe("");
    expect(ka.body.du_lieu.dinh_danh.length).toBe(2);
    const dyA = await get(app.url, `/api/khach/${a}/dong-y`);
    expect(dyA.body.du_lieu.hien_tai.length).toBe(1);
    const soTt = app.db
      .query("SELECT COUNT(*) AS c FROM tuong_tac WHERE khach_id = ?")
      .get(a) as { c: number };
    expect(soTt.c).toBeGreaterThanOrEqual(1);
    // Đích không nhận gì: không identity lạ, không audit.
    const kb = await get(app.url, `/api/khach/${b}`);
    expect(kb.body.du_lieu.dinh_danh.length).toBe(1);
    const g = await get(app.url, `/api/khach/${b}/gop`);
    expect(g.body.du_lieu.length).toBe(0);
    await app.dong();
  });
});
