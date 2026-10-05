// Ticket #68: resolve audience campaign từ segment tại thời điểm gửi —
// gate consent + suppression, snapshot doi_tuong_giao cho audit.
import { describe, expect, test } from "bun:test";
import { duyetBth, taoServerTam } from "./helpers.ts";
import { damBaoAudienceGiao } from "../src/modules/kenh/audience.ts";

type App = Awaited<ReturnType<typeof taoServerTam>>;

async function post(app: App, path: string, body: Record<string, unknown>) {
  const r = await fetch(`${app.url}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: r.status, body: (await r.json()) as Record<string, any> };
}

async function put(app: App, path: string, body: Record<string, unknown>) {
  const r = await fetch(`${app.url}${path}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: r.status };
}

async function get(app: App, path: string) {
  const r = await fetch(`${app.url}${path}`);
  return { status: r.status, body: (await r.json()) as Record<string, any> };
}

async function choGiaoKetThuc(app: App, giaoId: string): Promise<string> {
  for (let i = 0; i < 300; i++) {
    const { body } = await get(app, `/api/giao-hang/${giaoId}`);
    const tt = body.du_lieu.trang_thai as string;
    if (tt !== "cho_giao") return tt;
    await Bun.sleep(15);
  }
  throw new Error("giao không xong");
}

// Mock provider tương thích Resend — giống tests/kenh.test.ts.
function taoProviderGia() {
  const dsReq: { key: string; body: Record<string, unknown>; auth: string | null }[] = [];
  const bienNhan = new Map<string, string>();
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/emails" && req.method === "POST") {
        const body = (await req.json()) as Record<string, unknown>;
        const key = String(req.headers.get("idempotency-key") ?? "");
        if (!bienNhan.has(key)) bienNhan.set(key, `re_${bienNhan.size + 1}`);
        dsReq.push({ key, body, auth: req.headers.get("authorization") });
        return Response.json({ id: bienNhan.get(key)! });
      }
      return new Response("not found", { status: 404 });
    },
  });
  return { url: `http://localhost:${server.port}`, dsReq, dung: () => server.stop() };
}

const BIEN_EMAIL = [
  "MAI_EMAIL_BASE_URL",
  "MAI_EMAIL_API_KEY_ENV",
  "MAI_EMAIL_FROM",
  "MAI_EMAIL_NGUOI_NHAN_TEST",
  "MAI_KENH_URL_GOC",
  "MAI_TEST_EMAIL_KEY",
];

function donBienEmail() {
  for (const k of BIEN_EMAIL) delete Bun.env[k];
}

// Env phải set trước khi server boot — cấu hình kênh đọc lúc start.
function cauHinhEmail() {
  const provider = taoProviderGia();
  Bun.env.MAI_EMAIL_BASE_URL = provider.url;
  Bun.env.MAI_EMAIL_API_KEY_ENV = "MAI_TEST_EMAIL_KEY";
  Bun.env.MAI_TEST_EMAIL_KEY = "gia-lap-key-123";
  Bun.env.MAI_EMAIL_FROM = "Mai <bao@example.com>";
  return provider;
}

// Person mới (email identity) + tag + tùy chọn consent.
async function taoKhachTag(app: App, email: string, consent?: string) {
  const r = await post(app, "/api/khach", {
    dinh_danh: [{ loai: "email", gia_tri: email }],
    email,
  });
  const id = r.body.du_lieu.id as string;
  await put(app, `/api/khach/${id}/tags`, { them: ["aud68"], nguon: "tay" });
  if (consent) {
    await put(app, `/api/khach/${id}/dong-y`, {
      kenh: "email", muc_dich: "marketing", trang_thai: consent, nguon: "test",
    });
  }
  return id;
}

// Campaign gắn segment 'aud68' → thông điệp → bth newsletter đã duyệt.
async function chuanBiCampaign(app: App): Promise<{ cpId: string; bthId: string }> {
  const seg = await post(app, "/api/segment", {
    ten: "aud68",
    quy_tac: { all: [{ co_tag: "aud68" }] },
  });
  expect(seg.status).toBe(201);
  const segId = seg.body.du_lieu.id as string;
  const cp = await post(app, "/api/campaign", {
    loai: "phat_hanh", ten: "CP audience 68", segment_id: segId,
  });
  expect(cp.status).toBe(201);
  const cpId = cp.body.du_lieu.id as string;
  const td = await post(app, "/api/thong-diep", {
    tieu_de: "TD audience", campaign_id: cpId,
  });
  const tdId = td.body.du_lieu.id as string;
  const bth = await post(app, "/api/ban-the-hien", {
    thong_diep_id: tdId, dinh_dang: "newsletter",
  });
  const bthId = bth.body.du_lieu.id as string;
  await post(app, `/api/ban-the-hien/${bthId}/revision`, {
    noi_dung: JSON.stringify({
      tieu_de: "Bản tin test",
      tom_tat: "tóm tắt",
      noi_dung: "Nội dung bản tin.",
    }),
  });
  const r = await duyetBth(app, bthId);
  expect(r.duyet.status).toBe(200);
  return { cpId, bthId };
}

