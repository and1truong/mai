import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { layBanTheHien, themRevision } from "../src/modules/content/index.ts";
import { taoTaiKhoan, type VaiTro } from "../src/modules/xac_thuc/index.ts";
import { seed } from "../src/server/seed.ts";
import { startServer } from "../src/server/index.ts";
import { taoServerTam } from "./helpers.ts";

// Test access control instance (#16): hai chế độ tin_cay / bao_ve, phiên
// cookie, phân quyền quan_tri/bien_tap, actor audit, route public và
// khả năng đọc dữ liệu POC cũ sau khi bật bảo vệ.

type App = Awaited<ReturnType<typeof startServer>> & { dataDir: string };

const MK_ADMIN = "mk-admin-test-1";
const MK_BT = "mk-bt-test-1";

function taoTk(app: App, ten: string, vaiTro: VaiTro, matKhau: string) {
  return taoTaiKhoan(
    app.db,
    { ten_dang_nhap: ten, ten_hien_thi: ten, vai_tro: vaiTro, mat_khau: matKhau },
    "test",
  );
}

function dangNhapApi(app: App, ten_dang_nhap: string, mat_khau: string) {
  return fetch(`${app.url}/api/dang-nhap`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ten_dang_nhap, mat_khau }),
  });
}

function layToken(res: Response): string {
  return /mai_phien=([^;]+)/.exec(res.headers.get("set-cookie") ?? "")?.[1] ?? "";
}

// fetch /api/* kèm cookie phiên khi có.
function api(
  app: App,
  path: string,
  tuyChon: { method?: string; token?: string; body?: unknown } = {},
) {
  const headers: Record<string, string> = {};
  if (tuyChon.token) headers.cookie = `mai_phien=${tuyChon.token}`;
  if (tuyChon.body !== undefined) headers["content-type"] = "application/json";
  return fetch(`${app.url}${path}`, {
    method: tuyChon.method ?? "GET",
    headers,
    body: tuyChon.body === undefined ? undefined : JSON.stringify(tuyChon.body),
  });
}

const apiJ = async (...a: Parameters<typeof api>) => (await api(...a)).json();

async function appBaoVe(dataDir?: string): Promise<App> {
  const dir = dataDir ?? mkdtempSync(join(tmpdir(), "mai-test-bv-"));
  const app = await startServer({
    port: 0,
    dataDir: dir,
    chuKyJobMs: 10,
    bao_mat: { che_do: "bao_ve" },
  });
  return { ...app, dataDir: dir };
}

describe("chế độ tin_cay: API mở, không cần phiên", () => {
  let app: App;
  beforeAll(async () => {
    app = await taoServerTam();
  });
  afterAll(async () => {
    await app.dong();
  });

  test("API dùng trực tiếp không cần cookie; me báo chế độ tin_cay", async () => {
    expect((await api(app, "/api/nguon")).status).toBe(200);
    expect((await api(app, "/api/health")).status).toBe(200);
    const me = await apiJ(app, "/api/tai-khoan/me");
    expect(me.du_lieu.che_do).toBe("tin_cay");
    expect(me.du_lieu.tai_khoan).toBeNull();
  });

  test("đăng nhập/đăng xuất báo rõ không cần thiết", async () => {
    const dn = await dangNhapApi(app, "admin", MK_ADMIN);
    expect(dn.status).toBe(400);
    expect((await dn.json()).loi.ma).toBe("VALIDATION");
    expect((await api(app, "/api/dang-xuat", { method: "POST" })).status).toBe(400);
  });

  test("chủ instance tạo sẵn tài khoản được trước khi bật bảo vệ", async () => {
    const res = await api(app, "/api/tai-khoan", {
      method: "POST",
      body: {
        ten_dang_nhap: "operator",
        ten_hien_thi: "Chủ instance",
        vai_tro: "quan_tri",
        mat_khau: MK_ADMIN,
      },
    });
    expect(res.status).toBe(201);
    const tk = (await res.json()).du_lieu;
    expect(tk.vai_tro).toBe("quan_tri");
    expect(JSON.stringify(tk)).not.toContain("hash_mat_khau");
  });
});

