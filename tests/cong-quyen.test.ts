import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { layDinhDang } from "../src/modules/formats/index.ts";
import { kiemTraDauRa, TASK, type ContextTask } from "../src/modules/generation/index.ts";
import { danhSachXuatBan, layBanTheHien, layRevision } from "../src/modules/content/index.ts";
import { danhSachTaskSua } from "../src/modules/thay_doi/index.ts";
import { enqueueJob, layJob } from "../src/modules/jobs/index.ts";
import { seed } from "../src/server/seed.ts";
import { taoServerTam } from "./helpers.ts";

// Test module công quyền (#11): campaign loai 'cong_quyen' — văn bản
// chính sách phiên bản + phạm vi + ngày hiệu lực, yêu cầu bắt buộc vs
// giải thích, ngoại lệ liên kết yêu cầu, fact vận hành, reviewer thẩm
// quyền của POC, điều khoản mơ hồ → câu hỏi review, đổi ngày hiệu lực
// → nhóm ảnh hưởng theo đích + job đã lên lịch bị chặn + duyệt cũ bị
// chặn server-side.

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

const CP = "seed-cp-cong-quyen-tai-che";

describe("campaign công quyền: model + view", () => {
  moApp();

  test("seed tạo campaign CQ: nguồn fact tự động + view phái sinh đầy đủ", async () => {
    const j = await getJ(`/api/campaign/${CP}`);
    const cp = j.du_lieu;
    expect(cp.loai).toBe("cong_quyen");
    expect(cp.phien_ban).toBe("QĐ-2027-15/UBND");
    expect(cp.ngay_hieu_luc).toBe("2027-01-01");
    expect(cp.nguon_cong_quyen_id).toBeTruthy();
    expect(cp.nguon_chinh_sach_id).toBe("seed-nguon-chinh-sach-tai-che");

    const cq = cp.cong_quyen;
    expect(cq).toBeTruthy();
    expect(cq.ds_yeu_cau_view).toHaveLength(5);
    expect(cq.ds_yeu_cau_view.filter((x: { co_bang_chung: boolean }) => x.co_bang_chung)).toHaveLength(4);
    expect(cq.ds_ngoai_le_view).toHaveLength(2);
    expect(cq.ds_ngoai_le_view.every((x: { co_bang_chung: boolean }) => x.co_bang_chung)).toBe(true);
    expect(cq.ds_fact_van_hanh_view).toHaveLength(2);
    expect(cq.ds_nguoi_duyet).toHaveLength(2);
    expect(cq.che_do_bao_ve).toBe(1);
    // Điều 5 xử phạt cố ý mơ hồ → câu hỏi review.
    expect(cq.dieu_khoan_mo_ho.length).toBeGreaterThan(0);
    expect(cq.dieu_khoan_mo_ho[0].danh_dau).toBeTruthy();
    // 5 đầu ra pin đúng revision chính sách đầu tiên.
    expect(cq.dau_ra).toHaveLength(5);
    expect(
      cq.dau_ra.every(
        (d: { revision_chinh_sach: { so_thu_tu: number } | null }) =>
          d.revision_chinh_sach?.so_thu_tu === 1,
      ),
    ).toBe(true);
    // Reviewer thẩm quyền ghi trên record duyệt của FAQ.
    const faq = cq.dau_ra.find(
      (d: { ban_the_hien_id: string }) => d.ban_the_hien_id === "seed-bth-cq-faq",
    );
    expect(faq.nguoi_duyet_cuoi?.id).toBe("nd-lan");
  });

  test("validation: ngày hiệu lực sai định dạng → 400 VALIDATION", async () => {
    const res = await post("/api/campaign", {
      loai: "cong_quyen",
      ten: "CQ test",
      ngay_hieu_luc: "2027/03/01",
    });
    expect(res.status).toBe(400);
    const j = await res.json();
    expect(j.loi.ma).toBe("VALIDATION");
    expect(j.loi.chi_tiet.join(" ")).toContain("ngay_hieu_luc");
  });

  test("validation: ngoại lệ trỏ yêu cầu không tồn tại → 400", async () => {
    const res = await post("/api/campaign", {
      loai: "cong_quyen",
      ten: "CQ test",
      ds_yeu_cau: [
        {
          id: "yc-a",
          noi_dung: "Nghĩa vụ A",
          loai: "bat_buoc",
          doi_tuong_ap_dung: "",
          nguon_id: null,
          muc_id: null,
        },
      ],
      ds_ngoai_le: [
        {
          id: "nl-a",
          noi_dung: "Ngoại lệ cho nghĩa vụ không tồn tại",
          yeu_cau_id: "yc-khong-co",
          nguon_id: null,
          muc_id: null,
        },
      ],
    });
    expect(res.status).toBe(400);
    const j = await res.json();
    expect(j.loi.ma).toBe("VALIDATION");
    expect(j.loi.chi_tiet.join(" ")).toContain("yc-khong-co");
  });

  test("infer loai từ key riêng của công quyền (pham_vi_quyen_han)", async () => {
    const res = await post("/api/campaign", {
      ten: "CQ infer test",
      pham_vi_quyen_han: "Địa bàn test",
      ngay_hieu_luc: "2027-01-01",
    });
    expect(res.status).toBe(201);
    const j = await res.json();
    expect(j.du_lieu.loai).toBe("cong_quyen");
  });

  test("mục lục đề xuất: 4 đầu ra mặc định + bản dịch khi có ngôn ngữ phụ", async () => {
    const j = await getJ(`/api/campaign/${CP}`);
    const mucLuc = j.du_lieu.muc_luc as { id: string; dinh_dang: string }[];
    const ids = mucLuc.map((m) => m.id);
    expect(ids).toContain("cq-faq-ho-gia-dinh");
    expect(ids).toContain("cq-checklist-doanh-nghiep");
    expect(ids).toContain("cq-giai-thich-truong-hoc");
    expect(ids).toContain("cq-tom-tat-nha-thau");
    expect(ids).toContain("cq-ban-dich");
  });
});

