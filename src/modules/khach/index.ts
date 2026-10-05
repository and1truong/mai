// Đồ thị khách hàng (#59, ticket #60): person hợp nhất + nhiều identity.
//
// Phạm vi: MAI sở hữu graph lõi Person → Identity → (Interaction,
// Consent, Segment, Conversion ở các ticket sau). Một person có nhiều
// identity (email, sdt, visitor nặc danh, external commerce, social);
// unique (loai, gia_tri_chuan) là rule xung đột tường minh — đụng unique
// khi gắn vào person khác → 409 XUNG_DOT_DINH_DANH, không auto-merge
// theo heuristic yếu. Merge có kiểm soát là ticket riêng.

import type { Database } from "bun:sqlite";
import { LoiApi, nemLoiValidation, tuyChonChuoi } from "../../loi.ts";
import { ghiSuKien, txn } from "../content/index.ts";

const bayGio = () => new Date().toISOString();

export const DANH_SACH_LOAI_DINH_DANH = [
  "email",
  "sdt",
  "visitor",
  "external",
  "social",
] as const;
export type LoaiDinhDanh = (typeof DANH_SACH_LOAI_DINH_DANH)[number];

export const DANH_SACH_TRANG_THAI_KHACH = ["hoat_dong", "da_gop"] as const;
export type TrangThaiKhach = (typeof DANH_SACH_TRANG_THAI_KHACH)[number];

export type Khach = {
  id: string;
  ten: string;
  email: string;
  sdt: string;
  trang_thai: TrangThaiKhach;
  lan_dau_thay: string;
  lan_cuoi_thay: string;
  tao_luc: string;
  tao_boi: string;
};

export type DinhDanh = {
  id: string;
  khach_id: string;
  loai: LoaiDinhDanh;
  gia_tri_chuan: string;
  gia_tri_goc: string;
  nguon: string;
  external_id: string;
  tao_luc: string;
};

// Input một identity từ API/test. `loai` validate theo registry trên;
// `nguon` là provenance bắt buộc cho 'external'/'social' (và nên có ở
// mọi loai — mặc định 'tay' khi người dùng nhập qua API).
export type NhapDinhDanh = {
  loai: string;
  gia_tri: string;
  nguon?: string;
  external_id?: string;
};

