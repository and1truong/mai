import type { Database } from "bun:sqlite";
import { LoiApi, loiRequest } from "../../loi.ts";
import { DANH_SACH_TRANG_THAI, chuyenHopLe, laTrangThai } from "../review/index.ts";
import type { GhiDeCampaign } from "../context/index.ts";
import { layDinhDang } from "../formats/index.ts";

// Module nội dung: contract dữ liệu dùng chung cho mọi story MAI.
//
// - nguon: tài liệu nguồn cấp instance; entity giữ state hiện tại,
//   nguon_revision là snapshot immutable (pattern giống hồ sơ/ho_so_revision).
//   cac_muc chứa định danh fact/section có cấu trúc + tham chiếu asset.
// - campaign: nhóm mục tiêu tùy chọn; bài đăng lẻ không bắt buộc campaign.
// - thong_diep: thông điệp chuẩn; nhiều-nhiều với nguồn qua thong_diep_nguon.
//   thong_diep_revision ghim nguon_revision_ids đã dùng → truy về đúng nguồn.
// - ban_the_hien: một đầu ra của thông điệp theo (định dạng, ngôn ngữ,
//   đối tượng, đích đến); revision nội dung ghim revision thông điệp +
//   context sinh đã dùng khi sinh.
// - duyet/xuat_ban: record review theo revision và record xuất bản tách
//   khỏi trạng thái nội dung — được sinh không đồng nghĩa đã đăng.
// - su_kien: log mutation nhẹ kèm actor local; #16 gắn authorization sau.

// --- Kiểu ---

export const DANH_SACH_LOAI_MUC = ["section", "fact"] as const;
export type LoaiMuc = (typeof DANH_SACH_LOAI_MUC)[number];

// Một mục trong nguồn: định danh ổn định để ticket sau (vd #14) tham chiếu
// đúng fact/section khi nguồn đổi. assets = tên file trong MAI_DATA_DIR/assets.
export type MucNguon = {
  id: string;
  loai: LoaiMuc;
  tieu_de?: string;
  noi_dung: string;
  assets: string[];
};

export type Nguon = {
  id: string;
  tieu_de: string;
  noi_dung: string;
  loai: string;
  cac_muc: MucNguon[];
  head_revision_id: string | null;
  tao_luc: string;
  tao_boi: string;
  cap_nhat_luc: string;
};

export type NguonRevision = {
  id: string;
  nguon_id: string;
  so_thu_tu: number;
  tieu_de: string;
  loai: string;
  noi_dung: string;
  cac_muc: MucNguon[];
  dua_tren_revision_id: string | null;
  khoa_idem: string | null;
  tao_luc: string;
  tao_boi: string;
};

export type Campaign = {
  id: string;
  ten: string;
  mo_ta: string;
  ghi_de: GhiDeCampaign;
  tao_luc: string;
  tao_boi: string;
  cap_nhat_luc: string;
  cap_nhat_boi: string;
};

export type ThongDiep = {
  id: string;
  campaign_id: string | null;
  tieu_de: string;
  noi_dung: string;
  head_revision_id: string | null;
  tao_luc: string;
  tao_boi: string;
  cap_nhat_luc: string;
  cap_nhat_boi: string;
};

export type ThongDiepRevision = {
  id: string;
  thong_diep_id: string;
  so_thu_tu: number;
  tieu_de: string;
  noi_dung: string;
  nguon_revision_ids: string[];
  dua_tren_revision_id: string | null;
  tao_luc: string;
  tao_boi: string;
};

export type BanTheHien = {
  id: string;
  thong_diep_id: string;
  dinh_dang: string;
  ngon_ngu: string;
  phien_ban_dinh_dang: number;
  doi_tuong: string;
  dich_den: string;
  trang_thai: string;
  head_revision_id: string | null;
  tao_luc: string;
  tao_boi: string;
};

export type Revision = {
  id: string;
  ban_the_hien_id: string;
  so_thu_tu: number;
  noi_dung: string;
  dua_tren_revision_id: string | null;
  context_sinh_id: string | null;
  thong_diep_revision_id: string | null;
  tao_luc: string;
  tao_boi: string;
};

export type Duyet = {
  id: string;
  ban_the_hien_id: string;
  revision_id: string | null;
  tu_trang_thai: string;
  den_trang_thai: string;
  ghi_chu: string;
  tao_luc: string;
  tao_boi: string;
};

export type XuatBan = {
  id: string;
  ban_the_hien_id: string;
  revision_id: string;
  dich_den: string;
  ghi_chu: string;
  // Snapshot id asset được chọn tại thời điểm đăng (export chỉ gồm phần
  // được chọn tường minh — #17).
  asset_ids: string[];
  tao_luc: string;
  tao_boi: string;
};

export type SuKien = {
  id: number;
  entity_loai: string;
  entity_id: string;
  su_kien: string;
  du_lieu: string;
  actor: string;
  tao_luc: string;
};

