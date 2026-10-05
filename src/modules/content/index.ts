import type { Database } from "bun:sqlite";
import { LoiApi, loiRequest } from "../../loi.ts";
import { DANH_SACH_TRANG_THAI, chuyenHopLe, laTrangThai } from "../review/index.ts";
import type { GhiDeCampaign } from "../context/index.ts";
import { layDinhDang } from "../formats/index.ts";

// Module nội dung: contract dữ liệu dùng chung cho mọi story MAI.
//
// - nguon: tài liệu nguồn cấp instance; entity giữ state hiện tại,
//   nguon_revision là snapshot immutable (pattern giống hồ sơ/ho_so_revision).
//   cac_muc chứa định danh fact/section có cấu trúc + tham chiếu asset.
// - campaign: nhóm mục tiêu tùy chọn; bài đăng lẻ không bắt buộc campaign.
// - thong_diep: thông điệp chuẩn; nhiều-nhiều với nguồn qua thong_diep_nguon.
//   thong_diep_revision ghim nguon_revision_ids đã dùng → truy về đúng nguồn.
// - ban_the_hien: một đầu ra của thông điệp theo (định dạng, ngôn ngữ,
//   đối tượng, đích đến); revision nội dung ghim revision thông điệp +
//   context sinh đã dùng khi sinh.
// - duyet/xuat_ban: record review theo revision và record xuất bản tách
//   khỏi trạng thái nội dung — được sinh không đồng nghĩa đã đăng.
// - su_kien: log mutation nhẹ kèm actor local; #16 gắn authorization sau.

// --- Kiểu ---

export const DANH_SACH_LOAI_MUC = ["section", "fact"] as const;
export type LoaiMuc = (typeof DANH_SACH_LOAI_MUC)[number];

// Một mục trong nguồn: định danh ổn định để ticket sau (vd #14) tham chiếu
// đúng fact/section khi nguồn đổi. assets = tên file trong MAI_DATA_DIR/assets.
export type MucNguon = {
  id: string;
  loai: LoaiMuc;
  tieu_de?: string;
  noi_dung: string;
  assets: string[];
};

export type Nguon = {
  id: string;
  tieu_de: string;
  noi_dung: string;
  loai: string;
  cac_muc: MucNguon[];
  head_revision_id: string | null;
  tao_luc: string;
  tao_boi: string;
  cap_nhat_luc: string;
};

export type NguonRevision = {
  id: string;
  nguon_id: string;
  so_thu_tu: number;
  tieu_de: string;
  loai: string;
  noi_dung: string;
  cac_muc: MucNguon[];
  dua_tren_revision_id: string | null;
  khoa_idem: string | null;
  tao_luc: string;
  tao_boi: string;
};

// Một tham chiếu nguồn được khai báo trên số báo (#8): tên đoạn + bản dịch
// đã chọn + nguon_id trỏ vào thư viện nguồn (văn bản thật để đối chiếu
// trích dẫn). nguon_id null = chưa có văn bản nguồn → gắn cờ, không để
// bộ sinh bịa trích dẫn.
export type ThamChieu = {
  id: string;
  tham_chieu: string;
  ban_dich: string;
  nguon_id: string | null;
  ghi_chu: string;
};

// Một mục trong mục lục đề xuất của số báo (#8): khay bài/đầu ra biên tập
// sửa được. Khi được chọn, mục map tới một ban_the_hien có danh tính
// (thong_diep, dinh_dang, ngon_ngu, doi_tuong, dich_den).
// ngon_ngu tùy chọn (#10) — mặc định 'vi'; chỉ khác 'vi' khi mục là bản
// ngôn ngữ thứ hai của campaign gây quỹ.
export type MucLuc = {
  id: string;
  tieu_de: string;
  dinh_dang: string;
  doi_tuong_id: string | null;
  dich_den: string;
  ngon_ngu?: string;
  ly_do: string;
};

// Loại campaign: '' = campaign thường, 'so_bao' = số báo (#8),
// 'phat_hanh' = bản phát hành phần mềm (#9), 'gay_quy' = chiến dịch gây
// quỹ nonprofit (#10), 'cong_quyen' = cơ quan giải thích chính sách
// (#11), 'thuong_hieu' = chiến dịch thương hiệu đa thị trường (#12).
// Giá trị do api.ts validate.
export const DANH_SACH_LOAI_CAMPAIGN = [
  "so_bao",
  "phat_hanh",
  "gay_quy",
  "cong_quyen",
  "thuong_hieu",
] as const;

// Giới hạn gói/vùng/khả dụng của bản phát hành (#9): tinh_nang = tên tính
// năng bị giới hạn; mo_ta = câu phải hiển thị trên đầu ra bị ảnh hưởng.
// loai: 'goi' | 'vung' | 'kha_dung' | '' (chung/khác).
export type GioiHanPhatHanh = {
  id: string;
  tinh_nang: string;
  loai: string;
  mo_ta: string;
};

// Link CTA sửa được của bản phát hành (#9): trỏ đúng trang docs, nâng cấp
// hay hỗ trợ. loai: 'tai_lieu' | 'nang_cap' | 'ho_tro' | ''.
export type CtaLienKet = {
  id: string;
  nhan: string;
  loai: string;
  url: string;
};

// Fact tính năng của bản phát hành (#9): mọi claim trong đầu ra phải truy
// về một fact. nguon_id + muc_id trỏ mục nguồn đã nạp làm bằng chứng;
// null = fact chưa xác nhận → bộ sinh phải để [CÂU HỎI], không bịa.
export type FactPhatHanh = {
  id: string;
  tinh_nang: string;
  noi_dung: string;
  nguon_id: string | null;
  muc_id: string | null;
};

// --- Chiến dịch gây quỹ (#10) ---

// Một tác động đã đạt hoặc ước tính: khác biệt trang_thai bắt buộc để
// đầu ra không trộn lẫn fact đã đo với ước tính. so_lieu + don_vi là
// định lượng khai báo (vd "1.240" + "người") — bản dịch giữ nguyên.
// nguon_id + muc_id trỏ mục nguồn đã nạp làm bằng chứng; null = chưa
// xác nhận → đầu ra chỉ để [CÂU HỎI].
export type TacDongGayQuy = {
  id: string;
  tieu_de: string;
  noi_dung: string;
  trang_thai: string; // 'da_dat' | 'uoc_tinh'
  so_lieu: string;
  don_vi: string;
  nguon_id: string | null;
  muc_id: string | null;
};

// Trích dẫn/lời chứng thực được phép dùng trong câu chuyện nhân văn:
// ten_nguoi + loi bắt buộc, kèm nguồn tư liệu đã nạp. Đầu ra trích lời
// không khớp danh sách này hay văn bản nguồn là cảnh báo review.
export type TrichDanGayQuy = {
  id: string;
  ten_nguoi: string;
  loi: string;
  nguon_id: string | null;
  muc_id: string | null;
};

// Ghi chú quyền/đồng ý sử dụng cho một asset do tổ chức cung cấp (#10):
// asset_id trỏ asset trong kho; ghi_chu là phạm vi được cho phép — hiển
// thị khi review đầu ra đính kèm asset đó.
export type GhiChuQuyen = {
  id: string;
  asset_id: string;
  ghi_chu: string;
};

// --- Chiến dịch công quyền (#11) ---

// Một yêu cầu hoặc điểm giải thích của chính sách: loai phân biệt yêu
// cầu bắt buộc với ngôn ngữ giải thích — giải thích trình bày như nghĩa
// vụ là cảnh báo review. doi_tuong_ap_dung = nhóm đối tượng chịu yêu
// cầu ('' = chung). nguon_id + muc_id trỏ mục nguồn chính sách làm
// bằng chứng; null = chưa xác nhận → đầu ra chỉ để [CÂU HỎI].
export type YeuCauCongQuyen = {
  id: string;
  noi_dung: string;
  loai: string; // 'bat_buoc' | 'giai_thich'
  doi_tuong_ap_dung: string;
  nguon_id: string | null;
  muc_id: string | null;
};

// Ngoại lệ của chính sách: yeu_cau_id trỏ yêu cầu nó sửa ('' = ngoại
// lệ chung). Đơn giản hóa/dịch phải giữ ngoại lệ nguyên — đầu ra nhắc
// yêu cầu mà bỏ ngoại lệ là cảnh báo review.
export type NgoaiLeCongQuyen = {
  id: string;
  noi_dung: string;
  yeu_cau_id: string;
  nguon_id: string | null;
  muc_id: string | null;
};

// Fact vận hành hỗ trợ chính sách (lịch thu gom, điểm thu, hotline):
// fact chính sách đã duyệt là ràng buộc — bản dịch giữ nguyên số/giờ.
export type FactVanHanh = {
  id: string;
  tieu_de: string;
  noi_dung: string;
  nguon_id: string | null;
  muc_id: string | null;
};

// Reviewer local được ghi trong POC (#11): người chấm thẩm quyền của
// cơ quan — duyệt công quyền ghi ai trong danh sách này đã chấm.
// #12 dùng lại shape này cho reviewer local của từng thị trường.
export type NguoiDuyetCongQuyen = {
  id: string;
  ten: string;
  vai_tro: string;
};

// --- Chiến dịch thương hiệu toàn cầu (#12) ---

// Claim sản phẩm đã duyệt dùng chung mọi thị trường: nguon_id + muc_id
// trỏ mục nguồn đã nạp làm bằng chứng; null = chưa xác nhận → bộ sinh
// để [CÂU HỎI], không bịa claim hiệu năng/sức khỏe.
export type ClaimThuongHieu = {
  id: string;
  noi_dung: string;
  nguon_id: string | null;
  muc_id: string | null;
};

// Asset hình của chiến dịch được phân phối chung cho mọi thị trường:
// asset_id trỏ asset trong kho; ghi_chu là phạm vi/cách dùng đã duyệt.
export type AssetHinh = {
  id: string;
  asset_id: string;
  ghi_chu: string;
};

// Chi tiết được đội local cung cấp riêng cho một đối tượng trên thị
// trường (ưu đãi, lời thoại đã duyệt): đầu ra của đối tượng đó phải giữ
// nguyên văn, không suy ra.
export type ChiTietDoiTuong = {
  doi_tuong_id: string;
  chi_tiet: string;
};

