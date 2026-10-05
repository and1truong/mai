import type { Database } from "bun:sqlite";
import { loiRequest } from "../../loi.ts";
import {
  layBanTheHien,
  layCampaign,
  layNguonRevision,
  layThiTruong,
  layThiTruongTheoThongDiep,
  layThongDiep,
  layThongDiepRevision,
  type BanTheHien,
} from "../content/index.ts";
import { timDieuKhoanMoHo } from "../cong_quyen/index.ts";
import { nhanKhaDung } from "../thuong_hieu/index.ts";
import { layDoiTuong, type ContextSinhSnapshot } from "../context/index.ts";
import { layDinhDang } from "../formats/index.ts";
import type { ContextTask, NguonContext } from "./index.ts";
import type { TaskDinhNghia } from "./task.ts";

// Bộ dựng context cho một lần sinh (#20): chọn đúng revision thông điệp
// head → revision nguồn đã ghim trong chuỗi, ép giới hạn đầu vào và chỉ ra
// chứng cứ còn thiếu. Mọi phần đưa vào đều được ghi lại trong chính object
// (ds_nguon.revision_id) để provenance/trích dẫn resolve về đúng bản đã dùng.

export type GioiHanContext = {
  toi_da_ky_tu_nguon: number;
  toi_da_ky_tu_context: number;
  toi_da_ky_tu_dau_ra: number;
};

export const MAC_DINH_GIOI_HAN_CONTEXT: GioiHanContext = {
  toi_da_ky_tu_nguon: 4_000,
  toi_da_ky_tu_context: 16_000,
  toi_da_ky_tu_dau_ra: 12_000,
};

// Cắt gọn một văn bản ở ranh đoạn/câu gần trần; đánh dấu [...] khi bị cắt.
// toiDa không hữu hạn hoặc <= 0 (vd NaN từ cấu hình thiếu) → không cắt;
// giới hạn lỗi không được biến thành cắt mọi nguồn thành "[...]".
export function catGon(vanBan: string, toiDa: number): { text: string; daCat: boolean } {
  if (!Number.isFinite(toiDa) || toiDa <= 0 || vanBan.length <= toiDa) {
    return { text: vanBan, daCat: false };
  }
  const dat = vanBan.slice(0, toiDa);
  const ranh = Math.max(dat.lastIndexOf("\n\n"), dat.lastIndexOf(". "), dat.lastIndexOf("\n"));
  // Chỉ cắt theo ranh khi không mất quá nửa phần cho phép.
  const dung = ranh > toiDa * 0.5 ? dat.slice(0, ranh) : dat;
  return { text: dung.trimEnd() + "\n[...]", daCat: true };
}

// Chứng cứ còn thiếu trong input — heuristic deterministic, không phải suy
// đoán AI: provider dùng danh sách này để để câu hỏi/khoảng trống thay vì bịa
// giá/ngày/số liệu tác động.
// Chứng cứ giá: cụm từ giá/khuyến mãi có biên chữ (không khớp "giáo dục",
// "đồng nghiệp") hoặc số tiền kèm đơn vị ("25.000đ", "100 USD").
const RE_GIA =
  /(?<![\p{L}\p{M}])(giá cả|giá bán|giá thành|miễn phí|khuyến mãi|cước phí|chi phí|phí|hoàn tiền)(?![\p{L}\p{M}])|\d[\d.,]*\s*(đ|₫|vnđ|đồng|usd|eur)|\$\s*\d[\d.,]*/iu;

// Ngày tương đối mơ hồ: "tuần sau thứ Bảy", "cuối tuần", "ngày mai"… — mã
// `moc_thoi_gian` không bắt được vì vẫn có từ "tuần"/"thứ", nhưng đầu ra
// cần một ngày cụ thể để xác nhận (#7).
export const RE_NGAY_TUONG_DOI =
  /tuần\s+(sau|tới|này)|thứ\s+(hai|ba|tư|năm|sáu|bảy|nhật|cn)\b(?![^a-zA-Z0-9]*\d)|cuối\s+tuần|ngày\s+mai|sắp\s+tới|tháng\s+(sau|tới|này)|cuối\s+tháng|đầu\s+tháng|cuối\s+năm|đầu\s+năm/iu;

