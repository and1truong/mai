// Luồng POC (#5): intake → kế hoạch → chọn đầu ra → sinh → editor/review.
// Module này chỉ ghép các service đã có (content, context, generation,
// jobs, formats) — không hiện thực lại provider, editor hay renderer.

import type { Database } from "bun:sqlite";
import {
  capNhatThongDiep,
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
import { RE_NGAY_CU_THE, thieuChungCu } from "../generation/context.ts";
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
  // Tùy chọn — API và chonDauRa mặc định "vi" khi vắng mặt.
  ngon_ngu?: string;
  // Kênh đích tự do (vd "linkedin", "youtube") — hai đầu ra cùng định
  // dạng vẫn tách nhau khi đích khác nhau (#6: ba script video ngắn).
  dich_den?: string;
};

export type KeHoach = {
  id: string;
  thong_diep_id: string;
  nguon_id: string | null;
  intake: string;
  cta: string; // CTA của kế hoạch (đích hành động mong muốn)
  fact: string; // JSON FactSuKien — sự thật đã xác nhận (#7), ghép vào thông điệp
  de_xuat_dau_ra: string; // JSON DauRaDeXuat[] — đề xuất tại thời điểm tạo/cập nhật
  ds_chon: string; // JSON DauRaDeXuat[] — lựa chọn đã xác nhận
  trang_thai: string; // 'nhap' (chưa chọn) | 'da_chon'
  tao_luc: string;
  tao_boi: string;
  cap_nhat_luc: string;
  cap_nhat_boi: string;
};

export type NhapKeHoach = {
  van_ban: string;
  tieu_de?: string;
  nguon_id?: string | null;
  cta?: string;
  fact?: FactSuKien;
};

// --- Sự thật đã xác nhận (#7) ---

// Fact cấu trúc mà intake thu thập — chuỗi tự do ngắn, người dùng xác nhận
// từng ô; ngay_gio + mui_gio là lịch dự kiến (vd "2026-10-10T08:00" +
// "Asia/Ho_Chi_Minh"). Không có ô nào thì fact rỗng — không bịa.
export const FACT_SU_KIEN = [
  "ngay_gio",
  "mui_gio",
  "gia",
  "tinh_trang",
  "link_dat_hang",
] as const;
export type FactSuKien = Partial<Record<(typeof FACT_SU_KIEN)[number], string>>;

// Đọc/validate fact JSON lưu trên ke_hoach. Chỉ giữ key đã biết, ép chuỗi
// có trim — object lạ không nuốt lặng sang thông điệp.
export function docFact(factJson: string | null | undefined): FactSuKien {
  let j: unknown = null;
  try {
    j = JSON.parse(factJson ?? "{}");
  } catch {
    return {};
  }
  if (typeof j !== "object" || j === null || Array.isArray(j)) return {};
  const ra: FactSuKien = {};
  for (const k of FACT_SU_KIEN) {
    const v = (j as Record<string, unknown>)[k];
    if (typeof v === "string" && v.trim() !== "") ra[k] = v.trim();
  }
  return ra;
}

// Validate fact từ request: key lạ → lỗi từng trường, giá trị không phải
// chuỗi hoặc quá dài → lỗi. Trả dsLoi để gom một response 400 duy nhất.
export function kiemTraFact(body: unknown, dsLoi: string[]): FactSuKien | undefined {
  if (body === undefined) return undefined;
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    dsLoi.push("fact phải là object các trường sự thật đã xác nhận.");
    return undefined;
  }
  const fact: FactSuKien = {};
  for (const [k, v] of Object.entries(body as Record<string, unknown>)) {
    if (!(FACT_SU_KIEN as readonly string[]).includes(k)) {
      dsLoi.push(`fact.${k} không nằm trong danh sách: ${FACT_SU_KIEN.join(", ")}.`);
      continue;
    }
    if (v !== null && v !== undefined && typeof v !== "string") {
      dsLoi.push(`fact.${k} phải là chuỗi.`);
      continue;
    }
    const s = (v ?? "").toString().trim();
    if (s.length > 500) {
      dsLoi.push(`fact.${k} quá dài (tối đa 500 ký tự).`);
      continue;
    }
    if (s !== "") (fact as Record<string, string>)[k] = s;
  }
  return fact;
}

