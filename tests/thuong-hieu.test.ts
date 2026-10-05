import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { layBanTheHien, layRevision } from "../src/modules/content/index.ts";
import { danhSachTaskSua } from "../src/modules/thay_doi/index.ts";
import { layJob } from "../src/modules/jobs/index.ts";
import { kiemTraDauRa } from "../src/modules/generation/index.ts";
import { seed } from "../src/server/seed.ts";
import { taoServerTam } from "./helpers.ts";

// Test module thương hiệu toàn cầu (#12): campaign loai 'thuong_hieu' —
// claim chung + giọng văn + asset + CTA mặc định ở tầng chiến dịch;
// thị trường ghi đè giá/tiền tệ/ngôn ngữ/khả dụng/landing/CTA/reviewer;
// 'chưa đủ' chặn tổ hợp thiếu fact; chỉ tổ hợp đã chọn được sinh; duyệt
// hàng loạt ghim đúng revision + reviewer local; sửa claim chung đánh
// dấu cũ mọi biến thể, sửa fact local chỉ đánh dấu cũ thị trường đó.

type App = Awaited<ReturnType<typeof taoServerTam>>;
let app!: App;

const get = (p: string) => fetch(`${app.url}${p}`);
const getJ = async (p: string) => (await get(p)).json();
const post = (p: string, body: unknown) =>
  fetch(`${app.url}${p}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
const put = (p: string, body: unknown) =>
  fetch(`${app.url}${p}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

function moApp(coSeed = true) {
  beforeAll(async () => {
    app = await taoServerTam();
    if (coSeed) seed(app.db);
  });
  afterAll(async () => {
    await app.dong();
  });
}

// Chờ job kết thúc (runner của server test chạy chu kỳ 10ms).
async function choJob(id: string, ms = 15000) {
  const den = Date.now() + ms;
  while (Date.now() < den) {
    const j = layJob(app.db, id);
    if (j && (j.trang_thai === "xong" || j.trang_thai === "loi")) return j;
    await Bun.sleep(60);
  }
  throw new Error(`hết thời gian chờ job ${id}`);
}

const CP = "seed-cp-thuong-hieu-velocity";

async function layView() {
  const j = await getJ(`/api/campaign/${CP}`);
  return j.du_lieu;
}
// Lấy thị trường theo mã; throw khi thiếu để typecheck không báo undefined.
async function layTt(ma: string): Promise<{ ma: string; id: string }> {
  const j = await getJ(`/api/campaign/${CP}/thi-truong`);
  const tt = (j.du_lieu as { ma: string; id: string }[]).find((t) => t.ma === ma);
  if (!tt) throw new Error(`thiếu thị trường '${ma}' trong campaign seed.`);
  return tt;
}

describe("campaign thuong_hieu: seed + view", () => {
  moApp();

  test("seed tạo campaign thương hiệu: claim + thị trường + ma trận", async () => {
    const cp = await layView();
    expect(cp.loai).toBe("thuong_hieu");
    expect(cp.thuong_hieu).toBeTruthy();

    const th = cp.thuong_hieu;
    expect(th.nguon_thuong_hieu).toBeTruthy();
    // 3 claim: 2 trỏ nguồn spec, 1 cố ý chưa có bằng chứng.
    expect(th.ds_claim_view).toHaveLength(3);
    expect(th.ds_claim_view.filter((c: { co_bang_chung: boolean }) => c.co_bang_chung)).toHaveLength(2);
    const clKhiDong = th.ds_claim_view.find((c: { id: string }) => c.id === "cl-khi-dong");
    expect(clKhiDong.co_bang_chung).toBe(false);
    expect(th.ds_asset_hinh_view[0].asset.ten_file).toBe("giay-chay-velocity.webp");

    // Ba thị trường; EU chưa đủ fact.
    expect(th.ds_thi_truong).toHaveLength(3);
    const us = th.ds_thi_truong.find((t: { ma: string }) => t.ma === "us");
    const vn = th.ds_thi_truong.find((t: { ma: string }) => t.ma === "vn");
    const eu = th.ds_thi_truong.find((t: { ma: string }) => t.ma === "eu");
    expect(us.chua_du).toBe(false);
    expect(us.gia).toBe("189");
    expect(us.tien_te).toBe("USD");
    expect(vn.bat_buoc_duyet).toBe(1);
    expect(eu.chua_du).toBe(true);
    expect(eu.fact_thieu).toEqual(expect.arrayContaining(["gia", "kha_dung"]));

    // Ma trận: bài viết US đã duyệt bởi reviewer local, caption VN chờ.
    const btUs = us.ds_bien_the.find((b: { ban_the_hien_id: string }) => b.ban_the_hien_id === "seed-bth-th-us-bai-viet");
    expect(btUs.trang_thai).toBe("da_duyet");
    expect(btUs.nguoi_duyet_cuoi.id).toBe("rev-us-maya");
    expect(btUs.revision_nguon_chung).toBeTruthy();
    const btVn = vn.ds_bien_the.find((b: { ban_the_hien_id: string }) => b.ban_the_hien_id === "seed-bth-th-vn-caption");
    expect(btVn.trang_thai).toBe("cho_duyet");

    // Đề xuất tổ hợp có sẵn cho các thị trường.
    expect(th.de_xuat_to_hop.length).toBeGreaterThan(0);

    // Danh sách thương hiệu.
    const ds = await getJ("/api/thuong-hieu");
    expect(ds.du_lieu.some((c: { id: string }) => c.id === CP)).toBe(true);
  });
});

describe("thi trường: validate + ghi đè local", () => {
  moApp();

  test("validate: ma xấu, giá thiếu tiền tệ, ngôn ngữ lạ, trùng mã", async () => {
    const resMa = await post(`/api/campaign/${CP}/thi-truong`, { ma: "US!", ten: "X" });
    expect(resMa.status).toBe(400);
    expect((await resMa.json()).loi.ma).toBe("VALIDATION");

    const resGia = await post(`/api/campaign/${CP}/thi-truong`, {
      ma: "jp",
      ten: "Nhật Bản",
      ngon_ngu: "en",
      gia: "20000",
    });
    expect(resGia.status).toBe(400);
    const jGia = await resGia.json();
    expect(jGia.loi.ma).toBe("VALIDATION");
    expect(JSON.stringify(jGia.loi.chi_tiet)).toContain("tien_te");

    const resNn = await post(`/api/campaign/${CP}/thi-truong`, {
      ma: "fr",
      ten: "Pháp",
      ngon_ngu: "fr",
    });
    expect(resNn.status).toBe(400);

    const resTrung = await post(`/api/campaign/${CP}/thi-truong`, { ma: "us", ten: "US 2" });
    expect(resTrung.status).toBe(400);
    expect(JSON.stringify((await resTrung.json()).loi.chi_tiet)).toContain("đã có");
  });

  test("sửa fact EU (giá + khả dụng) hết 'chưa đủ' — thị trường khác không đổi", async () => {
    const eu = await layTt("eu");
    const res = await put(`/api/campaign/${CP}/thi-truong/${eu.id}`, {
      gia: "199",
      tien_te: "EUR",
      kha_dung: "dat_truoc",
    });
    expect(res.status).toBe(200);
    const euSau = (await res.json()).du_lieu;
    expect(euSau.gia).toBe("199");
    expect(euSau.kha_dung).toBe("dat_truoc");

    const cp = await layView();
    const euV = cp.thuong_hieu.ds_thi_truong.find((t: { ma: string }) => t.ma === "eu");
    expect(euV.chua_du).toBe(false);
    const vnV = cp.thuong_hieu.ds_thi_truong.find((t: { ma: string }) => t.ma === "vn");
    expect(vnV.gia).toBe("4.590.000");
  });

  test("ghi đè local tường minh, không đụng nguồn chung", async () => {
    const vn = await layTt("vn");
    const res = await put(`/api/campaign/${CP}/thi-truong/${vn.id}`, {
      cta_nhan: "Mua ngay",
      landing_page: "/vn/giay-chay-moi",
    });
    expect(res.status).toBe(200);
    const cp = await layView();
    // CTA chung của chiến dịch giữ nguyên.
    expect(cp.cta[0].nhan).toBe("Khám phá Velocity Run 2");
    const us = cp.thuong_hieu.ds_thi_truong.find((t: { ma: string }) => t.ma === "us");
    expect(us.cta_nhan).toBe("Shop the US store");
  });
});

describe("tổ hợp: xem trước, giới hạn, sinh đích danh", () => {
  moApp();

  test("xem trước: US sẵn sàng, EU bị chặn vì chưa đủ", async () => {
    const us = await layTt("us");
    const eu = await layTt("eu");
    const res = await post(`/api/campaign/${CP}/to-hop/xem-truoc`, {
      ds_chon: [
        { thi_truong_id: us.id, dinh_dang: "caption", doi_tuong_id: "seed-dt-runner-phong-trao", dich_den: "instagram-us" },
        { thi_truong_id: eu.id, dinh_dang: "caption", dich_den: "instagram-eu" },
      ],
    });
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.du_lieu.so_luong).toBe(2);
    const usR = j.du_lieu.ds_ket_qua[0];
    expect(usR.trang_thai).toBe("san_sang");
    const euR = j.du_lieu.ds_ket_qua[1];
    expect(euR.trang_thai).toBe("bi_chan");
    expect(euR.fact_thieu).toEqual(expect.arrayContaining(["gia", "kha_dung"]));
    // Chưa cấu hình pricing provider → không đoán chi phí.
    expect(j.du_lieu.uoc_tinh).toBeNull();
  });

  test("vượt giới hạn biến thể mỗi request → 400", async () => {
    const us = await layTt("us");
    const ds = Array.from({ length: 9 }, (_, i) => ({
      thi_truong_id: us.id,
      dinh_dang: "caption",
      dich_den: `k-${i}`,
    }));
    const res = await post(`/api/campaign/${CP}/to-hop`, { ds_chon: ds });
    expect(res.status).toBe(400);
    expect((await res.json()).loi.ma).toBe("VALIDATION");
  });

  test("chỉ tổ hợp đã chọn được sinh; EU bị chặn không tạo gì", async () => {
    const us = await layTt("us");
    const eu = await layTt("eu");
    const res = await post(`/api/campaign/${CP}/to-hop`, {
      ds_chon: [
        { thi_truong_id: us.id, dinh_dang: "caption", doi_tuong_id: "seed-dt-runner-phong-trao", dich_den: "instagram-us" },
        { thi_truong_id: eu.id, dinh_dang: "caption", dich_den: "instagram-eu" },
      ],
    });
    expect(res.status).toBe(201);
    const j = await res.json();
    const usR = j.du_lieu.ds_ket_qua[0];
    expect(usR.trang_thai).toBe("da_sinh");
    expect(usR.ban_the_hien_id).toBeTruthy();
    expect(usR.job_id).toBeTruthy();
    const euR = j.du_lieu.ds_ket_qua[1];
    expect(euR.trang_thai).toBe("bi_chan");
    expect(euR.ban_the_hien_id).toBeNull();

    // Job chạy → biến thể US có nội dung với giá local nguyên văn.
    const job = await choJob(usR.job_id);
    expect(job.trang_thai).toBe("xong");
    const bth = layBanTheHien(app.db, usR.ban_the_hien_id)!;
    expect(bth.head_revision_id).toBeTruthy();
    const nd = JSON.parse(layRevision(app.db, bth.head_revision_id!)!.noi_dung);
    const giaTri = JSON.stringify(nd);
    expect(giaTri).toContain("189");
    expect(giaTri).toContain("USD");
    // Claim chưa xác nhận → chỉ được để [CÂU HỎI:...].
    expect(giaTri).toContain("CÂU HỎI");
  });
});

