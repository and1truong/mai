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
      // Giữ nguyên case phần id — id ngoài là opaque của hệ thống nguồn,
      // không phải địa chỉ; lowercase nó sẽ merge ngầm hai id khác case
      // (trái "không auto-merge theo heuristic yếu").
      return `${nguon.trim().toLowerCase()}:${externalId.trim() || v}`;
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
      // Gom toàn bộ chủ sở hữu — identity rải trên ≥2 person → xung đột
      // kèm khach_ids đủ để client quyết merge.
      const ids = [...new Set(daCo.map((d) => d.khach_id))];
      if (ids.length > 1) xungDotNhieuKhach(ids);
      const khachId = ids[0]!;
      const moi = dsDd.filter(
        (d) => !timDinhDanh(db, d.loai, d.gia_tri_chuan),
      );
      for (const d of moi) {
        chenDinhDanh(db, khachId, d);
        ghiSuKien(db, "khach", khachId, "gan_dinh_danh", {
          loai: d.loai,
          gia_tri_chuan: d.gia_tri_chuan,
          qua: "resolve",
        }, actor);
      }
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
  const moi = db.query("SELECT * FROM tuong_tac WHERE id = ?").get(id) as TuongTac;
  chamDauTien(db, moi);
  chamKhach(db, nhap.khach_id, xayRaLuc);
  return { su_kien: moi, da_tao: true };
}

// Timeline theo person: sắp xếp thời gian tăng dần (rowid làm tie-break
// giữ thứ tự insert khi timestamp trùng), lọc theo khung tu/den và loai.
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
       ORDER BY xay_ra_luc, rowid LIMIT ?`,
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

// --- Consent theo kênh + mục đích (ticket #62) ---
// dong_y = trạng thái hiện tại (unique khach/kenh/muc_dich — upsert);
// dong_y_log = mọi chuyển trạng thái một dòng, không ghi đè → lịch sử
// auditable. marketing/giao_dich là hai muc_dich riêng: rút marketing
// không ảnh hưởng transactional.

export const DANH_SACH_KENH_DONG_Y = ["email", "sms", "web", "zalo"] as const;
export type KenhDongY = (typeof DANH_SACH_KENH_DONG_Y)[number];
export const DANH_SACH_MUC_DICH = ["marketing", "giao_dich"] as const;
export type MucDich = (typeof DANH_SACH_MUC_DICH)[number];
export const DANH_SACH_TRANG_THAI_DONG_Y = ["cho", "tu_choi"] as const;
export type TrangThaiDongY = (typeof DANH_SACH_TRANG_THAI_DONG_Y)[number];

export type DongY = {
  id: string;
  khach_id: string;
  kenh: KenhDongY;
  muc_dich: MucDich;
  trang_thai: TrangThaiDongY;
  nguon: string;
  cap_nhat_luc: string;
};

export type DongYLog = {
  id: string;
  khach_id: string;
  kenh: KenhDongY;
  muc_dich: MucDich;
  tu_trang_thai: string; // '' = lần khẳng định đầu tiên
  sang_trang_thai: TrangThaiDongY;
  nguon: string;
  luc: string;
};

export type NhapDongY = {
  kenh: string;
  muc_dich: string;
  trang_thai: string;
  nguon: string;
};

export function layDongY(
  db: Database,
  khachId: string,
  kenh: string,
  mucDich: string,
): DongY | null {
  return db
    .query("SELECT * FROM dong_y WHERE khach_id = ? AND kenh = ? AND muc_dich = ?")
    .get(khachId, kenh, mucDich) as DongY | null;
}

// Đặt trạng thái consent một ô (kenh, muc_dich). Ghi log chỉ khi có
// chuyển trạng thái thật (lần đầu, hoặc sang != từ) — khẳng định lại
// cùng trạng thái là no-op idempotent, không đẩy rác vào lịch sử.
export function datDongY(
  db: Database,
  khachId: string,
  nhap: NhapDongY,
  luc = bayGio(),
): { dong_y: DongY; da_ghi_log: boolean } {
  const dsLoi: string[] = [];
  if (!(DANH_SACH_KENH_DONG_Y as readonly string[]).includes(nhap.kenh)) {
    dsLoi.push(`kenh không hợp lệ. Cho phép: ${DANH_SACH_KENH_DONG_Y.join(", ")}.`);
  }
  if (!(DANH_SACH_MUC_DICH as readonly string[]).includes(nhap.muc_dich)) {
    dsLoi.push(`muc_dich không hợp lệ. Cho phép: ${DANH_SACH_MUC_DICH.join(", ")}.`);
  }
  if (!(DANH_SACH_TRANG_THAI_DONG_Y as readonly string[]).includes(nhap.trang_thai)) {
    dsLoi.push(`trang_thai không hợp lệ. Cho phép: ${DANH_SACH_TRANG_THAI_DONG_Y.join(", ")}.`);
  }
  const nguon = tuyChonChuoi(nhap.nguon);
  if (!nguon) dsLoi.push("nguon là bắt buộc (provenance của consent).");
  nemLoiValidation(dsLoi);
  return txn(db, () => {
    const cu = layDongY(db, khachId, nhap.kenh, nhap.muc_dich);
    const daDoi = !cu || cu.trang_thai !== nhap.trang_thai;
    if (!daDoi && cu) return { dong_y: cu, da_ghi_log: false };
    db.query(
      `INSERT INTO dong_y (id, khach_id, kenh, muc_dich, trang_thai, nguon, cap_nhat_luc)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (khach_id, kenh, muc_dich)
       DO UPDATE SET trang_thai = excluded.trang_thai, nguon = excluded.nguon,
                     cap_nhat_luc = excluded.cap_nhat_luc`,
    ).run(
      cu?.id ?? crypto.randomUUID(),
      khachId,
      nhap.kenh,
      nhap.muc_dich,
      nhap.trang_thai,
      nguon,
      luc,
    );
    db.query(
      `INSERT INTO dong_y_log (id, khach_id, kenh, muc_dich, tu_trang_thai, sang_trang_thai, nguon, luc)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      crypto.randomUUID(),
      khachId,
      nhap.kenh,
      nhap.muc_dich,
      cu?.trang_thai ?? "",
      nhap.trang_thai,
      nguon,
      luc,
    );
    ghiSuKien(db, "khach", khachId, "dat_dong_y", {
      kenh: nhap.kenh,
      muc_dich: nhap.muc_dich,
      sang: nhap.trang_thai,
      nguon,
    }, nguon);
    const moi = layDongY(db, khachId, nhap.kenh, nhap.muc_dich)!;
    return { dong_y: moi, da_ghi_log: true };
  });
}

