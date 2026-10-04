import type { Database } from "bun:sqlite";
import { loiRequest } from "../../loi.ts";

// Module context: hồ sơ thương hiệu (preset cấp instance) + hồ sơ đối tượng,
// bảng dịch thuật ngữ, revision hồ sơ immutable, và context sinh đã lắp.
// Một instance = một thư viện nội dung: hồ sơ không thuộc tenant/workspace nào.
// Trường text rỗng của hồ sơ đối tượng nghĩa là "chưa biết" — không bịa
// nhân khẩu học, điểm tin cậy hay kiến thức hành vi.

export const DANH_SACH_NGUON_DU_LIEU = ["nguoi_dung", "he_thong"] as const;
export type NguonDuLieu = (typeof DANH_SACH_NGUON_DU_LIEU)[number];

// Từ vựng độ sâu mong muốn; "" = chưa biết.
export const DANH_SACH_DO_SAU = ["so_luoc", "vua_phai", "chuyen_sau"] as const;

export type HoSoThuongHieu = {
  id: string;
  ten: string;
  nhan_dien: string;
  ngon_ngu_uu_tien: string[];
  vi_du_giong_van: string;
  nguyen_tac: string;
  claim_duyet: string[];
  claim_cam: string[];
  assets: string[];
  la_fixture: boolean;
  nguon_du_lieu: string;
  tao_luc: string;
  tao_boi: string;
  cap_nhat_luc: string;
  cap_nhat_boi: string;
};

export type HoSoDoiTuong = {
  id: string;
  ten: string;
  ngon_ngu: string;
  dia_diem: string;
  kien_thuc_nen: string;
  moi_quan_tam: string;
  do_sau: string;
  tu_vung: string;
  quan_he_to_chuc: string;
  nhu_cau_giao_tiep: string;
  nhan_khau_hoc: string;
  la_fixture: boolean;
  nguon_du_lieu: string;
  tao_luc: string;
  tao_boi: string;
  cap_nhat_luc: string;
  cap_nhat_boi: string;
};

export type ThuatNgu = {
  id: string;
  thuong_hieu_id: string;
  thuat_ngu: string;
  giu_nguyen: boolean;
  ban_dich: Record<string, string>;
  cap_nhat_luc: string;
  cap_nhat_boi: string;
};

export type HoSoRevision = {
  id: string;
  loai: string;
  ho_so_id: string;
  so_thu_tu: number;
  snapshot: string;
  nguon_du_lieu: string;
  tao_luc: string;
  tao_boi: string;
};

export type ContextSinh = {
  id: string;
  thuong_hieu_id: string | null;
  thuong_hieu_revision_id: string | null;
  doi_tuong_id: string | null;
  doi_tuong_revision_id: string | null;
  ghi_de: string;
  snapshot: string;
  tao_luc: string;
};

// Context đã lắp cho một lần sinh nội dung. Hai phần tách riêng:
// `thuong_hieu` giữ ràng buộc biên tập, `doi_tuong` giữ sở thích độc giả.
export type ContextThuongHieu = Omit<HoSoThuongHieu, "id" | "la_fixture" | "nguon_du_lieu"> & {
  ho_so_id: string;
  revision_id: string | null;
  revision_so: number | null;
  thuat_ngu: { thuat_ngu: string; giu_nguyen: boolean; ban_dich: Record<string, string> }[];
};

export type ContextDoiTuong = Omit<HoSoDoiTuong, "id" | "la_fixture" | "nguon_du_lieu"> & {
  ho_so_id: string;
  revision_id: string | null;
  revision_so: number | null;
};

export type GhiDeCampaign = {
  thuong_hieu?: Record<string, unknown>;
  doi_tuong?: Record<string, unknown>;
};

export type ContextSinhSnapshot = {
  thuong_hieu: ContextThuongHieu | null;
  doi_tuong: ContextDoiTuong | null;
  ghi_de: GhiDeCampaign;
};

const bayGio = () => new Date().toISOString();

// --- Input ---

export type NhapThuongHieu = {
  ten: string;
  nhan_dien?: string;
  ngon_ngu_uu_tien?: string[];
  vi_du_giong_van?: string;
  nguyen_tac?: string;
  claim_duyet?: string[];
  claim_cam?: string[];
  assets?: string[];
};

