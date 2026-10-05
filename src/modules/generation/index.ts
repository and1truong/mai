import type { CauHinhAi } from "../../config.ts";
import { LoiApi } from "../../loi.ts";
import type { ContextSinhSnapshot } from "../context/index.ts";
import type {
  AssetHinh,
  ClaimThuongHieu,
  CtaLienKet,
  FactPhatHanh,
  FactVanHanh,
  GioiHanPhatHanh,
  NgoaiLeCongQuyen,
  TacDongGayQuy,
  TrichDanGayQuy,
  YeuCauCongQuyen,
} from "../content/index.ts";
import type { DinhNghiaDinhDang } from "../formats/index.ts";
import { fixture } from "./fixture.ts";
import { taoAdapterOpenAI } from "./live.ts";
import type { TaskDinhNghia } from "./task.ts";

// Module sinh nội dung (#20): contract provider dùng chung cho fixture
// (deterministic, offline, mặc định) và adapter live cấu hình được.
//
// Nguyên tắc:
// - Provider chỉ SINH nội dung — không có năng lực xuất bản/thanh toán,
//   không tool call tự chủ. Tài liệu nguồn trong context là DỮ LIỆU,
//   không phải chỉ dẫn: prompt của adapter live ghi rõ điều đó.
// - Key API đọc từ env phía server tại thời điểm gọi; không đưa vào log,
//   ket_qua, context_sinh hay bundle export.
// - Đầu ra contract: `noi_dung` là canonical JSON theo schema định dạng
//   (#19); `trich_dan` chỉ được phép tham chiếu revision nguồn đã đưa vào
//   context — kiểm chứng tại modules/generation/hop_le.ts.

// Một nguồn đã chọn đưa vào context: trích dẫn đầu ra resolve về revision_id.
// ds_muc = id các mục trong revision đã ghim — con trỏ bằng chứng muc_id
// của campaign chỉ còn hiệu lực khi mục đó còn tồn tại trong bản này.
export type NguonContext = {
  revision_id: string;
  nguon_id: string;
  so_thu_tu: number;
  tieu_de: string;
  noi_dung: string; // đã cắt gọn theo giới hạn nếu cần
  da_cat_gon: boolean;
  ds_muc: string[];
};

// Fact release đưa vào context (#9): xac_nhan=false khi fact không trỏ
// nguồn đã nạp hoặc nguồn đó không vào chuỗi provenance của lần sinh —
// provider phải để [CÂU HỎI], không trình bày như sự thật.
export type FactPhatHanhContext = FactPhatHanh & {
  xac_nhan: boolean;
  nguon_tieu_de?: string;
};

// Context bản phát hành (#9) — chỉ có khi thông điệp thuộc campaign loai
// 'phat_hanh': định vị đã duyệt, giới hạn gói/vùng/khả dụng, link CTA và
// fact tính năng kèm cờ xác nhận bằng chứng.
export type PhatHanhContext = {
  ten: string;
  phien_ban: string;
  ngay_phat_hanh: string;
  dinh_vi: string;
  gioi_han: GioiHanPhatHanh[];
  cta: CtaLienKet[];
  ds_fact: FactPhatHanhContext[];
};

// Tác động/trích dẫn gây quỹ đưa vào context (#10): xac_nhan=false khi
// mục không trỏ nguồn đã nạp hoặc nguồn đó không vào chuỗi provenance
// của lần sinh — provider phải để [CÂU HỎI], không trình bày như sự
// thật. trang_thai 'da_dat' | 'uoc_tinh' đi kèm để đầu ra không trộn
// tác động đã đo với ước tính.
export type TacDongContext = TacDongGayQuy & {
  xac_nhan: boolean;
  nguon_tieu_de?: string;
};
export type TrichDanContext = TrichDanGayQuy & {
  xac_nhan: boolean;
  nguon_tieu_de?: string;
};

// Context chiến dịch gây quỹ (#10) — chỉ có khi thông điệp thuộc
// campaign loai 'gay_quy': mục tiêu + số tiền kèm tiền tệ, thông điệp
// lõi, tác động/trích dẫn kèm cờ xác nhận, CTA quyên góp và ngôn ngữ
// thứ hai.
export type GayQuyContext = {
  ten: string;
  muc_tieu: string;
  so_tien_muc_tieu: number | null;
  tien_te: string;
  thong_diep_loi: string;
  ngon_ngu_phu: string;
  cta: CtaLienKet[];
  ds_tac_dong: TacDongContext[];
  ds_trich_dan: TrichDanContext[];
};

