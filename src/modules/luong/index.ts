// Luồng POC (#5): intake → kế hoạch → chọn đầu ra → sinh → editor/review.
// Module này chỉ ghép các service đã có (content, context, generation,
// jobs, formats) — không hiện thực lại provider, editor hay renderer.

import type { Database } from "bun:sqlite";
import {
  capNhatThongDiep,
  danhSachBanTheHien,
  ghiSuKien,
  layNguon,
  layThongDiep,
  layThongDiepRevision,
  taoBanTheHien,
  taoThongDiep,
  timBanTheHien,
  type BanTheHien,
} from "../content/index.ts";
import { danhSachDoiTuong, layDoiTuong, type HoSoDoiTuong } from "../context/index.ts";
import { layDinhDang, kiemTraNgonNgu, DANH_SACH_DINH_DANG } from "../formats/index.ts";
import { thieuChungCu } from "../generation/context.ts";
import { enqueueJob, type Job } from "../jobs/index.ts";
import { LoiApi, loiRequest } from "../../loi.ts";

const bayGio = () => new Date().toISOString();

// Bọc một gói ghi trong transaction; gọi lồng nhau được — giống helper txn
// trong content (local theo convention module).
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

export type DauRaDeXuat = {
  doi_tuong_id: string | null;
  dinh_dang: string;
  ngon_ngu: string;
};

export type KeHoach = {
  id: string;
  thong_diep_id: string;
  nguon_id: string | null;
  intake: string;
  cta: string; // CTA của kế hoạch (đích hành động mong muốn)
  de_xuat_dau_ra: string; // JSON DauRaDeXuat[] — đề xuất tại thời điểm tạo/cập nhật
  ds_chon: string; // JSON DauRaDeXuat[] — lựa chọn đã xác nhận
  trang_thai: string; // 'nhap' (chưa chọn) | 'da_chon'
  tao_luc: string;
  tao_boi: string;
  cap_nhat_luc: string;
};

export type NhapKeHoach = {
  van_ban: string;
  tieu_de?: string;
  nguon_id?: string | null;
  cta?: string;
};

// Câu hỏi làm rõ từ mã chứng cứ thiếu — text câu hỏi cố định phía server để
// UI không phải suy ra; không bịa fact, chỉ hỏi.
export const CAU_HOI_THIEU: Record<string, string> = {
  so_lieu: "Có số liệu hay con số cụ thể nào cần đưa vào không?",
  moc_thoi_gian: "Sự kiện/mốc thời gian diễn ra khi nào?",
  gia_ca: "Có thông tin giá, chi phí hay khuyến mãi không?",
};

// Đề xuất đầu ra deterministic: gán định dạng theo từ khóa trong hồ sơ đối
// tượng (moi_quan_tam + nhu_cau_giao_tiep + kien_thuc_nen). Không gọi AI —
// gợi ý phải lặp lại được và giải thích được.
const LUAT_DE_XUAT: { re: RegExp; ds_dinh_dang: string[] }[] = [
  { re: /kỹ thuật|kỹ sư|developer|lập trình|chi tiết kỹ thuật/i, ds_dinh_dang: ["bai-viet", "thread"] },
  { re: /mạng xã hội|ngắn|lan truyền|trẻ|gen ?z/i, ds_dinh_dang: ["caption", "thread"] },
  { re: /email|bản tin|newsletter|cập nhật/i, ds_dinh_dang: ["newsletter"] },
  { re: /video|kịch bản|ngắn gọn|tiktok|reel|shorts/i, ds_dinh_dang: ["script-ngan"] },
  { re: /phỏng vấn|hỏi đáp|q&a|faq|giải đáp/i, ds_dinh_dang: ["faq"] },
];
const DINH_DANG_MAC_DINH_DT = ["bai-viet", "caption"];
const DINH_DANG_MAC_DINH_CHUNG = ["newsletter", "caption"];

export function deXuatDauRaChoDoiTuong(dt: HoSoDoiTuong): string[] {
  const vanBan = `${dt.moi_quan_tam} ${dt.nhu_cau_giao_tiep} ${dt.kien_thuc_nen} ${dt.ten}`;
  for (const luat of LUAT_DE_XUAT) {
    if (luat.re.test(vanBan)) return luat.ds_dinh_dang;
  }
  return DINH_DANG_MAC_DINH_DT;
}

// Đề xuất đầy đủ cho một kế hoạch: một entry "chung" (không đối tượng) +
// một nhóm cho mỗi hồ sơ đối tượng. Lọc theo ngôn ngữ định dạng hỗ trợ.
export function deXuatDauRa(db: Database, ngonNgu: string): DauRaDeXuat[] {
  const ds: DauRaDeXuat[] = [];
  const hopLe = (dd: string) => layDinhDang(dd) && !kiemTraNgonNgu(layDinhDang(dd)!, ngonNgu);
  for (const dd of DINH_DANG_MAC_DINH_CHUNG) {
    if (hopLe(dd)) ds.push({ doi_tuong_id: null, dinh_dang: dd, ngon_ngu: ngonNgu });
  }
  for (const dt of danhSachDoiTuong(db)) {
    const nn = dt.ngon_ngu || ngonNgu;
    for (const dd of deXuatDauRaChoDoiTuong(dt)) {
      if (hopLe(dd) && !ds.some((d) => d.doi_tuong_id === dt.id && d.dinh_dang === dd)) {
        ds.push({ doi_tuong_id: dt.id, dinh_dang: dd, ngon_ngu: nn });
      }
    }
  }
  return ds;
}

