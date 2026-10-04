import type { Database } from "bun:sqlite";
import {
  capNhatNguon,
  capNhatThongDiep,
  ghiSuKien,
  layCampaign,
  layNguon,
  layNguonRevision,
  layThongDiepRevision,
  taoNguon,
  taoThongDiep,
  type Campaign,
  type GhiChuQuyen,
  type MucLuc,
  type MucNguon,
  type Nguon,
  type TacDongGayQuy,
  type ThongDiep,
  type TrichDanGayQuy,
} from "../content/index.ts";
import { danhSachDoiTuong, type HoSoDoiTuong } from "../context/index.ts";
import { layAsset } from "../nap/index.ts";
import { khoaMucLuc, thongDiepChuDe } from "../so_bao/index.ts";

// Module gây quỹ (#10): một chiến dịch truyền thông nonprofit = một
// campaign loai 'gay_quy' bắt đầu từ MỤC TIÊU (không phải yêu cầu viết
// một bài): mục tiêu + số tiền kèm tiền tệ, thông điệp lõi, danh sách
// tác động đã đạt/ước tính có con trỏ bằng chứng, trích dẫn được phép
// dùng, link CTA quyên góp trỏ đích ngoài, ghi chú quyền cho asset tổ
// chức cung cấp, và ngôn ngữ thứ hai khi được chọn. Mọi đầu ra sinh dưới
// một thông điệp chủ đề (dùng lại luồng chọn/nháp/duyệt/xuất chung).
//
// Nguồn gây quỹ tự động: module chiếu field campaign thành một nguon
// loại 'fact' (cac_muc có id ổn định 'gq-*') rồi link vào thông điệp
// chủ đề. Nhờ đó:
// - mọi đầu ra pin fact gây quỹ trong chuỗi provenance;
// - sửa field → revision nguồn mới → phatHienThayDoiNguon (#14) đánh dấu
//   đầu ra phụ thuộc;
// - tác động/trích dẫn chưa xác nhận (không nguon_id hoặc nguồn không
//   vào context) đi vào ContextTask.gay_quy với xac_nhan=false → bộ
//   sinh để [CÂU HỎI], kiemTraDauRa cảnh báo khi trình bày như sự thật.

// Bọc ghi trong transaction — lặp lại helper của content (private).
function txn<T>(db: Database, fn: () => T): T {
  if (db.inTransaction) return fn();
  db.exec("BEGIN IMMEDIATE");
  try {
    const r = fn();
    db.exec("COMMIT");
    return r;
  } catch (e) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // transaction đã rollback
    }
    throw e;
  }
}

export function laGayQuy(cp: Campaign | null | undefined): boolean {
  return !!cp && cp.loai === "gay_quy";
}

// --- Validation input gây quỹ ---

const RE_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;
// Mã tiền tệ ngắn kiểu ISO-4217 (VND, USD…) — không ép uppercase vì UI
// trim + người nhập có thể gõ thường; chuẩn hóa uppercase khi lưu.
const RE_TIEN_TE = /^[A-Za-z]{2,8}$/;
// Mã ngôn ngữ ngắn kiểu BCP-47 rút gọn (en, pt-BR…) — giới hạn charset
// để khóa đầu ra/khóa job giữ dạng chuỗi đọc được.
const RE_NGON_NGU = /^[a-z]{2}(-[A-Za-z]{2,8})?$/;
const TRANG_THAI_TAC_DONG = ["da_dat", "uoc_tinh"];
const DAI_TOI_DA = {
  muc_tieu: 500,
  thong_diep_loi: 1000,
  td_tieu_de: 200,
  td_noi_dung: 2000,
  so_lieu: 60,
  don_vi: 60,
  ten_nguoi: 120,
  loi_trich_dan: 500,
  ghi_chu_quyen: 500,
};

// Đọc số tiền mục tiêu: chấp nhận số hoặc chuỗi số (UI gửi text);
// undefined = không gửi (PUT partial giữ giá trị cũ), null/rỗng = xóa.
export function docSoTienMucTieu(
  v: unknown,
  dsLoi: string[],
): number | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v.trim()) : NaN;
  if (!Number.isFinite(n)) {
    dsLoi.push("so_tien_muc_tieu phải là số.");
    return undefined;
  }
  if (n < 0) {
    dsLoi.push("so_tien_muc_tieu không được âm.");
    return undefined;
  }
  if (n > 1e15) {
    dsLoi.push("so_tien_muc_tieu quá lớn (tối đa 1e15).");
    return undefined;
  }
  return n;
}

export function docTienTe(v: unknown, dsLoi: string[]): string | undefined {
  if (v === undefined) return undefined;
  const s = typeof v === "string" ? v.trim() : "";
  if (s && !RE_TIEN_TE.test(s)) {
    dsLoi.push("tien_te phải là mã tiền tệ 2-8 ký tự chữ (vd 'VND', 'USD').");
    return undefined;
  }
  return s.toUpperCase();
}

export function docNgonNguPhu(v: unknown, dsLoi: string[]): string | undefined {
  if (v === undefined) return undefined;
  const s = typeof v === "string" ? v.trim() : "";
  if (s && !RE_NGON_NGU.test(s)) {
    dsLoi.push("ngon_ngu_phu phải là mã ngôn ngữ (vd 'en', 'pt-BR').");
    return undefined;
  }
  return s;
}

