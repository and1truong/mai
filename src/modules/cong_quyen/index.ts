import type { Database } from "bun:sqlite";
import {
  capNhatNguon,
  capNhatThongDiep,
  danhSachBanTheHien,
  danhSachNguonCuaThongDiep,
  danhSachXuatBan,
  ghiSuKien,
  layBanTheHien,
  layCampaign,
  layNguon,
  layNguonRevision,
  layRevision,
  layThongDiepRevision,
  taoNguon,
  taoThongDiep,
  type BanTheHien,
  type Campaign,
  type FactVanHanh,
  type MucLuc,
  type MucNguon,
  type NgoaiLeCongQuyen,
  type NguoiDuyetCongQuyen,
  type Nguon,
  type ThongDiep,
  type YeuCauCongQuyen,
} from "../content/index.ts";
import { danhSachDoiTuong, type HoSoDoiTuong } from "../context/index.ts";
import { khoaMucLuc, thongDiepChuDe } from "../so_bao/index.ts";
import { danhSachTaskSua } from "../thay_doi/index.ts";

// Module công quyền (#11): một cơ quan công quyền công bố chính sách
// mới (vd luật phân loại rác) và phải giải thích cho nhiều đối tượng
// khác nhau — hộ gia đình, doanh nghiệp, trường học, người nhập cư,
// nhà thầu. Campaign loai 'cong_quyen' nạp văn bản chính sách chính
// thức (nguon_chinh_sach_id) + fact ràng buộc trên field campaign:
// phiên bản (phien_ban), phạm vi quyền hạn, ngày hiệu lực, danh sách
// yêu cầu (bắt buộc vs giải thích), ngoại lệ, fact vận hành, reviewer
// local và chế độ bảo vệ (móc nối #16). Mọi đầu ra sinh dưới một thông
// điệp chủ đề — dùng lại luồng chọn/nháp/duyệt/xuất chung.
//
// Nguồn fact tự động chiếu field campaign thành nguon 'fact' (cac_muc
// id ổn định 'cq-*') link vào thông điệp chủ đề:
// - mọi đầu ra pin fact chính sách trong chuỗi provenance — claim yêu
//   cầu/ngày hiệu lực truy về đúng revision chính sách;
// - đổi field (vd ngay_hieu_luc) → revision nguồn mới → #14 đánh dấu
//   đầu ra phụ thuộc + tạo task sửa; đích liệt kê riêng nháp/đã xuất/
//   đã lên lịch/đã đăng trong docAnhHuongCongQuyen;
// - điều khoản nguồn mơ hồ/mâu thuẫn → câu hỏi review (goiY + context
//   sinh), không phải luật bịa.
//
// Cổng review thẩm quyền: duyệt công quyền ghi nguoi_duyet_id từ
// ds_nguoi_duyet của campaign; che_do_bao_ve=1 bắt buộc reviewer hợp
// lệ — lớp quyền tài khoản thật của #16 gắn vào đây.

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

export function laCongQuyen(cp: Campaign | null | undefined): boolean {
  return !!cp && cp.loai === "cong_quyen";
}

// --- Validation input công quyền ---

const RE_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;
// Ngày hiệu lực: ISO date "YYYY-MM-DD" + kiểm ngày thật.
const RE_NGAY = /^\d{4}-\d{2}-\d{2}$/;
export const LOAI_YEU_CAU = ["bat_buoc", "giai_thich"];
export const NHOM_DOI_TUONG_AP_DUNG = [
  "",
  "ho_gia_dinh",
  "doanh_nghiep",
  "truong_hoc",
  "nha_thau",
  "nguoi_nhap_cu",
];
const DAI_TOI_DA = {
  pham_vi: 500,
  yc_noi_dung: 1000,
  nl_noi_dung: 1000,
  fv_tieu_de: 200,
  fv_noi_dung: 500,
  nd_ten: 120,
  nd_vai_tro: 200,
};

export function docPhamViQuyenHan(v: unknown, dsLoi: string[]): string | undefined {
  if (v === undefined) return undefined;
  const s = typeof v === "string" ? v.trim() : "";
  if (s.length > DAI_TOI_DA.pham_vi) {
    dsLoi.push(`pham_vi_quyen_han vượt ${DAI_TOI_DA.pham_vi} ký tự.`);
    return undefined;
  }
  return s;
}

export function docNgayHieuLuc(v: unknown, dsLoi: string[]): string | undefined {
  if (v === undefined) return undefined;
  const s = typeof v === "string" ? v.trim() : "";
  if (s && !RE_NGAY.test(s)) {
    dsLoi.push("ngay_hieu_luc phải là ngày ISO 'YYYY-MM-DD' (vd '2027-01-01').");
    return undefined;
  }
  if (s) {
    const p = s.split("-").map(Number);
    const [y, m, d] = [p[0] ?? 0, p[1] ?? 0, p[2] ?? 0];
    const dt = new Date(Date.UTC(y, m - 1, d));
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
      dsLoi.push(`ngay_hieu_luc '${s}' không phải ngày thật.`);
      return undefined;
    }
  }
  return s;
}

// nguon_chinh_sach_id: con trỏ nguồn văn bản chính sách chính thức —
// đặt thì phải tồn tại trong kho nguồn.
export function docNguonChinhSachId(
  db: Database,
  v: unknown,
  dsLoi: string[],
): string | undefined {
  if (v === undefined) return undefined;
  const s = typeof v === "string" ? v.trim() : "";
  if (s && !layNguon(db, s)) {
    dsLoi.push(`nguon_chinh_sach_id '${s}' không tồn tại trong kho nguồn.`);
    return undefined;
  }
  return s;
}

export function docCheDoBaoVe(v: unknown, dsLoi: string[]): number | undefined {
  if (v === undefined) return undefined;
  const n = v === true ? 1 : v === false ? 0 : typeof v === "number" ? v : NaN;
  if (!Number.isFinite(n) || (n !== 0 && n !== 1)) {
    dsLoi.push("che_do_bao_ve chỉ nhận 0/1 (hoặc false/true).");
    return undefined;
  }
  return n;
}

// Con trỏ bằng chứng chung — giống module gây quỹ: nguon_id đặt thì
// phải tồn tại; muc_id đặt thì phải có trong cac_muc của nguồn đó.
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