describe("duyệt hàng loạt: reviewer local + revision ghim", () => {
  moApp();

  test("VN bắt buộc reviewer local: thiếu/sai → 400; đúng → duyệt được", async () => {
    // Caption VN đang chờ duyệt; thị trường VN bật bat_buoc_duyet.
    const resThieu = await post(`/api/campaign/${CP}/duyet`, {
      ds: [{ ban_the_hien_id: "seed-bth-th-vn-caption" }],
    });
    expect(resThieu.status).toBe(400);
    expect((await resThieu.json()).loi.ma).toBe("VALIDATION");

    const resSaiReviewer = await post(`/api/campaign/${CP}/duyet`, {
      ds: [{ ban_the_hien_id: "seed-bth-th-vn-caption", nguoi_duyet_id: "rev-us-maya" }],
    });
    expect(resSaiReviewer.status).toBe(400);
    expect(JSON.stringify((await resSaiReviewer.json()).loi.chi_tiet)).toContain("rev-us-maya");

    const resDung = await post(`/api/campaign/${CP}/duyet`, {
      ds: [{ ban_the_hien_id: "seed-bth-th-vn-caption", nguoi_duyet_id: "rev-vn-tam" }],
    });
    expect(resDung.status).toBe(200);
    const jDung = await resDung.json();
    expect(jDung.du_lieu.ds_ket_qua[0].ok).toBe(true);
    const bth = layBanTheHien(app.db, "seed-bth-th-vn-caption")!;
    expect(bth.trang_thai).toBe("da_duyet");
    const duyet = app.db
      .query("SELECT nguoi_duyet_id FROM duyet WHERE ban_the_hien_id = ? ORDER BY tao_luc DESC LIMIT 1")
      .get(bth.id) as { nguoi_duyet_id: string };
    expect(duyet.nguoi_duyet_id).toBe("rev-vn-tam");
  });

  test("ghim sai revision → mục lỗi XUNG_DOT_REVISION", async () => {
    const us = await layTt("us");
    await post(`/api/campaign/${CP}/to-hop`, {
      ds_chon: [{ thi_truong_id: us.id, dinh_dang: "thread", dich_den: "x-us" }],
    });
    const th = (await layView()).thuong_hieu;
    const bt = th.ds_thi_truong
      .find((t: { ma: string }) => t.ma === "us")
      .ds_bien_the.find((b: { dinh_dang: string }) => b.dinh_dang === "thread");
    const res = await post(`/api/campaign/${CP}/duyet`, {
      ds: [{ ban_the_hien_id: bt.ban_the_hien_id, mong_doi_revision_id: "rev-khong-dung" }],
    });
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.du_lieu.ds_ket_qua[0].ok).toBe(false);
    expect(j.du_lieu.ds_ket_qua[0].loi).toContain("XUNG_DOT");
  });

  test("biến thể la_cu (nguồn đã đổi) không được duyệt hàng loạt", async () => {
    // Sinh một biến thể mới cho US (không bắt buộc reviewer).
    const us = await layTt("us");
    const j1 = await (
      await post(`/api/campaign/${CP}/to-hop`, {
        ds_chon: [{ thi_truong_id: us.id, dinh_dang: "newsletter", dich_den: "email-us" }],
      })
    ).json();
    const bthId = j1.du_lieu.ds_ket_qua[0].ban_the_hien_id;
    await choJob(j1.du_lieu.ds_ket_qua[0].job_id);

    // Sửa claim chung → biến thể mới bị đánh dấu cũ (la_cu).
    const cp = await layView();
    const dsClaim = cp.ds_claim.map((c: { id: string }) =>
      c.id === "cl-trong-luong" ? { ...c, noi_dung: "Trọng lượng 218 g (size 42)." } : c,
    );
    const resPut = await put(`/api/campaign/${CP}`, { ten: cp.ten, ds_claim: dsClaim });
    expect(resPut.status).toBe(200);

    const res = await post(`/api/campaign/${CP}/duyet`, {
      ds: [{ ban_the_hien_id: bthId }],
    });
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.du_lieu.ds_ket_qua[0].ok).toBe(false);
    expect(j.du_lieu.ds_ket_qua[0].loi).toContain("XUNG_DOT_REVISION");
    const bth = layBanTheHien(app.db, bthId)!;
    expect(bth.trang_thai).toBe("nhap");
  });
});