export function docMucTieu(v: unknown, dsLoi: string[]): string | undefined {
  if (v === undefined) return undefined;
  const s = typeof v === "string" ? v.trim() : "";
  if (s.length > DAI_TOI_DA.muc_tieu) {
    dsLoi.push(`muc_tieu vượt ${DAI_TOI_DA.muc_tieu} ký tự.`);
    return undefined;
  }
  return s;
}

export function docThongDiepLoi(v: unknown, dsLoi: string[]): string | undefined {
  if (v === undefined) return undefined;
  const s = typeof v === "string" ? v.trim() : "";
  if (s.length > DAI_TOI_DA.thong_diep_loi) {
    dsLoi.push(`thong_diep_loi vượt ${DAI_TOI_DA.thong_diep_loi} ký tự.`);
    return undefined;
  }
  return s;
}

// Con trỏ bằng chứng chung cho tác động + trích dẫn: nguon_id đặt thì
// phải tồn tại; muc_id đặt thì phải có trong cac_muc của nguồn đó —
// con trỏ sai không được lưu lặng.
function docConTroNguon(
  db: Database,
  truong: string,
  nguonRaw: unknown,
  mucRaw: unknown,
  dsLoi: string[],
): { nguon_id: string | null; muc_id: string | null } {
  let nguonId: string | null = null;
  if (nguonRaw !== undefined && nguonRaw !== null && nguonRaw !== "") {
    if (typeof nguonRaw !== "string") {
      dsLoi.push(`${truong}.nguon_id phải là chuỗi.`);
    } else {
      const n = layNguon(db, nguonRaw);
      if (!n) {
        dsLoi.push(`${truong}.nguon_id '${nguonRaw}' không tồn tại.`);
      } else {
        nguonId = n.id;
        if (mucRaw !== undefined && mucRaw !== null && mucRaw !== "") {
          if (typeof mucRaw !== "string") {
            dsLoi.push(`${truong}.muc_id phải là chuỗi.`);
          } else if (!n.cac_muc.some((m) => m.id === mucRaw)) {
            dsLoi.push(
              `${truong}.muc_id '${mucRaw}' không có trong cac_muc của nguồn '${n.tieu_de}'.`,
            );
          }
        }
      }
    }
  }
  if (!nguonId && mucRaw !== undefined && mucRaw !== null && mucRaw !== "") {
    dsLoi.push(`${truong}.muc_id yêu cầu kèm nguon_id.`);
  }
  const mucId = typeof mucRaw === "string" && mucRaw && nguonId ? mucRaw.trim() : null;
  return { nguon_id: nguonId, muc_id: mucId };
}

// ds_tac_dong: tác động đã đạt/ước tính + bằng chứng nguồn. trang_thai
// bắt buộc 'da_dat' | 'uoc_tinh' — tiêu chí phân biệt tác động đã đạt
// với ước tính và mục tiêu tương lai.
export function kiemTraDsTacDong(
  db: Database,
  v: unknown,
  dsLoi: string[],
): TacDongGayQuy[] | undefined {
  if (v === undefined) return undefined;
  if (!Array.isArray(v)) {
    dsLoi.push("ds_tac_dong phải là một mảng.");
    return undefined;
  }
  const ds: TacDongGayQuy[] = [];
  const daCo = new Set<string>();
  for (const [i, dong] of v.entries()) {
    if (typeof dong !== "object" || dong === null || Array.isArray(dong)) {
      dsLoi.push(`ds_tac_dong[${i}] phải là object.`);
      continue;
    }
    const t = dong as Record<string, unknown>;
    const id = typeof t.id === "string" && t.id ? t.id.trim() : `td${i + 1}`;
    if (!RE_ID.test(id)) dsLoi.push(`ds_tac_dong[${i}].id '${id}' không hợp lệ (a-z0-9_-, tối đa 64).`);
    if (daCo.has(id)) dsLoi.push(`ds_tac_dong[${i}].id '${id}' trùng với dòng khác.`);
    daCo.add(id);
    const tieuDe = typeof t.tieu_de === "string" ? t.tieu_de.trim() : "";
    const noiDung = typeof t.noi_dung === "string" ? t.noi_dung.trim() : "";
    if (!tieuDe) dsLoi.push(`ds_tac_dong[${i}].tieu_de là bắt buộc.`);
    if (tieuDe.length > DAI_TOI_DA.td_tieu_de) {
      dsLoi.push(`ds_tac_dong[${i}].tieu_de vượt ${DAI_TOI_DA.td_tieu_de} ký tự.`);
    }
    if (!noiDung) dsLoi.push(`ds_tac_dong[${i}].noi_dung là bắt buộc.`);
    if (noiDung.length > DAI_TOI_DA.td_noi_dung) {
      dsLoi.push(`ds_tac_dong[${i}].noi_dung vượt ${DAI_TOI_DA.td_noi_dung} ký tự.`);
    }
    const trangThai = typeof t.trang_thai === "string" ? t.trang_thai.trim() : "";
    if (!TRANG_THAI_TAC_DONG.includes(trangThai)) {
      dsLoi.push(
        `ds_tac_dong[${i}].trang_thai '${trangThai}' không hợp lệ. Cho phép: da_dat, uoc_tinh.`,
      );
    }
    const soLieu = typeof t.so_lieu === "string" ? t.so_lieu.trim() : "";
    if (soLieu.length > DAI_TOI_DA.so_lieu) {
      dsLoi.push(`ds_tac_dong[${i}].so_lieu vượt ${DAI_TOI_DA.so_lieu} ký tự.`);
    }
    const donVi = typeof t.don_vi === "string" ? t.don_vi.trim() : "";
    if (donVi.length > DAI_TOI_DA.don_vi) {
      dsLoi.push(`ds_tac_dong[${i}].don_vi vượt ${DAI_TOI_DA.don_vi} ký tự.`);
    }
    const tro = docConTroNguon(db, `ds_tac_dong[${i}]`, t.nguon_id, t.muc_id, dsLoi);
    ds.push({
      id,
      tieu_de: tieuDe,
      noi_dung: noiDung,
      trang_thai: trangThai,
      so_lieu: soLieu,
      don_vi: donVi,
      nguon_id: tro.nguon_id,
      muc_id: tro.muc_id,
    });
  }
  return ds;
}