// Consent hiện tại + toàn bộ lịch sử của một person.
export function docDongY(
  db: Database,
  khachId: string,
): { hien_tai: DongY[]; lich_su: DongYLog[] } {
  return {
    hien_tai: db
      .query("SELECT * FROM dong_y WHERE khach_id = ? ORDER BY kenh, muc_dich")
      .all(khachId) as DongY[],
    lich_su: db
      .query("SELECT * FROM dong_y_log WHERE khach_id = ? ORDER BY luc, rowid")
      .all(khachId) as DongYLog[],
  };
}

// Điểm kiểm duy nhất trước khi gửi communication — #68 resolve audience
// đọc qua đây; consent mới nhất có hiệu lực ngay.
export function consentChoGui(
  db: Database,
  khachId: string,
  kenh: string,
  mucDich: MucDich,
): boolean {
  return layDongY(db, khachId, kenh, mucDich)?.trang_thai === "cho";
}

// Bridge với danh bạ nguoi_nhan (#13): subscribe → person (identity
// email) + consent email/marketing=cho + event dang_ky; hủy → tu_choi +
// event huy_dang_ky. Suppression nguoi_nhan vẫn là chặn cứng ở delivery
// boundary — consent là lớp audit phía person, không thay nó. Gọi trong
// txn của caller, chỉ khi transition nguoi_nhan xảy ra thật (da_tao /
// da_huy) — khoa_idem theo email nên retry/double-call không nhân event.
export function dongBoNguoiNhan(
  db: Database,
  nhap: {
    email: string;
    ten?: string;
    huong: "dang_ky" | "huy_dang_ky";
    nguon: string;
  },
  actor: string,
): { khach_id: string; da_tao_su_kien: boolean } {
  const kq = resolveKhach(
    db,
    [{ loai: "email", gia_tri: nhap.email, nguon: nhap.nguon }],
    { ten: nhap.ten },
    actor,
  );
  const cho = nhap.huong === "dang_ky";
  datDongY(db, kq.khach.id, {
    kenh: "email",
    muc_dich: "marketing",
    trang_thai: cho ? "cho" : "tu_choi",
    nguon: nhap.nguon,
  });
  const emailChuan = nhap.email.trim().toLowerCase();
  const sk = ghiTuongTac(db, {
    khach_id: kq.khach.id,
    loai: nhap.huong,
    nguon: nhap.nguon,
    khoa_idem: `nb:${nhap.huong}:${emailChuan}`,
  });
  return { khach_id: kq.khach.id, da_tao_su_kien: sk.da_tao };
}