// ds_yeu_cau: yêu cầu bắt buộc hoặc điểm giải thích + bằng chứng nguồn.
// loai 'bat_buoc' | 'giai_thich' là tiêu chí phân biệt nghĩa vụ với
// ngôn ngữ giải thích trong đầu ra.
export function kiemTraDsYeuCau(
  db: Database,
  v: unknown,
  dsLoi: string[],
): YeuCauCongQuyen[] | undefined {
  if (v === undefined) return undefined;
  if (!Array.isArray(v)) {
    dsLoi.push("ds_yeu_cau phải là một mảng.");
    return undefined;
  }
  const ds: YeuCauCongQuyen[] = [];
  const daCo = new Set<string>();
  for (const [i, dong] of v.entries()) {
    if (typeof dong !== "object" || dong === null || Array.isArray(dong)) {
      dsLoi.push(`ds_yeu_cau[${i}] phải là object.`);
      continue;
    }
    const t = dong as Record<string, unknown>;
    const id = typeof t.id === "string" && t.id ? t.id.trim() : `yc${i + 1}`;
    if (!RE_ID.test(id)) {
      dsLoi.push(`ds_yeu_cau[${i}].id '${id}' không hợp lệ (a-z0-9_-, tối đa 64).`);
    }
    if (daCo.has(id)) dsLoi.push(`ds_yeu_cau[${i}].id '${id}' trùng với dòng khác.`);
    daCo.add(id);
    const noiDung = typeof t.noi_dung === "string" ? t.noi_dung.trim() : "";
    if (!noiDung) dsLoi.push(`ds_yeu_cau[${i}].noi_dung là bắt buộc.`);
    if (noiDung.length > DAI_TOI_DA.yc_noi_dung) {
      dsLoi.push(`ds_yeu_cau[${i}].noi_dung vượt ${DAI_TOI_DA.yc_noi_dung} ký tự.`);
    }
    const loai = typeof t.loai === "string" ? t.loai.trim() : "";
    if (!LOAI_YEU_CAU.includes(loai)) {
      dsLoi.push(
        `ds_yeu_cau[${i}].loai '${loai}' không hợp lệ. Cho phép: ${LOAI_YEU_CAU.join(", ")}.`,
      );
    }
    const dtApDung =
      typeof t.doi_tuong_ap_dung === "string" ? t.doi_tuong_ap_dung.trim() : "";
    if (!NHOM_DOI_TUONG_AP_DUNG.includes(dtApDung)) {
      dsLoi.push(
        `ds_yeu_cau[${i}].doi_tuong_ap_dung '${dtApDung}' không hợp lệ. ` +
          `Cho phép: '' (chung), ${NHOM_DOI_TUONG_AP_DUNG.filter(Boolean).join(", ")}.`,
      );
    }
    const tro = docConTroNguon(db, `ds_yeu_cau[${i}]`, t.nguon_id, t.muc_id, dsLoi);
    ds.push({
      id,
      noi_dung: noiDung,
      loai,
      doi_tuong_ap_dung: dtApDung,
      nguon_id: tro.nguon_id,
      muc_id: tro.muc_id,
    });
  }
  return ds;
}

// ds_ngoai_le: ngoại lệ của chính sách. yeu_cau_id liên kết về yêu cầu
// nó sửa — phải trỏ một id trong ds_yeu_cau hiện có, hoặc rỗng (ngoại
// lệ chung).
export function kiemTraDsNgoaiLe(
  db: Database,
  v: unknown,
  dsLoi: string[],
  dsYeuCau: YeuCauCongQuyen[] = [],
): NgoaiLeCongQuyen[] | undefined {
  if (v === undefined) return undefined;
  if (!Array.isArray(v)) {
    dsLoi.push("ds_ngoai_le phải là một mảng.");
    return undefined;
  }
  const ds: NgoaiLeCongQuyen[] = [];
  const daCo = new Set<string>();
  const dsYcId = new Set(dsYeuCau.map((y) => y.id));
  for (const [i, dong] of v.entries()) {
    if (typeof dong !== "object" || dong === null || Array.isArray(dong)) {
      dsLoi.push(`ds_ngoai_le[${i}] phải là object.`);
      continue;
    }
    const t = dong as Record<string, unknown>;
    const id = typeof t.id === "string" && t.id ? t.id.trim() : `nl${i + 1}`;
    if (!RE_ID.test(id)) {
      dsLoi.push(`ds_ngoai_le[${i}].id '${id}' không hợp lệ (a-z0-9_-, tối đa 64).`);
    }
    if (daCo.has(id)) dsLoi.push(`ds_ngoai_le[${i}].id '${id}' trùng với dòng khác.`);
    daCo.add(id);
    const noiDung = typeof t.noi_dung === "string" ? t.noi_dung.trim() : "";
    if (!noiDung) dsLoi.push(`ds_ngoai_le[${i}].noi_dung là bắt buộc.`);
    if (noiDung.length > DAI_TOI_DA.nl_noi_dung) {
      dsLoi.push(`ds_ngoai_le[${i}].noi_dung vượt ${DAI_TOI_DA.nl_noi_dung} ký tự.`);
    }
    const yeuCauId = typeof t.yeu_cau_id === "string" ? t.yeu_cau_id.trim() : "";
    if (yeuCauId && !dsYcId.has(yeuCauId)) {
      dsLoi.push(
        `ds_ngoai_le[${i}].yeu_cau_id '${yeuCauId}' không trỏ yêu cầu nào trong ds_yeu_cau.`,
      );
    }
    const tro = docConTroNguon(db, `ds_ngoai_le[${i}]`, t.nguon_id, t.muc_id, dsLoi);
    ds.push({
      id,
      noi_dung: noiDung,
      yeu_cau_id: yeuCauId,
      nguon_id: tro.nguon_id,
      muc_id: tro.muc_id,
    });
  }
  return ds;
}

