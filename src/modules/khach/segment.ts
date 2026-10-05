// Segment động + tag tay (ticket #66).
//
// DSL quy_tac = JSON {all?: DieuKien[], any?: DieuKien[]}:
//   { trang_thai_doi: "khach_mua" | ["dang_ky","khach_mua"] }
//   { co_truong: "email"|"ten"|"sdt" } / { khong_co_truong: ... }
//   { co_su_kien: { loai, trong_ngay? } } / { khong_co_su_kien: {...} }
//   { co_tag: "vip" }
//   { so_don_toi_thieu: 2 }
//   { tong_doanh_thu_toi_thieu: { tien_te: "USD", gia_tri: 100 } }
//   { don_cuoi_truoc_ngay: "2026-01-01T00:00:00.000Z" }
//
// `all`: mọi điều kiện đúng (rỗng = đúng). `any`: ít nhất một đúng
// (vắng mặt = đúng). Membership tính deterministic khi đọc — không
// bảng materialize; nếu quét chậm mới cache (POC: chưa cần).

import type { Database } from "bun:sqlite";
import { nemLoiValidation, tuyChonChuoi } from "../../loi.ts";
import {
  giaTriKhach,
  layKhach,
  DANH_SACH_TRANG_THAI_DOI,
  type Khach,
} from "./index.ts";

export type Segment = {
  id: string;
  ten: string;
  quy_tac: string;
  tao_luc: string;
  tao_boi: string;
};

export type KhachTag = {
  khach_id: string;
  tag: string;
  nguon: string;
  tao_luc: string;
};

export const DANH_SACH_NGUON_TAG = ["tay", "automation", "import"] as const;

const TRUONG_PROFILE = ["ten", "email", "sdt"] as const;

// --- Validate DSL: từng điều kiện đúng một khóa, giá trị đúng kiểu. ---
export function kiemTraQuyTac(raw: unknown, dsLoi: string[]): { all: unknown[]; any: unknown[] } {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    dsLoi.push("quy_tac phải là object {all?:[...], any?:[...]}.");
    return { all: [], any: [] };
  }
  const qt = raw as Record<string, unknown>;
  for (const k of Object.keys(qt)) {
    if (k !== "all" && k !== "any") {
      dsLoi.push(`quy_tac.${k} không hỗ trợ. Cho phép: all, any.`);
    }
  }
  const out = { all: [] as unknown[], any: [] as unknown[] };
  for (const nhom of ["all", "any"] as const) {
    const v = qt[nhom];
    if (v === undefined) continue;
    if (!Array.isArray(v)) {
      dsLoi.push(`quy_tac.${nhom} phải là mảng điều kiện.`);
      continue;
    }
    v.forEach((dk, i) => kiemTraDieuKien(dk, dsLoi, `${nhom}[${i}]`));
    out[nhom] = v;
  }
  if (qt.all === undefined && qt.any === undefined) {
    dsLoi.push("quy_tac phải có ít nhất một khóa all hoặc any.");
  }
  return out;
}

function kiemTraDieuKien(dk: unknown, dsLoi: string[], viTri: string): void {
  if (typeof dk !== "object" || dk === null || Array.isArray(dk)) {
    dsLoi.push(`quy_tac.${viTri} phải là object điều kiện.`);
    return;
  }
  const o = dk as Record<string, unknown>;
  const ks = Object.keys(o);
  if (ks.length !== 1) {
    dsLoi.push(`quy_tac.${viTri} phải có đúng một khóa điều kiện.`);
    return;
  }
  const k = ks[0]!;
  const v = o[k];
  const lo = `quy_tac.${viTri}.${k}`;
  switch (k) {
    case "trang_thai_doi": {
      const ds = Array.isArray(v) ? v : [v];
      if (!ds.every((s) => (DANH_SACH_TRANG_THAI_DOI as readonly string[]).includes(String(s)))) {
        dsLoi.push(`${lo} phải thuộc ${DANH_SACH_TRANG_THAI_DOI.join("|")}.`);
      }
      break;
    }
    case "co_truong":
    case "khong_co_truong":
      if (!(TRUONG_PROFILE as readonly string[]).includes(String(v))) {
        dsLoi.push(`${lo} phải thuộc ${TRUONG_PROFILE.join("|")}.`);
      }
      break;
    case "co_su_kien":
    case "khong_co_su_kien": {
      if (typeof v !== "object" || v === null || Array.isArray(v)) {
        dsLoi.push(`${lo} phải là object {loai, trong_ngay?}.`);
        break;
      }
      const sk = v as Record<string, unknown>;
      if (!tuyChonChuoi(sk.loai)) dsLoi.push(`${lo}.loai là bắt buộc.`);
      if (sk.trong_ngay !== undefined && (!Number.isFinite(Number(sk.trong_ngay)) || Number(sk.trong_ngay) <= 0)) {
        dsLoi.push(`${lo}.trong_ngay phải là số > 0.`);
      }
      break;
    }
    case "co_tag":
      if (!tuyChonChuoi(v)) dsLoi.push(`${lo} phải là chuỗi tag.`);
      break;
    case "so_don_toi_thieu":
      if (!Number.isInteger(Number(v)) || Number(v) < 0) dsLoi.push(`${lo} phải là số nguyên ≥ 0.`);
      break;
    case "tong_doanh_thu_toi_thieu": {
      if (typeof v !== "object" || v === null || Array.isArray(v)) {
        dsLoi.push(`${lo} phải là object {tien_te, gia_tri}.`);
        break;
      }
      const d = v as Record<string, unknown>;
      if (!/^[A-Z]{3}$/.test(String(d.tien_te ?? ""))) {
        dsLoi.push(`${lo}.tien_te phải là mã 3 ký tự (vd VND, USD).`);
      }
      if (!Number.isFinite(Number(d.gia_tri))) dsLoi.push(`${lo}.gia_tri phải là số.`);
      break;
    }
    case "don_cuoi_truoc_ngay":
      if (!Number.isFinite(Date.parse(String(v)))) dsLoi.push(`${lo} phải là thời điểm ISO 8601.`);
      break;
    default:
      dsLoi.push(`${lo}: điều kiện '${k}' không hỗ trợ.`);
  }
}

