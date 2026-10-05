// Xác thực instance tùy chọn (#16): tài khoản local + phiên đăng nhập.
//
// Phạm vi: access control cấp instance cho bản cài MAI self-hosted —
// quản trị/biên tập chia sẻ một thư viện nội dung. Không tenant,
// workspace, mời qua email, SSO hay identity service ngoài.
//
// Thư viện được bảo trì: `Bun.password` (argon2id, do Bun duy trì) cho
// hash mật khẩu và `crypto` Web/platform cho token phiên — không tự
// viết crypto. Token raw chỉ nằm trong cookie; DB lưu sha256.

import { createHash, randomBytes } from "node:crypto";
import type { Database } from "bun:sqlite";
import { LoiApi, batBuocChuoi, loiRequest, nemLoiValidation, tuyChonChuoi } from "../../loi.ts";
import { log } from "../../log.ts";
import { ghiSuKien } from "../content/index.ts";

export const TEN_COOKIE = "mai_phien";
export const TTL_PHIEN_MAC_DINH_PHUT = 10080; // 7 ngày

export const DANH_SACH_VAI_TRO = ["quan_tri", "bien_tap"] as const;
export type VaiTro = (typeof DANH_SACH_VAI_TRO)[number];

export const DANH_SACH_TRANG_THAI_TK = ["hoat_dong", "vo_hieu"] as const;
export type TrangThaiTaiKhoan = (typeof DANH_SACH_TRANG_THAI_TK)[number];

// View public của tài khoản: hash_mat_khau không bao giờ rời module.
export type TaiKhoan = {
  id: string;
  ten_dang_nhap: string;
  ten_hien_thi: string;
  vai_tro: VaiTro;
  trang_thai: TrangThaiTaiKhoan;
  tao_luc: string;
  cap_nhat_luc: string;
};

export type PhienDangNhap = {
  id: string;
  tai_khoan_id: string;
  token_hash: string;
  het_han_luc: string;
  tao_luc: string;
  ip: string;
  user_agent: string;
};

export type NhapTaiKhoan = {
  ten_dang_nhap: string;
  ten_hien_thi: string;
  vai_tro: VaiTro;
  mat_khau: string;
};

const bayGio = () => new Date().toISOString();

type DongTaiKhoan = TaiKhoan & { hash_mat_khau: string };

function docTaiKhoan(row: DongTaiKhoan): TaiKhoan {
  const { hash_mat_khau: _hash, ...view } = row;
  return view;
}

const SELECT_TK =
  "SELECT id, ten_dang_nhap, ten_hien_thi, vai_tro, hash_mat_khau, trang_thai, tao_luc, cap_nhat_luc FROM tai_khoan";

export function layTaiKhoan(db: Database, id: string): TaiKhoan | null {
  const row = db.query(`${SELECT_TK} WHERE id = ?`).get(id) as DongTaiKhoan | null;
  return row ? docTaiKhoan(row) : null;
}

export function layTaiKhoanTheoTen(db: Database, tenDangNhap: string): TaiKhoan | null {
  const row = db.query(`${SELECT_TK} WHERE ten_dang_nhap = ?`).get(tenDangNhap) as
    | DongTaiKhoan
    | null;
  return row ? docTaiKhoan(row) : null;
}

export function danhSachTaiKhoan(db: Database): TaiKhoan[] {
  return (db.query(`${SELECT_TK} ORDER BY tao_luc`).all() as DongTaiKhoan[]).map(docTaiKhoan);
}

// nguoi_duyet_id của ds_nguoi_duyet (campaign công quyền / thị trường) map
// sang tài khoản thật của instance khi chế độ bảo vệ bật — khớp theo id
// hoặc ten_dang_nhap, chỉ tính tài khoản còn hoạt động.
export function laTaiKhoanHoatDong(db: Database, idHoacTen: string): boolean {
  return (
    db
      .query(
        "SELECT COUNT(*) AS c FROM tai_khoan WHERE (id = ? OR ten_dang_nhap = ?) AND trang_thai = 'hoat_dong'",
      )
      .get(idHoacTen, idHoacTen) as { c: number }
  ).c > 0;
}