const bayGio = () => new Date().toISOString();

// Bọc một gói ghi trong transaction; gọi lồng nhau được (bên trong transaction
// có sẵn thì chạy thẳng) — composite như nhapBaiViet giữ nguyên tử toàn cục.
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

// --- Sự kiện mutation ---

// Ghi một sự kiện mutation nhẹ kèm actor local. Không mở transaction —
// luôn đi cùng mutation chính trong cùng giao dịch.
export function ghiSuKien(
  db: Database,
  entityLoai: string,
  entityId: string,
  suKien: string,
  duLieu: unknown,
  actor: string,
): void {
  db.query(
    "INSERT INTO su_kien (entity_loai, entity_id, su_kien, du_lieu, actor, tao_luc) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(entityLoai, entityId, suKien, JSON.stringify(duLieu ?? {}), actor, bayGio());
}

export function danhSachSuKien(
  db: Database,
  loc: { entityLoai?: string; entityId?: string } = {},
  gioiHan = 200,
): SuKien[] {
  const dieuKien: string[] = [];
  const thamSo: string[] = [];
  if (loc.entityLoai) {
    dieuKien.push("entity_loai = ?");
    thamSo.push(loc.entityLoai);
  }
  if (loc.entityId) {
    dieuKien.push("entity_id = ?");
    thamSo.push(loc.entityId);
  }
  const where = dieuKien.length > 0 ? `WHERE ${dieuKien.join(" AND ")}` : "";
  return db
    .query(`SELECT * FROM su_kien ${where} ORDER BY id DESC LIMIT ?`)
    .all(...thamSo, gioiHan) as SuKien[];
}

// --- Đọc row → API shape (JSON field đã parse) ---

function docCacMucJson(v: string): MucNguon[] {
  try {
    const j = JSON.parse(v) as unknown;
    if (!Array.isArray(j)) return [];
    return j
      .filter((m) => typeof m === "object" && m !== null)
      .map((m) => {
        const r = m as Record<string, unknown>;
        return {
          id: String(r.id ?? ""),
          loai: r.loai === "fact" ? ("fact" as const) : ("section" as const),
          tieu_de: typeof r.tieu_de === "string" ? r.tieu_de : undefined,
          noi_dung: String(r.noi_dung ?? ""),
          assets: Array.isArray(r.assets) ? r.assets.map(String) : [],
        };
      });
  } catch {
    return [];
  }
}

type DongNguon = Omit<Nguon, "cac_muc"> & { cac_muc: string };
type DongNguonRevision = Omit<NguonRevision, "cac_muc"> & { cac_muc: string };
type DongCampaign = Omit<Campaign, "ghi_de"> & { ghi_de: string };
type DongThongDiepRevision = Omit<ThongDiepRevision, "nguon_revision_ids"> & {
  nguon_revision_ids: string;
};

const docNguon = (row: DongNguon): Nguon => ({ ...row, cac_muc: docCacMucJson(row.cac_muc) });
const docNguonRevision = (row: DongNguonRevision): NguonRevision => ({
  ...row,
  cac_muc: docCacMucJson(row.cac_muc),
});
const docCampaign = (row: DongCampaign): Campaign => ({
  ...row,
  ghi_de: JSON.parse(row.ghi_de) as GhiDeCampaign,
});
const docThongDiepRevision = (row: DongThongDiepRevision): ThongDiepRevision => {
  let ids: string[] = [];
  try {
    const j = JSON.parse(row.nguon_revision_ids) as unknown;
    if (Array.isArray(j)) ids = j.map(String);
  } catch {
    // JSON hỏng → coi như không ghim nguồn nào.
  }
  return { ...row, nguon_revision_ids: ids };
};

// Convention xung đột revision: dua_tren_revision_id phải bằng head hiện tại.
function assertDuaTren(head: string | null, duaTren: string | null): void {
  if ((head ?? null) !== (duaTren ?? null)) {
    throw new LoiApi(409, "XUNG_DOT_REVISION", "Đã có revision mới hơn. Tải lại rồi thử lại.", {
      head_revision_id: head,
    });
  }
}

// --- Nguồn ---

export function layNguon(db: Database, id: string): Nguon | null {
  const row = db.query("SELECT * FROM nguon WHERE id = ?").get(id) as DongNguon | null;
  return row ? docNguon(row) : null;
}

export function danhSachNguon(db: Database): Nguon[] {
  return (db.query("SELECT * FROM nguon ORDER BY tao_luc DESC").all() as DongNguon[]).map(docNguon);
}

export function layNguonRevision(db: Database, id: string): NguonRevision | null {
  const row = db
    .query("SELECT * FROM nguon_revision WHERE id = ?")
    .get(id) as DongNguonRevision | null;
  return row ? docNguonRevision(row) : null;
}

export function danhSachNguonRevision(db: Database, nguonId: string): NguonRevision[] {
  return (
    db
      .query("SELECT * FROM nguon_revision WHERE nguon_id = ? ORDER BY so_thu_tu")
      .all(nguonId) as DongNguonRevision[]
  ).map(docNguonRevision);
}

// Tra cứu idempotency của ingest: request nạp retry cùng khoa_idem nhận lại
// đúng revision đã ghi, không tạo trùng (#17).
export function timNguonRevisionTheoKhoaIdem(
  db: Database,
  khoaIdem: string,
): NguonRevision | null {
  const row = db
    .query("SELECT * FROM nguon_revision WHERE khoa_idem = ?")
    .get(khoaIdem) as DongNguonRevision | null;
  return row ? docNguonRevision(row) : null;
}

export type NhapNguon = {
  tieu_de: string;
  noi_dung: string;
  loai?: string;
  cac_muc?: MucNguon[];
  // Khóa idempotency của request nạp (#17); ghi lên revision tạo ra.
  khoa_idem?: string;
};

export type TuyChonTaoNguon = { id?: string };

// Ghi một revision nguồn mới + cập nhật entity + head, trong transaction gọi
// từ caller. Trả revision vừa ghi.
function ghiNguonRevisionTrongTxn(
  db: Database,
  nguonId: string,
  snapshot: {
    tieu_de: string;
    loai: string;
    noi_dung: string;
    cac_muc: MucNguon[];
    khoa_idem?: string;
  },
  duaTren: string | null,
  tacGia: string,
): NguonRevision {
  const nguon = layNguon(db, nguonId)!;
  assertDuaTren(nguon.head_revision_id, duaTren);
  const soTiep =
    ((
      db
        .query("SELECT MAX(so_thu_tu) AS m FROM nguon_revision WHERE nguon_id = ?")
        .get(nguonId) as { m: number | null }
    ).m ?? 0) + 1;
  const id = crypto.randomUUID();
  const ts = bayGio();
  db.query(
    `INSERT INTO nguon_revision
       (id, nguon_id, so_thu_tu, tieu_de, loai, noi_dung, cac_muc, dua_tren_revision_id, khoa_idem, tao_luc, tao_boi)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    nguonId,
    soTiep,
    snapshot.tieu_de,
    snapshot.loai,
    snapshot.noi_dung,
    JSON.stringify(snapshot.cac_muc),
    duaTren,
    snapshot.khoa_idem ?? null,
    ts,
    tacGia,
  );
  db.query(
    "UPDATE nguon SET tieu_de = ?, loai = ?, noi_dung = ?, cac_muc = ?, head_revision_id = ?, cap_nhat_luc = ? WHERE id = ?",
  ).run(
    snapshot.tieu_de,
    snapshot.loai,
    snapshot.noi_dung,
    JSON.stringify(snapshot.cac_muc),
    id,
    ts,
    nguonId,
  );
  return layNguonRevision(db, id)!;
}

export function taoNguon(
  db: Database,
  input: NhapNguon,
  tacGia: string,
  tuyChon: TuyChonTaoNguon = {},
): Nguon {
  return txn(db, () => {
    const id = tuyChon.id ?? crypto.randomUUID();
    const ts = bayGio();
    db.query(
      `INSERT INTO nguon (id, tieu_de, noi_dung, loai, cac_muc, head_revision_id, tao_luc, tao_boi, cap_nhat_luc)
       VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?)`,
    ).run(
      id,
      input.tieu_de,
      input.noi_dung,
      input.loai ?? "van_ban",
      JSON.stringify(input.cac_muc ?? []),
      ts,
      tacGia,
      ts,
    );
    ghiNguonRevisionTrongTxn(
      db,
      id,
      {
        tieu_de: input.tieu_de,
        loai: input.loai ?? "van_ban",
        noi_dung: input.noi_dung,
        cac_muc: input.cac_muc ?? [],
        khoa_idem: input.khoa_idem,
      },
      null,
      tacGia,
    );
    ghiSuKien(db, "nguon", id, "tao", {}, tacGia);
    return layNguon(db, id)!;
  });
}

// Cập nhật nguồn = thêm một revision mới (immutable); dua_tren_revision_id
// phải bằng head → ghi xung đột bị từ chối, revision cũ vẫn truy cập được.
export function capNhatNguon(
  db: Database,
  id: string,
  input: NhapNguon,
  duaTrenRevisionId: string | null,
  tacGia: string,
): Nguon {
  return txn(db, () => {
    const nguon = layNguon(db, id);
    if (!nguon) loiRequest(404, "KHONG_TIM_THAY", "Không tìm thấy nguồn.");
    ghiNguonRevisionTrongTxn(
      db,
      id,
      {
        tieu_de: input.tieu_de,
        loai: input.loai ?? "van_ban",
        noi_dung: input.noi_dung,
        cac_muc: input.cac_muc ?? [],
        khoa_idem: input.khoa_idem,
      },
      duaTrenRevisionId,
      tacGia,
    );
    const moi = layNguon(db, id)!;
    ghiSuKien(db, "nguon", id, "revision_moi", { revision_id: moi.head_revision_id }, tacGia);
    return moi;
  });
}

// --- Campaign ---

export function layCampaign(db: Database, id: string): Campaign | null {
  const row = db.query("SELECT * FROM campaign WHERE id = ?").get(id) as DongCampaign | null;
  return row ? docCampaign(row) : null;
}

export function danhSachCampaign(db: Database): Campaign[] {
  return (db.query("SELECT * FROM campaign ORDER BY tao_luc").all() as DongCampaign[]).map(
    docCampaign,
  );
}

export type NhapCampaign = {
  ten: string;
  mo_ta?: string;
  ghi_de?: GhiDeCampaign;
};

export function taoCampaign(db: Database, input: NhapCampaign, tacGia: string): Campaign {
  return txn(db, () => {
    const id = crypto.randomUUID();
    const ts = bayGio();
    db.query(
      `INSERT INTO campaign (id, ten, mo_ta, ghi_de, tao_luc, tao_boi, cap_nhat_luc, cap_nhat_boi)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, input.ten, input.mo_ta ?? "", JSON.stringify(input.ghi_de ?? {}), ts, tacGia, ts, tacGia);
    ghiSuKien(db, "campaign", id, "tao", {}, tacGia);
    return layCampaign(db, id)!;
  });
}