// ds_trich_dan: trích dẫn được phép dùng — chống bịa tên người/lời. Mỗi
// trích dẫn nên trỏ nguồn tư liệu; thiếu = gợi ý 'trich_dan_chua_nguon'.
export function kiemTraDsTrichDan(
  db: Database,
  v: unknown,
  dsLoi: string[],
): TrichDanGayQuy[] | undefined {
  if (v === undefined) return undefined;
  if (!Array.isArray(v)) {
    dsLoi.push("ds_trich_dan phải là một mảng.");
    return undefined;
  }
  const ds: TrichDanGayQuy[] = [];
  const daCo = new Set<string>();
  for (const [i, dong] of v.entries()) {
    if (typeof dong !== "object" || dong === null || Array.isArray(dong)) {
      dsLoi.push(`ds_trich_dan[${i}] phải là object.`);
      continue;
    }
    const t = dong as Record<string, unknown>;
    const id = typeof t.id === "string" && t.id ? t.id.trim() : `tq${i + 1}`;
    if (!RE_ID.test(id)) dsLoi.push(`ds_trich_dan[${i}].id '${id}' không hợp lệ (a-z0-9_-, tối đa 64).`);
    if (daCo.has(id)) dsLoi.push(`ds_trich_dan[${i}].id '${id}' trùng với dòng khác.`);
    daCo.add(id);
    const tenNguoi = typeof t.ten_nguoi === "string" ? t.ten_nguoi.trim() : "";
    const loi = typeof t.loi === "string" ? t.loi.trim() : "";
    if (!tenNguoi) dsLoi.push(`ds_trich_dan[${i}].ten_nguoi là bắt buộc.`);
    if (tenNguoi.length > DAI_TOI_DA.ten_nguoi) {
      dsLoi.push(`ds_trich_dan[${i}].ten_nguoi vượt ${DAI_TOI_DA.ten_nguoi} ký tự.`);
    }
    if (!loi) dsLoi.push(`ds_trich_dan[${i}].loi là bắt buộc.`);
    if (loi.length > DAI_TOI_DA.loi_trich_dan) {
      dsLoi.push(`ds_trich_dan[${i}].loi vượt ${DAI_TOI_DA.loi_trich_dan} ký tự.`);
    }
    const tro = docConTroNguon(db, `ds_trich_dan[${i}]`, t.nguon_id, t.muc_id, dsLoi);
    ds.push({ id, ten_nguoi: tenNguoi, loi, nguon_id: tro.nguon_id, muc_id: tro.muc_id });
  }
  return ds;
}

// ghi_chu_quyen: quyền/đồng ý sử dụng cho asset tổ chức cung cấp.
// asset_id phải trỏ asset có thật trong kho; ghi_chu là phạm vi được
// phép — hiển thị khi review đầu ra đính kèm asset đó.
export function kiemTraGhiChuQuyen(
  db: Database,
  v: unknown,
  dsLoi: string[],
): GhiChuQuyen[] | undefined {
  if (v === undefined) return undefined;
  if (!Array.isArray(v)) {
    dsLoi.push("ghi_chu_quyen phải là một mảng.");
    return undefined;
  }
  const ds: GhiChuQuyen[] = [];
  const daCo = new Set<string>();
  for (const [i, dong] of v.entries()) {
    if (typeof dong !== "object" || dong === null || Array.isArray(dong)) {
      dsLoi.push(`ghi_chu_quyen[${i}] phải là object.`);
      continue;
    }
    const q = dong as Record<string, unknown>;
    const id = typeof q.id === "string" && q.id ? q.id.trim() : `q${i + 1}`;
    if (!RE_ID.test(id)) dsLoi.push(`ghi_chu_quyen[${i}].id '${id}' không hợp lệ (a-z0-9_-, tối đa 64).`);
    if (daCo.has(id)) dsLoi.push(`ghi_chu_quyen[${i}].id '${id}' trùng với dòng khác.`);
    daCo.add(id);
    const assetId = typeof q.asset_id === "string" ? q.asset_id.trim() : "";
    if (!assetId) {
      dsLoi.push(`ghi_chu_quyen[${i}].asset_id là bắt buộc.`);
    } else if (!layAsset(db, assetId)) {
      dsLoi.push(`ghi_chu_quyen[${i}].asset_id '${assetId}' không tồn tại.`);
    }
    const ghiChu = typeof q.ghi_chu === "string" ? q.ghi_chu.trim() : "";
    if (!ghiChu) dsLoi.push(`ghi_chu_quyen[${i}].ghi_chu là bắt buộc.`);
    if (ghiChu.length > DAI_TOI_DA.ghi_chu_quyen) {
      dsLoi.push(`ghi_chu_quyen[${i}].ghi_chu vượt ${DAI_TOI_DA.ghi_chu_quyen} ký tự.`);
    }
    ds.push({ id, asset_id: assetId, ghi_chu: ghiChu });
  }
  return ds;
}