export type NhapKhach = {
  ten?: string;
  email?: string;
  sdt?: string;
  dinh_danh?: NhapDinhDanh[];
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Chuẩn hóa giá trị identity theo loại — cùng người nhập khác dạng phải
// ra cùng gia_tri_chuan. external/social khóa theo '<nguon>:<external_id>'
// (thiếu external_id thì dùng gia_tri) để hai hệ thống ngoài trùng số id
// không đụng nhau, còn cùng id ngoài thì dù gia_tri hiển thị khác vẫn về
// một person. Trả "" khi không hợp lệ — lỗi cụ thể đã được
// chuanBiDinhDanh gom trước đó.
export function chuanHoaGiaTri(
  loai: LoaiDinhDanh,
  giaTri: string,
  nguon: string,
  externalId = "",
): string {
  const v = giaTri.trim();
  switch (loai) {
    case "email":
      return v.toLowerCase();
    case "sdt":
      return v.replace(/[^\d+]/g, "").replace(/(?!^)\+/g, "");
    case "visitor":
      return v;
    case "external":
    case "social":
      return `${nguon.trim().toLowerCase()}:${(externalId.trim() || v).toLowerCase()}`;
  }
}

// Validate + chuẩn hóa input identity. Push lỗi vào dsLoi; trả null khi
// có lỗi (caller gom hết rồi nemLoiValidation một lần).
export function chuanBiDinhDanh(nhap: NhapDinhDanh, dsLoi: string[]): DinhDanh | null {
  const loai = tuyChonChuoi(nhap.loai);
  if (!(DANH_SACH_LOAI_DINH_DANH as readonly string[]).includes(loai)) {
    dsLoi.push(`dinh_danh.loai không hợp lệ. Cho phép: ${DANH_SACH_LOAI_DINH_DANH.join(", ")}.`);
    return null;
  }
  const giaTri = tuyChonChuoi(nhap.gia_tri);
  if (!giaTri) {
    dsLoi.push("dinh_danh.gia_tri là bắt buộc.");
    return null;
  }
  const nguon = tuyChonChuoi(nhap.nguon) || "tay";
  const externalId = tuyChonChuoi(nhap.external_id);
  if (loai === "email" && !EMAIL_RE.test(giaTri)) {
    dsLoi.push("dinh_danh.gia_tri không phải email hợp lệ.");
    return null;
  }
  if (loai === "sdt") {
    const chuan = chuanHoaGiaTri("sdt", giaTri, nguon);
    if (chuan.replace(/^\+/, "").length < 7) {
      dsLoi.push("dinh_danh.gia_tri không phải số điện thoại hợp lệ.");
      return null;
    }
  }
  if ((loai === "external" || loai === "social") && !tuyChonChuoi(nhap.nguon)) {
    // external/social cần nguon tường minh: '<nguon>:<id>' là khóa unique —
    // thiếu nguon mất provenance và có thể đụng id của hệ thống khác.
    dsLoi.push(`dinh_danh.nguon là bắt buộc với loai '${loai}'.`);
    return null;
  }
  const giaTriChuan = chuanHoaGiaTri(loai as LoaiDinhDanh, giaTri, nguon, externalId);
  if (!giaTriChuan) {
    dsLoi.push("dinh_danh.gia_tri không chuẩn hóa được.");
    return null;
  }
  return {
    id: "",
    khach_id: "",
    loai: loai as LoaiDinhDanh,
    gia_tri_chuan: giaTriChuan,
    gia_tri_goc: giaTri,
    nguon,
    external_id: externalId || (loai === "external" || loai === "social" ? giaTri : ""),
    tao_luc: "",
  };
}

// Gộp identity trùng khóa trong cùng một request — trùng trong input là
// một identity, không phải xung đột (tránh UNIQUE thô → 500).
function dedupeDinhDanh(ds: (DinhDanh | null)[]): DinhDanh[] {
  const seen = new Set<string>();
  const ra: DinhDanh[] = [];
  for (const d of ds) {
    if (!d) continue;
    const k = `${d.loai}:${d.gia_tri_chuan}`;
    if (seen.has(k)) continue;
    seen.add(k);
    ra.push(d);
  }
  return ra;
}

// --- Truy vấn ---

export function layKhach(db: Database, id: string): Khach | null {
  return db.query("SELECT * FROM khach WHERE id = ?").get(id) as Khach | null;
}

export function danhSachKhach(db: Database, gioiHan = 200): Khach[] {
  return db
    .query("SELECT * FROM khach ORDER BY lan_cuoi_thay DESC LIMIT ?")
    .all(gioiHan) as Khach[];
}

export function danhSachDinhDanh(db: Database, khachId: string): DinhDanh[] {
  return db
    .query("SELECT * FROM dinh_danh WHERE khach_id = ? ORDER BY tao_luc, id")
    .all(khachId) as DinhDanh[];
}

export function timDinhDanh(
  db: Database,
  loai: LoaiDinhDanh,
  giaTriChuan: string,
): DinhDanh | null {
  return db
    .query("SELECT * FROM dinh_danh WHERE loai = ? AND gia_tri_chuan = ?")
    .get(loai, giaTriChuan) as DinhDanh | null;
}

function chenDinhDanh(db: Database, khachId: string, dd: DinhDanh): DinhDanh {
  const row: DinhDanh = {
    ...dd,
    id: crypto.randomUUID(),
    khach_id: khachId,
    tao_luc: bayGio(),
  };
  db.query(
    `INSERT INTO dinh_danh (id, khach_id, loai, gia_tri_chuan, gia_tri_goc, nguon, external_id, tao_luc)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    row.id,
    row.khach_id,
    row.loai,
    row.gia_tri_chuan,
    row.gia_tri_goc,
    row.nguon,
    row.external_id,
    row.tao_luc,
  );
  return row;
}

// Đụng unique identity → 409 tường minh kèm person đang giữ identity đó —
// caller/UI quyết có merge không, MAI không tự gộp.
function xungDotDinhDanh(db: Database, dd: DinhDanh): never {
  const giu = timDinhDanh(db, dd.loai, dd.gia_tri_chuan);
  throw new LoiApi(409, "XUNG_DOT_DINH_DANH", "Identity đã thuộc một khách hàng khác.", {
    loai: dd.loai,
    gia_tri_chuan: dd.gia_tri_chuan,
    khach_id: giu?.khach_id ?? "",
  });
}

// Nhiều identity trong một request rải trên nhiều person → 409 kèm
// danh sách person liên quan (khach_ids — số nhiều, khác field
// khach_id số ít của xungDotDinhDanh).
function xungDotNhieuKhach(khachIds: string[]): never {
  throw new LoiApi(409, "XUNG_DOT_DINH_DANH", "Các identity thuộc nhiều khách hàng khác nhau.", {
    khach_ids: khachIds,
  });
}

// Person được nhìn thấy (tạo, gắn identity, tương tác mới ở ticket sau):
// chỉ kéo lan_cuoi_thay về gần nhất, không lùi.
export function chamKhach(db: Database, khachId: string, luc = bayGio()): void {
  db.query("UPDATE khach SET lan_cuoi_thay = MAX(lan_cuoi_thay, ?) WHERE id = ?").run(
    luc,
    khachId,
  );
}

function chenKhach(db: Database, nhap: NhapKhach, actor: string): Khach {
  const luc = bayGio();
  const row: Khach = {
    id: crypto.randomUUID(),
    ten: tuyChonChuoi(nhap.ten),
    email: tuyChonChuoi(nhap.email),
    sdt: tuyChonChuoi(nhap.sdt),
    trang_thai: "hoat_dong",
    lan_dau_thay: luc,
    lan_cuoi_thay: luc,
    tao_luc: luc,
    tao_boi: actor,
  };
  db.query(
    `INSERT INTO khach (id, ten, email, sdt, trang_thai, lan_dau_thay, lan_cuoi_thay, tao_luc, tao_boi)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    row.id,
    row.ten,
    row.email,
    row.sdt,
    row.trang_thai,
    row.lan_dau_thay,
    row.lan_cuoi_thay,
    row.tao_luc,
    row.tao_boi,
  );
  ghiSuKien(db, "khach", row.id, "tao", { ten: row.ten, email: row.email }, actor);
  return row;
}

// Tạo person mới kèm các identity đầu tiên. Đụng unique của person khác
// → 409 (resolve qua resolveKhach khi muốn tìm-hoặc-tạo).
export function taoKhach(
  db: Database,
  nhap: NhapKhach,
  actor: string,
): { khach: Khach; dinh_danh: DinhDanh[] } {
  const dsLoi: string[] = [];
  const dsDd = dedupeDinhDanh((nhap.dinh_danh ?? []).map((d) => chuanBiDinhDanh(d, dsLoi)));
  nemLoiValidation(dsLoi);
  return txn(db, () => {
    const khach = chenKhach(db, nhap, actor);
    const dinhDanh = dsDd.map((d) => {
      if (timDinhDanh(db, d.loai, d.gia_tri_chuan)) xungDotDinhDanh(db, d);
      return chenDinhDanh(db, khach.id, d);
    });
    return { khach, dinh_danh: dinhDanh };
  });
}

// Tìm-hoặc-tạo: identity đã có → trả person giữ nó (da_tao=false, không
// ghi gì); chưa có → tạo person mới + identity. Nhiều identity cùng lúc
// mà một cái đụng person khác → 409, không tách nửa.
export function resolveKhach(
  db: Database,
  dinhDanh: NhapDinhDanh[],
  nhap: NhapKhach,
  actor: string,
): { khach: Khach; dinh_danh: DinhDanh[]; da_tao: boolean } {
  const dsLoi: string[] = [];
  const dsDd = dedupeDinhDanh(dinhDanh.map((d) => chuanBiDinhDanh(d, dsLoi)));
  nemLoiValidation(dsLoi);
  return txn(db, () => {
    const daCo = dsDd
      .map((d) => timDinhDanh(db, d.loai, d.gia_tri_chuan))
      .filter((d): d is DinhDanh => d !== null);
    if (daCo.length > 0) {
      const khachId = daCo[0]!.khach_id;
      const trungKhac = daCo.find((d) => d.khach_id !== khachId);
      // Hai identity thuộc hai person khác nhau → xung đột tường minh.
      if (trungKhac) xungDotNhieuKhach([khachId, trungKhac.khach_id]);
      const moi = dsDd.filter(
        (d) => !timDinhDanh(db, d.loai, d.gia_tri_chuan),
      );
      for (const d of moi) chenDinhDanh(db, khachId, d);
      chamKhach(db, khachId);
      const khach = layKhach(db, khachId)!;
      return { khach, dinh_danh: danhSachDinhDanh(db, khachId), da_tao: false };
    }
    const khach = chenKhach(db, nhap, actor);
    const tao = dsDd.map((d) => chenDinhDanh(db, khach.id, d));
    return { khach, dinh_danh: tao, da_tao: true };
  });
}

// Gắn identity mới vào person đã có. Đụng unique của person khác → 409;
// identity đã thuộc chính person đích → trả row cũ (idempotent no-op).
export function ganDinhDanh(
  db: Database,
  khachId: string,
  nhap: NhapDinhDanh,
  actor: string,
): DinhDanh {
  const dsLoi: string[] = [];
  const dd = chuanBiDinhDanh(nhap, dsLoi);
  nemLoiValidation(dsLoi);
  return txn(db, () => {
    const khach = layKhach(db, khachId);
    if (!khach || khach.trang_thai !== "hoat_dong") {
      throw new LoiApi(404, "KHONG_TIM_THAY", "Không tìm thấy khách hàng.");
    }
    const trung = timDinhDanh(db, dd!.loai, dd!.gia_tri_chuan);
    if (trung) {
      if (trung.khach_id === khachId) return trung;
      xungDotDinhDanh(db, dd!);
    }
    const row = chenDinhDanh(db, khachId, dd!);
    chamKhach(db, khachId);
    ghiSuKien(db, "khach", khachId, "gan_dinh_danh", { loai: row.loai }, actor);
    return row;
  });
}