export function capNhatCampaign(
  db: Database,
  id: string,
  input: NhapCampaign,
  tacGia: string,
): Campaign {
  return txn(db, () => {
    if (!layCampaign(db, id)) loiRequest(404, "KHONG_TIM_THAY", "Không tìm thấy campaign.");
    db.query(
      "UPDATE campaign SET ten = ?, mo_ta = ?, ghi_de = ?, cap_nhat_luc = ?, cap_nhat_boi = ? WHERE id = ?",
    ).run(input.ten, input.mo_ta ?? "", JSON.stringify(input.ghi_de ?? {}), bayGio(), tacGia, id);
    ghiSuKien(db, "campaign", id, "cap_nhat", {}, tacGia);
    return layCampaign(db, id)!;
  });
}

// Xóa campaign: thông điệp đang gắn quay về bài lẻ (campaign_id → NULL).
export function xoaCampaign(db: Database, id: string): void {
  txn(db, () => {
    if (!layCampaign(db, id)) loiRequest(404, "KHONG_TIM_THAY", "Không tìm thấy campaign.");
    db.query("DELETE FROM campaign WHERE id = ?").run(id);
    ghiSuKien(db, "campaign", id, "xoa", {}, "demo");
  });
}

// --- Thông điệp ---

export function layThongDiep(db: Database, id: string): ThongDiep | null {
  return (
    (db.query("SELECT * FROM thong_diep WHERE id = ?").get(id) as ThongDiep | null) ?? null
  );
}