// Intake dạng sự kiện/thông báo: ra mắt, khai trương, mở bán, ưu đãi —
// nhóm đề xuất "Chung" đổi thành bundle thông báo đa kênh (#7).
export const RE_SU_KIEN =
  /ra\s+mắt|khai\s+trương|mở\s+bán|phát\s+hành|sự\s+kiện|ưu\s+đãi|giảm\s+giá|lễ\s+khai|launch|ra\s+mat|khai\s+truong|mo\s+ban|su\s+kien|uu\s+dai|giam\s+gia/iu;

// Ghép fact đã xác nhận vào nội dung thông điệp: một dòng thông báo chuẩn
// (một câu ghép gạch ngang — đầu ra sinh từ thông điệp giữ nguyên
// ngày/sản phẩm/giá/CTA trên mọi bản), rồi khối liệt kê cho người đọc, rồi
// intake gốc. Không có fact nào → trả nguyên intake.
export function ghepNoiDungThongBao(vanBan: string, fact: FactSuKien, cta: string): string {
  const f = docFact(JSON.stringify(fact));
  const phan: string[] = [];
  if (f.ngay_gio) phan.push(`thời gian ${f.ngay_gio}${f.mui_gio ? ` (${f.mui_gio})` : ""}`);
  else if (f.mui_gio) phan.push(`múi giờ ${f.mui_gio}`);
  if (f.gia) phan.push(`giá ${f.gia}`);
  if (f.tinh_trang) phan.push(f.tinh_trang);
  if (f.link_dat_hang) phan.push(`đặt hàng ${f.link_dat_hang}`);
  const ctaSach = cta.trim();
  if (ctaSach) phan.push(ctaSach);
  if (phan.length === 0) return vanBan;

  const dongChuan = phan.join(" — ");
  const muc: string[] = [];
  if (f.ngay_gio) {
    muc.push(`- Thời gian: ${f.ngay_gio}${f.mui_gio ? ` (${f.mui_gio})` : ""}`);
  } else if (f.mui_gio) {
    muc.push(`- Múi giờ: ${f.mui_gio}`);
  }
  if (f.gia) muc.push(`- Giá: ${f.gia}`);
  if (f.tinh_trang) muc.push(`- Tình trạng: ${f.tinh_trang}`);
  if (f.link_dat_hang) muc.push(`- Đặt hàng: ${f.link_dat_hang}`);
  if (ctaSach) muc.push(`- CTA: ${ctaSach}`);
  return [
    dongChuan,
    "",
    "## Sự thật đã xác nhận",
    ...muc,
    "",
    "## Intake",
    vanBan,
  ].join("\n");
}

// Fact còn thiếu mà đầu ra đã chọn cần — chỉ áp cho intake sự kiện. Ngày
// giờ cụ thể kèm múi giờ là bắt buộc mềm (hiển thị một ngày cụ thể để xác
// nhận thay vì ngày tương đối); giá/tình trạng/link đặt hàng là gợi ý.
export function factThieu(kh: KeHoach): string[] {
  if (!RE_SU_KIEN.test(kh.intake)) return [];
  const fact = docFact(kh.fact);
  const thieu: string[] = [];
  const coNgayCuThe = fact.ngay_gio
    ? RE_NGAY_CU_THE.test(fact.ngay_gio)
    : RE_NGAY_CU_THE.test(kh.intake);
  if (!coNgayCuThe) thieu.push("ngay_gio");
  if (fact.ngay_gio && !fact.mui_gio) thieu.push("mui_gio");
  for (const k of ["gia", "tinh_trang", "link_dat_hang"] as const) {
    if (!fact[k]) thieu.push(k);
  }
  return thieu;
}

// Câu hỏi làm rõ từ mã chứng cứ thiếu — text câu hỏi cố định phía server để
// UI không phải suy ra; không bịa fact, chỉ hỏi.
export const CAU_HOI_THIEU: Record<string, string> = {
  so_lieu: "Có số liệu hay con số cụ thể nào cần đưa vào không?",
  moc_thoi_gian: "Sự kiện/mốc thời gian diễn ra khi nào?",
  ngay_gio_cu_the: "Ngày giờ cụ thể diễn ra khi nào (kèm múi giờ)?",
  gia_ca: "Có thông tin giá, chi phí hay khuyến mãi không?",
};

