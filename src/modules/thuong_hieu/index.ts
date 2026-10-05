import type { Database } from "bun:sqlite";
import {
  capNhatNguon,
  capNhatThongDiep,
  capNhatThiTruong,
  chuyenTrangThai,
  danhSachBanTheHien,
  danhSachThiTruong,
  danhSachXuatBan,
  ganNguonThiTruong,
  ganThongDiepThiTruong,
  ghiSuKien,
  layBanTheHien,
  layCampaign,
  layNguon,
  layNguonRevision,
  layThiTruong,
  layThiTruongTheoMa,
  layThiTruongTheoThongDiep,
  layRevision,
  layThongDiep,
  layThongDiepRevision,
  taoBanTheHien,
  taoNguon,
  taoThiTruong,
  taoThongDiep,
  timBanTheHien,
  type AssetHinh,
  type BanTheHien,
  type Campaign,
  type ChiTietDoiTuong,
  type ClaimThuongHieu,
  type MucNguon,
  type Nguon,
  type ThiTruong,
  type ThongDiep,
  type NhapThiTruong,
} from "../content/index.ts";
import { layAsset } from "../nap/index.ts";
import { danhSachDoiTuong, layDoiTuong } from "../context/index.ts";
import { kiemTraNgonNgu, layDinhDang } from "../formats/index.ts";
import { enqueueJob } from "../jobs/index.ts";
import { danhSachTaskSua } from "../thay_doi/index.ts";
import { kiemTraDsNguoiDuyet, laCuTheoNguon } from "../cong_quyen/index.ts";
import { LoiApi, tuyChonChuoi } from "../../loi.ts";

// Module thương hiệu toàn cầu (#12): một thương hiệu ra mắt sản phẩm
// trên nhiều thị trường — runner thi đấu và runner phong trào cần
// truyền thông khác nhau, trong khi claim sản phẩm đã duyệt giữ nhất
// quán. Campaign loai 'thuong_hieu' giữ fact cấp campaign: ds_claim
// (claim đã duyệt + bằng chứng nguồn), giong_van, asset hình dùng chung
// và CTA mặc định. Bảng thi_truong giữ ghi đè tường minh của đội local:
// giá/tiền tệ được cung cấp (không tự quy đổi), ngôn ngữ, khả dụng,
// landing page, CTA local, chi tiết theo đối tượng, ghi đè tự do và
// reviewer local (móc nối #16).
//
// Hai tầng nguồn fact tự động:
// - nguồn chung (campaign.nguon_thuong_hieu_id, mục 'th-*') link vào
//   thông điệp của MỌI thị trường → sửa claim chung sinh revision nguồn
//   mới → #14 vô hiệu hóa biến thể phụ thuộc trên mọi thị trường;
// - nguồn thị trường (thi_truong.nguon_id, mục 'tt-<ma>-*') chỉ link vào
//   thông điệp riêng của thị trường đó (thi_truong.thong_diep_id) → đổi
//   fact local chỉ vô hiệu hóa đúng biến thể của thị trường đó.
//
// Chọn tổ hợp (chonToHop): người dùng chọn đích danh
// thi_truong × dinh_dang × doi_tuong × dich_den — chỉ tổ hợp đã chọn mới
// sinh, giới hạn cấu hình ai.toi_da_fan_out mỗi request, không tích
// Descartes mất kiểm soát. Thị trường thiếu giá/khả dụng hiển thị
// 'chưa đủ' và bị chặn từng tổ hợp (bi_chan) thay vì đầu ra bịa fact.

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

export function laThuongHieu(cp: Campaign | null | undefined): boolean {
  return !!cp && cp.loai === "thuong_hieu";
}

// --- Validation input thương hiệu ---

const RE_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;
// Mã thị trường ngắn, ổn định — dùng trong id mục nguồn 'tt-<ma>-*'.
const RE_MA_THI_TRUONG = /^[a-z0-9][a-z0-9-]{0,15}$/;
// Mã tiền tệ ISO 4217 dạng 3 ký tự — chỉ lưu giá trị được cung cấp.
const RE_TIEN_TE = /^[A-Za-z]{3}$/;
export const KHA_DUNG_HOP_LE = ["co_hang", "het_hang", "dat_truoc"];
// Ngôn ngữ đầu ra của thị trường phải nằm trong tập registry định dạng
// hỗ trợ — kiemTraNgonNgu của định dạng kiểm lại khi chọn tổ hợp.
export const NGON_NGU_THI_TRUONG = ["vi", "en"];

const DAI_TOI_DA = {
  claim: 1000,
  giong_van: 2000,
  ghi_chu: 500,
  ten: 200,
  gia: 50,
  url: 500,
  cta_nhan: 200,
  chi_tiet: 2000,
  ghi_de_khoa: 64,
  ghi_de_gia_tri: 1000,
  ghi_de_so_khoa: 20,
  nguoi_duyet_ten: 120,
  nguoi_duyet_vai_tro: 200,
};

export function docGiongVan(v: unknown, dsLoi: string[]): string | undefined {
  if (v === undefined) return undefined;
  const s = typeof v === "string" ? v.trim() : "";
  if (s.length > DAI_TOI_DA.giong_van) {
    dsLoi.push(`giong_van vượt ${DAI_TOI_DA.giong_van} ký tự.`);
    return undefined;
  }
  return s;
}

// Con trỏ bằng chứng chung — giống cong_quyen/phat_hanh: nguon_id đặt
// thì phải tồn tại; muc_id đặt thì phải có trong cac_muc của nguồn đó.
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

// ds_claim: claim sản phẩm đã duyệt dùng chung mọi thị trường. Con trỏ
// bằng chứng sai không được lưu lặng; claim chưa có bằng chứng chỉ được
// hiện dạng [CÂU HỎI] trong đầu ra.
export function kiemTraDsClaim(
  db: Database,
  v: unknown,
  dsLoi: string[],
): ClaimThuongHieu[] | undefined {
  if (v === undefined) return undefined;
  if (!Array.isArray(v)) {
    dsLoi.push("ds_claim phải là một mảng.");
    return undefined;
  }
  const ds: ClaimThuongHieu[] = [];
  const daCo = new Set<string>();
  for (const [i, dong] of v.entries()) {
    if (typeof dong !== "object" || dong === null || Array.isArray(dong)) {
      dsLoi.push(`ds_claim[${i}] phải là object.`);
      continue;
    }
    const c = dong as Record<string, unknown>;
    const id = typeof c.id === "string" && c.id ? c.id.trim() : `cl${i + 1}`;
    if (!RE_ID.test(id)) {
      dsLoi.push(`ds_claim[${i}].id '${id}' không hợp lệ (a-z0-9_-, tối đa 64).`);
    }
    if (daCo.has(id)) dsLoi.push(`ds_claim[${i}].id '${id}' trùng với dòng khác.`);
    daCo.add(id);
    const noiDung = typeof c.noi_dung === "string" ? c.noi_dung.trim() : "";
    if (!noiDung) dsLoi.push(`ds_claim[${i}].noi_dung là bắt buộc.`);
    if (noiDung.length > DAI_TOI_DA.claim) {
      dsLoi.push(`ds_claim[${i}].noi_dung vượt ${DAI_TOI_DA.claim} ký tự.`);
    }
    const tro = docConTroNguon(db, `ds_claim[${i}]`, c.nguon_id, c.muc_id, dsLoi);
    ds.push({ id, noi_dung: noiDung, nguon_id: tro.nguon_id, muc_id: tro.muc_id });
  }
  return ds;
}

// ds_asset_hinh: asset hình phân phối chung — asset_id phải trỏ asset
// thật trong kho; ghi_chu là phạm vi/cách dùng đã duyệt.
export function kiemTraDsAssetHinh(
  db: Database,
  v: unknown,
  dsLoi: string[],
): AssetHinh[] | undefined {
  if (v === undefined) return undefined;
  if (!Array.isArray(v)) {
    dsLoi.push("ds_asset_hinh phải là một mảng.");
    return undefined;
  }
  const ds: AssetHinh[] = [];
  const daCo = new Set<string>();
  for (const [i, dong] of v.entries()) {
    if (typeof dong !== "object" || dong === null || Array.isArray(dong)) {
      dsLoi.push(`ds_asset_hinh[${i}] phải là object.`);
      continue;
    }
    const a = dong as Record<string, unknown>;
    const id = typeof a.id === "string" && a.id ? a.id.trim() : `ah${i + 1}`;
    if (!RE_ID.test(id)) {
      dsLoi.push(`ds_asset_hinh[${i}].id '${id}' không hợp lệ (a-z0-9_-, tối đa 64).`);
    }
    if (daCo.has(id)) dsLoi.push(`ds_asset_hinh[${i}].id '${id}' trùng với dòng khác.`);
    daCo.add(id);
    const assetId = typeof a.asset_id === "string" ? a.asset_id.trim() : "";
    if (!assetId) {
      dsLoi.push(`ds_asset_hinh[${i}].asset_id là bắt buộc.`);
    } else if (!layAsset(db, assetId)) {
      dsLoi.push(`ds_asset_hinh[${i}].asset_id '${assetId}' không tồn tại trong kho asset.`);
    }
    const ghiChu = typeof a.ghi_chu === "string" ? a.ghi_chu.trim() : "";
    if (ghiChu.length > DAI_TOI_DA.ghi_chu) {
      dsLoi.push(`ds_asset_hinh[${i}].ghi_chu vượt ${DAI_TOI_DA.ghi_chu} ký tự.`);
    }
    ds.push({ id, asset_id: assetId, ghi_chu: ghiChu });
  }
  return ds;
}