// Một thị trường của chiến dịch thương hiệu (#12): mọi field là ghi đè
// tường minh do đội local cung cấp — giá/tiền tệ chỉ lưu giá trị được
// cung cấp (không quy đổi), ngôn ngữ đầu ra, khả dụng, landing page,
// CTA local thay CTA mặc định, chi tiết theo đối tượng và ghi đè tự do.
// nguon_id: nguồn fact tự động chiếu từ field thị trường. thong_diep_id:
// thông điệp riêng của thị trường — biến thể pin thông điệp này nên đổi
// fact local chỉ vô hiệu hóa đúng biến thể của thị trường đó (#14).
export type ThiTruong = {
  id: string;
  campaign_id: string;
  ma: string; // mã thị trường ngắn duy nhất trong campaign ('us', 'vn')
  ten: string;
  ngon_ngu: string;
  gia: string; // giá đã cung cấp, giữ nguyên văn ('189', '4.590.000')
  tien_te: string; // mã tiền tệ đi kèm gia ('USD', 'VND'); rỗng = chưa đặt
  kha_dung: string; // 'co_hang' | 'het_hang' | 'dat_truoc' | '' (chưa có)
  landing_page: string; // landing page local
  cta_nhan: string; // nhãn CTA ghi đè CTA mặc định của chiến dịch
  cta_url: string;
  ds_chi_tiet: ChiTietDoiTuong[]; // chi tiết đã duyệt riêng theo đối tượng
  ghi_de: Record<string, string>; // ghi đè tự do tường minh — liệt kê như ngoại lệ
  ds_nguoi_duyet: NguoiDuyetCongQuyen[]; // reviewer local được ghi
  bat_buoc_duyet: number; // 1 = duyệt bắt buộc ghi reviewer — móc nối #16
  nguon_id: string; // nguồn fact tự động chiếu từ field thị trường
  thong_diep_id: string; // thông điệp riêng của thị trường
  tao_luc: string;
  tao_boi: string;
  cap_nhat_luc: string;
  cap_nhat_boi: string;
};

export type NhapThiTruong = {
  ma?: string;
  ten?: string;
  ngon_ngu?: string;
  gia?: string;
  tien_te?: string;
  kha_dung?: string;
  landing_page?: string;
  cta_nhan?: string;
  cta_url?: string;
  ds_chi_tiet?: ChiTietDoiTuong[];
  ghi_de?: Record<string, string>;
  ds_nguoi_duyet?: NguoiDuyetCongQuyen[];
  bat_buoc_duyet?: number;
};

export type Campaign = {
  id: string;
  ten: string;
  mo_ta: string;
  ghi_de: GhiDeCampaign;
  loai: string; // '' | 'so_bao' | 'phat_hanh' | 'gay_quy' | 'cong_quyen'
  // Trường số báo (#8): rỗng/mặc định = campaign thường, không phải số báo.
  so_thu_tu: number | null;
  ngay_phat_hanh: string; // ISO date "YYYY-MM-DD" hoặc rỗng
  chu_de: string;
  lap_truong: string; // lập trường biên tập cấu hình được — đi vào context sinh
  chu_bien: string; // chủ biên tập phụ trách số
  thuong_hieu_id: string | null; // hồ sơ style/thuật ngữ dùng lại
  doi_tuong_id: string | null; // hồ sơ đối tượng chính của số
  tham_chieu: ThamChieu[]; // tham chiếu nguồn được khai báo
  muc_luc: MucLuc[]; // mục lục đề xuất đã sửa
  // Trường phát hành (#9): chỉ dùng khi loai = 'phat_hanh'.
  phien_ban: string; // "4.0"
  dinh_vi: string; // positioning đã duyệt — đi vào context sinh
  gioi_han: GioiHanPhatHanh[]; // giới hạn gói/vùng/khả dụng
  cta: CtaLienKet[]; // link CTA sửa được
  ds_fact: FactPhatHanh[]; // fact tính năng + bằng chứng nguồn
  nguon_phat_hanh_id: string; // nguồn fact tự động chiếu từ field release
  // Trường gây quỹ (#10): chỉ dùng khi loai = 'gay_quy'.
  muc_tieu: string; // mục tiêu gây quỹ tương lai — phân biệt tác động đã đạt
  so_tien_muc_tieu: number | null; // số tiền mục tiêu; NULL = chưa đặt
  tien_te: string; // mã tiền tệ đi kèm so_tien (vd 'VND', 'USD')
  thong_diep_loi: string; // thông điệp lõi đã duyệt — đi vào context sinh
  ngon_ngu_phu: string; // mã ngôn ngữ bản dịch thứ hai khi được chọn
  ds_tac_dong: TacDongGayQuy[]; // tác động đã đạt/ước tính + bằng chứng
  ds_trich_dan: TrichDanGayQuy[]; // trích dẫn được phép dùng + nguồn
  ghi_chu_quyen: GhiChuQuyen[]; // quyền/đồng ý cho asset tổ chức cung cấp
  nguon_gay_quy_id: string; // nguồn fact tự động chiếu từ field gây quỹ
  // Trường công quyền (#11): chỉ dùng khi loai = 'cong_quyen'.
  pham_vi_quyen_han: string; // phạm vi quyền hạn — giữ nguyên khi đơn giản hóa
  ngay_hieu_luc: string; // ISO date "YYYY-MM-DD" hoặc rỗng
  ds_yeu_cau: YeuCauCongQuyen[]; // yêu cầu/điểm giải thích + bằng chứng nguồn
  ds_ngoai_le: NgoaiLeCongQuyen[]; // ngoại lệ liên kết yêu cầu
  ds_fact_van_hanh: FactVanHanh[]; // fact vận hành hỗ trợ
  ds_nguoi_duyet: NguoiDuyetCongQuyen[]; // reviewer local được ghi
  che_do_bao_ve: number; // 1 = duyệt bắt buộc ghi reviewer — móc nối #16
  nguon_chinh_sach_id: string; // nguồn văn bản chính sách chính thức
  nguon_cong_quyen_id: string; // nguồn fact tự động chiếu từ field
  // Trường thương hiệu (#12): chỉ dùng khi loai = 'thuong_hieu'.
  ds_claim: ClaimThuongHieu[]; // claim sản phẩm đã duyệt + bằng chứng nguồn
  giong_van: string; // giọng văn thương hiệu — đi vào context sinh
  ds_asset_hinh: AssetHinh[]; // asset hình phân phối chung cho mọi thị trường
  nguon_thuong_hieu_id: string; // nguồn fact tự động chiếu từ field chung
  tao_luc: string;
  tao_boi: string;
  cap_nhat_luc: string;
  cap_nhat_boi: string;
};

export type ThongDiep = {
  id: string;
  campaign_id: string | null;
  tieu_de: string;
  noi_dung: string;
  head_revision_id: string | null;
  tao_luc: string;
  tao_boi: string;
  cap_nhat_luc: string;
  cap_nhat_boi: string;
};

export type ThongDiepRevision = {
  id: string;
  thong_diep_id: string;
  so_thu_tu: number;
  tieu_de: string;
  noi_dung: string;
  nguon_revision_ids: string[];
  dua_tren_revision_id: string | null;
  tao_luc: string;
  tao_boi: string;
};

export type BanTheHien = {
  id: string;
  thong_diep_id: string;
  dinh_dang: string;
  ngon_ngu: string;
  phien_ban_dinh_dang: number;
  doi_tuong: string;
  dich_den: string;
  trang_thai: string;
  head_revision_id: string | null;
  tao_luc: string;
  tao_boi: string;
};

export type Revision = {
  id: string;
  ban_the_hien_id: string;
  so_thu_tu: number;
  noi_dung: string;
  dua_tren_revision_id: string | null;
  context_sinh_id: string | null;
  thong_diep_revision_id: string | null;
  tao_luc: string;
  tao_boi: string;
};

export type Duyet = {
  id: string;
  ban_the_hien_id: string;
  revision_id: string | null;
  tu_trang_thai: string;
  den_trang_thai: string;
  ghi_chu: string;
  nguoi_duyet_id: string; // reviewer local ghi tại lần duyệt (#11); rỗng = không kèm
  tao_luc: string;
  tao_boi: string;
};

export type XuatBan = {
  id: string;
  ban_the_hien_id: string;
  revision_id: string;
  dich_den: string;
  ghi_chu: string;
  // Snapshot id asset được chọn tại thời điểm đăng (export chỉ gồm phần
  // được chọn tường minh — #17).
  asset_ids: string[];
  tao_luc: string;
  tao_boi: string;
};

export type SuKien = {
  id: number;
  entity_loai: string;
  entity_id: string;
  su_kien: string;
  du_lieu: string;
  actor: string;
  tao_luc: string;
};

const bayGio = () => new Date().toISOString();