// Câu hỏi làm rõ trên văn bản thông điệp + nguồn đã gắn — tính lại mỗi lần
// đọc (không lưu) để intake sửa xong câu hỏi tự biến mất.
export function cauHoiLamRo(db: Database, kh: KeHoach): string[] {
  const td = layThongDiep(db, kh.thong_diep_id);
  if (!td) return [];
  const tdRev = td.head_revision_id ? layThongDiepRevision(db, td.head_revision_id) : null;
  const dsNguon: string[] = [];
  for (const id of tdRev?.nguon_revision_ids ?? []) {
    const n = db.query("SELECT noi_dung FROM nguon_revision WHERE id = ?").get(id) as {
      noi_dung: string;
    } | null;
    if (n) dsNguon.push(n.noi_dung);
  }
  const vanBan = [tdRev?.tieu_de ?? td.tieu_de, tdRev?.noi_dung ?? td.noi_dung, ...dsNguon].join("\n");
  return thieuChungCu(vanBan).map((ma) => CAU_HOI_THIEU[ma] ?? ma);
}

export function taoKeHoach(db: Database, input: NhapKeHoach, tacGia: string): KeHoach {
  return txn(db, () => {
    const vanBan = input.van_ban.trim();
    if (!vanBan) loiRequest(400, "VALIDATION", "van_ban intake bắt buộc.");
    if (input.nguon_id && !layNguon(db, input.nguon_id)) {
      loiRequest(400, "VALIDATION", `Nguồn không tồn tại: ${input.nguon_id}`);
    }
    const tieuDe = (input.tieu_de ?? "").trim() || vanBan.split("\n")[0]!.slice(0, 120);
    const td = taoThongDiep(
      db,
      { tieu_de: tieuDe, noi_dung: vanBan, nguon_ids: input.nguon_id ? [input.nguon_id] : [] },
      tacGia,
    );
    const id = crypto.randomUUID();
    const ts = bayGio();
    const deXuat = JSON.stringify(deXuatDauRa(db, "vi"));
    db.query(
      `INSERT INTO ke_hoach (id, thong_diep_id, nguon_id, intake, cta, de_xuat_dau_ra, ds_chon, trang_thai, tao_luc, tao_boi, cap_nhat_luc)
       VALUES (?, ?, ?, ?, ?, ?, '[]', 'nhap', ?, ?, ?)`,
    ).run(id, td.id, input.nguon_id ?? null, vanBan, (input.cta ?? "").trim(), deXuat, ts, tacGia, ts);
    ghiSuKien(db, "ke_hoach", id, "tao", { thong_diep_id: td.id }, tacGia);
    return layKeHoach(db, id)!;
  });
}

export function layKeHoach(db: Database, id: string): KeHoach | null {
  return (db.query("SELECT * FROM ke_hoach WHERE id = ?").get(id) as KeHoach | null) ?? null;
}

export function danhSachKeHoach(db: Database, gioiHan = 50): (KeHoach & { tieu_de: string })[] {
  return db
    .query(
      `SELECT kh.*, td.tieu_de FROM ke_hoach kh
       JOIN thong_diep td ON td.id = kh.thong_diep_id
       ORDER BY kh.cap_nhat_luc DESC LIMIT ?`,
    )
    .all(gioiHan) as (KeHoach & { tieu_de: string })[];
}

// Cập nhật intake chưa xong: ghi revision thông điệp mới (lịch sử giữ) và
// intake mới — "lưu intake chưa xong và tiếp tục sau". dua_tren ghim head
// hiện tại → trôi head → 409, đúng convention.
export function capNhatKeHoach(
  db: Database,
  id: string,
  input: { van_ban?: string; tieu_de?: string; cta?: string },
  tacGia: string,
): KeHoach {
  return txn(db, () => {
    const kh = layKeHoach(db, id);
    if (!kh) loiRequest(404, "KHONG_TIM_THAY", "Không tìm thấy kế hoạch.");
    const td = layThongDiep(db, kh.thong_diep_id)!;
    const vanBan = input.van_ban !== undefined ? input.van_ban : kh.intake;
    const tieuDe = input.tieu_de !== undefined ? input.tieu_de : td.tieu_de;
    const cta = input.cta !== undefined ? input.cta : kh.cta;
    capNhatThongDiep(
      db,
      td.id,
      { tieu_de: tieuDe, noi_dung: vanBan, nguon_ids: kh.nguon_id ? [kh.nguon_id] : [] },
      td.head_revision_id ?? "",
      tacGia,
    );
    db.query(
      "UPDATE ke_hoach SET intake = ?, cta = ?, de_xuat_dau_ra = ?, cap_nhat_luc = ? WHERE id = ?",
    ).run(vanBan, cta, JSON.stringify(deXuatDauRa(db, "vi")), bayGio(), id);
    return layKeHoach(db, id)!;
  });
}