// Đổi ngày hiệu lực 2027-01-01 → 2027-03-01: mọi đầu ra cũ, nhóm ảnh
// hưởng tách theo đích, job đã lên lịch bị chặn, duyệt ghim revision
// cũ bị chặn server-side — rồi một vòng sửa đầu-cuối.
describe("đổi ngày hiệu lực → vô hiệu hóa nguồn phụ thuộc (#14)", () => {
  moApp();
  let phatHien: Record<string, unknown> | null = null;

  test("PUT ngày hiệu lực → phát hiện thay đổi + tạo task sửa", async () => {
    // PUT là cập nhật đầy đủ: 'ten' bắt buộc gửi lại kèm field đổi.
    const res = await put(`/api/campaign/${CP}`, {
      ten: "Luật tái chế thành phố An Khang",
      ngay_hieu_luc: "2027-03-01",
    });
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.du_lieu.ngay_hieu_luc).toBe("2027-03-01");
    phatHien = j.du_lieu.phat_hien;
    expect(phatHien).toBeTruthy();
    expect((phatHien as { thay_doi: unknown }).thay_doi).toBeTruthy();
    expect(
      (phatHien as { ds_task: unknown[] }).ds_task.length,
    ).toBeGreaterThan(0);
  });

  test("nhóm ảnh hưởng tách đúng 4 đích và mọi đầu ra đánh dấu cũ", async () => {
    const cq = (await getJ(`/api/campaign/${CP}`)).du_lieu.cong_quyen;
    const ids = (g: { ban_the_hien_id: string }[]) => g.map((x) => x.ban_the_hien_id);
    // Nháp: chưa xuất bản lần nào.
    expect(ids(cq.anh_huong.nhap)).toEqual(
      expect.arrayContaining([
        "seed-bth-cq-truong-hoc",
        "seed-bth-cq-nha-thau",
        "seed-bth-cq-ban-dich",
      ]),
    );
    // Đã xuất: có record xuất bản (trang /p đang phục vụ).
    expect(ids(cq.anh_huong.da_xuat)).toEqual(
      expect.arrayContaining(["seed-bth-cq-faq", "seed-bth-cq-checklist"]),
    );
    // Đã lên lịch: job cho/loi mang chay_som_nhat.
    expect(ids(cq.anh_huong.da_len_lich)).toContain("seed-bth-cq-truong-hoc");
    // Đã đăng: xuất bản kèm dich_den — copy tay ngoài.
    expect(ids(cq.anh_huong.da_dang)).toEqual(["seed-bth-cq-checklist"]);
    const dang = cq.anh_huong.da_dang[0];
    expect(dang.ds_xuat_ban[0].dich_den).toBe("cong-thong-tin");
    // Mọi đầu ra ghim revision chính sách cũ (rev 1 ≠ head mới).
    expect(cq.dau_ra.every((d: { la_cu: boolean }) => d.la_cu)).toBe(true);
  });

  test("task sửa phân loại đúng: đã xuất → thu_cong, chưa xuất → sinh_lai", async () => {
    const taskFaq = danhSachTaskSua(app.db, { banTheHienId: "seed-bth-cq-faq" });
    expect(taskFaq.some((t) => t.loai === "thu_cong")).toBe(true);
    const taskNhaThau = danhSachTaskSua(app.db, { banTheHienId: "seed-bth-cq-nha-thau" });
    expect(taskNhaThau.some((t) => t.loai === "sinh_lai")).toBe(true);
    // Task thu_cong nêu rõ sửa tay, không khẳng định cập nhật từ xa.
    expect(taskFaq.find((t) => t.loai === "thu_cong")!.ly_do).toContain("bằng tay");
  });

  test("duyệt đầu ra ghim chính sách cũ → 409 XUNG_DOT_REVISION", async () => {
    const bth = layBanTheHien(app.db, "seed-bth-cq-truong-hoc")!;
    const res = await post("/api/ban-the-hien/seed-bth-cq-truong-hoc/trang-thai", {
      trang_thai: "da_duyet",
      mong_doi_revision_id: bth.head_revision_id,
      nguoi_duyet_id: "nd-lan",
    });
    expect(res.status).toBe(409);
    const j = await res.json();
    expect(j.loi.ma).toBe("XUNG_DOT_REVISION");
  });

  test("job đã lên lịch ghim nguồn cũ bị chặn khi chạy", async () => {
    const bth = layBanTheHien(app.db, "seed-bth-cq-nha-thau")!;
    // Job có lịch (chay_som_nhat) ghim revision đang pin chính sách cũ.
    const { job } = enqueueJob(app.db, {
      loai: "sinh_ban_the_hien",
      khoaIdem: `test-lich-cu:${crypto.randomUUID()}`,
      entityLoai: "ban_the_hien",
      entityId: bth.id,
      revisionId: bth.head_revision_id,
      payload: { ban_the_hien_id: bth.id, campaign_id: CP, doi_tuong: bth.doi_tuong },
      chaySomNhat: new Date(Date.now() - 1000).toISOString(),
    });
    const xong = await choJob(job.id);
    expect(xong.trang_thai).toBe("loi");
    expect(xong.loi).toContain("ghim nguồn cũ");
  });

  test("chế độ bảo vệ: reviewer sai → 400; thiếu reviewer trên bản cũ → guard cũ chặn trước (409)", async () => {
    const bth = layBanTheHien(app.db, "seed-bth-cq-faq")!;
    // Bản đang ghim chính sách cũ: thiếu nguoi_duyet_id → guard 'cũ'
    // (409) chặn trước check bảo vệ; bản đã sửa mới lòi 400 — xem test
    // sinh_lai phía dưới.
    const khongNguoi = await post("/api/ban-the-hien/seed-bth-cq-faq/trang-thai", {
      trang_thai: "da_duyet",
      mong_doi_revision_id: bth.head_revision_id,
    });
    // Reviewer không nằm trong ds_nguoi_duyet → 400 VALIDATION.
    const saiNguoi = await post("/api/ban-the-hien/seed-bth-cq-faq/trang-thai", {
      trang_thai: "da_duyet",
      mong_doi_revision_id: bth.head_revision_id,
      nguoi_duyet_id: "nd-khong-co",
    });
    expect(saiNguoi.status).toBe(400);
    expect((await saiNguoi.json()).loi.ma).toBe("VALIDATION");
    expect(khongNguoi.status).toBe(409);
  });

  // Vòng sửa đầu-cuối trên nháp: task sinh_lai → đề xuất → job sinh lại
  // pin chính sách mới → gửi duyệt → duyệt ghi reviewer thẩm quyền.
  test("sinh_lai task → revision mới pin chính sách mới → duyệt ghi reviewer", async () => {
    const task = danhSachTaskSua(app.db, { banTheHienId: "seed-bth-cq-nha-thau" }).find(
      (t) => t.loai === "sinh_lai",
    )!;
    const res = await post(`/api/task-sua/${task.id}/de-xuat`, {});
    expect(res.status).toBe(200);
    const j = await res.json();
    const job = j.du_lieu.job;
    const xong = await choJob(job.id);
    expect(xong.trang_thai).toBe("xong");

    const bth = layBanTheHien(app.db, "seed-bth-cq-nha-thau")!;
    const rev = layRevision(app.db, bth.head_revision_id!)!;
    const tdRev = rev.thong_diep_revision_id;
    // Head revision mới ghim thong_diep revision mới (pin nguồn rev 2)
    // → không còn 'cũ'; nội dung giữ nguyên ngày hiệu lực MỚI.
    const cq = (await getJ(`/api/campaign/${CP}`)).du_lieu.cong_quyen;
    const dongNhaThau = cq.dau_ra.find(
      (d: { ban_the_hien_id: string }) => d.ban_the_hien_id === "seed-bth-cq-nha-thau",
    );
    expect(dongNhaThau.la_cu).toBe(false);
    expect(dongNhaThau.revision_chinh_sach?.so_thu_tu).toBe(2);
    expect(rev.noi_dung).toContain("2027-03-01");
    expect(rev.noi_dung).toContain("[YC:yc-phan-loai]");
    expect(rev.noi_dung).toContain("CÂU HỎI");
    expect(tdRev).toBeTruthy();

    // Gửi duyệt → duyệt thiếu reviewer (bảo vệ bật) → 400 → duyệt với
    // reviewer hợp lệ → 200 và record ghi nguoi_duyet_id.
    const gui = await post("/api/ban-the-hien/seed-bth-cq-nha-thau/trang-thai", {
      trang_thai: "cho_duyet",
    });
    expect(gui.status).toBe(200);
    const thieuNguoi = await post("/api/ban-the-hien/seed-bth-cq-nha-thau/trang-thai", {
      trang_thai: "da_duyet",
      mong_doi_revision_id: bth.head_revision_id,
    });
    expect(thieuNguoi.status).toBe(400);
    const duyet = await post("/api/ban-the-hien/seed-bth-cq-nha-thau/trang-thai", {
      trang_thai: "da_duyet",
      mong_doi_revision_id: bth.head_revision_id,
      nguoi_duyet_id: "nd-hung",
    });
    expect(duyet.status).toBe(200);
    const cqSau = (await getJ(`/api/campaign/${CP}`)).du_lieu.cong_quyen;
    expect(
      cqSau.dau_ra.find(
        (d: { ban_the_hien_id: string }) => d.ban_the_hien_id === "seed-bth-cq-nha-thau",
      ).nguoi_duyet_cuoi?.id,
    ).toBe("nd-hung");
  });

  // Bản đã xuất/đăng: task thu_cong từ chối đề xuất sinh lại (file/copy
  // ngoài sửa tay); trang Mai đã đăng cần revision thay thế đã review —
  // lần xuất bản trước vẫn audit được qua xuat_ban.revision_id.
  test("đã đăng: thu_cong 409 + revision thay thế đã review + audit giữ xuất bản cũ", async () => {
    const taskDang = danhSachTaskSua(app.db, { banTheHienId: "seed-bth-cq-checklist" }).find(
      (t) => t.loai === "thu_cong",
    )!;
    const res409 = await post(`/api/task-sua/${taskDang.id}/de-xuat`, {});
    expect(res409.status).toBe(409);

    // Sinh lại trong MAI (job ad-hoc không lịch → không bị guard chặn)
    // → revision thay thế pin chính sách mới.
    const bth = layBanTheHien(app.db, "seed-bth-cq-checklist")!;
    const truoc = danhSachXuatBan(app.db, bth.id);
    expect(truoc).toHaveLength(1);
    const { job } = enqueueJob(app.db, {
      loai: "sinh_ban_the_hien",
      khoaIdem: `test-sinh-lai:${crypto.randomUUID()}`,
      entityLoai: "ban_the_hien",
      entityId: bth.id,
      revisionId: bth.head_revision_id,
      payload: {
        ban_the_hien_id: bth.id,
        campaign_id: CP,
        doi_tuong: bth.doi_tuong,
        thuong_hieu_id: "seed-th-so-ban-an-khang",
        doi_tuong_id: "seed-dt-co-so-kinh-doanh",
      },
    });
    const xong = await choJob(job.id);
    expect(xong.trang_thai).toBe("xong");

    // Đưa revision mới qua lại luồng review đúng contract (da_duyet →
    // nhap → cho_duyet → da_duyet) rồi xuất bản lại — xuat_ban là
    // append-only: lần đăng trước vẫn audit được.
    const bthMoi = layBanTheHien(app.db, bth.id)!;
    const veNhap = await post(`/api/ban-the-hien/${bth.id}/trang-thai`, {
      trang_thai: "nhap",
    });
    expect(veNhap.status).toBe(200);
    const gui = await post(`/api/ban-the-hien/${bth.id}/trang-thai`, {
      trang_thai: "cho_duyet",
    });
    expect(gui.status).toBe(200);
    const duyet = await post(`/api/ban-the-hien/${bth.id}/trang-thai`, {
      trang_thai: "da_duyet",
      mong_doi_revision_id: bthMoi.head_revision_id,
      nguoi_duyet_id: "nd-lan",
    });
    expect(duyet.status).toBe(200);
    const xb = await post(`/api/ban-the-hien/${bth.id}/xuat-ban`, {
      dich_den: "cong-thong-tin",
    });
    expect(xb.status).toBe(201);
    const sau = danhSachXuatBan(app.db, bth.id);
    expect(sau).toHaveLength(2);
    expect(sau[0]!.revision_id).not.toBe(sau[1]!.revision_id);
  });
});