// Yêu cầu/ngoại lệ/fact vận hành đưa vào context (#11): xac_nhan=false
// khi mục không trỏ nguồn đã nạp hoặc nguồn đó không vào chuỗi
// provenance của lần sinh — provider phải để [CÂU HỎI], không trình
// bày như quy định. loai 'bat_buoc' | 'giai_thich' đi kèm để đầu ra
// không viết điểm giải thích thành nghĩa vụ.
export type YeuCauContext = YeuCauCongQuyen & {
  xac_nhan: boolean;
  nguon_tieu_de?: string;
};
export type NgoaiLeContext = NgoaiLeCongQuyen & {
  xac_nhan: boolean;
  nguon_tieu_de?: string;
};
export type FactVanHanhContext = FactVanHanh & {
  xac_nhan: boolean;
  nguon_tieu_de?: string;
};

// Context chiến dịch công quyền (#11) — chỉ có khi thông điệp thuộc
// campaign loai 'cong_quyen': phiên bản/phạm vi/ngày hiệu lực của
// chính sách, danh sách yêu cầu + ngoại lệ + fact vận hành kèm cờ xác
// nhận, và điều khoản nguồn mơ hồ → câu hỏi review, không phải luật bịa.
export type CongQuyenContext = {
  ten: string;
  phien_ban: string;
  pham_vi_quyen_han: string;
  ngay_hieu_luc: string;
  ngon_ngu_phu: string;
  cta: CtaLienKet[];
  ds_yeu_cau: YeuCauContext[];
  ds_ngoai_le: NgoaiLeContext[];
  ds_fact_van_hanh: FactVanHanhContext[];
  // Mệnh đề nguồn chứa từ ngữ mơ hồ/mâu thuẫn — provider để câu hỏi
  // review cho thẩm quyền, không diễn giải thay luật.
  dieu_khoan_mo_ho: string[];
};

// Claim đã duyệt của chiến dịch thương hiệu đưa vào context (#12):
// xac_nhan=false khi claim không trỏ nguồn đã nạp hoặc nguồn đó không
// vào chuỗi provenance — provider phải để [CÂU HỎI], không trình bày
// như claim đã duyệt (không bịa hiệu năng/sức khỏe).
export type ClaimThuongHieuContext = ClaimThuongHieu & {
  xac_nhan: boolean;
  nguon_tieu_de?: string;
};

// Fact thị trường đưa vào context — mọi giá trị là nguyên văn được đội
// local cung cấp: không quy đổi tiền tệ, không bịa. co_gia=false → đầu
// ra phải để [CÂU HỎI] thay vì nhắc giá.
export type ThiTruongContext = {
  ma: string;
  ten: string;
  ngon_ngu: string;
  gia: string;
  tien_te: string;
  co_gia: boolean;
  kha_dung: string; // nhãn đã đọc ('Còn hàng' / 'Hết hàng' / 'Đặt trước')
  co_kha_dung: boolean;
  landing_page: string;
  cta_nhan: string;
  cta_url: string;
  // Chi tiết đã duyệt riêng cho đối tượng của đầu ra này — provider giữ
  // nguyên văn; rỗng khi thị trường không cung cấp cho đối tượng đó.
  chi_tiet: string;
  // Ghi đè tự do tường minh — liệt kê dạng "khoa: giá trị".
  ds_ghi_de: { khoa: string; gia_tri: string }[];
};

// Context chiến dịch thương hiệu (#12) — chỉ có khi thông điệp thuộc
// campaign loai 'thuong_hieu' và tổ hợp thị trường được chọn: fact chung
// (claim đã duyệt + giọng văn + asset hình + CTA mặc định) và fact thị
// trường của đúng biến thể.
export type ThuongHieuContext = {
  ten: string;
  thong_diep_loi: string;
  dinh_vi: string;
  giong_van: string;
  cta: CtaLienKet[];
  ds_claim: ClaimThuongHieuContext[];
  ds_asset_hinh: AssetHinh[];
  thi_truong: ThiTruongContext | null;
};

