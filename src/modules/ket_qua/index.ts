// Module đo kết quả kênh sở hữu (#15) — tách riêng ba nguồn số liệu:
//   * 'provider'  — số adapter/provider báo (snapshot qua layMetric)
//   * first-party — sự kiện MAI tự ghi (xem trang /p, click link /l)
//   * 'nhap_tay'  — kết quả người dùng tự nhập kèm bằng chứng
// Từ đó gom báo cáo theo thông điệp/bản thể hiện/kênh và sinh gợi ý
// hành động tiếp theo có bằng chứng.
//
// Quy tắc:
// - Số đếm là SỰ KIỆN, không phải người duy nhất — không cộng dồn
//   chồng lấn giữa kênh thành "reach".
// - Bundle đã xuất tay KHÔNG phải bài/video đã đăng hay đã xem; reach
//   social = "không có" vì chưa tích hợp.
// - Bot/máy quét link lọc theo heuristic UA (ghi la_bot, loại khỏi số
//   chính); bot giả UA trình duyệt không lọc được — tài liệu hóa giới
//   hạn này thay vì giả lọc được.
// - Mẫu nhỏ/rỗng: hiển thị con số thô + nhãn mẫu nhỏ, không tính tỉ lệ
//   chuyển đổi hay độ ý nghĩa.
// - Gợi ý chỉ tạo việc khi người dùng chấp nhận; không âm thầm đăng hay
//   sửa nội dung/fact đã duyệt.

import type { Database } from "bun:sqlite";
import { LoiApi, loiRequest } from "../../loi.ts";
import { log } from "../../log.ts";
import {
  danhSachBanTheHien,
  danhSachThongDiep,
  danhSachXuatBan,
  ghiSuKien,
  layBanTheHien,
  layCampaign,
  layThongDiep,
  taoBanTheHien,
  timBanTheHien,
  type BanTheHien,
  type ThongDiep,
} from "../content/index.ts";
import { layDinhDang } from "../formats/index.ts";
import { danhSachDoiTuong } from "../context/index.ts";
import { enqueueJob } from "../jobs/index.ts";
import {
  danhSachTatCaGiao,
  layAdapter,
  layDsKenh,
  type CauHinhKenh,
  type GiaoHang,
} from "../kenh/index.ts";

const bayGio = () => new Date().toISOString();