// --- Conversion + attribution (ticket #63) ---
// chuyen_doi: business outcome; khach_id nullable — unattributed vẫn giữ,
// không ép gán. quy_ve: kết quả theo model LƯU CÙNG record — first_touch và
// last_touch tính cùng lúc khi ghi; không touch nào → loai_dich 'khong_ro'
// + do_tin 'khong_chac', không bịa. Currency không bao giờ quy đổi.

export const DANH_SACH_LOAI_CHUYEN_DOI = [
  "mua",
  "ung_ho",
  "dang_ky",
  "khac",
] as const;
export type LoaiChuyenDoi = (typeof DANH_SACH_LOAI_CHUYEN_DOI)[number];
export const DANH_SACH_MO_HINH = ["first_touch", "last_touch"] as const;
export type MoHinhQuyVe = (typeof DANH_SACH_MO_HINH)[number];

export type ChuyenDoi = {
  id: string;
  khach_id: string | null;
  loai: LoaiChuyenDoi;
  gia_tri: number | null;
  tien_te: string;
  nguon: string;
  xay_ra_luc: string;
  khoa_idem: string;
  ban_the_hien_id: string;
  campaign_id: string;
  don_hang_ngoai_id: string;
  chi_tiet: string;
  tao_luc: string;
};

export type QuyVe = {
  id: string;
  chuyen_doi_id: string;
  khach_id: string | null;
  mo_hinh: MoHinhQuyVe;
  loai_dich: string; // campaign | link_dich | ban_the_hien | giao_hang | nguon | khong_ro
  dich_id: string;
  do_tin: string; // chac | khong_chac
  tao_luc: string;
};

export type NhapChuyenDoi = {
  khach_id?: string | null;
  loai: string;
  gia_tri?: number | null;
  tien_te?: string;
  nguon: string;
  xay_ra_luc?: string;
  khoa_idem: string;
  ban_the_hien_id?: string;
  campaign_id?: string;
  don_hang_ngoai_id?: string;
  chi_tiet?: Record<string, unknown>;
};

// Touch = interaction có tham chiếu attribution. Thứ tự ưu tiên khi rút
// đích: campaign → link_dich → ban_the_hien → giao_hang (campaign là cấp
// marketing cao nhất; link_dich là click trên link theo dõi).
function dichTuRefs(r: {
  campaign_id?: string;
  link_dich_id?: string;
  ban_the_hien_id?: string;
  giao_hang_id?: string;
}): { loai_dich: string; dich_id: string } {
  if (r.campaign_id) return { loai_dich: "campaign", dich_id: r.campaign_id };
  if (r.link_dich_id) return { loai_dich: "link_dich", dich_id: r.link_dich_id };
  if (r.ban_the_hien_id) return { loai_dich: "ban_the_hien", dich_id: r.ban_the_hien_id };
  if (r.giao_hang_id) return { loai_dich: "giao_hang", dich_id: r.giao_hang_id };
  return { loai_dich: "", dich_id: "" };
}