// --- Validation thị trường ---

// Validate đầy đủ một thị trường trước mọi mutation. ttCu truyền khi PUT
// (field absent giữ giá trị cũ); không truyền = tạo mới — ma + ten bắt
// buộc. Trả NhapThiTruong đã chuẩn hóa hoặc undefined khi có lỗi.
export function kiemTraNhapThiTruong(
  db: Database,
  cp: Campaign,
  body: Record<string, unknown>,
  dsLoi: string[],
  ttCu?: ThiTruong,
): NhapThiTruong | undefined {
  const nhap: NhapThiTruong = {};

  if (body.ma !== undefined || !ttCu) {
    const ma = tuyChonChuoi(body.ma);
    if (!ma) dsLoi.push("ma là bắt buộc.");
    else if (!RE_MA_THI_TRUONG.test(ma)) {
      dsLoi.push(`ma '${ma}' không hợp lệ (a-z0-9-, tối đa 16).`);
    } else {
      const trung = layThiTruongTheoMa(db, cp.id, ma);
      if (trung && trung.id !== ttCu?.id) {
        dsLoi.push(`ma '${ma}' đã có trên thị trường khác của chiến dịch.`);
      }
    }
    nhap.ma = ma;
  }
  if (body.ten !== undefined || !ttCu) {
    const ten = tuyChonChuoi(body.ten);
    if (!ten) dsLoi.push("ten là bắt buộc.");
    if (ten.length > DAI_TOI_DA.ten) dsLoi.push(`ten vượt ${DAI_TOI_DA.ten} ký tự.`);
    nhap.ten = ten;
  }
  if (body.ngon_ngu !== undefined || !ttCu) {
    const nn = tuyChonChuoi(body.ngon_ngu) || "vi";
    if (!NGON_NGU_THI_TRUONG.includes(nn)) {
      dsLoi.push(`ngon_ngu '${nn}' không hỗ trợ. Cho phép: ${NGON_NGU_THI_TRUONG.join(", ")}.`);
    }
    nhap.ngon_ngu = nn;
  }
  // Giá: giữ nguyên văn giá trị được cung cấp — không parse/quy đổi.
  // Có giá mà thiếu tiền tệ là lỗi (cặp phải đi cùng nhau).
  if (body.gia !== undefined || !ttCu) {
    const gia = tuyChonChuoi(body.gia);
    if (gia.length > DAI_TOI_DA.gia) dsLoi.push(`gia vượt ${DAI_TOI_DA.gia} ký tự.`);
    nhap.gia = gia;
  }
  if (body.tien_te !== undefined || !ttCu) {
    const tienTe = tuyChonChuoi(body.tien_te);
    if (tienTe && !RE_TIEN_TE.test(tienTe)) {
      dsLoi.push(`tien_te '${tienTe}' phải là mã ISO 4217 ba ký tự (vd 'USD', 'VND').`);
    }
    nhap.tien_te = tienTe.toUpperCase();
  }
  const giaKetQua = nhap.gia !== undefined ? nhap.gia : ttCu?.gia || "";
  const tienTeKetQua = nhap.tien_te !== undefined ? nhap.tien_te : ttCu?.tien_te || "";
  if (giaKetQua && !tienTeKetQua) {
    dsLoi.push("gia có giá trị thì tien_te bắt buộc.");
  }
  if (body.kha_dung !== undefined || !ttCu) {
    const kd = tuyChonChuoi(body.kha_dung);
    if (kd && !KHA_DUNG_HOP_LE.includes(kd)) {
      dsLoi.push(`kha_dung '${kd}' không hợp lệ. Cho phép: ${KHA_DUNG_HOP_LE.join(", ")} hoặc để trống.`);
    }
    nhap.kha_dung = kd;
  }
  const docUrl = (khoa: string, giaTri: unknown): string => {
    const s = tuyChonChuoi(giaTri);
    if (s.length > DAI_TOI_DA.url) dsLoi.push(`${khoa} vượt ${DAI_TOI_DA.url} ký tự.`);
    if (s && !/^https?:\/\//.test(s) && !s.startsWith("/")) {
      dsLoi.push(`${khoa} '${s}' phải là link http(s) hoặc đường dẫn nội bộ.`);
    }
    return s;
  };
  if (body.landing_page !== undefined || !ttCu) {
    nhap.landing_page = docUrl("landing_page", body.landing_page);
  }
  if (body.cta_nhan !== undefined || !ttCu) {
    const nhan = tuyChonChuoi(body.cta_nhan);
    if (nhan.length > DAI_TOI_DA.cta_nhan) {
      dsLoi.push(`cta_nhan vượt ${DAI_TOI_DA.cta_nhan} ký tự.`);
    }
    nhap.cta_nhan = nhan;
  }
  if (body.cta_url !== undefined || !ttCu) {
    nhap.cta_url = docUrl("cta_url", body.cta_url);
  }
  // ds_chi_tiet: lời thoại/ưu đãi đã duyệt riêng cho một đối tượng —
  // doi_tuong_id phải trỏ hồ sơ thật, không trùng nhau.
  if (body.ds_chi_tiet !== undefined || !ttCu) {
    const raw = body.ds_chi_tiet;
    if (raw === undefined) {
      nhap.ds_chi_tiet = ttCu ? undefined : [];
    } else if (!Array.isArray(raw)) {
      dsLoi.push("ds_chi_tiet phải là một mảng.");
    } else {
      const ds: ChiTietDoiTuong[] = [];
      const daCoDt = new Set<string>();
      for (const [i, dong] of raw.entries()) {
        if (typeof dong !== "object" || dong === null || Array.isArray(dong)) {
          dsLoi.push(`ds_chi_tiet[${i}] phải là object.`);
          continue;
        }
        const ct = dong as Record<string, unknown>;
        const dtId = tuyChonChuoi(ct.doi_tuong_id);
        if (!dtId) {
          dsLoi.push(`ds_chi_tiet[${i}].doi_tuong_id là bắt buộc.`);
        } else if (!layDoiTuong(db, dtId)) {
          dsLoi.push(`ds_chi_tiet[${i}].doi_tuong_id '${dtId}' không tồn tại.`);
        }
        if (dtId && daCoDt.has(dtId)) {
          dsLoi.push(`ds_chi_tiet[${i}].doi_tuong_id '${dtId}' trùng với dòng khác.`);
        }
        daCoDt.add(dtId);
        const chiTiet = tuyChonChuoi(ct.chi_tiet);
        if (!chiTiet) dsLoi.push(`ds_chi_tiet[${i}].chi_tiet là bắt buộc.`);
        if (chiTiet.length > DAI_TOI_DA.chi_tiet) {
          dsLoi.push(`ds_chi_tiet[${i}].chi_tiet vượt ${DAI_TOI_DA.chi_tiet} ký tự.`);
        }
        ds.push({ doi_tuong_id: dtId, chi_tiet: chiTiet });
      }
      nhap.ds_chi_tiet = ds;
    }
  }
  // ghi_de: object {khoa: chuoi} — ghi đè tự do, khóa phải đọc được.
  if (body.ghi_de !== undefined) {
    const raw = body.ghi_de;
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      dsLoi.push("ghi_de phải là object {khoa: chuoi}.");
    } else {
      const gd: Record<string, string> = {};
      const dsKhoa = Object.keys(raw);
      if (dsKhoa.length > DAI_TOI_DA.ghi_de_so_khoa) {
        dsLoi.push(`ghi_de có tối đa ${DAI_TOI_DA.ghi_de_so_khoa} khóa.`);
      }
      for (const k of dsKhoa) {
        const val = (raw as Record<string, unknown>)[k];
        if (!RE_ID.test(k)) {
          dsLoi.push(`ghi_de khóa '${k}' không hợp lệ (a-z0-9_-, tối đa 64).`);
          continue;
        }
        if (k.length > DAI_TOI_DA.ghi_de_khoa) continue;
        const s = typeof val === "string" ? val : "";
        if (s.length > DAI_TOI_DA.ghi_de_gia_tri) {
          dsLoi.push(`ghi_de['${k}'] vượt ${DAI_TOI_DA.ghi_de_gia_tri} ký tự.`);
        }
        gd[k] = s;
      }
      nhap.ghi_de = gd;
    }
  }
  if (body.ds_nguoi_duyet !== undefined) {
    nhap.ds_nguoi_duyet = kiemTraDsNguoiDuyet(body.ds_nguoi_duyet, dsLoi);
  }
  if (body.bat_buoc_duyet !== undefined) {
    const n =
      body.bat_buoc_duyet === true
        ? 1
        : body.bat_buoc_duyet === false
          ? 0
          : typeof body.bat_buoc_duyet === "number"
            ? body.bat_buoc_duyet
            : NaN;
    if (!Number.isFinite(n) || (n !== 0 && n !== 1)) {
      dsLoi.push("bat_buoc_duyet chỉ nhận 0/1 (hoặc false/true).");
    } else {
      nhap.bat_buoc_duyet = n;
    }
  }
  return dsLoi.length ? undefined : nhap;
}