function txn<T>(db: Database, fn: () => T): T {
  if (db.inTransaction) return fn();
  db.exec("BEGIN IMMEDIATE");
  try {
    const r = fn();
    db.exec("COMMIT");
    return r;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

function docJson<T>(raw: string, macDinh: T): T {
  try {
    const j = JSON.parse(raw || "");
    return j as T;
  } catch {
    return macDinh;
  }
}

export type ChuSoLieu = "campaign" | "thong_diep" | "ban_the_hien" | "giao_hang";
const CHU_HO_TRO: ChuSoLieu[] = ["campaign", "thong_diep", "ban_the_hien", "giao_hang"];

function kiemTraChu(db: Database, chuLoai: string, chuId: string): void {
  if (!CHU_HO_TRO.includes(chuLoai as ChuSoLieu)) {
    loiRequest(400, "VALIDATION", `chu_loai không hỗ trợ. Cho phép: ${CHU_HO_TRO.join(", ")}.`);
  }
  let tonTai = false;
  if (chuLoai === "campaign") tonTai = !!layCampaign(db, chuId);
  else if (chuLoai === "thong_diep") tonTai = !!layThongDiep(db, chuId);
  else if (chuLoai === "ban_the_hien") tonTai = !!layBanTheHien(db, chuId);
  else if (chuLoai === "giao_hang") {
    tonTai = !!db.query("SELECT id FROM giao_hang WHERE id = ?").get(chuId);
  }
  if (!tonTai) loiRequest(404, "KHONG_TIM_THAY", `Không tìm thấy ${chuLoai}: ${chuId}`);
}

// --- Mục tiêu + tiêu chí thành công (tùy chọn) ---

export type TieuChiThanhCong = { ten: string; don_vi?: string; nguong?: number };

export type MucTieu = {
  id: string;
  chu_loai: string;
  chu_id: string;
  mo_ta: string;
  tieu_chi: TieuChiThanhCong[];
  tao_luc: string;
  tao_boi: string;
  cap_nhat_luc: string;
};

type DongMucTieu = Omit<MucTieu, "tieu_chi"> & { tieu_chi: string };

function docMucTieuDong(r: DongMucTieu): MucTieu {
  const tc = docJson<unknown>(r.tieu_chi, []);
  return { ...r, tieu_chi: Array.isArray(tc) ? (tc as TieuChiThanhCong[]) : [] };
}

// PUT upsert: một dòng mục tiêu per (chu_loai, chu_id). tieu_chi mảng
// {ten, don_vi?, nguong?} — tiêu chí ngắn, không phải KPI engine.
export function datMucTieu(
  db: Database,
  input: { chu_loai: string; chu_id: string; mo_ta: string; tieu_chi: TieuChiThanhCong[] },
  tacGia: string,
): MucTieu {
  kiemTraChu(db, input.chu_loai, input.chu_id);
  if (input.chu_loai === "giao_hang" || input.chu_loai === "ban_the_hien") {
    loiRequest(400, "VALIDATION", "Mục tiêu chỉ gắn vào 'campaign' hoặc 'thong_diep'.");
  }
  const ts = bayGio();
  const cu = db
    .query("SELECT * FROM muc_tieu_ket_qua WHERE chu_loai = ? AND chu_id = ?")
    .get(input.chu_loai, input.chu_id) as DongMucTieu | null;
  if (cu) {
    db.query(
      "UPDATE muc_tieu_ket_qua SET mo_ta = ?, tieu_chi = ?, cap_nhat_luc = ? WHERE id = ?",
    ).run(input.mo_ta, JSON.stringify(input.tieu_chi), ts, cu.id);
    ghiSuKien(db, "muc_tieu_ket_qua", cu.id, "cap_nhat", {}, tacGia);
    return docMucTieuDong(
      db.query("SELECT * FROM muc_tieu_ket_qua WHERE id = ?").get(cu.id) as DongMucTieu,
    );
  }
  const id = crypto.randomUUID();
  db.query(
    `INSERT INTO muc_tieu_ket_qua (id, chu_loai, chu_id, mo_ta, tieu_chi, tao_luc, tao_boi, cap_nhat_luc)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, input.chu_loai, input.chu_id, input.mo_ta, JSON.stringify(input.tieu_chi), ts, tacGia, ts);
  ghiSuKien(db, "muc_tieu_ket_qua", id, "tao", {}, tacGia);
  return docMucTieuDong(
    db.query("SELECT * FROM muc_tieu_ket_qua WHERE id = ?").get(id) as DongMucTieu,
  );
}

export function layMucTieu(db: Database, chuLoai: string, chuId: string): MucTieu | null {
  const r = db
    .query("SELECT * FROM muc_tieu_ket_qua WHERE chu_loai = ? AND chu_id = ?")
    .get(chuLoai, chuId) as DongMucTieu | null;
  return r ? docMucTieuDong(r) : null;
}

// --- Link đích theo dõi (/l/<token> → 302 tới url_dich + ghi click) ---

export type LinkDich = {
  id: string;
  token: string;
  url_dich: string;
  thong_diep_id: string;
  ban_the_hien_id: string;
  nhan: string;
  url_theo_doi: string;
  tao_luc: string;
  tao_boi: string;
};

type DongLink = Omit<LinkDich, "url_theo_doi">;

function docLink(r: DongLink, urlGoc: string): LinkDich {
  return { ...r, url_theo_doi: `${urlGoc}/l/${r.token}` };
}

export function layLinkDichTheoToken(db: Database, token: string): LinkDich | null {
  const r = db.query("SELECT * FROM link_dich WHERE token = ?").get(token) as DongLink | null;
  return r ? { ...r, url_theo_doi: `/l/${r.token}` } : null;
}

// Tạo link đích theo dõi — gắn vào thông điệp hoặc một bản thể hiện cụ
// thể. Token ngắn đủ ngẫu nhiên để chèn tay vào email/nội dung; retry
// đơn giản nếu trùng (xác suất thấp).
export function taoLinkDich(
  db: Database,
  input: { url_dich: string; thong_diep_id?: string; ban_the_hien_id?: string; nhan?: string },
  urlGoc: string,
  tacGia: string,
): { link: LinkDich; da_tao: boolean } {
  let url: URL;
  try {
    url = new URL(input.url_dich.trim());
  } catch {
    loiRequest(400, "VALIDATION", "url_dich phải là URL hợp lệ (http/https).");
  }
  if (!["http:", "https:"].includes(url!.protocol)) {
    loiRequest(400, "VALIDATION", "url_dich chỉ nhận scheme http/https.");
  }
  const tdId = (input.thong_diep_id ?? "").trim();
  const bthId = (input.ban_the_hien_id ?? "").trim();
  if (!tdId && !bthId) {
    loiRequest(400, "VALIDATION", "Cần thong_diep_id hoặc ban_the_hien_id để gom báo cáo.");
  }
  if (tdId) kiemTraChu(db, "thong_diep", tdId);
  if (bthId) kiemTraChu(db, "ban_the_hien", bthId);
  // Dedupe: cùng đích cùng chủ → trả link cũ (không phân mảnh số đếm).
  const cu = db
    .query(
      `SELECT * FROM link_dich WHERE url_dich = ? AND thong_diep_id = ? AND ban_the_hien_id = ?`,
    )
    .get(url!.toString(), tdId, bthId) as DongLink | null;
  if (cu) return { link: docLink(cu, urlGoc), da_tao: false };
  let token = "";
  for (let i = 0; i < 4; i++) {
    const thu = crypto.randomUUID().replaceAll("-", "").slice(0, 10);
    if (!db.query("SELECT id FROM link_dich WHERE token = ?").get(thu)) {
      token = thu;
      break;
    }
  }
  if (!token) throw new LoiApi(500, "LOI_NOI_BO", "Không tạo được token link.");
  const id = crypto.randomUUID();
  const ts = bayGio();
  try {
    db.query(
      `INSERT INTO link_dich (id, token, url_dich, thong_diep_id, ban_the_hien_id, nhan, tao_luc, tao_boi)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, token, url!.toString(), tdId, bthId, (input.nhan ?? "").trim(), ts, tacGia);
  } catch (e) {
    // Race: request khác đã tạo cùng (đích, chủ) giữa SELECT và INSERT
    // → trả link đó thay vì ném UNIQUE constraint.
    const trung = db
      .query(
        `SELECT * FROM link_dich WHERE url_dich = ? AND thong_diep_id = ? AND ban_the_hien_id = ?`,
      )
      .get(url!.toString(), tdId, bthId) as DongLink | null;
    if (trung) return { link: docLink(trung, urlGoc), da_tao: false };
    throw e;
  }
  ghiSuKien(db, "link_dich", id, "tao", { url_dich: url!.toString() }, tacGia);
  return {
    link: docLink(
      db.query("SELECT * FROM link_dich WHERE id = ?").get(id) as DongLink,
      urlGoc,
    ),
    da_tao: true,
  };
}

export function danhSachLinkDich(
  db: Database,
  urlGoc: string,
  loc: { thongDiepId?: string; banTheHienId?: string } = {},
): (LinkDich & { so_click: number })[] {
  const ds = db.query("SELECT * FROM link_dich ORDER BY tao_luc DESC").all() as DongLink[];
  return ds
    .filter(
      (l) =>
        (!loc.thongDiepId || l.thong_diep_id === loc.thongDiepId) &&
        (!loc.banTheHienId || l.ban_the_hien_id === loc.banTheHienId),
    )
    .map((l) => ({
      ...docLink(l, urlGoc),
      so_click: demSuKienDo(db, "link_dich", [l.id], "click_link").tong,
    }));
}

// --- Sự kiện first-party ---

export type SuKienDo = {
  id: string;
  loai: string; // 'xem_trang' | 'click_link'
  doi_tuong_loai: string;
  doi_tuong_id: string;
  khoa_dedupe: string;
  la_bot: boolean;
  chi_tiet: Record<string, unknown>;
  tao_luc: string;
};

type DongSuKien = Omit<SuKienDo, "la_bot" | "chi_tiet"> & { la_bot: number; chi_tiet: string };

// Heuristic UA bot/máy quét — không phải danh sách đầy đủ: crawler khai
// báo mình (googlebot v.v.), trình preview link của chat/mail, công cụ
// HTTP. Bot giả UA trình duyệt không lọc được → ghi nhận trong giới hạn
// báo cáo, không giả là lọc hết.
const DAU_HIEU_BOT = [
  "bot",
  "crawler",
  "spider",
  "slurp",
  "preview",
  "scanner",
  "headless",
  "curl",
  "wget",
  "python",
  "httpclient",
  "okhttp",
  "scrapy",
  "ahrefs",
  "semrush",
  "pingdom",
  "uptime",
  "facebookexternal",
  "slackbot",
  "discordbot",
  "telegrambot",
  "whatsapp",
  "mail.ru",
];

export function laBotUa(ua: string): boolean {
  const u = ua.toLowerCase();
  return DAU_HIEU_BOT.some((d) => u.includes(d));
}

// Khung khử trùng: fingerprint (ua+ip) lặp trong 30 phút = một sự kiện.
// Không định danh người — cùng fingerprint có thể là nhiều người sau NAT,
// một người đổi UA tính hai lần. Giới hạn ghi trong báo cáo.
const KHUNG_DEDUPE_MS = 30 * 60 * 1000;

async function vanTay(ua: string, ip: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${ua}|${ip}`));
  return Array.from(new Uint8Array(buf))
    .slice(0, 8)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// Ghi một sự kiện đo first-party. khoa_dedupe ngoài (link hủy, v.v.) thì
// dùng nguyên; trống → fingerprint + khung 30 phút. Trả da_ghi=false khi
// trùng khung.
export async function ghiSuKienDo(
  db: Database,
  input: {
    loai: "xem_trang" | "click_link";
    doiTuongLoai: "ban_the_hien" | "link_dich";
    doiTuongId: string;
    ua?: string;
    ip?: string;
    chiTiet?: Record<string, unknown>;
  },
): Promise<{ da_ghi: boolean; la_bot: boolean }> {
  const ua = input.ua ?? "";
  const bot = laBotUa(ua);
  const khung = Math.floor(Date.now() / KHUNG_DEDUPE_MS);
  const vt = await vanTay(ua, input.ip ?? "");
  const khoa = `${input.loai}:${input.doiTuongId}:${vt}:${khung}`;
  // INSERT OR IGNORE thay check-then-insert: hai request cùng fingerprint
  // đồng thời không ném UNIQUE constraint — request sau là no-op dedupe.
  const kq = db
    .query(
      `INSERT OR IGNORE INTO su_kien_do (id, loai, doi_tuong_loai, doi_tuong_id, khoa_dedupe, la_bot, chi_tiet, tao_luc)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      crypto.randomUUID(),
      input.loai,
      input.doiTuongLoai,
      input.doiTuongId,
      khoa,
      bot ? 1 : 0,
      JSON.stringify(input.chiTiet ?? {}),
      bayGio(),
    );
  return { da_ghi: kq.changes > 0, la_bot: bot };
}