// --- Nguồn gây quỹ tự động ---

// Hiển thị số tiền mục tiêu kèm đơn vị tiền tệ — dùng chung cho nguồn
// fact, context sinh và kiểm chứng đầu ra.
export function hienThiSoTieuMucTieu(cp: Campaign): string {
  if (cp.so_tien_muc_tieu === null || cp.so_tien_muc_tieu === undefined) return "";
  const so = cp.so_tien_muc_tieu.toLocaleString("vi-VN");
  return cp.tien_te ? `${so} ${cp.tien_te}` : so;
}

// Chiếu field gây quỹ → một nguon 'fact' xác định (deterministic): mỗi
// field là một mục có id ổn định để diff revision chỉ đúng mục đổi.
// Tác động giữ nhãn ĐÃ ĐẠT/ƯỚC TÍNH trong tiêu đề mục; mục tiêu gây quỹ
// tương lai là mục riêng — không trộn với tác động đã đạt.
export function xayDungNguonGayQuy(cp: Campaign): {
  tieu_de: string;
  noi_dung: string;
  cac_muc: MucNguon[];
} {
  const muc: MucNguon[] = [];
  if (cp.muc_tieu) {
    muc.push({
      id: "gq-muc-tieu",
      loai: "fact",
      tieu_de: "Mục tiêu gây quỹ (tương lai — không phải tác động đã đạt)",
      noi_dung: cp.muc_tieu,
      assets: [],
    });
  }
  const soTien = hienThiSoTieuMucTieu(cp);
  if (soTien) {
    muc.push({
      id: "gq-so-tien",
      loai: "fact",
      tieu_de: "Số tiền mục tiêu",
      noi_dung: soTien,
      assets: [],
    });
  }
  if (cp.thong_diep_loi) {
    muc.push({
      id: "gq-thong-diep-loi",
      loai: "section",
      tieu_de: "Thông điệp lõi đã duyệt",
      noi_dung: cp.thong_diep_loi,
      assets: [],
    });
  }
  for (const t of cp.ds_tac_dong) {
    const nhanTt = t.trang_thai === "uoc_tinh" ? "ƯỚC TÍNH" : "ĐÃ ĐẠT";
    const soLieu = t.so_lieu ? ` (${t.so_lieu}${t.don_vi ? ` ${t.don_vi}` : ""})` : "";
    muc.push({
      id: `gq-td-${t.id}`,
      loai: "fact",
      tieu_de: `Tác động [${nhanTt}]: ${t.tieu_de}${soLieu}`,
      noi_dung: t.nguon_id
        ? t.noi_dung
        : `${t.noi_dung} (CHƯA XÁC NHẬN — cần bằng chứng nguồn)`,
      assets: [],
    });
  }
  for (const t of cp.ds_trich_dan) {
    muc.push({
      id: `gq-tq-${t.id}`,
      loai: "fact",
      tieu_de: `Trích dẫn được phép dùng: ${t.ten_nguoi}`,
      noi_dung: `"${t.loi}"${t.nguon_id ? "" : " (CHƯA XÁC NHẬN — cần bằng chứng nguồn)"}`,
      assets: [],
    });
  }
  for (const c of cp.cta) {
    muc.push({
      id: `gq-cta-${c.id}`,
      loai: "fact",
      tieu_de: `CTA${c.loai === "quyen_gop" ? " quyên góp" : ""}: ${c.nhan}`,
      noi_dung: c.url,
      assets: [],
    });
  }
  if (cp.ngon_ngu_phu) {
    muc.push({
      id: "gq-ngon-ngu-phu",
      loai: "fact",
      tieu_de: "Ngôn ngữ thứ hai",
      noi_dung: cp.ngon_ngu_phu,
      assets: [],
    });
  }
  const dong = [
    `Chiến dịch gây quỹ ${cp.ten}.`,
    cp.muc_tieu ? `Mục tiêu (tương lai): ${cp.muc_tieu}` : "",
    soTien ? `Số tiền mục tiêu: ${soTien}` : "",
    cp.thong_diep_loi ? `Thông điệp lõi: ${cp.thong_diep_loi}` : "",
    ...cp.ds_tac_dong.map(
      (t) =>
        `Tác động [${t.trang_thai === "uoc_tinh" ? "ước tính" : "đã đạt"}] ${t.tieu_de}${t.so_lieu ? ` — ${t.so_lieu}${t.don_vi ? ` ${t.don_vi}` : ""}` : ""}: ${t.noi_dung}${t.nguon_id ? "" : " [chưa xác nhận]"}`,
    ),
    ...cp.ds_trich_dan.map(
      (t) => `Trích dẫn ${t.ten_nguoi}: "${t.loi}"${t.nguon_id ? "" : " [chưa xác nhận]"}`,
    ),
    ...cp.cta.map((c) => `CTA ${c.nhan}: ${c.url}`),
    cp.ngon_ngu_phu ? `Ngôn ngữ thứ hai: ${cp.ngon_ngu_phu}` : "",
  ].filter(Boolean);
  return {
    tieu_de: `Gây quỹ ${cp.ten} — fact`,
    noi_dung: dong.join("\n"),
    cac_muc: muc,
  };
}