// --- Nguồn fact tự động: tầng chung của chiến dịch ---

// Chiếu field chung của campaign → một nguon 'fact' xác định: mỗi mục có
// id ổn định 'th-*' để diff revision chỉ đúng mục đổi. Claim chưa có con
// trỏ bằng chứng được đánh dấu CHƯA XÁC NHẬN ngay trong nội dung mục.
export function xayDungNguonThuongHieu(cp: Campaign): {
  tieu_de: string;
  noi_dung: string;
  cac_muc: MucNguon[];
} {
  const chuaXacNhan = (daCoConTro: boolean) =>
    daCoConTro ? "" : " (CHƯA XÁC NHẬN — cần bằng chứng nguồn)";
  const muc: MucNguon[] = [];
  if (cp.thong_diep_loi) {
    muc.push({
      id: "th-thong-diep",
      loai: "fact",
      tieu_de: "Thông điệp lõi",
      noi_dung: cp.thong_diep_loi,
      assets: [],
    });
  }
  if (cp.dinh_vi) {
    muc.push({
      id: "th-dinh-vi",
      loai: "fact",
      tieu_de: "Định vị chiến dịch",
      noi_dung: cp.dinh_vi,
      assets: [],
    });
  }
  if (cp.giong_van) {
    muc.push({
      id: "th-giong-van",
      loai: "fact",
      tieu_de: "Giọng văn thương hiệu",
      noi_dung: cp.giong_van,
      assets: [],
    });
  }
  for (const cl of cp.ds_claim) {
    muc.push({
      id: `th-claim-${cl.id}`,
      loai: "fact",
      tieu_de: `Claim đã duyệt: ${cl.noi_dung.slice(0, 60)}`,
      noi_dung: `${cl.noi_dung}${chuaXacNhan(!!cl.nguon_id)}`,
      assets: [],
    });
  }
  for (const c of cp.cta) {
    muc.push({
      id: `th-cta-${c.id}`,
      loai: "fact",
      tieu_de: `CTA mặc định: ${c.nhan}`,
      noi_dung: `${c.nhan} → ${c.url}`,
      assets: [],
    });
  }
  for (const a of cp.ds_asset_hinh) {
    muc.push({
      id: `th-asset-${a.id}`,
      loai: "fact",
      tieu_de: `Asset hình: ${a.asset_id}`,
      noi_dung: `Asset ${a.asset_id}${a.ghi_chu ? ` — ${a.ghi_chu}` : ""}`,
      assets: [a.asset_id],
    });
  }
  const dong = [
    `Chiến dịch thương hiệu ${cp.ten}.`,
    cp.thong_diep_loi ? `Thông điệp lõi: ${cp.thong_diep_loi}` : "",
    cp.dinh_vi ? `Định vị: ${cp.dinh_vi}` : "",
    cp.giong_van ? `Giọng văn: ${cp.giong_van}` : "",
    ...cp.ds_claim.map(
      (cl) => `Claim: ${cl.noi_dung}${cl.nguon_id ? "" : " [chưa xác nhận]"}`,
    ),
    ...cp.cta.map((c) => `CTA mặc định ${c.nhan}: ${c.url}`),
    ...cp.ds_asset_hinh.map(
      (a) => `Asset ${a.asset_id}${a.ghi_chu ? ` — ${a.ghi_chu}` : ""}`,
    ),
  ].filter(Boolean);
  return {
    tieu_de: `Thương hiệu ${cp.ten} — fact chung`,
    noi_dung: dong.join("\n"),
    cac_muc: muc,
  };
}

// Tạo/cập nhật nguồn chung tự động — giống dongBoNguonCongQuyen: nội
// dung giống head → bỏ qua, khác → revision mới cho caller chạy #14.
export function dongBoNguonThuongHieu(
  db: Database,
  cp: Campaign,
  tacGia: string,
): { nguon: Nguon; da_doi: boolean } {
  const xd = xayDungNguonThuongHieu(cp);
  const taoMoi = (): { nguon: Nguon; da_doi: boolean } => {
    const nguon = taoNguon(
      db,
      { tieu_de: xd.tieu_de, noi_dung: xd.noi_dung, loai: "fact", cac_muc: xd.cac_muc },
      tacGia,
    );
    db.query("UPDATE campaign SET nguon_thuong_hieu_id = ? WHERE id = ?").run(nguon.id, cp.id);
    ghiSuKien(db, "campaign", cp.id, "tao_nguon_thuong_hieu", { nguon_id: nguon.id }, tacGia);
    return { nguon, da_doi: true };
  };
  if (!cp.nguon_thuong_hieu_id) return taoMoi();
  const nguon = layNguon(db, cp.nguon_thuong_hieu_id);
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
    "dong_bo_nguon_thuong_hieu",
    { nguon_id: moi.id, head_revision_id: moi.head_revision_id },
    tacGia,
  );
  return { nguon: moi, da_doi: true };
}

// --- Nguồn fact tự động: tầng thị trường ---

const NHAN_KHA_DUNG: Record<string, string> = {
  co_hang: "Còn hàng",
  het_hang: "Hết hàng",
  dat_truoc: "Đặt trước",
};
export function nhanKhaDung(kd: string): string {
  return NHAN_KHA_DUNG[kd] ?? kd;
}

// Chiếu field thị trường → nguon 'fact' riêng của thị trường, mục id
// 'tt-<ma>-*'. Giá/tiền tệ và mọi ghi đè giữ nguyên văn giá trị được
// cung cấp — không quy đổi, không suy diễn.
export function xayDungNguonThiTruong(
  cp: Campaign,
  tt: ThiTruong,
): { tieu_de: string; noi_dung: string; cac_muc: MucNguon[] } {
  const muc: MucNguon[] = [];
  const ma = tt.ma || "xx";
  muc.push({
    id: `tt-${ma}-ngon-ngu`,
    loai: "fact",
    tieu_de: "Ngôn ngữ đầu ra",
    noi_dung: tt.ngon_ngu,
    assets: [],
  });
  if (tt.gia) {
    muc.push({
      id: `tt-${ma}-gia`,
      loai: "fact",
      tieu_de: "Giá đã cung cấp",
      noi_dung: `Giá: ${tt.gia} ${tt.tien_te}`.trim(),
      assets: [],
    });
  }
  if (tt.kha_dung) {
    muc.push({
      id: `tt-${ma}-kha-dung`,
      loai: "fact",
      tieu_de: "Tình trạng khả dụng",
      noi_dung: nhanKhaDung(tt.kha_dung),
      assets: [],
    });
  }
  if (tt.landing_page) {
    muc.push({
      id: `tt-${ma}-landing`,
      loai: "fact",
      tieu_de: "Landing page thị trường",
      noi_dung: tt.landing_page,
      assets: [],
    });
  }
  if (tt.cta_nhan || tt.cta_url) {
    muc.push({
      id: `tt-${ma}-cta`,
      loai: "fact",
      tieu_de: "CTA thị trường",
      noi_dung: `${tt.cta_nhan}${tt.cta_url ? ` → ${tt.cta_url}` : ""}`,
      assets: [],
    });
  }
  for (const ct of tt.ds_chi_tiet) {
    muc.push({
      id: `tt-${ma}-ct-${ct.doi_tuong_id}`,
      loai: "fact",
      tieu_de: `Chi tiết đối tượng ${ct.doi_tuong_id}`,
      noi_dung: ct.chi_tiet,
      assets: [],
    });
  }
  for (const [khoa, giaTri] of Object.entries(tt.ghi_de)) {
    muc.push({
      id: `tt-${ma}-gd-${khoa}`,
      loai: "fact",
      tieu_de: `Ghi đè: ${khoa}`,
      noi_dung: giaTri,
      assets: [],
    });
  }
  const dong = [
    `Thị trường ${tt.ten} (${tt.ma}) của chiến dịch ${cp.ten}.`,
    `Ngôn ngữ đầu ra: ${tt.ngon_ngu}`,
    tt.gia ? `Giá: ${tt.gia} ${tt.tien_te}`.trim() : "Giá: chưa cung cấp",
    tt.kha_dung ? `Khả dụng: ${nhanKhaDung(tt.kha_dung)}` : "Khả dụng: chưa cung cấp",
    tt.landing_page ? `Landing page: ${tt.landing_page}` : "",
    tt.cta_nhan || tt.cta_url ? `CTA: ${tt.cta_nhan} → ${tt.cta_url}` : "",
    ...tt.ds_chi_tiet.map((ct) => `Chi tiết ${ct.doi_tuong_id}: ${ct.chi_tiet}`),
    ...Object.entries(tt.ghi_de).map(([k, v]) => `Ghi đè ${k}: ${v}`),
  ].filter(Boolean);
  return {
    tieu_de: `Thị trường ${tt.ten} — ${cp.ten}`,
    noi_dung: dong.join("\n"),
    cac_muc: muc,
  };
}