// --- Validation ---

const RE_TEN_DANG_NHAP = /^[a-zA-Z0-9_.-]{2,64}$/;

// Kiểm input tạo tài khoản; mật khẩu chỉ kiểm độ dài — không serialize,
// không log, không đi vào su_kien.
export function docNhapTaiKhoan(body: Record<string, unknown>, dsLoi: string[]): NhapTaiKhoan {
  const tenDangNhap = batBuocChuoi(body.ten_dang_nhap, "ten_dang_nhap", dsLoi);
  if (tenDangNhap && !RE_TEN_DANG_NHAP.test(tenDangNhap)) {
    dsLoi.push("ten_dang_nhap chỉ gồm chữ cái không dấu, số, '.', '_', '-' (2-64 ký tự).");
  }
  const tenHienThi = tuyChonChuoi(body.ten_hien_thi) || tenDangNhap;
  if (tenHienThi.length > 120) dsLoi.push("ten_hien_thi tối đa 120 ký tự.");
  let vaiTro: VaiTro = "bien_tap";
  const vtRaw = tuyChonChuoi(body.vai_tro);
  if (vtRaw) {
    if (!(DANH_SACH_VAI_TRO as readonly string[]).includes(vtRaw)) {
      dsLoi.push(`vai_tro không hợp lệ. Cho phép: ${DANH_SACH_VAI_TRO.join(", ")}.`);
    } else {
      vaiTro = vtRaw as VaiTro;
    }
  }
  const matKhau = typeof body.mat_khau === "string" ? body.mat_khau : "";
  if (matKhau.length < 8) dsLoi.push("mat_khau tối thiểu 8 ký tự.");
  if (matKhau.length > 200) dsLoi.push("mat_khau tối đa 200 ký tự.");
  return { ten_dang_nhap: tenDangNhap, ten_hien_thi: tenHienThi, vai_tro: vaiTro, mat_khau: matKhau };
}

// --- Tài khoản ---

export async function taoTaiKhoan(
  db: Database,
  nhap: NhapTaiKhoan,
  tacGia: string,
): Promise<TaiKhoan> {
  if (layTaiKhoanTheoTen(db, nhap.ten_dang_nhap)) {
    loiRequest(409, "XUNG_DOT_TRANG_THAI", `Tên đăng nhập '${nhap.ten_dang_nhap}' đã tồn tại.`);
  }
  const id = crypto.randomUUID();
  const luc = bayGio();
  const hash = await Bun.password.hash(nhap.mat_khau);
  db.query(
    `INSERT INTO tai_khoan (id, ten_dang_nhap, ten_hien_thi, vai_tro, hash_mat_khau, trang_thai, tao_luc, tao_boi, cap_nhat_luc)
     VALUES (?, ?, ?, ?, ?, 'hoat_dong', ?, ?, ?)`,
  ).run(id, nhap.ten_dang_nhap, nhap.ten_hien_thi, nhap.vai_tro, hash, luc, tacGia, luc);
  ghiSuKien(db, "tai_khoan", id, "tao", { ten_dang_nhap: nhap.ten_dang_nhap, vai_tro: nhap.vai_tro }, tacGia);
  return layTaiKhoan(db, id)!;
}

export type SuaTaiKhoan = {
  ten_hien_thi?: string;
  vai_tro?: VaiTro;
  trang_thai?: TrangThaiTaiKhoan;
};