export function danhSachThongDiep(db: Database, campaignId?: string): ThongDiep[] {
  if (campaignId) {
    return db
      .query("SELECT * FROM thong_diep WHERE campaign_id = ? ORDER BY tao_luc DESC")
      .all(campaignId) as ThongDiep[];
  }
  return db.query("SELECT * FROM thong_diep ORDER BY tao_luc DESC").all() as ThongDiep[];
}

export function layThongDiepRevision(db: Database, id: string): ThongDiepRevision | null {
  const row = db
    .query("SELECT * FROM thong_diep_revision WHERE id = ?")
    .get(id) as DongThongDiepRevision | null;
  return row ? docThongDiepRevision(row) : null;
}

export function danhSachThongDiepRevision(db: Database, thongDiepId: string): ThongDiepRevision[] {
  return (
    db
      .query("SELECT * FROM thong_diep_revision WHERE thong_diep_id = ? ORDER BY so_thu_tu")
      .all(thongDiepId) as DongThongDiepRevision[]
  ).map(docThongDiepRevision);
}

export function danhSachNguonCuaThongDiep(db: Database, thongDiepId: string): string[] {
  return (
    db
      .query("SELECT nguon_id FROM thong_diep_nguon WHERE thong_diep_id = ? ORDER BY nguon_id")
      .all(thongDiepId) as { nguon_id: string }[]
  ).map((r) => r.nguon_id);
}

// Head revision của mỗi nguồn liên kết — revision thông điệp ghim đúng các id
// này để bản thể hiện truy về được nguồn đã dùng tại thời điểm viết thông điệp.
function headRevisionCuaDsNguon(db: Database, nguonIds: string[]): string[] {
  const ids: string[] = [];
  for (const nid of nguonIds) {
    const n = layNguon(db, nid);
    if (!n) loiRequest(400, "VALIDATION", `Nguồn liên kết không tồn tại: ${nid}`);
    if (n.head_revision_id) ids.push(n.head_revision_id);
  }
  return ids;
}