// Đếm sự kiện theo đối tượng — tách bot ra khỏi số chính.
export function demSuKienDo(
  db: Database,
  doiTuongLoai: string,
  dsId: string[],
  loai?: string,
): { tong: number; bot: number; moi_nhat: string | null } {
  if (dsId.length === 0) return { tong: 0, bot: 0, moi_nhat: null };
  const ph = dsId.map(() => "?").join(",");
  const r = db
    .query(
      `SELECT COUNT(*) AS c, COALESCE(SUM(la_bot), 0) AS b, MAX(tao_luc) AS m
       FROM su_kien_do
       WHERE doi_tuong_loai = ? AND doi_tuong_id IN (${ph}) ${loai ? "AND loai = ?" : ""}`,
    )
    .get(doiTuongLoai, ...dsId, ...(loai ? [loai] : [])) as {
    c: number;
    b: number;
    m: string | null;
  };
  return { tong: r.c - r.b, bot: r.b, moi_nhat: r.m };
}

// --- Số liệu theo nguồn ---

export type SoLieu = {
  id: string;
  nguon: string; // 'provider' | 'nhap_tay'
  chu_loai: ChuSoLieu;
  chu_id: string;
  ten: string;
  gia_tri: number | null;
  don_vi: string;
  mo_ta: string;
  bang_chung: string;
  nhan_dinh: string; // 'tu_bao' | 'da_do' | ''
  cua_so_tu: string | null;
  cua_so_den: string | null;
  mui_gio: string;
  thu_luc: string;
  chi_tiet: Record<string, unknown>;
  tao_luc: string;
  tao_boi: string;
};

type DongSoLieu = Omit<SoLieu, "chi_tiet"> & { chi_tiet: string };

function docSoLieu(r: DongSoLieu): SoLieu {
  const ct = docJson<unknown>(r.chi_tiet, {});
  return {
    ...r,
    chi_tiet: typeof ct === "object" && ct !== null && !Array.isArray(ct)
      ? (ct as Record<string, unknown>)
      : {},
  };
}

// Kết quả người dùng tự nhập: gây quỹ/kinh doanh đã kiểm chứng kèm bằng
// chứng. bang_chung bắt buộc; nhan_dinh 'tu_bao' mặc định — chỉ 'da_do'
// khi người dùng tường minh nói đo được.
export function nhapKetQua(
  db: Database,
  input: {
    chu_loai: string;
    chu_id: string;
    ten: string;
    gia_tri?: number | null;
    don_vi?: string;
    mo_ta?: string;
    bang_chung: string;
    nhan_dinh?: string;
    cua_so_tu?: string;
    cua_so_den?: string;
    mui_gio?: string;
  },
  tacGia: string,
): SoLieu {
  kiemTraChu(db, input.chu_loai, input.chu_id);
  const ten = input.ten.trim();
  if (!ten) loiRequest(400, "VALIDATION", "ten số liệu bắt buộc.");
  if (ten.length > 80) loiRequest(400, "VALIDATION", "ten tối đa 80 ký tự.");
  if (!input.bang_chung.trim()) {
    loiRequest(400, "VALIDATION", "bang_chung bắt buộc — kết quả tự nhập phải kèm bằng chứng.");
  }
  const nhanDinh = input.nhan_dinh ?? "tu_bao";
  if (!["tu_bao", "da_do"].includes(nhanDinh)) {
    loiRequest(400, "VALIDATION", "nhan_dinh chỉ nhận 'tu_bao' hoặc 'da_do'.");
  }
  const id = crypto.randomUUID();
  const ts = bayGio();
  db.query(
    `INSERT INTO so_lieu
       (id, nguon, chu_loai, chu_id, ten, gia_tri, don_vi, mo_ta, bang_chung, nhan_dinh,
        cua_so_tu, cua_so_den, mui_gio, thu_luc, chi_tiet, tao_luc, tao_boi)
     VALUES (?, 'nhap_tay', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '{}', ?, ?)`,
  ).run(
    id,
    input.chu_loai,
    input.chu_id,
    ten,
    input.gia_tri ?? null,
    (input.don_vi ?? "").trim(),
    (input.mo_ta ?? "").trim(),
    input.bang_chung.trim(),
    nhanDinh,
    input.cua_so_tu ?? null,
    input.cua_so_den ?? null,
    (input.mui_gio ?? "").trim() || "UTC",
    ts,
    ts,
    tacGia,
  );
  ghiSuKien(db, "so_lieu", id, "nhap_tay", { ten, chu_loai: input.chu_loai, chu_id: input.chu_id }, tacGia);
  return docSoLieu(db.query("SELECT * FROM so_lieu WHERE id = ?").get(id) as DongSoLieu);
}

export function danhSachSoLieu(
  db: Database,
  loc: { chu_loai?: string; chu_id?: string; nguon?: string } = {},
): SoLieu[] {
  const ds = db.query("SELECT * FROM so_lieu ORDER BY thu_luc DESC, id DESC").all() as DongSoLieu[];
  return ds
    .filter(
      (s) =>
        (!loc.chu_loai || s.chu_loai === loc.chu_loai) &&
        (!loc.chu_id || s.chu_id === loc.chu_id) &&
        (!loc.nguon || s.nguon === loc.nguon),
    )
    .map(docSoLieu);
}

// Snapshot số liệu provider của một lần giao: adapter.layMetric trả map
// email → last_event/receipt. Gom thành đếm per sự kiện + giữ chi tiết
// per người nhận. Khử trùng: nội dung y hệt snapshot trước → chỉ làm
// tươi thu_luc, không thêm dòng (metric là trạng thái cuối, không phải
// chuỗi sự kiện cộng dồn).
// Trả null khi duLieu là shape lỗi ({loi: "..."} — vd kênh chưa cấu
// hình): không ghi snapshot rác soán snapshot hợp lệ trước đó.
export function ghiSnapshotProvider(
  db: Database,
  giao: GiaoHang,
  duLieu: Record<string, unknown>,
): SoLieu | null {
  if (typeof duLieu.loi === "string") return null;
  const theoSuKien: Record<string, number> = {};
  const theoNguoiNhan: Record<string, string> = {};
  for (const [email, v] of Object.entries(duLieu)) {
    const sk =
      typeof v === "object" && v !== null
        ? String((v as Record<string, unknown>).su_kien_cuoi ?? (v as Record<string, unknown>).loi ?? "khong_ro")
        : "khong_ro";
    theoNguoiNhan[email] = sk;
    theoSuKien[sk] = (theoSuKien[sk] ?? 0) + 1;
  }
  const chiTiet = { theo_su_kien: theoSuKien, theo_nguoi_nhan: theoNguoiNhan };
  const ts = bayGio();
  const cu = db
    .query(
      `SELECT * FROM so_lieu
       WHERE nguon = 'provider' AND chu_loai = 'giao_hang' AND chu_id = ? AND ten = 'email_su_kien'
       ORDER BY thu_luc DESC LIMIT 1`,
    )
    .get(giao.id) as DongSoLieu | null;
  if (cu) {
    const ctCu = docJson<Record<string, unknown>>(cu.chi_tiet, {});
    if (JSON.stringify(ctCu.theo_nguoi_nhan ?? {}) === JSON.stringify(theoNguoiNhan)) {
      db.query("UPDATE so_lieu SET thu_luc = ? WHERE id = ?").run(ts, cu.id);
      return docSoLieu(db.query("SELECT * FROM so_lieu WHERE id = ?").get(cu.id) as DongSoLieu);
    }
  }
  const id = crypto.randomUUID();
  db.query(
    `INSERT INTO so_lieu
       (id, nguon, chu_loai, chu_id, ten, gia_tri, don_vi, mo_ta, bang_chung, nhan_dinh,
        cua_so_tu, cua_so_den, mui_gio, thu_luc, chi_tiet, tao_luc, tao_boi)
     VALUES (?, 'provider', 'giao_hang', ?, 'email_su_kien', NULL, 'nguoi_nhan', ?, '', 'da_do',
             ?, ?, ?, ?, ?, ?, 'he_thong')`,
  ).run(
    id,
    giao.id,
    `Snapshot provider cho lần giao ${giao.id} (kênh ${giao.kenh}).`,
    giao.tao_luc,
    ts,
    giao.mui_gio || "UTC",
    ts,
    JSON.stringify(chiTiet),
    ts,
  );
  ghiSuKien(db, "so_lieu", id, "snapshot_provider", { giao_hang_id: giao.id }, "he_thong");
  return docSoLieu(db.query("SELECT * FROM so_lieu WHERE id = ?").get(id) as DongSoLieu);
}

