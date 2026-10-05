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
// để hai hệ thống ngoài trùng số id không đụng nhau. Trả "" khi không
// hợp lệ — lỗi cụ thể đã được chuanBiDinhDanh gom trước đó.
export function chuanHoaGiaTri(loai: LoaiDinhDanh, giaTri: string, nguon: string): string {
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
      return `${nguon.trim().toLowerCase()}:${v.toLowerCase()}`;
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
  const giaTriChuan = chuanHoaGiaTri(loai as LoaiDinhDanh, giaTri, nguon);
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
  const dsDd = (nhap.dinh_danh ?? []).map((d) => chuanBiDinhDanh(d, dsLoi));
  nemLoiValidation(dsLoi);
  return txn(db, () => {
    const khach = chenKhach(db, nhap, actor);
    const dinhDanh = dsDd.map((d) => chenDinhDanh(db, khach.id, d!));
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
  const dsDd = dinhDanh.map((d) => chuanBiDinhDanh(d, dsLoi));
  nemLoiValidation(dsLoi);
  return txn(db, () => {
    const daCo = dsDd
      .map((d) => timDinhDanh(db, d!.loai, d!.gia_tri_chuan))
      .filter((d): d is DinhDanh => d !== null);
    if (daCo.length > 0) {
      const khachId = daCo[0]!.khach_id;
      const trungKhac = daCo.find((d) => d.khach_id !== khachId);
      if (trungKhac) {
        // Hai identity thuộc hai person khác nhau → xung đột tường minh.
        throw new LoiApi(409, "XUNG_DOT_DINH_DANH", "Các identity thuộc nhiều khách hàng khác nhau.", {
          khach_id: [khachId, trungKhac.khach_id],
        });
      }
      const moi = dsDd.filter(
        (d) => !timDinhDanh(db, d!.loai, d!.gia_tri_chuan),
      );
      for (const d of moi) chenDinhDanh(db, khachId, d!);
      chamKhach(db, khachId);
      const khach = layKhach(db, khachId)!;
      return { khach, dinh_danh: danhSachDinhDanh(db, khachId), da_tao: false };
    }
    const khach = chenKhach(db, nhap, actor);
    const tao = dsDd.map((d) => chenDinhDanh(db, khach.id, d!));
    return { khach, dinh_danh: tao, da_tao: true };
  });
}

// Gắn identity mới vào person đã có. Đụng unique của person khác → 409.
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
    if (timDinhDanh(db, dd!.loai, dd!.gia_tri_chuan)) xungDotDinhDanh(db, dd!);
    const row = chenDinhDanh(db, khachId, dd!);
    chamKhach(db, khachId);
    ghiSuKien(db, "khach", khachId, "gan_dinh_danh", { loai: row.loai }, actor);
    return row;
  });
}

// --- Sự kiện tương tác (ticket #61) ---
// Event bất biến theo person: timestamp, loai, nguon (provenance bắt
// buộc), tham chiếu lỏng tới entity MAI, khoa_idem chặn delivery lặp.
// `loai` là registry — mở rộng schema bằng giá trị mới, không redesign.

export const DANH_SACH_LOAI_TUONG_TAC = [
  "xem",
  "click",
  "dang_ky",
  "mo",
  "click_mail",
  "mua",
  "huy_dang_ky",
  "bo_gio_hang",
  "nhap_ngoai",
] as const;
export type LoaiTuongTac = (typeof DANH_SACH_LOAI_TUONG_TAC)[number];

export type TuongTac = {
  id: string;
  khach_id: string;
  loai: LoaiTuongTac;
  nguon: string;
  xay_ra_luc: string;
  ban_the_hien_id: string;
  campaign_id: string;
  link_dich_id: string;
  giao_hang_id: string;
  don_hang_ngoai_id: string;
  khoa_idem: string;
  chi_tiet: string;
  tao_luc: string;
};

export type NhapSuKien = {
  khach_id: string;
  loai: string;
  nguon: string;
  xay_ra_luc?: string;
  khoa_idem: string;
  ban_the_hien_id?: string;
  campaign_id?: string;
  link_dich_id?: string;
  giao_hang_id?: string;
  don_hang_ngoai_id?: string;
  chi_tiet?: Record<string, unknown>;
};