// Tạo/cập nhật nguồn gây quỹ tự động. Nội dung + cac_muc giống head
// hiện tại → bỏ qua (PUT không đổi field gây quỹ không sinh revision
// rác). da_doi=true nghĩa là revision nguồn mới — caller chạy #14.
export function dongBoNguonGayQuy(
  db: Database,
  cp: Campaign,
  tacGia: string,
): { nguon: Nguon; da_doi: boolean } {
  const xd = xayDungNguonGayQuy(cp);
  const taoMoi = (): { nguon: Nguon; da_doi: boolean } => {
    const nguon = taoNguon(
      db,
      { tieu_de: xd.tieu_de, noi_dung: xd.noi_dung, loai: "fact", cac_muc: xd.cac_muc },
      tacGia,
    );
    db.query("UPDATE campaign SET nguon_gay_quy_id = ? WHERE id = ?").run(nguon.id, cp.id);
    ghiSuKien(db, "campaign", cp.id, "tao_nguon_gay_quy", { nguon_id: nguon.id }, tacGia);
    return { nguon, da_doi: true };
  };
  if (!cp.nguon_gay_quy_id) return taoMoi();
  const nguon = layNguon(db, cp.nguon_gay_quy_id);
  if (!nguon) return taoMoi(); // nguồn tự động bị xóa tay → chiếu lại
  const head = nguon.head_revision_id ? layNguonRevision(db, nguon.head_revision_id) : null;
  if (
    head &&
    head.noi_dung === xd.noi_dung &&
    JSON.stringify(head.cac_muc) === JSON.stringify(xd.cac_muc)
  ) {
    return { nguon, da_doi: false };
  }
  const moi = capNhatNguon(
    db,
    nguon.id,
    { tieu_de: xd.tieu_de, noi_dung: xd.noi_dung, loai: "fact", cac_muc: xd.cac_muc },
    nguon.head_revision_id,
    tacGia,
  );
  ghiSuKien(
    db,
    "campaign",
    cp.id,
    "dong_bo_nguon_gay_quy",
    { nguon_id: moi.id, head_revision_id: moi.head_revision_id },
    tacGia,
  );
  return { nguon: moi, da_doi: true };
}

// --- Thông điệp chủ đề của chiến dịch gây quỹ ---

function dsNguonIdsCuaThongDiep(db: Database, thongDiepId: string): string[] {
  return (
    db
      .query("SELECT nguon_id FROM thong_diep_nguon WHERE thong_diep_id = ?")
      .all(thongDiepId) as { nguon_id: string }[]
  ).map((r) => r.nguon_id);
}

// Danh sách nguồn chủ đề phải link: nguồn gây quỹ tự động + nguồn đã
// gán cho các tài liệu tham chiếu (ghi chú hiện trường, bảng số liệu…) +
// nguồn bằng chứng của từng tác động/trích dẫn — con trỏ hợp lệ phải nằm
// trong provenance thông điệp để bộ sinh coi là đã xác nhận, khớp cờ
// co_bang_chung mà UI hiển thị.
function dsNguonBatBuoc(db: Database, cp: Campaign): string[] {
  const ds: string[] = [];
  const them = (id: string | null | undefined) => {
    if (id && !ds.includes(id) && layNguon(db, id)) ds.push(id);
  };
  them(cp.nguon_gay_quy_id);
  for (const t of cp.tham_chieu) them(t.nguon_id);
  for (const t of cp.ds_tac_dong) them(t.nguon_id);
  for (const t of cp.ds_trich_dan) them(t.nguon_id);
  return ds;
}