describe("chế độ bao_ve: cổng đăng nhập và phiên", () => {
  let app: App;
  beforeAll(async () => {
    app = await appBaoVe();
  });
  afterAll(async () => {
    await app.dong();
  });

  test("mọi /api/* trừ đăng nhập + me đòi phiên — kể cả health", async () => {
    for (const p of ["/api/nguon", "/api/campaign", "/api/health", "/api/tong-quan"]) {
      const res = await api(app, p);
      expect(res.status).toBe(401);
      expect((await res.json()).loi.ma).toBe("CHUA_DANG_NHAP");
    }
    expect((await api(app, "/api/tai-khoan", { method: "POST", body: {} })).status).toBe(401);
    const me = await apiJ(app, "/api/tai-khoan/me");
    expect(me.du_lieu.che_do).toBe("bao_ve");
    expect(me.du_lieu.tai_khoan).toBeNull();
  });

  test("đăng nhập sai/không có tài khoản → 401; đúng → cookie dùng được", async () => {
    const thieu = await api(app, "/api/dang-nhap", { method: "POST", body: {} });
    expect(thieu.status).toBe(400);
    const khongCo = await dangNhapApi(app, "khong-co", MK_ADMIN);
    expect(khongCo.status).toBe(401);
    expect((await khongCo.json()).loi.ma).toBe("SAI_THONG_TIN_DANG_NHAP");

    const admin = await taoTk(app, "admin", "quan_tri", MK_ADMIN);
    const sai = await dangNhapApi(app, "admin", "sai-mat-khau-123");
    expect(sai.status).toBe(401);

    const dn = await dangNhapApi(app, "admin", MK_ADMIN);
    expect(dn.status).toBe(200);
    const token = layToken(dn);
    expect(token).not.toBe("");
    const tk = (await dn.json()).du_lieu.tai_khoan;
    expect(tk.id).toBe(admin.id);
    expect(JSON.stringify(tk)).not.toContain("hash_mat_khau");

    // Cookie mở được API; ten_dang_nhap không phân biệt hoa thường.
    expect((await api(app, "/api/nguon", { token })).status).toBe(200);
    const me = await apiJ(app, "/api/tai-khoan/me", { token });
    expect(me.du_lieu.tai_khoan.id).toBe(admin.id);
    expect((await dangNhapApi(app, "ADMIN", MK_ADMIN)).status).toBe(200);
  });

  test("secret không lộ: DB lưu hash, API không trả hash, sự kiện sạch", async () => {
    const dn = await dangNhapApi(app, "admin", MK_ADMIN);
    const token = layToken(dn);
    const row = app.db
      .query("SELECT hash_mat_khau FROM tai_khoan WHERE ten_dang_nhap = 'admin'")
      .get() as { hash_mat_khau: string };
    expect(row.hash_mat_khau).toStartWith("$argon2id$");
    expect(row.hash_mat_khau).not.toContain(MK_ADMIN);
    const phien = app.db
      .query("SELECT token_hash FROM phien_dang_nhap ORDER BY tao_luc DESC LIMIT 1")
      .get() as { token_hash: string };
    expect(phien.token_hash).not.toBe(token);

    const ds = await apiJ(app, "/api/tai-khoan", { token });
    expect(JSON.stringify(ds.du_lieu)).not.toContain("hash_mat_khau");
    const sk = await apiJ(app, "/api/su-kien", { token });
    expect(JSON.stringify(sk.du_lieu)).not.toContain("hash_mat_khau");
    expect(JSON.stringify(sk.du_lieu)).not.toContain(MK_ADMIN);
  });

  test("đăng xuất kết thúc phiên; phiên hết hạn bị từ chối", async () => {
    const dn = await dangNhapApi(app, "admin", MK_ADMIN);
    const token = layToken(dn);
    const dx = await api(app, "/api/dang-xuat", { method: "POST", token });
    expect(dx.status).toBe(200);
    expect(dx.headers.get("set-cookie")).toContain("mai_phien=");
    // Token cũ tái sử dụng → 401.
    expect((await api(app, "/api/nguon", { token })).status).toBe(401);

    const dn2 = await dangNhapApi(app, "admin", MK_ADMIN);
    const token2 = layToken(dn2);
    app.db.query("UPDATE phien_dang_nhap SET het_han_luc = '2000-01-01T00:00:00.000Z'").run();
    expect((await api(app, "/api/nguon", { token: token2 })).status).toBe(401);
  });
});