export function docSuaTaiKhoan(body: Record<string, unknown>, dsLoi: string[]): SuaTaiKhoan {
  const sua: SuaTaiKhoan = {};
  if (body.ten_hien_thi !== undefined) {
    const t = tuyChonChuoi(body.ten_hien_thi);
    if (!t) dsLoi.push("ten_hien_thi không được rỗng.");
    else if (t.length > 120) dsLoi.push("ten_hien_thi tối đa 120 ký tự.");
    else sua.ten_hien_thi = t;
  }
  if (body.vai_tro !== undefined) {
    const v = tuyChonChuoi(body.vai_tro);
    if (!(DANH_SACH_VAI_TRO as readonly string[]).includes(v)) {
      dsLoi.push(`vai_tro không hợp lệ. Cho phép: ${DANH_SACH_VAI_TRO.join(", ")}.`);
    } else {
      sua.vai_tro = v as VaiTro;
    }
  }
  if (body.trang_thai !== undefined) {
    const t = tuyChonChuoi(body.trang_thai);
    if (!(DANH_SACH_TRANG_THAI_TK as readonly string[]).includes(t)) {
      dsLoi.push(`trang_thai không hợp lệ. Cho phép: ${DANH_SACH_TRANG_THAI_TK.join(", ")}.`);
    } else {
      sua.trang_thai = t as TrangThaiTaiKhoan;
    }
  }
  return sua;
}

export function capNhatTaiKhoan(
  db: Database,
  id: string,
  sua: SuaTaiKhoan,
  tacGia: string,
): TaiKhoan {
  const cu = layTaiKhoan(db, id);
  if (!cu) loiRequest(404, "KHONG_TIM_THAY", "Không tìm thấy tài khoản.");
  const luc = bayGio();
  db.query(
    `UPDATE tai_khoan SET ten_hien_thi = ?, vai_tro = ?, trang_thai = ?, cap_nhat_luc = ? WHERE id = ?`,
  ).run(
    sua.ten_hien_thi ?? cu.ten_hien_thi,
    sua.vai_tro ?? cu.vai_tro,
    sua.trang_thai ?? cu.trang_thai,
    luc,
    id,
  );
  ghiSuKien(db, "tai_khoan", id, "cap_nhat", { ...sua }, tacGia);
  // Vô hiệu tài khoản → phiên đang mở của họ chết ngay, không chờ hết hạn.
  if (sua.trang_thai === "vo_hieu") xoaPhienCuaTaiKhoan(db, id);
  return layTaiKhoan(db, id)!;
}

// Đổi/reset mật khẩu: mọi phiên của tài khoản chết — phiên cũ không
// sống sót sau khi credential đổi.
export async function doiMatKhau(
  db: Database,
  id: string,
  matKhauMoi: string,
  tacGia: string,
): Promise<void> {
  if (!layTaiKhoan(db, id)) loiRequest(404, "KHONG_TIM_THAY", "Không tìm thấy tài khoản.");
  if (matKhauMoi.length < 8 || matKhauMoi.length > 200) {
    throw new LoiApi(400, "VALIDATION", "mat_khau từ 8 đến 200 ký tự.");
  }
  const hash = await Bun.password.hash(matKhauMoi);
  db.query("UPDATE tai_khoan SET hash_mat_khau = ?, cap_nhat_luc = ? WHERE id = ?").run(
    hash,
    bayGio(),
    id,
  );
  xoaPhienCuaTaiKhoan(db, id);
  ghiSuKien(db, "tai_khoan", id, "doi_mat_khau", {}, tacGia);
}

// Kiểm mật khẩu hiện tại của chính tài khoản (đổi mật khẩu tự phục vụ).
export async function kiemTraMatKhauCu(
  db: Database,
  id: string,
  matKhauCu: string,
): Promise<boolean> {
  const row = db.query("SELECT hash_mat_khau FROM tai_khoan WHERE id = ?").get(id) as {
    hash_mat_khau: string;
  } | null;
  if (!row) loiRequest(404, "KHONG_TIM_THAY", "Không tìm thấy tài khoản.");
  return Bun.password.verify(matKhauCu, row.hash_mat_khau);
}

// --- Phiên đăng nhập ---

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function taoToken(): string {
  return randomBytes(32).toString("hex");
}

// Hash dummy cho lần verify khi tên đăng nhập không tồn tại — cân bằng
// thời gian phản hồi, tránh dò tài khoản qua timing.
let dummyHash: string | null = null;
async function layDummyHash(): Promise<string> {
  dummyHash ??= await Bun.password.hash("mai-dummy-password-khong-dung");
  return dummyHash;
}