// Bọc một gói ghi trong transaction; gọi lồng nhau được (bên trong transaction
// có sẵn thì chạy thẳng) — composite như nhapBaiViet giữ nguyên tử toàn cục.
function txn<T>(db: Database, fn: () => T): T {
  if (db.inTransaction) return fn();
  db.exec("BEGIN IMMEDIATE");
  try {
    const r = fn();
    db.exec("COMMIT");
    return r;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

// --- Sự kiện mutation ---

// Ghi một sự kiện mutation nhẹ kèm actor local. Không mở transaction —
// luôn đi cùng mutation chính trong cùng giao dịch.
export function ghiSuKien(
  db: Database,
  entityLoai: string,
  entityId: string,
  suKien: string,
  duLieu: unknown,
  actor: string,
): void {
  db.query(
    "INSERT INTO su_kien (entity_loai, entity_id, su_kien, du_lieu, actor, tao_luc) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(entityLoai, entityId, suKien, JSON.stringify(duLieu ?? {}), actor, bayGio());
}

export function danhSachSuKien(
  db: Database,
  loc: { entityLoai?: string; entityId?: string } = {},
  gioiHan = 200,
): SuKien[] {
  const dieuKien: string[] = [];
  const thamSo: string[] = [];
  if (loc.entityLoai) {
    dieuKien.push("entity_loai = ?");
    thamSo.push(loc.entityLoai);
  }
  if (loc.entityId) {
    dieuKien.push("entity_id = ?");
    thamSo.push(loc.entityId);
  }
  const where = dieuKien.length > 0 ? `WHERE ${dieuKien.join(" AND ")}` : "";
  return db
    .query(`SELECT * FROM su_kien ${where} ORDER BY id DESC LIMIT ?`)
    .all(...thamSo, gioiHan) as SuKien[];
}

// --- Đọc row → API shape (JSON field đã parse) ---

function docCacMucJson(v: string): MucNguon[] {
  try {
    const j = JSON.parse(v) as unknown;
    if (!Array.isArray(j)) return [];
    return j
      .filter((m) => typeof m === "object" && m !== null)
      .map((m) => {
        const r = m as Record<string, unknown>;
        return {
          id: String(r.id ?? ""),
          loai: r.loai === "fact" ? ("fact" as const) : ("section" as const),
          tieu_de: typeof r.tieu_de === "string" ? r.tieu_de : undefined,
          noi_dung: String(r.noi_dung ?? ""),
          assets: Array.isArray(r.assets) ? r.assets.map(String) : [],
        };
      });
  } catch {
    return [];
  }
}

type DongNguon = Omit<Nguon, "cac_muc"> & { cac_muc: string };
type DongNguonRevision = Omit<NguonRevision, "cac_muc"> & { cac_muc: string };
type DongCampaign = Omit<
  Campaign,
  | "ghi_de"
  | "tham_chieu"
  | "muc_luc"
  | "gioi_han"
  | "cta"
  | "ds_fact"
  | "ds_tac_dong"
  | "ds_trich_dan"
  | "ghi_chu_quyen"
  | "ds_yeu_cau"
  | "ds_ngoai_le"
  | "ds_fact_van_hanh"
  | "ds_nguoi_duyet"
  | "ds_claim"
  | "ds_asset_hinh"
> & {
  ghi_de: string;
  tham_chieu: string;
  muc_luc: string;
  gioi_han: string;
  cta: string;
  ds_fact: string;
  ds_tac_dong: string;
  ds_trich_dan: string;
  ghi_chu_quyen: string;
  ds_yeu_cau: string;
  ds_ngoai_le: string;
  ds_fact_van_hanh: string;
  ds_nguoi_duyet: string;
  ds_claim: string;
  ds_asset_hinh: string;
};
// Hàng thi_truong trên đĩa: mảng/object JSON giữ dạng TEXT.
type DongThiTruong = Omit<ThiTruong, "ds_chi_tiet" | "ghi_de" | "ds_nguoi_duyet"> & {
  ds_chi_tiet: string;
  ghi_de: string;
  ds_nguoi_duyet: string;
};
type DongThongDiepRevision = Omit<ThongDiepRevision, "nguon_revision_ids"> & {
  nguon_revision_ids: string;
};

const docNguon = (row: DongNguon): Nguon => ({ ...row, cac_muc: docCacMucJson(row.cac_muc) });
const docNguonRevision = (row: DongNguonRevision): NguonRevision => ({
  ...row,
  cac_muc: docCacMucJson(row.cac_muc),
});
// Parse JSON lưu trên campaign — dung sai giống docCacMucJson: JSON hỏng
// hoặc mục lạ bị rỗng thay vì ném lỗi khi đọc.
export function docThamChieu(v: string): ThamChieu[] {
  try {
    const j = JSON.parse(v) as unknown;
    if (!Array.isArray(j)) return [];
    return j
      .filter((x) => typeof x === "object" && x !== null)
      .map((x, i) => {
        const r = x as Record<string, unknown>;
        return {
          id: typeof r.id === "string" && r.id ? r.id : `tc${i + 1}`,
          tham_chieu: typeof r.tham_chieu === "string" ? r.tham_chieu : "",
          ban_dich: typeof r.ban_dich === "string" ? r.ban_dich : "",
          nguon_id: typeof r.nguon_id === "string" && r.nguon_id ? r.nguon_id : null,
          ghi_chu: typeof r.ghi_chu === "string" ? r.ghi_chu : "",
        };
      });
  } catch {
    return [];
  }
}

export function docMucLuc(v: string): MucLuc[] {
  try {
    const j = JSON.parse(v) as unknown;
    if (!Array.isArray(j)) return [];
    return j
      .filter((x) => typeof x === "object" && x !== null)
      .map((x, i) => {
        const r = x as Record<string, unknown>;
        return {
          id: typeof r.id === "string" && r.id ? r.id : `muc${i + 1}`,
          tieu_de: typeof r.tieu_de === "string" ? r.tieu_de : "",
          dinh_dang: typeof r.dinh_dang === "string" ? r.dinh_dang : "",
          doi_tuong_id:
            typeof r.doi_tuong_id === "string" && r.doi_tuong_id ? r.doi_tuong_id : null,
          dich_den: typeof r.dich_den === "string" ? r.dich_den : "",
          ngon_ngu: typeof r.ngon_ngu === "string" && r.ngon_ngu ? r.ngon_ngu : undefined,
          ly_do: typeof r.ly_do === "string" ? r.ly_do : "",
        };
      });
  } catch {
    return [];
  }
}

// Parse JSON release trên campaign (#9) — dung sai giống docThamChieu:
// mảng hỏng/mục lạ rỗng thay vì ném lỗi khi đọc.
export function docGioiHan(v: string): GioiHanPhatHanh[] {
  try {
    const j = JSON.parse(v) as unknown;
    if (!Array.isArray(j)) return [];
    return j
      .filter((x) => typeof x === "object" && x !== null)
      .map((x, i) => {
        const r = x as Record<string, unknown>;
        return {
          id: typeof r.id === "string" && r.id ? r.id : `gh${i + 1}`,
          tinh_nang: typeof r.tinh_nang === "string" ? r.tinh_nang : "",
          loai: typeof r.loai === "string" ? r.loai : "",
          mo_ta: typeof r.mo_ta === "string" ? r.mo_ta : "",
        };
      });
  } catch {
    return [];
  }
}

export function docCta(v: string): CtaLienKet[] {
  try {
    const j = JSON.parse(v) as unknown;
    if (!Array.isArray(j)) return [];
    return j
      .filter((x) => typeof x === "object" && x !== null)
      .map((x, i) => {
        const r = x as Record<string, unknown>;
        return {
          id: typeof r.id === "string" && r.id ? r.id : `cta${i + 1}`,
          nhan: typeof r.nhan === "string" ? r.nhan : "",
          loai: typeof r.loai === "string" ? r.loai : "",
          url: typeof r.url === "string" ? r.url : "",
        };
      });
  } catch {
    return [];
  }
}

export function docDsFact(v: string): FactPhatHanh[] {
  try {
    const j = JSON.parse(v) as unknown;
    if (!Array.isArray(j)) return [];
    return j
      .filter((x) => typeof x === "object" && x !== null)
      .map((x, i) => {
        const r = x as Record<string, unknown>;
        return {
          id: typeof r.id === "string" && r.id ? r.id : `f${i + 1}`,
          tinh_nang: typeof r.tinh_nang === "string" ? r.tinh_nang : "",
          noi_dung: typeof r.noi_dung === "string" ? r.noi_dung : "",
          nguon_id: typeof r.nguon_id === "string" && r.nguon_id ? r.nguon_id : null,
          muc_id: typeof r.muc_id === "string" && r.muc_id ? r.muc_id : null,
        };
      });
  } catch {
    return [];
  }
}

// Parse JSON gây quỹ trên campaign (#10) — dung sai giống docDsFact.
export function docDsTacDong(v: string): TacDongGayQuy[] {
  try {
    const j = JSON.parse(v) as unknown;
    if (!Array.isArray(j)) return [];
    return j
      .filter((x) => typeof x === "object" && x !== null)
      .map((x, i) => {
        const r = x as Record<string, unknown>;
        return {
          id: typeof r.id === "string" && r.id ? r.id : `td${i + 1}`,
          tieu_de: typeof r.tieu_de === "string" ? r.tieu_de : "",
          noi_dung: typeof r.noi_dung === "string" ? r.noi_dung : "",
          trang_thai: typeof r.trang_thai === "string" ? r.trang_thai : "",
          so_lieu: typeof r.so_lieu === "string" ? r.so_lieu : "",
          don_vi: typeof r.don_vi === "string" ? r.don_vi : "",
          nguon_id: typeof r.nguon_id === "string" && r.nguon_id ? r.nguon_id : null,
          muc_id: typeof r.muc_id === "string" && r.muc_id ? r.muc_id : null,
        };
      });
  } catch {
    return [];
  }
}

export function docDsTrichDan(v: string): TrichDanGayQuy[] {
  try {
    const j = JSON.parse(v) as unknown;
    if (!Array.isArray(j)) return [];
    return j
      .filter((x) => typeof x === "object" && x !== null)
      .map((x, i) => {
        const r = x as Record<string, unknown>;
        return {
          id: typeof r.id === "string" && r.id ? r.id : `tq${i + 1}`,
          ten_nguoi: typeof r.ten_nguoi === "string" ? r.ten_nguoi : "",
          loi: typeof r.loi === "string" ? r.loi : "",
          nguon_id: typeof r.nguon_id === "string" && r.nguon_id ? r.nguon_id : null,
          muc_id: typeof r.muc_id === "string" && r.muc_id ? r.muc_id : null,
        };
      });
  } catch {
    return [];
  }
}

export function docGhiChuQuyen(v: string): GhiChuQuyen[] {
  try {
    const j = JSON.parse(v) as unknown;
    if (!Array.isArray(j)) return [];
    return j
      .filter((x) => typeof x === "object" && x !== null)
      .map((x, i) => {
        const r = x as Record<string, unknown>;
        return {
          id: typeof r.id === "string" && r.id ? r.id : `q${i + 1}`,
          asset_id: typeof r.asset_id === "string" ? r.asset_id : "",
          ghi_chu: typeof r.ghi_chu === "string" ? r.ghi_chu : "",
        };
      });
  } catch {
    return [];
  }
}

// Parse JSON công quyền trên campaign (#11) — dung sai giống docDsFact.
export function docDsYeuCau(v: string): YeuCauCongQuyen[] {
  try {
    const j = JSON.parse(v) as unknown;
    if (!Array.isArray(j)) return [];
    return j
      .filter((x) => typeof x === "object" && x !== null)
      .map((x, i) => {
        const r = x as Record<string, unknown>;
        return {
          id: typeof r.id === "string" && r.id ? r.id : `yc${i + 1}`,
          noi_dung: typeof r.noi_dung === "string" ? r.noi_dung : "",
          loai: typeof r.loai === "string" ? r.loai : "",
          doi_tuong_ap_dung:
            typeof r.doi_tuong_ap_dung === "string" ? r.doi_tuong_ap_dung : "",
          nguon_id: typeof r.nguon_id === "string" && r.nguon_id ? r.nguon_id : null,
          muc_id: typeof r.muc_id === "string" && r.muc_id ? r.muc_id : null,
        };
      });
  } catch {
    return [];
  }
}

export function docDsNgoaiLe(v: string): NgoaiLeCongQuyen[] {
  try {
    const j = JSON.parse(v) as unknown;
    if (!Array.isArray(j)) return [];
    return j
      .filter((x) => typeof x === "object" && x !== null)
      .map((x, i) => {
        const r = x as Record<string, unknown>;
        return {
          id: typeof r.id === "string" && r.id ? r.id : `nl${i + 1}`,
          noi_dung: typeof r.noi_dung === "string" ? r.noi_dung : "",
          yeu_cau_id: typeof r.yeu_cau_id === "string" ? r.yeu_cau_id : "",
          nguon_id: typeof r.nguon_id === "string" && r.nguon_id ? r.nguon_id : null,
          muc_id: typeof r.muc_id === "string" && r.muc_id ? r.muc_id : null,
        };
      });
  } catch {
    return [];
  }
}

export function docDsFactVanHanh(v: string): FactVanHanh[] {
  try {
    const j = JSON.parse(v) as unknown;
    if (!Array.isArray(j)) return [];
    return j
      .filter((x) => typeof x === "object" && x !== null)
      .map((x, i) => {
        const r = x as Record<string, unknown>;
        return {
          id: typeof r.id === "string" && r.id ? r.id : `fv${i + 1}`,
          tieu_de: typeof r.tieu_de === "string" ? r.tieu_de : "",
          noi_dung: typeof r.noi_dung === "string" ? r.noi_dung : "",
          nguon_id: typeof r.nguon_id === "string" && r.nguon_id ? r.nguon_id : null,
          muc_id: typeof r.muc_id === "string" && r.muc_id ? r.muc_id : null,
        };
      });
  } catch {
    return [];
  }
}

export function docDsNguoiDuyet(v: string): NguoiDuyetCongQuyen[] {
  try {
    const j = JSON.parse(v) as unknown;
    if (!Array.isArray(j)) return [];
    return j
      .filter((x) => typeof x === "object" && x !== null)
      .map((x, i) => {
        const r = x as Record<string, unknown>;
        return {
          id: typeof r.id === "string" && r.id ? r.id : `nd${i + 1}`,
          ten: typeof r.ten === "string" ? r.ten : "",
          vai_tro: typeof r.vai_tro === "string" ? r.vai_tro : "",
        };
      });
  } catch {
    return [];
  }
}

// Parse JSON thương hiệu trên campaign (#12) — dung sai giống docDsFact.
export function docDsClaim(v: string): ClaimThuongHieu[] {
  try {
    const j = JSON.parse(v) as unknown;
    if (!Array.isArray(j)) return [];
    return j
      .filter((x) => typeof x === "object" && x !== null)
      .map((x, i) => {
        const r = x as Record<string, unknown>;
        return {
          id: typeof r.id === "string" && r.id ? r.id : `cl${i + 1}`,
          noi_dung: typeof r.noi_dung === "string" ? r.noi_dung : "",
          nguon_id: typeof r.nguon_id === "string" && r.nguon_id ? r.nguon_id : null,
          muc_id: typeof r.muc_id === "string" && r.muc_id ? r.muc_id : null,
        };
      });
  } catch {
    return [];
  }
}

export function docDsAssetHinh(v: string): AssetHinh[] {
  try {
    const j = JSON.parse(v) as unknown;
    if (!Array.isArray(j)) return [];
    return j
      .filter((x) => typeof x === "object" && x !== null)
      .map((x, i) => {
        const r = x as Record<string, unknown>;
        return {
          id: typeof r.id === "string" && r.id ? r.id : `ah${i + 1}`,
          asset_id: typeof r.asset_id === "string" ? r.asset_id : "",
          ghi_chu: typeof r.ghi_chu === "string" ? r.ghi_chu : "",
        };
      });
  } catch {
    return [];
  }
}

// Parse JSON chi tiết theo đối tượng trên hàng thi_truong — mục lạ/thiếu
// doi_tuong_id bị rỗng thay vì ném lỗi khi đọc.
export function docDsChiTiet(v: string): ChiTietDoiTuong[] {
  try {
    const j = JSON.parse(v) as unknown;
    if (!Array.isArray(j)) return [];
    return j
      .filter((x) => typeof x === "object" && x !== null)
      .map((x) => {
        const r = x as Record<string, unknown>;
        return {
          doi_tuong_id: typeof r.doi_tuong_id === "string" ? r.doi_tuong_id : "",
          chi_tiet: typeof r.chi_tiet === "string" ? r.chi_tiet : "",
        };
      });
  } catch {
    return [];
  }
}

// Parse object ghi đè tự do trên hàng thi_truong: { khoa: chuoi } — giá
// trị khác chuỗi bị ép chuỗi để không mất dữ liệu khi đọc.
export function docGhiDeJson(v: string): Record<string, string> {
  try {
    const j = JSON.parse(v) as unknown;
    if (typeof j !== "object" || j === null || Array.isArray(j)) return {};
    const ra: Record<string, string> = {};
    for (const [k, val] of Object.entries(j as Record<string, unknown>)) {
      ra[k] = typeof val === "string" ? val : JSON.stringify(val);
    }
    return ra;
  } catch {
    return {};
  }
}

const docThiTruong = (row: DongThiTruong): ThiTruong => ({
  ...row,
  ds_chi_tiet: docDsChiTiet(row.ds_chi_tiet),
  ghi_de: docGhiDeJson(row.ghi_de),
  ds_nguoi_duyet: docDsNguoiDuyet(row.ds_nguoi_duyet),
});

const docCampaign = (row: DongCampaign): Campaign => ({
  ...row,
  ghi_de: JSON.parse(row.ghi_de) as GhiDeCampaign,
  tham_chieu: docThamChieu(row.tham_chieu),
  muc_luc: docMucLuc(row.muc_luc),
  gioi_han: docGioiHan(row.gioi_han),
  cta: docCta(row.cta),
  ds_fact: docDsFact(row.ds_fact),
  ds_tac_dong: docDsTacDong(row.ds_tac_dong),
  ds_trich_dan: docDsTrichDan(row.ds_trich_dan),
  ghi_chu_quyen: docGhiChuQuyen(row.ghi_chu_quyen),
  ds_yeu_cau: docDsYeuCau(row.ds_yeu_cau),
  ds_ngoai_le: docDsNgoaiLe(row.ds_ngoai_le),
  ds_fact_van_hanh: docDsFactVanHanh(row.ds_fact_van_hanh),
  ds_nguoi_duyet: docDsNguoiDuyet(row.ds_nguoi_duyet),
  ds_claim: docDsClaim(row.ds_claim),
  ds_asset_hinh: docDsAssetHinh(row.ds_asset_hinh),
});
const docThongDiepRevision = (row: DongThongDiepRevision): ThongDiepRevision => {
  let ids: string[] = [];
  try {
    const j = JSON.parse(row.nguon_revision_ids) as unknown;
    if (Array.isArray(j)) ids = j.map(String);
  } catch {
    // JSON hỏng → coi như không ghim nguồn nào.
  }
  return { ...row, nguon_revision_ids: ids };
};

// Convention xung đột revision: dua_tren_revision_id phải bằng head hiện tại.
function assertDuaTren(head: string | null, duaTren: string | null): void {
  if ((head ?? null) !== (duaTren ?? null)) {
    throw new LoiApi(409, "XUNG_DOT_REVISION", "Đã có revision mới hơn. Tải lại rồi thử lại.", {
      head_revision_id: head,
    });
  }
}

// --- Nguồn ---

export function layNguon(db: Database, id: string): Nguon | null {
  const row = db.query("SELECT * FROM nguon WHERE id = ?").get(id) as DongNguon | null;
  return row ? docNguon(row) : null;
}

export function danhSachNguon(db: Database): Nguon[] {
  return (db.query("SELECT * FROM nguon ORDER BY tao_luc DESC").all() as DongNguon[]).map(docNguon);
}

export function layNguonRevision(db: Database, id: string): NguonRevision | null {
  const row = db
    .query("SELECT * FROM nguon_revision WHERE id = ?")
    .get(id) as DongNguonRevision | null;
  return row ? docNguonRevision(row) : null;
}

export function danhSachNguonRevision(db: Database, nguonId: string): NguonRevision[] {
  return (
    db
      .query("SELECT * FROM nguon_revision WHERE nguon_id = ? ORDER BY so_thu_tu")
      .all(nguonId) as DongNguonRevision[]
  ).map(docNguonRevision);
}

// Tra cứu idempotency của ingest: request nạp retry cùng khoa_idem nhận lại
// đúng revision đã ghi, không tạo trùng (#17).
export function timNguonRevisionTheoKhoaIdem(
  db: Database,
  khoaIdem: string,
): NguonRevision | null {
  const row = db
    .query("SELECT * FROM nguon_revision WHERE khoa_idem = ?")
    .get(khoaIdem) as DongNguonRevision | null;
  return row ? docNguonRevision(row) : null;
}

export type NhapNguon = {
  tieu_de: string;
  noi_dung: string;
  loai?: string;
  cac_muc?: MucNguon[];
  // Khóa idempotency của request nạp (#17); ghi lên revision tạo ra.
  khoa_idem?: string;
};

export type TuyChonTaoNguon = { id?: string };

// Ghi một revision nguồn mới + cập nhật entity + head, trong transaction gọi
// từ caller. Trả revision vừa ghi.
function ghiNguonRevisionTrongTxn(
  db: Database,
  nguonId: string,
  snapshot: {
    tieu_de: string;
    loai: string;
    noi_dung: string;
    cac_muc: MucNguon[];
    khoa_idem?: string;
  },
  duaTren: string | null,
  tacGia: string,
): NguonRevision {
  const nguon = layNguon(db, nguonId)!;
  assertDuaTren(nguon.head_revision_id, duaTren);
  const soTiep =
    ((
      db
        .query("SELECT MAX(so_thu_tu) AS m FROM nguon_revision WHERE nguon_id = ?")
        .get(nguonId) as { m: number | null }
    ).m ?? 0) + 1;
  const id = crypto.randomUUID();
  const ts = bayGio();
  db.query(
    `INSERT INTO nguon_revision
       (id, nguon_id, so_thu_tu, tieu_de, loai, noi_dung, cac_muc, dua_tren_revision_id, khoa_idem, tao_luc, tao_boi)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    nguonId,
    soTiep,
    snapshot.tieu_de,
    snapshot.loai,
    snapshot.noi_dung,
    JSON.stringify(snapshot.cac_muc),
    duaTren,
    snapshot.khoa_idem ?? null,
    ts,
    tacGia,
  );
  db.query(
    "UPDATE nguon SET tieu_de = ?, loai = ?, noi_dung = ?, cac_muc = ?, head_revision_id = ?, cap_nhat_luc = ? WHERE id = ?",
  ).run(
    snapshot.tieu_de,
    snapshot.loai,
    snapshot.noi_dung,
    JSON.stringify(snapshot.cac_muc),
    id,
    ts,
    nguonId,
  );
  return layNguonRevision(db, id)!;
}

export function taoNguon(
  db: Database,
  input: NhapNguon,
  tacGia: string,
  tuyChon: TuyChonTaoNguon = {},
): Nguon {
  return txn(db, () => {
    const id = tuyChon.id ?? crypto.randomUUID();
    const ts = bayGio();
    db.query(
      `INSERT INTO nguon (id, tieu_de, noi_dung, loai, cac_muc, head_revision_id, tao_luc, tao_boi, cap_nhat_luc)
       VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?)`,
    ).run(
      id,
      input.tieu_de,
      input.noi_dung,
      input.loai ?? "van_ban",
      JSON.stringify(input.cac_muc ?? []),
      ts,
      tacGia,
      ts,
    );
    ghiNguonRevisionTrongTxn(
      db,
      id,
      {
        tieu_de: input.tieu_de,
        loai: input.loai ?? "van_ban",
        noi_dung: input.noi_dung,
        cac_muc: input.cac_muc ?? [],
        khoa_idem: input.khoa_idem,
      },
      null,
      tacGia,
    );
    ghiSuKien(db, "nguon", id, "tao", {}, tacGia);
    return layNguon(db, id)!;
  });
}

// Cập nhật nguồn = thêm một revision mới (immutable); dua_tren_revision_id
// phải bằng head → ghi xung đột bị từ chối, revision cũ vẫn truy cập được.
export function capNhatNguon(
  db: Database,
  id: string,
  input: NhapNguon,
  duaTrenRevisionId: string | null,
  tacGia: string,
): Nguon {
  return txn(db, () => {
    const nguon = layNguon(db, id);
    if (!nguon) loiRequest(404, "KHONG_TIM_THAY", "Không tìm thấy nguồn.");
    // PUT thiếu `loai` giữ loại của head hiện tại — không lặng reset về
    // 'van_ban' (PUT partial không được đổi loại nguồn).
    const headRev = nguon.head_revision_id
      ? layNguonRevision(db, nguon.head_revision_id)
      : null;
    ghiNguonRevisionTrongTxn(
      db,
      id,
      {
        tieu_de: input.tieu_de,
        loai: input.loai ?? headRev?.loai ?? "van_ban",
        noi_dung: input.noi_dung,
        cac_muc: input.cac_muc ?? [],
        khoa_idem: input.khoa_idem,
      },
      duaTrenRevisionId,
      tacGia,
    );
    const moi = layNguon(db, id)!;
    ghiSuKien(db, "nguon", id, "revision_moi", { revision_id: moi.head_revision_id }, tacGia);
    return moi;
  });
}

// --- Campaign ---

export function layCampaign(db: Database, id: string): Campaign | null {
  const row = db.query("SELECT * FROM campaign WHERE id = ?").get(id) as DongCampaign | null;
  return row ? docCampaign(row) : null;
}

export function danhSachCampaign(db: Database): Campaign[] {
  return (db.query("SELECT * FROM campaign ORDER BY tao_luc").all() as DongCampaign[]).map(
    docCampaign,
  );
}

export type NhapCampaign = {
  ten: string;
  mo_ta?: string;
  ghi_de?: GhiDeCampaign;
  loai?: string;
  // Trường số báo (#8) — tất cả tùy chọn; thiếu = giữ giá trị mặc định.
  so_thu_tu?: number | null;
  ngay_phat_hanh?: string;
  chu_de?: string;
  lap_truong?: string;
  chu_bien?: string;
  thuong_hieu_id?: string | null;
  doi_tuong_id?: string | null;
  tham_chieu?: ThamChieu[];
  muc_luc?: MucLuc[];
  // Trường phát hành (#9) — tất cả tùy chọn.
  phien_ban?: string;
  dinh_vi?: string;
  gioi_han?: GioiHanPhatHanh[];
  cta?: CtaLienKet[];
  ds_fact?: FactPhatHanh[];
  nguon_phat_hanh_id?: string;
  // Trường gây quỹ (#10) — tất cả tùy chọn.
  muc_tieu?: string;
  so_tien_muc_tieu?: number | null;
  tien_te?: string;
  thong_diep_loi?: string;
  ngon_ngu_phu?: string;
  ds_tac_dong?: TacDongGayQuy[];
  ds_trich_dan?: TrichDanGayQuy[];
  ghi_chu_quyen?: GhiChuQuyen[];
  nguon_gay_quy_id?: string;
  // Trường công quyền (#11) — tất cả tùy chọn.
  pham_vi_quyen_han?: string;
  ngay_hieu_luc?: string;
  ds_yeu_cau?: YeuCauCongQuyen[];
  ds_ngoai_le?: NgoaiLeCongQuyen[];
  ds_fact_van_hanh?: FactVanHanh[];
  ds_nguoi_duyet?: NguoiDuyetCongQuyen[];
  che_do_bao_ve?: number;
  nguon_chinh_sach_id?: string;
  nguon_cong_quyen_id?: string;
  // Trường thương hiệu (#12).
  ds_claim?: ClaimThuongHieu[];
  giong_van?: string;
  ds_asset_hinh?: AssetHinh[];
  nguon_thuong_hieu_id?: string;
};

const COT_SO_BAO =
  "so_thu_tu, ngay_phat_hanh, chu_de, lap_truong, chu_bien, thuong_hieu_id, doi_tuong_id, tham_chieu, muc_luc";
const COT_PHAT_HANH = "phien_ban, dinh_vi, gioi_han, cta, ds_fact";
const COT_GAY_QUY =
  "muc_tieu, so_tien_muc_tieu, tien_te, thong_diep_loi, ngon_ngu_phu, ds_tac_dong, ds_trich_dan, ghi_chu_quyen";
const COT_CONG_QUYEN =
  "pham_vi_quyen_han, ngay_hieu_luc, ds_yeu_cau, ds_ngoai_le, ds_fact_van_hanh, ds_nguoi_duyet, che_do_bao_ve, nguon_chinh_sach_id";
const COT_THUONG_HIEU = "ds_claim, giong_van, ds_asset_hinh";

export function taoCampaign(
  db: Database,
  input: NhapCampaign,
  tacGia: string,
  tuyChon: { id?: string } = {},
): Campaign {
  return txn(db, () => {
    const id = tuyChon.id ?? crypto.randomUUID();
    const ts = bayGio();
    db.query(
      `INSERT INTO campaign (id, ten, mo_ta, ghi_de, loai, ${COT_SO_BAO}, ${COT_PHAT_HANH}, ${COT_GAY_QUY}, ${COT_CONG_QUYEN}, ${COT_THUONG_HIEU}, tao_luc, tao_boi, cap_nhat_luc, cap_nhat_boi)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,     
    ).run(
      id,
      input.ten,
      input.mo_ta ?? "",
      JSON.stringify(input.ghi_de ?? {}),
      input.loai ?? "",
      input.so_thu_tu ?? null,
      input.ngay_phat_hanh ?? "",
      input.chu_de ?? "",
      input.lap_truong ?? "",
      input.chu_bien ?? "",
      input.thuong_hieu_id ?? null,
      input.doi_tuong_id ?? null,
      JSON.stringify(input.tham_chieu ?? []),
      JSON.stringify(input.muc_luc ?? []),
      input.phien_ban ?? "",
      input.dinh_vi ?? "",
      JSON.stringify(input.gioi_han ?? []),
      JSON.stringify(input.cta ?? []),
      JSON.stringify(input.ds_fact ?? []),
      input.muc_tieu ?? "",
      input.so_tien_muc_tieu ?? null,
      input.tien_te ?? "",
      input.thong_diep_loi ?? "",
      input.ngon_ngu_phu ?? "",
      JSON.stringify(input.ds_tac_dong ?? []),
      JSON.stringify(input.ds_trich_dan ?? []),
      JSON.stringify(input.ghi_chu_quyen ?? []),
      input.pham_vi_quyen_han ?? "",
      input.ngay_hieu_luc ?? "",
      JSON.stringify(input.ds_yeu_cau ?? []),
      JSON.stringify(input.ds_ngoai_le ?? []),
      JSON.stringify(input.ds_fact_van_hanh ?? []),
      JSON.stringify(input.ds_nguoi_duyet ?? []),
      input.che_do_bao_ve ?? 0,
      input.nguon_chinh_sach_id ?? "",
      // Thương hiệu (#12): nguon_thuong_hieu_id gán riêng sau khi đồng bộ
      // nguồn fact tự động — POST/PUT không nhận trực tiếp.
      JSON.stringify(input.ds_claim ?? []),
      input.giong_van ?? "",
      JSON.stringify(input.ds_asset_hinh ?? []),
      ts,
      tacGia,
      ts,
      tacGia,
    );
    ghiSuKien(db, "campaign", id, "tao", {}, tacGia);
    return layCampaign(db, id)!;
  });
}