describe("chế độ bao_ve: phân quyền quan_tri / bien_tap", () => {
  let app: App;
  let admin: { id: string };
  let bt: { id: string };
  let tokenAdmin: string;
  let tokenBt: string;
  beforeAll(async () => {
    app = await appBaoVe();
    admin = await taoTk(app, "admin", "quan_tri", MK_ADMIN);
    bt = await taoTk(app, "bien-tap", "bien_tap", MK_BT);
    tokenAdmin = layToken(await dangNhapApi(app, "admin", MK_ADMIN));
    tokenBt = layToken(await dangNhapApi(app, "bien-tap", MK_BT));
  });
  afterAll(async () => {
    await app.dong();
  });

  test("biên tập đọc + tạo nội dung được; actor audit là id tài khoản", async () => {
    expect((await api(app, "/api/nguon", { token: tokenBt })).status).toBe(200);
    const res = await api(app, "/api/nguon", {
      method: "POST",
      token: tokenBt,
      body: { tieu_de: "Nguồn test biên tập", noi_dung: "nội dung" },
    });
    expect(res.status).toBe(201);
    const nguon = (await res.json()).du_lieu;
    expect(nguon.tao_boi).toBe(bt.id);
    // Sự kiện audit ghi actor tài khoản, không phải 'demo'.
    const sk = app.db
      .query("SELECT actor FROM su_kien WHERE entity_loai = 'nguon' AND su_kien = 'tao' ORDER BY tao_luc DESC LIMIT 1")
      .get() as { actor: string };
    expect(sk.actor).toBe(bt.id);
  });

  test("biên tập không đụng tài khoản/credential admin qua API trực tiếp", async () => {
    expect((await api(app, "/api/tai-khoan", { token: tokenBt })).status).toBe(403);
    for (const res of [
      await api(app, "/api/tai-khoan", {
        method: "POST",
        token: tokenBt,
        body: { ten_dang_nhap: "x", mat_khau: "x-x-x-x-x-x-x-x" },
      }),
      await api(app, `/api/tai-khoan/${admin.id}`, {
        method: "PUT",
        token: tokenBt,
        body: { vai_tro: "bien_tap" },
      }),
      await api(app, `/api/tai-khoan/${admin.id}/mat-khau`, {
        method: "POST",
        token: tokenBt,
        body: { mat_khau_moi: "mk-moi-12345" },
      }),
    ]) {
      expect(res.status).toBe(403);
      expect((await res.json()).loi.ma).toBe("KHONG_CO_QUYEN");
    }
  });

  test("đổi mật khẩu: chính mình cần mật khẩu cũ; phiên cũ chết ngay", async () => {
    const thieuCu = await api(app, `/api/tai-khoan/${bt.id}/mat-khau`, {
      method: "POST",
      token: tokenBt,
      body: { mat_khau_moi: "mk-moi-99999" },
    });
    expect(thieuCu.status).toBe(400);
    const saiCu = await api(app, `/api/tai-khoan/${bt.id}/mat-khau`, {
      method: "POST",
      token: tokenBt,
      body: { mat_khau_cu: "sai-12345", mat_khau_moi: "mk-moi-99999" },
    });
    expect(saiCu.status).toBe(401);
    const dung = await api(app, `/api/tai-khoan/${bt.id}/mat-khau`, {
      method: "POST",
      token: tokenBt,
      body: { mat_khau_cu: MK_BT, mat_khau_moi: "mk-moi-99999" },
    });
    expect(dung.status).toBe(200);
    // Đổi mật khẩu thu hồi toàn bộ phiên của tài khoản đó.
    expect((await api(app, "/api/tai-khoan/me", { token: tokenBt })).status).toBe(200);
    // me công khai nên 200 nhưng tai_khoan phải null → phiên đã chết.
    const me = await apiJ(app, "/api/tai-khoan/me", { token: tokenBt });
    expect(me.du_lieu.tai_khoan).toBeNull();
    expect((await api(app, "/api/nguon", { token: tokenBt })).status).toBe(401);
    expect((await dangNhapApi(app, "bien-tap", "mk-moi-99999")).status).toBe(200);

    // Admin reset mật khẩu người khác không cần mật khẩu cũ.
    const reset = await api(app, `/api/tai-khoan/${bt.id}/mat-khau`, {
      method: "POST",
      token: tokenAdmin,
      body: { mat_khau_moi: MK_BT },
    });
    expect(reset.status).toBe(200);
    tokenBt = layToken(await dangNhapApi(app, "bien-tap", MK_BT));
  });

  test("admin không tự giáng quyền/tự vô hiệu; vô hiệu tài khoản giết phiên", async () => {
    const tuHuy = await api(app, `/api/tai-khoan/${admin.id}`, {
      method: "PUT",
      token: tokenAdmin,
      body: { vai_tro: "bien_tap" },
    });
    expect(tuHuy.status).toBe(400);
    const tuVoHieu = await api(app, `/api/tai-khoan/${admin.id}`, {
      method: "PUT",
      token: tokenAdmin,
      body: { trang_thai: "vo_hieu" },
    });
    expect(tuVoHieu.status).toBe(400);

    const bt2 = await taoTk(app, "bien-tap-2", "bien_tap", MK_BT);
    const tokenBt2 = layToken(await dangNhapApi(app, "bien-tap-2", MK_BT));
    expect((await api(app, "/api/nguon", { token: tokenBt2 })).status).toBe(200);
    const vh = await api(app, `/api/tai-khoan/${bt2.id}`, {
      method: "PUT",
      token: tokenAdmin,
      body: { trang_thai: "vo_hieu" },
    });
    expect(vh.status).toBe(200);
    expect((await api(app, "/api/nguon", { token: tokenBt2 })).status).toBe(401);
    expect((await dangNhapApi(app, "bien-tap-2", MK_BT)).status).toBe(401);
  });

  test("xóa campaign ghi actor tài khoản — bypass demo đã bị gỡ", async () => {
    const cp = await apiJ(app, "/api/campaign", {
      method: "POST",
      token: tokenAdmin,
      body: { ten: "Campaign xóa test" },
    });
    const xoa = await api(app, `/api/campaign/${cp.du_lieu.id}`, {
      method: "DELETE",
      token: tokenAdmin,
    });
    expect(xoa.status).toBe(200);
    const sk = app.db
      .query("SELECT actor FROM su_kien WHERE entity_loai = 'campaign' AND su_kien = 'xoa' ORDER BY tao_luc DESC LIMIT 1")
      .get() as { actor: string };
    expect(sk.actor).toBe(admin.id);
  });
});