// Tạo/cập nhật nguồn fact của thị trường — giống dongBoNguonThuongHieu:
// giống head → bỏ qua; khác → revision mới để caller chạy #14 (chỉ vô
// hiệu hóa biến thể của đúng thị trường này).
export function dongBoNguonThiTruong(
  db: Database,
  cp: Campaign,
  tt: ThiTruong,
  tacGia: string,
): { nguon: Nguon; da_doi: boolean } {
  const xd = xayDungNguonThiTruong(cp, tt);
  const taoMoi = (): { nguon: Nguon; da_doi: boolean } => {
    const nguon = taoNguon(
      db,
      { tieu_de: xd.tieu_de, noi_dung: xd.noi_dung, loai: "fact", cac_muc: xd.cac_muc },
      tacGia,
    );
    ganNguonThiTruong(db, tt.id, nguon.id);
    ghiSuKien(
      db,
      "thi_truong",
      tt.id,
      "tao_nguon_thi_truong",
      { nguon_id: nguon.id, campaign_id: cp.id },
      tacGia,
    );
    return { nguon, da_doi: true };
  };
  if (!tt.nguon_id) return taoMoi();
  const nguon = layNguon(db, tt.nguon_id);
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
    "thi_truong",
    tt.id,
    "dong_bo_nguon_thi_truong",
    { nguon_id: moi.id, head_revision_id: moi.head_revision_id },
    tacGia,
  );
  return { nguon: moi, da_doi: true };
}

// --- Thông điệp riêng của thị trường ---

function dsNguonIdsCuaThongDiep(db: Database, thongDiepId: string): string[] {
  return (
    db
      .query("SELECT nguon_id FROM thong_diep_nguon WHERE thong_diep_id = ?")
      .all(thongDiepId) as { nguon_id: string }[]
  ).map((r) => r.nguon_id);
}

// Nguồn phải link vào thông điệp của thị trường: nguồn fact chung của
// chiến dịch + nguồn fact thị trường + nguồn bằng chứng của từng claim +
// tham chiếu đã gán. Pin nguồn thị trường ở đây là cái phân phạm vi
// ảnh hưởng của #14: sửa fact thị trường khác không đụng thị trường này.
function dsNguonBatBuocThiTruong(db: Database, cp: Campaign, tt: ThiTruong): string[] {
  const ds: string[] = [];
  const them = (id: string | null | undefined) => {
    if (id && !ds.includes(id) && layNguon(db, id)) ds.push(id);
  };
  them(cp.nguon_thuong_hieu_id);
  them(tt.nguon_id);
  for (const t of cp.tham_chieu) them(t.nguon_id);
  for (const cl of cp.ds_claim) them(cl.nguon_id);
  return ds;
}

// Lấy hoặc tạo thông điệp của thị trường — giống damBaoThongDiepCongQuyen:
// union link nguồn mới + refresh revision ghim head mới của nguồn. Khi
// nguồn chung đổi, caller gọi hàm này cho MỌI thị trường để repin.
export function damBaoThongDiepThiTruong(
  db: Database,
  cp: Campaign,
  tt: ThiTruong,
  tacGia: string,
): ThongDiep {
  return txn(db, () => {
    const cpMoi = layCampaign(db, cp.id)!; // đọc lại sau khi gán nguồn tự động
    const ttMoi = layThiTruong(db, tt.id)!; // đọc lại sau khi gán nguon_id
    const batBuoc = dsNguonBatBuocThiTruong(db, cpMoi, ttMoi);
    const cu = ttMoi.thong_diep_id ? layThongDiep(db, ttMoi.thong_diep_id) : null;
    const tieuDe = `${cpMoi.ten} — ${ttMoi.ten}`;
    if (!cu) {
      const td = taoThongDiep(
        db,
        {
          tieu_de: tieuDe,
          noi_dung:
            `${cpMoi.mo_ta || `Chiến dịch ${cpMoi.ten}`}\n` +
            `Thị trường: ${ttMoi.ten} (${ttMoi.ma}) — ngôn ngữ ${ttMoi.ngon_ngu}.`,
          campaign_id: cpMoi.id,
          nguon_ids: batBuoc,
        },
        tacGia,
      );
      ganThongDiepThiTruong(db, ttMoi.id, td.id);
      ghiSuKien(
        db,
        "thi_truong",
        ttMoi.id,
        "tao_thong_diep_thi_truong",
        { thong_diep_id: td.id, campaign_id: cpMoi.id },
        tacGia,
      );
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
      { tieu_de: cu.tieu_de, noi_dung: cu.noi_dung, campaign_id: cpMoi.id, nguon_ids: union },
      cu.head_revision_id ?? "",
      tacGia,
    );
  });
}

// Đồng bộ toàn bộ sau khi field chiến dịch đổi: nguồn chung trước (để
// caller quyết phat_hien), rồi repin thông điệp của mọi thị trường.
export function damBaoMoiThongDiepThiTruong(
  db: Database,
  cp: Campaign,
  tacGia: string,
): void {
  for (const tt of danhSachThiTruong(db, cp.id)) {
    damBaoThongDiepThiTruong(db, cp, tt, tacGia);
  }
}

// Tạo/cập nhật một thị trường kèm cặp nguồn fact + thông điệp riêng.
// Trả { thi_truong, da_doi } — da_doi = nguồn fact thị trường có revision
// mới (caller chạy phatHienThayDoiNguon để #14 đánh dấu biến thể phụ
// thuộc của đúng thị trường này).
export function dongBoThiTruong(
  db: Database,
  cp: Campaign,
  nhap: NhapThiTruong,
  tacGia: string,
  ttCu?: ThiTruong,
): { thi_truong: ThiTruong; da_doi: boolean } {
  return txn(db, () => {
    const tt = ttCu
      ? capNhatThiTruong(db, ttCu.id, nhap, tacGia)
      : taoThiTruong(db, cp.id, nhap, tacGia);
    const sync = dongBoNguonThiTruong(db, cp, tt, tacGia);
    damBaoThongDiepThiTruong(db, cp, layThiTruong(db, tt.id)!, tacGia);
    return { thi_truong: layThiTruong(db, tt.id)!, da_doi: sync.da_doi };
  });
}

// --- Fact thiếu + chọn tổ hợp ---

// Fact bắt buộc của một thị trường trước khi sinh đầu ra: giá đã cung
// cấp (kèm tiền tệ) và tình trạng khả dụng. Thiếu → 'chưa đủ', chặn tổ
// hợp cần fact đó (bi_chan) thay vì để đầu ra bịa giá.
export function factThieuThiTruong(tt: ThiTruong): string[] {
  const ds: string[] = [];
  if (!tt.gia) ds.push("gia");
  if (!tt.kha_dung) ds.push("kha_dung");
  return ds;
}

export type ChonToHop = {
  thi_truong_id: string;
  dinh_dang: string;
  doi_tuong_id?: string | null;
  dich_den?: string;
};