export type NhapDoiTuong = {
  ten: string;
  ngon_ngu?: string;
  dia_diem?: string;
  kien_thuc_nen?: string;
  moi_quan_tam?: string;
  do_sau?: string;
  tu_vung?: string;
  quan_he_to_chuc?: string;
  nhu_cau_giao_tiep?: string;
  nhan_khau_hoc?: string;
};

export type NhapThuatNgu = {
  thuat_ngu: string;
  giu_nguyen?: boolean;
  ban_dich?: Record<string, string>;
};

// --- Đọc row → API shape (JSON field đã parse) ---

type DongThuongHieu = Omit<HoSoThuongHieu, "ngon_ngu_uu_tien" | "claim_duyet" | "claim_cam" | "assets" | "la_fixture"> & {
  ngon_ngu_uu_tien: string;
  claim_duyet: string;
  claim_cam: string;
  assets: string;
  la_fixture: number;
};

type DongDoiTuong = Omit<HoSoDoiTuong, "la_fixture"> & { la_fixture: number };

type DongThuatNgu = Omit<ThuatNgu, "giu_nguyen" | "ban_dich"> & {
  giu_nguyen: number;
  ban_dich: string;
};

function docJsonMang(v: string): string[] {
  try {
    const j = JSON.parse(v) as unknown;
    return Array.isArray(j) ? j.map(String) : [];
  } catch {
    return [];
  }
}

function docJsonMap(v: string): Record<string, string> {
  try {
    const j = JSON.parse(v) as unknown;
    if (typeof j !== "object" || j === null || Array.isArray(j)) return {};
    return Object.fromEntries(Object.entries(j).map(([k, x]) => [k, String(x)]));
  } catch {
    return {};
  }
}

function docThuongHieu(row: DongThuongHieu): HoSoThuongHieu {
  return {
    ...row,
    ngon_ngu_uu_tien: docJsonMang(row.ngon_ngu_uu_tien),
    claim_duyet: docJsonMang(row.claim_duyet),
    claim_cam: docJsonMang(row.claim_cam),
    assets: docJsonMang(row.assets),
    la_fixture: row.la_fixture === 1,
  };
}

function docDoiTuong(row: DongDoiTuong): HoSoDoiTuong {
  return { ...row, la_fixture: row.la_fixture === 1 };
}

function docThuatNgu(row: DongThuatNgu): ThuatNgu {
  return { ...row, giu_nguyen: row.giu_nguyen === 1, ban_dich: docJsonMap(row.ban_dich) };
}

// --- Revision hồ sơ ---

