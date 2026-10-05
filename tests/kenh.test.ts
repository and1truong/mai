import { describe, expect, test } from "bun:test";
import { duyetBth, taoServerTam } from "./helpers.ts";
import { seed } from "../src/server/seed.ts";
import { themRevision } from "../src/modules/content/index.ts";

// Kênh sở hữu (#13): catalog adapter theo năng lực, xem trước, giao qua
// job bền (trang nội bộ / email provider tương thích Resend), dry-run,
// xuất tay, lên lịch + hủy + vô hiệu hóa khi duyệt/revision/nguồn đổi,
// suppression + hủy đăng ký, idempotency-key provider, trạng thái
// 'khong_chac' khi kết quả mạng mơ hồ.
//
// Provider email là mock Bun.serve nội bộ — không credential thật, không
// gọi mạng ngoài. Kiểm chứng adapter bắn đúng contract: POST /emails,
// Bearer key, Idempotency-Key, List-Unsubscribe.

type App = Awaited<ReturnType<typeof taoServerTam>>;

async function getJson(app: App, path: string) {
  const r = await fetch(`${app.url}${path}`);
  return { status: r.status, json: await r.json() };
}

function post(app: App, path: string, body?: unknown) {
  return fetch(`${app.url}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
}

async function choJobKetThuc(app: App, jobId: string): Promise<string> {
  for (let i = 0; i < 300; i++) {
    const { json } = await getJson(app, `/api/job/${jobId}`);
    const tt = json.du_lieu.trang_thai;
    if (tt !== "cho" && tt !== "dang_chay") return tt;
    await Bun.sleep(30);
  }
  return "timeout";
}

async function choGiaoKetThuc(app: App, giaoId: string): Promise<string> {
  for (let i = 0; i < 300; i++) {
    const { json } = await getJson(app, `/api/giao-hang/${giaoId}`);
    const tt = json.du_lieu.trang_thai;
    if (tt !== "cho_giao") return tt;
    await Bun.sleep(30);
  }
  return "timeout";
}

// Bản newsletter ở 'nhap' trong seed — đưa lên da_duyet qua API đúng luồng.
async function bthNewsletterDuyet(app: App): Promise<string> {
  const r = await duyetBth(app, "seed-bth-retry-newsletter");
  expect(r.duyet.status).toBe(200);
  return "seed-bth-retry-newsletter";
}

describe("kênh sở hữu — catalog + xem trước + giao trang nội bộ", () => {
  test("GET /api/kenh liệt kê adapter theo năng lực thật", async () => {
    const app = await taoServerTam();
    try {
      const { status, json } = await getJson(app, "/api/kenh");
      expect(status).toBe(200);
      const ds = json.du_lieu.ds_kenh;
      const theoId = Object.fromEntries(ds.map((k: { id: string }) => [k.id, k]));
      expect(theoId.trang_noi_bo.nang_luc).toContain("len_lich");
      expect(theoId.trang_noi_bo.san_sang).toBe(true);
      // Email chưa cấu hình → không sẵn sàng, KHÔNG giả là gửi được.
      expect(theoId.email.san_sang).toBe(false);
      expect(theoId.email.nang_luc).toContain("metric");
      expect(theoId.dry_run.san_sang).toBe(true);
      expect(theoId.xuat_tay.nang_luc).toEqual(["xem_truoc", "xuat"]);
      // Không có credential nào trong response.
      expect(JSON.stringify(json)).not.toContain("MAI_EMAIL_API_KEY");
    } finally {
      await app.dong();
    }
  });

  test("giao trang nội bộ: da_giao + URL canonical; nháp bị chặn; dedupe", async () => {
    const app = await taoServerTam();
    seed(app.db);
    try {
      const bthId = await bthNewsletterDuyet(app);

      // Đầu ra 'nhap' không giao được.
      const nhapRes = await post(app, `/api/ban-the-hien/seed-bth-1/giao`, { kenh: "trang_noi_bo" });
      expect(nhapRes.status).toBe(409);
      expect((await nhapRes.json()).loi.ma).toBe("XUNG_DOT_TRANG_THAI");

      const tao = await post(app, `/api/ban-the-hien/${bthId}/giao`, { kenh: "trang_noi_bo" });
      expect(tao.status).toBe(200);
      const { giao, da_tao } = (await tao.json()).du_lieu;
      expect(da_tao).toBe(true);
      expect(giao.trang_thai).toBe("cho_giao");
      expect(giao.job_id).not.toBe("");

      // Double-submit → trả lần cũ, không tạo lần thứ hai.
      const tao2 = await post(app, `/api/ban-the-hien/${bthId}/giao`, { kenh: "trang_noi_bo" });
      const j2 = (await tao2.json()).du_lieu;
      expect(j2.da_tao).toBe(false);
      expect(j2.giao.id).toBe(giao.id);

      // Job bền chạy → da_giao + URL canonical /p/<id> đọc được.
      expect(await choJobKetThuc(app, giao.job_id)).toBe("xong");
      expect(await choGiaoKetThuc(app, giao.id)).toBe("da_giao");
      const { json: g2 } = await getJson(app, `/api/giao-hang/${giao.id}`);
      expect(g2.du_lieu.url).toContain(`/p/${bthId}`);
      expect(g2.du_lieu.revision_thanh_cong).toBe(giao.revision_id);
      expect(g2.du_lieu.ma_bien_nhan).not.toBe("");
      const trang = await fetch(`${app.url}/p/${bthId}`);
      expect(trang.status).toBe(200);
      expect(await trang.text()).toContain("Newsletter");

      // Giao lại cùng revision (đã xong → tạo được lần mới) không tạo
      // xuat_ban trùng: số record xuất bản không đổi sau lần giao thứ hai.
      const xbTruoc = (await getJson(app, `/api/ban-the-hien/${bthId}/xuat-ban`)).json.du_lieu.length;
      const tao3 = await post(app, `/api/ban-the-hien/${bthId}/giao`, { kenh: "trang_noi_bo" });
      const giao3 = (await tao3.json()).du_lieu.giao;
      expect(await choGiaoKetThuc(app, giao3.id)).toBe("da_giao");
      const xbSau = (await getJson(app, `/api/ban-the-hien/${bthId}/xuat-ban`)).json.du_lieu.length;
      expect(xbSau).toBe(xbTruoc);
    } finally {
      await app.dong();
    }
  });

  test("dry-run trả preview gắn nhãn, không nói đã gửi; xuất tay cho đích social", async () => {
    const app = await taoServerTam();
    seed(app.db);
    try {
      const bthId = await bthNewsletterDuyet(app);

      const xt = await getJson(app, `/api/ban-the-hien/${bthId}/giao/xem-truoc?kenh=dry_run`);
      expect(xt.status).toBe(200);
      expect(xt.json.du_lieu.nhan).toContain("DRY-RUN");
      expect(xt.json.du_lieu.canh_bao.join(" ")).toContain("Không email nào được gửi");

      const giaoDry = await post(app, `/api/ban-the-hien/${bthId}/giao`, { kenh: "dry_run" });
      const gd = (await giaoDry.json()).du_lieu.giao;
      // Đồng bộ: kết quả ngay, không job nền; trạng thái là xuat_tay, KHÔNG
      // phải da_giao/chap_nhan.
      expect(gd.trang_thai).toBe("xuat_tay");
      expect(gd.job_id).toBe("");
      expect(gd.chi_tiet.nhan).toContain("DRY-RUN");
      expect(gd.chi_tiet.email_mau.subject).toBeTruthy();

      // Đích social (linkedin) → gợi ý xuất tay; giao xuat_tay ghi record
      // xuất bản + link tải bundle, không giả thành công API.
      const goiY = await getJson(app, "/api/ban-the-hien/seed-bth-retry-linkedin/giao");
      expect(goiY.json.du_lieu.goi_y_kenh.kenh).toBe("xuat_tay");
      const giaoXT = await post(app, "/api/ban-the-hien/seed-bth-retry-linkedin/giao", {
        kenh: "xuat_tay",
      });
      const gx = (await giaoXT.json()).du_lieu.giao;
      expect(gx.trang_thai).toBe("xuat_tay");
      expect(gx.url).toContain("/tai-ve");
      const bundle = await fetch(`${app.url}${gx.url}`);
      expect(bundle.status).toBe(200);
      expect(bundle.headers.get("content-type")).toContain("zip");
    } finally {
      await app.dong();
    }
  });

  test("lên lịch có timezone + hủy trước khi gửi + vô hiệu khi nội dung đổi", async () => {
    const app = await taoServerTam();
    seed(app.db);
    try {
      const bthId = await bthNewsletterDuyet(app);
      const sau1h = new Date(Date.now() + 3600_000).toISOString();

      const tao = await post(app, `/api/ban-the-hien/${bthId}/giao`, {
        kenh: "trang_noi_bo",
        len_lich_luc: sau1h,
        mui_gio: "Asia/Ho_Chi_Minh",
      });
      const giao = (await tao.json()).du_lieu.giao;
      expect(giao.trang_thai).toBe("cho_giao");
      const { json: jobJson } = await getJson(app, `/api/job/${giao.job_id}`);
      expect(jobJson.du_lieu.chay_som_nhat).toBe(sau1h);
      expect(jobJson.du_lieu.mui_gio).toBe("Asia/Ho_Chi_Minh");
      expect(jobJson.du_lieu.trang_thai).toBe("cho");

      // Hủy được trước khi gửi — giao 'huy', job 'huy'.
      const huy = await post(app, `/api/giao-hang/${giao.id}/huy`);
      expect((await huy.json()).du_lieu.trang_thai).toBe("huy");
      const { json: jobHuy } = await getJson(app, `/api/job/${giao.job_id}`);
      expect(jobHuy.du_lieu.trang_thai).toBe("huy");

      // Lên lịch mới, rồi nội dung đổi (revision mới → da_duyet thành
      // thay_the) → lần giao chờ bị vô hiệu tại lần đọc tiếp theo.
      const tao2 = await post(app, `/api/ban-the-hien/${bthId}/giao`, {
        kenh: "trang_noi_bo",
        len_lich_luc: sau1h,
        mui_gio: "Asia/Ho_Chi_Minh",
      });
      const giao2 = (await tao2.json()).du_lieu.giao;
      // Revision mới phải khai báo dua_tren = head hiện tại (xung đột
      // revision) — sau ghi, da_duyet tự chuyển thay_the.
      const headCu = (await getJson(app, `/api/ban-the-hien/${bthId}`)).json.du_lieu.head_revision_id;
      themRevision(
        app.db,
        { ban_the_hien_id: bthId, noi_dung: "Nội dung mới", dua_tren_revision_id: headCu },
        "test",
      );
      const { json: dsGiao } = await getJson(app, `/api/ban-the-hien/${bthId}/giao`);
      const g2 = dsGiao.du_lieu.ds_giao.find((g: { id: string }) => g.id === giao2.id);
      expect(g2.trang_thai).toBe("huy");
      expect(g2.loi).toBe("chua_duyet");
      const { json: job2 } = await getJson(app, `/api/job/${giao2.job_id}`);
      expect(job2.du_lieu.trang_thai).toBe("huy");

      // Đầu ra đã hết duyệt → tạo giao mới cũng bị chặn.
      const chan = await post(app, `/api/ban-the-hien/${bthId}/giao`, { kenh: "trang_noi_bo" });
      expect(chan.status).toBe(409);
    } finally {
      await app.dong();
    }
  });
});

// Mock provider tương thích Resend: ghi lại request để kiểm contract.
// Idempotency: mọi request đăng ký khóa → receipt NGAY (kể cả khi trả
// 500 — trường hợp mơ hồ thật: provider đã nhận rồi mới lỗi). Request lại
// cùng khóa → trả cùng receipt (dedupe), không tạo email thứ hai.
function taoProviderGia() {
  const dsReq: { key: string; body: Record<string, unknown>; auth: string | null; tra_ve: string }[] =
    [];
  let cheDo: "ok" | "loi_500" | "loi_422" = "ok";
  const bienNhan = new Map<string, string>(); // khoa_idem → receipt id
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/emails" && req.method === "POST") {
        const body = (await req.json()) as Record<string, unknown>;
        const key = String(req.headers.get("idempotency-key") ?? "");
        if (!bienNhan.has(key)) bienNhan.set(key, `re_${bienNhan.size + 1}`);
        const id = bienNhan.get(key)!;
        dsReq.push({ key, body, auth: req.headers.get("authorization"), tra_ve: id });
        if (cheDo === "loi_500") return new Response("server error", { status: 500 });
        if (cheDo === "loi_422") return Response.json({ error: "bad request" }, { status: 422 });
        return Response.json({ id });
      }
      if (req.method === "GET" && url.pathname.startsWith("/emails/")) {
        return Response.json({
          id: url.pathname.split("/").pop(),
          last_event: "delivered",
        });
      }
      return new Response("not found", { status: 404 });
    },
  });
  return {
    url: `http://localhost:${server.port}`,
    dsReq,
    bienNhan,
    dung: () => server.stop(),
    setCheDo: (m: "ok" | "loi_500" | "loi_422") => {
      cheDo = m;
    },
  };
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

describe("kênh sở hữu — email provider", () => {
  test("gửi tôn trọng suppression, ghi receipt, Idempotency-Key; metric", async () => {
    donBienEmail();
    const provider = taoProviderGia();
    Bun.env.MAI_EMAIL_BASE_URL = provider.url;
    Bun.env.MAI_EMAIL_API_KEY_ENV = "MAI_TEST_EMAIL_KEY";
    Bun.env.MAI_TEST_EMAIL_KEY = "gia-lap-key-123";
    Bun.env.MAI_EMAIL_FROM = "Mai <bao@example.com>";
    Bun.env.MAI_EMAIL_NGUOI_NHAN_TEST = "chu@example.com";
    const app = await taoServerTam();
    seed(app.db);
    // Story #13 seed sẵn người nhận demo — test tự khai danh bạ, xóa hết.
    app.db.query("DELETE FROM nguoi_nhan").run();
    try {
      const bthId = await bthNewsletterDuyet(app);
      expect((await getJson(app, "/api/kenh")).json.du_lieu.ds_kenh.find((k: {id:string})=>k.id==="email").san_sang).toBe(true);

      // Danh bạ opt-in: 2 đăng ký + 1 sẽ hủy trước khi gửi.
      const nn1 = await post(app, "/api/nguoi-nhan", { email: "doc1@example.com", ten: "Độc giả 1" });
      expect(nn1.status).toBe(200);
      await post(app, "/api/nguoi-nhan", { email: "doc2@example.com" });
      const nn3 = await post(app, "/api/nguoi-nhan", { email: "doc3@example.com" });
      const id3 = (await nn3.json()).du_lieu.nguoi_nhan.id;
      await post(app, `/api/nguoi-nhan/${id3}/huy-dang-ky`);

      // Thêm lại địa chỉ đã suppress không hồi sinh subscription.
      const lai = await post(app, "/api/nguoi-nhan", { email: "doc3@example.com" });
      const laiJson = (await lai.json()).du_lieu;
      expect(laiJson.da_tao).toBe(false);
      expect(laiJson.nguoi_nhan.trang_thai).toBe("huy_dang_ky");

      // Xem trước giao thật: chỉ 2 người đang đăng ký, 1 bị bỏ qua.
      const xt = await getJson(app, `/api/ban-the-hien/${bthId}/giao/xem-truoc?kenh=email`);
      expect(xt.json.du_lieu.ds_nguoi_nhan).toEqual(["doc1@example.com", "doc2@example.com"]);
      expect(xt.json.du_lieu.so_bo_qua).toBe(1);

      const tao = await post(app, `/api/ban-the-hien/${bthId}/giao`, { kenh: "email" });
      expect(tao.status).toBe(200);
      const giao = (await tao.json()).du_lieu.giao;
      expect(await choGiaoKetThuc(app, giao.id)).toBe("chap_nhan");

      // Contract provider: đúng 2 request (suppress không được gửi), Bearer
      // key, Idempotency-Key per (lần giao, người nhận), List-Unsubscribe.
      expect(provider.dsReq.length).toBe(2);
      const emailGui = provider.dsReq.map((r) => (r.body.to as string[])[0]).sort();
      expect(emailGui).toEqual(["doc1@example.com", "doc2@example.com"]);
      for (const r of provider.dsReq) {
        expect(r.auth).toBe("Bearer gia-lap-key-123");
        expect(r.key).toMatch(/^giao:/);
        const headers = r.body.headers as Record<string, string>;
        expect(headers["List-Unsubscribe"]).toContain("/huy-dang-ky?token=");
        expect(r.body.from).toBe("Mai <bao@example.com>");
        expect(r.body.text).toContain("Hủy đăng ký");
      }
      expect(provider.dsReq[0]!.key).not.toBe(provider.dsReq[1]!.key);

      const { json: gj } = await getJson(app, `/api/giao-hang/${giao.id}`);
      expect(gj.du_lieu.so_nguoi_nhan).toBe(2);
      expect(gj.du_lieu.so_bo_qua).toBe(1);
      // Receipt provider per người nhận — 'chap_nhan' là provider đã nhận,
      // khác với đã tới người nhận cuối (metric đọc trạng thái sau).
      expect(Object.keys(gj.du_lieu.chi_tiet.bien_nhan)).toEqual(
        expect.arrayContaining(["doc1@example.com", "doc2@example.com"]),
      );

      const metric = await getJson(app, `/api/giao-hang/${giao.id}/metric`);
      expect(metric.status).toBe(200);
      expect(metric.json.du_lieu["doc1@example.com"].su_kien_cuoi).toBe("delivered");

      // Response trình duyệt không chứa giá trị key.
      expect(JSON.stringify(gj)).not.toContain("gia-lap-key-123");
    } finally {
      provider.dung();
      await app.dong();
      donBienEmail();
    }
  });

  test("email test tới người nhận test; hủy đăng ký qua link; 422 → loi; 500 → khong_chac + retry cùng khóa", async () => {
    donBienEmail();
    const provider = taoProviderGia();
    Bun.env.MAI_EMAIL_BASE_URL = provider.url;
    Bun.env.MAI_EMAIL_API_KEY_ENV = "MAI_TEST_EMAIL_KEY";
    Bun.env.MAI_TEST_EMAIL_KEY = "gia-lap-key-123";
    Bun.env.MAI_EMAIL_FROM = "Mai <bao@example.com>";
    Bun.env.MAI_EMAIL_NGUOI_NHAN_TEST = "chu@example.com";
    const app = await taoServerTam();
    seed(app.db);
    app.db.query("DELETE FROM nguoi_nhan").run();
    try {
      const bthId = await bthNewsletterDuyet(app);

      // Email test: chỉ tới nguoi_nhan_test, không List-Unsubscribe.
      const test = await post(app, `/api/ban-the-hien/${bthId}/giao`, {
        kenh: "email",
        la_test: true,
      });
      const giaoTest = (await test.json()).du_lieu.giao;
      expect(giaoTest.la_test).toBe(true);
      expect(await choGiaoKetThuc(app, giaoTest.id)).toBe("chap_nhan");
      expect(provider.dsReq.length).toBe(1);
      expect((provider.dsReq[0]!.body.to as string[])[0]).toBe("chu@example.com");
      expect((provider.dsReq[0]!.body.headers as Record<string, string>)["List-Unsubscribe"]).toBeUndefined();

      // Danh bạ opt-in 2 người cho các lần giao phía dưới.
      await post(app, "/api/nguoi-nhan", { email: "doc1@example.com" });
      const nn2 = await post(app, "/api/nguoi-nhan", { email: "doc2@example.com" });
      const id2 = (await nn2.json()).du_lieu.nguoi_nhan.id;

      // 422 provider từ chối rõ → 'loi' vĩnh viễn, job 'loi' không retry.
      provider.setCheDo("loi_422");
      const t422 = await post(app, `/api/ban-the-hien/${bthId}/giao`, { kenh: "email" });
      const g422 = (await t422.json()).du_lieu.giao;
      expect(await choJobKetThuc(app, g422.job_id)).toBe("loi");
      expect(await choGiaoKetThuc(app, g422.id)).toBe("loi");
      expect((await getJson(app, `/api/giao-hang/${g422.id}`)).json.du_lieu.loi).toContain("422");

      // 500 = mơ hồ (provider có thể đã nhận): giao 'khong_chac', job
      // 'loi', KHÔNG retry mù trong lúc chờ.
      provider.setCheDo("loi_500");
      const t500 = await post(app, `/api/ban-the-hien/${bthId}/giao`, { kenh: "email" });
      const g500 = (await t500.json()).du_lieu.giao;
      expect(await choJobKetThuc(app, g500.job_id)).toBe("loi");
      expect(await choGiaoKetThuc(app, g500.id)).toBe("khong_chac");
      const reqG500 = provider.dsReq.filter((r) => r.key.startsWith(`giao:${g500.id}:`));
      expect(reqG500.length).toBe(1); // dừng ngay sau lần đầu mơ hồ

      // Retry tay khi provider đã khỏe: cùng Idempotency-Key → provider
      // dedupe, người đầu tiên nhận LẠI receipt cũ (không email kép),
      // người thứ hai mới được gửi lần đầu.
      provider.setCheDo("ok");
      const thu = await post(app, `/api/giao-hang/${g500.id}/thu-lai`);
      expect(thu.status).toBe(200);
      expect(await choGiaoKetThuc(app, g500.id)).toBe("chap_nhan");
      const cungKhoa = provider.dsReq.filter((r) => r.key.startsWith(`giao:${g500.id}:`));
      // Lần 1: chỉ người đầu. Lần retry: người đầu (cùng khóa) + người hai.
      expect(cungKhoa.length).toBe(3);
      const khoaDau = reqG500[0]!.key;
      const guiLai = cungKhoa.filter((r) => r.key === khoaDau);
      expect(guiLai.length).toBe(2);
      expect(guiLai[0]!.tra_ve).toBe(guiLai[1]!.tra_ve); // cùng receipt — dedupe

      // Hủy đăng ký qua link token trong email → suppression vĩnh viễn.
      const { json: ds } = await getJson(app, "/api/nguoi-nhan");
      const nn = ds.du_lieu.ds_nguoi_nhan.find((n: { id: string }) => n.id === id2);
      const token = new URL(nn.url_huy_dang_ky).searchParams.get("token")!;
      const huy = await fetch(`${app.url}/huy-dang-ky?token=${token}`);
      expect(huy.status).toBe(200);
      expect(await huy.text()).toContain("Đã hủy đăng ký");
      const saiToken = await fetch(`${app.url}/huy-dang-ky?token=sai`);
      expect(saiToken.status).toBe(404);
      const { json: dsSau } = await getJson(app, "/api/nguoi-nhan");
      expect(
        dsSau.du_lieu.ds_nguoi_nhan.find((n: { id: string }) => n.id === id2).trang_thai,
      ).toBe("huy_dang_ky");
    } finally {
      provider.dung();
      await app.dong();
      donBienEmail();
    }
  });
});