// Cập nhật campaign: trường số báo thiếu trong input thì giữ giá trị đã
// lưu — biên tập sửa một ô không phải gửi lại toàn bộ danh sách.
export function capNhatCampaign(
  db: Database,
  id: string,
  input: NhapCampaign,
  tacGia: string,
): Campaign {
  return txn(db, () => {
    const cu = layCampaign(db, id);
    if (!cu) loiRequest(404, "KHONG_TIM_THAY", "Không tìm thấy campaign.");
    db.query(
      `UPDATE campaign SET ten = ?, mo_ta = ?, ghi_de = ?, loai = ?, ${COT_SO_BAO.split(", ")
        .map((c) => `${c} = ?`)
        .join(", ")}, ${COT_PHAT_HANH.split(", ")
        .map((c) => `${c} = ?`)
        .join(", ")}, ${COT_GAY_QUY.split(", ")
        .map((c) => `${c} = ?`)
        .join(", ")}, ${COT_CONG_QUYEN.split(", ")
        .map((c) => `${c} = ?`)
        .join(", ")}, ${COT_THUONG_HIEU.split(", ")
        .map((c) => `${c} = ?`)
        .join(", ")}, cap_nhat_luc = ?, cap_nhat_boi = ? WHERE id = ?`,
    ).run(
      input.ten,
      input.mo_ta ?? cu.mo_ta,
      JSON.stringify(input.ghi_de ?? cu.ghi_de),
      input.loai !== undefined ? input.loai : cu.loai,
      input.so_thu_tu !== undefined ? input.so_thu_tu : cu.so_thu_tu,
      input.ngay_phat_hanh ?? cu.ngay_phat_hanh,
      input.chu_de ?? cu.chu_de,
      input.lap_truong ?? cu.lap_truong,
      input.chu_bien ?? cu.chu_bien,
      input.thuong_hieu_id !== undefined ? input.thuong_hieu_id : cu.thuong_hieu_id,
      input.doi_tuong_id !== undefined ? input.doi_tuong_id : cu.doi_tuong_id,
      JSON.stringify(input.tham_chieu ?? cu.tham_chieu),
      JSON.stringify(input.muc_luc ?? cu.muc_luc),
      input.phien_ban ?? cu.phien_ban,
      input.dinh_vi ?? cu.dinh_vi,
      JSON.stringify(input.gioi_han ?? cu.gioi_han),
      JSON.stringify(input.cta ?? cu.cta),
      JSON.stringify(input.ds_fact ?? cu.ds_fact),
      input.muc_tieu ?? cu.muc_tieu,
      input.so_tien_muc_tieu !== undefined ? input.so_tien_muc_tieu : cu.so_tien_muc_tieu,
      input.tien_te ?? cu.tien_te,
      input.thong_diep_loi ?? cu.thong_diep_loi,
      input.ngon_ngu_phu ?? cu.ngon_ngu_phu,
      JSON.stringify(input.ds_tac_dong ?? cu.ds_tac_dong),
      JSON.stringify(input.ds_trich_dan ?? cu.ds_trich_dan),
      JSON.stringify(input.ghi_chu_quyen ?? cu.ghi_chu_quyen),
      input.pham_vi_quyen_han ?? cu.pham_vi_quyen_han,
      input.ngay_hieu_luc ?? cu.ngay_hieu_luc,
      JSON.stringify(input.ds_yeu_cau ?? cu.ds_yeu_cau),
      JSON.stringify(input.ds_ngoai_le ?? cu.ds_ngoai_le),
      JSON.stringify(input.ds_fact_van_hanh ?? cu.ds_fact_van_hanh),
      JSON.stringify(input.ds_nguoi_duyet ?? cu.ds_nguoi_duyet),
      input.che_do_bao_ve !== undefined ? input.che_do_bao_ve : cu.che_do_bao_ve,
      input.nguon_chinh_sach_id ?? cu.nguon_chinh_sach_id,
      // Thương hiệu (#12): absent → giữ giá trị đã lưu; nguồn fact tự
      // động gán riêng sau đồng bộ.
      JSON.stringify(input.ds_claim ?? cu.ds_claim),
      input.giong_van ?? cu.giong_van,
      JSON.stringify(input.ds_asset_hinh ?? cu.ds_asset_hinh),
      bayGio(),
      tacGia,
      id,
    );
    ghiSuKien(db, "campaign", id, "cap_nhat", {}, tacGia);
    return layCampaign(db, id)!;
  });
}