// Thu thập metric provider cho mọi lần giao có adapter metric — bỏ qua
// kênh không có năng lực/lần giao chưa chấp nhận. Gọi từ nút "Thu thập
// metric" hay gợi ý thi_nghiem loai 'thu_metric'.
export async function thuThapMetricGiao(
  db: Database,
  cauHinhKenh: CauHinhKenh | undefined,
): Promise<{ da_thu: number; bo_qua: number; loi: number }> {
  const ds = danhSachTatCaGiao(db, 500).filter(
    (g) => ["chap_nhan", "da_giao"].includes(g.trang_thai) && !g.la_test,
  );
  let da_thu = 0;
  let bo_qua = 0;
  let loi = 0;
  for (const g of ds) {
    const adapter = layAdapter(cauHinhKenh, g.kenh);
    if (!adapter?.layMetric) {
      bo_qua++;
      continue;
    }
    if (!adapter.san_sang) {
      loi++;
      continue;
    }
    try {
      const duLieu = await adapter.layMetric(g);
      if (ghiSnapshotProvider(db, g, duLieu)) {
        da_thu++;
      } else {
        loi++;
      }
    } catch (e) {
      loi++;
      log.warn("ket_qua.thu_metric_loi", { giao_hang_id: g.id, loi: String(e) });
    }
  }
  return { da_thu, bo_qua, loi };
}

// --- Báo cáo gom theo thông điệp / bản thể hiện / kênh ---

// Định nghĩa tường minh cho mọi con số trên dashboard — độc giả biết
// chính xác từng số đếm từ đâu, đo thế nào.
export const DINH_NGHIA_METRIC: Record<string, string> = {
  xem_trang:
    "Số request GET /p/<id> hợp lệ — trừ fingerprint client (UA+IP) trùng trong 30 phút và UA nghi bot.",
  click_link: "Số request GET /l/<token> (redirect tới link đích) — cùng khử trùng + lọc bot.",
  email_da_gui:
    "Tổng so_nguoi_nhan của các lần giao 'chap_nhan'/'da_giao' — provider đã nhận gửi, khác 'đã tới hộp thư'.",
  email_su_kien:
    "last_event provider báo per biên nhận trong snapshot mới nhất (vd delivered/opened/clicked/bounced). Một người nhận đếm một sự kiện cuối.",
  nhap_tay: "Kết quả người dùng tự nhập kèm bằng chứng — nhãn 'tu_bao' trừ khi 'da_do'.",
  xuat_tay: "Bundle đã xuất để đăng tay — KHÔNG phải bài/video đã đăng hay đã xem.",
  reach_social: "không có — MAI chưa tích hợp nền tảng social, không đo reach.",
};

export const GIOI_HAN_BAO_CAO = [
  "Số đếm là sự kiện, không phải người duy nhất — một người vừa xem trang vừa click email tính hai lần; không cộng dồn giữa kênh thành reach.",
  "Bot/máy quét link lọc theo heuristic UA (đếm riêng ở cột 'loại bot'); bot giả UA trình duyệt không lọc được.",
  "Máy quét trong hộp thư có thể mở link trước khi người đọc — click provider báo có thể phóng đại.",
  "Tương quan không phải nhân quả — gợi ý chỉ dựa trên quan sát đã ghi.",
  "POC không tính tỉ lệ chuyển đổi hay độ ý nghĩa thống kê.",
];

const NGUONG_MAU_NHO = 30;

export type BaoCaoKetQua = {
  pham_vi: { thong_diep_id: string; campaign_id: string };
  dinh_nghia: Record<string, string>;
  gioi_han: string[];
  cua_so: { tu: string | null; den: string | null; mui_gio: string };
  do_tuoi: { su_kien_moi_nhat: string | null; snapshot_provider_moi_nhat: string | null };
  mau_nho: boolean;
  muc_tieu: MucTieu | null;
  social: { reach: null; trang_thai: string; ghi_chu: string };
  theo_thong_diep: Record<string, unknown>[];
  theo_kenh: Record<string, unknown>[];
  theo_ban_the_hien: Record<string, unknown>[];
  theo_doi_tuong: Record<string, unknown>[];
  nhap_tay: SoLieu[];
};