function thuDonPhienHetHan(db: Database): void {
  db.query("DELETE FROM phien_dang_nhap WHERE het_han_luc <= ?").run(bayGio());
}

export async function dangNhap(
  db: Database,
  tenDangNhap: string,
  matKhau: string,
  tuyChon: { ttlPhut: number; ip?: string; userAgent?: string },
): Promise<{ tai_khoan: TaiKhoan; token: string }> {
  const row = db
    .query(`${SELECT_TK} WHERE ten_dang_nhap = ?`)
    .get(tenDangNhap) as DongTaiKhoan | null;
  const hopLe =
    (await Bun.password.verify(matKhau, row?.hash_mat_khau ?? (await layDummyHash()))) &&
    row !== null &&
    row.trang_thai === "hoat_dong";
  if (!hopLe) {
    log.warn("xac_thuc.dang_nhap_loi", { ten_dang_nhap: tenDangNhap });
    throw new LoiApi(401, "SAI_THONG_TIN_DANG_NHAP", "Sai tên đăng nhập hoặc mật khẩu.");
  }
  thuDonPhienHetHan(db);
  const token = taoToken();
  const hetHan = new Date(Date.now() + tuyChon.ttlPhut * 60_000).toISOString();
  db.query(
    `INSERT INTO phien_dang_nhap (id, tai_khoan_id, token_hash, het_han_luc, tao_luc, ip, user_agent)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    crypto.randomUUID(),
    row.id,
    hashToken(token),
    hetHan,
    bayGio(),
    tuyChon.ip ?? "",
    (tuyChon.userAgent ?? "").slice(0, 200),
  );
  ghiSuKien(db, "tai_khoan", row.id, "dang_nhap", {}, row.id);
  return { tai_khoan: docTaiKhoan(row), token };
}

export function dangXuat(db: Database, token: string): void {
  const phien = db
    .query("SELECT * FROM phien_dang_nhap WHERE token_hash = ?")
    .get(hashToken(token)) as PhienDangNhap | null;
  if (!phien) return;
  db.query("DELETE FROM phien_dang_nhap WHERE id = ?").run(phien.id);
  ghiSuKien(db, "tai_khoan", phien.tai_khoan_id, "dang_xuat", {}, phien.tai_khoan_id);
}

export function xoaPhienCuaTaiKhoan(db: Database, taiKhoanId: string): void {
  db.query("DELETE FROM phien_dang_nhap WHERE tai_khoan_id = ?").run(taiKhoanId);
}

// Đọc phiên từ token cookie: hợp lệ = còn hạn + tài khoản còn hoạt động.
export function docPhien(db: Database, token: string): PhienDangNhap | null {
  return db
    .query(
      `SELECT p.* FROM phien_dang_nhap p
       JOIN tai_khoan t ON t.id = p.tai_khoan_id
       WHERE p.token_hash = ? AND p.het_han_luc > ? AND t.trang_thai = 'hoat_dong'`,
    )
    .get(hashToken(token), bayGio()) as PhienDangNhap | null;
}

// --- Cookie ---

export function docTokenCookie(req: Request): string {
  const raw = req.headers.get("cookie") ?? "";
  for (const cap of raw.split(";")) {
    const [k, ...rest] = cap.trim().split("=");
    if (k === TEN_COOKIE) return rest.join("=").trim();
  }
  return "";
}

export function datCookiePhien(
  token: string,
  tuyChon: { ttlPhut: number; secure: boolean },
): string {
  const phan = [
    `${TEN_COOKIE}=${token}`,
    "HttpOnly",
    "SameSite=Lax",
    "Path=/",
    `Max-Age=${Math.max(60, Math.floor(tuyChon.ttlPhut * 60))}`,
  ];
  if (tuyChon.secure) phan.push("Secure");
  return phan.join("; ");
}

export function xoaCookiePhien(secure: boolean): string {
  const phan = [`${TEN_COOKIE}=`, "HttpOnly", "SameSite=Lax", "Path=/", "Max-Age=0"];
  if (secure) phan.push("Secure");
  return phan.join("; ");
}