// Kiểm chứng đầu ra công quyền: marker bằng chứng, phân biệt bắt buộc
// vs giải thích, ngoại lệ/ngày/phạm vi giữ nguyên, mục chưa xác nhận
// chỉ để câu hỏi.
function ctxCongQuyen(ngonNgu = "vi"): ContextTask {
  return {
    task: TASK.nhap_ban_the_hien,
    thong_diep: { tieu_de: "Chính sách X", noi_dung: "", revision_id: null },
    ds_nguon: [],
    dinh_dang: layDinhDang("faq-cong-dan"),
    doi_tuong: "hộ gia đình",
    ngon_ngu: ngonNgu,
    context_sinh: null,
    thieu_chung_cu: [],
    gioi_han_dau_ra: 100_000,
    cong_quyen: {
      ten: "X",
      phien_ban: "QĐ-01",
      pham_vi_quyen_han: "Địa bàn thành phố T",
      ngay_hieu_luc: "2027-01-01",
      ngon_ngu_phu: "en",
      cta: [],
      ds_yeu_cau: [
        {
          id: "yc-1",
          noi_dung: "Hộ gia đình phải phân loại rác thành 3 nhóm trước khi đổ",
          loai: "bat_buoc",
          doi_tuong_ap_dung: "ho_gia_dinh",
          nguon_id: "n1",
          muc_id: null,
          xac_nhan: true,
        },
        {
          id: "yc-2",
          noi_dung: "Lịch thu gom từng tuyến phố theo công bố của phường",
          loai: "giai_thich",
          doi_tuong_ap_dung: "",
          nguon_id: null,
          muc_id: null,
          xac_nhan: false,
        },
      ],
      ds_ngoai_le: [
        {
          id: "nl-1",
          noi_dung: "Hộ khẩu tạm trú được gia hạn thêm 6 tháng kể từ ngày hiệu lực",
          yeu_cau_id: "yc-1",
          nguon_id: "n1",
          muc_id: null,
          xac_nhan: true,
        },
      ],
      ds_fact_van_hanh: [
        {
          id: "fv-1",
          tieu_de: "Điểm thu gom",
          noi_dung: "Điểm thu tại công viên trung tâm mở 6h-18h",
          nguon_id: "n2",
          muc_id: null,
          xac_nhan: true,
        },
      ],
      dieu_khoan_mo_ho: [],
    },
  };
}