// Đề xuất đầu ra deterministic: gán định dạng theo từ khóa trong hồ sơ đối
// tượng (moi_quan_tam + nhu_cau_giao_tiep + kien_thuc_nen). Không gọi AI —
// gợi ý phải lặp lại được và giải thích được. `dich_den` gắn sẵn kênh khi
// luật mang nghĩa kênh (vd caption → instagram trong bundle sự kiện #7).
const LUAT_DE_XUAT: { re: RegExp; ds_dinh_dang: (string | { dinh_dang: string; dich_den: string })[] }[] = [
  // Lãnh đạo trước: hồ sơ "lãnh đạo kỹ thuật" cũng chứa "kỹ thuật" — khớp
  // sai luật sẽ đề xuất bài chuyên sâu cho đối tượng cần bản tóm tắt (#6).
  { re: /lãnh đạo|quản lý|giám đốc|sếp|leadership/i, ds_dinh_dang: ["caption", "thread"] },
  { re: /kỹ thuật|kỹ sư|developer|lập trình|chi tiết kỹ thuật/i, ds_dinh_dang: ["bai-viet", "thread"] },
  { re: /mạng xã hội|ngắn|lan truyền|trẻ|gen ?z/i, ds_dinh_dang: ["caption", "thread"] },
  { re: /email|bản tin|newsletter|cập nhật/i, ds_dinh_dang: ["newsletter"] },
  { re: /video|kịch bản|ngắn gọn|tiktok|reel|shorts/i, ds_dinh_dang: ["script-ngan"] },
  { re: /phỏng vấn|hỏi đáp|q&a|faq|giải đáp/i, ds_dinh_dang: ["faq"] },
];
const DINH_DANG_MAC_DINH_DT = ["bai-viet", "caption"];
const DINH_DANG_MAC_DINH_CHUNG = ["newsletter", "caption"];

// Bundle thông báo sự kiện (#7): thông báo web → trang local, caption
// Instagram, script TikTok, bài đăng Google Business, email khách — tất cả
// ở nhóm "Chung" để một intake sự kiện có ngay bundle mạch lạc đã chọn.
const DE_XUAT_SU_KIEN: DauRaDeXuat[] = [
  { doi_tuong_id: null, dinh_dang: "bai-viet" },
  { doi_tuong_id: null, dinh_dang: "caption", dich_den: "instagram" },
  { doi_tuong_id: null, dinh_dang: "script-ngan", dich_den: "tiktok" },
  { doi_tuong_id: null, dinh_dang: "google-business", dich_den: "google-business" },
  { doi_tuong_id: null, dinh_dang: "email-khach", dich_den: "email" },
];

export function deXuatDauRaChoDoiTuong(dt: HoSoDoiTuong): string[] {
  const vanBan = `${dt.moi_quan_tam} ${dt.nhu_cau_giao_tiep} ${dt.kien_thuc_nen} ${dt.ten}`;
  for (const luat of LUAT_DE_XUAT) {
    if (luat.re.test(vanBan)) {
      return luat.ds_dinh_dang.map((x) => (typeof x === "string" ? x : x.dinh_dang));
    }
  }
  return DINH_DANG_MAC_DINH_DT;
}