// Kết quả một tổ hợp sau chọn (hoặc trạng thái dự kiến trong xem trước):
// 'san_sang' tổ hợp hợp lệ sẽ sinh; 'da_sinh' job đã enqueue; 'da_co'
// bản thể hiện đã có sẵn (vẫn enqueue lại để sinh lại); 'bi_chan' thị
// trường chưa đủ fact — không tạo gì.
export type KetQuaToHop = {
  thi_truong_id: string;
  thi_truong_ma: string;
  dinh_dang: string;
  ngon_ngu: string;
  doi_tuong_id: string | null;
  doi_tuong: string;
  dich_den: string;
  trang_thai: "san_sang" | "da_sinh" | "da_co" | "bi_chan";
  ban_the_hien_id: string | null;
  job_id: string | null;
  da_tao: boolean;
  fact_thieu: string[];
};

// Validate + chuẩn hóa một tổ hợp đã chọn. Lỗi cứng (id sai, định dạng
// sai, ngôn ngữ không hỗ trợ) gom vào dsLoi → request lỗi 400 một lần;
// fact thiếu KHÔNG nằm ở đây — đó là chặn mềm per-tổ-hợp.
function docChonToHop(
  db: Database,
  cp: Campaign,
  raw: unknown,
  i: number,
  dsLoi: string[],
): { tt: ThiTruong; dinh_dang: string; doi_tuong_id: string | null; doi_tuong: string; dich_den: string } | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    dsLoi.push(`ds_chon[${i}] phải là object.`);
    return null;
  }
  const c = raw as Record<string, unknown>;
  const ttId = tuyChonChuoi(c.thi_truong_id);
  const tt = ttId ? layThiTruong(db, ttId) : null;
  if (!ttId) dsLoi.push(`ds_chon[${i}].thi_truong_id bắt buộc.`);
  else if (!tt) dsLoi.push(`ds_chon[${i}].thi_truong_id '${ttId}' không tồn tại.`);
  else if (tt.campaign_id !== cp.id) {
    dsLoi.push(`ds_chon[${i}].thi_truong_id '${ttId}' không thuộc chiến dịch này.`);
    return null;
  }
  const dinhDang = tuyChonChuoi(c.dinh_dang);
  const def = dinhDang ? layDinhDang(dinhDang) : null;
  if (!dinhDang) dsLoi.push(`ds_chon[${i}].dinh_dang bắt buộc.`);
  else if (!def) dsLoi.push(`ds_chon[${i}].dinh_dang '${dinhDang}' không tồn tại trong registry.`);
  // Ngôn ngữ đầu ra = ngôn ngữ thị trường — định dạng phải hỗ trợ nó.
  if (tt && def) {
    const loiNg = kiemTraNgonNgu(def, tt.ngon_ngu);
    if (loiNg) dsLoi.push(`ds_chon[${i}]: ${loiNg}`);
  }
  let doiTuongId: string | null = null;
  let doiTuongTen = "";
  if (c.doi_tuong_id !== undefined && c.doi_tuong_id !== null && c.doi_tuong_id !== "") {
    doiTuongId = tuyChonChuoi(c.doi_tuong_id);
    const dt = layDoiTuong(db, doiTuongId);
    if (!dt) dsLoi.push(`ds_chon[${i}].doi_tuong_id '${doiTuongId}' không tồn tại.`);
    else doiTuongTen = dt.ten;
  }
  const dichDen = tuyChonChuoi(c.dich_den);
  if (dichDen.length > 120) {
    dsLoi.push(`ds_chon[${i}].dich_den quá dài (tối đa 120 ký tự).`);
  }
  if (!tt || !def) return null;
  return { tt, dinh_dang: dinhDang, doi_tuong_id: doiTuongId, doi_tuong: doiTuongTen, dich_den: dichDen };
}

// Xem trước quy mô một lô tổ hợp: trạng thái từng tổ hợp (san_sang /
// da_co / bi_chan / lỗi) + ước tính chi phí CHỈ khi pricing provider
// được cấu hình thật — không đoán giá. Token ước tính từ độ dài context
// thật: ~(ký tự nguồn chung + nguồn thị trường + thông điệp)/4 vào và
// gioi_han_dau_ra ký tự/4 ra — đánh dấu là ước lượng.
export function xemTruocToHop(
  db: Database,
  cp: Campaign,
  dsChonRaw: unknown,
  tuyChon: { toiDa: number; giaMoi1kVao: number | null; giaMoi1kRa: number | null },
): { ds_ket_qua: KetQuaToHop[]; so_luong: number; uoc_tinh: unknown } {
  if (!laThuongHieu(cp)) {
    throw new LoiApi(400, "VALIDATION", "Chỉ campaign loai 'thuong_hieu' mới có tổ hợp thị trường.");
  }
  if (!Array.isArray(dsChonRaw) || dsChonRaw.length === 0) {
    throw new LoiApi(400, "VALIDATION", "ds_chon phải là mảng object tổ hợp không rỗng.");
  }
  if (dsChonRaw.length > tuyChon.toiDa) {
    throw new LoiApi(
      400,
      "VALIDATION",
      `ds_chon có ${dsChonRaw.length} tổ hợp, vượt giới hạn cấu hình ${tuyChon.toiDa} mỗi request.`,
    );
  }
  const dsLoi: string[] = [];
  const daCo = new Set<string>();
  const dsChuan: { tt: ThiTruong; dinh_dang: string; doi_tuong_id: string | null; doi_tuong: string; dich_den: string }[] = [];
  for (const [i, raw] of dsChonRaw.entries()) {
    const chuan = docChonToHop(db, cp, raw, i, dsLoi);
    if (!chuan) continue;
    const khoa = `${chuan.tt.id}|${chuan.dinh_dang}|${chuan.doi_tuong_id ?? ""}|${chuan.dich_den}`;
    if (daCo.has(khoa)) {
      dsLoi.push(`ds_chon[${i}] trùng với một tổ hợp khác sau chuẩn hóa.`);
      continue;
    }
    daCo.add(khoa);
    dsChuan.push(chuan);
  }
  if (dsLoi.length) {
    throw new LoiApi(400, "VALIDATION", "ds_chon không hợp lệ.", dsLoi);
  }
  const dsKetQua: KetQuaToHop[] = dsChuan.map((chuan) => {
    const thieu = factThieuThiTruong(chuan.tt);
    const td = chuan.tt.thong_diep_id ? layThongDiep(db, chuan.tt.thong_diep_id) : null;
    const cu = td
      ? timBanTheHien(db, {
          thong_diep_id: td.id,
          dinh_dang: chuan.dinh_dang,
          ngon_ngu: chuan.tt.ngon_ngu,
          doi_tuong: chuan.doi_tuong,
          dich_den: chuan.dich_den,
        })
      : null;
    return {
      thi_truong_id: chuan.tt.id,
      thi_truong_ma: chuan.tt.ma,
      dinh_dang: chuan.dinh_dang,
      ngon_ngu: chuan.tt.ngon_ngu,
      doi_tuong_id: chuan.doi_tuong_id,
      doi_tuong: chuan.doi_tuong,
      dich_den: chuan.dich_den,
      trang_thai: thieu.length ? "bi_chan" : cu ? "da_co" : "san_sang",
      ban_the_hien_id: cu?.id ?? null,
      job_id: null,
      da_tao: false,
      fact_thieu: thieu,
    };
  });
  // Ước tính chi phí chỉ khi cấu hình pricing thật (file mai.config.json
  // — không có biến env mặc định); bộ fixture không báo token nên mốc
  // này chỉ dành cho provider có giá.
  let uocTinh: unknown = null;
  if (tuyChon.giaMoi1kVao != null && tuyChon.giaMoi1kRa != null) {
    const soSinh = dsKetQua.filter((k) => k.trang_thai !== "bi_chan").length;
    const kyTuVao =
      (cp.nguon_thuong_hieu_id ? (layNguon(db, cp.nguon_thuong_hieu_id)?.noi_dung.length ?? 0) : 0) +
      (cp.mo_ta.length + cp.thong_diep_loi.length + cp.dinh_vi.length + cp.giong_van.length);
    const kyTuTb =
      dsKetQua.length > 0
        ? dsKetQua.reduce((s, k) => {
            const tt = layThiTruong(db, k.thi_truong_id);
            const ng = tt?.nguon_id ? layNguon(db, tt.nguon_id) : null;
            return s + (ng?.noi_dung.length ?? 0);
          }, 0) / Math.max(dsKetQua.length, 1)
        : 0;
    const tokenVaoMot = Math.ceil((kyTuVao + kyTuTb) / 4);
    const tokenRaMot = 600; // ước lượng thô mỗi biến thể — POC
    const tongVao = tokenVaoMot * soSinh;
    const tongRa = tokenRaMot * soSinh;
    uocTinh = {
      la_uoc_luong: true,
      so_bien_the: soSinh,
      token_vao_uoc_tinh: tongVao,
      token_ra_uoc_tinh: tongRa,
      chi_phi_uoc_tinh_usd:
        Math.round(
          ((tongVao / 1000) * tuyChon.giaMoi1kVao + (tongRa / 1000) * tuyChon.giaMoi1kRa) * 1e6,
        ) / 1e6,
    };
  }
  return { ds_ket_qua: dsKetQua, so_luong: dsKetQua.length, uoc_tinh: uocTinh };
}