export function baoCaoKetQua(
  db: Database,
  phamVi: { thongDiepId?: string; campaignId?: string },
): BaoCaoKetQua {
  const dsTd = phamVi.thongDiepId
    ? ([layThongDiep(db, phamVi.thongDiepId)].filter(Boolean) as ThongDiep[])
    : danhSachThongDiep(db, phamVi.campaignId);
  const dsBth = phamVi.thongDiepId
    ? danhSachBanTheHien(db, { thongDiepId: phamVi.thongDiepId })
    : danhSachBanTheHien(db, { campaignId: phamVi.campaignId });
  const bthIds = dsBth.map((b) => b.id);
  const tdIds = new Set(dsTd.map((t) => t.id));

  // Link đích gắn vào bản thể hiện/thông điệp trong phạm vi.
  const dsLink = (db.query("SELECT * FROM link_dich").all() as DongLink[]).filter(
    (l) => bthIds.includes(l.ban_the_hien_id) || tdIds.has(l.thong_diep_id),
  );
  const linkIds = dsLink.map((l) => l.id);
  const demClick = demSuKienDo(db, "link_dich", linkIds, "click_link");
  const demXem = demSuKienDo(db, "ban_the_hien", bthIds, "xem_trang");

  // Lần giao của các đầu ra trong phạm vi + snapshot provider mới nhất.
  const dsGiao = danhSachTatCaGiao(db, 500).filter((g) => bthIds.includes(g.ban_the_hien_id));
  const snapshotMoi = (giaoId: string): SoLieu | null =>
    danhSachSoLieu(db, { chu_loai: "giao_hang", chu_id: giaoId, nguon: "provider" })[0] ?? null;

  // Nhập tay gắn trên bất kỳ chủ nào trong phạm vi.
  const chuTrongPhamVi = new Set<string>([
    ...tdIds,
    ...bthIds,
    ...dsGiao.map((g) => g.id),
    ...(phamVi.campaignId ? [phamVi.campaignId] : []),
    ...dsTd.map((t) => t.campaign_id ?? ""),
  ]);
  const nhapTay = danhSachSoLieu(db, { nguon: "nhap_tay" }).filter(
    (s) => chuTrongPhamVi.has(s.chu_id),
  );

  const theoThongDiep = dsTd.map((td) => {
    const bthTd = dsBth.filter((b) => b.thong_diep_id === td.id);
    const ids = bthTd.map((b) => b.id);
    const linkTd = dsLink.filter(
      (l) => l.thong_diep_id === td.id || ids.includes(l.ban_the_hien_id),
    );
    const click = demSuKienDo(db, "link_dich", linkTd.map((l) => l.id), "click_link");
    const xem = demSuKienDo(db, "ban_the_hien", ids, "xem_trang");
    const giaoTd = dsGiao.filter((g) => ids.includes(g.ban_the_hien_id));
    const emailGiao = giaoTd.filter(
      (g) => g.kenh === "email" && ["chap_nhan", "da_giao"].includes(g.trang_thai),
    );
    const suKienEmail: Record<string, number> = {};
    for (const g of emailGiao) {
      const snap = snapshotMoi(g.id);
      const sk = (snap?.chi_tiet.theo_su_kien ?? {}) as Record<string, number>;
      for (const [k, v] of Object.entries(sk)) suKienEmail[k] = (suKienEmail[k] ?? 0) + v;
    }
    return {
      thong_diep_id: td.id,
      tieu_de: td.tieu_de,
      so_dau_ra: bthTd.length,
      xem_trang: xem.tong,
      xem_loai_bot: xem.bot,
      click_link: click.tong,
      click_loai_bot: click.bot,
      email_da_gui: emailGiao.reduce((s, g) => s + g.so_nguoi_nhan, 0),
      email_su_kien: suKienEmail,
      so_nhap_tay: nhapTay.filter((s) => s.chu_id === td.id || ids.includes(s.chu_id)).length,
    };
  });

  const theoKenh = layDsKenh(undefined).map((a) => {
    const giaoKenh = dsGiao.filter((g) => g.kenh === a.id);
    const thanhCong = giaoKenh.filter((g) =>
      ["da_giao", "chap_nhan", "xuat_tay"].includes(g.trang_thai),
    );
    const dong: Record<string, unknown> = {
      kenh: a.id,
      nhan: a.nhan,
      lan_giao: giaoKenh.length,
      thanh_cong: thanhCong.length,
      cho_giao: giaoKenh.filter((g) => g.trang_thai === "cho_giao").length,
      huy_loi: giaoKenh.filter((g) => ["huy", "loi", "khong_chac"].includes(g.trang_thai)).length,
    };
    if (a.id === "email") {
      dong.da_gui = thanhCong.reduce((s, g) => s + g.so_nguoi_nhan, 0);
      dong.bo_qua_suppress = thanhCong.reduce((s, g) => s + g.so_bo_qua, 0);
      const suKien: Record<string, number> = {};
      for (const g of thanhCong) {
        const snap = snapshotMoi(g.id);
        for (const [k, v] of Object.entries(
          (snap?.chi_tiet.theo_su_kien ?? {}) as Record<string, number>,
        )) {
          suKien[k] = (suKien[k] ?? 0) + v;
        }
      }
      dong.su_kien_provider = suKien;
      dong.ghi_chu = "'chap_nhan' = provider đã nhận — khác đã tới hộp thư; metric là snapshot.";
    }
    if (a.id === "trang_noi_bo") {
      dong.xem_trang = demXem.tong;
      dong.loai_bot = demXem.bot;
      dong.ghi_chu = "Xem trang = request /p hợp lệ đã lọc dedupe+bot.";
    }
    if (a.id === "xuat_tay" || a.id === "dry_run") {
      dong.ghi_chu = "Đã xuất bundle — không đo được đăng hay xem trên đích ngoài.";
    }
    return dong;
  });

  // /p/<id> phục vụ theo record xuat_ban mới nhất — mọi đường tạo
  // xuat_ban (trang_noi_bo, xuat_tay, POST /xuat-ban trực tiếp) đều
  // làm trang sống, không riêng giao trang_noi_bo.
  const bthCoTrang = new Set(
    dsBth.filter((b) => danhSachXuatBan(db, b.id).length > 0).map((b) => b.id),
  );

  const theoBth = dsBth.map((b) => {
    const xem = demSuKienDo(db, "ban_the_hien", [b.id], "xem_trang");
    const linkB = dsLink.filter((l) => l.ban_the_hien_id === b.id);
    const click = demSuKienDo(db, "link_dich", linkB.map((l) => l.id), "click_link");
    const giaoB = dsGiao.filter((g) => g.ban_the_hien_id === b.id);
    return {
      ban_the_hien_id: b.id,
      thong_diep_id: b.thong_diep_id,
      dinh_dang: b.dinh_dang,
      doi_tuong: b.doi_tuong,
      dich_den: b.dich_den,
      trang_thai: b.trang_thai,
      xem_trang: xem.tong,
      click_link: click.tong,
      lan_giao_thanh_cong: giaoB.filter((g) =>
        ["da_giao", "chap_nhan", "xuat_tay"].includes(g.trang_thai),
      ).length,
      lan_giao: giaoB.length,
      url_trang: bthCoTrang.has(b.id) ? `/p/${b.id}` : null,
    };
  });

  // Gom theo đối tượng: b.doi_tuong là chuỗi tự do → group theo giá trị
  // hiện có; rỗng gom về "(không ghi)". Số đếm là sự kiện, không phải
  // người duy nhất giữa các nhóm.
  const theoDoiTuong = Object.values(
    theoBth.reduce(
      (acc, b) => {
        const k = b.doi_tuong || "(không ghi)";
        const d = acc[k] ?? {
          doi_tuong: k,
          so_dau_ra: 0,
          xem_trang: 0,
          click_link: 0,
          lan_giao_thanh_cong: 0,
          lan_giao: 0,
        };
        d.so_dau_ra += 1;
        d.xem_trang += b.xem_trang;
        d.click_link += b.click_link;
        d.lan_giao_thanh_cong += b.lan_giao_thanh_cong;
        d.lan_giao += b.lan_giao;
        acc[k] = d;
        return acc;
      },
      {} as Record<
        string,
        {
          doi_tuong: string;
          so_dau_ra: number;
          xem_trang: number;
          click_link: number;
          lan_giao_thanh_cong: number;
          lan_giao: number;
        }
      >,
    ),
  ).sort((a, z) => z.xem_trang - a.xem_trang || z.click_link - a.click_link);

  // Cửa sổ + độ tươi toàn cục của phạm vi.
  const mocSuKien = [demXem.moi_nhat, demClick.moi_nhat].filter(Boolean).sort();
  const snapMoiNhat = dsGiao
    .map((g) => snapshotMoi(g.id)?.thu_luc)
    .filter(Boolean)
    .sort()
    .at(-1) ?? null;
  const tatCaMoc = db
    .query(
      `SELECT MIN(tao_luc) AS dau, MAX(tao_luc) AS cuoi FROM su_kien_do
       WHERE (doi_tuong_loai = 'ban_the_hien' AND doi_tuong_id IN (${bthIds.map(() => "?").join(",") || "''"}))
          OR (doi_tuong_loai = 'link_dich' AND doi_tuong_id IN (${linkIds.map(() => "?").join(",") || "''"}))`,
    )
    .get(...bthIds, ...linkIds) as { dau: string | null; cuoi: string | null };

  const tongSuKien =
    demXem.tong +
    demClick.tong +
    Object.values(
      (theoKenh.find((k) => k.kenh === "email")?.su_kien_provider ?? {}) as Record<string, number>,
    ).reduce((s, v) => s + v, 0);

  const mucTieu =
    (phamVi.thongDiepId ? layMucTieu(db, "thong_diep", phamVi.thongDiepId) : null) ??
    (phamVi.campaignId ? layMucTieu(db, "campaign", phamVi.campaignId) : null) ??
    (dsTd[0]?.campaign_id ? layMucTieu(db, "campaign", dsTd[0].campaign_id) : null);

  return {
    pham_vi: {
      thong_diep_id: phamVi.thongDiepId ?? "",
      campaign_id: phamVi.campaignId ?? "",
    },
    dinh_nghia: DINH_NGHIA_METRIC,
    gioi_han: GIOI_HAN_BAO_CAO,
    cua_so: { tu: tatCaMoc.dau, den: tatCaMoc.cuoi, mui_gio: "UTC" },
    do_tuoi: {
      su_kien_moi_nhat: mocSuKien.at(-1) ?? null,
      snapshot_provider_moi_nhat: snapMoiNhat,
    },
    mau_nho: tongSuKien < NGUONG_MAU_NHO,
    muc_tieu: mucTieu,
    social: {
      reach: null,
      trang_thai: "khong_co",
      ghi_chu: "Reach social: không có — MAI chưa tích hợp nền tảng social.",
    },
    theo_thong_diep: theoThongDiep,
    theo_kenh: theoKenh,
    theo_ban_the_hien: theoBth,
    theo_doi_tuong: theoDoiTuong,
    nhap_tay: nhapTay,
  };
}

