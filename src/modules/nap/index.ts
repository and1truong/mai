import type { Database } from "bun:sqlite";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { extname, join, resolve, sep } from "node:path";
import { LoiApi, loiRequest } from "../../loi.ts";
import {
  ghiSuKien,
  layBanTheHien,
  layNguon,
  layNguonRevision,
  taoNguon,
  capNhatNguon,
  timNguonRevisionTheoKhoaIdem,
  type MucNguon,
  type Nguon,
  type NguonRevision,
} from "../content/index.ts";

// Module nạp (#17): pipeline đầu vào dùng chung cho bài viết, ghi chú hiện
// trường, tham khảo biên tập, ảnh sản phẩm và asset thương hiệu.
//
// - Byte gốc nằm trong MAI_DATA_DIR/assets/ qua interface KhoByte hẹp;
//   metadata (loại, kích thước, checksum, tên file, ghi chú quyền, liên kết
//   nguồn) nằm trong bảng asset. Không cloud storage trong POC.
// - Text nguồn được chuẩn hóa thành cac_muc có định danh ổn định để bằng
//   chứng tham chiếu; bản gốc giữ nguyên trong nguon.noi_dung + file asset.
// - Record nguồn/revision vẫn do module content sở hữu — module này chỉ gọi
//   service export của content, không ghi thẳng bảng của content.

// --- Loại và giới hạn upload (đã tài liệu hóa tại docs/conventions.md) ---

export const MIME_ASSET: Record<string, { loai: "van_ban" | "hinh_anh"; mime: string }> = {
  ".txt": { loai: "van_ban", mime: "text/plain" },
  ".md": { loai: "van_ban", mime: "text/markdown" },
  ".png": { loai: "hinh_anh", mime: "image/png" },
  ".jpg": { loai: "hinh_anh", mime: "image/jpeg" },
  ".jpeg": { loai: "hinh_anh", mime: "image/jpeg" },
  ".webp": { loai: "hinh_anh", mime: "image/webp" },
  ".gif": { loai: "hinh_anh", mime: "image/gif" },
};
export const DANH_SACH_EXT_ASSET = Object.keys(MIME_ASSET);

// Giới hạn theo loại; giới hạn chung body request (50 MB) vẫn áp trước.
export const GIOI_HAN_VAN_BAN = 2 * 1024 * 1024;
export const GIOI_HAN_HINH_ANH = 20 * 1024 * 1024;

export const DANH_SACH_TRANG_THAI_ASSET = ["hoat_dong", "luu_tru"] as const;
export type TrangThaiAsset = (typeof DANH_SACH_TRANG_THAI_ASSET)[number];

export type Asset = {
  id: string;
  ten_file: string;
  duong_dan: string;
  loai: string;
  mime: string;
  kich_thuoc: number;
  checksum: string;
  nguon_id: string | null;
  ghi_chu: string;
  khoa_idem: string | null;
  trang_thai: TrangThaiAsset;
  tao_luc: string;
  tao_boi: string;
};

const bayGio = () => new Date().toISOString();

// --- KhoByte: interface storage nội bộ hẹp để test ---

export interface KhoByte {
  ghi(duongDan: string, byte: Uint8Array): Promise<void>;
  doc(duongDan: string): Promise<Uint8Array<ArrayBuffer> | null>;
  tonTai(duongDan: string): boolean;
  xoa(duongDan: string): void;
}

// Resolve đường dẫn file trong gốc kho byte: kiểm nằm trong gốc để chắc
// chắn không đường dẫn nào thoát khỏi thư mục data. Dùng chung bởi
// khoByteLocal và các caller ghi đồng bộ (seed fixture).
export function duongDanTepAsset(goc: string, duongDan: string): string {
  const gocDayDu = resolve(goc);
  const p = resolve(join(gocDayDu, duongDan));
  if (p !== gocDayDu && !p.startsWith(gocDayDu + sep)) {
    throw new LoiApi(400, "VALIDATION", "Đường dẫn asset không hợp lệ.");
  }
  return p;
}