// Xóa campaign: thông điệp đang gắn quay về bài lẻ (campaign_id → NULL).
export function xoaCampaign(db: Database, id: string, tacGia: string): void {
  txn(db, () => {
    if (!layCampaign(db, id)) loiRequest(404, "KHONG_TIM_THAY", "Không tìm thấy campaign.");
    db.query("DELETE FROM campaign WHERE id = ?").run(id);
    ghiSuKien(db, "campaign", id, "xoa", {}, tacGia);
  });
}

// --- Thị trường của chiến dịch thương hiệu (#12) ---

export function layThiTruong(db: Database, id: string): ThiTruong | null {
  const row = db.query("SELECT * FROM thi_truong WHERE id = ?").get(id) as DongThiTruong | null;
  return row ? docThiTruong(row) : null;
}

export function danhSachThiTruong(db: Database, campaignId: string): ThiTruong[] {
  return (
    db
      .query("SELECT * FROM thi_truong WHERE campaign_id = ? ORDER BY tao_luc")
      .all(campaignId) as DongThiTruong[]
  ).map(docThiTruong);
}

export function layThiTruongTheoMa(
  db: Database,
  campaignId: string,
  ma: string,
): ThiTruong | null {
  const row = db
    .query("SELECT * FROM thi_truong WHERE campaign_id = ? AND ma = ?")
    .get(campaignId, ma) as DongThiTruong | null;
  return row ? docThiTruong(row) : null;
}