// --- Gợi ý hành động tiếp theo ---

export type QuanSat = { mo_ta: string; gia_tri?: number | string; nguon: string };

export type GoiYKetQua = {
  id: string;
  khoa: string;
  loai: string; // 'nhap_tiep' | 'cau_hoi' | 'thi_nghiem'
  chu_loai: string;
  chu_id: string;
  tieu_de: string;
  mo_ta: string;
  quan_sat: QuanSat[];
  bat_dinh: string; // 'thap' | 'vua' | 'cao'
  hanh_dong: Record<string, unknown>;
  ket_qua: Record<string, unknown>;
  trang_thai: string; // 'moi' | 'chap_nhan' | 'tu_choi'
  tao_luc: string;
  quyet_luc: string | null;
};

type DongGoiY = Omit<GoiYKetQua, "quan_sat" | "hanh_dong" | "ket_qua"> & {
  quan_sat: string;
  hanh_dong: string;
  ket_qua: string;
};

function docGoiY(r: DongGoiY): GoiYKetQua {
  return {
    ...r,
    quan_sat: docJson<QuanSat[]>(r.quan_sat, []),
    hanh_dong: docJson<Record<string, unknown>>(r.hanh_dong, {}),
    ket_qua: docJson<Record<string, unknown>>(r.ket_qua, {}),
  };
}

type UngVien = {
  khoa: string;
  loai: string;
  chu_loai: string;
  chu_id: string;
  tieu_de: string;
  mo_ta: string;
  quan_sat: QuanSat[];
  bat_dinh: string;
  hanh_dong: Record<string, unknown>;
};

function batDinhTheoMau(tongSuKien: number): string {
  if (tongSuKien < 10) return "cao";
  if (tongSuKien < NGUONG_MAU_NHO) return "vua";
  return "thap";
}