describe("kiểm chứng đầu ra công quyền", () => {
  const noiDungDayDu = JSON.stringify({
    tieu_de: "FAQ test",
    hoi_dap: ["Hỏi: phải làm gì? Đáp: phân loại 3 nhóm. [YC:yc-1]"],
    yeu_cau: [
      "Hộ gia đình phải phân loại rác thành 3 nhóm trước khi đổ [BẮT BUỘC] [YC:yc-1]",
      "[CÂU HỎI: yêu cầu 'Lịch thu gom từng tuyến phố theo công bố của phường' chưa có bằng chứng nguồn.]",
    ],
    ngoai_le: [
      "Hộ khẩu tạm trú được gia hạn thêm 6 tháng kể từ ngày hiệu lực [NL:nl-1]",
    ],
    pham_vi: "Địa bàn thành phố T",
    ngay_hieu_luc: "2027-01-01",
    hoi_them: "Đường dây nóng: 1900-0000",
  });

  test("đầu ra đủ marker + ngày/phạm vi nguyên văn → hợp lệ", () => {
    const kt = kiemTraDauRa(ctxCongQuyen(), {
      noi_dung: noiDungDayDu,
      trich_dan: [],
      canh_bao: [],
    });
    expect(kt.hop_le).toBe(true);
    expect(kt.canh_bao).toHaveLength(0);
  });

  test("thiếu ngày hiệu lực / marker trỏ mục lạ / bỏ ngoại lệ → cảnh báo", () => {
    const kt = kiemTraDauRa(ctxCongQuyen(), {
      noi_dung: JSON.stringify({
        tieu_de: "FAQ test",
        hoi_dap: ["Hỏi: phải làm gì? Đáp: phân loại. [YC:yc-ao]"],
        yeu_cau: ["Hộ gia đình phải phân loại rác thành 3 nhóm trước khi đổ [YC:yc-1]"],
        ngoai_le: [],
        pham_vi: "Địa bàn thành phố T",
        // Có giá trị (đủ điều kiện trường bắt buộc) nhưng không giữ
        // nguyên ngày '2027-01-01' → cảnh báo giữ-nguyên-ngày.
        ngay_hieu_luc: "đang cập nhật",
      }),
      trich_dan: [],
      canh_bao: [],
    });
    expect(kt.hop_le).toBe(true); // cảnh báo, không lỗi cứng
    const all = kt.canh_bao.join(" | ");
    expect(all).toContain("yc-ao");
    expect(all).toContain("ngày hiệu lực");
    // Nhắc yc-1 mà bỏ ngoại lệ nl-1 liên kết.
    expect(all).toContain("nl-1");
    // Trường ngoai_le thiếu mục.
    expect(all).toContain("ngoai_le");
  });

  test("mục chưa xác nhận trình bày như quy định → cảnh báo; để câu hỏi → không", () => {
    const kt = kiemTraDauRa(ctxCongQuyen(), {
      noi_dung: JSON.stringify({
        tieu_de: "FAQ test",
        hoi_dap: [],
        yeu_cau: [
          "Hộ gia đình phải phân loại rác thành 3 nhóm trước khi đổ [YC:yc-1]",
          "Lịch thu gom từng tuyến phố theo công bố của phường — mọi hộ phải theo.", // chưa xác nhận mà viết như quy định
        ],
        ngoai_le: ["Hộ khẩu tạm trú được gia hạn thêm 6 tháng kể từ ngày hiệu lực [NL:nl-1]"],
        pham_vi: "Địa bàn thành phố T",
        ngay_hieu_luc: "2027-01-01",
      }),
      trich_dan: [],
      canh_bao: [],
    });
    expect(kt.canh_bao.join(" | ")).toContain("yc-2");
  });

  test("bản dịch en giữ nguyên ngày hiệu lực; phạm vi không bắt buộc verbatim", () => {
    const kt = kiemTraDauRa(ctxCongQuyen("en"), {
      noi_dung: JSON.stringify({
        tieu_de: "Citizen FAQ",
        hoi_dap: ["Q: what to do? A: sort into 3 groups. [YC:yc-1]"],
        yeu_cau: ["Sort household waste into 3 groups before drop-off. [YC:yc-1]"],
        ngoai_le: ["Temporary residents get a 6-month extension. [NL:nl-1]"],
        pham_vi: "All of city T",
        ngay_hieu_luc: "2027-01-01",
      }),
      trich_dan: [],
      canh_bao: [],
    });
    expect(kt.canh_bao.join(" | ")).not.toContain("phạm vi quyền hạn");
    const ktThieuNgay = kiemTraDauRa(ctxCongQuyen("en"), {
      noi_dung: JSON.stringify({
        tieu_de: "Citizen FAQ",
        hoi_dap: [],
        yeu_cau: [],
        ngoai_le: [],
        pham_vi: "x",
        ngay_hieu_luc: "2027",
      }),
      trich_dan: [],
      canh_bao: [],
    });
    expect(ktThieuNgay.canh_bao.join(" | ")).toContain("ngày hiệu lực");
  });
});