// Ghi một revision thông điệp + cập nhật entity/link, trong transaction caller.
function ghiThongDiepRevisionTrongTxn(
  db: Database,
  thongDiepId: string,
  snapshot: {
    tieu_de: string;
    noi_dung: string;
    campaign_id: string | null;
    nguon_ids: string[];
  },
  duaTren: string | null,
  tacGia: string,
): ThongDiepRevision {
  const td = layThongDiep(db, thongDiepId)!;
  assertDuaTren(td.head_revision_id, duaTren);
  const nguonIds = [...new Set(snapshot.nguon_ids)];
  const nguonRevIds = headRevisionCuaDsNguon(db, nguonIds);
  const soTiep =
    ((
      db
        .query("SELECT MAX(so_thu_tu) AS m FROM thong_diep_revision WHERE thong_diep_id = ?")
        .get(thongDiepId) as { m: number | null }
    ).m ?? 0) + 1;
  const id = crypto.randomUUID();
  const ts = bayGio();
  db.query(
    `INSERT INTO thong_diep_revision
       (id, thong_diep_id, so_thu_tu, tieu_de, noi_dung, nguon_revision_ids, dua_tren_revision_id, tao_luc, tao_boi)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    thongDiepId,
    soTiep,
    snapshot.tieu_de,
    snapshot.noi_dung,
    JSON.stringify(nguonRevIds),
    duaTren,
    ts,
    tacGia,
  );
  db.query("DELETE FROM thong_diep_nguon WHERE thong_diep_id = ?").run(thongDiepId);
  for (const nid of nguonIds) {
    db.query("INSERT INTO thong_diep_nguon (thong_diep_id, nguon_id) VALUES (?, ?)").run(
      thongDiepId,
      nid,
    );
  }
  db.query(
    "UPDATE thong_diep SET tieu_de = ?, noi_dung = ?, campaign_id = ?, head_revision_id = ?, cap_nhat_luc = ?, cap_nhat_boi = ? WHERE id = ?",
  ).run(snapshot.tieu_de, snapshot.noi_dung, snapshot.campaign_id, id, ts, tacGia, thongDiepId);
  return layThongDiepRevision(db, id)!;
}

export type NhapThongDiep = {
  tieu_de: string;
  noi_dung?: string;
  campaign_id?: string | null;
  nguon_ids?: string[];
};

export function taoThongDiep(
  db: Database,
  input: NhapThongDiep,
  tacGia: string,
  tuyChon: { id?: string } = {},
): ThongDiep {
  return txn(db, () => {
    if (input.campaign_id && !layCampaign(db, input.campaign_id)) {
      loiRequest(400, "VALIDATION", `Campaign không tồn tại: ${input.campaign_id}`);
    }
    const id = tuyChon.id ?? crypto.randomUUID();
    const ts = bayGio();
    db.query(
      `INSERT INTO thong_diep (id, campaign_id, tieu_de, noi_dung, head_revision_id, tao_luc, tao_boi, cap_nhat_luc, cap_nhat_boi)
       VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?)`,
    ).run(id, input.campaign_id ?? null, input.tieu_de, input.noi_dung ?? "", ts, tacGia, ts, tacGia);
    ghiThongDiepRevisionTrongTxn(
      db,
      id,
      {
        tieu_de: input.tieu_de,
        noi_dung: input.noi_dung ?? "",
        campaign_id: input.campaign_id ?? null,
        nguon_ids: input.nguon_ids ?? [],
      },
      null,
      tacGia,
    );
    ghiSuKien(db, "thong_diep", id, "tao", {}, tacGia);
    return layThongDiep(db, id)!;
  });
}

export function capNhatThongDiep(
  db: Database,
  id: string,
  input: NhapThongDiep,
  duaTrenRevisionId: string,
  tacGia: string,
): ThongDiep {
  return txn(db, () => {
    const td = layThongDiep(db, id);
    if (!td) loiRequest(404, "KHONG_TIM_THAY", "Không tìm thấy thông điệp.");
    if (input.campaign_id && !layCampaign(db, input.campaign_id)) {
      loiRequest(400, "VALIDATION", `Campaign không tồn tại: ${input.campaign_id}`);
    }
    ghiThongDiepRevisionTrongTxn(
      db,
      id,
      {
        tieu_de: input.tieu_de,
        noi_dung: input.noi_dung ?? "",
        campaign_id: input.campaign_id ?? null,
        nguon_ids: input.nguon_ids ?? danhSachNguonCuaThongDiep(db, id),
      },
      duaTrenRevisionId,
      tacGia,
    );
    const moi = layThongDiep(db, id)!;
    ghiSuKien(db, "thong_diep", id, "revision_moi", { revision_id: moi.head_revision_id }, tacGia);
    return moi;
  });
}

// --- Bản thể hiện ---

export function layBanTheHien(db: Database, id: string): BanTheHien | null {
  return (db.query("SELECT * FROM ban_the_hien WHERE id = ?").get(id) as BanTheHien | null) ?? null;
}

// Lọc theo thong_diep_id trực tiếp, hoặc nguon_id qua link nhiều-nhiều —
// một bản thể hiện xuất hiện dưới mọi nguồn mà thông điệp của nó dùng.
export function danhSachBanTheHien(
  db: Database,
  loc: { thongDiepId?: string; nguonId?: string } = {},
): BanTheHien[] {
  if (loc.nguonId) {
    return db
      .query(
        `SELECT b.* FROM ban_the_hien b
         JOIN thong_diep_nguon tn ON tn.thong_diep_id = b.thong_diep_id
         WHERE tn.nguon_id = ? ORDER BY b.tao_luc DESC`,
      )
      .all(loc.nguonId) as BanTheHien[];
  }
  if (loc.thongDiepId) {
    return db
      .query("SELECT * FROM ban_the_hien WHERE thong_diep_id = ? ORDER BY tao_luc DESC")
      .all(loc.thongDiepId) as BanTheHien[];
  }
  return db.query("SELECT * FROM ban_the_hien ORDER BY tao_luc DESC").all() as BanTheHien[];
}

export type NhapBanTheHien = {
  thong_diep_id: string;
  dinh_dang: string;
  ngon_ngu?: string;
  phien_ban_dinh_dang?: number;
  doi_tuong?: string;
  dich_den?: string;
};

export function taoBanTheHien(
  db: Database,
  input: NhapBanTheHien,
  tacGia: string,
  tuyChon: { id?: string } = {},
): BanTheHien {
  return txn(db, () => {
    if (!layThongDiep(db, input.thong_diep_id)) {
      loiRequest(400, "VALIDATION", `Thông điệp không tồn tại: ${input.thong_diep_id}`);
    }
    const id = tuyChon.id ?? crypto.randomUUID();
    // Bản thể hiện ghim phiên bản định dạng lúc tạo — renderer đổi sau này
    // vẫn truy về được schema đã dùng (#19).
    const phienBan = input.phien_ban_dinh_dang ?? layDinhDang(input.dinh_dang)?.phien_ban ?? 1;
    db.query(
      `INSERT INTO ban_the_hien
         (id, thong_diep_id, dinh_dang, ngon_ngu, phien_ban_dinh_dang, doi_tuong, dich_den, trang_thai, head_revision_id, tao_luc, tao_boi)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'nhap', NULL, ?, ?)`,
    ).run(
      id,
      input.thong_diep_id,
      input.dinh_dang,
      input.ngon_ngu ?? "vi",
      phienBan,
      input.doi_tuong ?? "",
      input.dich_den ?? "",
      bayGio(),
      tacGia,
    );
    ghiSuKien(db, "ban_the_hien", id, "tao", {}, tacGia);
    return layBanTheHien(db, id)!;
  });
}

// Tìm bản thể hiện trùng danh tính đầu ra (thông điệp, định dạng, ngôn ngữ,
// đối tượng, đích đến) — enqueue và nhập bài dùng chung để không tạo trùng.
export function timBanTheHien(db: Database, khoa: NhapBanTheHien): BanTheHien | null {
  return (
    (db
      .query(
        `SELECT * FROM ban_the_hien
         WHERE thong_diep_id = ? AND dinh_dang = ? AND ngon_ngu = ? AND doi_tuong = ? AND dich_den = ?`,
      )
      .get(
        khoa.thong_diep_id,
        khoa.dinh_dang,
        khoa.ngon_ngu ?? "vi",
        khoa.doi_tuong ?? "",
        khoa.dich_den ?? "",
      ) as BanTheHien | null) ?? null
  );
}

// Chuyển trạng thái review: validate chuỗi chuyển, ghi record duyet ghim
// revision nội dung tại thời điểm chấm + sự kiện.
export function chuyenTrangThai(
  db: Database,
  id: string,
  den: string,
  ghiChu: string,
  tacGia: string,
): BanTheHien {
  return txn(db, () => {
    const bth = layBanTheHien(db, id);
    if (!bth) loiRequest(404, "KHONG_TIM_THAY", "Không tìm thấy bản thể hiện.");
    if (!laTrangThai(den)) {
      throw new LoiApi(400, "VALIDATION", "trang_thai không hợp lệ.", [
        `Cho phép: ${DANH_SACH_TRANG_THAI.join(", ")}`,
      ]);
    }
    if (!chuyenHopLe(bth.trang_thai, den)) {
      throw new LoiApi(
        409,
        "XUNG_DOT_TRANG_THAI",
        `Không thể chuyển từ '${bth.trang_thai}' sang '${den}'.`,
      );
    }
    const tu = bth.trang_thai;
    db.query("UPDATE ban_the_hien SET trang_thai = ? WHERE id = ?").run(den, id);
    db.query(
      `INSERT INTO duyet (id, ban_the_hien_id, revision_id, tu_trang_thai, den_trang_thai, ghi_chu, tao_luc, tao_boi)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(crypto.randomUUID(), id, bth.head_revision_id, tu, den, ghiChu, bayGio(), tacGia);
    ghiSuKien(db, "ban_the_hien", id, "trang_thai", { tu, den }, tacGia);
    return layBanTheHien(db, id)!;
  });
}