// ds_fact_van_hanh: fact vận hành hỗ trợ chính sách (lịch thu gom, điểm
// thu, hotline) — fact đã duyệt là ràng buộc, giống ds_fact phát hành.
export function kiemTraDsFactVanHanh(
  db: Database,
  v: unknown,
  dsLoi: string[],
): FactVanHanh[] | undefined {
  if (v === undefined) return undefined;
  if (!Array.isArray(v)) {
    dsLoi.push("ds_fact_van_hanh phải là một mảng.");
    return undefined;
  }
  const ds: FactVanHanh[] = [];
  const daCo = new Set<string>();
  for (const [i, dong] of v.entries()) {
    if (typeof dong !== "object" || dong === null || Array.isArray(dong)) {
      dsLoi.push(`ds_fact_van_hanh[${i}] phải là object.`);
      continue;
    }
    const t = dong as Record<string, unknown>;
    const id = typeof t.id === "string" && t.id ? t.id.trim() : `fv${i + 1}`;
    if (!RE_ID.test(id)) {
      dsLoi.push(`ds_fact_van_hanh[${i}].id '${id}' không hợp lệ (a-z0-9_-, tối đa 64).`);
    }
    if (daCo.has(id)) dsLoi.push(`ds_fact_van_hanh[${i}].id '${id}' trùng với dòng khác.`);
    daCo.add(id);
    const tieuDe = typeof t.tieu_de === "string" ? t.tieu_de.trim() : "";
    const noiDung = typeof t.noi_dung === "string" ? t.noi_dung.trim() : "";
    if (!tieuDe) dsLoi.push(`ds_fact_van_hanh[${i}].tieu_de là bắt buộc.`);
    if (tieuDe.length > DAI_TOI_DA.fv_tieu_de) {
      dsLoi.push(`ds_fact_van_hanh[${i}].tieu_de vượt ${DAI_TOI_DA.fv_tieu_de} ký tự.`);
    }
    if (!noiDung) dsLoi.push(`ds_fact_van_hanh[${i}].noi_dung là bắt buộc.`);
    if (noiDung.length > DAI_TOI_DA.fv_noi_dung) {
      dsLoi.push(`ds_fact_van_hanh[${i}].noi_dung vượt ${DAI_TOI_DA.fv_noi_dung} ký tự.`);
    }
    const tro = docConTroNguon(db, `ds_fact_van_hanh[${i}]`, t.nguon_id, t.muc_id, dsLoi);
    ds.push({
      id,
      tieu_de: tieuDe,
      noi_dung: noiDung,
      nguon_id: tro.nguon_id,
      muc_id: tro.muc_id,
    });
  }
  return ds;
}

// ds_nguoi_duyet: reviewer local được ghi trong POC — duyệt công quyền
// ghi một id trong danh sách này vào record duyệt.
export function kiemTraDsNguoiDuyet(
  v: unknown,
  dsLoi: string[],
): NguoiDuyetCongQuyen[] | undefined {
  if (v === undefined) return undefined;
  if (!Array.isArray(v)) {
    dsLoi.push("ds_nguoi_duyet phải là một mảng.");
    return undefined;
  }
  const ds: NguoiDuyetCongQuyen[] = [];
  const daCo = new Set<string>();
  for (const [i, dong] of v.entries()) {
    if (typeof dong !== "object" || dong === null || Array.isArray(dong)) {
      dsLoi.push(`ds_nguoi_duyet[${i}] phải là object.`);
      continue;
    }
    const t = dong as Record<string, unknown>;
    const id = typeof t.id === "string" && t.id ? t.id.trim() : `nd${i + 1}`;
    if (!RE_ID.test(id)) {
      dsLoi.push(`ds_nguoi_duyet[${i}].id '${id}' không hợp lệ (a-z0-9_-, tối đa 64).`);
    }
    if (daCo.has(id)) dsLoi.push(`ds_nguoi_duyet[${i}].id '${id}' trùng với dòng khác.`);
    daCo.add(id);
    const ten = typeof t.ten === "string" ? t.ten.trim() : "";
    const vaiTro = typeof t.vai_tro === "string" ? t.vai_tro.trim() : "";
    if (!ten) dsLoi.push(`ds_nguoi_duyet[${i}].ten là bắt buộc.`);
    if (ten.length > DAI_TOI_DA.nd_ten) {
      dsLoi.push(`ds_nguoi_duyet[${i}].ten vượt ${DAI_TOI_DA.nd_ten} ký tự.`);
    }
    if (vaiTro.length > DAI_TOI_DA.nd_vai_tro) {
      dsLoi.push(`ds_nguoi_duyet[${i}].vai_tro vượt ${DAI_TOI_DA.nd_vai_tro} ký tự.`);
    }
    ds.push({ id, ten, vai_tro: vaiTro });
  }
  return ds;
}

// --- Nguồn fact tự động ---