function ghiRevisionHoSo(
  db: Database,
  loai: "thuong_hieu" | "doi_tuong",
  hoSoId: string,
  snapshot: unknown,
  nguonDuLieu: NguonDuLieu,
  tacGia: string,
): void {
  const soTiep =
    ((
      db
        .query("SELECT MAX(so_thu_tu) AS m FROM ho_so_revision WHERE loai = ? AND ho_so_id = ?")
        .get(loai, hoSoId) as { m: number | null }
    ).m ?? 0) + 1;
  db.query(
    "INSERT INTO ho_so_revision (id, loai, ho_so_id, so_thu_tu, snapshot, nguon_du_lieu, tao_luc, tao_boi) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(crypto.randomUUID(), loai, hoSoId, soTiep, JSON.stringify(snapshot), nguonDuLieu, bayGio(), tacGia);
}

export function danhSachHoSoRevision(db: Database, loai: string, hoSoId: string): HoSoRevision[] {
  return db
    .query("SELECT * FROM ho_so_revision WHERE loai = ? AND ho_so_id = ? ORDER BY so_thu_tu DESC")
    .all(loai, hoSoId) as HoSoRevision[];
}

// Snapshot hồ sơ thương hiệu gồm cả bảng thuật ngữ — thuật ngữ là một phần hồ sơ.
function snapshotThuongHieu(db: Database, hoSo: HoSoThuongHieu): unknown {
  return { ...hoSo, thuat_ngu: danhSachThuatNgu(db, hoSo.id) };
}

// --- Hồ sơ thương hiệu ---

export function danhSachThuongHieu(db: Database): HoSoThuongHieu[] {
  return (db.query("SELECT * FROM ho_so_thuong_hieu ORDER BY tao_luc").all() as DongThuongHieu[]).map(
    docThuongHieu,
  );
}

export function layThuongHieu(db: Database, id: string): HoSoThuongHieu | null {
  const row = db.query("SELECT * FROM ho_so_thuong_hieu WHERE id = ?").get(id) as DongThuongHieu | null;
  return row ? docThuongHieu(row) : null;
}

// Tùy chọn tạo hồ sơ: id cố định + cờ fixture cho seed, nguồn dữ liệu cho ghi revision.
export type TuyChonTaoHoSo = {
  nguonDuLieu?: NguonDuLieu;
  id?: string;
  laFixture?: boolean;
};

export function taoThuongHieu(
  db: Database,
  input: NhapThuongHieu,
  tacGia: string,
  tuyChon: TuyChonTaoHoSo = {},
): HoSoThuongHieu {
  const id = tuyChon.id ?? crypto.randomUUID();
  const nguonDuLieu = tuyChon.nguonDuLieu ?? "nguoi_dung";
  const ts = bayGio();
  db.query(
    `INSERT INTO ho_so_thuong_hieu
       (id, ten, nhan_dien, ngon_ngu_uu_tien, vi_du_giong_van, nguyen_tac, claim_duyet, claim_cam, assets, la_fixture, nguon_du_lieu, tao_luc, tao_boi, cap_nhat_luc, cap_nhat_boi)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.ten,
    input.nhan_dien ?? "",
    JSON.stringify(input.ngon_ngu_uu_tien ?? []),
    input.vi_du_giong_van ?? "",
    input.nguyen_tac ?? "",
    JSON.stringify(input.claim_duyet ?? []),
    JSON.stringify(input.claim_cam ?? []),
    JSON.stringify(input.assets ?? []),
    tuyChon.laFixture ? 1 : 0,
    nguonDuLieu,
    ts,
    tacGia,
    ts,
    tacGia,
  );
  const hoSo = layThuongHieu(db, id)!;
  ghiRevisionHoSo(db, "thuong_hieu", id, snapshotThuongHieu(db, hoSo), nguonDuLieu, tacGia);
  return hoSo;
}

export function capNhatThuongHieu(
  db: Database,
  id: string,
  input: NhapThuongHieu,
  tacGia: string,
  nguonDuLieu: NguonDuLieu = "nguoi_dung",
): HoSoThuongHieu {
  const cu = layThuongHieu(db, id);
  if (!cu) loiRequest(404, "KHONG_TIM_THAY", "Không tìm thấy hồ sơ thương hiệu.");
  db.query(
    `UPDATE ho_so_thuong_hieu SET
       ten = ?, nhan_dien = ?, ngon_ngu_uu_tien = ?, vi_du_giong_van = ?, nguyen_tac = ?,
       claim_duyet = ?, claim_cam = ?, assets = ?, nguon_du_lieu = ?, cap_nhat_luc = ?, cap_nhat_boi = ?
     WHERE id = ?`,
  ).run(
    input.ten,
    input.nhan_dien ?? "",
    JSON.stringify(input.ngon_ngu_uu_tien ?? []),
    input.vi_du_giong_van ?? "",
    input.nguyen_tac ?? "",
    JSON.stringify(input.claim_duyet ?? []),
    JSON.stringify(input.claim_cam ?? []),
    JSON.stringify(input.assets ?? []),
    nguonDuLieu,
    bayGio(),
    tacGia,
    id,
  );
  const hoSo = layThuongHieu(db, id)!;
  ghiRevisionHoSo(db, "thuong_hieu", id, snapshotThuongHieu(db, hoSo), nguonDuLieu, tacGia);
  return hoSo;
}

// Xóa hồ sơ: thuật ngữ xóa theo cascade; revision hồ sơ xóa cùng.
// context_sinh giữ nguyên — snapshot đã tự đủ, nội dung đã sinh không mất context.
export function xoaThuongHieu(db: Database, id: string): void {
  if (!layThuongHieu(db, id)) loiRequest(404, "KHONG_TIM_THAY", "Không tìm thấy hồ sơ thương hiệu.");
  db.exec("BEGIN IMMEDIATE");
  try {
    db.query("DELETE FROM ho_so_revision WHERE loai = 'thuong_hieu' AND ho_so_id = ?").run(id);
    db.query("DELETE FROM ho_so_thuong_hieu WHERE id = ?").run(id);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

// --- Bảng dịch thuật ngữ ---

export function danhSachThuatNgu(db: Database, thuongHieuId: string): ThuatNgu[] {
  return (
    db
      .query("SELECT * FROM thuat_ngu WHERE thuong_hieu_id = ? ORDER BY thuat_ngu")
      .all(thuongHieuId) as DongThuatNgu[]
  ).map(docThuatNgu);
}

// Thay toàn bộ bảng thuật ngữ của một hồ sơ. Một thay đổi = một revision hồ sơ.
export function thayThuatNgu(
  db: Database,
  thuongHieuId: string,
  ds: NhapThuatNgu[],
  tacGia: string,
  nguonDuLieu: NguonDuLieu = "nguoi_dung",
): ThuatNgu[] {
  const hoSo = layThuongHieu(db, thuongHieuId);
  if (!hoSo) loiRequest(404, "KHONG_TIM_THAY", "Không tìm thấy hồ sơ thương hiệu.");
  const ts = bayGio();
  db.exec("BEGIN IMMEDIATE");
  try {
    db.query("DELETE FROM thuat_ngu WHERE thuong_hieu_id = ?").run(thuongHieuId);
    for (const t of ds) {
      db.query(
        "INSERT INTO thuat_ngu (id, thuong_hieu_id, thuat_ngu, giu_nguyen, ban_dich, cap_nhat_luc, cap_nhat_boi) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ).run(
        crypto.randomUUID(),
        thuongHieuId,
        t.thuat_ngu,
        t.giu_nguyen ? 1 : 0,
        JSON.stringify(t.ban_dich ?? {}),
        ts,
        tacGia,
      );
    }
    db.query(
      "UPDATE ho_so_thuong_hieu SET nguon_du_lieu = ?, cap_nhat_luc = ?, cap_nhat_boi = ? WHERE id = ?",
    ).run(nguonDuLieu, ts, tacGia, thuongHieuId);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  const dsMoi = danhSachThuatNgu(db, thuongHieuId);
  const hoSoMoi = layThuongHieu(db, thuongHieuId)!;
  ghiRevisionHoSo(db, "thuong_hieu", thuongHieuId, { ...hoSoMoi, thuat_ngu: dsMoi }, nguonDuLieu, tacGia);
  return dsMoi;
}

// --- Hồ sơ đối tượng ---

export function danhSachDoiTuong(db: Database): HoSoDoiTuong[] {
  return (db.query("SELECT * FROM ho_so_doi_tuong ORDER BY tao_luc").all() as DongDoiTuong[]).map(
    docDoiTuong,
  );
}

export function layDoiTuong(db: Database, id: string): HoSoDoiTuong | null {
  const row = db.query("SELECT * FROM ho_so_doi_tuong WHERE id = ?").get(id) as DongDoiTuong | null;
  return row ? docDoiTuong(row) : null;
}

export function taoDoiTuong(
  db: Database,
  input: NhapDoiTuong,
  tacGia: string,
  tuyChon: TuyChonTaoHoSo = {},
): HoSoDoiTuong {
  const id = tuyChon.id ?? crypto.randomUUID();
  const nguonDuLieu = tuyChon.nguonDuLieu ?? "nguoi_dung";
  const ts = bayGio();
  db.query(
    `INSERT INTO ho_so_doi_tuong
       (id, ten, ngon_ngu, dia_diem, kien_thuc_nen, moi_quan_tam, do_sau, tu_vung, quan_he_to_chuc, nhu_cau_giao_tiep, nhan_khau_hoc, la_fixture, nguon_du_lieu, tao_luc, tao_boi, cap_nhat_luc, cap_nhat_boi)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.ten,
    input.ngon_ngu ?? "",
    input.dia_diem ?? "",
    input.kien_thuc_nen ?? "",
    input.moi_quan_tam ?? "",
    input.do_sau ?? "",
    input.tu_vung ?? "",
    input.quan_he_to_chuc ?? "",
    input.nhu_cau_giao_tiep ?? "",
    input.nhan_khau_hoc ?? "",
    tuyChon.laFixture ? 1 : 0,
    nguonDuLieu,
    ts,
    tacGia,
    ts,
    tacGia,
  );
  const hoSo = layDoiTuong(db, id)!;
  ghiRevisionHoSo(db, "doi_tuong", id, hoSo, nguonDuLieu, tacGia);
  return hoSo;
}

export function capNhatDoiTuong(
  db: Database,
  id: string,
  input: NhapDoiTuong,
  tacGia: string,
  nguonDuLieu: NguonDuLieu = "nguoi_dung",
): HoSoDoiTuong {
  if (!layDoiTuong(db, id)) loiRequest(404, "KHONG_TIM_THAY", "Không tìm thấy hồ sơ đối tượng.");
  db.query(
    `UPDATE ho_so_doi_tuong SET
       ten = ?, ngon_ngu = ?, dia_diem = ?, kien_thuc_nen = ?, moi_quan_tam = ?, do_sau = ?,
       tu_vung = ?, quan_he_to_chuc = ?, nhu_cau_giao_tiep = ?, nhan_khau_hoc = ?,
       nguon_du_lieu = ?, cap_nhat_luc = ?, cap_nhat_boi = ?
     WHERE id = ?`,
  ).run(
    input.ten,
    input.ngon_ngu ?? "",
    input.dia_diem ?? "",
    input.kien_thuc_nen ?? "",
    input.moi_quan_tam ?? "",
    input.do_sau ?? "",
    input.tu_vung ?? "",
    input.quan_he_to_chuc ?? "",
    input.nhu_cau_giao_tiep ?? "",
    input.nhan_khau_hoc ?? "",
    nguonDuLieu,
    bayGio(),
    tacGia,
    id,
  );
  const hoSo = layDoiTuong(db, id)!;
  ghiRevisionHoSo(db, "doi_tuong", id, hoSo, nguonDuLieu, tacGia);
  return hoSo;
}

export function xoaDoiTuong(db: Database, id: string): void {
  if (!layDoiTuong(db, id)) loiRequest(404, "KHONG_TIM_THAY", "Không tìm thấy hồ sơ đối tượng.");
  db.exec("BEGIN IMMEDIATE");
  try {
    db.query("DELETE FROM ho_so_revision WHERE loai = 'doi_tuong' AND ho_so_id = ?").run(id);
    db.query("DELETE FROM ho_so_doi_tuong WHERE id = ?").run(id);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

// --- Context sinh ---

const TRUONG_GHI_DE_THUONG_HIEU = new Set([
  "ten",
  "nhan_dien",
  "ngon_ngu_uu_tien",
  "vi_du_giong_van",
  "nguyen_tac",
  "claim_duyet",
  "claim_cam",
  "assets",
]);

const TRUONG_GHI_DE_DOI_TUONG = new Set([
  "ten",
  "ngon_ngu",
  "dia_diem",
  "kien_thuc_nen",
  "moi_quan_tam",
  "do_sau",
  "tu_vung",
  "quan_he_to_chuc",
  "nhu_cau_giao_tiep",
  "nhan_khau_hoc",
]);

// Ghi đè theo campaign: chỉ key đã biết mới áp; mảng thay nguyên mảng, chuỗi thay nguyên chuỗi.
function apGhiDe<T extends Record<string, unknown>>(
  goc: T,
  ghiDe: Record<string, unknown> | undefined,
  truongChoPhep: Set<string>,
): T {
  if (!ghiDe) return goc;
  const ketQua = { ...goc };
  for (const [k, v] of Object.entries(ghiDe)) {
    if (!truongChoPhep.has(k)) continue;
    if (Array.isArray(v)) {
      (ketQua as Record<string, unknown>)[k] = v.map(String);
    } else if (typeof v === "string") {
      (ketQua as Record<string, unknown>)[k] = v;
    }
  }
  return ketQua;
}

function revisionMoiNhat(
  db: Database,
  loai: string,
  hoSoId: string,
): { id: string; so_thu_tu: number } | null {
  return (
    (db
      .query(
        "SELECT id, so_thu_tu FROM ho_so_revision WHERE loai = ? AND ho_so_id = ? ORDER BY so_thu_tu DESC LIMIT 1",
      )
      .get(loai, hoSoId) as { id: string; so_thu_tu: number } | null) ?? null
  );
}

export type NhapContextSinh = {
  thuong_hieu_id?: string | null;
  doi_tuong_id?: string | null;
  ghi_de?: GhiDeCampaign;
};

// Lắp context sinh: resolve preset + áp ghi đè. Không ghi DB.
export function lapContextSinh(db: Database, input: NhapContextSinh): ContextSinhSnapshot {
  const ghiDe: GhiDeCampaign =
    typeof input.ghi_de === "object" && input.ghi_de !== null && !Array.isArray(input.ghi_de)
      ? input.ghi_de
      : {};

  let thuongHieu: ContextThuongHieu | null = null;
  if (input.thuong_hieu_id) {
    const hoSo = layThuongHieu(db, input.thuong_hieu_id);
    if (!hoSo) loiRequest(404, "KHONG_TIM_THAY", "Không tìm thấy hồ sơ thương hiệu.");
    const { id, la_fixture: _f, nguon_du_lieu: _n, ...phanHoSo } = hoSo;
    const daGhiDe = apGhiDe(
      phanHoSo as Record<string, unknown>,
      ghiDe.thuong_hieu,
      TRUONG_GHI_DE_THUONG_HIEU,
    );
    const revTh = revisionMoiNhat(db, "thuong_hieu", id);
    thuongHieu = {
      ...(daGhiDe as Omit<ContextThuongHieu, "ho_so_id" | "revision_id" | "revision_so" | "thuat_ngu">),
      ho_so_id: id,
      revision_id: revTh?.id ?? null,
      revision_so: revTh?.so_thu_tu ?? null,
      thuat_ngu: danhSachThuatNgu(db, id).map((t) => ({
        thuat_ngu: t.thuat_ngu,
        giu_nguyen: t.giu_nguyen,
        ban_dich: t.ban_dich,
      })),
    };
  }

  let doiTuong: ContextDoiTuong | null = null;
  if (input.doi_tuong_id) {
    const hoSo = layDoiTuong(db, input.doi_tuong_id);
    if (!hoSo) loiRequest(404, "KHONG_TIM_THAY", "Không tìm thấy hồ sơ đối tượng.");
    const { id, la_fixture: _f, nguon_du_lieu: _n, ...phanHoSo } = hoSo;
    const daGhiDe = apGhiDe(
      phanHoSo as Record<string, unknown>,
      ghiDe.doi_tuong,
      TRUONG_GHI_DE_DOI_TUONG,
    );
    const revDt = revisionMoiNhat(db, "doi_tuong", id);
    doiTuong = {
      ...(daGhiDe as Omit<ContextDoiTuong, "ho_so_id" | "revision_id" | "revision_so">),
      ho_so_id: id,
      revision_id: revDt?.id ?? null,
      revision_so: revDt?.so_thu_tu ?? null,
    };
  }

  return { thuong_hieu: thuongHieu, doi_tuong: doiTuong, ghi_de: ghiDe };
}

// Lưu một context sinh đã lắp vào DB (gọi khi thật sự sinh nội dung).
export function luuContextSinh(db: Database, input: NhapContextSinh): ContextSinh {
  const snapshot = lapContextSinh(db, input);
  const id = crypto.randomUUID();
  db.query(
    `INSERT INTO context_sinh
       (id, thuong_hieu_id, thuong_hieu_revision_id, doi_tuong_id, doi_tuong_revision_id, ghi_de, snapshot, tao_luc)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.thuong_hieu_id ?? null,
    snapshot.thuong_hieu?.revision_id ?? null,
    input.doi_tuong_id ?? null,
    snapshot.doi_tuong?.revision_id ?? null,
    JSON.stringify(snapshot.ghi_de),
    JSON.stringify(snapshot),
    bayGio(),
  );
  return db.query("SELECT * FROM context_sinh WHERE id = ?").get(id) as ContextSinh;
}

export function layContextSinh(db: Database, id: string): ContextSinh | null {
  return (db.query("SELECT * FROM context_sinh WHERE id = ?").get(id) as ContextSinh | null) ?? null;
}