// Tra thị trường chủ một thông điệp — mọi biến thể của thị trường pin
// thông điệp riêng đó nên tra ngược qua thong_diep_id để áp ràng buộc
// review local (người duyệt/bắt buộc) và lọc phạm vi ảnh hưởng.
export function layThiTruongTheoThongDiep(
  db: Database,
  thongDiepId: string,
): ThiTruong | null {
  const row = db
    .query("SELECT * FROM thi_truong WHERE thong_diep_id = ?")
    .get(thongDiepId) as DongThiTruong | null;
  return row ? docThiTruong(row) : null;
}

export function layThiTruongTheoNguon(db: Database, nguonId: string): ThiTruong | null {
  const row = db
    .query("SELECT * FROM thi_truong WHERE nguon_id = ?")
    .get(nguonId) as DongThiTruong | null;
  return row ? docThiTruong(row) : null;
}

export function taoThiTruong(
  db: Database,
  campaignId: string,
  input: NhapThiTruong,
  tacGia: string,
  tuyChon: { id?: string } = {},
): ThiTruong {
  return txn(db, () => {
    const id = tuyChon.id ?? crypto.randomUUID();
    const ts = bayGio();
    db.query(
      `INSERT INTO thi_truong
         (id, campaign_id, ma, ten, ngon_ngu, gia, tien_te, kha_dung,
          landing_page, cta_nhan, cta_url, ds_chi_tiet, ghi_de,
          ds_nguoi_duyet, bat_buoc_duyet, nguon_id, thong_diep_id,
          tao_luc, tao_boi, cap_nhat_luc, cap_nhat_boi)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', '', ?, ?, ?, ?)`,
    ).run(
      id,
      campaignId,
      input.ma ?? "",
      input.ten ?? "",
      input.ngon_ngu ?? "vi",
      input.gia ?? "",
      input.tien_te ?? "",
      input.kha_dung ?? "",
      input.landing_page ?? "",
      input.cta_nhan ?? "",
      input.cta_url ?? "",
      JSON.stringify(input.ds_chi_tiet ?? []),
      JSON.stringify(input.ghi_de ?? {}),
      JSON.stringify(input.ds_nguoi_duyet ?? []),
      input.bat_buoc_duyet ?? 0,
      ts,
      tacGia,
      ts,
      tacGia,
    );
    ghiSuKien(db, "thi_truong", id, "tao", { campaign_id: campaignId, ma: input.ma }, tacGia);
    return layThiTruong(db, id)!;
  });
}

// Cập nhật thị trường: field absent trong input giữ giá trị đã lưu —
// giống contract PUT partial của campaign. nguon_id/thong_diep_id gán
// riêng qua ganNguonThiTruong/ganThongDiepThiTruong.
export function capNhatThiTruong(
  db: Database,
  id: string,
  input: NhapThiTruong,
  tacGia: string,
): ThiTruong {
  return txn(db, () => {
    const cu = layThiTruong(db, id);
    if (!cu) loiRequest(404, "KHONG_TIM_THAY", "Không tìm thấy thị trường.");
    db.query(
      `UPDATE thi_truong SET ten = ?, ngon_ngu = ?, gia = ?, tien_te = ?,
         kha_dung = ?, landing_page = ?, cta_nhan = ?, cta_url = ?,
         ds_chi_tiet = ?, ghi_de = ?, ds_nguoi_duyet = ?, bat_buoc_duyet = ?,
         cap_nhat_luc = ?, cap_nhat_boi = ?
       WHERE id = ?`,
    ).run(
      input.ten !== undefined ? input.ten : cu.ten,
      input.ngon_ngu !== undefined ? input.ngon_ngu : cu.ngon_ngu,
      input.gia !== undefined ? input.gia : cu.gia,
      input.tien_te !== undefined ? input.tien_te : cu.tien_te,
      input.kha_dung !== undefined ? input.kha_dung : cu.kha_dung,
      input.landing_page !== undefined ? input.landing_page : cu.landing_page,
      input.cta_nhan !== undefined ? input.cta_nhan : cu.cta_nhan,
      input.cta_url !== undefined ? input.cta_url : cu.cta_url,
      JSON.stringify(input.ds_chi_tiet ?? cu.ds_chi_tiet),
      JSON.stringify(input.ghi_de ?? cu.ghi_de),
      JSON.stringify(input.ds_nguoi_duyet ?? cu.ds_nguoi_duyet),
      input.bat_buoc_duyet !== undefined ? input.bat_buoc_duyet : cu.bat_buoc_duyet,
      bayGio(),
      tacGia,
      id,
    );
    ghiSuKien(db, "thi_truong", id, "cap_nhat", {}, tacGia);
    return layThiTruong(db, id)!;
  });
}

export function ganNguonThiTruong(db: Database, id: string, nguonId: string): void {
  db.query("UPDATE thi_truong SET nguon_id = ? WHERE id = ?").run(nguonId, id);
}

export function ganThongDiepThiTruong(db: Database, id: string, thongDiepId: string): void {
  db.query("UPDATE thi_truong SET thong_diep_id = ? WHERE id = ?").run(thongDiepId, id);
}

// --- Thông điệp ---

export function layThongDiep(db: Database, id: string): ThongDiep | null {
  return (
    (db.query("SELECT * FROM thong_diep WHERE id = ?").get(id) as ThongDiep | null) ?? null
  );
}

export function danhSachThongDiep(db: Database, campaignId?: string): ThongDiep[] {
  if (campaignId) {
    return db
      .query("SELECT * FROM thong_diep WHERE campaign_id = ? ORDER BY tao_luc DESC")
      .all(campaignId) as ThongDiep[];
  }
  return db.query("SELECT * FROM thong_diep ORDER BY tao_luc DESC").all() as ThongDiep[];
}

export function layThongDiepRevision(db: Database, id: string): ThongDiepRevision | null {
  const row = db
    .query("SELECT * FROM thong_diep_revision WHERE id = ?")
    .get(id) as DongThongDiepRevision | null;
  return row ? docThongDiepRevision(row) : null;
}

export function danhSachThongDiepRevision(db: Database, thongDiepId: string): ThongDiepRevision[] {
  return (
    db
      .query("SELECT * FROM thong_diep_revision WHERE thong_diep_id = ? ORDER BY so_thu_tu")
      .all(thongDiepId) as DongThongDiepRevision[]
  ).map(docThongDiepRevision);
}

export function danhSachNguonCuaThongDiep(db: Database, thongDiepId: string): string[] {
  return (
    db
      .query("SELECT nguon_id FROM thong_diep_nguon WHERE thong_diep_id = ? ORDER BY nguon_id")
      .all(thongDiepId) as { nguon_id: string }[]
  ).map((r) => r.nguon_id);
}

// Head revision của mỗi nguồn liên kết — revision thông điệp ghim đúng các id
// này để bản thể hiện truy về được nguồn đã dùng tại thời điểm viết thông điệp.
function headRevisionCuaDsNguon(db: Database, nguonIds: string[]): string[] {
  const ids: string[] = [];
  for (const nid of nguonIds) {
    const n = layNguon(db, nid);
    if (!n) loiRequest(400, "VALIDATION", `Nguồn liên kết không tồn tại: ${nid}`);
    if (n.head_revision_id) ids.push(n.head_revision_id);
  }
  return ids;
}