// Chiếu field công quyền → một nguon 'fact' xác định (deterministic):
// mỗi field là một mục có id ổn định 'cq-*' để diff revision chỉ đúng
// mục đổi. Yêu cầu giữ nhãn [BẮT BUỘC]/[GIẢI THÍCH] trong tiêu đề mục.
export function xayDungNguonCongQuyen(cp: Campaign): {
  tieu_de: string;
  noi_dung: string;
  cac_muc: MucNguon[];
} {
  const chuaXacNhan = (daCoConTro: boolean) =>
    daCoConTro ? "" : " (CHƯA XÁC NHẬN — cần bằng chứng nguồn)";
  const muc: MucNguon[] = [];
  if (cp.phien_ban) {
    muc.push({
      id: "cq-phien-ban",
      loai: "fact",
      tieu_de: "Phiên bản chính sách",
      noi_dung: cp.phien_ban,
      assets: [],
    });
  }
  if (cp.pham_vi_quyen_han) {
    muc.push({
      id: "cq-pham-vi",
      loai: "fact",
      tieu_de: "Phạm vi quyền hạn",
      noi_dung: cp.pham_vi_quyen_han,
      assets: [],
    });
  }
  if (cp.ngay_hieu_luc) {
    muc.push({
      id: "cq-ngay-hieu-luc",
      loai: "fact",
      tieu_de: "Ngày hiệu lực",
      noi_dung: cp.ngay_hieu_luc,
      assets: [],
    });
  }
  for (const yc of cp.ds_yeu_cau) {
    const nhanLoai = yc.loai === "bat_buoc" ? "BẮT BUỘC" : "GIẢI THÍCH";
    const dt = yc.doi_tuong_ap_dung ? ` — ${yc.doi_tuong_ap_dung}` : "";
    muc.push({
      id: `cq-yc-${yc.id}`,
      loai: "fact",
      tieu_de: `Yêu cầu [${nhanLoai}]${dt}: ${yc.noi_dung.slice(0, 60)}`,
      noi_dung: `${yc.noi_dung}${chuaXacNhan(!!yc.nguon_id)}`,
      assets: [],
    });
  }
  for (const nl of cp.ds_ngoai_le) {
    muc.push({
      id: `cq-nl-${nl.id}`,
      loai: "fact",
      tieu_de: `Ngoại lệ${nl.yeu_cau_id ? ` (sửa yêu cầu ${nl.yeu_cau_id})` : " (chung)"}: ${nl.noi_dung.slice(0, 60)}`,
      noi_dung: `${nl.noi_dung}${chuaXacNhan(!!nl.nguon_id)}`,
      assets: [],
    });
  }
  for (const fv of cp.ds_fact_van_hanh) {
    muc.push({
      id: `cq-fv-${fv.id}`,
      loai: "fact",
      tieu_de: `Fact vận hành: ${fv.tieu_de}`,
      noi_dung: `${fv.noi_dung}${chuaXacNhan(!!fv.nguon_id)}`,
      assets: [],
    });
  }
  for (const c of cp.cta) {
    muc.push({
      id: `cq-cta-${c.id}`,
      loai: "fact",
      tieu_de: `CTA: ${c.nhan}`,
      noi_dung: c.url,
      assets: [],
    });
  }
  if (cp.ngon_ngu_phu) {
    muc.push({
      id: "cq-ngon-ngu-phu",
      loai: "fact",
      tieu_de: "Ngôn ngữ thứ hai",
      noi_dung: cp.ngon_ngu_phu,
      assets: [],
    });
  }
  const dong = [
    `Chính sách ${cp.ten}.`,
    cp.phien_ban ? `Phiên bản: ${cp.phien_ban}` : "",
    cp.pham_vi_quyen_han ? `Phạm vi quyền hạn: ${cp.pham_vi_quyen_han}` : "",
    cp.ngay_hieu_luc ? `Ngày hiệu lực: ${cp.ngay_hieu_luc}` : "",
    ...cp.ds_yeu_cau.map(
      (yc) =>
        `Yêu cầu [${yc.loai === "bat_buoc" ? "bắt buộc" : "giải thích"}]${yc.doi_tuong_ap_dung ? ` (${yc.doi_tuong_ap_dung})` : ""}: ${yc.noi_dung}${yc.nguon_id ? "" : " [chưa xác nhận]"}`,
    ),
    ...cp.ds_ngoai_le.map(
      (nl) =>
        `Ngoại lệ${nl.yeu_cau_id ? ` (yêu cầu ${nl.yeu_cau_id})` : ""}: ${nl.noi_dung}${nl.nguon_id ? "" : " [chưa xác nhận]"}`,
    ),
    ...cp.ds_fact_van_hanh.map(
      (fv) =>
        `Fact ${fv.tieu_de}: ${fv.noi_dung}${fv.nguon_id ? "" : " [chưa xác nhận]"}`,
    ),
    ...cp.cta.map((c) => `CTA ${c.nhan}: ${c.url}`),
    cp.ngon_ngu_phu ? `Ngôn ngữ thứ hai: ${cp.ngon_ngu_phu}` : "",
  ].filter(Boolean);
  return {
    tieu_de: `Công quyền ${cp.ten} — fact`,
    noi_dung: dong.join("\n"),
    cac_muc: muc,
  };
}

// Tạo/cập nhật nguồn công quyền tự động — giống dongBoNguonGayQuy: nội
// dung giống head → bỏ qua, khác → revision mới cho caller chạy #14.
export function dongBoNguonCongQuyen(
  db: Database,
  cp: Campaign,
  tacGia: string,
): { nguon: Nguon; da_doi: boolean } {
  const xd = xayDungNguonCongQuyen(cp);
  const taoMoi = (): { nguon: Nguon; da_doi: boolean } => {
    const nguon = taoNguon(
      db,
      { tieu_de: xd.tieu_de, noi_dung: xd.noi_dung, loai: "fact", cac_muc: xd.cac_muc },
      tacGia,
    );
    db.query("UPDATE campaign SET nguon_cong_quyen_id = ? WHERE id = ?").run(nguon.id, cp.id);
    ghiSuKien(db, "campaign", cp.id, "tao_nguon_cong_quyen", { nguon_id: nguon.id }, tacGia);
    return { nguon, da_doi: true };
  };
  if (!cp.nguon_cong_quyen_id) return taoMoi();
  const nguon = layNguon(db, cp.nguon_cong_quyen_id);
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
    "dong_bo_nguon_cong_quyen",
    { nguon_id: moi.id, head_revision_id: moi.head_revision_id },
    tacGia,
  );
  return { nguon: moi, da_doi: true };
}

// --- Thông điệp chủ đề của chiến dịch công quyền ---

function dsNguonIdsCuaThongDiep(db: Database, thongDiepId: string): string[] {
  return (
    db
      .query("SELECT nguon_id FROM thong_diep_nguon WHERE thong_diep_id = ?")
      .all(thongDiepId) as { nguon_id: string }[]
  ).map((r) => r.nguon_id);
}

// Nguồn chủ đề phải link: nguồn fact tự động + văn bản chính sách chính
// thức + tham chiếu đã gán + nguồn bằng chứng của từng yêu cầu/ngoại
// lệ/fact — con trỏ hợp lệ phải nằm trong provenance thông điệp để bộ
// sinh coi là đã xác nhận.
function dsNguonBatBuoc(db: Database, cp: Campaign): string[] {
  const ds: string[] = [];
  const them = (id: string | null | undefined) => {
    if (id && !ds.includes(id) && layNguon(db, id)) ds.push(id);
  };
  them(cp.nguon_cong_quyen_id);
  them(cp.nguon_chinh_sach_id);
  for (const t of cp.tham_chieu) them(t.nguon_id);
  for (const t of cp.ds_yeu_cau) them(t.nguon_id);
  for (const t of cp.ds_ngoai_le) them(t.nguon_id);
  for (const t of cp.ds_fact_van_hanh) them(t.nguon_id);
  return ds;
}