// First-touch: ghi MỘT LẦN khi person có interaction đầu tiên mang
// tham chiếu attribution. INSERT OR IGNORE — event sau không ghi đè
// (bất biến; chỉ tính lại khi dữ liệu gốc sửa — giới hạn POC ghi trong
// conventions). Gọi từ ghiTuongTac sau khi insert thành công.
function chamDauTien(db: Database, sk: TuongTac): void {
  const dich = dichTuRefs(sk);
  if (!dich.loai_dich) return; // event không mang ref → không phải touch
  db.query(
    `INSERT OR IGNORE INTO dau_cham_dau
     (khach_id, tuong_tac_id, xay_ra_luc, campaign_id, link_dich_id,
      ban_the_hien_id, giao_hang_id, nguon)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    sk.khach_id,
    sk.id,
    sk.xay_ra_luc,
    sk.campaign_id,
    sk.link_dich_id,
    sk.ban_the_hien_id,
    sk.giao_hang_id,
    sk.nguon,
  );
}

export function layDauChamDau(
  db: Database,
  khachId: string,
): { tuong_tac_id: string; xay_ra_luc: string; campaign_id: string; link_dich_id: string; ban_the_hien_id: string; giao_hang_id: string; nguon: string } | null {
  return db
    .query("SELECT * FROM dau_cham_dau WHERE khach_id = ?")
    .get(khachId) as never;
}

// Tính hai model attribution cho một conversion (gọi trong txn ghi).
// first_touch = dau_cham_dau của person; last_touch = conversion's own
// refs nếu có, không thì interaction gần nhất trước conversion có ref;
// cuối cùng fallback nguon của interaction đó (khong_chac). Không person
// và không ref trên conversion → hai row khong_ro/khong_chac.
function tinhQuyVe(
  db: Database,
  cd: ChuyenDoi,
): { mo_hinh: MoHinhQuyVe; loai_dich: string; dich_id: string; do_tin: string }[] {
  const ds: { mo_hinh: MoHinhQuyVe; loai_dich: string; dich_id: string; do_tin: string }[] = [];
  // --- first_touch ---
  const dau = cd.khach_id ? layDauChamDau(db, cd.khach_id) : null;
  // Touch ở TƯƠNG LAI so với conversion (backdated) không phải touch.
  if (dau && dau.xay_ra_luc <= cd.xay_ra_luc) {
    const dich = dichTuRefs(dau);
    ds.push({ mo_hinh: "first_touch", loai_dich: dich.loai_dich, dich_id: dich.dich_id, do_tin: "chac" });
  } else {
    ds.push({ mo_hinh: "first_touch", loai_dich: "khong_ro", dich_id: "", do_tin: "khong_chac" });
  }
  // --- last_touch ---
  const trucTiep = dichTuRefs(cd);
  if (trucTiep.loai_dich) {
    // Conversion tự mang ref (vd đơn hàng gắn campaign) → chắc chắn.
    ds.push({ mo_hinh: "last_touch", loai_dich: trucTiep.loai_dich, dich_id: trucTiep.dich_id, do_tin: "chac" });
  } else if (cd.khach_id) {
    // Touch = interaction có ref; event không ref (vd chính event mua
    // vừa ghi trong nạp đơn) không phải touch — tìm có ref trước nhất.
    const coRef = db
      .query(
        `SELECT * FROM tuong_tac WHERE khach_id = ? AND xay_ra_luc <= ?
         AND (campaign_id <> '' OR link_dich_id <> '' OR ban_the_hien_id <> '' OR giao_hang_id <> '')
         ORDER BY xay_ra_luc DESC, rowid DESC LIMIT 1`,
      )
      .get(cd.khach_id, cd.xay_ra_luc) as TuongTac | null;
    if (coRef) {
      const dich = dichTuRefs(coRef);
      ds.push({ mo_hinh: "last_touch", loai_dich: dich.loai_dich, dich_id: dich.dich_id, do_tin: "chac" });
    } else {
      // Không event nào có ref → rơi về nguồn của event gần nhất, mức
      // tin cậy thấp (nguon chỉ là provenance, không phải ref).
      const gan = db
        .query(
          `SELECT * FROM tuong_tac WHERE khach_id = ? AND xay_ra_luc <= ?
           ORDER BY xay_ra_luc DESC, rowid DESC LIMIT 1`,
        )
        .get(cd.khach_id, cd.xay_ra_luc) as TuongTac | null;
      if (gan) {
        ds.push({ mo_hinh: "last_touch", loai_dich: "nguon", dich_id: gan.nguon, do_tin: "khong_chac" });
      } else {
        ds.push({ mo_hinh: "last_touch", loai_dich: "khong_ro", dich_id: "", do_tin: "khong_chac" });
      }
    }
  } else {
    ds.push({ mo_hinh: "last_touch", loai_dich: "khong_ro", dich_id: "", do_tin: "khong_chac" });
  }
  return ds;
}

// Ghi conversion: idempotent theo khoa_idem (delivery lặp trả record cũ);
// person nullable — unattributed vẫn INSERT. Validation: tien_te bắt
// buộc khi gia_tri có (và ngược lại không lẻ), gia_tri phải là số ≥ 0.
export function ghiChuyenDoi(
  db: Database,
  nhap: NhapChuyenDoi,
): { chuyen_doi: ChuyenDoi; quy_ve: QuyVe[]; da_tao: boolean } {
  const dsLoi: string[] = [];
  if (!(DANH_SACH_LOAI_CHUYEN_DOI as readonly string[]).includes(nhap.loai)) {
    dsLoi.push(`loai không hợp lệ. Cho phép: ${DANH_SACH_LOAI_CHUYEN_DOI.join(", ")}.`);
  }
  const nguon = tuyChonChuoi(nhap.nguon);
  if (!nguon) dsLoi.push("nguon là bắt buộc (provenance của conversion).");
  const khoaIdem = tuyChonChuoi(nhap.khoa_idem);
  if (!khoaIdem) dsLoi.push("khoa_idem là bắt buộc (khử trùng delivery lặp).");
  const coGiaTri = nhap.gia_tri !== undefined && nhap.gia_tri !== null;
  if (coGiaTri && (typeof nhap.gia_tri !== "number" || !Number.isFinite(nhap.gia_tri) || nhap.gia_tri < 0)) {
    dsLoi.push("gia_tri phải là số ≥ 0.");
  }
  const tienTe = tuyChonChuoi(nhap.tien_te).toUpperCase();
  if (coGiaTri && !tienTe) dsLoi.push("tien_te là bắt buộc khi có gia_tri.");
  if (!coGiaTri && tienTe) dsLoi.push("tien_te không có nghĩa khi gia_tri trống.");
  if (tienTe && !/^[A-Z]{3}$/.test(tienTe)) {
    dsLoi.push("tien_te phải là mã 3 ký tự (vd VND, USD).");
  }
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
  return txn(db, () => {
    const id = crypto.randomUUID();
    const kq = db
      .query(
        `INSERT OR IGNORE INTO chuyen_doi
         (id, khach_id, loai, gia_tri, tien_te, nguon, xay_ra_luc, khoa_idem,
          ban_the_hien_id, campaign_id, don_hang_ngoai_id, chi_tiet, tao_luc)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        nhap.khach_id ?? null,
        nhap.loai,
        coGiaTri ? nhap.gia_tri! : null,
        tienTe,
        nguon,
        xayRaLuc,
        khoaIdem,
        tuyChonChuoi(nhap.ban_the_hien_id),
        tuyChonChuoi(nhap.campaign_id),
        tuyChonChuoi(nhap.don_hang_ngoai_id),
        JSON.stringify(nhap.chi_tiet ?? {}),
        bayGio(),
      );
    if (kq.changes === 0) {
      const cu = db
        .query("SELECT * FROM chuyen_doi WHERE khoa_idem = ?")
        .get(khoaIdem) as ChuyenDoi;
      const qvCu = db
        .query("SELECT * FROM quy_ve WHERE chuyen_doi_id = ? ORDER BY mo_hinh")
        .all(cu.id) as QuyVe[];
      return { chuyen_doi: cu, quy_ve: qvCu, da_tao: false };
    }
    const cd = db.query("SELECT * FROM chuyen_doi WHERE id = ?").get(id) as ChuyenDoi;
    if (cd.khach_id) chamKhach(db, cd.khach_id, xayRaLuc);
    const dsQv = tinhQuyVe(db, cd).map((qv) => {
      const rid = crypto.randomUUID();
      db.query(
        `INSERT INTO quy_ve (id, chuyen_doi_id, khach_id, mo_hinh, loai_dich, dich_id, do_tin, tao_luc)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(rid, cd.id, cd.khach_id, qv.mo_hinh, qv.loai_dich, qv.dich_id, qv.do_tin, bayGio());
      return { id: rid, chuyen_doi_id: cd.id, khach_id: cd.khach_id, ...qv, tao_luc: bayGio() };
    });
    ghiSuKien(db, "chuyen_doi", cd.id, "ghi", {
      loai: cd.loai,
      nguon: cd.nguon,
      khach_id: cd.khach_id,
    }, cd.nguon);
    return { chuyen_doi: cd, quy_ve: dsQv, da_tao: true };
  });
}

// Attribution của một person: mỗi conversion kèm 2 row quy_ve
// (first_touch + last_touch). Conversion không touch nào → quy_ve vẫn có
// 2 row với loai_dich 'khong_ro' + do_tin 'khong_chac' — không bịa.
export function quyVeCuaKhach(
  db: Database,
  khachId: string,
): { chuyen_doi: ChuyenDoi; quy_ve: QuyVe[] }[] {
  const ds = db
    .query("SELECT * FROM chuyen_doi WHERE khach_id = ? ORDER BY xay_ra_luc, rowid")
    .all(khachId) as ChuyenDoi[];
  return ds.map((cd) => ({
    chuyen_doi: cd,
    quy_ve: db
      .query("SELECT * FROM quy_ve WHERE chuyen_doi_id = ? ORDER BY mo_hinh")
      .all(cd.id) as QuyVe[],
  }));
}

// Liệt kê conversion; chua_gan=true → chỉ conversion chưa gán person
// (hàng chờ cho merge/backfill sau — không mất dữ liệu).
export function danhSachChuyenDoi(
  db: Database,
  loc: { chua_gan?: boolean; gioi_han?: number } = {},
): ChuyenDoi[] {
  const where = loc.chua_gan ? "WHERE khach_id IS NULL" : "";
  return db
    .query(`SELECT * FROM chuyen_doi ${where} ORDER BY xay_ra_luc, rowid LIMIT ?`)
    .all(loc.gioi_han ?? 200) as ChuyenDoi[];
}

// --- Nạp đơn hàng từ hệ thống commerce (ticket #64) ---
// Contract idempotent: một lần nạp tạo person (qua external identity
// <he_thong>:<khach_ngoai_id>) + event `mua` + conversion `mua` trong một
// transaction. Identity matching có kiểm soát: chỉ qua external id và
// email/dinh_danh payload khai báo — không fuzzy. Đụng identity của
// person khác → resolveKhach quăng 409 kèm khach_ids.
// Idempotency: khoa_idem, dự phòng `<he_thong>:<don_hang_ngoai_id>` —
// replay trả bản ghi cũ, không nhân đơn/event/conversion.
// Giới hạn POC (document trong conventions): không refund/cancel, không
// sync hai chiều, không adapter Shopify/Woo thật — chỉ contract + fixture.

export type ItemDonHang = {
  ma?: string;
  ten: string;
  so_luong: number;
  gia: number;
};

export type NhapDonHang = {
  he_thong: string;
  khach_ngoai_id: string;
  don_hang_ngoai_id: string;
  dinh_danh?: NhapDinhDanh[];
  email?: string;
  ten?: string;
  items?: ItemDonHang[];
  gia_tri: number;
  tien_te: string;
  mua_luc?: string;
  khoa_idem?: string;
  chi_tiet?: Record<string, unknown>;
};

export function napDonHang(
  db: Database,
  nhap: NhapDonHang,
  actor: string,
): {
  khach: Khach | null;
  su_kien: TuongTac | null;
  chuyen_doi: ChuyenDoi;
  quy_ve: QuyVe[];
  da_tao: boolean;
} {
  const dsLoi: string[] = [];
  const heThong = tuyChonChuoi(nhap.he_thong).toLowerCase();
  if (!heThong) dsLoi.push("he_thong là bắt buộc (hệ thống nguồn của đơn).");
  const khachNgoaiId = tuyChonChuoi(nhap.khach_ngoai_id);
  if (!khachNgoaiId) dsLoi.push("khach_ngoai_id là bắt buộc (id khách trong hệ thống nguồn).");
  const donHangId = tuyChonChuoi(nhap.don_hang_ngoai_id);
  if (!donHangId) dsLoi.push("don_hang_ngoai_id là bắt buộc (id đơn trong hệ thống nguồn).");
  if (typeof nhap.gia_tri !== "number" || !Number.isFinite(nhap.gia_tri) || nhap.gia_tri < 0) {
    dsLoi.push("gia_tri phải là số ≥ 0.");
  }
  const tienTe = tuyChonChuoi(nhap.tien_te).toUpperCase();
  if (!tienTe) {
    dsLoi.push("tien_te là bắt buộc (đơn hàng luôn có giá trị tiền).");
  } else if (!/^[A-Z]{3}$/.test(tienTe)) {
    dsLoi.push("tien_te phải là mã 3 ký tự (vd VND, USD).");
  }
  const items = nhap.items ?? [];
  if (!Array.isArray(items)) {
    dsLoi.push("items phải là mảng {ma?, ten, so_luong, gia}.");
  } else {
    for (const it of items) {
      if (typeof it !== "object" || it === null) {
        dsLoi.push("items[] phải là object {ma?, ten, so_luong, gia}.");
        continue;
      }
      if (!tuyChonChuoi(it.ten)) dsLoi.push("items[].ten là bắt buộc.");
      if (typeof it.so_luong !== "number" || it.so_luong <= 0) {
        dsLoi.push("items[].so_luong phải là số > 0.");
      }
      if (typeof it.gia !== "number" || !Number.isFinite(it.gia) || it.gia < 0) {
        dsLoi.push("items[].gia phải là số ≥ 0.");
      }
    }
  }
  const muaLuc = tuyChonChuoi(nhap.mua_luc);
  if (muaLuc && !Number.isFinite(Date.parse(muaLuc))) {
    dsLoi.push("mua_luc không phải thời điểm hợp lệ (ISO 8601).");
  }
  if (nhap.dinh_danh !== undefined && !Array.isArray(nhap.dinh_danh)) {
    dsLoi.push("dinh_danh phải là mảng {loai, gia_tri, nguon?, external_id?}.");
  }
  nemLoiValidation(dsLoi);

  // Khóa idempotency: khoa_idem khai báo, dự phòng he_thong:don_hang.
  const khoa = tuyChonChuoi(nhap.khoa_idem) || `${heThong}:${donHangId}`;
  // Replay: đơn đã nạp (conversion là record chốt của contract) → trả cũ.
  const daCo = db
    .query("SELECT * FROM chuyen_doi WHERE khoa_idem = ?")
    .get(`nd:${khoa}`) as ChuyenDoi | null;
  if (daCo) {
    return {
      khach: daCo.khach_id ? layKhach(db, daCo.khach_id) : null,
      su_kien: null,
      chuyen_doi: daCo,
      quy_ve: db
        .query("SELECT * FROM quy_ve WHERE chuyen_doi_id = ? ORDER BY mo_hinh")
        .all(daCo.id) as QuyVe[],
      da_tao: false,
    };
  }

  return txn(db, () => {
    // Identity có kiểm soát: external '<he_thong>:<khach_ngoai_id>' luôn
    // gắn; email + dinh_danh[] chỉ khi payload khai báo — không fuzzy.
    const dsDd: NhapDinhDanh[] = [
      {
        loai: "external",
        nguon: heThong,
        gia_tri: khachNgoaiId,
        external_id: khachNgoaiId,
      },
      ...(nhap.dinh_danh ?? []),
    ];
    const email = tuyChonChuoi(nhap.email);
    if (email) dsDd.push({ loai: "email", gia_tri: email, nguon: heThong });
    const kq = resolveKhach(db, dsDd, { ten: tuyChonChuoi(nhap.ten) }, actor);
    const khach = kq.khach;

    const chiTiet = {
      items,
      don_hang_ngoai_id: donHangId,
      khach_ngoai_id: khachNgoaiId,
      ...(nhap.chi_tiet ?? {}),
    };
    const sk = ghiTuongTac(db, {
      khach_id: khach.id,
      loai: "mua",
      nguon: heThong,
      xay_ra_luc: muaLuc || undefined,
      khoa_idem: `nd-sk:${khoa}`,
      don_hang_ngoai_id: donHangId,
      chi_tiet: chiTiet,
    });
    const cd = ghiChuyenDoi(db, {
      khach_id: khach.id,
      loai: "mua",
      gia_tri: nhap.gia_tri,
      tien_te: tienTe,
      nguon: heThong,
      xay_ra_luc: muaLuc || undefined,
      khoa_idem: `nd:${khoa}`,
      don_hang_ngoai_id: donHangId,
      chi_tiet: chiTiet,
    });
    ghiSuKien(db, "khach", khach.id, "nap_don_hang", {
      he_thong: heThong,
      don_hang_ngoai_id: donHangId,
      da_tao_khach: kq.da_tao,
    }, actor);
    return {
      khach,
      su_kien: sk.su_kien,
      chuyen_doi: cd.chuyen_doi,
      quy_ve: cd.quy_ve,
      da_tao: true,
    };
  });
}