// Lấy hoặc tạo thông điệp chủ đề của chiến dịch. Khi đã có: union link
// nguồn mới + refresh revision thông điệp khi pin nguồn cũ — nguồn gây
// quỹ vừa đổi revision thì head thông điệp phải ghim bản mới để đầu ra
// sinh sau đó đọc fact mới (đầu ra cũ vẫn pin bản cũ → #14 đánh dấu).
export function damBaoThongDiepGayQuy(db: Database, cp: Campaign, tacGia: string): ThongDiep {
  return txn(db, () => {
    const moi = layCampaign(db, cp.id)!; // đọc lại sau khi gán nguon_gay_quy_id
    const batBuoc = dsNguonBatBuoc(db, moi);
    const cu = thongDiepChuDe(db, moi);
    const tieuDe = `Gây quỹ ${moi.ten}`;
    if (!cu) {
      const td = taoThongDiep(
        db,
        {
          tieu_de: tieuDe,
          noi_dung:
            moi.mo_ta ||
            `Chiến dịch gây quỹ ${moi.ten}.${moi.muc_tieu ? `\nMục tiêu: ${moi.muc_tieu}` : ""}${moi.thong_diep_loi ? `\nThông điệp lõi: ${moi.thong_diep_loi}` : ""}`,
          campaign_id: moi.id,
          nguon_ids: batBuoc,
        },
        tacGia,
      );
      ghiSuKien(db, "campaign", moi.id, "tao_thong_diep_chu_de", { thong_diep_id: td.id }, tacGia);
      return td;
    }
    const linkHienCo = dsNguonIdsCuaThongDiep(db, cu.id);
    const union = [...linkHienCo];
    for (const id of batBuoc) {
      if (!union.includes(id)) union.push(id);
    }
    const pinned = cu.head_revision_id
      ? (layThongDiepRevision(db, cu.head_revision_id)?.nguon_revision_ids ?? [])
      : [];
    const heads = union
      .map((id) => layNguon(db, id)?.head_revision_id)
      .filter((x): x is string => !!x);
    const pinMoi = pinned.length === heads.length && pinned.every((p) => heads.includes(p));
    const linkMoi = union.length !== linkHienCo.length;
    if (!linkMoi && pinMoi) return cu;
    return capNhatThongDiep(
      db,
      cu.id,
      { tieu_de: cu.tieu_de, noi_dung: cu.noi_dung, campaign_id: moi.id, nguon_ids: union },
      cu.head_revision_id ?? "",
      tacGia,
    );
  });
}

// --- Đề xuất đầu ra theo đối tượng ---

// Tìm hồ sơ đối tượng theo từ khóa: khớp `ten` trước (định danh rõ nhất),
// rồi mới các field mô tả — tránh gắn nhầm hồ sơ khớp keyword ở field
// phụ. Không có hồ sơ → null (đầu ra vẫn tạo được, context chỉ thiếu
// hồ sơ đối tượng).
function timDoiTuong(db: Database, re: RegExp): HoSoDoiTuong | null {
  const ds = danhSachDoiTuong(db);
  return (
    ds.find((d) => re.test(d.ten)) ??
    ds.find((d) =>
      re.test(`${d.moi_quan_tam} ${d.kien_thuc_nen} ${d.nhu_cau_giao_tiep} ${d.nhan_khau_hoc}`),
    ) ??
    null
  );
}

const RE_TAI_TRO = /tài\s*trợ|nhà\s*gây\s*quỹ|donor|donor\s*định\s*kỳ/i;
const RE_TAI_TRO_LON = /tài\s*trợ\s*lớn|major\s*donor|nhà\s*tài\s*trợ\s*chính/i;
const RE_TINH_NGUYEN = /tình\s*nguyện|volunteer/i;

// 7 đầu ra của story #10 — id cố định để chọn/lọc lặp lại được; biên tập
// sửa xóa thêm tự do qua muc_luc trước khi nháp. Bản ngôn ngữ thứ hai
// chỉ xuất hiện khi campaign chọn ngon_ngu_phu.
export function deXuatDauRaGayQuy(db: Database, cp: Campaign): MucLuc[] {
  const dtTaiTro = timDoiTuong(db, RE_TAI_TRO);
  const dtTaiTroLon = timDoiTuong(db, RE_TAI_TRO_LON) ?? dtTaiTro;
  const dtTnv = timDoiTuong(db, RE_TINH_NGUYEN);
  const dtChinh = cp.doi_tuong_id;
  const ds: MucLuc[] = [
    {
      id: "gq-bao-cao",
      tieu_de: "Báo cáo tác động cho nhà tài trợ",
      dinh_dang: "bao-cao-tac-dong",
      doi_tuong_id: dtTaiTro?.id ?? dtChinh,
      dich_den: "email",
      ly_do: "Báo cáo cho nhà tài trợ đang góp: tác động đã đạt tách khỏi ước tính, mục tiêu gây quỹ tương lai nêu riêng.",
    },
    {
      id: "gq-cau-chuyen",
      tieu_de: "Câu chuyện nhân văn công khai",
      dinh_dang: "cau-chuyen-nhan-van",
      doi_tuong_id: dtChinh,
      dich_den: "website",
      ly_do: "Câu chuyện công khai chỉ dùng tư liệu đã cung cấp — khoảng trống hiển thị là câu hỏi biên tập.",
    },
    {
      id: "gq-instagram",
      tieu_de: "Caption ảnh Instagram",
      dinh_dang: "caption",
      doi_tuong_id: null,
      dich_den: "instagram",
      ly_do: "Caption ảnh hiện trường cho Instagram — dùng ảnh/ghi chú đã có quyền.",
    },
    {
      id: "gq-email-ntt",
      tieu_de: "Email nhà tài trợ lớn",
      dinh_dang: "email-tai-tro",
      doi_tuong_id: dtTaiTroLon?.id ?? null,
      dich_den: "email",
      ly_do: "Email cho nhà tài trợ lớn: chi tiết hơn câu chuyện công khai nhưng không đổi fact tác động.",
    },
    {
      id: "gq-trang-web",
      tieu_de: "Trang campaign website",
      dinh_dang: "trang-campaign",
      doi_tuong_id: dtChinh,
      dich_den: "website",
      ly_do: "Trang campaign trên website sở hữu — chứa mục tiêu, tác động và CTA quyên góp cuối.",
    },
    {
      id: "gq-tnv",
      tieu_de: "Cập nhật tình nguyện viên",
      dinh_dang: "cap-nhat-tinh-nguyen",
      doi_tuong_id: dtTnv?.id ?? null,
      dich_den: "",
      ly_do: "Cập nhật nội bộ cho tình nguyện viên: tiến độ làng tiếp theo, việc cần làm.",
    },
  ];
  if (cp.ngon_ngu_phu) {
    ds.push({
      id: "gq-ngon-ngu-2",
      tieu_de: `Bản ${cp.ngon_ngu_phu} — câu chuyện nhân văn`,
      dinh_dang: "cau-chuyen-nhan-van",
      doi_tuong_id: dtChinh,
      dich_den: "website",
      ngon_ngu: cp.ngon_ngu_phu,
      ly_do: `Bản dịch ${cp.ngon_ngu_phu} của câu chuyện công khai — giữ nguyên số liệu, tiền tệ và CTA.`,
    });
  }
  return ds;
}