describe("phát hiện thay đổi nguồn (#14) theo phạm vi", () => {
  moApp();

  test("sửa claim chung → cả biến thể US lẫn VN đánh dấu cũ", async () => {
    const cp = await layView();
    const dsClaim = cp.ds_claim.map((c: { id: string; noi_dung: string; nguon_id: string | null; muc_id: string | null }) =>
      c.id === "cl-trong-luong"
        ? { ...c, noi_dung: "Trọng lượng 218 g (size 42)." }
        : c,
    );
    const res = await put(`/api/campaign/${CP}`, { ten: cp.ten, ds_claim: dsClaim });
    expect(res.status).toBe(200);
    const sau = await layView();
    for (const tt of sau.thuong_hieu.ds_thi_truong) {
      for (const b of tt.ds_bien_the) {
        expect(b.la_cu).toBe(true);
      }
    }
    // Task sửa được tạo cho từng biến thể phụ thuộc.
    expect(
      danhSachTaskSua(app.db, { banTheHienId: "seed-bth-th-us-bai-viet" }).length,
    ).toBeGreaterThan(0);
    expect(
      danhSachTaskSua(app.db, { banTheHienId: "seed-bth-th-vn-caption" }).length,
    ).toBeGreaterThan(0);
  });

  test("sửa giá thị trường VN → chỉ biến thể VN bị đánh dấu, US không", async () => {
    // Biến thể mới sinh ghim thông điệp thị trường hiện tại — chờ job
    // xong để head revision có pin thật trước khi đổi giá.
    const us = await layTt("us");
    const vn = await layTt("vn");
    const j1 = await (
      await post(`/api/campaign/${CP}/to-hop`, {
        ds_chon: [{ thi_truong_id: us.id, dinh_dang: "newsletter", dich_den: "email-us" }],
      })
    ).json();
    const j2 = await (
      await post(`/api/campaign/${CP}/to-hop`, {
        ds_chon: [{ thi_truong_id: vn.id, dinh_dang: "newsletter", dich_den: "email-vn" }],
      })
    ).json();
    const bthUsId = j1.du_lieu.ds_ket_qua[0].ban_the_hien_id;
    const bthVnId = j2.du_lieu.ds_ket_qua[0].ban_the_hien_id;
    await choJob(j1.du_lieu.ds_ket_qua[0].job_id);
    await choJob(j2.du_lieu.ds_ket_qua[0].job_id);

    // Đổi giá VN — nguồn thị trường VN có revision mới.
    const resPut = await put(`/api/campaign/${CP}/thi-truong/${vn.id}`, {
      gia: "4.490.000",
    });
    expect(resPut.status).toBe(200);

    const cp = await layView();
    const vnV = cp.thuong_hieu.ds_thi_truong.find((t: { ma: string }) => t.ma === "vn");
    const usV = cp.thuong_hieu.ds_thi_truong.find((t: { ma: string }) => t.ma === "us");
    const btVn = vnV.ds_bien_the.find((b: { ban_the_hien_id: string }) => b.ban_the_hien_id === bthVnId);
    const btUs = usV.ds_bien_the.find((b: { ban_the_hien_id: string }) => b.ban_the_hien_id === bthUsId);
    // Biến thể VN ghim nguồn thị trường VN cũ → la_cu; US ghim nguồn
    // chung + nguồn US — cả hai không đổi → không cũ.
    expect(btVn.la_cu).toBe(true);
    expect(btUs.la_cu).toBe(false);
  });
});