export function danhSachDuyet(db: Database, banTheHienId: string): Duyet[] {
  return db
    .query("SELECT * FROM duyet WHERE ban_the_hien_id = ? ORDER BY tao_luc DESC, id DESC")
    .all(banTheHienId) as Duyet[];
}

export function danhSachDuyetTheoRevision(db: Database, revisionId: string): Duyet[] {
  return db
    .query("SELECT * FROM duyet WHERE revision_id = ? ORDER BY tao_luc DESC, id DESC")
    .all(revisionId) as Duyet[];
}

// --- Revision nội dung ---

export function danhSachRevision(db: Database, banTheHienId: string): Revision[] {
  return db
    .query("SELECT * FROM revision WHERE ban_the_hien_id = ? ORDER BY so_thu_tu")
    .all(banTheHienId) as Revision[];
}

export function layRevision(db: Database, id: string): Revision | null {
  return (db.query("SELECT * FROM revision WHERE id = ?").get(id) as Revision | null) ?? null;
}

type NhapRevision = {
  ban_the_hien_id: string;
  noi_dung: string;
  dua_tren_revision_id: string | null;
  // Context sinh + revision thông điệp đã dùng khi tạo revision này
  // (job sinh ghi; nhập tay ghim head thông điệp hiện tại).
  context_sinh_id?: string | null;
  thong_diep_revision_id?: string | null;
};