// --- View phái sinh cho API/UI ---

export type TacDongView = TacDongGayQuy & {
  co_bang_chung: boolean;
  nguon: { id: string; tieu_de: string } | null;
  muc: { id: string; tieu_de: string } | null;
};

export type TrichDanView = TrichDanGayQuy & {
  co_bang_chung: boolean;
  nguon: { id: string; tieu_de: string } | null;
  muc: { id: string; tieu_de: string } | null;
};

export type GhiChuQuyenView = GhiChuQuyen & {
  asset: { id: string; ten_file: string; mime: string } | null;
};

function docViewBangChung(
  db: Database,
  nguonId: string | null,
  mucId: string | null,
): { co_bang_chung: boolean; nguon: { id: string; tieu_de: string } | null; muc: { id: string; tieu_de: string } | null } {
  const n = nguonId ? layNguon(db, nguonId) : null;
  const muc = n && mucId ? (n.cac_muc.find((m) => m.id === mucId) ?? null) : null;
  return {
    co_bang_chung: !!n && (!mucId || !!muc),
    nguon: n ? { id: n.id, tieu_de: n.tieu_de } : null,
    muc: muc ? { id: muc.id, tieu_de: muc.tieu_de ?? muc.id } : null,
  };
}

// ds_tac_dong/ds_trich_dan kèm trạng thái bằng chứng: nguồn còn tồn tại
// và mục chỉ định còn trong cac_muc. Thiếu bằng chứng = chưa xác nhận.
export function docTacDongView(db: Database, cp: Campaign): TacDongView[] {
  return cp.ds_tac_dong.map((t) => ({
    ...t,
    ...docViewBangChung(db, t.nguon_id, t.muc_id),
  }));
}

export function docTrichDanView(db: Database, cp: Campaign): TrichDanView[] {
  return cp.ds_trich_dan.map((t) => ({
    ...t,
    ...docViewBangChung(db, t.nguon_id, t.muc_id),
  }));
}

// Ghi chú quyền kèm tên file asset để UI review hiển thị mà không phải
// resolve thêm.
export function docGhiChuQuyenView(db: Database, cp: Campaign): GhiChuQuyenView[] {
  return cp.ghi_chu_quyen.map((q) => {
    const a = layAsset(db, q.asset_id);
    return {
      ...q,
      asset: a ? { id: a.id, ten_file: a.ten_file, mime: a.mime } : null,
    };
  });
}

// Ghi chú quyền áp cho một tập asset (vd asset đính kèm bản thể hiện) —
// dùng khi review đầu ra: hiện phạm vi được phép dùng của từng ảnh.
export function ghiChuQuyenChoAssets(
  db: Database,
  cp: Campaign | null | undefined,
  assetIds: string[],
): GhiChuQuyenView[] {
  if (!cp || !laGayQuy(cp) || assetIds.length === 0) return [];
  const tap = new Set(assetIds);
  return docGhiChuQuyenView(db, cp).filter((q) => tap.has(q.asset_id));
}

export type GoiYGayQuy = {
  id: string;
  loai:
    | "tac_dong_chua_xac_nhan"
    | "trich_dan_chua_nguon"
    | "thieu_tai_lieu"
    | "thieu_dau_ra"
    | "thieu_cta_quyen_gop"
    | "thieu_so_tien"
    | "thieu_ghi_chu_quyen";
  tieu_de: string;
  ly_do: string;
  bang_chung: string[];
  de_xuat_muc?: MucLuc;
};