// Lấy hoặc tạo thông điệp chủ đề của chiến dịch công quyền — giống
// damBaoThongDiepGayQuy: union link nguồn mới + refresh revision ghim
// head mới của nguồn.
export function damBaoThongDiepCongQuyen(
  db: Database,
  cp: Campaign,
  tacGia: string,
): ThongDiep {
  return txn(db, () => {
    const moi = layCampaign(db, cp.id)!; // đọc lại sau khi gán nguon_cong_quyen_id
    const batBuoc = dsNguonBatBuoc(db, moi);
    const cu = thongDiepChuDe(db, moi);
    const tieuDe = `Chính sách ${moi.ten}`;
    if (!cu) {
      const td = taoThongDiep(
        db,
        {
          tieu_de: tieuDe,
          noi_dung:
            moi.mo_ta ||
            `Chính sách ${moi.ten}.${moi.phien_ban ? `\nPhiên bản: ${moi.phien_ban}` : ""}${moi.ngay_hieu_luc ? `\nNgày hiệu lực: ${moi.ngay_hieu_luc}` : ""}`,
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

// --- Đề xuất đầu ra theo nhóm đối tượng ---

// Tìm hồ sơ đối tượng theo từ khóa — giống timDoiTuong của gây quỹ:
// khớp ten trước rồi các field mô tả.
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

const RE_HO_GIA_DINH = /hộ\s*gia\s*đình|gia\s*đình|hộ\s*dân|cư\s*dân|household/i;
const RE_DOANH_NGHIEP = /doanh\s*nghiệp|cơ\s*sở|công\s*ty|business/i;
const RE_TRUONG_HOC = /trường\s*học|học\s*sinh|giáo\s*dục|school/i;
const RE_NHA_THAU = /nhà\s*thầu|thầu\s*phụ|contractor|thu\s*gom/i;
const RE_NGUOI_NHAP_CU = /nhập\s*cư|nước\s*ngoài|ngoại\s*quốc|immigrant|migrant/i;

// 5 đầu ra của story #11 — id cố định để chọn/lọc lặp lại được; biên
// tập sửa/xóa/thêm tự do qua muc_luc trước khi nháp. Bản dịch ngôn ngữ
// giản dị chỉ xuất hiện khi campaign chọn ngon_ngu_phu.
export function deXuatDauRaCongQuyen(db: Database, cp: Campaign): MucLuc[] {
  const dtHoGiaDinh = timDoiTuong(db, RE_HO_GIA_DINH);
  const dtDoanhNghiep = timDoiTuong(db, RE_DOANH_NGHIEP);
  const dtTruongHoc = timDoiTuong(db, RE_TRUONG_HOC);
  const dtNhaThau = timDoiTuong(db, RE_NHA_THAU);
  const dtNhapCu = timDoiTuong(db, RE_NGUOI_NHAP_CU);
  const ds: MucLuc[] = [
    {
      id: "cq-faq-ho-gia-dinh",
      tieu_de: "FAQ hộ gia đình",
      dinh_dang: "faq-cong-dan",
      doi_tuong_id: dtHoGiaDinh?.id ?? cp.doi_tuong_id,
      dich_den: "cong-thong-tin",
      ly_do: "Hộ gia đình hỏi quy tắc phân loại — FAQ ngắn, mỗi câu trả lời gắn yêu cầu/ngoại lệ ràng buộc.",
    },
    {
      id: "cq-checklist-doanh-nghiep",
      tieu_de: "Checklist tuân thủ doanh nghiệp",
      dinh_dang: "checklist-doanh-nghiep",
      doi_tuong_id: dtDoanhNghiep?.id ?? null,
      dich_den: "cong-thong-tin",
      ly_do: "Doanh nghiệp cần các bước cụ thể — checklist gom yêu cầu bắt buộc thành việc phải làm, ngoại lệ nêu riêng.",
    },
    {
      id: "cq-giai-thich-truong-hoc",
      tieu_de: "Bài giải thích cho trường học",
      dinh_dang: "giai-thich-truong-hoc",
      doi_tuong_id: dtTruongHoc?.id ?? null,
      dich_den: "website",
      ly_do: "Trường học cần bài giải thích dạy được — văn đơn giản, tách rõ phải làm và nên làm.",
    },
    {
      id: "cq-tom-tat-nha-thau",
      tieu_de: "Tóm tắt cho nhà thầu",
      dinh_dang: "tom-tat-nha-thau",
      doi_tuong_id: dtNhaThau?.id ?? null,
      dich_den: "email",
      ly_do: "Nhà thầu cần nghĩa vụ hợp đồng ngắn gọn — tóm tắt yêu cầu bắt buộc + ngoại lệ áp dụng.",
    },
  ];
  if (cp.ngon_ngu_phu) {
    ds.push({
      id: "cq-ban-dich",
      tieu_de: `Bản dịch ${cp.ngon_ngu_phu} — ngôn ngữ giản dị`,
      dinh_dang: "ban-dich-gian-di",
      doi_tuong_id: dtNhapCu?.id ?? null,
      dich_den: "cong-thong-tin",
      ngon_ngu: cp.ngon_ngu_phu,
      ly_do: `Người nhập cư cần bản ${cp.ngon_ngu_phu} ngôn ngữ giản dị — giữ nguyên nghĩa vụ, ngoại lệ, phạm vi và ngày hiệu lực.`,
    });
  }
  return ds;
}

// --- Điều khoản nguồn mơ hồ/mâu thuẫn → câu hỏi review ---

export type DieuKhoanMoHo = {
  id: string; // ổn định theo nguon_id + muc_id + chỉ số câu — dedupe được
  nguon_id: string;
  nguon_tieu_de: string;
  muc_id: string;
  trich: string; // mệnh đề/câu chứa từ ngữ mơ hồ
  danh_dau: string; // từ ngữ mơ hồ đã khớp
};

// Từ ngữ làm điều khoản mơ hồ/mâu thuẫn trong văn bản pháp quy: tùy
// chọn rộng, điều kiện mơ hồ, quy định chiếu — đầu ra không được diễn
// giải thay luật, phải để câu hỏi cho thẩm quyền.
const RE_MO_HO =
  /(có\s+thể|v\.?\s*v\.?|hoặc\s+khác|tùy\s+(theo|trường|tình)|theo\s+quy\s+định|phù\s+hợp|hợp\s+lý|thích\s+hợp|linh\s+hoạt|được\s+miễn|khi\s+cần|đàm\s+phán|thỏa\s+thuận|xem\s+xét)/iu;
const TOI_DA_MO_HO = 12;
const DO_DAI_TRICH = 160;

function tachaCau(vanBan: string): string[] {
  return vanBan
    .split(/(?<=[.;!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

// Quét điều khoản mơ hồ trên head revision của các nguồn trong
// provenance chủ đề (trừ nguồn fact tự động — đó là văn bản do hệ
// thống chiếu, không phải điều khoản nguồn). Kết quả trở thành câu hỏi
// review trong goiY + context sinh — đầu ra không được diễn giải thay.
export function timDieuKhoanMoHo(db: Database, cp: Campaign): DieuKhoanMoHo[] {
  const td = thongDiepChuDe(db, cp);
  if (!td) return [];
  const dsNguon = danhSachNguonCuaThongDiep(db, td.id).filter(
    (id) => id !== cp.nguon_cong_quyen_id,
  );
  const ra: DieuKhoanMoHo[] = [];
  for (const nguonId of dsNguon) {
    if (ra.length >= TOI_DA_MO_HO) break;
    const nguon = layNguon(db, nguonId);
    const rev = nguon?.head_revision_id ? layNguonRevision(db, nguon.head_revision_id) : null;
    if (!nguon || !rev) continue;
    const dsDoan =
      rev.cac_muc.length > 0
        ? rev.cac_muc.map((m) => ({ muc_id: m.id, van_ban: `${m.tieu_de ?? ""}\n${m.noi_dung}` }))
        : [{ muc_id: "", van_ban: rev.noi_dung }];
    for (const doan of dsDoan) {
      if (ra.length >= TOI_DA_MO_HO) break;
      for (const [i, cau] of tachaCau(doan.van_ban).entries()) {
        if (ra.length >= TOI_DA_MO_HO) break;
        const m = RE_MO_HO.exec(cau);
        if (!m) continue;
        ra.push({
          id: `mk-${nguonId}-${doan.muc_id || "toan-van"}-${i}`,
          nguon_id: nguonId,
          nguon_tieu_de: nguon.tieu_de,
          muc_id: doan.muc_id,
          trich: cau.length > DO_DAI_TRICH ? `${cau.slice(0, DO_DAI_TRICH - 1)}…` : cau,
          danh_dau: m[1] ?? "",
        });
      }
    }
  }
  return ra;
}

// --- Nhóm đầu ra cũ theo đích (đổi chính sách → liệt kê riêng) ---

// Một đầu ra bị ảnh hưởng bởi thay đổi chính sách: mỗi đích giữ riêng
// người cần thông báo — nháp cần sinh lại, đã xuất cần xuất bản lại,
// đã lên lịch bị chặn chờ review, đã đăng cần sửa copy tay bên ngoài.
export type DauRaAnhHuong = {
  ban_the_hien_id: string;
  dinh_dang: string;
  doi_tuong: string;
  ngon_ngu: string;
  trang_thai: string;
  la_cu: boolean;
  ds_task_mo: string[];
  job_len_lich_id: string | null;
  ds_xuat_ban: { id: string; dich_den: string; revision_id: string; tao_luc: string }[];
};

export type AnhHuongCongQuyen = {
  nhap: DauRaAnhHuong[]; // chưa xuất bản lần nào
  da_xuat: DauRaAnhHuong[]; // có bản xuất (trang nội bộ /p đang phục vụ)
  da_len_lich: DauRaAnhHuong[]; // có job đã lên lịch (cho|loi) mang chay_som_nhat
  da_dang: DauRaAnhHuong[]; // có xuất bản kèm dich_den — copy đã đăng tay ra ngoài
};

// Bản thể hiện "cũ theo nguồn": head revision ghim thong_diep revision
// khác head thông điệp hiện tại — provenance của nó chỉ tới revision
// nguồn cũ.
export function laCuTheoNguon(db: Database, bth: BanTheHien): boolean {
  const headRev = bth.head_revision_id ? layRevision(db, bth.head_revision_id) : null;
  if (!headRev?.thong_diep_revision_id) return false;
  const td = db
    .query("SELECT head_revision_id FROM thong_diep WHERE id = ?")
    .get(bth.thong_diep_id) as { head_revision_id: string | null } | null;
  if (!td?.head_revision_id) return false;
  return headRev.thong_diep_revision_id !== td.head_revision_id;
}

// Job đã lên lịch của một bản: trạng thái 'cho' hoặc 'loi' và kèm
// chay_som_nhat (lịch đặt trước). Job loi giữ lịch để liệt kê đúng đích.
function timJobLenLich(db: Database, bthId: string): { id: string } | null {
  return (
    (db
      .query(
        `SELECT id FROM job
         WHERE entity_loai = 'ban_the_hien' AND entity_id = ?
           AND trang_thai IN ('cho', 'loi') AND chay_som_nhat IS NOT NULL
         ORDER BY tao_luc DESC LIMIT 1`,
      )
      .get(bthId) as { id: string } | null) ?? null
  );
}

// Liệt kê đầu ra phụ thuộc chính sách đã đánh dấu cũ (la_cu hoặc có
// task sửa đang mở), nhóm theo đích: nháp / đã xuất / đã lên lịch /
// đã đăng. Một đầu ra có thể thuộc nhiều nhóm (vd đã xuất vừa đã đăng).
export function docAnhHuongCongQuyen(db: Database, cp: Campaign): AnhHuongCongQuyen {
  const ra: AnhHuongCongQuyen = { nhap: [], da_xuat: [], da_len_lich: [], da_dang: [] };
  const td = thongDiepChuDe(db, cp);
  if (!td) return ra;
  const dsBth = danhSachBanTheHien(db, { thongDiepId: td.id });
  for (const bth of dsBth) {
    const dsTask = danhSachTaskSua(db, {
      banTheHienId: bth.id,
      trangThai: ["mo", "dang_lam"],
    });
    const laCu = laCuTheoNguon(db, bth);
    if (!laCu && dsTask.length === 0) continue;
    const dsXuatBan = danhSachXuatBan(db, bth.id).map((x) => ({
      id: x.id,
      dich_den: x.dich_den,
      revision_id: x.revision_id,
      tao_luc: x.tao_luc,
    }));
    const jobLenLich = timJobLenLich(db, bth.id);
    const item: DauRaAnhHuong = {
      ban_the_hien_id: bth.id,
      dinh_dang: bth.dinh_dang,
      doi_tuong: bth.doi_tuong,
      ngon_ngu: bth.ngon_ngu,
      trang_thai: bth.trang_thai,
      la_cu: laCu,
      ds_task_mo: dsTask.map((t) => t.id),
      job_len_lich_id: jobLenLich?.id ?? null,
      ds_xuat_ban: dsXuatBan,
    };
    if (dsXuatBan.length === 0) ra.nhap.push(item);
    if (dsXuatBan.length > 0) ra.da_xuat.push(item);
    if (jobLenLich) ra.da_len_lich.push(item);
    if (dsXuatBan.some((x) => x.dich_den.trim() !== "")) ra.da_dang.push(item);
  }
  return ra;
}

// --- View phái sinh cho API/UI ---

export type YeuCauView = YeuCauCongQuyen & {
  co_bang_chung: boolean;
  nguon: { id: string; tieu_de: string } | null;
  muc: { id: string; tieu_de: string } | null;
};
export type NgoaiLeView = NgoaiLeCongQuyen & {
  co_bang_chung: boolean;
  nguon: { id: string; tieu_de: string } | null;
  muc: { id: string; tieu_de: string } | null;
};
export type FactVanHanhView = FactVanHanh & {
  co_bang_chung: boolean;
  nguon: { id: string; tieu_de: string } | null;
  muc: { id: string; tieu_de: string } | null;
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

export function docYeuCauView(db: Database, cp: Campaign): YeuCauView[] {
  return cp.ds_yeu_cau.map((t) => ({ ...t, ...docViewBangChung(db, t.nguon_id, t.muc_id) }));
}
export function docNgoaiLeView(db: Database, cp: Campaign): NgoaiLeView[] {
  return cp.ds_ngoai_le.map((t) => ({ ...t, ...docViewBangChung(db, t.nguon_id, t.muc_id) }));
}
export function docFactVanHanhView(db: Database, cp: Campaign): FactVanHanhView[] {
  return cp.ds_fact_van_hanh.map((t) => ({
    ...t,
    ...docViewBangChung(db, t.nguon_id, t.muc_id),
  }));
}

// Một đầu ra trong cổng review thẩm quyền: trạng thái + revision nguồn
// fact chính sách mà head đang ghim (claim liên kết đúng revision) +
// reviewer của lần duyệt gần nhất.
export type DauRaCongQuyenView = {
  ban_the_hien_id: string;
  dinh_dang: string;
  doi_tuong: string;
  ngon_ngu: string;
  dich_den: string;
  trang_thai: string;
  la_cu: boolean;
  head_revision_id: string | null;
  revision_chinh_sach: { id: string; so_thu_tu: number } | null;
  nguoi_duyet_cuoi: { id: string; ten: string } | null;
};

export function docDauRaCongQuyen(db: Database, cp: Campaign): DauRaCongQuyenView[] {
  const td = thongDiepChuDe(db, cp);
  if (!td) return [];
  const dsBth = danhSachBanTheHien(db, { thongDiepId: td.id });
  const tenNguoiDuyet = (id: string) => cp.ds_nguoi_duyet.find((x) => x.id === id)?.ten ?? id;
  return dsBth.map((bth) => {
    const headRev = bth.head_revision_id ? layRevision(db, bth.head_revision_id) : null;
    const tdRev = headRev?.thong_diep_revision_id
      ? layThongDiepRevision(db, headRev.thong_diep_revision_id)
      : null;
    // Revision của nguồn fact chính sách mà head đang ghim — provenance
    // chứng minh đầu ra nói về đúng bản chính sách.
    const nguonRev = (tdRev?.nguon_revision_ids ?? [])
      .map((id) => layNguonRevision(db, id))
      .find((n) => n !== null && n.nguon_id === cp.nguon_cong_quyen_id);
    const duyetCuoi = (
      db
        .query(
          "SELECT nguoi_duyet_id FROM duyet WHERE ban_the_hien_id = ? AND den_trang_thai = 'da_duyet' ORDER BY tao_luc DESC LIMIT 1",
        )
        .get(bth.id) as { nguoi_duyet_id: string } | null
    )?.nguoi_duyet_id;
    return {
      ban_the_hien_id: bth.id,
      dinh_dang: bth.dinh_dang,
      doi_tuong: bth.doi_tuong,
      ngon_ngu: bth.ngon_ngu,
      dich_den: bth.dich_den,
      trang_thai: bth.trang_thai,
      la_cu: laCuTheoNguon(db, bth),
      head_revision_id: bth.head_revision_id,
      revision_chinh_sach: nguonRev ? { id: nguonRev.id, so_thu_tu: nguonRev.so_thu_tu } : null,
      nguoi_duyet_cuoi: duyetCuoi ? { id: duyetCuoi, ten: tenNguoiDuyet(duyetCuoi) } : null,
    };
  });
}

export type CongQuyenView = {
  nguon_cong_quyen: { id: string; tieu_de: string; head_revision_id: string | null } | null;
  nguon_chinh_sach: { id: string; tieu_de: string; head_revision_id: string | null } | null;
  ds_yeu_cau_view: YeuCauView[];
  ds_ngoai_le_view: NgoaiLeView[];
  ds_fact_van_hanh_view: FactVanHanhView[];
  ds_nguoi_duyet: NguoiDuyetCongQuyen[];
  che_do_bao_ve: number;
  dieu_khoan_mo_ho: DieuKhoanMoHo[];
  anh_huong: AnhHuongCongQuyen;
  dau_ra: DauRaCongQuyenView[];
};

export function docCongQuyenView(db: Database, cp: Campaign): CongQuyenView | null {
  if (!laCongQuyen(cp)) return null;
  const nguonCq = cp.nguon_cong_quyen_id ? layNguon(db, cp.nguon_cong_quyen_id) : null;
  const nguonCs = cp.nguon_chinh_sach_id ? layNguon(db, cp.nguon_chinh_sach_id) : null;
  return {
    nguon_cong_quyen: nguonCq
      ? { id: nguonCq.id, tieu_de: nguonCq.tieu_de, head_revision_id: nguonCq.head_revision_id }
      : null,
    nguon_chinh_sach: nguonCs
      ? { id: nguonCs.id, tieu_de: nguonCs.tieu_de, head_revision_id: nguonCs.head_revision_id }
      : null,
    ds_yeu_cau_view: docYeuCauView(db, cp),
    ds_ngoai_le_view: docNgoaiLeView(db, cp),
    ds_fact_van_hanh_view: docFactVanHanhView(db, cp),
    ds_nguoi_duyet: cp.ds_nguoi_duyet,
    che_do_bao_ve: cp.che_do_bao_ve,
    dieu_khoan_mo_ho: timDieuKhoanMoHo(db, cp),
    anh_huong: docAnhHuongCongQuyen(db, cp),
    dau_ra: docDauRaCongQuyen(db, cp),
  };
}

// --- Gợi ý khoảng trống + câu hỏi review ---

export type GoiYCongQuyen = {
  id: string;
  loai:
    | "yeu_cau_chua_xac_nhan"
    | "ngoai_le_chua_xac_nhan"
    | "fact_van_hanh_chua_nguon"
    | "dieu_khoan_mo_ho"
    | "thieu_chinh_sach"
    | "thieu_ngay_hieu_luc"
    | "thieu_pham_vi"
    | "thieu_nguoi_duyet"
    | "thieu_ngon_ngu_phu"
    | "thieu_dau_ra";
  tieu_de: string;
  ly_do: string;
  bang_chung: string[];
  de_xuat_muc?: MucLuc;
};

// Gợi ý của chiến dịch công quyền — tính lại mỗi lần đọc:
// - mục chưa có bằng chứng nguồn (đầu ra sẽ phải để [CÂU HỎI]);
// - điều khoản nguồn mơ hồ → câu hỏi review, không phải luật bịa;
// - thiếu văn bản chính sách chính thức / ngày hiệu lực / phạm vi;
// - chưa ghi reviewer (cổng review thẩm quyền không có ai chấm);
// - chưa chọn ngôn ngữ thứ hai (không có bản dịch giản dị);
// - đầu ra đề xuất còn thiếu trong mục lục.
export function goiYCongQuyen(db: Database, cp: Campaign): GoiYCongQuyen[] {
  const ds: GoiYCongQuyen[] = [];
  for (const yc of docYeuCauView(db, cp)) {
    if (yc.co_bang_chung) continue;
    ds.push({
      id: `goi-y-yc-${yc.id}`,
      loai: "yeu_cau_chua_xac_nhan",
      tieu_de: `Yêu cầu '${yc.noi_dung.slice(0, 60)}' chưa có bằng chứng nguồn`,
      ly_do: `Yêu cầu loai '${yc.loai}' chưa trỏ nguồn/mục chính sách nào đã nạp — đầu ra nhắc nó sẽ phải để [CÂU HỎI] thay vì trình bày như quy định. Gán nguon_id + muc_id của văn bản chính sách.`,
      bang_chung: [`loai: ${yc.loai || "—"}`, `doi_tuong_ap_dung: ${yc.doi_tuong_ap_dung || "chung"}`],
    });
  }
  for (const nl of docNgoaiLeView(db, cp)) {
    if (nl.co_bang_chung) continue;
    ds.push({
      id: `goi-y-nl-${nl.id}`,
      loai: "ngoai_le_chua_xac_nhan",
      tieu_de: `Ngoại lệ '${nl.noi_dung.slice(0, 60)}' chưa có bằng chứng nguồn`,
      ly_do: "Ngoại lệ chưa trỏ nguồn đã nạp — đầu ra có nguy cơ bỏ ngoại lệ hoặc bịa điều kiện. Gán nguon_id + muc_id của văn bản chính sách.",
      bang_chung: [`yeu_cau_id: ${nl.yeu_cau_id || "chung"}`],
    });
  }
  for (const fv of docFactVanHanhView(db, cp)) {
    if (fv.co_bang_chung) continue;
    ds.push({
      id: `goi-y-fv-${fv.id}`,
      loai: "fact_van_hanh_chua_nguon",
      tieu_de: `Fact vận hành '${fv.tieu_de}' chưa có nguồn`,
      ly_do: "Fact vận hành chưa trỏ nguồn đã nạp — đầu ra chỉ được để [CÂU HỎI], không trình bày như sự thật.",
      bang_chung: [`tieu_de: ${fv.tieu_de}`],
    });
  }
  for (const dk of timDieuKhoanMoHo(db, cp)) {
    ds.push({
      id: `goi-y-${dk.id}`,
      loai: "dieu_khoan_mo_ho",
      tieu_de: `Điều khoản mơ hồ trong '${dk.nguon_tieu_de}'`,
      ly_do: `Mệnh đề chứa từ ngữ mơ hồ '${dk.danh_dau}' — đưa vào câu hỏi review cho thẩm quyền, đầu ra không được diễn giải thay luật.`,
      bang_chung: [`muc: ${dk.muc_id || "toàn văn"}`, `trich: ${dk.trich}`],
    });
  }
  if (!cp.nguon_chinh_sach_id || !layNguon(db, cp.nguon_chinh_sach_id)) {
    ds.push({
      id: "goi-y-chinh-sach",
      loai: "thieu_chinh_sach",
      tieu_de: "Chưa liên kết văn bản chính sách chính thức",
      ly_do: "Chiến dịch chưa có nguon_chinh_sach_id — claim yêu cầu/ngày hiệu lực không liên kết được revision chính sách. Nạp văn bản rồi chọn nguồn.",
      bang_chung: [],
    });
  }
  if (!cp.ngay_hieu_luc) {
    ds.push({
      id: "goi-y-ngay-hieu-luc",
      loai: "thieu_ngay_hieu_luc",
      tieu_de: "Chưa đặt ngày hiệu lực",
      ly_do: "Chính sách chưa có ngày hiệu lực — đầu ra không biết phải thông báo mốc nào. Đặt ngay_hieu_luc (YYYY-MM-DD).",
      bang_chung: [],
    });
  }
  if (!cp.pham_vi_quyen_han) {
    ds.push({
      id: "goi-y-pham-vi",
      loai: "thieu_pham_vi",
      tieu_de: "Chưa đặt phạm vi quyền hạn",
      ly_do: "Chưa nêu địa giới/nhóm đối tượng áp dụng — đầu ra không khẳng định được ai thuộc phạm vi. Đặt pham_vi_quyen_han.",
      bang_chung: [],
    });
  }
  if (cp.ds_nguoi_duyet.length === 0) {
    ds.push({
      id: "goi-y-nguoi-duyet",
      loai: "thieu_nguoi_duyet",
      tieu_de: "Chưa ghi reviewer thẩm quyền",
      ly_do: "ds_nguoi_duyet rỗng — cổng review không có người chấm được ghi; che_do_bao_ve=1 sẽ chặn duyệt. Thêm id + ten + vai_tro.",
      bang_chung: [],
    });
  }
  if (!cp.ngon_ngu_phu) {
    ds.push({
      id: "goi-y-ngon-ngu-phu",
      loai: "thieu_ngon_ngu_phu",
      tieu_de: "Chưa chọn ngôn ngữ bản dịch giản dị",
      ly_do: "Đặt ngon_ngu_phu (vd 'en') để đề xuất bản dịch ngôn ngữ giản dị cho người nhập cư.",
      bang_chung: [],
    });
  }
  const deXuat = deXuatDauRaCongQuyen(db, cp);
  const daCo = new Set(cp.muc_luc.map(khoaMucLuc));
  const thieu = deXuat.filter((d) => !daCo.has(khoaMucLuc(d)));
  for (const d of thieu) {
    ds.push({
      id: `goi-y-dau-ra-${d.id}`,
      loai: "thieu_dau_ra",
      tieu_de: `Thiếu đầu ra '${d.tieu_de}'`,
      ly_do: d.ly_do || "Đầu ra đề xuất cho nhóm đối tượng này chưa có trong mục lục — thêm để nháp.",
      bang_chung: [
        `dinh_dang: ${d.dinh_dang}`,
        `dich_den: ${d.dich_den || "—"}`,
        `ngon_ngu: ${d.ngon_ngu || "vi"}`,
      ],
      de_xuat_muc: d,
    });
  }
  return ds;
}