describe("bao_ve trên data POC cũ: public route mở, nội dung riêng không rò", () => {
  let dataDir: string;
  let appTinCay: App;
  let app: App;
  let admin: { id: string };
  let tokenAdmin: string;

  beforeAll(async () => {
    // Phase A: instance tin_cay có data POC (seed) — một bài đã xuất bản.
    appTinCay = await taoServerTam();
    dataDir = appTinCay.dataDir;
    seed(appTinCay.db);
    // Revision chưa duyệt chứa nội dung riêng — trang /p không được lộ.
    const baiViet = layBanTheHien(appTinCay.db, "seed-bth-retry-bai-viet")!;
    themRevision(
      appTinCay.db,
      {
        ban_the_hien_id: baiViet.id,
        noi_dung: JSON.stringify({
          tieu_de: "GHICHU-RIENG-TU-XYZ",
          noi_dung: "Nội dung nháp chưa duyệt GHICHU-RIENG-TU-XYZ.",
        }),
        dua_tren_revision_id: baiViet.head_revision_id,
      },
      "demo",
    );
    await appTinCay.dong();

    // Phase B: cùng dataDir, bật bảo vệ + tạo admin như setup script.
    app = await appBaoVe(dataDir);
    admin = await taoTk(app, "admin", "quan_tri", MK_ADMIN);
    tokenAdmin = layToken(await dangNhapApi(app, "admin", MK_ADMIN));
  });
  afterAll(async () => {
    await app.dong();
  });

  test("route cố ý public vẫn mở mà không cần đăng nhập", async () => {
    // Trang /p/<bth> render ngoài /api — giữ public theo thiết kế.
    const trang = await fetch(`${app.url}/p/seed-bth-retry-bai-viet`);
    expect(trang.status).toBe(200);
    const html = await trang.text();
    expect(html).toContain("Retry amplification");
    // Bản chưa duyệt không lộ: trang ghim đúng revision đã xuất bản.
    expect(html).not.toContain("GHICHU-RIENG-TU-XYZ");

    // /huy-dang-ky và /l/<token> cũng public — tới handler, không 401.
    const huy = await fetch(`${app.url}/huy-dang-ky?token=sai`);
    expect(huy.status).not.toBe(401);
    const link = await fetch(`${app.url}/l/khong-ton-tai`);
    expect(link.status).not.toBe(401);
  });

  test("dữ liệu POC cũ vẫn đọc được sau khi đăng nhập", async () => {
    expect((await api(app, "/api/nguon")).status).toBe(401);
    const ds = await apiJ(app, "/api/nguon", { token: tokenAdmin });
    expect(ds.du_lieu.length).toBeGreaterThan(0);
    expect(ds.du_lieu.some((n: { id: string }) => n.id === "seed-nguon-1")).toBe(true);
  });

  test("nguoi_duyet_id phải map tài khoản hoạt động của instance", async () => {
    // 'nd-lan' có trong ds_nguoi_duyet của campaign công quyền nhưng không
    // phải tài khoản → 400; 'nd-hung' vừa tạo tài khoản → qua được gate này.
    const bth = "seed-bth-cq-nha-thau";
    const gui = await api(app, `/api/ban-the-hien/${bth}/trang-thai`, {
      method: "POST",
      token: tokenAdmin,
      body: { trang_thai: "cho_duyet" },
    });
    expect(gui.status).toBe(200);
    const head = layBanTheHien(app.db, bth)!.head_revision_id;
    const khongThat = await api(app, `/api/ban-the-hien/${bth}/trang-thai`, {
      method: "POST",
      token: tokenAdmin,
      body: { trang_thai: "da_duyet", mong_doi_revision_id: head, nguoi_duyet_id: "nd-lan" },
    });
    expect(khongThat.status).toBe(400);
    expect((await khongThat.json()).loi.thong_diep).toContain("không phải tài khoản");

    await api(app, "/api/tai-khoan", {
      method: "POST",
      token: tokenAdmin,
      body: {
        ten_dang_nhap: "nd-hung",
        ten_hien_thi: "Trần Minh Hùng",
        vai_tro: "bien_tap",
        mat_khau: MK_BT,
      },
    });
    const duyet = await api(app, `/api/ban-the-hien/${bth}/trang-thai`, {
      method: "POST",
      token: tokenAdmin,
      body: { trang_thai: "da_duyet", mong_doi_revision_id: head, nguoi_duyet_id: "nd-hung" },
    });
    expect(duyet.status).toBe(200);
  });
});