// Kho byte trên đĩa local, gốc = <dataDir>/assets. duong_dan là tên file
// server tự đặt ('<uuid>.<ext>').
export function khoByteLocal(goc: string): KhoByte {
  const gocDayDu = resolve(goc);
  mkdirSync(gocDayDu, { recursive: true });
  const tep = (duongDan: string): string => duongDanTepAsset(gocDayDu, duongDan);
  return {
    async ghi(duongDan, byte) {
      await Bun.write(tep(duongDan), byte);
    },
    async doc(duongDan) {
      const f = Bun.file(tep(duongDan));
      return (await f.exists()) ? new Uint8Array(await f.arrayBuffer()) : null;
    },
    tonTai(duongDan) {
      return existsSync(tep(duongDan));
    },
    xoa(duongDan) {
      const p = tep(duongDan);
      if (existsSync(p)) rmSync(p);
    },
  };
}

// Kho byte trong RAM cho test: không đụng đĩa, kiểm hết nhánh luồng service.
export function taoKhoByteMem(): KhoByte & { ds: Map<string, Uint8Array> } {
  const ds = new Map<string, Uint8Array>();
  return {
    ds,
    async ghi(duongDan, byte) {
      ds.set(duongDan, byte);
    },
    async doc(duongDan) {
      const b = ds.get(duongDan);
      return b ? new Uint8Array(b) : null;
    },
    tonTai(duongDan) {
      return ds.has(duongDan);
    },
    xoa(duongDan) {
      ds.delete(duongDan);
    },
  };
}

// --- Tên file an toàn ---

// Giữ phần tên thuần để hiển thị/disposition: bỏ thư mục, ký tự điều khiển,
// chấm dẫn đầu (dotfile) và cắt độ dài. Không dùng làm đường dẫn lưu.
export function sachTenFile(ten: string): string {
  const base = ten.split(/[\\/]/).pop() ?? "";
  const sach = base
    .replace(/[\x00-\x1f\x7f]/g, "")
    .replace(/^\.+/, "")
    .trim()
    .slice(0, 120);
  return sach || "asset";
}

// --- Chuẩn hóa text thành mục có định danh ổn định ---

// Slug ASCII từ tiêu đề: bỏ dấu (kể cả đ/Đ), ký tự lạ → '-'. Hai heading
// giống nhau nhận hậu tố -2, -3 theo thứ tự xuất hiện → id ổn định khi
// chèn/xóa section khác, đủ để bằng chứng trỏ đúng mục.
function slugMuc(tieuDe: string): string {
  const s = tieuDe
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[đĐ]/g, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  return s || "sec";
}