// Context một lần sinh — provider nhận nguyên object này, không tự truy DB.
export type ContextTask = {
  task: TaskDinhNghia;
  thong_diep: { tieu_de: string; noi_dung: string; revision_id: string | null };
  ds_nguon: NguonContext[];
  dinh_dang: DinhNghiaDinhDang | null; // null cho task không gắn một định dạng cụ thể
  doi_tuong: string;
  ngon_ngu: string;
  context_sinh: ContextSinhSnapshot | null;
  // Lập trường biên tập cấu hình trên campaign/số báo (#8) — provider áp
  // định hướng này, không ngầm áp một diễn giải riêng.
  lap_truong?: string | null;
  // Bản phát hành (#9) — có khi campaign loai 'phat_hanh': provider lấy
  // định vị/fact/giới hạn/CTA từ đây thay vì suy diễn từ văn bản.
  phat_hanh?: PhatHanhContext;
  // Chiến dịch gây quỹ (#10) — có khi campaign loai 'gay_quy': provider
  // lấy mục tiêu/tác động/trích dẫn/CTA quyên góp từ đây.
  gay_quy?: GayQuyContext;
  // Chiến dịch công quyền (#11) — có khi campaign loai 'cong_quyen':
  // provider lấy yêu cầu/ngoại lệ/fact/phạm vi/ngày hiệu lực từ đây.
  cong_quyen?: CongQuyenContext;
  // Chiến dịch thương hiệu (#12) — có khi campaign loai 'thuong_hieu':
  // provider lấy claim đã duyệt + giọng văn + fact thị trường của đúng
  // biến thể từ đây — không quy đổi tiền, không bịa giá/khả dụng.
  thuong_hieu?: ThuongHieuContext;
  // Chứng cứ còn thiếu trong input (số liệu/mốc thời gian/văn bản tham
  // chiếu) — provider phải để câu hỏi/khoảng trống tường minh thay vì bịa.
  thieu_chung_cu: string[];
  gioi_han_dau_ra: number; // ký tự
  // Danh sách lỗi của lần sinh trước — đường sửa có biên của handler.
  sua_loi?: string[];
};

export type TrichDan = { nguon_revision_id: string; doan?: string };

export type KetQuaTask = {
  noi_dung: string; // canonical JSON theo schema định dạng (task nhap_ban_the_hien)
  trich_dan: TrichDan[];
  canh_bao: string[];
  model?: string;
  token_vao?: number;
  token_ra?: number;
};

export interface NhaCungCap {
  ten: string;
  la_fixture: boolean;
  model?: string;
  sinh(ctx: ContextTask, tinHieu?: AbortSignal): Promise<KetQuaTask>;
}

// Lỗi từ adapter live. vinh_vien=true → không retry vô ích (sai key, 4xx);
// sua_duoc=true → output lỗi có thể sửa qua một lần repair prompt
// (JSON hỏng, schema lệch). Cả hai đều nằm ngoài LoiVinhVien của jobs —
// handler quyết định mapping.
export class LoiProvider extends Error {
  constructor(
    message: string,
    public readonly vinh_vien = false,
    public readonly sua_duoc = false,
  ) {
    super(message);
    this.name = "LoiProvider";
  }
}

export function layNhaCungCap(cauHinh: CauHinhAi): NhaCungCap {
  switch (cauHinh.provider) {
    case "fixture":
      return fixture;
    case "openai":
      return taoAdapterOpenAI(cauHinh);
    default:
      throw new LoiApi(500, "LOI_CAU_HINH", `Provider sinh nội dung không hỗ trợ: ${cauHinh.provider}`);
  }
}

export { fixture } from "./fixture.ts";
export { TASK, DANH_SACH_TASK, layTask } from "./task.ts";
export type { IdTask, TaskDinhNghia } from "./task.ts";
export {
  lapContextNoiDung,
  MAC_DINH_GIOI_HAN_CONTEXT,
  type GioiHanContext,
} from "./context.ts";
export { kiemTraDauRa, type KetQuaKiemTra } from "./hop_le.ts";
export { danhSachSuDungSinh, ghiSuDungSinh, type SuDungSinh } from "./su_dung.ts";