// Chọn tổ hợp đã xác nhận → tạo/tìm bản thể hiện dưới thông điệp riêng
// của thị trường + enqueue job sinh (ghim head + khoa_idem như luồng
// chọn của #5). Tổ hợp của thị trường chưa đủ fact → 'bi_chan', không
// tạo gì; các tổ hợp hợp lệ vẫn sinh bình thường.
export function chonToHop(
  db: Database,
  cp: Campaign,
  dsChonRaw: unknown,
  tacGia: string,
  toiDa: number,
): { ds_ket_qua: KetQuaToHop[] } {
  if (!laThuongHieu(cp)) {
    throw new LoiApi(400, "VALIDATION", "Chỉ campaign loai 'thuong_hieu' mới có tổ hợp thị trường.");
  }
  if (!Array.isArray(dsChonRaw) || dsChonRaw.length === 0) {
    throw new LoiApi(400, "VALIDATION", "ds_chon phải là mảng object tổ hợp không rỗng.");
  }
  if (dsChonRaw.length > toiDa) {
    throw new LoiApi(
      400,
      "VALIDATION",
      `ds_chon có ${dsChonRaw.length} tổ hợp, vượt giới hạn cấu hình ${toiDa} mỗi request.`,
    );
  }
  const dsLoi: string[] = [];
  const daCo = new Set<string>();
  const dsChuan: { tt: ThiTruong; dinh_dang: string; doi_tuong_id: string | null; doi_tuong: string; dich_den: string }[] = [];
  for (const [i, raw] of dsChonRaw.entries()) {
    const chuan = docChonToHop(db, cp, raw, i, dsLoi);
    if (!chuan) continue;
    const khoa = `${chuan.tt.id}|${chuan.dinh_dang}|${chuan.doi_tuong_id ?? ""}|${chuan.dich_den}`;
    if (daCo.has(khoa)) {
      dsLoi.push(`ds_chon[${i}] trùng với một tổ hợp khác sau chuẩn hóa.`);
      continue;
    }
    daCo.add(khoa);
    dsChuan.push(chuan);
  }
  if (dsLoi.length) {
    throw new LoiApi(400, "VALIDATION", "ds_chon không hợp lệ.", dsLoi);
  }
  return txn(db, () => ({
    ds_ket_qua: dsChuan.map((chuan) => {
      const thieu = factThieuThiTruong(chuan.tt);
      if (thieu.length) {
        return {
          thi_truong_id: chuan.tt.id,
          thi_truong_ma: chuan.tt.ma,
          dinh_dang: chuan.dinh_dang,
          ngon_ngu: chuan.tt.ngon_ngu,
          doi_tuong_id: chuan.doi_tuong_id,
          doi_tuong: chuan.doi_tuong,
          dich_den: chuan.dich_den,
          trang_thai: "bi_chan" as const,
          ban_the_hien_id: null,
          job_id: null,
          da_tao: false,
          fact_thieu: thieu,
        };
      }
      // Thông điệp riêng của thị trường: link nguồn chung + nguồn thị
      // trường + bằng chứng claim — mọi biến thể pin thông điệp này.
      const td = damBaoThongDiepThiTruong(db, cp, chuan.tt, tacGia);
      const khoa = {
        thong_diep_id: td.id,
        dinh_dang: chuan.dinh_dang,
        ngon_ngu: chuan.tt.ngon_ngu,
        doi_tuong: chuan.doi_tuong,
        dich_den: chuan.dich_den,
      };
      const bth = timBanTheHien(db, khoa) ?? taoBanTheHien(db, khoa, tacGia);
      const { job, da_tao } = enqueueJob(db, {
        loai: "sinh_ban_the_hien",
        payload: {
          ban_the_hien_id: bth.id,
          thong_diep_id: td.id,
          campaign_id: cp.id,
          thi_truong_id: chuan.tt.id,
          dinh_dang: chuan.dinh_dang,
          ngon_ngu: chuan.tt.ngon_ngu,
          doi_tuong: chuan.doi_tuong,
          doi_tuong_id: chuan.doi_tuong_id ?? "",
          thuong_hieu_id: cp.thuong_hieu_id ?? "",
          dich_den: chuan.dich_den,
        },
        entityLoai: "ban_the_hien",
        entityId: bth.id,
        // Ghim head lúc chọn — handler kiểm lại khi commit (#21).
        revisionId: bth.head_revision_id ?? null,
        khoaIdem: `sinh_ban_the_hien:${bth.id}`,
      });
      return {
        thi_truong_id: chuan.tt.id,
        thi_truong_ma: chuan.tt.ma,
        dinh_dang: chuan.dinh_dang,
        ngon_ngu: chuan.tt.ngon_ngu,
        doi_tuong_id: chuan.doi_tuong_id,
        doi_tuong: chuan.doi_tuong,
        dich_den: chuan.dich_den,
        trang_thai: da_tao ? ("da_sinh" as const) : ("da_co" as const),
        ban_the_hien_id: bth.id,
        job_id: job.id,
        da_tao,
        fact_thieu: [],
      };
    }),
  }));
}

// --- Duyệt hàng loạt ---

export type ChonDuyet = {
  ban_the_hien_id: string;
  nguoi_duyet_id?: string | null;
  mong_doi_revision_id?: string | null;
  ghi_chu?: string;
};

export type KetQuaDuyet = {
  ban_the_hien_id: string;
  thi_truong_ma: string;
  ok: boolean;
  loi?: string;
};

// Kiểm cổng duyệt của thị trường một bản thể hiện — dùng lại bởi cả
// route trang_thai lẻ và duyệt hàng loạt: reviewer phải nằm trong
// ds_nguoi_duyet của thị trường, bat_buoc_duyet=1 bắt buộc ghi, và đầu
// ra đang ghim nguồn cũ không được duyệt (phải có revision mới trước).
export function kiemTraCongDuyetThiTruong(
  db: Database,
  bth: BanTheHien,
  nguoiDuyetId: string,
): { tt: ThiTruong | null } {
  const tt = layThiTruongTheoThongDiep(db, bth.thong_diep_id);
  if (!tt) return { tt: null };
  if (nguoiDuyetId && !tt.ds_nguoi_duyet.some((x) => x.id === nguoiDuyetId)) {
    throw new LoiApi(
      400,
      "VALIDATION",
      `nguoi_duyet_id '${nguoiDuyetId}' không có trong ds_nguoi_duyet của thị trường '${tt.ten}'.`,
    );
  }
  if (laCuTheoNguon(db, bth)) {
    throw new LoiApi(
      409,
      "XUNG_DOT_REVISION",
      "Đầu ra đang ghim revision nguồn cũ — phải sinh/duyệt revision thay thế ghim fact mới trước khi duyệt.",
    );
  }
  if (tt.bat_buoc_duyet === 1 && !nguoiDuyetId) {
    throw new LoiApi(
      400,
      "VALIDATION",
      `Thị trường '${tt.ten}' bật bat_buoc_duyet: duyệt phải ghi nguoi_duyet_id của reviewer local.`,
    );
  }
  return { tt };
}