// Phần ghi của themRevision KHÔNG mở transaction — caller bọc BEGIN/COMMIT.
// Dùng khi revision phải commit nguyên tử cùng ghi khác (vd context_sinh trong job).
export function themRevisionTrongTxn(
  db: Database,
  input: NhapRevision,
  tacGia: string,
): Revision {
  const bth = layBanTheHien(db, input.ban_the_hien_id);
  if (!bth) loiRequest(404, "KHONG_TIM_THAY", "Không tìm thấy bản thể hiện.");
  assertDuaTren(bth.head_revision_id, input.dua_tren_revision_id ?? null);
  // Provenance: nhập tay ghim head thông điệp hiện tại; job sinh truyền đúng
  // revision thông điệp đã dùng. NULL cho phép khi thông điệp chưa có revision.
  let tdRevId = input.thong_diep_revision_id;
  if (tdRevId === undefined) {
    const td = layThongDiep(db, bth.thong_diep_id);
    tdRevId = td?.head_revision_id ?? null;
  }
  const soTiep =
    ((
      db
        .query("SELECT MAX(so_thu_tu) AS m FROM revision WHERE ban_the_hien_id = ?")
        .get(input.ban_the_hien_id) as { m: number | null }
    ).m ?? 0) + 1;
  const id = crypto.randomUUID();
  const ts = bayGio();
  db.query(
    `INSERT INTO revision
       (id, ban_the_hien_id, so_thu_tu, noi_dung, dua_tren_revision_id, context_sinh_id, thong_diep_revision_id, tao_luc, tao_boi)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.ban_the_hien_id,
    soTiep,
    input.noi_dung,
    input.dua_tren_revision_id ?? null,
    input.context_sinh_id ?? null,
    tdRevId,
    ts,
    tacGia,
  );
  db.query("UPDATE ban_the_hien SET head_revision_id = ? WHERE id = ?").run(
    id,
    input.ban_the_hien_id,
  );
  ghiSuKien(
    db,
    "ban_the_hien",
    input.ban_the_hien_id,
    "revision_moi",
    { revision_id: id, so_thu_tu: soTiep },
    tacGia,
  );
  return layRevision(db, id)!;
}

// Convention xung đột revision: client phải gửi dua_tren_revision_id = head mà nó thấy.
// Khác với head hiện tại → 409 XUNG_DOT_REVISION.
export function themRevision(db: Database, input: NhapRevision, tacGia: string): Revision {
  return txn(db, () => themRevisionTrongTxn(db, input, tacGia));
}

// --- Xuất bản ---

type DongXuatBan = Omit<XuatBan, "asset_ids"> & { asset_ids: string };

const docXuatBan = (row: DongXuatBan): XuatBan => {
  let ids: string[] = [];
  try {
    const j = JSON.parse(row.asset_ids) as unknown;
    if (Array.isArray(j)) ids = j.map(String);
  } catch {
    // JSON hỏng → coi như không asset nào được chọn lúc đăng.
  }
  return { ...row, asset_ids: ids };
};

// Record xuất bản: append-only, ghim revision nội dung được đăng + snapshot
// asset được chọn (route truyền ds asset hiện tại từ ban_the_hien_asset).
// Tách khỏi trạng thái review — bản thể hiện không tự "đã đăng" vì được sinh.
export function xuatBanBanTheHien(
  db: Database,
  banTheHienId: string,
  input: { dich_den?: string; ghi_chu?: string; asset_ids?: string[] },
  tacGia: string,
): XuatBan {
  return txn(db, () => {
    const bth = layBanTheHien(db, banTheHienId);
    if (!bth) loiRequest(404, "KHONG_TIM_THAY", "Không tìm thấy bản thể hiện.");
    if (!bth.head_revision_id) {
      throw new LoiApi(
        409,
        "XUNG_DOT_TRANG_THAI",
        "Bản thể hiện chưa có nội dung để xuất bản.",
      );
    }
    const id = crypto.randomUUID();
    const ts = bayGio();
    const assetIds = input.asset_ids ?? [];
    db.query(
      `INSERT INTO xuat_ban (id, ban_the_hien_id, revision_id, dich_den, ghi_chu, asset_ids, tao_luc, tao_boi)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      banTheHienId,
      bth.head_revision_id,
      input.dich_den ?? bth.dich_den,
      input.ghi_chu ?? "",
      JSON.stringify(assetIds),
      ts,
      tacGia,
    );
    ghiSuKien(
      db,
      "ban_the_hien",
      banTheHienId,
      "xuat_ban",
      {
        revision_id: bth.head_revision_id,
        dich_den: input.dich_den ?? bth.dich_den,
        asset_ids: assetIds,
      },
      tacGia,
    );
    return docXuatBan(db.query("SELECT * FROM xuat_ban WHERE id = ?").get(id) as DongXuatBan);
  });
}

