import { describe, expect, test } from "bun:test";
import { duyetBth, taoServerTam } from "./helpers.ts";
import { seed } from "../src/server/seed.ts";

// Đo kết quả kênh sở hữu (#15): mục tiêu + tiêu chí, link đích theo dõi
// /l/<token>, sự kiện first-party với dedupe fingerprint + lọc bot, số
// liệu tách nguồn provider/nhập tay, báo cáo gom với định nghĩa tường
// minh, và gợi ý hành động tiếp theo kèm quan sát + bất định.

type App = Awaited<ReturnType<typeof taoServerTam>>;

async function getJson(app: App, path: string) {
  const r = await fetch(`${app.url}${path}`);
  return { status: r.status, json: await r.json() };
}

function post(app: App, path: string, body?: unknown, method = "POST") {
  return fetch(`${app.url}${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
}

async function taoThongDiepMoi(app: App, tienTo: string) {
  const td = await post(app, "/api/thong-diep", {
    tieu_de: `Thông điệp ${tienTo}`,
    noi_dung: `Nội dung ${tienTo}`,
  });
  return (await td.json()).du_lieu.id as string;
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

async function taoBthDuyet(app: App, thongDiepId: string, dinhDang = "bai-viet") {
  const bth = await post(app, "/api/ban-the-hien", {
    thong_diep_id: thongDiepId,
    dinh_dang: dinhDang,
    ngon_ngu: "vi",
    doi_tuong: "Khách quen",
    dich_den: "",
  });
  const bthId = (await bth.json()).du_lieu.id as string;
  await post(app, `/api/ban-the-hien/${bthId}/revision`, {
    noi_dung: JSON.stringify({ tieu_de: "Bài test", noi_dung: "Nội dung test." }),
  });
  const r = await duyetBth(app, bthId);
  expect(r.duyet.status).toBe(200);
  return bthId;
}

describe("kết quả — mục tiêu + link đích + sự kiện first-party", () => {
  test("mục tiêu: upsert theo chủ, từ chối chủ sai loại, GET đọc lại", async () => {
    const app = await taoServerTam();
    seed(app.db);
    try {
      const dat = await post(
        app,
        "/api/muc-tieu",
        {
          chu_loai: "thong_diep",
          chu_id: "seed-td-tiem-banh",
          mo_ta: "Bán hết 30 ổ.",
          tieu_chi: [{ ten: "don_dat", don_vi: "đơn", nguong: 20 }],
        },
        "PUT",
      );
      expect(dat.status).toBe(200);
      const mt = (await dat.json()).du_lieu;
      expect(mt.chu_loai).toBe("thong_diep");
      expect(mt.tieu_chi[0].nguong).toBe(20);

      // Upsert cùng chủ → một dòng, không nhân đôi.
      const dat2 = await post(
        app,
        "/api/muc-tieu",
        { chu_loai: "thong_diep", chu_id: "seed-td-tiem-banh", mo_ta: "Mục tiêu mới.", tieu_chi: [] },
        "PUT",
      );
      expect((await dat2.json()).du_lieu.id).toBe(mt.id);
      const lay = await getJson(app, "/api/muc-tieu?chu_loai=thong_diep&chu_id=seed-td-tiem-banh");
      expect(lay.json.du_lieu.muc_tieu.mo_ta).toBe("Mục tiêu mới.");

      // Mục tiêu chỉ gắn campaign/thong_diep.
      const sai = await post(
        app,
        "/api/muc-tieu",
        { chu_loai: "ban_the_hien", chu_id: "seed-bth-tb-web", mo_ta: "x", tieu_chi: [] },
        "PUT",
      );
      expect(sai.status).toBe(400);
      expect((await sai.json()).loi.ma).toBe("VALIDATION");
      const khongCo = await post(
        app,
        "/api/muc-tieu",
        { chu_loai: "campaign", chu_id: "khong-ton-tai", mo_ta: "x", tieu_chi: [] },
        "PUT",
      );
      expect(khongCo.status).toBe(404);
    } finally {
      await app.dong();
    }
  });

  test("link đích: tạo/dedupe/validation; /l redirect + click dedupe + bot", async () => {
    const app = await taoServerTam();
    seed(app.db);
    try {
      const thieu = await post(app, "/api/link-dich", { url_dich: "https://a.example.com" });
      expect(thieu.status).toBe(400); // cần thong_diep_id hoặc ban_the_hien_id

      const urlXau = await post(app, "/api/link-dich", {
        url_dich: "ftp://x",
        thong_diep_id: "seed-td-tiem-banh",
      });
      expect(urlXau.status).toBe(400);

      const tao = await post(app, "/api/link-dich", {
        url_dich: "https://tiembanh.example.com/uu-dai",
        thong_diep_id: "seed-td-tiem-banh",
        nhan: "Ưu đãi",
      });
      expect(tao.status).toBe(200);
      const { link, da_tao } = (await tao.json()).du_lieu;
      expect(da_tao).toBe(true);
      expect(link.url_theo_doi).toContain(`/l/${link.token}`);

      // Cùng đích cùng chủ → trả link cũ.
      const lai = await post(app, "/api/link-dich", {
        url_dich: "https://tiembanh.example.com/uu-dai",
        thong_diep_id: "seed-td-tiem-banh",
      });
      const laiJ = (await lai.json()).du_lieu;
      expect(laiJ.da_tao).toBe(false);
      expect(laiJ.link.id).toBe(link.id);

      // /l/<token> → 302 tới đích; cùng fingerprint lặp trong 30 phút = 1
      // sự kiện; fingerprint khác = sự kiện mới; UA bot đếm riêng.
      // url_theo_doi ghép url_goc config (không phải port test) → lấy path.
      const duongLink = new URL(link.url_theo_doi).pathname;
      const layLink = () =>
        fetch(`${app.url}${duongLink}`, { redirect: "manual", headers: { "user-agent": "UA-A" } });
      const r1 = await layLink();
      expect(r1.status).toBe(302);
      expect(r1.headers.get("location")).toBe("https://tiembanh.example.com/uu-dai");
      await layLink();
      await fetch(`${app.url}${duongLink}`, {
        redirect: "manual",
        headers: { "user-agent": "UA-B" },
      });
      await fetch(`${app.url}${duongLink}`, {
        redirect: "manual",
        headers: { "user-agent": "Mozilla/5.0 (compatible; Googlebot/2.1)" },
      });
      const saiToken = await fetch(`${app.url}/l/xxxxxxxx99`);
      expect(saiToken.status).toBe(404);

      const { json: dsLink } = await getJson(app, "/api/link-dich?thong_diep_id=seed-td-tiem-banh");
      const dong = dsLink.du_lieu.ds_link.find((l: { id: string }) => l.id === link.id);
      expect(dong.so_click).toBe(2); // UA-A dedupe 1 + UA-B 1; bot không tính

      const kq = await app.db
        .query("SELECT COUNT(*) c FROM su_kien_do WHERE doi_tuong_id = ? AND la_bot = 1")
        .get(link.id) as { c: number };
      expect(kq.c).toBe(1);
    } finally {
      await app.dong();
    }
  });

  test("/p/<id> ghi xem_trang: dedupe fingerprint + bot tách riêng", async () => {
    const app = await taoServerTam();
    seed(app.db);
    try {
      const dem = () =>
        (app.db
          .query(
            "SELECT COUNT(*) c, COALESCE(SUM(la_bot),0) b FROM su_kien_do WHERE loai = 'xem_trang' AND doi_tuong_id = 'seed-bth-tb-web'",
          )
          .get() as { c: number; b: number });
      const truoc = dem();
      const xem = (ua: string) => fetch(`${app.url}/p/seed-bth-tb-web`, { headers: { "user-agent": ua } });
      expect((await xem("UA-X")).status).toBe(200);
      await xem("UA-X"); // trùng fingerprint → không tăng
      await xem("UA-Y");
      await xem("curl/8.0");
      const sau = dem();
      expect(sau.c - truoc.c).toBe(3);
      expect(sau.b - truoc.b).toBe(1); // curl tính bot
    } finally {
      await app.dong();
    }
  });
});

describe("kết quả — số liệu + báo cáo + gợi ý", () => {
  test("nhập tay: bằng chứng bắt buộc, nhãn tự báo mặc định, lọc theo chủ", async () => {
    const app = await taoServerTam();
    seed(app.db);
    try {
      const thieu = await post(app, "/api/ket-qua", {
        chu_loai: "thong_diep",
        chu_id: "seed-td-tiem-banh",
        ten: "doanh_thu",
        gia_tri: 5,
      });
      expect(thieu.status).toBe(400); // thiếu bang_chung

      const okRes = await post(app, "/api/ket-qua", {
        chu_loai: "thong_diep",
        chu_id: "seed-td-tiem-banh",
        ten: "doanh_thu_ngay_1",
        gia_tri: 1350000,
        don_vi: "đ",
        bang_chung: "sổ bán hàng 2026-10-10",
      });
      expect(okRes.status).toBe(200);
      const sl = (await okRes.json()).du_lieu;
      expect(sl.nguon).toBe("nhap_tay");
      expect(sl.nhan_dinh).toBe("tu_bao");

      const daDo = await post(app, "/api/ket-qua", {
        chu_loai: "thong_diep",
        chu_id: "seed-td-tiem-banh",
        ten: "doanh_thu_pos",
        gia_tri: 1400000,
        don_vi: "đ",
        bang_chung: "báo cáo POS",
        nhan_dinh: "da_do",
      });
      expect((await daDo.json()).du_lieu.nhan_dinh).toBe("da_do");

      const saiNhan = await post(app, "/api/ket-qua", {
        chu_loai: "thong_diep",
        chu_id: "seed-td-tiem-banh",
        ten: "x",
        bang_chung: "y",
        nhan_dinh: "sai",
      });
      expect(saiNhan.status).toBe(400);

      const { json: ds } = await getJson(app, "/api/ket-qua?chu_loai=thong_diep&chu_id=seed-td-tiem-banh&nguon=nhap_tay");
      expect(ds.du_lieu.ds_ket_qua.length).toBe(3); // 1 seed + 2 mới
    } finally {
      await app.dong();
    }
  });

  test("báo cáo: tách nguồn, định nghĩa + giới hạn, social không có, mẫu nhỏ", async () => {
    const app = await taoServerTam();
    seed(app.db);
    try {
      const { status, json } = await getJson(app, "/api/bao-cao-ket-qua?thong_diep_id=seed-td-tiem-banh");
      expect(status).toBe(200);
      const bc = json.du_lieu;

      // Định nghĩa metric tường minh + giới hạn luôn có.
      expect(bc.dinh_nghia.xem_trang).toContain("GET /p/");
      expect(bc.dinh_nghia.reach_social).toContain("không có");
      expect(bc.gioi_han.length).toBeGreaterThan(3);
      expect(bc.social.reach).toBeNull();
      expect(bc.social.trang_thai).toBe("khong_co");

      // Số đếm chồng lấn KHÔNG gộp thành người duy nhất — mỗi nguồn một cột.
      const td = bc.theo_thong_diep.find((r: { thong_diep_id: string }) => r.thong_diep_id === "seed-td-tiem-banh");
      expect(td.xem_trang).toBe(12); // 13 sự kiện trừ 1 bot
      expect(td.xem_loai_bot).toBe(1);
      expect(td.click_link).toBe(4);
      expect(td.click_loai_bot).toBe(1);
      expect(td.email_da_gui).toBe(2);
      expect(td.email_su_kien).toEqual({ opened: 1, delivered: 1 });
      expect(td.so_nhap_tay).toBe(1);

      // Xuất tay KHÔNG tính là đã đăng/đã xem — kênh chỉ báo lần giao.
      const xuatTay = bc.theo_kenh.find((k: { kenh: string }) => k.kenh === "xuat_tay");
      expect(xuatTay.thanh_cong).toBe(1);
      expect(xuatTay.ghi_chu).toContain("không đo được đăng hay xem");
      const email = bc.theo_kenh.find((k: { kenh: string }) => k.kenh === "email");
      expect(email.da_gui).toBe(2);
      expect(email.su_kien_provider.opened).toBe(1);
      const trang = bc.theo_kenh.find((k: { kenh: string }) => k.kenh === "trang_noi_bo");
      expect(trang.xem_trang).toBe(12);

      // Cửa sổ + độ tươi + mẫu nhỏ (12+4+2 = 18 < 30) không bịa tỉ lệ.
      expect(bc.cua_so.mui_gio).toBe("UTC");
      expect(bc.do_tuoi.snapshot_provider_moi_nhat).not.toBeNull();
      expect(bc.mau_nho).toBe(true);
      expect(bc.muc_tieu.mo_ta).toContain("croissant");
      expect(bc.nhap_tay[0].nhan_dinh).toBe("tu_bao");
    } finally {
      await app.dong();
    }
  });

  test("gợi ý: sinh kèm quan sát + bất định; chấp nhận câu hỏi; từ chối; 409 lặp", async () => {
    const app = await taoServerTam();
    seed(app.db);
    try {
      const { json } = await getJson(app, "/api/goi-y-ket-qua?thong_diep_id=seed-td-tiem-banh");
      const ds = json.du_lieu.ds_goi_y;
      // Link 'Xem thực đơn' có xem nhưng 0 click → cau_hoi; snapshot >24h
      // → thi_nghiem thu_metric. Đọc lại không sinh trùng (khóa ổn định).
      const { json: j2 } = await getJson(app, "/api/goi-y-ket-qua?thong_diep_id=seed-td-tiem-banh");
      expect(j2.du_lieu.ds_goi_y.length).toBe(ds.length);

      const cauHoi = ds.find((g: { loai: string }) => g.loai === "cau_hoi");
      expect(cauHoi).toBeTruthy();
      expect(cauHoi.quan_sat.length).toBeGreaterThan(0);
      expect(cauHoi.quan_sat[0].nguon).toBe("first_party");
      expect(["thap", "vua", "cao"]).toContain(cauHoi.bat_dinh);

      const thuMetric = ds.find(
        (g: { hanh_dong: { loai_tao?: string } }) => g.hanh_dong.loai_tao === "thu_metric",
      );
      expect(thuMetric).toBeTruthy();

      // Chấp nhận câu hỏi → ghi câu hỏi mở, không bịa artifact.
      const cn = await post(app, `/api/goi-y-ket-qua/${cauHoi.id}/chap-nhan`);
      expect(cn.status).toBe(200);
      const cnJ = (await cn.json()).du_lieu;
      expect(cnJ.trang_thai).toBe("chap_nhan");
      expect(cnJ.ket_qua.cau_hoi_mo).toBe(cauHoi.tieu_de);
      // Đã quyết → thao tác lại 409.
      const lap = await post(app, `/api/goi-y-ket-qua/${cauHoi.id}/chap-nhan`);
      expect(lap.status).toBe(409);
      expect((await lap.json()).loi.ma).toBe("XUNG_DOT_TRANG_THAI");

      const tc = await post(app, `/api/goi-y-ket-qua/${thuMetric.id}/tu-choi`);
      expect((await tc.json()).du_lieu.trang_thai).toBe("tu_choi");
    } finally {
      await app.dong();
    }
  });

  test("chấp nhận nháp tiếp theo: tạo đầu ra liên kết dưới cùng thông điệp + job", async () => {
    const app = await taoServerTam();
    seed(app.db);
    try {
      const tdId = await taoThongDiepMoi(app, "ket-qua");
      const bthId = await taoBthDuyet(app, tdId);
      const giao = await post(app, `/api/ban-the-hien/${bthId}/giao`, { kenh: "trang_noi_bo" });
      const giaoId = (await giao.json()).du_lieu.giao.id;
      expect(await choGiaoKetThuc(app, giaoId)).toBe("da_giao");
      await fetch(`${app.url}/p/${bthId}`, { headers: { "user-agent": "UA-Q" } });

      const { json } = await getJson(app, `/api/goi-y-ket-qua?thong_diep_id=${tdId}`);
      const nhapTiep = json.du_lieu.ds_goi_y.find((g: { loai: string }) => g.loai === "nhap_tiep");
      expect(nhapTiep).toBeTruthy();
      expect(nhapTiep.hanh_dong.thong_diep_id).toBe(tdId);

      const cn = await post(app, `/api/goi-y-ket-qua/${nhapTiep.id}/chap-nhan`);
      const cnJ = (await cn.json()).du_lieu;
      expect(cnJ.trang_thai).toBe("chap_nhan");
      expect(cnJ.ket_qua.ban_the_hien_id).toBeTruthy();
      expect(cnJ.ket_qua.job_id).toBeTruthy();
      // Đầu ra mới thuộc CÙNG thông điệp — dòng nguồn giữ nguyên.
      const bthMoi = await getJson(app, `/api/ban-the-hien/${cnJ.ket_qua.ban_the_hien_id}`);
      expect(bthMoi.json.du_lieu.thong_diep_id).toBe(tdId);
    } finally {
      await app.dong();
    }
  });

  test("metric giao hàng: đọc adapter → lưu snapshot provider; thu thập hàng loạt", async () => {
    const provider = taoProviderMetricGia();
    Bun.env.MAI_EMAIL_BASE_URL = provider.url;
    Bun.env.MAI_EMAIL_API_KEY_ENV = "MAI_TEST_EMAIL_KEY";
    Bun.env.MAI_TEST_EMAIL_KEY = "gia-lap-key-123";
    Bun.env.MAI_EMAIL_FROM = "Mai <bao@example.com>";
    try {
      const app = await taoServerTam();
      seed(app.db);
      try {
        // Fixture email giao 'chap_nhan' có bien_nhan → đọc metric thật
        // từ provider giả rồi ghi snapshot (khử trùng sự kiện provider).
        const m = await getJson(app, "/api/giao-hang/seed-giao-email/metric");
        expect(m.status).toBe(200);
        expect(m.json.du_lieu["ngoc@example.com"].su_kien_cuoi).toBe("delivered");
        expect(m.json.du_lieu.snapshot_id).toBeTruthy();
        const ds = (await getJson(app, "/api/ket-qua?chu_loai=giao_hang&chu_id=seed-giao-email&nguon=provider")).json;
        const snap = ds.du_lieu.ds_ket_qua[0];
        expect(snap.chi_tiet.theo_su_kien).toEqual({ delivered: 2 });

        // Snapshot giống hệt → refresh thu_luc, không tạo dòng mới.
        const m2 = await getJson(app, "/api/giao-hang/seed-giao-email/metric");
        expect(m2.json.du_lieu.snapshot_id).toBe(snap.id);

        // Thu thập hàng loạt: chỉ lần giao có adapter metric (email).
        const thu = await post(app, "/api/metric/thu-thap");
        const thuJ = (await thu.json()).du_lieu;
        expect(thuJ.da_thu).toBe(1);
        // xuat_tay bị lọc trước theo trạng thái; chỉ trang_noi_bo đếm bo_qua.
        expect(thuJ.bo_qua).toBe(1);
      } finally {
        await app.dong();
      }
    } finally {
      provider.dung();
      for (const k of ["MAI_EMAIL_BASE_URL", "MAI_EMAIL_API_KEY_ENV", "MAI_EMAIL_FROM", "MAI_TEST_EMAIL_KEY"])
        delete Bun.env[k];
    }
  });

  test("gợi ý kênh email xuất hiện khi email cấu hình đủ — route truyền c.kenh", async () => {
    // Trước fix: GET /api/goi-y-ket-qua không truyền cauHinhKenh →
    // layDsKenh(undefined) → email san_sang=false → thi_nghiem:kenh:*:email
    // không bao giờ được đề xuất.
    Bun.env.MAI_EMAIL_BASE_URL = "http://localhost:9"; // không gọi thật — chỉ cần san_sang
    Bun.env.MAI_EMAIL_API_KEY_ENV = "MAI_TEST_EMAIL_KEY";
    Bun.env.MAI_TEST_EMAIL_KEY = "gia-lap-key-123";
    Bun.env.MAI_EMAIL_FROM = "Mai <bao@example.com>";
    try {
      const app = await taoServerTam();
      seed(app.db);
      try {
        const kenh = await getJson(app, "/api/kenh");
        const emailAdapter = kenh.json.du_lieu.ds_kenh.find(
          (k: { id: string }) => k.id === "email",
        );
        expect(emailAdapter.san_sang).toBe(true);

        const tdId = await taoThongDiepMoi(app, "goi-y-kenh-email");
        const bthId = await taoBthDuyet(app, tdId);
        const giao = await post(app, `/api/ban-the-hien/${bthId}/giao`, {
          kenh: "trang_noi_bo",
        });
        const giaoId = (await giao.json()).du_lieu.giao.id;
        expect(await choGiaoKetThuc(app, giaoId)).toBe("da_giao");

        const { json } = await getJson(app, `/api/goi-y-ket-qua?thong_diep_id=${tdId}`);
        const goiYEmail = json.du_lieu.ds_goi_y.find(
          (g: { khoa: string }) => g.khoa === `thi_nghiem:kenh:${tdId}:${bthId}:email`,
        );
        expect(goiYEmail).toBeTruthy();
        expect(goiYEmail.hanh_dong.dich_den).toBe("email");
        expect(goiYEmail.hanh_dong.dinh_dang).toBe("newsletter");
      } finally {
        await app.dong();
      }
    } finally {
      for (const k of ["MAI_EMAIL_BASE_URL", "MAI_EMAIL_API_KEY_ENV", "MAI_EMAIL_FROM", "MAI_TEST_EMAIL_KEY"])
        delete Bun.env[k];
    }
  });

  test("gợi ý 'het_han' hồi sinh 'moi' khi ứng viên quay lại", async () => {
    // Trước fix: upsert chỉ chạy trên trang_thai='moi' và INSERT bị skip
    // khi row đã tồn tại → row het_han không bao giờ hồi sinh.
    const app = await taoServerTam();
    seed(app.db);
    try {
      const tdId = await taoThongDiepMoi(app, "hoi-sinh-goi-y");
      const bthId = await taoBthDuyet(app, tdId);
      const giao = await post(app, `/api/ban-the-hien/${bthId}/giao`, {
        kenh: "trang_noi_bo",
      });
      const giaoId = (await giao.json()).du_lieu.giao.id;
      expect(await choGiaoKetThuc(app, giaoId)).toBe("da_giao");
      await fetch(`${app.url}/p/${bthId}`, { headers: { "user-agent": "UA-H" } });

      const lay = () => getJson(app, `/api/goi-y-ket-qua?thong_diep_id=${tdId}`);
      const timNhapTiep = (ds: { id: string; khoa: string; trang_thai: string }[]) => {
        const g = ds.find((x) => x.khoa.startsWith("nhap_tiep:"));
        if (!g) throw new Error("không có gợi ý nhap_tiep");
        return g;
      };

      const g1 = timNhapTiep((await lay()).json.du_lieu.ds_goi_y);
      expect(g1).toBeTruthy();
      expect(g1.trang_thai).toBe("moi");

      // Mở một nháp mới → ứng viên nhap_tiep biến mất → dòng xuống het_han.
      const bth2 = await post(app, "/api/ban-the-hien", {
        thong_diep_id: tdId,
        dinh_dang: "caption",
        ngon_ngu: "vi",
        doi_tuong: "Độc giả",
        dich_den: "",
      });
      const bth2Id = (await bth2.json()).du_lieu.id as string;
      const g2 = timNhapTiep((await lay()).json.du_lieu.ds_goi_y);
      expect(g2.id).toBe(g1.id);
      expect(g2.trang_thai).toBe("het_han");

      // Nháp được duyệt → không còn nháp mở → ứng viên quay lại → hồi sinh.
      await post(app, `/api/ban-the-hien/${bth2Id}/revision`, {
        noi_dung: JSON.stringify({ tieu_de: "Caption", noi_dung: "Nội dung caption." }),
      });
      const r = await duyetBth(app, bth2Id);
      expect(r.duyet.status).toBe(200);
      const g3 = timNhapTiep((await lay()).json.du_lieu.ds_goi_y);
      expect(g3.id).toBe(g1.id);
      expect(g3.trang_thai).toBe("moi");

      // Hồi sinh xong phải chấp nhận được (trước fix vẫn het_han → 409).
      const cn = await post(app, `/api/goi-y-ket-qua/${g3.id}/chap-nhan`);
      expect(cn.status).toBe(200);
    } finally {
      await app.dong();
    }
  });

  test("gợi ý 'moi' làm tươi hanh_dong khi thuộc tính nguồn đổi", async () => {
    // Trước fix: upsert chỉ refresh mo_ta/quan_sat/bat_dinh — hanh_dong
    // giữ thuộc tính cũ → chấp nhận tạo đầu ra/job theo giá trị lỗi thời.
    const app = await taoServerTam();
    seed(app.db);
    try {
      const tdId = await taoThongDiepMoi(app, "lam-tuoi-hanh-dong");
      const bthId = await taoBthDuyet(app, tdId);
      const giao = await post(app, `/api/ban-the-hien/${bthId}/giao`, {
        kenh: "trang_noi_bo",
      });
      const giaoId = (await giao.json()).du_lieu.giao.id;
      expect(await choGiaoKetThuc(app, giaoId)).toBe("da_giao");
      await fetch(`${app.url}/p/${bthId}`, { headers: { "user-agent": "UA-F" } });

      const lay = () => getJson(app, `/api/goi-y-ket-qua?thong_diep_id=${tdId}`);
      const g1 = (await lay()).json.du_lieu.ds_goi_y.find(
        (g: { loai: string }) => g.loai === "nhap_tiep",
      );
      expect(g1).toBeTruthy();
      expect(g1.hanh_dong.doi_tuong).toBe("Khách quen");

      // Đổi doi_tuong của đầu ra nguồn trong lúc gợi ý còn 'moi' → đọc
      // lại phải phản ánh giá trị mới trong hanh_dong.
      app.db.query("UPDATE ban_the_hien SET doi_tuong = ? WHERE id = ?").run("Độc giả mới", bthId);
      const g2 = (await lay()).json.du_lieu.ds_goi_y.find(
        (g: { id: string }) => g.id === g1.id,
      );
      expect(g2.trang_thai).toBe("moi");
      expect(g2.hanh_dong.doi_tuong).toBe("Độc giả mới");

      // Chấp nhận dùng hanh_dong MỚI → find-or-create trúng đầu ra đã sửa,
      // không tạo bản mới theo doi_tuong cũ.
      const cn = await post(app, `/api/goi-y-ket-qua/${g2.id}/chap-nhan`);
      expect(cn.status).toBe(200);
      const ketQua = (await cn.json()).du_lieu.ket_qua;
      expect(ketQua.ban_the_hien_id).toBe(bthId);
      const job = await getJson(app, `/api/job/${ketQua.job_id}`);
      expect(JSON.parse(job.json.du_lieu.payload).doi_tuong).toBe("Độc giả mới");
    } finally {
      await app.dong();
    }
  });
});

// Provider giả kiểu Resend: chỉ cần GET /emails/<id> cho metric.
function taoProviderMetricGia() {
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      if (req.method === "GET" && url.pathname.startsWith("/emails/")) {
        return Response.json({ id: url.pathname.split("/").pop(), last_event: "delivered" });
      }
      return new Response("not found", { status: 404 });
    },
  });
  return { url: `http://localhost:${server.port}`, dung: () => server.stop() };
}