// Sinh ứng viên gợi ý cho một thông điệp — deterministic trên số liệu
// hiện có. Mỗi quan sát ghi rõ nguồn (first_party/provider/nhap_tay/
// he_thong) để độc giả truy ngược bằng chứng.
function ungVienTheoThongDiep(db: Database, td: ThongDiep): UngVien[] {
  const dsBth = danhSachBanTheHien(db, { thongDiepId: td.id });
  const dsGiao = danhSachTatCaGiao(db, 500).filter((g) =>
    dsBth.some((b) => b.id === g.ban_the_hien_id),
  );
  const bthIds = dsBth.map((b) => b.id);
  const dsLink = (db.query("SELECT * FROM link_dich").all() as DongLink[]).filter(
    (l) => l.thong_diep_id === td.id || bthIds.includes(l.ban_the_hien_id),
  );
  const tongSuKien =
    demSuKienDo(db, "ban_the_hien", bthIds).tong +
    demSuKienDo(db, "link_dich", dsLink.map((l) => l.id)).tong;
  const batDinh = batDinhTheoMau(tongSuKien);
  const ra: UngVien[] = [];

  const thanhCong = dsGiao.filter((g) => ["da_giao", "chap_nhan"].includes(g.trang_thai));
  const kenhDaDung = new Set(thanhCong.map((g) => g.kenh));

  // Thí nghiệm phân phối: đầu ra đã duyệt + đã giao một kênh, còn kênh
  // đăng được khác chưa dùng → đề xuất biến thể cho kênh đó. Email chỉ
  // gợi ý khi adapter sẵn sàng (thiếu config thì giao fail vô ích).
  const sanSang = new Set(
    layDsKenh(undefined)
      .filter((a) => a.san_sang && a.nang_luc.includes("dang"))
      .map((a) => a.id),
  );
  const bthDaGiao = dsBth.filter((b) =>
    dsGiao.some(
      (g) => g.ban_the_hien_id === b.id && ["da_giao", "chap_nhan"].includes(g.trang_thai),
    ),
  );
  for (const b of bthDaGiao) {
    for (const kenhMoi of ["email", "trang_noi_bo"]) {
      if (kenhDaDung.has(kenhMoi) || !sanSang.has(kenhMoi)) continue;
      const dinhDangMoi = kenhMoi === "email" ? "newsletter" : b.dinh_dang;
      if (!layDinhDang(dinhDangMoi)) continue;
      ra.push({
        khoa: `thi_nghiem:kenh:${td.id}:${b.id}:${kenhMoi}`,
        loai: "thi_nghiem",
        chu_loai: "thong_diep",
        chu_id: td.id,
        tieu_de: `Thí nghiệm phân phối: thêm kênh ${kenhMoi}`,
        mo_ta:
          `Đầu ra '${b.dinh_dang}' đã giao qua ${[...kenhDaDung].join(", ")} nhưng chưa qua ${kenhMoi}. ` +
          `Tạo nháp biến thể cho ${kenhMoi} để so sánh sự kiện first-party giữa hai kênh.`,
        quan_sat: [
          {
            mo_ta: `Đầu ra ${b.dinh_dang} (${b.id}) đã giao thành công qua ${[...kenhDaDung].join(", ")}`,
            nguon: "he_thong",
          },
          {
            mo_ta: `Tổng sự kiện đo được của thông điệp`,
            gia_tri: tongSuKien,
            nguon: "first_party",
          },
        ],
        bat_dinh: batDinh,
        hanh_dong: {
          loai_tao: "ban_the_hien",
          thong_diep_id: td.id,
          dinh_dang: dinhDangMoi,
          // dich_den nằm trong safe list của goiYKenh — 'trang_noi_bo'
          // không được nhận diện → rơi về xuat_tay, ngược mục đích.
          dich_den: kenhMoi === "trang_noi_bo" ? "web" : "email",
          doi_tuong: b.doi_tuong,
        },
      });
    }
  }

  // Nháp tiếp theo: đã có đầu ra giao được + có sự kiện đo + chưa có đầu
  // ra nào đang nháp/chờ duyệt → đề xuất bản mới cùng định dạng nhiều
  // sự kiện nhất. Tương quan ≠ nhân quả: nêu trong quan_sát, không hứa
  // tăng trưởng.
  const coNhapMo = dsBth.some((b) => ["nhap", "cho_duyet"].includes(b.trang_thai));
  if (bthDaGiao.length > 0 && tongSuKien > 0 && !coNhapMo) {
    const theoXem = dsBth
      .map((b) => ({ b, xem: demSuKienDo(db, "ban_the_hien", [b.id], "xem_trang").tong }))
      .sort((a, z) => z.xem - a.xem);
    const top = theoXem[0];
    if (top) {
      ra.push({
        khoa: `nhap_tiep:${td.id}:${top.b.dinh_dang}`,
        loai: "nhap_tiep",
        chu_loai: "thong_diep",
        chu_id: td.id,
        tieu_de: `Nháp tiếp theo cho '${td.tieu_de}'`,
        mo_ta:
          `Đầu ra ${top.b.dinh_dang} hiện có ${top.xem} lượt xem trang đo được. ` +
          `Tạo nháp cùng định dạng để thử tiếp — quan sát này là tương quan, không chứng minh nhân quả.`,
        quan_sat: [
          {
            mo_ta: `xem_trang của đầu ra ${top.b.id} (${top.b.dinh_dang})`,
            gia_tri: top.xem,
            nguon: "first_party",
          },
          { mo_ta: `tổng sự kiện thông điệp`, gia_tri: tongSuKien, nguon: "first_party" },
        ],
        bat_dinh: batDinh,
        hanh_dong: {
          loai_tao: "ban_the_hien",
          thong_diep_id: td.id,
          dinh_dang: top.b.dinh_dang,
          dich_den: top.b.dich_den,
          doi_tuong: top.b.doi_tuong,
        },
      });
    }
  }

  // Câu hỏi làm rõ: link đích được xem nhưng không click, hoặc chưa có
  // kết quả nhập tay cho chủ có mục tiêu.
  for (const l of dsLink) {
    const click = demSuKienDo(db, "link_dich", [l.id], "click_link").tong;
    const xemChu = l.ban_the_hien_id
      ? demSuKienDo(db, "ban_the_hien", [l.ban_the_hien_id], "xem_trang").tong
      : tongSuKien;
    if (xemChu > 0 && click === 0) {
      ra.push({
        khoa: `cau_hoi:link:${l.id}`,
        loai: "cau_hoi",
        chu_loai: "thong_diep",
        chu_id: td.id,
        tieu_de: `Link '${l.nhan || l.url_dich}' chưa có click`,
        mo_ta:
          `Trang/đầu ra có ${xemChu} lượt xem nhưng link đích chưa ghi click nào. ` +
          `CTA có rõ không? Link có đúng chỗ người đọc thấy không?`,
        quan_sat: [
          { mo_ta: "lượt xem quan sát được", gia_tri: xemChu, nguon: "first_party" },
          { mo_ta: "click_link của link đích", gia_tri: 0, nguon: "first_party" },
        ],
        bat_dinh: batDinh,
        hanh_dong: { loai_tao: "cau_hoi_mo" },
      });
    }
  }
  const mucTieu =
    layMucTieu(db, "thong_diep", td.id) ??
    (td.campaign_id ? layMucTieu(db, "campaign", td.campaign_id) : null);
  if (mucTieu) {
    const coNhapTay =
      danhSachSoLieu(db, { nguon: "nhap_tay" }).filter(
        (s) => s.chu_id === td.id || s.chu_id === td.campaign_id || bthIds.includes(s.chu_id),
      ).length > 0;
    if (!coNhapTay) {
      ra.push({
        khoa: `cau_hoi:nhap_ket_qua:${td.id}`,
        loai: "cau_hoi",
        chu_loai: "thong_diep",
        chu_id: td.id,
        tieu_de: "Nhập kết quả đã kiểm chứng chưa?",
        mo_ta:
          `Thông điệp/campaign có mục tiêu nhưng chưa có kết quả nào được nhập tay. ` +
          `Có số gây quỹ/kinh doanh đã kiểm chứng để nhập kèm bằng chứng không?`,
        quan_sat: [
          { mo_ta: `mục tiêu: ${mucTieu.mo_ta}`, nguon: "he_thong" },
          { mo_ta: "số liệu nhập tay hiện có", gia_tri: 0, nguon: "nhap_tay" },
        ],
        bat_dinh: batDinh,
        hanh_dong: { loai_tao: "cau_hoi_mo" },
      });
    }
  }

  // Thu thập metric: có lần giao provider đã nhận nhưng chưa có snapshot
  // mới (<24h) → đề xuất kéo metric. Chấp nhận chạy thuThapMetricGiao.
  const giaoCoMetric = dsGiao.filter(
    (g) =>
      ["chap_nhan", "da_giao"].includes(g.trang_thai) &&
      !g.la_test &&
      !!layAdapter(undefined, g.kenh)?.layMetric,
  );
  const coMetricAdapter = giaoCoMetric.length > 0;
  if (coMetricAdapter) {
    const snapMoi = giaoCoMetric
      .flatMap((g) => danhSachSoLieu(db, { chu_loai: "giao_hang", chu_id: g.id, nguon: "provider" }))
      .map((s) => s.thu_luc)
      .sort()
      .at(-1);
    const cu24h = !snapMoi || Date.now() - Date.parse(snapMoi) > 24 * 60 * 60 * 1000;
    if (cu24h) {
      ra.push({
        khoa: `thi_nghiem:thu_metric:${td.id}`,
        loai: "thi_nghiem",
        chu_loai: "thong_diep",
        chu_id: td.id,
        tieu_de: "Thu thập metric provider mới",
        mo_ta:
          `Có ${giaoCoMetric.length} lần giao provider đã nhận nhưng snapshot metric ` +
          (snapMoi ? `mới nhất từ ${snapMoi} (>24h).` : "chưa từng thu."),
        quan_sat: [
          {
            mo_ta: "lần giao provider đã nhận (chua chắc tới đích)",
            gia_tri: giaoCoMetric.length,
            nguon: "provider",
          },
          { mo_ta: "snapshot metric mới nhất", gia_tri: snapMoi ?? "chưa có", nguon: "provider" },
        ],
        bat_dinh: batDinh,
        hanh_dong: { loai_tao: "thu_metric" },
      });
    }
  }

  return ra;
}

// Đồng bộ ứng viên vào bảng goi_y_ket_qua: khoa ổn định → đọc lặp không
// tạo trùng; gợi ý đã quyết (chap_nhan/tu_choi) không bị reset. Dòng
// 'moi' không còn trong tập ứng viên → đóng 'het_han' để không chấp nhận
// được trên quan sát lỗi thời (vd link đã có click).
export function dongBoGoiY(db: Database, phamVi: { thongDiepId?: string } = {}): void {
  const dsTd = phamVi.thongDiepId
    ? ([layThongDiep(db, phamVi.thongDiepId)].filter(Boolean) as ThongDiep[])
    : danhSachThongDiep(db);
  txn(db, () => {
    for (const td of dsTd) {
      const uvMoi = ungVienTheoThongDiep(db, td);
      const dsKhoa = [...new Set(uvMoi.map((u) => u.khoa))];
      const ph = dsKhoa.length > 0 ? dsKhoa.map(() => "?").join(",") : "''";
      db.query(
        `UPDATE goi_y_ket_qua SET trang_thai = 'het_han'
         WHERE trang_thai = 'moi' AND chu_loai = 'thong_diep' AND chu_id = ?
           AND khoa NOT IN (${ph})`,
      ).run(td.id, ...dsKhoa);
      for (const uv of uvMoi) {
        const cu = db
          .query("SELECT id FROM goi_y_ket_qua WHERE khoa = ?")
          .get(uv.khoa) as { id: string } | null;
        if (cu) {
          // Số liệu có thể đổi — làm tươi mô tả + quan sát cho bản 'moi'.
          db.query(
            `UPDATE goi_y_ket_qua SET mo_ta = ?, quan_sat = ?, bat_dinh = ?
             WHERE khoa = ? AND trang_thai = 'moi'`,
          ).run(uv.mo_ta, JSON.stringify(uv.quan_sat), uv.bat_dinh, uv.khoa);
          continue;
        }
        db.query(
          `INSERT INTO goi_y_ket_qua
             (id, khoa, loai, chu_loai, chu_id, tieu_de, mo_ta, quan_sat, bat_dinh, hanh_dong, trang_thai, tao_luc)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'moi', ?)`,
        ).run(
          crypto.randomUUID(),
          uv.khoa,
          uv.loai,
          uv.chu_loai,
          uv.chu_id,
          uv.tieu_de,
          uv.mo_ta,
          JSON.stringify(uv.quan_sat),
          uv.bat_dinh,
          JSON.stringify(uv.hanh_dong),
          bayGio(),
        );
      }
    }
  });
}