// --- Evaluate: pure theo data hiện có, cùng data cùng kết quả. ---
function danhGiaDieuKien(db: Database, khach: Khach, dk: Record<string, unknown>, luc: string): boolean {
  const [k, v] = Object.entries(dk)[0]!;
  switch (k) {
    case "trang_thai_doi": {
      const ds = Array.isArray(v) ? v.map(String) : [String(v)];
      return ds.includes(khach.trang_thai_doi);
    }
    case "co_truong":
      return tuyChonChuoi(khach[String(v) as "ten" | "email" | "sdt"]) !== "";
    case "khong_co_truong":
      return tuyChonChuoi(khach[String(v) as "ten" | "email" | "sdt"]) === "";
    case "co_su_kien":
    case "khong_co_su_kien": {
      const sk = v as { loai: string; trong_ngay?: number };
      const coKhung = typeof sk.trong_ngay === "number" && sk.trong_ngay > 0;
      const thamSo: (string | number)[] = [khach.id, sk.loai];
      if (coKhung) {
        thamSo.push(
          new Date(Date.parse(luc) - sk.trong_ngay! * 86400000).toISOString(),
        );
      }
      const row = db
        .query(
          `SELECT 1 FROM tuong_tac WHERE khach_id = ? AND loai = ?
           ${coKhung ? "AND xay_ra_luc >= ?" : ""} LIMIT 1`,
        )
        .get(...thamSo);
      return k === "co_su_kien" ? !!row : !row;
    }
    case "co_tag":
      return !!db
        .query("SELECT 1 FROM khach_tag WHERE khach_id = ? AND tag = ?")
        .get(khach.id, chuanHoaTag(String(v)));
    case "so_don_toi_thieu":
      return giaTriKhach(db, khach.id, luc).so_don >= Number(v);
    case "tong_doanh_thu_toi_thieu": {
      const d = v as { tien_te: string; gia_tri: number };
      return (giaTriKhach(db, khach.id, luc).doanh_thu[d.tien_te]?.tong ?? 0) >= d.gia_tri;
    }
    case "don_cuoi_truoc_ngay": {
      const cuoi = giaTriKhach(db, khach.id, luc).don_cuoi_luc;
      return cuoi !== "" && cuoi < String(v);
    }
    default:
      return false;
  }
}

// Evaluate một person theo DSL đã parse. Export để test + #68 dùng.
export function thanhVienSegment(
  db: Database,
  khachId: string,
  quyTac: { all?: Record<string, unknown>[]; any?: Record<string, unknown>[] },
  luc = new Date().toISOString(),
): boolean {
  const khach = layKhach(db, khachId);
  if (!khach || khach.trang_thai === "da_gop") return false;
  if (quyTac.all !== undefined) {
    if (!quyTac.all.every((dk) => danhGiaDieuKien(db, khach, dk, luc))) return false;
  }
  if (quyTac.any !== undefined) {
    if (!quyTac.any.some((dk) => danhGiaDieuKien(db, khach, dk, luc))) return false;
  }
  return true;
}

// Quét membership toàn bộ person — deterministic tại thời điểm đọc.
export function thanhVienSegmentAll(
  db: Database,
  segmentId: string,
  luc = new Date().toISOString(),
): string[] {
  const seg = laySegment(db, segmentId);
  if (!seg) return [];
  const quyTac = JSON.parse(seg.quy_tac) as { all?: Record<string, unknown>[]; any?: Record<string, unknown>[] };
  const ds = db
    .query("SELECT id FROM khach WHERE trang_thai = 'hoat_dong' ORDER BY rowid")
    .all() as { id: string }[];
  return ds.filter((k) => thanhVienSegment(db, k.id, quyTac, luc)).map((k) => k.id);
}