// Duyệt hàng loạt biến thể đã chọn: mỗi mục vẫn ghim đúng revision head
// và reviewer local của thị trường sở hữu — lỗi một mục không chặn các
// mục khác (kết quả per-item), nhưng mọi lỗi trước-ghi (thiếu trường,
// bth không thuộc chiến dịch) gom thành một 400.
export function duyetNhieu(
  db: Database,
  cp: Campaign,
  dsRaw: unknown,
  tacGia: string,
): { ds_ket_qua: KetQuaDuyet[] } {
  if (!laThuongHieu(cp)) {
    throw new LoiApi(400, "VALIDATION", "Chỉ campaign loai 'thuong_hieu' mới duyệt hàng loạt theo thị trường.");
  }
  if (!Array.isArray(dsRaw) || dsRaw.length === 0) {
    throw new LoiApi(400, "VALIDATION", "ds phải là mảng object duyệt không rỗng.");
  }
  const dsLoi: string[] = [];
  const dsChuan: { bth: BanTheHien; nguoiDuyetId: string; mongDoi: string | null; ghiChu: string }[] = [];
  const daCo = new Set<string>();
  for (const [i, raw] of dsRaw.entries()) {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      dsLoi.push(`ds[${i}] phải là object.`);
      continue;
    }
    const d = raw as Record<string, unknown>;
    const bthId = tuyChonChuoi(d.ban_the_hien_id);
    const bth = bthId ? layBanTheHien(db, bthId) : null;
    if (!bthId) {
      dsLoi.push(`ds[${i}].ban_the_hien_id bắt buộc.`);
      continue;
    }
    if (!bth) {
      dsLoi.push(`ds[${i}].ban_the_hien_id '${bthId}' không tồn tại.`);
      continue;
    }
    const td = layThongDiep(db, bth.thong_diep_id);
    const tt = layThiTruongTheoThongDiep(db, bth.thong_diep_id);
    if (!td || td.campaign_id !== cp.id || !tt) {
      dsLoi.push(`ds[${i}].ban_the_hien_id '${bthId}' không phải biến thể của chiến dịch này.`);
      continue;
    }
    if (daCo.has(bth.id)) {
      dsLoi.push(`ds[${i}].ban_the_hien_id '${bthId}' trùng với mục khác.`);
      continue;
    }
    daCo.add(bth.id);
    const nguoiDuyetId = tuyChonChuoi(d.nguoi_duyet_id);
    if (nguoiDuyetId && !tt.ds_nguoi_duyet.some((x) => x.id === nguoiDuyetId)) {
      dsLoi.push(
        `ds[${i}].nguoi_duyet_id '${nguoiDuyetId}' không có trong ds_nguoi_duyet của thị trường '${tt.ten}'.`,
      );
      continue;
    }
    if (tt.bat_buoc_duyet === 1 && !nguoiDuyetId) {
      dsLoi.push(
        `ds[${i}]: thị trường '${tt.ten}' bật bat_buoc_duyet — phải ghi nguoi_duyet_id.`,
      );
      continue;
    }
    const mongDoi = tuyChonChuoi(d.mong_doi_revision_id) || null;
    const ghiChu = tuyChonChuoi(d.ghi_chu);
    dsChuan.push({ bth, nguoiDuyetId, mongDoi, ghiChu });
  }
  if (dsLoi.length) {
    throw new LoiApi(400, "VALIDATION", "ds duyệt không hợp lệ.", dsLoi);
  }
  const dsKetQua: KetQuaDuyet[] = [];
  for (const muc of dsChuan) {
    const tt = layThiTruongTheoThongDiep(db, muc.bth.thong_diep_id);
    try {
      const sau = chuyenTrangThai(
        db,
        muc.bth.id,
        "da_duyet",
        muc.ghiChu || "duyệt hàng loạt",
        tacGia,
        // mong_doi_revision_id vắng → ghim head hiện tại (duyệt hàng loạt
        // đọc head lúc duyệt); có → phải khớp head hay 409 như duyệt lẻ.
        muc.mongDoi ?? muc.bth.head_revision_id ?? undefined,
        muc.nguoiDuyetId || undefined,
      );
      dsKetQua.push({
        ban_the_hien_id: sau.id,
        thi_truong_ma: tt?.ma ?? "",
        ok: sau.trang_thai === "da_duyet",
        loi: sau.trang_thai === "da_duyet" ? undefined : `trạng thái còn '${sau.trang_thai}'`,
      });
    } catch (e) {
      dsKetQua.push({
        ban_the_hien_id: muc.bth.id,
        thi_truong_ma: tt?.ma ?? "",
        ok: false,
        loi: e instanceof LoiApi ? `${e.ma}: ${e.message}` : String(e),
      });
    }
  }
  return { ds_ket_qua: dsKetQua };
}

// --- Đề xuất tổ hợp + gợi ý ---

export type ToHopDeXuat = {
  id: string;
  thi_truong_id: string;
  thi_truong_ma: string;
  dinh_dang: string;
  doi_tuong_id: string | null;
  doi_tuong: string;
  dich_den: string;
  ly_do: string;
};

// Đề xuất tổ hợp gợi ý (không sinh): mỗi thị trường đủ fact × đối tượng
// có chi tiết được cung cấp (hoặc đối tượng chính của chiến dịch) × hai
// định dạng phổ biến. Người dùng tick chọn trên UI — chỉ tổ hợp đã chọn
// mới đi vào chonToHop, không sinh tích Descartes tự động.
export function deXuatToHopThuongHieu(db: Database, cp: Campaign): ToHopDeXuat[] {
  const ds: ToHopDeXuat[] = [];
  const DINH_DANG_GOI_Y = ["bai-viet", "caption"];
  for (const tt of danhSachThiTruong(db, cp.id)) {
    const thieu = factThieuThiTruong(tt);
    const dsDt: { id: string | null; ten: string }[] = tt.ds_chi_tiet.length
      ? tt.ds_chi_tiet.map((ct) => ({
          id: ct.doi_tuong_id,
          ten: layDoiTuong(db, ct.doi_tuong_id)?.ten ?? ct.doi_tuong_id,
        }))
      : cp.doi_tuong_id
        ? [{ id: cp.doi_tuong_id, ten: layDoiTuong(db, cp.doi_tuong_id)?.ten ?? cp.doi_tuong_id }]
        : danhSachDoiTuong(db).slice(0, 2).map((d) => ({ id: d.id, ten: d.ten }));
    for (const dt of dsDt) {
      for (const dd of DINH_DANG_GOI_Y) {
        ds.push({
          id: `dx-${tt.ma}-${dt.id ?? "chung"}-${dd}`,
          thi_truong_id: tt.id,
          thi_truong_ma: tt.ma,
          dinh_dang: dd,
          doi_tuong_id: dt.id,
          doi_tuong: dt.ten,
          dich_den: "",
          ly_do: thieu.length
            ? `Thị trường ${tt.ten} chưa đủ fact (${thieu.join(", ")}) — tổ hợp sẽ bị chặn.`
            : `Đối tượng '${dt.ten}' trên thị trường ${tt.ten} — ${dd === "bai-viet" ? "bài dài cho site/blog" : "caption mạng xã hội"}.`,
        });
      }
    }
  }
  return ds;
}

export type GoiYThuongHieu = {
  id: string;
  loai:
    | "claim_chua_xac_nhan"
    | "thi_truong_chua_du"
    | "thieu_thong_diep"
    | "thieu_giong_van"
    | "thieu_cta"
    | "thieu_nguoi_duyet"
    | "thieu_thi_truong";
  tieu_de: string;
  ly_do: string;
  bang_chung: string[];
};

// Gợi ý của chiến dịch thương hiệu — tính lại mỗi lần đọc:
// - claim chưa có bằng chứng nguồn (đầu ra sẽ phải để [CÂU HỎI]);
// - thị trường thiếu giá/khả dụng (chặn mọi tổ hợp của nó);
// - chiến dịch thiếu thông điệp lõi / giọng văn / CTA mặc định;
// - thị trường bật bat_buoc_duyet mà chưa ghi reviewer local;
// - chưa có thị trường nào.
export function goiYThuongHieu(db: Database, cp: Campaign): GoiYThuongHieu[] {
  const ds: GoiYThuongHieu[] = [];
  for (const cl of docDsClaimView(db, cp)) {
    if (cl.co_bang_chung) continue;
    ds.push({
      id: `goi-y-claim-${cl.id}`,
      loai: "claim_chua_xac_nhan",
      tieu_de: `Claim '${cl.noi_dung.slice(0, 60)}' chưa có bằng chứng nguồn`,
      ly_do: "Claim chưa trỏ nguồn/mục đã nạp — đầu ra nhắc nó sẽ phải để [CÂU HỎI] thay vì trình bày như claim đã duyệt. Gán nguon_id + muc_id.",
      bang_chung: [`claim_id: ${cl.id}`],
    });
  }
  const dsTt = danhSachThiTruong(db, cp.id);
  for (const tt of dsTt) {
    const thieu = factThieuThiTruong(tt);
    if (thieu.length) {
      ds.push({
        id: `goi-y-tt-thieu-${tt.ma}`,
        loai: "thi_truong_chua_du",
        tieu_de: `Thị trường '${tt.ten}' chưa đủ fact (${thieu.join(", ")})`,
        ly_do: "Thiếu giá hoặc tình trạng khả dụng — mọi tổ hợp của thị trường này bị chặn cho tới khi đội local cung cấp. Điền gia + tien_te + kha_dung.",
        bang_chung: [`ma: ${tt.ma}`, `thieu: ${thieu.join(", ")}`],
      });
    }
    if (tt.bat_buoc_duyet === 1 && tt.ds_nguoi_duyet.length === 0) {
      ds.push({
        id: `goi-y-tt-duyet-${tt.ma}`,
        loai: "thieu_nguoi_duyet",
        tieu_de: `Thị trường '${tt.ten}' bắt buộc reviewer nhưng chưa ghi ai`,
        ly_do: "bat_buoc_duyet=1 sẽ chặn mọi lượt duyệt của thị trường này. Thêm id + ten + vai_tro vào ds_nguoi_duyet.",
        bang_chung: [`ma: ${tt.ma}`],
      });
    }
  }
  if (dsTt.length === 0) {
    ds.push({
      id: "goi-y-thi-truong",
      loai: "thieu_thi_truong",
      tieu_de: "Chưa có thị trường nào",
      ly_do: "Chiến dịch thương hiệu cần ít nhất một thị trường để đặt ghi đè local và sinh biến thể.",
      bang_chung: [],
    });
  }
  if (!cp.thong_diep_loi) {
    ds.push({
      id: "goi-y-thong-diep",
      loai: "thieu_thong_diep",
      tieu_de: "Chưa đặt thông điệp lõi",
      ly_do: "Thông điệp lõi đã duyệt là fact chung mọi thị trường dùng — đầu ra không có câu trụ cột. Đặt thong_diep_loi.",
      bang_chung: [],
    });
  }
  if (!cp.giong_van) {
    ds.push({
      id: "goi-y-giong-van",
      loai: "thieu_giong_van",
      tieu_de: "Chưa đặt giọng văn thương hiệu",
      ly_do: "Giọng văn giữ nhất quán giữa thị trường — đặt giong_van (vd 'ngắn, trực tiếp, không hứa hiệu năng').",
      bang_chung: [],
    });
  }
  if (cp.cta.length === 0) {
    ds.push({
      id: "goi-y-cta",
      loai: "thieu_cta",
      tieu_de: "Chưa có CTA mặc định",
      ly_do: "Thị trường không ghi đè CTA sẽ kế thừa CTA mặc định — thêm ít nhất một cta {nhan, url}.",
      bang_chung: [],
    });
  }
  return ds;
}