export function danhSachGoiYKetQua(
  db: Database,
  loc: { thongDiepId?: string; trangThai?: string } = {},
): GoiYKetQua[] {
  dongBoGoiY(db, { thongDiepId: loc.thongDiepId });
  const ds = db
    .query("SELECT * FROM goi_y_ket_qua ORDER BY tao_luc DESC")
    .all() as DongGoiY[];
  return ds
    .map(docGoiY)
    .filter(
      (g) =>
        (!loc.thongDiepId || g.chu_id === loc.thongDiepId) &&
        (!loc.trangThai || g.trang_thai === loc.trangThai),
    );
}

export function layGoiY(db: Database, id: string): GoiYKetQua | null {
  const r = db.query("SELECT * FROM goi_y_ket_qua WHERE id = ?").get(id) as DongGoiY | null;
  return r ? docGoiY(r) : null;
}

function ketThucGoiY(
  db: Database,
  id: string,
  trangThai: string,
  ketQua: Record<string, unknown>,
  tacGia: string,
) {
  db.query(
    "UPDATE goi_y_ket_qua SET trang_thai = ?, ket_qua = ?, quyet_luc = ? WHERE id = ?",
  ).run(trangThai, JSON.stringify(ketQua), bayGio(), id);
  ghiSuKien(
    db,
    "goi_y_ket_qua",
    id,
    trangThai === "chap_nhan" ? "chap_nhan" : "tu_choi",
    ketQua,
    tacGia,
  );
}

// Chấp nhận gợi ý = tạo việc liên kết:
// - loai_tao 'ban_the_hien' (nhap_tiep / thi_nghiem): find-or-create đầu
//   ra dưới CÙNG thông điệp (dòng nguồn giữ nguyên) + enqueue job sinh —
//   nháp đi qua review pipeline thường, không đăng âm thầm.
// - loai_tao 'thu_metric': kéo snapshot provider cho lần giao có metric.
// - loai_tao 'cau_hoi_mo': ghi nhận câu hỏi mở — người dùng trả lời ở
//   lần cập nhật intake/nội dung tới; không tạo artifact nội dung.
export async function chapNhanGoiY(
  db: Database,
  id: string,
  tacGia: string,
  cauHinhKenh?: CauHinhKenh,
): Promise<GoiYKetQua> {
  const g = layGoiY(db, id);
  if (!g) loiRequest(404, "KHONG_TIM_THAY", "Không tìm thấy gợi ý.");
  if (g.trang_thai !== "moi") {
    throw new LoiApi(409, "XUNG_DOT_TRANG_THAI", `Gợi ý đã '${g.trang_thai}'.`);
  }
  const hd = g.hanh_dong;
  if (hd.loai_tao === "ban_the_hien") {
    const khoa = {
      thong_diep_id: String(hd.thong_diep_id ?? g.chu_id),
      dinh_dang: String(hd.dinh_dang ?? "bai-viet"),
      ngon_ngu: String(hd.ngon_ngu ?? "vi"),
      doi_tuong: String(hd.doi_tuong ?? ""),
      dich_den: String(hd.dich_den ?? ""),
    };
    const ketQua = txn(db, () => {
      const bth = timBanTheHien(db, khoa) ?? taoBanTheHien(db, khoa, tacGia);
      // Context hồ sơ giống route /api/job: resolve doi_tuong_id từ tên
      // hiển thị, thuong_hieu_id từ campaign của thông điệp, thi_truong_id
      // từ link ngược thi_truong.thong_diep_id — payload thiếu thì
      // lapContextSinh mất overlay hồ sơ đối tượng/fact local.
      const tdJob = layThongDiep(db, khoa.thong_diep_id);
      const dtId =
        danhSachDoiTuong(db).find((d) => d.ten === khoa.doi_tuong)?.id ?? undefined;
      const cpJob = tdJob?.campaign_id ? layCampaign(db, tdJob.campaign_id) : null;
      const ttId = (
        db
          .query("SELECT id FROM thi_truong WHERE thong_diep_id = ?")
          .get(khoa.thong_diep_id) as { id: string } | null
      )?.id;
      const { job, da_tao } = enqueueJob(db, {
        loai: "sinh_ban_the_hien",
        payload: {
          thong_diep_id: khoa.thong_diep_id,
          dinh_dang: khoa.dinh_dang,
          ngon_ngu: khoa.ngon_ngu,
          doi_tuong: khoa.doi_tuong,
          doi_tuong_id: dtId,
          thuong_hieu_id: cpJob?.thuong_hieu_id ?? undefined,
          thi_truong_id: ttId,
          dich_den: khoa.dich_den,
          ban_the_hien_id: bth.id,
          goi_y_id: id,
        },
        khoaIdem: `sinh_ban_the_hien:${bth.id}`,
        entityLoai: "ban_the_hien",
        entityId: bth.id,
        revisionId: bth.head_revision_id ?? null,
      });
      return { ban_the_hien_id: bth.id, job_id: job.id, da_tao_job: da_tao, goi_y_id: id };
    });
    ketThucGoiY(db, id, "chap_nhan", ketQua, tacGia);
    log.info("ket_qua.goi_y_chap_nhan", { id, ban_the_hien_id: ketQua.ban_the_hien_id });
    return layGoiY(db, id)!;
  }
  if (hd.loai_tao === "thu_metric") {
    const kq = await thuThapMetricGiao(db, cauHinhKenh);
    ketThucGoiY(db, id, "chap_nhan", { ...kq, loai: "thu_metric" }, tacGia);
    return layGoiY(db, id)!;
  }
  // cau_hoi_mo: chấp nhận = ghi nhận câu hỏi đang mở để trả lời.
  ketThucGoiY(db, id, "chap_nhan", { cau_hoi_mo: g.tieu_de }, tacGia);
  return layGoiY(db, id)!;
}

export function tuChoiGoiY(db: Database, id: string, tacGia: string): GoiYKetQua {
  const g = layGoiY(db, id);
  if (!g) loiRequest(404, "KHONG_TIM_THAY", "Không tìm thấy gợi ý.");
  if (g.trang_thai !== "moi") {
    throw new LoiApi(409, "XUNG_DOT_TRANG_THAI", `Gợi ý đã '${g.trang_thai}'.`);
  }
  ketThucGoiY(db, id, "tu_choi", {}, tacGia);
  return layGoiY(db, id)!;
}