describe("kiemTraDauRa cho thuong_hieu", () => {
  moApp();

  function ctxTh(thiTruong: object | null) {
    return {
      task: { id: "t", loai: "sinh_ban_the_hien" },
      thong_diep: { tieu_de: "t", noi_dung: "", revision_id: null },
      ds_nguon: [],
      dinh_dang: null,
      doi_tuong: "Runner phong trào (fixture)",
      ngon_ngu: "en",
      context_sinh: null,
      thieu_chung_cu: [],
      gioi_han_dau_ra: 4000,
      thuong_hieu: {
        ten: "Velocity Run 2 — ra mắt toàn cầu",
        thong_diep_loi: "td",
        dinh_vi: "dv",
        giong_van: "gv",
        cta: [],
        ds_claim: [
          { id: "cl-de-dem", noi_dung: "Đế đệm X-Return trả lại 80% năng lượng.", xac_nhan: true },
          { id: "cl-khi-dong", noi_dung: "Thiết kế khí động học giảm lực cản 12%.", xac_nhan: false },
        ],
        ds_asset_hinh: [],
        thi_truong: thiTruong,
      },
    } as unknown as Parameters<typeof kiemTraDauRa>[0];
  }

  const kq = (noi_dung: string) => ({ noi_dung, trich_dan: [], canh_bao: [] });

  test("thị trường chưa có giá/khả dụng: bịa giá hoặc khẳng định tồn kho → cảnh báo", () => {
    const ctx = ctxTh({ ten: "EU", co_gia: false, co_kha_dung: false, chi_tiet: null, cta_url: null, ds_ghi_de: [] });
    const sach = kiemTraDauRa(ctx, kq("Giày mới ra mắt."));
    expect(sach.canh_bao.filter((w: string) => w.includes("giá"))).toHaveLength(0);

    const biaGia = kiemTraDauRa(ctx, kq("Mua ngay với giá 199 USD tại EU."));
    expect(biaGia.canh_bao.some((w: string) => w.includes("chưa cung cấp giá"))).toBe(true);

    const biaKho = kiemTraDauRa(ctx, kq("The shoe is in stock now."));
    expect(biaKho.canh_bao.some((w: string) => w.includes("khả dụng"))).toBe(true);
  });

  test("giá đúng nhưng tự quy đổi tiền tệ → cảnh báo; claim chưa xác nhận ngoài câu hỏi → cảnh báo", () => {
    const ctx = ctxTh({
      ten: "Hoa Kỳ",
      gia: "189",
      tien_te: "USD",
      co_gia: true,
      co_kha_dung: true,
      chi_tiet: null,
      cta_url: null,
      ds_ghi_de: [],
    });
    const ok = kiemTraDauRa(ctx, kq("Giá 189 USD — in stock."));
    expect(ok.canh_bao.filter((w: string) => w.includes("tiền"))).toHaveLength(0);

    // Giữ số giá nhưng nhắc EUR → dấu hiệu tự quy đổi.
    const doiTien = kiemTraDauRa(ctx, kq("Giá 189 — khoảng 175 EUR."));
    expect(doiTien.canh_bao.some((w: string) => w.includes("quy đổi") || w.includes("tiền tệ"))).toBe(true);

    // Claim chưa xác nhận trình bày như fact → cảnh báo.
    const clBia = kiemTraDauRa(ctx, kq("Thiết kế khí động học giảm lực cản 12% cho đôi giày này. Giá 189 USD."));
    expect(clBia.canh_bao.some((w: string) => w.includes("cl-khi-dong"))).toBe(true);
    // ...còn trong dòng [CÂU HỎI] thì không cảnh báo.
    const clHoi = kiemTraDauRa(ctx, kq("[CÂU HỎI] Claim 'Thiết kế khí động học giảm lực cản 12%' chưa có bằng chứng nguồn. Giá 189 USD."));
    expect(clHoi.canh_bao.filter((w: string) => w.includes("cl-khi-dong"))).toHaveLength(0);
  });

  test("marker [CL:id] lạ và bỏ chi tiết local → cảnh báo", () => {
    const ctx = ctxTh({
      ten: "Hoa Kỳ",
      gia: "189",
      tien_te: "USD",
      co_gia: true,
      co_kha_dung: true,
      chi_tiet: "Free gait analysis at partner labs through October.",
      cta_url: null,
      ds_ghi_de: [],
    });
    const kqXau = kiemTraDauRa(ctx, kq("Giày tốt lắm [CL:cl-bia]. Giá 189 USD."));
    expect(kqXau.canh_bao.some((w: string) => w.includes("cl-bia"))).toBe(true);
    expect(kqXau.canh_bao.some((w: string) => w.includes("chi tiết"))).toBe(true);
  });
});
