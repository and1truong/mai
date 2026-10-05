// Resolve audience theo segment của campaign tại thời điểm gửi (#68).
// Job giao_kenh gọi SAU kiểm tra quyền duyệt — campaign chưa qua duyệt
// không tới đây. Snapshot `doi_tuong_giao` ghi đúng một lần per lần giao:
// retry đọc lại snapshot (quyết định đóng băng ở lần gửi đầu), không
// resolve lại — suppression/consent rút sau snapshot chặn ở delivery
// boundary trong adapter (`lyDoChanLucGiao`), không đổi snapshot audit.
//
// Lọc trước khi giao, theo thứ tự:
//   1. không có identity phù hợp kênh → bo_qua 'khong_dinh_danh'
//   2. nguoi_nhan đã hủy đăng ký (suppression vĩnh viễn) → 'huy_dang_ky'
//   3. consentChoGui(khach, kenh, 'marketing') = false → 'khong_consent'

import type { Database } from "bun:sqlite";
import { ghiSuKien, txn } from "../content/index.ts";
import { consentChoGui, danhSachDinhDanh } from "../khach/index.ts";
import { thanhVienSegmentAll } from "../khach/segment.ts";

const bayGio = () => new Date().toISOString();

export type DoiTuongGiao = {
  id: string;
  giao_hang_id: string;
  khach_id: string;
  dinh_danh_id: string;
  email: string;
  quyet_dinh: string; // gui | bo_qua
  ly_do: string; // khong_consent | huy_dang_ky | khong_dinh_danh
};

export type NguoiNhanAudience = {
  id: string; // khach_id — ổn định cho checkpoint da_gui của adapter
  email: string;
  urlHuy: string;
};

export type AudienceGiao = {
  ds_gui: NguoiNhanAudience[];
  so_bo_qua: number;
  segment_id: string;
};

// Identity phù hợp kênh: email → dinh_danh loai 'email' (bản ghi sớm
// nhất — deterministic); kênh khác chưa có mapping → không audience.
const LOAI_DINH_DANH_THEO_KENH: Record<string, string> = { email: "email" };

export function docDoiTuongGiao(db: Database, giaoId: string): DoiTuongGiao[] {
  return db
    .query("SELECT * FROM doi_tuong_giao WHERE giao_hang_id = ? ORDER BY rowid")
    .all(giaoId) as DoiTuongGiao[];
}

// Đọc snapshot đã ghi (retry) hoặc resolve + ghi mới (lần đầu). Trả null
// khi campaign không gắn segment → caller đi luồng danh bạ nguoi_nhan cũ.
export function damBaoAudienceGiao(
  db: Database,
  giaoId: string,
  segmentId: string,
  kenh: string,
  urlGoc: string,
): AudienceGiao | null {
  const loaiDd = LOAI_DINH_DANH_THEO_KENH[kenh];
  const cu = docDoiTuongGiao(db, giaoId);
  if (cu.length > 0) {
    // Snapshot có sẵn (retry): build lại ds từ quyết định đã ghi.
    return {
      ds_gui: cu
        .filter((r) => r.quyet_dinh === "gui")
        .map((r) => ({ id: r.khach_id, email: r.email, urlHuy: urlHuyNguoiNhan(db, r.email, urlGoc) })),
      so_bo_qua: cu.filter((r) => r.quyet_dinh === "bo_qua").length,
      segment_id: segmentId,
    };
  }
  if (!loaiDd || !segmentId) return null;

  const luc = bayGio();
  const thanhVien = thanhVienSegmentAll(db, segmentId);
  const dsGui: NguoiNhanAudience[] = [];
  let soBoQua = 0;
  // Snapshot là audit trail — ghi nguyên khối trong một transaction:
  // crash giữa chừng không để lại snapshot cụt để retry tái dùng nhầm.
  txn(db, () => {
    for (const khachId of thanhVien) {
    const dd = danhSachDinhDanh(db, khachId).find((d) => d.loai === loaiDd);
    let quyetDinh = "gui";
    let lyDo = "";
    if (!dd) {
      quyetDinh = "bo_qua";
      lyDo = "khong_dinh_danh";
    } else if (daHuyDangKy(db, dd.gia_tri_chuan)) {
      quyetDinh = "bo_qua";
      lyDo = "huy_dang_ky";
    } else if (!consentChoGui(db, khachId, kenh, "marketing")) {
      quyetDinh = "bo_qua";
      lyDo = "khong_consent";
    }
    db.query(
      `INSERT INTO doi_tuong_giao
       (id, giao_hang_id, khach_id, dinh_danh_id, email, quyet_dinh, ly_do, tao_luc)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      crypto.randomUUID(),
      giaoId,
      khachId,
      dd?.id ?? "",
      dd?.gia_tri_chuan ?? "",
      quyetDinh,
      lyDo,
      luc,
    );
      if (quyetDinh === "gui" && dd) {
        dsGui.push({ id: khachId, email: dd.gia_tri_chuan, urlHuy: urlHuyNguoiNhan(db, dd.gia_tri_chuan, urlGoc) });
      } else {
        soBoQua++;
      }
    }
    ghiSuKien(
      db,
      "giao_hang",
      giaoId,
      "resolve_audience",
      { segment_id: segmentId, so_thanh_vien: thanhVien.length, so_gui: dsGui.length, so_bo_qua: soBoQua },
      "job",
    );
  });
  return { ds_gui: dsGui, so_bo_qua: soBoQua, segment_id: segmentId };
}

// Gate lúc GỬI (delivery boundary, #13): snapshot `doi_tuong_giao` đóng
// băng quyết định lúc resolve, nhưng hủy đăng ký hoặc rút consent giữa
// hai attempt vẫn phải chặn — adapter gọi hàm này trước mỗi lần gửi.
export function lyDoChanLucGiao(
  db: Database,
  khachId: string,
  email: string,
  kenh: string,
): string | null {
  if (daHuyDangKy(db, email)) return "huy_dang_ky";
  if (!consentChoGui(db, khachId, kenh, "marketing")) return "khong_consent";
  return null;
}

// Suppression nguoi_nhan (#13): huy_dang_ky là chặn vĩnh viễn — consent
// person mới hơn cũng không mở khóa; chỉ tạo lại danh bạ mới mới gỡ.
function daHuyDangKy(db: Database, email: string): boolean {
  const r = db
    .query("SELECT trang_thai FROM nguoi_nhan WHERE email = ?")
    .get(email) as { trang_thai: string } | null;
  return r?.trang_thai === "huy_dang_ky";
}

// Link hủy một chạm chỉ có khi email đã nằm trong danh bạ nguoi_nhan —
// person từ segment chưa có row thì gửi không kèm link hủy (giới hạn POC).
function urlHuyNguoiNhan(db: Database, email: string, urlGoc: string): string {
  const r = db
    .query("SELECT token_huy FROM nguoi_nhan WHERE email = ? AND trang_thai = 'dang_ky'")
    .get(email) as { token_huy: string } | null;
  return r && urlGoc ? `${urlGoc}/huy-dang-ky?token=${r.token_huy}` : "";
}