// Finding review PR #49: campaign CQ hợp lệ nhưng thiếu yêu cầu
// 'bat_buoc' (ds_yeu_cau rỗng, hoặc chỉ khai báo giải thích) làm fixture
// trả các field ràng buộc (yeu_cau/hoi_dap/cac_buoc/nghia_vu) rỗng →
// kiểm chứng lỗi cứng và job sinh lỗi vĩnh viễn. Fix: field rỗng rơi về
// một dòng [CÂU HỎI] thẩm quyền — mơ hồ/thiếu là câu hỏi review, không
// phải luật bịa cũng không phải lỗi job.
describe("campaign CQ thiếu yêu cầu bắt buộc vẫn sinh được", () => {
  moApp();

  const DAU_RA = [
    { id: "m-faq", tieu_de: "FAQ", dinh_dang: "faq-cong-dan", ngon_ngu: "vi" },
    { id: "m-check", tieu_de: "Checklist", dinh_dang: "checklist-doanh-nghiep", ngon_ngu: "vi" },
    { id: "m-th", tieu_de: "Trường học", dinh_dang: "giai-thich-truong-hoc", ngon_ngu: "vi" },
    { id: "m-nt", tieu_de: "Nhà thầu", dinh_dang: "tom-tat-nha-thau", ngon_ngu: "vi" },
    { id: "m-bd", tieu_de: "Bản dịch", dinh_dang: "ban-dich-gian-di", ngon_ngu: "vi" },
  ];

  const taoCpSinh = async (duLieuThem: Record<string, unknown>) => {
    const res = await post("/api/campaign", {
      ten: "CQ thiếu yêu cầu bắt buộc",
      ngay_hieu_luc: "2027-06-01",
      pham_vi_quyen_han: "Địa bàn test",
      muc_luc: DAU_RA,
      ...duLieuThem,
    });
    expect(res.status).toBe(201);
    const cp = (await res.json()).du_lieu;
    const chon = await post(`/api/campaign/${cp.id}/chon`, {
      ds_muc_id: DAU_RA.map((m) => m.id),
    });
    expect(chon.status).toBe(200);
    return (await chon.json()).du_lieu;
  };

  const choTatCaJob = async (dsJob: { id: string }[]) => {
    for (const job of dsJob) {
      const xong = await choJob(job.id);
      expect(xong.trang_thai).toBe("xong");
    }
  };

  const noiDungDauRa = (dsBth: { id: string; dinh_dang: string }[], dd: string) => {
    const bth = dsBth.find((b) => b.dinh_dang === dd)!;
    const rev = layRevision(app.db, layBanTheHien(app.db, bth.id)!.head_revision_id!)!;
    return JSON.parse(rev.noi_dung) as Record<string, unknown>;
  };

  test("ds_yeu_cau rỗng → 5 job xong; field ràng buộc là câu hỏi thẩm quyền", async () => {
    const d = await taoCpSinh({ ds_yeu_cau: [] });
    await choTatCaJob(d.ds_job);
    const faq = noiDungDauRa(d.ds_bth, "faq-cong-dan");
    expect((faq.yeu_cau as string[])[0]).toContain("CÂU HỎI");
    expect((faq.hoi_dap as string[])[0]).toContain("CÂU HỎI");
    const check = noiDungDauRa(d.ds_bth, "checklist-doanh-nghiep");
    expect((check.cac_buoc as string[])[0]).toContain("CÂU HỎI");
    const nt = noiDungDauRa(d.ds_bth, "tom-tat-nha-thau");
    expect((nt.nghia_vu as string[])[0]).toContain("CÂU HỎI");
  });

  test("chỉ yêu cầu giai_thich → 5 job xong; cac_buoc/nghia_vu vẫn là câu hỏi", async () => {
    const d = await taoCpSinh({
      ds_yeu_cau: [
        {
          id: "yc-gt",
          loai: "giai_thich",
          noi_dung: "Chính sách khuyến khích phân loại rác tại nguồn.",
          doi_tuong_ap_dung: "",
        },
      ],
    });
    await choTatCaJob(d.ds_job);
    const check = noiDungDauRa(d.ds_bth, "checklist-doanh-nghiep");
    expect((check.cac_buoc as string[])[0]).toContain("CÂU HỎI");
    expect((check.yeu_cau as string[]).join("\n")).toContain("phân loại rác");
    const nt = noiDungDauRa(d.ds_bth, "tom-tat-nha-thau");
    expect((nt.nghia_vu as string[])[0]).toContain("CÂU HỎI");
  });
});