// Đề xuất đầy đủ cho một kế hoạch: một entry "chung" (không đối tượng) +
// một nhóm cho mỗi hồ sơ đối tượng. Lọc theo ngôn ngữ định dạng hỗ trợ.
// `vanBan` = intake — sự kiện thì nhóm chung đổi thành bundle đa kênh (#7).
export function deXuatDauRa(db: Database, ngonNgu: string, vanBan = ""): DauRaDeXuat[] {
  const ds: DauRaDeXuat[] = [];
  // Lọc theo ngôn ngữ của chính entry đề xuất — hồ sơ đối tượng ngôn ngữ khác
  // vẫn sinh được đề xuất chọn được.
  const hopLe = (dd: string, nn: string) =>
    layDinhDang(dd) && !kiemTraNgonNgu(layDinhDang(dd)!, nn);
  const chung = RE_SU_KIEN.test(vanBan) ? DE_XUAT_SU_KIEN : DINH_DANG_MAC_DINH_CHUNG;
  for (const dx of chung) {
    const dd = typeof dx === "string" ? dx : dx.dinh_dang;
    const dichDen = typeof dx === "string" ? undefined : dx.dich_den;
    if (hopLe(dd, ngonNgu)) {
      ds.push({ doi_tuong_id: null, dinh_dang: dd, ngon_ngu: ngonNgu, dich_den: dichDen });
    }
  }
  for (const dt of danhSachDoiTuong(db)) {
    const nn = dt.ngon_ngu || ngonNgu;
    for (const dd of deXuatDauRaChoDoiTuong(dt)) {
      if (hopLe(dd, nn) && !ds.some((d) => d.doi_tuong_id === dt.id && d.dinh_dang === dd)) {
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
    const cta = (input.cta ?? "").trim();
    const fact = input.fact ?? {};
    // Ghép fact đã xác nhận vào nội dung: dòng chuẩn đứng đầu → mọi đầu ra
    // sinh từ thông điệp giữ nguyên ngày/sản phẩm/giá/CTA trên mọi bản (#7).
    const noiDung = ghepNoiDungThongBao(vanBan, fact, cta);
    const tieuDe = (input.tieu_de ?? "").trim() || vanBan.split("\n")[0]!.slice(0, 120);
    const td = taoThongDiep(
      db,
      { tieu_de: tieuDe, noi_dung: noiDung, nguon_ids: input.nguon_id ? [input.nguon_id] : [] },
      tacGia,
    );
    const id = crypto.randomUUID();
    const ts = bayGio();
    const deXuat = JSON.stringify(deXuatDauRa(db, "vi", vanBan));
    db.query(
      `INSERT INTO ke_hoach (id, thong_diep_id, nguon_id, intake, cta, fact, de_xuat_dau_ra, ds_chon, trang_thai, tao_luc, tao_boi, cap_nhat_luc, cap_nhat_boi)
       VALUES (?, ?, ?, ?, ?, ?, ?, '[]', 'nhap', ?, ?, ?, ?)`,
    ).run(id, td.id, input.nguon_id ?? null, vanBan, cta, JSON.stringify(fact), deXuat, ts, tacGia, ts, tacGia);
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
// intake mới — "lưu intake chưa xong và tiếp tục sau". Client có thể ghim
// `dua_tren_revision_id` của head thông điệp nó đang sửa → trôi head → 409
// đúng convention (bỏ trống = lấy head hiện tại, last-write-wins một actor).
// PUT y hệt nội dung cũ = no-op (không đẩy bản thể hiện sang bth_cu giả).
export function capNhatKeHoach(
  db: Database,
  id: string,
  input: {
    van_ban?: string;
    tieu_de?: string;
    cta?: string;
    fact?: FactSuKien;
    dua_tren_revision_id?: string;
  },
  tacGia: string,
): KeHoach {
  return txn(db, () => {
    const kh = layKeHoach(db, id);
    if (!kh) loiRequest(404, "KHONG_TIM_THAY", "Không tìm thấy kế hoạch.");
    const td = layThongDiep(db, kh.thong_diep_id)!;
    if (input.van_ban !== undefined && !input.van_ban.trim()) {
      loiRequest(400, "VALIDATION", "van_ban không được rỗng — intake không thể hủy lặng.");
    }
    // Trim như POST — không để whitespace thừa tạo revision/intake giả.
    const vanBan = input.van_ban !== undefined ? input.van_ban.trim() : kh.intake;
    const tieuDe = input.tieu_de !== undefined ? input.tieu_de.trim() : td.tieu_de;
    const cta = input.cta !== undefined ? input.cta.trim() : kh.cta;
    // fact truyền vào thay toàn bộ — client gửi đủ các ô nó có.
    const fact = input.fact !== undefined ? input.fact : docFact(kh.fact);
    // Sửa sản phẩm/ngày → revision thông điệp mới: sự thay đổi fact truy về
    // được tới nguồn thông báo và cờ các bản đã sinh là đã cũ (#7).
    const noiDung = ghepNoiDungThongBao(vanBan, fact, cta);
    const noiDungCu =
      td.head_revision_id
        ? (layThongDiepRevision(db, td.head_revision_id)?.noi_dung ?? td.noi_dung)
        : td.noi_dung;
    const noiDungDoi = noiDung !== noiDungCu || tieuDe !== td.tieu_de;
    if (noiDungDoi) {
      capNhatThongDiep(
        db,
        td.id,
        { tieu_de: tieuDe, noi_dung: noiDung, nguon_ids: kh.nguon_id ? [kh.nguon_id] : [] },
        input.dua_tren_revision_id ?? td.head_revision_id ?? "",
        tacGia,
      );
    }
    db.query(
      "UPDATE ke_hoach SET intake = ?, cta = ?, fact = ?, de_xuat_dau_ra = ?, cap_nhat_luc = ?, cap_nhat_boi = ? WHERE id = ?",
    ).run(vanBan, cta, JSON.stringify(fact), JSON.stringify(deXuatDauRa(db, "vi", vanBan)), bayGio(), tacGia, id);
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
      if (chon.dich_den !== undefined && typeof chon.dich_den !== "string") {
        dsLoi.push(`ds_chon[${i}].dich_den phải là chuỗi.`);
      } else if ((chon.dich_den ?? "").length > 120) {
        dsLoi.push(`ds_chon[${i}].dich_den quá dài (tối đa 120 ký tự).`);
      }
    }
    if (dsLoi.length > 0) throw new LoiApi(400, "VALIDATION", "ds_chon không hợp lệ.", dsLoi);

    // Lọc lựa chọn trùng sau validate — dich_den đã chắc là chuỗi ở đây.
    // Khóa chuẩn hóa giống khóa bản thể hiện (dich_den trim): "linkedin"
    // và " linkedin " tính trùng, response không đếm hai lần.
    const daCo = new Set<string>();
    dsChon = dsChon.filter((c) => {
      const k = `${c.doi_tuong_id ?? ""}|${c.dinh_dang}|${c.ngon_ngu ?? ""}|${(c.dich_den ?? "").trim()}`;
      if (daCo.has(k)) return false;
      daCo.add(k);
      return true;
    });

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
        dich_den: (chon.dich_den ?? "").trim(),
      };
      const bth = timBanTheHien(db, khoa) ?? taoBanTheHien(db, khoa, tacGia);
      dsBth.push(bth);
      // Ghim head lúc enqueue + khoa_idem theo bản — giống route POST /job:
      // sửa tay trước khi job chạy → job vinh_vien thay vì ghi đè sửa tay.
      const { job } = enqueueJob(db, {
        loai: "sinh_ban_the_hien",
        payload: {
          thong_diep_id: kh.thong_diep_id,
          dinh_dang: chon.dinh_dang,
          ngon_ngu: khoa.ngon_ngu,
          doi_tuong: dtTen(chon.doi_tuong_id) || undefined,
          // Hồ sơ đối tượng đi vào context sinh (#6) — bản kỹ sư/lãnh đạo
          // khác nhau ở hồ sơ, không chỉ ở nhãn. dich_den giữ cho job và
          // bản thể hiện cùng một kênh đích (vd ba script video ngắn).
          doi_tuong_id: chon.doi_tuong_id ?? undefined,
          dich_den: khoa.dich_den || undefined,
        },
        entityLoai: "ban_the_hien",
        entityId: bth.id,
        revisionId: bth.head_revision_id ?? null,
        khoaIdem: `sinh_ban_the_hien:${bth.id}`,
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

// Việc gần đây trên home: kế hoạch + bản thể hiện xếp theo revision mới
// nhất (sinh lại/sửa cũng đưa bản lên đầu, không chỉ bản mới tạo).
export function viecGanDay(db: Database, gioiHan = 10): {
  ke_hoach: (KeHoach & { tieu_de: string })[];
  ban_the_hien: BanTheHien[];
} {
  return {
    ke_hoach: danhSachKeHoach(db, gioiHan),
    ban_the_hien: db
      .query(
        `SELECT bth.* FROM ban_the_hien bth
         LEFT JOIN revision r ON r.ban_the_hien_id = bth.id
         GROUP BY bth.id
         ORDER BY COALESCE(MAX(r.tao_luc), bth.tao_luc) DESC
         LIMIT ?`,
      )
      .all(gioiHan) as BanTheHien[],
  };
}