// --- View phái sinh cho API/UI ---

export type ClaimView = ClaimThuongHieu & {
  co_bang_chung: boolean;
  nguon: { id: string; tieu_de: string } | null;
  muc: { id: string; tieu_de: string } | null;
};

export type AssetHinhView = AssetHinh & {
  asset: { id: string; ten_file: string; mime: string } | null;
};

// Một biến thể trên ma trận: trạng thái review + cờ cũ theo nguồn +
// revision chung mà head đang ghim + reviewer local của lần duyệt gần
// nhất + task sửa đang mở (ngoại lệ).
export type BienTheView = {
  ban_the_hien_id: string;
  dinh_dang: string;
  doi_tuong: string;
  ngon_ngu: string;
  dich_den: string;
  trang_thai: string;
  la_cu: boolean;
  head_revision_id: string | null;
  revision_nguon_chung: { id: string; so_thu_tu: number } | null;
  nguoi_duyet_cuoi: { id: string; ten: string } | null;
  ds_task_mo: string[];
  job_len_lich_id: string | null;
  da_xuat: boolean;
};

// Một thị trường trong ma trận: fact thiếu (chưa đủ), ngoại lệ = ghi đè
// local đang bật, và danh sách biến thể của nó.
export type ThiTruongView = ThiTruong & {
  fact_thieu: string[];
  chua_du: boolean;
  ngoai_le: string[];
  ds_bien_the: BienTheView[];
};

export type ThuongHieuView = {
  nguon_thuong_hieu: { id: string; tieu_de: string; head_revision_id: string | null } | null;
  ds_claim_view: ClaimView[];
  ds_asset_hinh_view: AssetHinhView[];
  ds_thi_truong: ThiTruongView[];
  de_xuat_to_hop: ToHopDeXuat[];
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

export function docDsClaimView(db: Database, cp: Campaign): ClaimView[] {
  return cp.ds_claim.map((t) => ({ ...t, ...docViewBangChung(db, t.nguon_id, t.muc_id) }));
}

export function docDsAssetHinhView(db: Database, cp: Campaign): AssetHinhView[] {
  return cp.ds_asset_hinh.map((a) => {
    const asset = a.asset_id ? layAsset(db, a.asset_id) : null;
    return {
      ...a,
      asset: asset ? { id: asset.id, ten_file: asset.ten_file, mime: asset.mime } : null,
    };
  });
}

// Ghi đè local đang bật → ngoại lệ hiển thị trên ma trận (tường minh,
// không lẫn với fact chung).
function ngoaiLeThiTruong(tt: ThiTruong): string[] {
  const ds: string[] = [];
  if (tt.cta_nhan || tt.cta_url) ds.push("CTA local ghi đè CTA chung");
  if (tt.landing_page) ds.push("landing page local");
  for (const ct of tt.ds_chi_tiet) ds.push(`chi tiết cho ${ct.doi_tuong_id}`);
  for (const k of Object.keys(tt.ghi_de)) ds.push(`ghi đè '${k}'`);
  if (tt.bat_buoc_duyet === 1) ds.push("bắt buộc reviewer local");
  return ds;
}

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

function docBienTheThiTruong(db: Database, cp: Campaign, tt: ThiTruong): BienTheView[] {
  if (!tt.thong_diep_id) return [];
  const dsBth = danhSachBanTheHien(db, { thongDiepId: tt.thong_diep_id });
  const tenNguoiDuyet = (id: string) =>
    tt.ds_nguoi_duyet.find((x) => x.id === id)?.ten ?? id;
  return dsBth.map((bth) => {
    const headRev = bth.head_revision_id ? layRevision(db, bth.head_revision_id) : null;
    const tdRev = headRev?.thong_diep_revision_id
      ? layThongDiepRevision(db, headRev.thong_diep_revision_id)
      : null;
    // Revision của nguồn fact CHUNG mà head đang ghim — provenance chứng
    // minh biến thể nói về đúng bản claim đã duyệt.
    const nguonChungRev = (tdRev?.nguon_revision_ids ?? [])
      .map((id) => layNguonRevision(db, id))
      .find((n) => n !== null && n.nguon_id === cp.nguon_thuong_hieu_id);
    const duyetCuoi = (
      db
        .query(
          "SELECT nguoi_duyet_id FROM duyet WHERE ban_the_hien_id = ? AND den_trang_thai = 'da_duyet' ORDER BY tao_luc DESC LIMIT 1",
        )
        .get(bth.id) as { nguoi_duyet_id: string } | null
    )?.nguoi_duyet_id;
    const dsTask = danhSachTaskSua(db, {
      banTheHienId: bth.id,
      trangThai: ["mo", "dang_lam"],
    });
    const jobLenLich = timJobLenLich(db, bth.id);
    return {
      ban_the_hien_id: bth.id,
      dinh_dang: bth.dinh_dang,
      doi_tuong: bth.doi_tuong,
      ngon_ngu: bth.ngon_ngu,
      dich_den: bth.dich_den,
      trang_thai: bth.trang_thai,
      la_cu: laCuTheoNguon(db, bth),
      head_revision_id: bth.head_revision_id,
      revision_nguon_chung: nguonChungRev
        ? { id: nguonChungRev.id, so_thu_tu: nguonChungRev.so_thu_tu }
        : null,
      nguoi_duyet_cuoi: duyetCuoi ? { id: duyetCuoi, ten: tenNguoiDuyet(duyetCuoi) } : null,
      ds_task_mo: dsTask.map((t) => t.id),
      job_len_lich_id: jobLenLich?.id ?? null,
      da_xuat: danhSachXuatBan(db, bth.id).length > 0,
    };
  });
}

export function docThuongHieuView(db: Database, cp: Campaign): ThuongHieuView | null {
  if (!laThuongHieu(cp)) return null;
  const nguonTh = cp.nguon_thuong_hieu_id ? layNguon(db, cp.nguon_thuong_hieu_id) : null;
  return {
    nguon_thuong_hieu: nguonTh
      ? { id: nguonTh.id, tieu_de: nguonTh.tieu_de, head_revision_id: nguonTh.head_revision_id }
      : null,
    ds_claim_view: docDsClaimView(db, cp),
    ds_asset_hinh_view: docDsAssetHinhView(db, cp),
    ds_thi_truong: danhSachThiTruong(db, cp.id).map((tt) => {
      const thieu = factThieuThiTruong(tt);
      return {
        ...tt,
        fact_thieu: thieu,
        chua_du: thieu.length > 0,
        ngoai_le: ngoaiLeThiTruong(tt),
        ds_bien_the: docBienTheThiTruong(db, cp, tt),
      };
    }),
    de_xuat_to_hop: deXuatToHopThuongHieu(db, cp),
  };
}