// Ngày cụ thể: 11/10, 11-10-2026, 1.2.2026, 2026-10-10… — sự hiện diện
// của nó xóa cảnh báo ngày tương đối. Ranh giới chữ số/dấu tách hai đầu +
// dấu "." chỉ hợp lệ trong mẫu đủ 3 phần có năm → giá "45.000đ" hay số
// thập phân không bị nhầm là ngày (#7 review).
export const RE_NGAY_CU_THE =
  /(?<![\d/.\-])\d{1,2}\s*[/\-]\s*\d{1,2}(?:\s*[/\-.]\s*\d{2,4})?(?![\d/\-])|(?<![\d/.\-])\d{1,2}\s*\.\s*\d{1,2}\s*\.\s*\d{2,4}(?![\d/\-])|\d{4}-\d{2}-\d{2}/;

export function thieuChungCu(vanBanNguon: string): string[] {
  const ds: string[] = [];
  if (!/\d/.test(vanBanNguon)) ds.push("so_lieu");
  if (!/ngày|tháng|năm|tuần|quý|\b(19|20)\d{2}\b/i.test(vanBanNguon)) ds.push("moc_thoi_gian");
  if (RE_NGAY_TUONG_DOI.test(vanBanNguon) && !RE_NGAY_CU_THE.test(vanBanNguon)) {
    ds.push("ngay_gio_cu_the");
  }
  if (!RE_GIA.test(vanBanNguon)) ds.push("gia_ca");
  return ds;
}