export function danhSachXuatBan(db: Database, banTheHienId: string): XuatBan[] {
  return (
    db
      .query("SELECT * FROM xuat_ban WHERE ban_the_hien_id = ? ORDER BY tao_luc DESC, id DESC")
      .all(banTheHienId) as DongXuatBan[]
  ).map(docXuatBan);
}

// --- Nhập bài: service dùng chung ---

export type NhapBaiViet = {
  tieu_de: string;
  noi_dung: string;
  loai?: string;
  cac_muc?: MucNguon[];
  campaign_id?: string | null;
  // Thông điệp mặc định lấy tiêu đề/nội dung nguồn khi không ghi đè.
  thong_diep?: { tieu_de?: string; noi_dung?: string };
  // Nguồn có sẵn liên kết thêm vào thông điệp (ngoài nguồn vừa tạo).
  nguon_ids?: string[];
  // Các đầu ra cần tạo sẵn; mặc định một đầu ra 'web'.
  ds_ban_the_hien?: Omit<NhapBanTheHien, "thong_diep_id">[];
};

// Dán một bài viết → một nguồn + một thông điệp + nhiều bản thể hiện,
// tất cả trong một transaction. Đây là service dùng chung mà API/intake gọi.
export function nhapBaiViet(
  db: Database,
  input: NhapBaiViet,
  tacGia: string,
): { nguon: Nguon; thong_diep: ThongDiep; ds_ban_the_hien: BanTheHien[] } {
  return txn(db, () => {
    const nguon = taoNguon(
      db,
      {
        tieu_de: input.tieu_de,
        noi_dung: input.noi_dung,
        loai: input.loai,
        cac_muc: input.cac_muc,
      },
      tacGia,
    );
    const thongDiep = taoThongDiep(
      db,
      {
        tieu_de: input.thong_diep?.tieu_de || nguon.tieu_de,
        noi_dung: input.thong_diep?.noi_dung ?? nguon.noi_dung,
        campaign_id: input.campaign_id ?? null,
        nguon_ids: [nguon.id, ...(input.nguon_ids ?? [])],
      },
      tacGia,
    );
    const dsOut = input.ds_ban_the_hien ?? [{ dinh_dang: "bai-viet" }];
    const dsBth: BanTheHien[] = [];
    for (const o of dsOut) {
      // Dedupe theo danh tính đầu ra: intake lặp cùng bộ không tạo trùng.
      const co = timBanTheHien(db, { ...o, thong_diep_id: thongDiep.id });
      dsBth.push(co ?? taoBanTheHien(db, { ...o, thong_diep_id: thongDiep.id }, tacGia));
    }
    return { nguon, thong_diep: thongDiep, ds_ban_the_hien: dsBth };
  });
}