// --- CRUD segment ---
export function laySegment(db: Database, id: string): Segment | null {
  return db.query("SELECT * FROM segment WHERE id = ?").get(id) as Segment | null;
}

export function danhSachSegment(db: Database): Segment[] {
  return db.query("SELECT * FROM segment ORDER BY ten, rowid").all() as Segment[];
}

export function taoSegment(
  db: Database,
  nhap: { ten?: unknown; quy_tac?: unknown },
  actor: string,
): Segment {
  const dsLoi: string[] = [];
  const ten = tuyChonChuoi(nhap.ten);
  if (!ten) dsLoi.push("ten là bắt buộc.");
  kiemTraQuyTac(nhap.quy_tac, dsLoi);
  nemLoiValidation(dsLoi);
  const id = crypto.randomUUID();
  db.query(
    "INSERT INTO segment (id, ten, quy_tac, tao_luc, tao_boi) VALUES (?, ?, ?, ?, ?)",
  ).run(id, ten, JSON.stringify(nhap.quy_tac), new Date().toISOString(), actor);
  return laySegment(db, id)!;
}

export function capNhatSegment(
  db: Database,
  id: string,
  nhap: { ten?: unknown; quy_tac?: unknown },
): Segment | null {
  const seg = laySegment(db, id);
  if (!seg) return null;
  const dsLoi: string[] = [];
  const ten = nhap.ten === undefined ? seg.ten : tuyChonChuoi(nhap.ten);
  if (!ten) dsLoi.push("ten không được rỗng.");
  const quyTac = nhap.quy_tac === undefined ? seg.quy_tac : JSON.stringify(nhap.quy_tac);
  if (nhap.quy_tac !== undefined) kiemTraQuyTac(nhap.quy_tac, dsLoi);
  nemLoiValidation(dsLoi);
  db.query("UPDATE segment SET ten = ?, quy_tac = ? WHERE id = ?").run(ten, quyTac, id);
  return laySegment(db, id);
}

// Xóa segment; đang được campaign dùng → trả số campaign để route 409.
export function xoaSegment(db: Database, id: string): { so_campaign: number } {
  const so = (
    db.query("SELECT COUNT(*) AS c FROM campaign WHERE segment_id = ?").get(id) as { c: number }
  ).c;
  if (so > 0) return { so_campaign: so };
  db.query("DELETE FROM segment WHERE id = ?").run(id);
  return { so_campaign: 0 };
}

// --- Tag tay ---
export function chuanHoaTag(tag: string): string {
  return tag.trim().toLowerCase();
}

export function layTagCuaKhach(db: Database, khachId: string): KhachTag[] {
  return db
    .query("SELECT * FROM khach_tag WHERE khach_id = ? ORDER BY tag")
    .all(khachId) as KhachTag[];
}

// Gắn/bỏ tag. them/bo là chuỗi tag (chuẩn hóa trim+lowercase, dedupe);
// nguon audit ai gắn — automation/integration khai đúng nguồn của mình.
export function datTagKhach(
  db: Database,
  khachId: string,
  nhap: { them?: unknown; bo?: unknown; nguon?: unknown },
): KhachTag[] {
  const dsLoi: string[] = [];
  const nguon = tuyChonChuoi(nhap.nguon) || "tay";
  if (!(DANH_SACH_NGUON_TAG as readonly string[]).includes(nguon)) {
    dsLoi.push(`nguon không hợp lệ. Cho phép: ${DANH_SACH_NGUON_TAG.join(", ")}.`);
  }
  const chuan = (v: unknown, ten: string): string[] => {
    if (v === undefined) return [];
    if (!Array.isArray(v) || !v.every((x) => typeof x === "string")) {
      dsLoi.push(`${ten} phải là mảng chuỗi tag.`);
      return [];
    }
    const s = [...new Set((v as string[]).map(chuanHoaTag).filter(Boolean))];
    return s;
  };
  const them = chuan(nhap.them, "them");
  const bo = chuan(nhap.bo, "bo");
  nemLoiValidation(dsLoi);
  const luc = new Date().toISOString();
  for (const tag of them) {
    db.query(
      "INSERT OR IGNORE INTO khach_tag (khach_id, tag, nguon, tao_luc) VALUES (?, ?, ?, ?)",
    ).run(khachId, tag, nguon, luc);
  }
  for (const tag of bo) {
    db.query("DELETE FROM khach_tag WHERE khach_id = ? AND tag = ?").run(khachId, tag);
  }
  return layTagCuaKhach(db, khachId);
}