// Ghi một event. khoa_idem đã có → trả event cũ (da_tao=false), không
// nhân — INSERT OR IGNORE để hai request đồng thời không ném UNIQUE.
// xay_ra_luc sai định dạng → 400; rỗng → thời điểm ghi.
export function ghiTuongTac(
  db: Database,
  nhap: NhapSuKien,
): { su_kien: TuongTac; da_tao: boolean } {
  const dsLoi: string[] = [];
  if (!(DANH_SACH_LOAI_TUONG_TAC as readonly string[]).includes(nhap.loai)) {
    dsLoi.push(`loai không hợp lệ. Cho phép: ${DANH_SACH_LOAI_TUONG_TAC.join(", ")}.`);
  }
  const nguon = tuyChonChuoi(nhap.nguon);
  if (!nguon) dsLoi.push("nguon là bắt buộc (provenance của event).");
  const khoaIdem = tuyChonChuoi(nhap.khoa_idem);
  if (!khoaIdem) dsLoi.push("khoa_idem là bắt buộc (khử trùng delivery lặp).");
  let xayRaLuc = tuyChonChuoi(nhap.xay_ra_luc);
  if (xayRaLuc) {
    const t = Date.parse(xayRaLuc);
    if (!Number.isFinite(t)) {
      dsLoi.push("xay_ra_luc không phải thời điểm hợp lệ (ISO 8601).");
      xayRaLuc = "";
    } else {
      xayRaLuc = new Date(t).toISOString();
    }
  }
  nemLoiValidation(dsLoi);
  if (!xayRaLuc) xayRaLuc = bayGio();
  const id = crypto.randomUUID();
  const kq = db
    .query(
      `INSERT OR IGNORE INTO tuong_tac
       (id, khach_id, loai, nguon, xay_ra_luc, ban_the_hien_id, campaign_id,
        link_dich_id, giao_hang_id, don_hang_ngoai_id, khoa_idem, chi_tiet, tao_luc)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      nhap.khach_id,
      nhap.loai,
      nguon,
      xayRaLuc,
      tuyChonChuoi(nhap.ban_the_hien_id),
      tuyChonChuoi(nhap.campaign_id),
      tuyChonChuoi(nhap.link_dich_id),
      tuyChonChuoi(nhap.giao_hang_id),
      tuyChonChuoi(nhap.don_hang_ngoai_id),
      khoaIdem,
      JSON.stringify(nhap.chi_tiet ?? {}),
      bayGio(),
    );
  if (kq.changes === 0) {
    const cu = db
      .query("SELECT * FROM tuong_tac WHERE khoa_idem = ?")
      .get(khoaIdem) as TuongTac;
    return { su_kien: cu, da_tao: false };
  }
  chamKhach(db, nhap.khach_id, xayRaLuc);
  return {
    su_kien: db.query("SELECT * FROM tuong_tac WHERE id = ?").get(id) as TuongTac,
    da_tao: true,
  };
}

// Timeline theo person: sắp xếp thời gian tăng dần (id làm tie-break),
// lọc theo khung tu/den và loai. chi_tiet trả JSON đã parse cho client.
export function timelineKhach(
  db: Database,
  khachId: string,
  loc: { tu?: string; den?: string; loai?: string; gioiHan?: number } = {},
): TuongTac[] {
  const dieuKien = ["khach_id = ?"];
  const thamSo: string[] = [khachId];
  if (loc.tu) {
    dieuKien.push("xay_ra_luc >= ?");
    thamSo.push(loc.tu);
  }
  if (loc.den) {
    dieuKien.push("xay_ra_luc <= ?");
    thamSo.push(loc.den);
  }
  if (loc.loai) {
    dieuKien.push("loai = ?");
    thamSo.push(loc.loai);
  }
  return db
    .query(
      `SELECT * FROM tuong_tac WHERE ${dieuKien.join(" AND ")}
       ORDER BY xay_ra_luc, id LIMIT ?`,
    )
    .all(...thamSo, loc.gioiHan ?? 500) as TuongTac[];
}

// --- Visitor nặc danh (cookie mai_v) ---
// Trang public (/p/, /l/, /huy-dang-ky) đặt/giữ cookie mai_v: visitor
// chưa định danh vẫn là person trong graph — khi identity email gắn vào
// (subscribe, form, import) timeline liền nhau một người. Cookie kín
// giác (HttpOnly), sống ~1 năm, khóa khử trùng person-event theo khung
// 30 phút như su_kien_do — bridge ghi person-event chỉ khi first-party
// đếm được sự kiện (không phải bot, không trùng fingerprint).

export const TEN_COOKIE_VISITOR = "mai_v";
const KHUNG_DEDUPE_TT_MS = 30 * 60 * 1000;

export function docVisitorId(req: Request): string {
  const cookie = req.headers.get("cookie") ?? "";
  const m = new RegExp(`(?:^|;\\s*)${TEN_COOKIE_VISITOR}=([a-z0-9-]+)`, "i").exec(cookie);
  return m?.[1] ?? "";
}

export function datCookieVisitor(visitorId: string): string {
  return `${TEN_COOKIE_VISITOR}=${visitorId}; Path=/; Max-Age=31536000; SameSite=Lax; HttpOnly`;
}

// Bridge first-party → person graph. visitorId là khóa nặc danh: person
// tự tạo khi chưa có identity. loai 'xem'|'click'; refs từ đối tượng đo.
export function ghiTuongTacVisitor(
  db: Database,
  nhap: {
    visitor_id: string;
    loai: "xem" | "click";
    ban_the_hien_id?: string;
    campaign_id?: string;
    link_dich_id?: string;
    chi_tiet?: Record<string, unknown>;
  },
): { khach_id: string; da_tao: boolean } {
  const kq = resolveKhach(
    db,
    [{ loai: "visitor", gia_tri: nhap.visitor_id, nguon: "web" }],
    {},
    "web",
  );
  const refId =
    nhap.link_dich_id ?? nhap.ban_the_hien_id ?? nhap.campaign_id ?? "trang";
  const khung = Math.floor(Date.now() / KHUNG_DEDUPE_TT_MS);
  const sk = ghiTuongTac(db, {
    khach_id: kq.khach.id,
    loai: nhap.loai,
    nguon: "web",
    khoa_idem: `vt:${nhap.loai}:${refId}:${nhap.visitor_id}:${khung}`,
    ban_the_hien_id: nhap.ban_the_hien_id,
    campaign_id: nhap.campaign_id,
    link_dich_id: nhap.link_dich_id,
    chi_tiet: nhap.chi_tiet,
  });
  return { khach_id: kq.khach.id, da_tao: sk.da_tao };
}