// Ghi một revision thông điệp + cập nhật entity/link, trong transaction caller.
function ghiThongDiepRevisionTrongTxn(
  db: Database,
  thongDiepId: string,
  snapshot: {
    tieu_de: string;
    noi_dung: string;
    campaign_id: string | null;
    nguon_ids: string[];
  },
  duaTren: string | null,
  tacGia: string,
): ThongDiepRevision {
  const td = layThongDiep(db, thongDiepId)!;
  assertDuaTren(td.head_revision_id, duaTren);
  const nguonIds = [...new Set(snapshot.nguon_ids)];
  const nguonRevIds = headRevisionCuaDsNguon(db, nguonIds);
  const soTiep =
    ((
      db
        .query("SELECT MAX(so_thu_tu) AS m FROM thong_diep_revision WHERE thong_diep_id = ?")
        .get(thongDiepId) as { m: number | null }
    ).m ?? 0) + 1;
  const id = crypto.randomUUID();
  const ts = bayGio();
  db.query(
    `INSERT INTO thong_diep_revision
       (id, thong_diep_id, so_thu_tu, tieu_de, noi_dung, nguon_revision_ids, dua_tren_revision_id, tao_luc, tao_boi)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    thongDiepId,
    soTiep,
    snapshot.tieu_de,
    snapshot.noi_dung,
    JSON.stringify(nguonRevIds),
    duaTren,
    ts,
    tacGia,
  );
  db.query("DELETE FROM thong_diep_nguon WHERE thong_diep_id = ?").run(thongDiepId);
  for (const nid of nguonIds) {
    db.query("INSERT INTO thong_diep_nguon (thong_diep_id, nguon_id) VALUES (?, ?)").run(
      thongDiepId,
      nid,
    );
  }
  db.query(
    "UPDATE thong_diep SET tieu_de = ?, noi_dung = ?, campaign_id = ?, head_revision_id = ?, cap_nhat_luc = ?, cap_nhat_boi = ? WHERE id = ?",
  ).run(snapshot.tieu_de, snapshot.noi_dung, snapshot.campaign_id, id, ts, tacGia, thongDiepId);
  return layThongDiepRevision(db, id)!;
}

export type NhapThongDiep = {
  tieu_de: string;
  noi_dung?: string;
  campaign_id?: string | null;
  nguon_ids?: string[];
};

export function taoThongDiep(
  db: Database,
  input: NhapThongDiep,
  tacGia: string,
  tuyChon: { id?: string } = {},
): ThongDiep {
  return txn(db, () => {
    if (input.campaign_id && !layCampaign(db, input.campaign_id)) {
      loiRequest(400, "VALIDATION", `Campaign không tồn tại: ${input.campaign_id}`);
    }
    const id = tuyChon.id ?? crypto.randomUUID();
    const ts = bayGio();
    db.query(
      `INSERT INTO thong_diep (id, campaign_id, tieu_de, noi_dung, head_revision_id, tao_luc, tao_boi, cap_nhat_luc, cap_nhat_boi)
       VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?)`,
    ).run(id, input.campaign_id ?? null, input.tieu_de, input.noi_dung ?? "", ts, tacGia, ts, tacGia);
    ghiThongDiepRevisionTrongTxn(
      db,
      id,
      {
        tieu_de: input.tieu_de,
        noi_dung: input.noi_dung ?? "",
        campaign_id: input.campaign_id ?? null,
        nguon_ids: input.nguon_ids ?? [],
      },
      null,
      tacGia,
    );
    ghiSuKien(db, "thong_diep", id, "tao", {}, tacGia);
    return layThongDiep(db, id)!;
  });
}

export function capNhatThongDiep(
  db: Database,
  id: string,
  input: NhapThongDiep,
  duaTrenRevisionId: string,
  tacGia: string,
): ThongDiep {
  return txn(db, () => {
    const td = layThongDiep(db, id);
    if (!td) loiRequest(404, "KHONG_TIM_THAY", "Không tìm thấy thông điệp.");
    if (input.campaign_id && !layCampaign(db, input.campaign_id)) {
      loiRequest(400, "VALIDATION", `Campaign không tồn tại: ${input.campaign_id}`);
    }
    ghiThongDiepRevisionTrongTxn(
      db,
      id,
      {
        tieu_de: input.tieu_de,
        noi_dung: input.noi_dung ?? "",
        campaign_id: input.campaign_id ?? null,
        nguon_ids: input.nguon_ids ?? danhSachNguonCuaThongDiep(db, id),
      },
      duaTrenRevisionId,
      tacGia,
    );
    const moi = layThongDiep(db, id)!;
    ghiSuKien(db, "thong_diep", id, "revision_moi", { revision_id: moi.head_revision_id }, tacGia);
    return moi;
  });
}

// --- Bản thể hiện ---

export function layBanTheHien(db: Database, id: string): BanTheHien | null {
  return (db.query("SELECT * FROM ban_the_hien WHERE id = ?").get(id) as BanTheHien | null) ?? null;
}

// Lọc theo thong_diep_id trực tiếp, hoặc nguon_id qua link nhiều-nhiều —
// một bản thể hiện xuất hiện dưới mọi nguồn mà thông điệp của nó dùng.
// campaignId lọc bản thể hiện dưới mọi thông điệp của campaign (hàng chờ
// review theo số báo, #8).
export function danhSachBanTheHien(
  db: Database,
  loc: { thongDiepId?: string; nguonId?: string; campaignId?: string; trangThai?: string } = {},
): BanTheHien[] {
  const ds = loc.campaignId
    ? (db
        .query(
          `SELECT b.* FROM ban_the_hien b
           JOIN thong_diep td ON td.id = b.thong_diep_id
           WHERE td.campaign_id = ? ORDER BY b.tao_luc DESC`,
        )
        .all(loc.campaignId) as BanTheHien[])
    : loc.nguonId
      ? (db
          .query(
            `SELECT b.* FROM ban_the_hien b
           JOIN thong_diep_nguon tn ON tn.thong_diep_id = b.thong_diep_id
           WHERE tn.nguon_id = ? ORDER BY b.tao_luc DESC`,
          )
          .all(loc.nguonId) as BanTheHien[])
      : loc.thongDiepId
        ? (db
            .query("SELECT * FROM ban_the_hien WHERE thong_diep_id = ? ORDER BY tao_luc DESC")
            .all(loc.thongDiepId) as BanTheHien[])
        : (db.query("SELECT * FROM ban_the_hien ORDER BY tao_luc DESC").all() as BanTheHien[]);
  // Lọc trạng thái cho hàng chờ review (#21) — nhỏ, lọc trong bộ nhớ đủ.
  return loc.trangThai ? ds.filter((b) => b.trang_thai === loc.trangThai) : ds;
}

export type NhapBanTheHien = {
  thong_diep_id: string;
  dinh_dang: string;
  ngon_ngu?: string;
  phien_ban_dinh_dang?: number;
  doi_tuong?: string;
  dich_den?: string;
};

export function taoBanTheHien(
  db: Database,
  input: NhapBanTheHien,
  tacGia: string,
  tuyChon: { id?: string } = {},
): BanTheHien {
  return txn(db, () => {
    if (!layThongDiep(db, input.thong_diep_id)) {
      loiRequest(400, "VALIDATION", `Thông điệp không tồn tại: ${input.thong_diep_id}`);
    }
    const id = tuyChon.id ?? crypto.randomUUID();
    // Bản thể hiện ghim phiên bản định dạng lúc tạo — renderer đổi sau này
    // vẫn truy về được schema đã dùng (#19).
    const phienBan = input.phien_ban_dinh_dang ?? layDinhDang(input.dinh_dang)?.phien_ban ?? 1;
    db.query(
      `INSERT INTO ban_the_hien
         (id, thong_diep_id, dinh_dang, ngon_ngu, phien_ban_dinh_dang, doi_tuong, dich_den, trang_thai, head_revision_id, tao_luc, tao_boi)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'nhap', NULL, ?, ?)`,
    ).run(
      id,
      input.thong_diep_id,
      input.dinh_dang,
      input.ngon_ngu ?? "vi",
      phienBan,
      input.doi_tuong ?? "",
      input.dich_den ?? "",
      bayGio(),
      tacGia,
    );
    ghiSuKien(db, "ban_the_hien", id, "tao", {}, tacGia);
    return layBanTheHien(db, id)!;
  });
}

// Tìm bản thể hiện trùng danh tính đầu ra (thông điệp, định dạng, ngôn ngữ,
// đối tượng, đích đến) — enqueue và nhập bài dùng chung để không tạo trùng.
export function timBanTheHien(db: Database, khoa: NhapBanTheHien): BanTheHien | null {
  return (
    (db
      .query(
        `SELECT * FROM ban_the_hien
         WHERE thong_diep_id = ? AND dinh_dang = ? AND ngon_ngu = ? AND doi_tuong = ? AND dich_den = ?`,
      )
      .get(
        khoa.thong_diep_id,
        khoa.dinh_dang,
        khoa.ngon_ngu ?? "vi",
        khoa.doi_tuong ?? "",
        khoa.dich_den ?? "",
      ) as BanTheHien | null) ?? null
  );
}

// Chuyển trạng thái review: validate chuỗi chuyển, ghi record duyet ghim
// revision nội dung tại thời điểm chấm + sự kiện.
// `mong_doi_revision_id` (#21): client ghim revision mà nó đang chấm —
// head đã đổi → 409 XUNG_DOT_REVISION thay vì duyệt nhầm revision mới.
// Bắt buộc khi duyệt (den = 'da_duyet').
export function chuyenTrangThai(
  db: Database,
  id: string,
  den: string,
  ghiChu: string,
  tacGia: string,
  mongDoiRevisionId?: string,
  // #11: reviewer local được ghi vào record duyệt của campaign công
  // quyền (cổng review thẩm quyền); luồng khác để trống.
  nguoiDuyetId?: string,
): BanTheHien {
  return txn(db, () => {
    const bth = layBanTheHien(db, id);
    if (!bth) loiRequest(404, "KHONG_TIM_THAY", "Không tìm thấy bản thể hiện.");
    if (!laTrangThai(den)) {
      throw new LoiApi(400, "VALIDATION", "trang_thai không hợp lệ.", [
        `Cho phép: ${DANH_SACH_TRANG_THAI.join(", ")}`,
      ]);
    }
    if (!chuyenHopLe(bth.trang_thai, den)) {
      throw new LoiApi(
        409,
        "XUNG_DOT_TRANG_THAI",
        `Không thể chuyển từ '${bth.trang_thai}' sang '${den}'.`,
      );
    }
    if (den === "da_duyet" && !mongDoiRevisionId) {
      throw new LoiApi(
        400,
        "VALIDATION",
        "Duyệt phải kèm mong_doi_revision_id — revision được duyệt phải tường minh.",
      );
    }
    if (mongDoiRevisionId !== undefined && mongDoiRevisionId !== (bth.head_revision_id ?? "")) {
      throw new LoiApi(
        409,
        "XUNG_DOT_REVISION",
        "Revision đích đã đổi — request duyệt cũ không còn áp được. Tải lại rồi chấm lại.",
        { head_revision_id: bth.head_revision_id },
      );
    }
    const tu = bth.trang_thai;
    db.query("UPDATE ban_the_hien SET trang_thai = ? WHERE id = ?").run(den, id);
    db.query(
      `INSERT INTO duyet (id, ban_the_hien_id, revision_id, tu_trang_thai, den_trang_thai, ghi_chu, nguoi_duyet_id, tao_luc, tao_boi)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      crypto.randomUUID(),
      id,
      bth.head_revision_id,
      tu,
      den,
      ghiChu,
      nguoiDuyetId ?? "",
      bayGio(),
      tacGia,
    );
    ghiSuKien(db, "ban_the_hien", id, "trang_thai", { tu, den }, tacGia);
    return layBanTheHien(db, id)!;
  });
}

export function danhSachDuyet(db: Database, banTheHienId: string): Duyet[] {
  return db
    .query("SELECT * FROM duyet WHERE ban_the_hien_id = ? ORDER BY tao_luc DESC, id DESC")
    .all(banTheHienId) as Duyet[];
}

export function danhSachDuyetTheoRevision(db: Database, revisionId: string): Duyet[] {
  return db
    .query("SELECT * FROM duyet WHERE revision_id = ? ORDER BY tao_luc DESC, id DESC")
    .all(revisionId) as Duyet[];
}

// --- Revision nội dung ---

export function danhSachRevision(db: Database, banTheHienId: string): Revision[] {
  return db
    .query("SELECT * FROM revision WHERE ban_the_hien_id = ? ORDER BY so_thu_tu")
    .all(banTheHienId) as Revision[];
}

export function layRevision(db: Database, id: string): Revision | null {
  return (db.query("SELECT * FROM revision WHERE id = ?").get(id) as Revision | null) ?? null;
}

type NhapRevision = {
  ban_the_hien_id: string;
  noi_dung: string;
  dua_tren_revision_id: string | null;
  // Context sinh + revision thông điệp đã dùng khi tạo revision này
  // (job sinh ghi; nhập tay ghim head thông điệp hiện tại).
  context_sinh_id?: string | null;
  thong_diep_revision_id?: string | null;
};