export function lapContextNoiDung(
  db: Database,
  input: {
    bth: BanTheHien;
    task: TaskDinhNghia;
    context_sinh: ContextSinhSnapshot | null;
    doi_tuong: string;
    gioi_han?: Partial<GioiHanContext>;
    // Campaign/số báo tường minh từ payload job (#8); vắng mặt → theo
    // thong_diep.campaign_id.
    campaign_id?: string;
    // Thị trường tường minh của tổ hợp (#12); vắng mặt → suy từ thông
    // điệp riêng của thị trường (thi_truong.thong_diep_id).
    thi_truong_id?: string;
  },
): ContextTask {
  // Merge từng field với ?? — key có mặt nhưng undefined (vd server truyền
  // gioi_han: {toi_da_ky_tu_nguon: undefined} khi chưa cấu hình) không được
  // đè mặc định thành undefined/NaN.
  const gh = input.gioi_han ?? {};
  const gioiHan: GioiHanContext = {
    toi_da_ky_tu_nguon: gh.toi_da_ky_tu_nguon ?? MAC_DINH_GIOI_HAN_CONTEXT.toi_da_ky_tu_nguon,
    toi_da_ky_tu_context: gh.toi_da_ky_tu_context ?? MAC_DINH_GIOI_HAN_CONTEXT.toi_da_ky_tu_context,
    toi_da_ky_tu_dau_ra: gh.toi_da_ky_tu_dau_ra ?? MAC_DINH_GIOI_HAN_CONTEXT.toi_da_ky_tu_dau_ra,
  };
  const bth = layBanTheHien(db, input.bth.id);
  if (!bth) loiRequest(404, "KHONG_TIM_THAY", "Không tìm thấy bản thể hiện.");
  const thongDiep = layThongDiep(db, bth.thong_diep_id);
  if (!thongDiep) loiRequest(404, "KHONG_TIM_THAY", "Không tìm thấy thông điệp.");
  const tdRev = thongDiep.head_revision_id
    ? layThongDiepRevision(db, thongDiep.head_revision_id)
    : null;

  // Chuỗi ghim: revision thông điệp đã ghim sẵn revision nguồn đã dùng —
  // resolve đúng phiên bản, giữ thứ tự khai báo.
  const ds_nguon: NguonContext[] = [];
  let tongKyTu = 0;
  for (const id of tdRev?.nguon_revision_ids ?? []) {
    const n = layNguonRevision(db, id);
    if (!n) continue;
    if (tongKyTu >= gioiHan.toi_da_ky_tu_context) break;
    const toiDa = Math.min(gioiHan.toi_da_ky_tu_nguon, gioiHan.toi_da_ky_tu_context - tongKyTu);
    const { text, daCat } = catGon(n.noi_dung, toiDa);
    tongKyTu += text.length;
    ds_nguon.push({
      revision_id: n.id,
      nguon_id: n.nguon_id,
      so_thu_tu: n.so_thu_tu,
      tieu_de: n.tieu_de,
      noi_dung: text,
      da_cat_gon: daCat,
      ds_muc: n.cac_muc.map((m) => m.id),
    });
  }

  const vanBanNguon = [
    tdRev?.tieu_de ?? thongDiep.tieu_de,
    tdRev?.noi_dung ?? thongDiep.noi_dung,
    ...ds_nguon.map((n) => n.noi_dung),
  ].join("\n");

  // Số báo (#8): thông điệp thuộc campaign số báo → lập trường biên tập đi
  // vào context; tham chiếu đã khai báo mà văn bản không có trong nguồn đã
  // resolve là chứng cứ thiếu — provider gắn cờ thay vì bịa trích dẫn.
  const cpId = input.campaign_id ?? thongDiep.campaign_id;
  const cp = cpId ? layCampaign(db, cpId) : null;
  const thieuCc = thieuChungCu(vanBanNguon);
  if (cp && cp.tham_chieu.length > 0) {
    const nguonIds = new Set(ds_nguon.map((n) => n.nguon_id));
    if (cp.tham_chieu.some((t) => !t.nguon_id || !nguonIds.has(t.nguon_id))) {
      thieuCc.push("van_ban_tham_chieu");
    }
  }

  // Con trỏ bằng chứng vào một nguồn trong chuỗi provenance: xác nhận
  // chỉ khi nguồn có mặt VÀ (nếu có muc_id) mục đó còn trong cac_muc
  // của revision nguồn đã ghim — nguồn bị sửa xóa mục thì mục trỏ tới
  // coi như chưa xác nhận (khớp view co_bang_chung của UI/gợi ý).
  const nguonTrongContext = new Map(ds_nguon.map((n) => [n.nguon_id, n]));
  const daXacNhan = (nguonId: string | null, mucId: string | null): string | undefined => {
    if (!nguonId) return undefined;
    const n = nguonTrongContext.get(nguonId);
    if (!n) return undefined;
    if (mucId && !n.ds_muc.includes(mucId)) return undefined;
    return n.tieu_de;
  };

  // Bản phát hành (#9): định vị + giới hạn + CTA + fact đi vào context.
  // Fact được xác nhận chỉ khi nguồn bằng chứng của nó nằm trong chuỗi
  // provenance của lần sinh này — fact chưa xác nhận là chứng cứ thiếu.
  let phatHanh: ContextTask["phat_hanh"];
  if (cp && cp.loai === "phat_hanh") {
    const dsFact = cp.ds_fact.map((f) => {
      const tieuDe = daXacNhan(f.nguon_id, f.muc_id);
      return { ...f, xac_nhan: !!tieuDe, nguon_tieu_de: tieuDe };
    });
    if (dsFact.some((f) => !f.xac_nhan)) thieuCc.push("fact_chua_xac_nhan");
    phatHanh = {
      ten: cp.ten,
      phien_ban: cp.phien_ban,
      ngay_phat_hanh: cp.ngay_phat_hanh,
      dinh_vi: cp.dinh_vi,
      gioi_han: cp.gioi_han,
      cta: cp.cta,
      ds_fact: dsFact,
    };
  }

  // Chiến dịch gây quỹ (#10): mục tiêu + số tiền/tiền tệ + thông điệp
  // lõi + tác động/trích dẫn + CTA quyên góp đi vào context. Tác động
  // và trích dẫn được xác nhận chỉ khi nguồn bằng chứng của nó nằm trong
  // chuỗi provenance của lần sinh này — mục chưa xác nhận là chứng cứ
  // thiếu (provider để [CÂU HỎI], không trình bày như sự thật).
  let gayQuy: ContextTask["gay_quy"];
  if (cp && cp.loai === "gay_quy") {
    const dsTacDong = cp.ds_tac_dong.map((t) => {
      const tieuDe = daXacNhan(t.nguon_id, t.muc_id);
      return { ...t, xac_nhan: !!tieuDe, nguon_tieu_de: tieuDe };
    });
    const dsTrichDan = cp.ds_trich_dan.map((t) => {
      const tieuDe = daXacNhan(t.nguon_id, t.muc_id);
      return { ...t, xac_nhan: !!tieuDe, nguon_tieu_de: tieuDe };
    });
    if (dsTacDong.some((t) => !t.xac_nhan)) thieuCc.push("tac_dong_chua_xac_nhan");
    if (dsTrichDan.some((t) => !t.xac_nhan)) thieuCc.push("trich_dan_chua_nguon");
    gayQuy = {
      ten: cp.ten,
      muc_tieu: cp.muc_tieu,
      so_tien_muc_tieu: cp.so_tien_muc_tieu,
      tien_te: cp.tien_te,
      thong_diep_loi: cp.thong_diep_loi,
      ngon_ngu_phu: cp.ngon_ngu_phu,
      cta: cp.cta,
      ds_tac_dong: dsTacDong,
      ds_trich_dan: dsTrichDan,
    };
  }

  // Chiến dịch công quyền (#11): phiên bản/phạm vi/ngày hiệu lực của
  // chính sách + yêu cầu/ngoại lệ/fact vận hành đi vào context. Mục
  // được xác nhận chỉ khi nguồn bằng chứng của nó nằm trong chuỗi
  // provenance — mục chưa xác nhận là chứng cứ thiếu (provider để
  // [CÂU HỎI], không bịa luật). Điều khoản nguồn mơ hồ cũng đi kèm để
  // provider để câu hỏi review thay vì diễn giải thay thẩm quyền.
  let congQuyen: ContextTask["cong_quyen"];
  if (cp && cp.loai === "cong_quyen") {
    const dsYeuCau = cp.ds_yeu_cau.map((t) => {
      const tieuDe = daXacNhan(t.nguon_id, t.muc_id);
      return { ...t, xac_nhan: !!tieuDe, nguon_tieu_de: tieuDe };
    });
    const dsNgoaiLe = cp.ds_ngoai_le.map((t) => {
      const tieuDe = daXacNhan(t.nguon_id, t.muc_id);
      return { ...t, xac_nhan: !!tieuDe, nguon_tieu_de: tieuDe };
    });
    const dsFactVanHanh = cp.ds_fact_van_hanh.map((t) => {
      const tieuDe = daXacNhan(t.nguon_id, t.muc_id);
      return { ...t, xac_nhan: !!tieuDe, nguon_tieu_de: tieuDe };
    });
    if (dsYeuCau.some((t) => !t.xac_nhan)) thieuCc.push("yeu_cau_chua_xac_nhan");
    if (dsNgoaiLe.some((t) => !t.xac_nhan)) thieuCc.push("ngoai_le_chua_xac_nhan");
    if (dsFactVanHanh.some((t) => !t.xac_nhan)) thieuCc.push("fact_van_hanh_chua_nguon");
    const dsMoHo = timDieuKhoanMoHo(db, cp);
    if (dsMoHo.length > 0) thieuCc.push("dieu_khoan_mo_ho");
    congQuyen = {
      ten: cp.ten,
      phien_ban: cp.phien_ban,
      pham_vi_quyen_han: cp.pham_vi_quyen_han,
      ngay_hieu_luc: cp.ngay_hieu_luc,
      ngon_ngu_phu: cp.ngon_ngu_phu,
      cta: cp.cta,
      ds_yeu_cau: dsYeuCau,
      ds_ngoai_le: dsNgoaiLe,
      ds_fact_van_hanh: dsFactVanHanh,
      dieu_khoan_mo_ho: dsMoHo.map((d) => d.trich),
    };
  }

  // Chiến dịch thương hiệu (#12): fact chung (claim đã duyệt kèm cờ xác
  // nhận bằng chứng, giọng văn, asset hình, CTA mặc định) + fact thị
  // trường của đúng biến thể. Giá/tiền tệ/khả dụng giữ nguyên văn; thiếu
  // → cờ co_* = false và chứng cứ thiếu (provider để [CÂU HỎI], không
  // quy đổi tiền, không bịa giá hay yêu cầu pháp lý).
  let thuongHieu: ContextTask["thuong_hieu"];
  if (cp && cp.loai === "thuong_hieu") {
    const tt =
      (input.thi_truong_id ? layThiTruong(db, input.thi_truong_id) : null) ??
      layThiTruongTheoThongDiep(db, bth.thong_diep_id);
    const dsClaim = cp.ds_claim.map((cl) => {
      const tieuDe = daXacNhan(cl.nguon_id, cl.muc_id);
      return { ...cl, xac_nhan: !!tieuDe, nguon_tieu_de: tieuDe };
    });
    if (dsClaim.some((cl) => !cl.xac_nhan)) thieuCc.push("claim_chua_xac_nhan");
    // Chi tiết đã duyệt riêng cho đối tượng của đầu ra này — khớp theo
    // doi_tuong_id của hồ sơ (tên hồ sơ hiển thị trên bth).
    const chiTiet =
      tt?.ds_chi_tiet.find(
        (ct) => layDoiTuong(db, ct.doi_tuong_id)?.ten === input.doi_tuong,
      )?.chi_tiet ?? "";
    thuongHieu = {
      ten: cp.ten,
      thong_diep_loi: cp.thong_diep_loi,
      dinh_vi: cp.dinh_vi,
      giong_van: cp.giong_van,
      cta: cp.cta,
      ds_claim: dsClaim,
      ds_asset_hinh: cp.ds_asset_hinh,
      thi_truong: tt
        ? {
            ma: tt.ma,
            ten: tt.ten,
            ngon_ngu: tt.ngon_ngu,
            gia: tt.gia,
            tien_te: tt.tien_te,
            co_gia: !!tt.gia,
            kha_dung: nhanKhaDung(tt.kha_dung),
            co_kha_dung: !!tt.kha_dung,
            landing_page: tt.landing_page,
            cta_nhan: tt.cta_nhan,
            cta_url: tt.cta_url,
            chi_tiet: chiTiet,
            ds_ghi_de: Object.entries(tt.ghi_de).map(([k, v]: [string, string]) => ({
              khoa: k,
              gia_tri: v,
            })),
          }
        : null,
    };
    if (tt && !tt.gia) thieuCc.push("gia_chua_co");
    if (tt && !tt.kha_dung) thieuCc.push("kha_dung_chua_co");
  }

  return {
    task: input.task,
    thong_diep: {
      tieu_de: tdRev?.tieu_de ?? thongDiep.tieu_de,
      noi_dung: tdRev?.noi_dung ?? thongDiep.noi_dung,
      revision_id: tdRev?.id ?? null,
    },
    ds_nguon,
    dinh_dang: layDinhDang(bth.dinh_dang),
    doi_tuong: input.doi_tuong,
    ngon_ngu: bth.ngon_ngu,
    context_sinh: input.context_sinh,
    lap_truong: cp?.lap_truong || null,
    phat_hanh: phatHanh,
    gay_quy: gayQuy,
    cong_quyen: congQuyen,
    thuong_hieu: thuongHieu,
    thieu_chung_cu: thieuCc,
    gioi_han_dau_ra: gioiHan.toi_da_ky_tu_dau_ra,
  };
}
