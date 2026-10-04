import type { Database } from "bun:sqlite";
import { LoiApi, loiRequest } from "../../loi.ts";

// Module nội dung: nguồn (source document), bản thể hiện (representation),
// revision (version immutable của một bản thể hiện).

export type Nguon = {
  id: string;
  tieu_de: string;
  noi_dung: string;
  loai: string;
  tao_luc: string;
  tao_boi: string;
  cap_nhat_luc: string;
};

export type BanTheHien = {
  id: string;
  nguon_id: string;
  dinh_dang: string;
  doi_tuong: string;
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
  tao_luc: string;
  tao_boi: string;
};

const bayGio = () => new Date().toISOString();

// --- Nguồn ---

export function layNguon(db: Database, id: string): Nguon | null {
  return (db.query("SELECT * FROM nguon WHERE id = ?").get(id) as Nguon | null) ?? null;
}

export function danhSachNguon(db: Database): Nguon[] {
  return db.query("SELECT * FROM nguon ORDER BY tao_luc DESC").all() as Nguon[];
}

export function taoNguon(
  db: Database,
  input: { tieu_de: string; noi_dung: string; loai?: string },
  tacGia: string,
): Nguon {
  const id = crypto.randomUUID();
  const ts = bayGio();
  db.query(
    "INSERT INTO nguon (id, tieu_de, noi_dung, loai, tao_luc, tao_boi, cap_nhat_luc) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run(id, input.tieu_de, input.noi_dung, input.loai ?? "van_ban", ts, tacGia, ts);
  return layNguon(db, id)!;
}

// --- Bản thể hiện ---

export function layBanTheHien(db: Database, id: string): BanTheHien | null {
  return (db.query("SELECT * FROM ban_the_hien WHERE id = ?").get(id) as BanTheHien | null) ?? null;
}

export function danhSachBanTheHien(db: Database, nguonId?: string): BanTheHien[] {
  if (nguonId) {
    return db
      .query("SELECT * FROM ban_the_hien WHERE nguon_id = ? ORDER BY tao_luc DESC")
      .all(nguonId) as BanTheHien[];
  }
  return db.query("SELECT * FROM ban_the_hien ORDER BY tao_luc DESC").all() as BanTheHien[];
}

export function taoBanTheHien(
  db: Database,
  input: { nguon_id: string; dinh_dang: string; doi_tuong?: string },
  tacGia: string,
): BanTheHien {
  const id = crypto.randomUUID();
  db.query(
    "INSERT INTO ban_the_hien (id, nguon_id, dinh_dang, doi_tuong, trang_thai, head_revision_id, tao_luc, tao_boi) VALUES (?, ?, ?, ?, 'nhap', NULL, ?, ?)",
  ).run(id, input.nguon_id, input.dinh_dang, input.doi_tuong ?? "", bayGio(), tacGia);
  return layBanTheHien(db, id)!;
}

export function capNhatTrangThai(db: Database, id: string, trangThai: string): BanTheHien {
  db.query("UPDATE ban_the_hien SET trang_thai = ? WHERE id = ?").run(trangThai, id);
  const bth = layBanTheHien(db, id);
  if (!bth) loiRequest(404, "KHONG_TIM_THAY", "Không tìm thấy bản thể hiện.");
  return bth;
}

// --- Revision ---

export function danhSachRevision(db: Database, banTheHienId: string): Revision[] {
  return db
    .query("SELECT * FROM revision WHERE ban_the_hien_id = ? ORDER BY so_thu_tu")
    .all(banTheHienId) as Revision[];
}

type NhapRevision = {
  ban_the_hien_id: string;
  noi_dung: string;
  dua_tren_revision_id: string | null;
  // Context sinh đã dùng khi tạo revision này (job sinh ghi; nhập tay = null).
  context_sinh_id?: string | null;
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
  const duaTren = input.dua_tren_revision_id ?? null;
  if (duaTren !== (bth.head_revision_id ?? null)) {
    throw new LoiApi(409, "XUNG_DOT_REVISION", "Bản thể hiện đã có revision mới hơn. Tải lại rồi thử lại.", {
      head_revision_id: bth.head_revision_id,
    });
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
    "INSERT INTO revision (id, ban_the_hien_id, so_thu_tu, noi_dung, dua_tren_revision_id, context_sinh_id, tao_luc, tao_boi) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(id, input.ban_the_hien_id, soTiep, input.noi_dung, duaTren, input.context_sinh_id ?? null, ts, tacGia);
  db.query("UPDATE ban_the_hien SET head_revision_id = ? WHERE id = ?").run(
    id,
    input.ban_the_hien_id,
  );
  return db.query("SELECT * FROM revision WHERE id = ?").get(id) as Revision;
}

// Convention xung đột revision: client phải gửi dua_tren_revision_id = head mà nó thấy.
// Khác với head hiện tại → 409 XUNG_DOT_REVISION.
export function themRevision(db: Database, input: NhapRevision, tacGia: string): Revision {
  db.exec("BEGIN IMMEDIATE");
  try {
    const rev = themRevisionTrongTxn(db, input, tacGia);
    db.exec("COMMIT");
    return rev;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