// Tách text theo heading Markdown ('#'..'######'). Phần trước heading đầu
// tiên thành mục 'mo-dau'; văn bản không heading thành một mục 'noi-dung'.
// id = 's-<slug>' ổn định theo tiêu đề, không theo vị trí tuyệt đối.
export function chuanHoaCacMuc(noiDung: string): MucNguon[] {
  const dong = noiDung.split("\n");
  const ds: { tieuDe: string | null; than: string[] }[] = [];
  let hienTai: { tieuDe: string | null; than: string[] } | null = null;
  for (const d of dong) {
    const m = /^(#{1,6})\s+(.+?)\s*$/.exec(d);
    if (m) {
      hienTai = { tieuDe: m[2]!, than: [] };
      ds.push(hienTai);
    } else if (hienTai) {
      hienTai.than.push(d);
    } else {
      ds.push({ tieuDe: null, than: [d] });
      hienTai = ds[ds.length - 1]!;
    }
  }
  const dsMuc: MucNguon[] = [];
  const daCo = new Map<string, number>();
  const datId = (goc: string): string => {
    const n = (daCo.get(goc) ?? 0) + 1;
    daCo.set(goc, n);
    return n === 1 ? goc : `${goc}-${n}`;
  };
  for (const seg of ds) {
    const noiDungMuc = seg.than.join("\n").trim();
    if (seg.tieuDe === null && !noiDungMuc) continue; // bỏ mở đầu trắng
    const id =
      seg.tieuDe === null
        ? datId(ds.length === 1 ? "noi-dung" : "mo-dau")
        : datId(`s-${slugMuc(seg.tieuDe)}`);
    dsMuc.push({
      id,
      loai: "section",
      tieu_de: seg.tieuDe ?? undefined,
      noi_dung: noiDungMuc,
      assets: [],
    });
  }
  return dsMuc;
}

// --- Asset: đọc ---

export function layAsset(db: Database, id: string): Asset | null {
  return (db.query("SELECT * FROM asset WHERE id = ?").get(id) as Asset | null) ?? null;
}

export function danhSachAsset(
  db: Database,
  loc: { nguonId?: string; trangThai?: string } = {},
): Asset[] {
  const dieuKien: string[] = [];
  const thamSo: string[] = [];
  if (loc.nguonId) {
    dieuKien.push("nguon_id = ?");
    thamSo.push(loc.nguonId);
  }
  if (loc.trangThai) {
    dieuKien.push("trang_thai = ?");
    thamSo.push(loc.trangThai);
  }
  const where = dieuKien.length > 0 ? `WHERE ${dieuKien.join(" AND ")}` : "";
  return db
    .query(`SELECT * FROM asset ${where} ORDER BY tao_luc DESC`)
    .all(...thamSo) as Asset[];
}

// --- Asset: ghi ---

export type NhapAsset = {
  tenFile: string;
  byte: Uint8Array;
  nguonId?: string | null;
  ghiChu?: string;
  khoaIdem?: string;
};

function sha256Hex(byte: Uint8Array): string {
  return new Bun.CryptoHasher("sha256").update(byte).digest("hex");
}

export function timAssetTheoChecksum(db: Database, byte: Uint8Array): Asset | null {
  return (
    (db
      .query("SELECT * FROM asset WHERE checksum = ?")
      .get(sha256Hex(byte)) as Asset | null) ?? null
  );
}

// Kiểm tra byte upload trước mọi mutation: đuôi được hỗ trợ, không rỗng,
// trong giới hạn loại, văn bản decode được UTF-8. Route phải gọi hàm này
// trước khi ingest để request lỗi không để lại nguồn/revision rỗng.
export function kiemTraByteAsset(tenFile: string, byte: Uint8Array): {
  loai: "van_ban" | "hinh_anh";
  mime: string;
} {
  const ext = extname(sachTenFile(tenFile)).toLowerCase();
  const dinhNghia = MIME_ASSET[ext];
  if (!dinhNghia) {
    throw new LoiApi(400, "VALIDATION", "Loại file không hỗ trợ.", [
      `Cho phép: ${DANH_SACH_EXT_ASSET.join(", ")}`,
    ]);
  }
  if (byte.byteLength === 0) {
    throw new LoiApi(400, "VALIDATION", "File rỗng.");
  }
  const gioiHan = dinhNghia.loai === "van_ban" ? GIOI_HAN_VAN_BAN : GIOI_HAN_HINH_ANH;
  if (byte.byteLength > gioiHan) {
    throw new LoiApi(413, "PAYLOAD_QUA_LON", `File vượt giới hạn ${gioiHan} byte (${dinhNghia.loai}).`);
  }
  if (dinhNghia.loai === "van_ban") {
    try {
      new TextDecoder("utf-8", { fatal: true }).decode(byte);
    } catch {
      throw new LoiApi(400, "VALIDATION", "File văn bản không phải UTF-8 hợp lệ.");
    }
  }
  return dinhNghia;
}

// Lưu một file upload: validate đuôi/loại/giới hạn/UTF-8, dedupe theo
// khoa_idem rồi checksum, ghi byte dưới tên '<id>.<ext>' rồi mới ghi DB —
// file mồ côi (ghi xong chưa commit) được dọn lúc xóa/dọn thủ công.
// Dedupe hit mà request gửi nguon_id mới trong khi asset chưa có liên kết
// thì gắn liên kết đó — cùng byte không đáng lưu hai lần.
export async function luuAsset(
  db: Database,
  kho: KhoByte,
  input: NhapAsset,
  tacGia: string,
): Promise<{ asset: Asset; da_tao: boolean }> {
  const dinhNghia = kiemTraByteAsset(input.tenFile, input.byte);
  const tenFile = sachTenFile(input.tenFile);
  const ext = extname(tenFile).toLowerCase();
  if (input.nguonId && !layNguon(db, input.nguonId)) {
    throw new LoiApi(400, "VALIDATION", `Nguồn liên kết không tồn tại: ${input.nguonId}`);
  }
  const cu = input.khoaIdem
    ? ((db.query("SELECT * FROM asset WHERE khoa_idem = ?").get(input.khoaIdem) as Asset | null) ??
      null)
    : null;
  const trung = cu ?? timAssetTheoChecksum(db, input.byte);
  if (trung) {
    if (input.nguonId && trung.nguon_id !== input.nguonId && trung.nguon_id === null) {
      db.query("UPDATE asset SET nguon_id = ? WHERE id = ?").run(input.nguonId, trung.id);
      trung.nguon_id = input.nguonId;
    }
    return { asset: trung, da_tao: false };
  }

  const id = crypto.randomUUID();
  const duongDan = `${id}${ext}`;
  await kho.ghi(duongDan, input.byte);
  const ts = bayGio();
  try {
    db.query(
      `INSERT INTO asset
         (id, ten_file, duong_dan, loai, mime, kich_thuoc, checksum, nguon_id, ghi_chu, khoa_idem, trang_thai, tao_luc, tao_boi)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'hoat_dong', ?, ?)`,
    ).run(
      id,
      tenFile,
      duongDan,
      dinhNghia.loai,
      dinhNghia.mime,
      input.byte.byteLength,
      sha256Hex(input.byte),
      input.nguonId ?? null,
      input.ghiChu ?? "",
      input.khoaIdem ?? null,
      ts,
      tacGia,
    );
  } catch (e) {
    // Race: upload đồng thời cùng khoa_idem — INSERT đối phương đã thắng,
    // tra lại và trả bản ghi đó thay vì 500 UNIQUE.
    if (input.khoaIdem && e instanceof Error && e.message.includes("UNIQUE")) {
      const thang = db
        .query("SELECT * FROM asset WHERE khoa_idem = ?")
        .get(input.khoaIdem) as Asset | null;
      if (thang) return { asset: thang, da_tao: false };
    }
    throw e;
  }
  ghiSuKien(db, "asset", id, "tao", { loai: dinhNghia.loai, kich_thuoc: input.byte.byteLength }, tacGia);
  return { asset: layAsset(db, id)!, da_tao: true };
}

// --- Đính kèm tường minh vào bản thể hiện ---

export function danhSachAssetBanTheHien(db: Database, banTheHienId: string): Asset[] {
  return db
    .query(
      `SELECT a.* FROM asset a
       JOIN ban_the_hien_asset ba ON ba.asset_id = a.id
       WHERE ba.ban_the_hien_id = ? ORDER BY ba.tao_luc`,
    )
    .all(banTheHienId) as Asset[];
}

export function dsAssetIdBanTheHien(db: Database, banTheHienId: string): string[] {
  return danhSachAssetBanTheHien(db, banTheHienId).map((a) => a.id);
}

// Thay toàn bộ danh sách đính kèm của một đầu ra. Chỉ nhận asset tồn tại
// và còn hoat_dong — asset đã lưu trữ không gắn thêm được (vẫn render được
// trong các record/xuất bản cũ đã ghim).
export function datAssetBanTheHien(
  db: Database,
  banTheHienId: string,
  assetIds: string[],
  tacGia: string,
): Asset[] {
  db.exec("BEGIN IMMEDIATE");
  try {
    if (!layBanTheHien(db, banTheHienId)) {
      throw new LoiApi(404, "KHONG_TIM_THAY", "Không tìm thấy bản thể hiện.");
    }
    const dsLoi: string[] = [];
    for (const aid of assetIds) {
      const a = layAsset(db, aid);
      if (!a) dsLoi.push(`asset không tồn tại: ${aid}`);
      else if (a.trang_thai !== "hoat_dong") dsLoi.push(`asset đã lưu trữ: ${aid}`);
    }
    if (dsLoi.length > 0) {
      throw new LoiApi(400, "VALIDATION", "Danh sách asset không hợp lệ.", dsLoi);
    }
    db.query("DELETE FROM ban_the_hien_asset WHERE ban_the_hien_id = ?").run(banTheHienId);
    const ts = bayGio();
    for (const aid of [...new Set(assetIds)]) {
      db.query(
        "INSERT INTO ban_the_hien_asset (ban_the_hien_id, asset_id, tao_luc) VALUES (?, ?, ?)",
      ).run(banTheHienId, aid, ts);
    }
    ghiSuKien(db, "ban_the_hien", banTheHienId, "asset_dinh_kem", { asset_ids: assetIds }, tacGia);
    const ds = danhSachAssetBanTheHien(db, banTheHienId);
    db.exec("COMMIT");
    return ds;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

// --- Xóa / lưu trữ ---

// Đếm nơi còn tham chiếu asset: chọn đính kèm của đầu ra + cac_muc của
// nguồn và mọi revision nguồn (bản gốc trong revision cũ vẫn phải resolve).
export function demThamChieuAsset(
  db: Database,
  assetId: string,
): { ban_the_hien: number; nguon: number; nguon_revision: number; xuat_ban: number } {
  const mau = `%"${assetId}"%`;
  return {
    ban_the_hien: (
      db
        .query("SELECT COUNT(*) AS c FROM ban_the_hien_asset WHERE asset_id = ?")
        .get(assetId) as { c: number }
    ).c,
    nguon: (
      db.query("SELECT COUNT(*) AS c FROM nguon WHERE cac_muc LIKE ?").get(mau) as { c: number }
    ).c,
    nguon_revision: (
      db.query("SELECT COUNT(*) AS c FROM nguon_revision WHERE cac_muc LIKE ?").get(mau) as {
        c: number;
      }
    ).c,
    // Snapshot xuất bản cũng là tham chiếu provenance — đã xuất bản kèm
    // asset thì byte không được mất.
    xuat_ban: (
      db.query("SELECT COUNT(*) AS c FROM xuat_ban WHERE asset_ids LIKE ?").get(mau) as {
        c: number;
      }
    ).c,
  };
}

// Xóa asset: còn tham chiếu → 409 (không gãy provenance); sạch → xóa row và
// byte trên đĩa. Đếm tham chiếu + DELETE trong một transaction để attach
// đồng thời không lọt giữa hai bước; xóa file sau COMMIT (file thừa dọn
// được, thiếu file thì /noi-dung đã trả 404).
export async function xoaAsset(db: Database, kho: KhoByte, id: string, tacGia: string): Promise<void> {
  const asset = layAsset(db, id);
  if (!asset) throw new LoiApi(404, "KHONG_TIM_THAY", "Không tìm thấy asset.");
  db.exec("BEGIN IMMEDIATE");
  try {
    const ref = demThamChieuAsset(db, id);
    if (ref.ban_the_hien + ref.nguon + ref.nguon_revision + ref.xuat_ban > 0) {
      throw new LoiApi(
        409,
        "XUNG_DOT_TRANG_THAI",
        "Asset đang được tham chiếu. Lưu trữ thay vì xóa.",
        ref,
      );
    }
    db.query("DELETE FROM asset WHERE id = ?").run(id);
    ghiSuKien(db, "asset", id, "xoa", {}, tacGia);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  kho.xoa(asset.duong_dan);
}

// Lưu trữ: ẩn khỏi danh sách chọn nhưng giữ byte + metadata → provenance cũ
// vẫn resolve. Được dùng cả khi asset còn tham chiếu.
export function luuTruAsset(db: Database, id: string, tacGia: string): Asset {
  const asset = layAsset(db, id);
  if (!asset) throw new LoiApi(404, "KHONG_TIM_THAY", "Không tìm thấy asset.");
  db.query("UPDATE asset SET trang_thai = 'luu_tru' WHERE id = ?").run(id);
  ghiSuKien(db, "asset", id, "luu_tru", {}, tacGia);
  return layAsset(db, id)!;
}

// --- Nạp nguồn từ text ---

export type KetQuaNap = { nguon: Nguon; revision: NguonRevision; da_tao: boolean };

// Dán text → nguồn mới với cac_muc đã chuẩn hóa. Retry cùng khoa_idem trả
// lại nguồn/revision cũ, không tạo trùng.
export function napVanBan(
  db: Database,
  input: { tieu_de: string; noi_dung: string; loai?: string; khoa_idem?: string },
  tacGia: string,
): KetQuaNap {
  if (input.khoa_idem) {
    const cu = timNguonRevisionTheoKhoaIdem(db, input.khoa_idem);
    if (cu) return { nguon: layNguon(db, cu.nguon_id)!, revision: cu, da_tao: false };
  }
  const nguon = taoNguon(
    db,
    {
      tieu_de: input.tieu_de,
      noi_dung: input.noi_dung,
      loai: input.loai,
      cac_muc: chuanHoaCacMuc(input.noi_dung),
      khoa_idem: input.khoa_idem,
    },
    tacGia,
  );
  return { nguon, revision: layNguonRevision(db, nguon.head_revision_id!)!, da_tao: true };
}

// Nạp lại text cho nguồn có sẵn → revision mới với cac_muc chuẩn hóa lại.
// - khoa_idem trùng request cũ → trả revision đó, không ghi.
// - nội dung giống head hiện tại → trả head (retry tay không sinh trùng).
// - dua_tren_revision_id được gửi thì vẫn kiểm xung đột theo convention.
export function capNhatVanBan(
  db: Database,
  nguonId: string,
  input: { noi_dung: string; dua_tren_revision_id?: string; khoa_idem?: string },
  tacGia: string,
): KetQuaNap {
  const nguon = layNguon(db, nguonId);
  if (!nguon) throw new LoiApi(404, "KHONG_TIM_THAY", "Không tìm thấy nguồn.");
  if (input.khoa_idem) {
    const cu = timNguonRevisionTheoKhoaIdem(db, input.khoa_idem);
    if (cu) {
      // Khóa đã dùng cho nguồn khác → không lẫn provenance, báo xung đột.
      if (cu.nguon_id !== nguonId) {
        throw new LoiApi(409, "XUNG_DOT_TRANG_THAI", "khoa_idem đã dùng cho nguồn khác.");
      }
      return { nguon, revision: cu, da_tao: false };
    }
  }
  // Caller gửi dua_tren_revision_id rõ thì kiểm xung đột trước cả no-op —
  // base cũ + nội dung giống head vẫn phải 409 theo convention revision.
  const duaTren = input.dua_tren_revision_id ?? nguon.head_revision_id;
  if (
    input.dua_tren_revision_id !== undefined &&
    input.dua_tren_revision_id !== nguon.head_revision_id
  ) {
    throw new LoiApi(409, "XUNG_DOT_REVISION", "dua_tren_revision_id khác head hiện tại.", {
      head_revision_id: nguon.head_revision_id,
    });
  }
  const head = nguon.head_revision_id ? layNguonRevision(db, nguon.head_revision_id) : null;
  if (head && head.noi_dung === input.noi_dung) {
    return { nguon, revision: head, da_tao: false };
  }
  const moi = capNhatNguon(
    db,
    nguonId,
    {
      tieu_de: nguon.tieu_de,
      noi_dung: input.noi_dung,
      loai: nguon.loai,
      cac_muc: chuanHoaCacMuc(input.noi_dung),
      khoa_idem: input.khoa_idem,
    },
    duaTren,
    tacGia,
  );
  return { nguon: moi, revision: layNguonRevision(db, moi.head_revision_id!)!, da_tao: true };
}