// Gợi ý khoảng trống của chiến dịch gây quỹ — tính lại mỗi lần đọc:
// - tác động chưa có bằng chứng nguồn (đầu ra sẽ phải để [CÂU HỎI]);
// - trích dẫn chưa trỏ nguồn tư liệu (nguy cơ bịa/đối chiếu không được);
// - tham chiếu khai báo nhưng chưa nạp tài liệu;
// - đầu ra đề xuất còn thiếu trong mục lục đã lưu;
// - chưa có CTA loai 'quyen_gop' (đích quyên góp ngoài được cung cấp);
// - có mục tiêu nhưng thiếu số tiền/tiền tệ;
// - chưa ghi chú quyền/đồng ý cho asset tổ chức cung cấp.
export function goiYGayQuy(db: Database, cp: Campaign): GoiYGayQuy[] {
  const ds: GoiYGayQuy[] = [];
  for (const t of docTacDongView(db, cp)) {
    if (t.co_bang_chung) continue;
    ds.push({
      id: `goi-y-td-${t.id}`,
      loai: "tac_dong_chua_xac_nhan",
      tieu_de: `Tác động '${t.tieu_de}' chưa có bằng chứng nguồn`,
      ly_do: `Tác động '${t.tieu_de}' (${t.trang_thai === "uoc_tinh" ? "ước tính" : "đã đạt"}) chưa trỏ nguồn/mục nào đã nạp — đầu ra nhắc nó sẽ phải để [CÂU HỎI] thay vì trình bày như sự thật. Gán nguon_id + muc_id sau khi nạp tài liệu.`,
      bang_chung: [`tieu_de: ${t.tieu_de}`, `trang_thai: ${t.trang_thai || "—"}`],
    });
  }
  for (const t of docTrichDanView(db, cp)) {
    if (t.co_bang_chung) continue;
    ds.push({
      id: `goi-y-tq-${t.id}`,
      loai: "trich_dan_chua_nguon",
      tieu_de: `Trích dẫn '${t.ten_nguoi}' chưa trỏ nguồn tư liệu`,
      ly_do: `Lời '${t.ten_nguoi}' chưa có nguồn đã nạp — không đối chiếu được và có nguy cơ bịa trích dẫn. Gán nguon_id + muc_id của ghi chú hiện trường.`,
      bang_chung: [`ten_nguoi: ${t.ten_nguoi}`, `loi: ${t.loi || "—"}`],
    });
  }
  for (const t of cp.tham_chieu) {
    if (t.nguon_id && layNguon(db, t.nguon_id)) continue;
    ds.push({
      id: `goi-y-tl-${t.id}`,
      loai: "thieu_tai_lieu",
      tieu_de: `Thiếu tài liệu cho '${t.tham_chieu}'`,
      ly_do: `Chiến dịch khai báo tài liệu '${t.tham_chieu}' nhưng chưa nạp văn bản — trích dẫn/số liệu trích từ đó không đối chiếu được. Nạp nguồn rồi liên kết.`,
      bang_chung: [`tham_chieu: ${t.tham_chieu}`, `ban_dich: ${t.ban_dich || "—"}`],
    });
  }
  const deXuat = deXuatDauRaGayQuy(db, cp);
  const daCo = new Set(cp.muc_luc.map(khoaMucLuc));
  const thieu = deXuat.filter((d) => !daCo.has(khoaMucLuc(d)));
  for (const d of thieu) {
    ds.push({
      id: `goi-y-dau-ra-${d.id}`,
      loai: "thieu_dau_ra",
      tieu_de: `Thiếu đầu ra '${d.tieu_de}'`,
      ly_do: d.ly_do || `Đầu ra đề xuất cho mục tiêu này chưa có trong mục lục — thêm để nháp.`,
      bang_chung: [
        `dinh_dang: ${d.dinh_dang}`,
        `dich_den: ${d.dich_den || "—"}`,
        `ngon_ngu: ${d.ngon_ngu || "vi"}`,
      ],
      de_xuat_muc: d,
    });
  }
  if (!cp.cta.some((c) => c.loai === "quyen_gop")) {
    ds.push({
      id: "goi-y-cta-quyen-gop",
      loai: "thieu_cta_quyen_gop",
      tieu_de: "Chưa khai báo link CTA quyên góp",
      ly_do: "Đầu ra gây quỹ cần CTA loai 'quyen_gop' trỏ đúng đích ngoài do tổ chức cung cấp — xem trước sẽ hiện link cuối trước khi duyệt.",
      bang_chung: [],
    });
  }
  if (cp.muc_tieu && (cp.so_tien_muc_tieu === null || !cp.tien_te)) {
    ds.push({
      id: "goi-y-so-tien",
      loai: "thieu_so_tien",
      tieu_de: "Mục tiêu thiếu số tiền hoặc tiền tệ",
      ly_do: "Mục tiêu gây quỹ đã có mô tả nhưng thiếu số tiền mục tiêu hoặc đơn vị tiền tệ — tổng tiền trên đầu ra phải luôn đi kèm tiền tệ.",
      bang_chung: [`muc_tieu: ${cp.muc_tieu}`],
    });
  }
  if (cp.ghi_chu_quyen.length === 0) {
    ds.push({
      id: "goi-y-quyen",
      loai: "thieu_ghi_chu_quyen",
      tieu_de: "Chưa ghi chú quyền/đồng ý cho asset",
      ly_do: "Chưa có ghi chú quyền/đồng ý nào cho asset tổ chức cung cấp — thêm để review đầu ra đính kèm ảnh thấy phạm vi được phép dùng.",
      bang_chung: [],
    });
  }
  return ds;
}