describe("resolve audience từ segment (#68)", () => {
  test("resolve tại thời điểm gửi + gate consent/suppression + snapshot audit", async () => {
    donBienEmail();
    const provider = cauHinhEmail();
    const app = await taoServerTam();
    Bun.env.MAI_KENH_URL_GOC = app.url;
    try {
      const { bthId } = await chuanBiCampaign(app);

      // A: email + consent 'cho' → gửi.
      const a = await taoKhachTag(app, "a68@x.com", "cho");
      // B: email, không consent → bo_qua khong_consent.
      await taoKhachTag(app, "b68@x.com");
      // C: email + consent 'cho' + nguoi_nhan huy_dang_ky → bo_qua
      // huy_dang_ky (suppression thắng consent).
      const c = await taoKhachTag(app, "c68@x.com", "cho");
      const nn = await post(app, "/api/nguoi-nhan", { email: "c68@x.com" });
      const nnId = nn.body.du_lieu.nguoi_nhan.id;
      await post(app, `/api/nguoi-nhan/${nnId}/huy-dang-ky`, {});
      // đặt lại consent 'cho' để chỉ suppression chặn C.
      await put(app, `/api/khach/${c}/dong-y`, {
        kenh: "email", muc_dich: "marketing", trang_thai: "cho", nguon: "test",
      });
      // D: chỉ identity sdt + tag → bo_qua khong_dinh_danh.
      const d = await post(app, "/api/khach", {
        dinh_danh: [{ loai: "sdt", gia_tri: "+84981112222" }],
      });
      await put(app, `/api/khach/${d.body.du_lieu.id}/tags`, { them: ["aud68"], nguon: "tay" });
      // E: email + consent 'cho' nhưng KHÔNG tag → ngoài segment.
      const e = await post(app, "/api/khach", {
        dinh_danh: [{ loai: "email", gia_tri: "e68@x.com" }],
        email: "e68@x.com",
      });
      await put(app, `/api/khach/${e.body.du_lieu.id}/dong-y`, {
        kenh: "email", muc_dich: "marketing", trang_thai: "cho", nguon: "test",
      });

      const tao = await post(app, `/api/ban-the-hien/${bthId}/giao`, { kenh: "email" });
      expect(tao.status).toBe(200);
      const giaoId = tao.body.du_lieu.giao.id as string;
      expect(await choGiaoKetThuc(app, giaoId)).toBe("chap_nhan");

      // Chỉ A nhận — B/C/D bị gate; E ngoài segment không xuất hiện.
      expect(provider.dsReq.length).toBe(1);
      expect((provider.dsReq[0]!.body.to as string[])[0]).toBe("a68@x.com");

      // Snapshot audit: đúng 4 dòng với quyet_dinh/ly_do.
      const rows = app.db
        .query("SELECT khach_id, quyet_dinh, ly_do FROM doi_tuong_giao WHERE giao_hang_id = ? ORDER BY rowid")
        .all(giaoId) as { khach_id: string; quyet_dinh: string; ly_do: string }[];
      expect(rows.length).toBe(4);
      const theoId = new Map(rows.map((r) => [r.khach_id, r]));
      expect(theoId.get(a)).toMatchObject({ quyet_dinh: "gui" });
      expect(theoId.get(c)).toMatchObject({ quyet_dinh: "bo_qua", ly_do: "huy_dang_ky" });
      expect(theoId.get(d.body.du_lieu.id)).toMatchObject({
        quyet_dinh: "bo_qua", ly_do: "khong_dinh_danh",
      });
      const b = rows.find((r) => r.ly_do === "khong_consent");
      expect(b).toBeTruthy();

      // Counter trên giao_hang khớp snapshot.
      const g = await get(app, `/api/giao-hang/${giaoId}`);
      expect(g.body.du_lieu.so_nguoi_nhan).toBe(1);
      expect(g.body.du_lieu.so_bo_qua).toBe(3);
    } finally {
      provider.dung();
      await app.dong();
    }
  });

  test("rút consent giữa lúc tạo và lúc gửi → không nhận", async () => {
    donBienEmail();
    const provider = cauHinhEmail();
    const app = await taoServerTam();
    Bun.env.MAI_KENH_URL_GOC = app.url;
    try {
      const { bthId } = await chuanBiCampaign(app);
      const f = await taoKhachTag(app, "f68@x.com", "cho");

      // Lên lịch giao 150ms nữa — rút consent trong khoảng chờ.
      const lenLich = new Date(Date.now() + 150).toISOString();
      const tao = await post(app, `/api/ban-the-hien/${bthId}/giao`, {
        kenh: "email", len_lich_luc: lenLich, mui_gio: "UTC",
      });
      expect(tao.status).toBe(200);
      const giaoId = tao.body.du_lieu.giao.id as string;
      await put(app, `/api/khach/${f}/dong-y`, {
        kenh: "email", muc_dich: "marketing", trang_thai: "tu_choi", nguon: "test",
      });

      const tt = await choGiaoKetThuc(app, giaoId);
      // Resolve lúc gửi thấy tu_choi → toàn bộ bo_qua → không gửi ai;
      // adapter báo không có người nhận → giao 'loi' (không 'chap_nhan').
      expect(tt).toBe("loi");
      expect(provider.dsReq.length).toBe(0);
      const rows = app.db
        .query("SELECT quyet_dinh, ly_do FROM doi_tuong_giao WHERE giao_hang_id = ?")
        .all(giaoId) as { quyet_dinh: string; ly_do: string }[];
      expect(rows.length).toBe(1);
      expect(rows[0]).toEqual({ quyet_dinh: "bo_qua", ly_do: "khong_consent" });
      // Lỗi toàn-gate vẫn báo counter đúng (resolve đã ghi), không để 0.
      const g = await get(app, `/api/giao-hang/${giaoId}`);
      expect(g.body.du_lieu.so_nguoi_nhan).toBe(0);
      expect(g.body.du_lieu.so_bo_qua).toBe(1);
    } finally {
      provider.dung();
      await app.dong();
    }
  });

  test("snapshot 'gui' nhưng hủy đăng ký sau resolve → chặn ngay trước gửi", async () => {
    donBienEmail();
    const provider = cauHinhEmail();
    const app = await taoServerTam();
    Bun.env.MAI_KENH_URL_GOC = app.url;
    try {
      const { bthId } = await chuanBiCampaign(app);
      const g = await taoKhachTag(app, "g68@x.com", "cho");
      // nguoi_nhan đang đăng ký → resolve sẽ quyết định 'gui'.
      const nn = await post(app, "/api/nguoi-nhan", { email: "g68@x.com" });
      const nnId = nn.body.du_lieu.nguoi_nhan.id;

      // Lên lịch trễ để kịp ghi snapshot rồi mới hủy đăng ký.
      const lenLich = new Date(Date.now() + 200).toISOString();
      const tao = await post(app, `/api/ban-the-hien/${bthId}/giao`, {
        kenh: "email", len_lich_luc: lenLich, mui_gio: "UTC",
      });
      const giaoId = tao.body.du_lieu.giao.id as string;
      const segId = (
        app.db.query("SELECT segment_id FROM campaign ORDER BY rowid DESC LIMIT 1").get() as {
          segment_id: string;
        }
      ).segment_id;
      const aud = damBaoAudienceGiao(app.db, giaoId, segId, "email", app.url);
      expect(aud!.ds_gui.length).toBe(1);

      // Suppression xảy ra SAU snapshot → delivery boundary vẫn chặn.
      await post(app, `/api/nguoi-nhan/${nnId}/huy-dang-ky`, {});
      expect(await choGiaoKetThuc(app, giaoId)).toBe("chap_nhan");
      expect(provider.dsReq.length).toBe(0);

      const giao = await get(app, `/api/giao-hang/${giaoId}`);
      const dl = giao.body.du_lieu;
      // Snapshot audit giữ nguyên quyết định resolve-time 'gui'.
      expect(dl.doi_tuong.length).toBe(1);
      expect(dl.doi_tuong[0].quyet_dinh).toBe("gui");
      // Lần giao đếm skip thực tế; chi_tiet ghi lý do chặn lúc gửi.
      expect(dl.so_nguoi_nhan).toBe(0);
      expect(dl.so_bo_qua).toBe(1);
      expect(dl.chi_tiet.bo_qua_gui[g]).toBe("huy_dang_ky");
    } finally {
      provider.dung();
      await app.dong();
    }
  });

  test("chưa qua duyệt → không resolve, không gửi (approval #13 giữ nguyên)", async () => {
    donBienEmail();
    const provider = cauHinhEmail();
    const app = await taoServerTam();
    Bun.env.MAI_KENH_URL_GOC = app.url;
    try {
      // Campaign segment + td + bth nháp — KHÔNG duyệt.
      const seg = await post(app, "/api/segment", {
        ten: "aud68-nhap", quy_tac: { all: [{ co_tag: "aud68" }] },
      });
      const cp = await post(app, "/api/campaign", {
        loai: "phat_hanh", ten: "CP nháp", segment_id: seg.body.du_lieu.id,
      });
      const td = await post(app, "/api/thong-diep", {
        tieu_de: "TD nháp", campaign_id: cp.body.du_lieu.id,
      });
      const bth = await post(app, "/api/ban-the-hien", {
        thong_diep_id: td.body.du_lieu.id, dinh_dang: "newsletter",
      });
      const bthId = bth.body.du_lieu.id as string;
      await post(app, `/api/ban-the-hien/${bthId}/revision`, {
        noi_dung: JSON.stringify({ tieu_de: "T", noi_dung: "N." }),
      });
      await taoKhachTag(app, "h68@x.com", "cho");
      // Chưa duyệt → giao bị chặn ngay tại tạo, không resolve/snapshot.
      const tao = await post(app, `/api/ban-the-hien/${bthId}/giao`, { kenh: "email" });
      expect(tao.status).toBe(409);
      expect(provider.dsReq.length).toBe(0);
      expect(
        (app.db
          .query("SELECT COUNT(*) AS c FROM doi_tuong_giao")
          .get() as { c: number }).c,
      ).toBe(0);
    } finally {
      provider.dung();
      await app.dong();
    }
  });
});