// Phần ghi của themRevision KHÔNG mở transaction — caller bọc BEGIN/COMMIT.
// Dùng khi revision phải commit nguyên tử cùng ghi khác (vd context_sinh trong job).
export function themRevisionTrongTxn(
  db: Database,
  input: NhapRevision,
  tacGia: string,
): Revision {
  const bth = layBanTheHien(db, input.ban_the_hien_id);
  if (!bth) loiRequest(404, "KHONG_TIM_THAY", "Không tìm thấy bản thể hiện.");
  assertDuaTren(bth.head_revision_id, input.dua_tren_revision_id ?? null);
  // Provenance: nhập tay ghim head thông điệp hiện tại; job sinh truyền đúng
  // revision thông điệp đã dùng. NULL cho phép khi thông điệp chưa có revision.
  let tdRevId = input.thong_diep_revision_id;
  if (tdRevId === undefined) {
    const td = layThongDiep(db, bth.thong_diep_id);
    tdRevId = td?.head_revision_id ?? null;
  }
  const soTiep =
    ((
      db
        .query("SELECT MAX(so_thu_tu) AS m FROM revision WHERE ban_the_hien_id = ?")
        .get(input.ban_the_hien_id) as { m: number | null }
    ).m ?? 0) + 1;
  const id = crypto.randomUUID();
  const ts = bayGio();
  db.query(
    `INSERT INTO revision
       (id, ban_the_hien_id, so_thu_tu, noi_dung, dua_tren_revision_id, context_sinh_id, thong_diep_revision_id, tao_luc, tao_boi)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.ban_the_hien_id,
    soTiep,
    input.noi_dung,
    input.dua_tren_revision_id ?? null,
    input.context_sinh_id ?? null,
    tdRevId,
    ts,
    tacGia,
  );
  db.query("UPDATE ban_the_hien SET head_revision_id = ? WHERE id = ?").run(
    id,
    input.ban_the_hien_id,
  );
  // Mất hiệu lực duyệt (#21): revision mới đè lên bản đã duyệt → 'thay_the'
  // (duyệt vẫn ghim revision cũ, không duyệt bản mới); bản bị từ chối có
  // nội dung mới → về 'nhap' để đi review lại. Không ghi record duyet —
  // đây là hệ quả cơ học, không phải hành động chấm.
  if (bth.trang_thai === "da_duyet" || bth.trang_thai === "tu_choi") {
    const den = bth.trang_thai === "da_duyet" ? "thay_the" : "nhap";
    db.query("UPDATE ban_the_hien SET trang_thai = ? WHERE id = ?").run(
      den,
      input.ban_the_hien_id,
    );
    ghiSuKien(
      db,
      "ban_the_hien",
      input.ban_the_hien_id,
      "trang_thai_tu_dong",
      { tu: bth.trang_thai, den, ly_do: "revision_moi" },
      tacGia,
    );
  }
  ghiSuKien(
    db,
    "ban_the_hien",
    input.ban_the_hien_id,
    "revision_moi",
    { revision_id: id, so_thu_tu: soTiep },
    tacGia,
  );
  return layRevision(db, id)!;
}

// Convention xung đột revision: client phải gửi dua_tren_revision_id = head mà nó thấy.
// Khác với head hiện tại → 409 XUNG_DOT_REVISION.
export function themRevision(db: Database, input: NhapRevision, tacGia: string): Revision {
  return txn(db, () => themRevisionTrongTxn(db, input, tacGia));
}

// --- Nháp autosave (#21) ---

export type NhapSoan = {
  id: string;
  ban_the_hien_id: string;
  actor: string;
  noi_dung: string;
  dua_tren_revision_id: string | null;
  cap_nhat_luc: string;
};

export function layNhapSoan(db: Database, banTheHienId: string, actor: string): NhapSoan | null {
  return (
    (db
      .query("SELECT * FROM nhap_soan WHERE ban_the_hien_id = ? AND actor = ?")
      .get(banTheHienId, actor) as NhapSoan | null) ?? null
  );
}

// Upsert nháp của actor. `dua_tren_revision_id` lưu head mà nháp dựa trên —
// client gửi head nó thấy lúc bắt đầu sửa; lần lưu sau không đổi trừ khi
// client tường minh rebase (sau khi giải quyết xung đột).
export function luuNhapSoan(
  db: Database,
  banTheHienId: string,
  actor: string,
  input: { noi_dung: string; dua_tren_revision_id?: string | null },
): NhapSoan {
  return txn(db, () => {
    if (!layBanTheHien(db, banTheHienId)) {
      loiRequest(404, "KHONG_TIM_THAY", "Không tìm thấy bản thể hiện.");
    }
    const cu = layNhapSoan(db, banTheHienId, actor);
    const id = cu?.id ?? crypto.randomUUID();
    const duaTren =
      input.dua_tren_revision_id !== undefined
        ? input.dua_tren_revision_id
        : (cu?.dua_tren_revision_id ?? null);
    db.query(
      `INSERT INTO nhap_soan (id, ban_the_hien_id, actor, noi_dung, dua_tren_revision_id, cap_nhat_luc)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (ban_the_hien_id, actor)
       DO UPDATE SET noi_dung = excluded.noi_dung, dua_tren_revision_id = excluded.dua_tren_revision_id, cap_nhat_luc = excluded.cap_nhat_luc`,
    ).run(id, banTheHienId, actor, input.noi_dung, duaTren, bayGio());
    return layNhapSoan(db, banTheHienId, actor)!;
  });
}

export function xoaNhapSoan(db: Database, banTheHienId: string, actor: string): void {
  db.query("DELETE FROM nhap_soan WHERE ban_the_hien_id = ? AND actor = ?").run(
    banTheHienId,
    actor,
  );
}

// --- Xuất bản ---

type DongXuatBan = Omit<XuatBan, "asset_ids"> & { asset_ids: string };

const docXuatBan = (row: DongXuatBan): XuatBan => {
  let ids: string[] = [];
  try {
    const j = JSON.parse(row.asset_ids) as unknown;
    if (Array.isArray(j)) ids = j.map(String);
  } catch {
    // JSON hỏng → coi như không asset nào được chọn lúc đăng.
  }
  return { ...row, asset_ids: ids };
};

// Record xuất bản: append-only, ghim revision nội dung được đăng + snapshot
// asset được chọn (route truyền ds asset hiện tại từ ban_the_hien_asset).
// Tách khỏi trạng thái review — bản thể hiện không tự "đã đăng" vì được sinh.
export function xuatBanBanTheHien(
  db: Database,
  banTheHienId: string,
  input: { dich_den?: string; ghi_chu?: string; asset_ids?: string[] },
  tacGia: string,
): XuatBan {
  return txn(db, () => {
    const bth = layBanTheHien(db, banTheHienId);
    if (!bth) loiRequest(404, "KHONG_TIM_THAY", "Không tìm thấy bản thể hiện.");
    if (!bth.head_revision_id) {
      throw new LoiApi(
        409,
        "XUNG_DOT_TRANG_THAI",
        "Bản thể hiện chưa có nội dung để xuất bản.",
      );
    }
    // Vòng đời ép phía server (#21): chỉ bản đã duyệt được phát hành record
    // xuất bản — được sinh ≠ được đăng.
    if (bth.trang_thai !== "da_duyet") {
      throw new LoiApi(
        409,
        "XUNG_DOT_TRANG_THAI",
        `Chỉ xuất bản khi đã duyệt — trạng thái hiện tại '${bth.trang_thai}'.`,
      );
    }
    const id = crypto.randomUUID();
    const ts = bayGio();
    const assetIds = input.asset_ids ?? [];
    db.query(
      `INSERT INTO xuat_ban (id, ban_the_hien_id, revision_id, dich_den, ghi_chu, asset_ids, tao_luc, tao_boi)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      banTheHienId,
      bth.head_revision_id,
      input.dich_den ?? bth.dich_den,
      input.ghi_chu ?? "",
      JSON.stringify(assetIds),
      ts,
      tacGia,
    );
    ghiSuKien(
      db,
      "ban_the_hien",
      banTheHienId,
      "xuat_ban",
      {
        revision_id: bth.head_revision_id,
        dich_den: input.dich_den ?? bth.dich_den,
        asset_ids: assetIds,
      },
      tacGia,
    );
    return docXuatBan(db.query("SELECT * FROM xuat_ban WHERE id = ?").get(id) as DongXuatBan);
  });
}

export function danhSachXuatBan(db: Database, banTheHienId: string): XuatBan[] {
  return (
    db
      .query("SELECT * FROM xuat_ban WHERE ban_the_hien_id = ? ORDER BY tao_luc DESC, id DESC")
      .all(banTheHienId) as DongXuatBan[]
  ).map(docXuatBan);
}

// --- Nhập bài: service dùng chung ---

export type NhapBaiViet = {
  tieu_de: string;
  noi_dung: string;
  loai?: string;
  cac_muc?: MucNguon[];
  campaign_id?: string | null;
  // Thông điệp mặc định lấy tiêu đề/nội dung nguồn khi không ghi đè.
  thong_diep?: { tieu_de?: string; noi_dung?: string };
  // Nguồn có sẵn liên kết thêm vào thông điệp (ngoài nguồn vừa tạo).
  nguon_ids?: string[];
  // Các đầu ra cần tạo sẵn; mặc định một đầu ra 'web'.
  ds_ban_the_hien?: Omit<NhapBanTheHien, "thong_diep_id">[];
};

// Dán một bài viết → một nguồn + một thông điệp + nhiều bản thể hiện,
// tất cả trong một transaction. Đây là service dùng chung mà API/intake gọi.
export function nhapBaiViet(
  db: Database,
  input: NhapBaiViet,
  tacGia: string,
): { nguon: Nguon; thong_diep: ThongDiep; ds_ban_the_hien: BanTheHien[] } {
  return txn(db, () => {
    const nguon = taoNguon(
      db,
      {
        tieu_de: input.tieu_de,
        noi_dung: input.noi_dung,
        loai: input.loai,
        cac_muc: input.cac_muc,
      },
      tacGia,
    );
    const thongDiep = taoThongDiep(
      db,
      {
        tieu_de: input.thong_diep?.tieu_de || nguon.tieu_de,
        noi_dung: input.thong_diep?.noi_dung ?? nguon.noi_dung,
        campaign_id: input.campaign_id ?? null,
        nguon_ids: [nguon.id, ...(input.nguon_ids ?? [])],
      },
      tacGia,
    );
    const dsOut = input.ds_ban_the_hien ?? [{ dinh_dang: "bai-viet" }];
    const dsBth: BanTheHien[] = [];
    for (const o of dsOut) {
      // Dedupe theo danh tính đầu ra: intake lặp cùng bộ không tạo trùng.
      const co = timBanTheHien(db, { ...o, thong_diep_id: thongDiep.id });
      dsBth.push(co ?? taoBanTheHien(db, { ...o, thong_diep_id: thongDiep.id }, tacGia));
    }
    return { nguon, thong_diep: thongDiep, ds_ban_the_hien: dsBth };
  });
}
