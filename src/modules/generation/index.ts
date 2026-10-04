import type { CauHinhAi } from "../../config.ts";
import { LoiApi } from "../../loi.ts";
import type { ContextSinhSnapshot } from "../context/index.ts";
import type {
  CtaLienKet,
  FactPhatHanh,
  GioiHanPhatHanh,
  TacDongGayQuy,
  TrichDanGayQuy,
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