// Xác nhận lựa chọn đầu ra: find-or-create bản thể hiện rồi enqueue job
// sinh từng cái. Sinh lại trên bản đã có = job mới → revision mới trên
// head, không đụng nháp tay (nhap_soan riêng theo actor).
export function chonDauRa(
  db: Database,
  id: string,
  dsChon: DauRaDeXuat[],
  tacGia: string,
): { ke_hoach: KeHoach; ds_bth: BanTheHien[]; ds_job: Job[] } {
  return txn(db, () => {
    const kh = layKeHoach(db, id);
    if (!kh) loiRequest(404, "KHONG_TIM_THAY", "Không tìm thấy kế hoạch.");
    if (!Array.isArray(dsChon) || dsChon.length === 0) {
      loiRequest(400, "VALIDATION", "ds_chon phải là mảng lựa chọn không rỗng.");
    }
    const dsLoi: string[] = [];
    for (const [i, chon] of dsChon.entries()) {
      const dd = layDinhDang(chon.dinh_dang);
      if (!dd) {
        dsLoi.push(`ds_chon[${i}].dinh_dang '${chon.dinh_dang}' không hợp lệ. Cho phép: ${DANH_SACH_DINH_DANG.join(", ")}.`);
        continue;
      }
      const nn = chon.ngon_ngu || "vi";
      const loiNg = kiemTraNgonNgu(dd, nn);
      if (loiNg) dsLoi.push(`ds_chon[${i}]: ${loiNg}`);
      if (chon.doi_tuong_id && !layDoiTuong(db, chon.doi_tuong_id)) {
        dsLoi.push(`ds_chon[${i}].doi_tuong_id '${chon.doi_tuong_id}' không tồn tại.`);
      }
    }
    if (dsLoi.length > 0) throw new LoiApi(400, "VALIDATION", "ds_chon không hợp lệ.", dsLoi);

    const dtTen = (dtId: string | null) =>
      dtId ? (layDoiTuong(db, dtId)?.ten ?? dtId) : "";
    const dsBth: BanTheHien[] = [];
    const dsJob: Job[] = [];
    for (const chon of dsChon) {
      const khoa = {
        thong_diep_id: kh.thong_diep_id,
        dinh_dang: chon.dinh_dang,
        ngon_ngu: chon.ngon_ngu || "vi",
        doi_tuong: dtTen(chon.doi_tuong_id),
      };
      const bth = timBanTheHien(db, khoa) ?? taoBanTheHien(db, khoa, tacGia);
      dsBth.push(bth);
      const { job } = enqueueJob(db, {
        loai: "sinh_ban_the_hien",
        payload: {
          thong_diep_id: kh.thong_diep_id,
          dinh_dang: chon.dinh_dang,
          ngon_ngu: khoa.ngon_ngu,
          doi_tuong: dtTen(chon.doi_tuong_id) || undefined,
        },
        entityLoai: "ban_the_hien",
        entityId: bth.id,
      });
      dsJob.push(job);
    }
    db.query(
      "UPDATE ke_hoach SET ds_chon = ?, trang_thai = 'da_chon', cap_nhat_luc = ? WHERE id = ?",
    ).run(JSON.stringify(dsChon), bayGio(), id);
    ghiSuKien(db, "ke_hoach", id, "chon_dau_ra", { so: dsChon.length }, tacGia);
    return { ke_hoach: layKeHoach(db, id)!, ds_bth: dsBth, ds_job: dsJob };
  });
}

// "Bản thể hiện đã cũ": head revision ghim một thong_diep_revision không
// còn là head — nguồn/thông điệp đã đổi sau khi bản sinh.
export function danhSachBanTheHienCu(db: Database, gioiHan = 20): BanTheHien[] {
  return db
    .query(
      `SELECT bth.* FROM ban_the_hien bth
       JOIN revision r ON r.id = bth.head_revision_id
       JOIN thong_diep td ON td.id = bth.thong_diep_id
       WHERE r.thong_diep_revision_id IS NOT NULL
         AND r.thong_diep_revision_id != td.head_revision_id
       ORDER BY bth.tao_luc DESC LIMIT ?`,
    )
    .all(gioiHan) as BanTheHien[];
}

// "Nháp chờ review" cho home — dùng chung hàng chờ của #21.
export function danhSachChoDuyet(db: Database, gioiHan = 20): BanTheHien[] {
  return danhSachBanTheHien(db, { trangThai: "cho_duyet" }).slice(0, gioiHan);
}

// Việc gần đây trên home: kế hoạch + bản thể hiện mới cập nhật/tạo.
export function viecGanDay(db: Database, gioiHan = 10): {
  ke_hoach: (KeHoach & { tieu_de: string })[];
  ban_the_hien: BanTheHien[];
} {
  return {
    ke_hoach: danhSachKeHoach(db, gioiHan),
    ban_the_hien: db
      .query("SELECT * FROM ban_the_hien ORDER BY tao_luc DESC LIMIT ?")
      .all(gioiHan) as BanTheHien[],
  };
}
