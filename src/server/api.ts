import type { Database } from "bun:sqlite";
import { join } from "node:path";
import {
  LoiApi,
  batBuocChuoi,
  loiRequest,
  nemLoiValidation,
  tuyChonChuoi,
  tuyChonMangChuoi,
  tuyChonObject,
} from "../loi.ts";
import { log } from "../log.ts";
import {
  DANH_SACH_LOAI_MUC,
  capNhatCampaign,
  capNhatNguon,
  capNhatThongDiep,
  chuyenTrangThai,
  danhSachBanTheHien,
  danhSachCampaign,
  danhSachDuyet,
  danhSachNguon,
  danhSachNguonCuaThongDiep,
  danhSachNguonRevision,
  danhSachRevision,
  danhSachSuKien,
  danhSachThongDiep,
  danhSachThongDiepRevision,
  danhSachXuatBan,
  layBanTheHien,
  layCampaign,
  layNguon,
  layNguonRevision,
  layNhapSoan,
  layRevision,
  layThongDiep,
  layThongDiepRevision,
  luuNhapSoan,
  nhapBaiViet,
  taoBanTheHien,
  taoCampaign,
  taoNguon,
  taoThongDiep,
  themRevision,
  timBanTheHien,
  xoaCampaign,
  xoaNhapSoan,
  xuatBanBanTheHien,
  type MucLuc,
  type MucNguon,
  type NhapBanTheHien,
} from "../modules/content/index.ts";
import {
  DANH_SACH_DO_SAU,
  DANH_SACH_NGUON_DU_LIEU,
  capNhatDoiTuong,
  capNhatThuongHieu,
  danhSachDoiTuong,
  danhSachHoSoRevision,
  danhSachThuatNgu,
  danhSachThuongHieu,
  lapContextSinh,
  layContextSinh,
  layDoiTuong,
  layThuongHieu,
  taoDoiTuong,
  taoThuongHieu,
  thayThuatNgu,
  xoaDoiTuong,
  xoaThuongHieu,
  TRUONG_GHI_DE_DOI_TUONG,
  TRUONG_GHI_DE_THUONG_HIEU,
  type ContextSinh,
  type GhiDeCampaign,
  type NguonDuLieu,
  type NhapThuatNgu,
} from "../modules/context/index.ts";
import {
  DANH_SACH_DINH_DANG,
  danhSachDinhDang,
  kiemTraNoiDung,
  kiemTraNgonNgu,
  layDinhDang,
  renderHtml,
  renderMarkdown,
  renderText,
} from "../modules/formats/index.ts";
import { taoBundleXuatBan } from "../modules/formats/xuat.ts";
import {
  capNhatVanBan,
  danhSachAsset,
  danhSachAssetBanTheHien,
  datAssetBanTheHien,
  dsAssetIdBanTheHien,
  khoByteLocal,
  kiemTraByteAsset,
  layAsset,
  luuAsset,
  luuTruAsset,
  napVanBan,
  sachTenFile,
  timAssetTheoChecksum,
  xoaAsset,
} from "../modules/nap/index.ts";
import {
  danhSachJob,
  enqueueJob,
  huyJob,
  layJob,
  nhatKyJob,
  thuLaiJob,
} from "../modules/jobs/index.ts";
import {
  chonMucLuc,
  deXuatMucLuc,
  docThamChieuView,
  goiYKhoangTrong,
  kiemTraHoSoSoBao,
  kiemTraMucLuc,
  kiemTraThamChieu,
  lienKetNguonThamChieu,
  themMucLuc,
  tienDoSoBao,
  thongDiepChuDe,
} from "../modules/so_bao/index.ts";
import { taoBundleSoBao } from "../modules/so_bao/xuat.ts";
import { LOAI_JOB_HO_TRO } from "../modules/jobs/handlers.ts";
import { danhSachSuDungSinh } from "../modules/generation/index.ts";
import {
  cauHoiLamRo,
  chonDauRa,
  danhSachBanTheHienCu,
  danhSachKeHoach,
  docFact,
  factThieu,
  kiemTraFact,
  layKeHoach,
  capNhatKeHoach,
  taoKeHoach,
  viecGanDay,
  type DauRaDeXuat,
} from "../modules/luong/index.ts";
import type { CauHinhAi } from "../config.ts";
import { docBody, kiemTraByteDaDoc, kiemTraGioiHanBody, loi, ok } from "./http.ts";

export type ApiCtx = {
  db: Database;
  dataDir: string;
  actor: string;
  provider: { ten: string; la_fixture: boolean; model?: string };
  ai: CauHinhAi;
};

type Handler = (
  req: Request,
  thamSo: Record<string, string>,
  ctx: ApiCtx,
) => Promise<Response> | Response;

type Route = { method: string; pattern: RegExp; keys: string[]; handler: Handler };

// Route nhỏ gọn, đủ dùng cho POC. Mẫu path: /api/tai-nguyen/:id.
function route(method: string, duongDan: string, handler: Handler): Route {
  const keys: string[] = [];
  const pattern = new RegExp(
    "^" +
      duongDan.replace(/:[^/]+/g, (m) => {
        keys.push(m.slice(1));
        return "([^/]+)";
      }) +
      "$",
  );
  return { method, pattern, keys, handler };
}

// --- Helper đọc input hồ sơ ---

function docNguonDuLieu(body: Record<string, unknown>, dsLoi: string[]): NguonDuLieu {
  const v = tuyChonChuoi(body.nguon_du_lieu);
  if (!v) return "nguoi_dung";
  if (!(DANH_SACH_NGUON_DU_LIEU as readonly string[]).includes(v)) {
    dsLoi.push(`nguon_du_lieu không hợp lệ. Cho phép: ${DANH_SACH_NGUON_DU_LIEU.join(", ")}.`);
    return "nguoi_dung";
  }
  return v as NguonDuLieu;
}

function docDoSau(body: Record<string, unknown>, dsLoi: string[]): string {
  const v = tuyChonChuoi(body.do_sau);
  if (v && !(DANH_SACH_DO_SAU as readonly string[]).includes(v)) {
    dsLoi.push(`do_sau không hợp lệ. Cho phép: ${DANH_SACH_DO_SAU.join(", ")} hoặc để trống (chưa biết).`);
    return "";
  }
  return v;
}

function docNhapThuongHieu(body: Record<string, unknown>, ten: string) {
  return {
    ten,
    nhan_dien: tuyChonChuoi(body.nhan_dien),
    ngon_ngu_uu_tien: tuyChonMangChuoi(body.ngon_ngu_uu_tien),
    vi_du_giong_van: tuyChonChuoi(body.vi_du_giong_van),
    nguyen_tac: tuyChonChuoi(body.nguyen_tac),
    claim_duyet: tuyChonMangChuoi(body.claim_duyet),
    claim_cam: tuyChonMangChuoi(body.claim_cam),
    assets: tuyChonMangChuoi(body.assets),
  };
}

function docNhapDoiTuong(body: Record<string, unknown>, ten: string, doSau: string) {
  return {
    ten,
    ngon_ngu: tuyChonChuoi(body.ngon_ngu),
    dia_diem: tuyChonChuoi(body.dia_diem),
    kien_thuc_nen: tuyChonChuoi(body.kien_thuc_nen),
    moi_quan_tam: tuyChonChuoi(body.moi_quan_tam),
    do_sau: doSau,
    tu_vung: tuyChonChuoi(body.tu_vung),
    quan_he_to_chuc: tuyChonChuoi(body.quan_he_to_chuc),
    nhu_cau_giao_tiep: tuyChonChuoi(body.nhu_cau_giao_tiep),
    nhan_khau_hoc: tuyChonChuoi(body.nhan_khau_hoc),
  };
}

function docDanhSachThuatNgu(v: unknown, dsLoi: string[]): NhapThuatNgu[] {
  if (!Array.isArray(v)) {
    dsLoi.push("thuat_ngu phải là một mảng.");
    return [];
  }
  const ds: NhapThuatNgu[] = [];
  const daCo = new Set<string>();
  for (const [i, dong] of v.entries()) {
    if (typeof dong !== "object" || dong === null) {
      dsLoi.push(`thuat_ngu[${i}] phải là object.`);
      continue;
    }
    const t = dong as Record<string, unknown>;
    const thuatNgu = typeof t.thuat_ngu === "string" ? t.thuat_ngu.trim() : "";
    if (!thuatNgu) dsLoi.push(`thuat_ngu[${i}].thuat_ngu là bắt buộc.`);
    // Trùng trong cùng payload → UNIQUE violation ở DB; chặn từ đây thành 400.
    if (thuatNgu && daCo.has(thuatNgu)) {
      dsLoi.push(`thuat_ngu[${i}].thuat_ngu "${thuatNgu}" trùng với một dòng khác.`);
    }
    daCo.add(thuatNgu);
    // giu_nguyen chỉ nhận boolean hoặc 0/1; kiểu khác (vd "false" chuỗi) → lỗi.
    let giuNguyen = true;
    if (t.giu_nguyen !== undefined && t.giu_nguyen !== null) {
      if (typeof t.giu_nguyen === "boolean") giuNguyen = t.giu_nguyen;
      else if (t.giu_nguyen === 0 || t.giu_nguyen === 1) giuNguyen = t.giu_nguyen === 1;
      else dsLoi.push(`thuat_ngu[${i}].giu_nguyen phải là boolean hoặc 0/1.`);
    }
    const banDich = tuyChonObject(t.ban_dich);
    for (const [k, x] of Object.entries(banDich)) {
      if (!k.trim() || typeof x !== "string") {
        dsLoi.push(`thuat_ngu[${i}].ban_dich phải là map {ma_ngon_ngu: chuỗi}.`);
        break;
      }
    }
    ds.push({
      thuat_ngu: thuatNgu,
      giu_nguyen: giuNguyen,
      ban_dich: Object.fromEntries(
        Object.entries(banDich).map(([k, x]) => [k.trim(), String(x)]),
      ),
    });
  }
  return ds;
}

// Đọc ghi đè campaign: key lạ → bỏ qua (ghi_de là phần mở, campaign sau này
// có thể thêm phần); sai kiểu → lỗi validation thay vì bị apGhiDe bỏ âm thầm
// mà snapshot vẫn ghi "đã áp".
function docGhiDe(v: unknown, dsLoi: string[]): GhiDeCampaign {
  const ghiDe = tuyChonObject(v);
  const ketQua: Record<string, Record<string, unknown>> = {};
  for (const [k, sub] of Object.entries(ghiDe)) {
    if (k !== "thuong_hieu" && k !== "doi_tuong") {
      dsLoi.push(`ghi_de.${k} không hỗ trợ. Cho phép: thuong_hieu, doi_tuong.`);
      continue;
    }
    const choPhep = k === "thuong_hieu" ? TRUONG_GHI_DE_THUONG_HIEU : TRUONG_GHI_DE_DOI_TUONG;
    if (typeof sub !== "object" || sub === null || Array.isArray(sub)) {
      dsLoi.push(`ghi_de.${k} phải là object {truong: gia_tri}.`);
      continue;
    }
    const sach: Record<string, unknown> = {};
    for (const [truong, gt] of Object.entries(sub as Record<string, unknown>)) {
      if (!choPhep.has(truong)) continue; // trường không nằm trong whitelist → bỏ
      const hopLe =
        typeof gt === "string" ||
        (Array.isArray(gt) && gt.every((x) => typeof x === "string"));
      if (!hopLe) {
        dsLoi.push(`ghi_de.${k}.${truong} phải là chuỗi hoặc mảng chuỗi.`);
        continue;
      }
      sach[truong] = gt;
    }
    ketQua[k] = sach;
  }
  return ketQua as GhiDeCampaign;
}

// Đọc so_thu_tu của số báo: absent → undefined (PUT giữ giá trị cũ),
// null/rỗng → null (xóa), còn lại phải là số nguyên >= 0.
function docSoThuTu(v: unknown, dsLoi: string[]): number | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  const n = typeof v === "string" ? Number(v) : v;
  if (typeof n !== "number" || !Number.isInteger(n) || n < 0) {
    dsLoi.push("so_thu_tu phải là số nguyên >= 0.");
    return undefined;
  }
  return n;
}

// Đọc ngay_phat_hanh: absent → undefined; chuỗi trống = chưa đặt; còn lại
// phải dạng YYYY-MM-DD.
function docNgayPhatHanh(v: unknown, dsLoi: string[]): string | undefined {
  if (v === undefined) return undefined;
  const s = tuyChonChuoi(v);
  if (s && !/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    dsLoi.push("ngay_phat_hanh phải có dạng YYYY-MM-DD.");
  }
  return s;
}

// Đọc cac_muc: mảng mục nguồn có cấu trúc {id, loai: section|fact, tieu_de?,
// noi_dung, assets?}. id thiếu → gán 'm{i+1}' theo vị trí; trùng id → lỗi.
function docCacMuc(v: unknown, dsLoi: string[]): MucNguon[] {
  if (!Array.isArray(v)) {
    dsLoi.push("cac_muc phải là một mảng.");
    return [];
  }
  const ds: MucNguon[] = [];
  const daCo = new Set<string>();
  for (const [i, dong] of v.entries()) {
    if (typeof dong !== "object" || dong === null || Array.isArray(dong)) {
      dsLoi.push(`cac_muc[${i}] phải là object.`);
      continue;
    }
    const m = dong as Record<string, unknown>;
    const loai = tuyChonChuoi(m.loai) || "section";
    if (!(DANH_SACH_LOAI_MUC as readonly string[]).includes(loai)) {
      dsLoi.push(`cac_muc[${i}].loai không hợp lệ. Cho phép: ${DANH_SACH_LOAI_MUC.join(", ")}.`);
    }
    const id = tuyChonChuoi(m.id) || `m${i + 1}`;
    if (daCo.has(id)) dsLoi.push(`cac_muc[${i}].id "${id}" trùng với mục khác.`);
    daCo.add(id);
    const noiDung = typeof m.noi_dung === "string" ? m.noi_dung : "";
    if (m.noi_dung === undefined || typeof m.noi_dung !== "string") {
      dsLoi.push(`cac_muc[${i}].noi_dung phải là chuỗi.`);
    }
    const assets = m.assets === undefined ? [] : tuyChonMangChuoi(m.assets);
    if (m.assets !== undefined && !Array.isArray(m.assets)) {
      dsLoi.push(`cac_muc[${i}].assets phải là mảng chuỗi.`);
    }
    ds.push({
      id,
      loai: loai as MucNguon["loai"],
      tieu_de: tuyChonChuoi(m.tieu_de) || undefined,
      noi_dung: noiDung,
      assets,
    });
  }
  return ds;
}

// Đọc danh sách đầu ra cho nhập bài: mỗi phần tử cần dinh_dang hợp lệ.
function docDsDauRa(v: unknown, dsLoi: string[]): Omit<NhapBanTheHien, "thong_diep_id">[] {
  if (!Array.isArray(v)) {
    dsLoi.push("ds_ban_the_hien phải là một mảng.");
    return [];
  }
  const ds: Omit<NhapBanTheHien, "thong_diep_id">[] = [];
  for (const [i, dong] of v.entries()) {
    if (typeof dong !== "object" || dong === null || Array.isArray(dong)) {
      dsLoi.push(`ds_ban_the_hien[${i}] phải là object.`);
      continue;
    }
    const d = dong as Record<string, unknown>;
    const dinhDang = tuyChonChuoi(d.dinh_dang);
    const def = dinhDang ? layDinhDang(dinhDang) : undefined;
    if (!def) {
      dsLoi.push(
        `ds_ban_the_hien[${i}].dinh_dang không hợp lệ. Cho phép: ${DANH_SACH_DINH_DANG.join(", ")}.`,
      );
      continue;
    }
    const ngonNgu = tuyChonChuoi(d.ngon_ngu) || undefined;
    const loiNg = kiemTraNgonNgu(def, ngonNgu);
    if (loiNg) {
      dsLoi.push(`ds_ban_the_hien[${i}].ngon_ngu: ${loiNg}`);
      continue;
    }
    ds.push({
      dinh_dang: dinhDang,
      ngon_ngu: ngonNgu,
      doi_tuong: tuyChonChuoi(d.doi_tuong) || undefined,
      dich_den: tuyChonChuoi(d.dich_den) || undefined,
    });
  }
  return ds;
}

// Chuẩn hóa một thời điểm nhận từ client (ISO hoặc datetime-local) về ISO UTC.
// Trả null khi field vắng; push lỗi vào dsLoi khi không parse được.
function chuanHoaThoiDiem(v: unknown, ten: string, dsLoi: string[]): string | null {
  const s = tuyChonChuoi(v);
  if (!s) return null;
  const t = Date.parse(s);
  if (!Number.isFinite(t)) {
    dsLoi.push(`${ten} không phải thời điểm hợp lệ (ISO 8601).`);
    return null;
  }
  return new Date(t).toISOString();
}

// Kiểm tên timezone theo danh mục IANA mà runtime hỗ trợ.
function laMuiGio(ten: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: ten });
    return true;
  } catch {
    return false;
  }
}

// Tham số số nguyên tùy chọn trong [min, max]; undefined → undefined.
function tuyChonSo(
  v: unknown,
  min: number,
  max: number,
  ten: string,
  dsLoi: string[],
): number | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) {
    dsLoi.push(`${ten} phải là số nguyên trong [${min}, ${max}].`);
    return undefined;
  }
  return n;
}

// Serialize một row context_sinh ra API: ghi_de + snapshot parse sẵn JSON —
// mọi endpoint trả cùng một shape.
function docContextSinh(cs: ContextSinh) {
  return {
    ...cs,
    ghi_de: JSON.parse(cs.ghi_de) as unknown,
    snapshot: JSON.parse(cs.snapshot) as unknown,
  };
}

export function taoApi(ctx: ApiCtx): (req: Request) => Promise<Response> {
  // Kho byte trên đĩa local, gốc <dataDir>/assets — interface hẹp để test
  // được bằng kho in-memory (modules/nap).
  const kho = khoByteLocal(join(ctx.dataDir, "assets"));
  const routes: Route[] = [
    route("GET", "/api/health", (_req, _p, c) =>
      ok({ trang_thai: "hoat_dong", provider: c.provider }),
    ),

    // Usage sinh nội dung (#20): provider/model/task, token khi có,
    // thời gian chạy và lỗi mỗi lần gọi.
    route("GET", "/api/su-dung-sinh", (req, _p, c) => {
      const jobId = new URL(req.url).searchParams.get("job_id") || undefined;
      return ok(danhSachSuDungSinh(c.db, { job_id: jobId }));
    }),

    route("GET", "/api/tong-quan", (_req, _p, c) =>
      ok({
        nguon: (c.db.query("SELECT COUNT(*) AS c FROM nguon").get() as { c: number }).c,
        campaign: (c.db.query("SELECT COUNT(*) AS c FROM campaign").get() as { c: number }).c,
        thong_diep: (c.db.query("SELECT COUNT(*) AS c FROM thong_diep").get() as { c: number }).c,
        ban_the_hien: (c.db.query("SELECT COUNT(*) AS c FROM ban_the_hien").get() as { c: number }).c,
        revision: (c.db.query("SELECT COUNT(*) AS c FROM revision").get() as { c: number }).c,
        ho_so_thuong_hieu: (c.db.query("SELECT COUNT(*) AS c FROM ho_so_thuong_hieu").get() as { c: number }).c,
        ho_so_doi_tuong: (c.db.query("SELECT COUNT(*) AS c FROM ho_so_doi_tuong").get() as { c: number }).c,
        job_cho: (
          c.db.query("SELECT COUNT(*) AS c FROM job WHERE trang_thai = 'cho'").get() as {
            c: number;
          }
        ).c,
        // #5: home lấy từ state lưu thật — việc gần đây + hàng chờ review +
        // bản thể hiện đã cũ (revision ghim lệch head thông điệp).
        viec_gan_day: viecGanDay(c.db),
        bth_cho_duyet: danhSachBanTheHien(c.db, { trangThai: "cho_duyet" }).slice(0, 20),
        bth_cu: danhSachBanTheHienCu(c.db),
      }),
    ),

    // --- Kế hoạch: luồng intake → chọn đầu ra → sinh (#5) ---
    route("GET", "/api/ke-hoach", (_req, _p, c) => ok(danhSachKeHoach(c.db))),
    route("POST", "/api/ke-hoach", async (req, _p, c) => {
      const body = await docBody(req);
      const dsLoi: string[] = [];
      const vanBan = batBuocChuoi(body.van_ban, "van_ban", dsLoi);
      const nguonId = tuyChonChuoi(body.nguon_id);
      if (nguonId && !layNguon(c.db, nguonId)) {
        dsLoi.push(`Nguồn không tồn tại: ${nguonId}`);
      }
      const fact = kiemTraFact(body.fact, dsLoi);
      nemLoiValidation(dsLoi);
      const kh = taoKeHoach(
        c.db,
        {
          van_ban: vanBan,
          tieu_de: tuyChonChuoi(body.tieu_de) || undefined,
          nguon_id: nguonId || null,
          cta: tuyChonChuoi(body.cta),
          fact,
        },
        c.actor,
      );
      return ok({
        ke_hoach: kh,
        cau_hoi: cauHoiLamRo(c.db, kh),
        de_xuat: JSON.parse(kh.de_xuat_dau_ra),
        fact_thieu: factThieu(kh),
      });
    }),
    route("GET", "/api/ke-hoach/:id", (_req, p, c) => {
      const kh = layKeHoach(c.db, p.id!);
      if (!kh) loiRequest(404, "KHONG_TIM_THAY", "Không tìm thấy kế hoạch.");
      return ok({
        ke_hoach: kh,
        thong_diep: layThongDiep(c.db, kh.thong_diep_id),
        nguon: kh.nguon_id ? layNguon(c.db, kh.nguon_id) : null,
        cau_hoi: cauHoiLamRo(c.db, kh),
        de_xuat: JSON.parse(kh.de_xuat_dau_ra),
        ds_chon: JSON.parse(kh.ds_chon),
        ho_so_doi_tuong: danhSachDoiTuong(c.db),
        // Fact đã xác nhận (parse sẵn) + danh sách ô còn thiếu mà đầu ra
        // sự kiện cần — UI hiển thị ngày cụ thể để xác nhận (#7).
        fact: docFact(kh.fact),
        fact_thieu: factThieu(kh),
      });
    }),
    route("PUT", "/api/ke-hoach/:id", async (req, p, c) => {
      const body = await docBody(req);
      const dsLoi: string[] = [];
      if (body.van_ban !== undefined && typeof body.van_ban !== "string") {
        dsLoi.push("van_ban phải là chuỗi.");
      }
      if (body.tieu_de !== undefined && typeof body.tieu_de !== "string") {
        dsLoi.push("tieu_de phải là chuỗi.");
      }
      if (body.cta !== undefined && typeof body.cta !== "string") {
        dsLoi.push("cta phải là chuỗi.");
      }
      if (body.dua_tren_revision_id !== undefined && typeof body.dua_tren_revision_id !== "string") {
        dsLoi.push("dua_tren_revision_id phải là chuỗi.");
      }
      const fact = kiemTraFact(body.fact, dsLoi);
      nemLoiValidation(dsLoi);
      const kh = capNhatKeHoach(
        c.db,
        p.id!,
        {
          van_ban: body.van_ban as string | undefined,
          tieu_de: body.tieu_de as string | undefined,
          cta: body.cta as string | undefined,
          fact,
          dua_tren_revision_id: body.dua_tren_revision_id as string | undefined,
        },
        c.actor,
      );
      return ok({ ke_hoach: kh, cau_hoi: cauHoiLamRo(c.db, kh), fact_thieu: factThieu(kh) });
    }),
    route("POST", "/api/ke-hoach/:id/chon", async (req, p, c) => {
      const body = await docBody(req);
      const dsLoi: string[] = [];
      const dsChon = body.ds_chon;
      if (
        !Array.isArray(dsChon) ||
        dsChon.length === 0 ||
        dsChon.some((x) => typeof x !== "object" || x === null || Array.isArray(x))
      ) {
        dsLoi.push("ds_chon phải là mảng object lựa chọn không rỗng.");
      } else {
        for (const [i, x] of dsChon.entries()) {
          if (typeof x.dinh_dang !== "string" || !x.dinh_dang) {
            dsLoi.push(`ds_chon[${i}].dinh_dang bắt buộc.`);
          }
          if (x.doi_tuong_id !== undefined && x.doi_tuong_id !== null && typeof x.doi_tuong_id !== "string") {
            dsLoi.push(`ds_chon[${i}].doi_tuong_id phải là chuỗi hoặc null.`);
          }
          if (x.ngon_ngu !== undefined && typeof x.ngon_ngu !== "string") {
            dsLoi.push(`ds_chon[${i}].ngon_ngu phải là chuỗi.`);
          }
          if (x.dich_den !== undefined && typeof x.dich_den !== "string") {
            dsLoi.push(`ds_chon[${i}].dich_den phải là chuỗi.`);
          }
        }
      }
      nemLoiValidation(dsLoi);
      const kq = chonDauRa(c.db, p.id!, dsChon as DauRaDeXuat[], c.actor);
      return ok(kq);
    }),

    // --- Hồ sơ thương hiệu ---
    route("GET", "/api/ho-so-thuong-hieu", (_req, _p, c) => ok(danhSachThuongHieu(c.db))),
    route("POST", "/api/ho-so-thuong-hieu", async (req, _p, c) => {
      const body = await docBody(req);
      const dsLoi: string[] = [];
      const ten = batBuocChuoi(body.ten, "ten", dsLoi);
      const nguonDuLieu = docNguonDuLieu(body, dsLoi);
      nemLoiValidation(dsLoi);
      return ok(taoThuongHieu(c.db, docNhapThuongHieu(body, ten), c.actor, { nguonDuLieu }), 201);
    }),
    route("GET", "/api/ho-so-thuong-hieu/:id", (_req, p, c) => {
      const hoSo = layThuongHieu(c.db, p.id!);
      if (!hoSo) loiRequest(404, "KHONG_TIM_THAY", "Không tìm thấy hồ sơ thương hiệu.");
      return ok({ ...hoSo, thuat_ngu: danhSachThuatNgu(c.db, hoSo.id) });
    }),
    route("PUT", "/api/ho-so-thuong-hieu/:id", async (req, p, c) => {
      const body = await docBody(req);
      const dsLoi: string[] = [];
      const ten = batBuocChuoi(body.ten, "ten", dsLoi);
      const nguonDuLieu = docNguonDuLieu(body, dsLoi);
      nemLoiValidation(dsLoi);
      return ok(capNhatThuongHieu(c.db, p.id!, docNhapThuongHieu(body, ten), c.actor, nguonDuLieu));
    }),
    route("DELETE", "/api/ho-so-thuong-hieu/:id", (_req, p, c) => {
      xoaThuongHieu(c.db, p.id!);
      return ok({ da_xoa: true });
    }),
    route("GET", "/api/ho-so-thuong-hieu/:id/revision", (_req, p, c) =>
      ok(danhSachHoSoRevision(c.db, "thuong_hieu", p.id!)),
    ),
    // Thay toàn bộ bảng thuật ngữ; mỗi thay đổi ghi một revision hồ sơ.
    route("PUT", "/api/ho-so-thuong-hieu/:id/thuat-ngu", async (req, p, c) => {
      const body = await docBody(req);
      const dsLoi: string[] = [];
      const ds = docDanhSachThuatNgu(body.thuat_ngu, dsLoi);
      const nguonDuLieu = docNguonDuLieu(body, dsLoi);
      nemLoiValidation(dsLoi);
      return ok(thayThuatNgu(c.db, p.id!, ds, c.actor, nguonDuLieu));
    }),

    // --- Hồ sơ đối tượng ---
    route("GET", "/api/ho-so-doi-tuong", (_req, _p, c) => ok(danhSachDoiTuong(c.db))),
    route("POST", "/api/ho-so-doi-tuong", async (req, _p, c) => {
      const body = await docBody(req);
      const dsLoi: string[] = [];
      const ten = batBuocChuoi(body.ten, "ten", dsLoi);
      const doSau = docDoSau(body, dsLoi);
      const nguonDuLieu = docNguonDuLieu(body, dsLoi);
      nemLoiValidation(dsLoi);
      return ok(taoDoiTuong(c.db, docNhapDoiTuong(body, ten, doSau), c.actor, { nguonDuLieu }), 201);
    }),
    route("GET", "/api/ho-so-doi-tuong/:id", (_req, p, c) => {
      const hoSo = layDoiTuong(c.db, p.id!);
      if (!hoSo) loiRequest(404, "KHONG_TIM_THAY", "Không tìm thấy hồ sơ đối tượng.");
      return ok(hoSo);
    }),
    route("PUT", "/api/ho-so-doi-tuong/:id", async (req, p, c) => {
      const body = await docBody(req);
      const dsLoi: string[] = [];
      const ten = batBuocChuoi(body.ten, "ten", dsLoi);
      const doSau = docDoSau(body, dsLoi);
      const nguonDuLieu = docNguonDuLieu(body, dsLoi);
      nemLoiValidation(dsLoi);
      return ok(capNhatDoiTuong(c.db, p.id!, docNhapDoiTuong(body, ten, doSau), c.actor, nguonDuLieu));
    }),
    route("DELETE", "/api/ho-so-doi-tuong/:id", (_req, p, c) => {
      xoaDoiTuong(c.db, p.id!);
      return ok({ da_xoa: true });
    }),
    route("GET", "/api/ho-so-doi-tuong/:id/revision", (_req, p, c) =>
      ok(danhSachHoSoRevision(c.db, "doi_tuong", p.id!)),
    ),

    // --- Context sinh: xem trước không ghi DB; tham chiếu một snapshot đã lưu ---
    route("POST", "/api/context-sinh/xem-truoc", async (req, _p, c) => {
      const body = await docBody(req);
      const dsLoi: string[] = [];
      const ghiDe = docGhiDe(body.ghi_de, dsLoi);
      nemLoiValidation(dsLoi);
      return ok(
        lapContextSinh(c.db, {
          thuong_hieu_id: tuyChonChuoi(body.thuong_hieu_id) || null,
          doi_tuong_id: tuyChonChuoi(body.doi_tuong_id) || null,
          ghi_de: ghiDe,
        }),
      );
    }),
    route("GET", "/api/context-sinh/:id", (_req, p, c) => {
      const cs = layContextSinh(c.db, p.id!);
      if (!cs) loiRequest(404, "KHONG_TIM_THAY", "Không tìm thấy context sinh.");
      return ok(docContextSinh(cs));
    }),

    // --- Campaign: nhóm mục tiêu tùy chọn chứa nhiều thông điệp ---
    // Số báo (#8): campaign mang thêm field số báo (số thứ tự, ngày phát
    // hành, chủ đề, lập trường, chủ biên, hồ sơ dùng lại, tham chiếu nguồn
    // đã khai báo, mục lục). Field vắng mặt trên PUT giữ giá trị đã lưu.
    route("GET", "/api/campaign", (_req, _p, c) => ok(danhSachCampaign(c.db))),
    route("POST", "/api/campaign", async (req, _p, c) => {
      const body = await docBody(req);
      const dsLoi: string[] = [];
      const ten = batBuocChuoi(body.ten, "ten", dsLoi);
      const ghiDe = body.ghi_de !== undefined ? docGhiDe(body.ghi_de, dsLoi) : undefined;
      const soThuTu = docSoThuTu(body.so_thu_tu, dsLoi) ?? null;
      const ngayPhatHanh = docNgayPhatHanh(body.ngay_phat_hanh, dsLoi) ?? "";
      kiemTraHoSoSoBao(c.db, body, dsLoi);
      const thamChieu = kiemTraThamChieu(c.db, body.tham_chieu, dsLoi) ?? [];
      const mucLuc = kiemTraMucLuc(c.db, body.muc_luc, dsLoi) ?? [];
      nemLoiValidation(dsLoi);
      return ok(
        taoCampaign(
          c.db,
          {
            ten,
            mo_ta: tuyChonChuoi(body.mo_ta),
            ghi_de: ghiDe,
            so_thu_tu: soThuTu,
            ngay_phat_hanh: ngayPhatHanh,
            chu_de: tuyChonChuoi(body.chu_de),
            lap_truong: tuyChonChuoi(body.lap_truong),
            chu_bien: tuyChonChuoi(body.chu_bien),
            thuong_hieu_id: tuyChonChuoi(body.thuong_hieu_id) || null,
            doi_tuong_id: tuyChonChuoi(body.doi_tuong_id) || null,
            tham_chieu: thamChieu,
            muc_luc: mucLuc,
          },
          c.actor,
        ),
        201,
      );
    }),
    route("GET", "/api/campaign/:id", (_req, p, c) => {
      const cp = layCampaign(c.db, p.id!);
      if (!cp) loiRequest(404, "KHONG_TIM_THAY", "Không tìm thấy campaign.");
      const td = thongDiepChuDe(c.db, cp);
      return ok({
        ...cp,
        thong_diep: danhSachThongDiep(c.db, cp.id),
        thong_diep_chu_de: td ? { id: td.id, tieu_de: td.tieu_de } : null,
        tham_chieu_view: docThamChieuView(c.db, cp),
        de_xuat_muc_luc: deXuatMucLuc(c.db, cp),
        goi_y: goiYKhoangTrong(c.db, cp),
        tien_do: tienDoSoBao(c.db, cp),
        hang_cho: danhSachBanTheHien(c.db, { campaignId: cp.id, trangThai: "cho_duyet" }),
      });
    }),
    route("PUT", "/api/campaign/:id", async (req, p, c) => {
      const body = await docBody(req);
      const dsLoi: string[] = [];
      const ten = batBuocChuoi(body.ten, "ten", dsLoi);
      const ghiDe = body.ghi_de !== undefined ? docGhiDe(body.ghi_de, dsLoi) : undefined;
      const soThuTu = docSoThuTu(body.so_thu_tu, dsLoi);
      const ngayPhatHanh = docNgayPhatHanh(body.ngay_phat_hanh, dsLoi);
      kiemTraHoSoSoBao(c.db, body, dsLoi);
      const thamChieu = kiemTraThamChieu(c.db, body.tham_chieu, dsLoi);
      const mucLuc = kiemTraMucLuc(c.db, body.muc_luc, dsLoi);
      nemLoiValidation(dsLoi);
      return ok(
        capNhatCampaign(
          c.db,
          p.id!,
          {
            ten,
            // Field vắng mặt → giữ giá trị đã lưu; field có mặt rỗng → xóa.
            mo_ta: body.mo_ta === undefined ? undefined : tuyChonChuoi(body.mo_ta),
            ghi_de: ghiDe,
            so_thu_tu: soThuTu,
            ngay_phat_hanh: ngayPhatHanh,
            chu_de: body.chu_de === undefined ? undefined : tuyChonChuoi(body.chu_de),
            lap_truong: body.lap_truong === undefined ? undefined : tuyChonChuoi(body.lap_truong),
            chu_bien: body.chu_bien === undefined ? undefined : tuyChonChuoi(body.chu_bien),
            thuong_hieu_id: body.thuong_hieu_id === undefined ? undefined : tuyChonChuoi(body.thuong_hieu_id) || null,
            doi_tuong_id: body.doi_tuong_id === undefined ? undefined : tuyChonChuoi(body.doi_tuong_id) || null,
            tham_chieu: thamChieu,
            muc_luc: mucLuc,
          },
          c.actor,
        ),
      );
    }),
    route("PUT", "/api/campaign/:id/muc-luc", async (req, p, c) => {
      const body = await docBody(req);
      const dsLoi: string[] = [];
      const mucLuc = kiemTraMucLuc(c.db, body.muc_luc, dsLoi);
      nemLoiValidation(dsLoi);
      const cp = layCampaign(c.db, p.id!);
      if (!cp) loiRequest(404, "KHONG_TIM_THAY", "Không tìm thấy campaign.");
      return ok(capNhatCampaign(c.db, p.id!, { ten: cp.ten, muc_luc: mucLuc }, c.actor));
    }),
    route("POST", "/api/campaign/:id/muc-luc/them", async (req, p, c) => {
      const body = await docBody(req);
      return ok(themMucLuc(c.db, p.id!, (body.muc ?? body) as MucLuc, c.actor));
    }),
    route("POST", "/api/campaign/:id/chon", async (req, p, c) => {
      const body = await docBody(req);
      const dsMucId = tuyChonMangChuoi(body.ds_muc_id);
      return ok(chonMucLuc(c.db, p.id!, dsMucId, c.actor));
    }),
    route("POST", "/api/campaign/:id/tham-chieu/:refId/nguon", async (req, p, c) => {
      const body = await docBody(req);
      const nguonId = tuyChonChuoi(body.nguon_id);
      if (!nguonId) loiRequest(400, "VALIDATION", "nguon_id bắt buộc.");
      return ok(lienKetNguonThamChieu(c.db, p.id!, p.refId!, nguonId, c.actor));
    }),
    route("GET", "/api/campaign/:id/xuat", async (_req, p, c) => {
      const cp = layCampaign(c.db, p.id!);
      if (!cp) loiRequest(404, "KHONG_TIM_THAY", "Không tìm thấy campaign.");
      const { tenFile, byte } = await taoBundleSoBao(c.db, cp, kho);
      return new Response(new Blob([byte]), {
        headers: {
          "content-type": "application/zip",
          "content-disposition": `attachment; filename="${tenFile}"`,
        },
      });
    }),
    route("DELETE", "/api/campaign/:id", (_req, p, c) => {
      xoaCampaign(c.db, p.id!);
      return ok({ da_xoa: true });
    }),

    // --- Thông điệp chuẩn ---
    route("GET", "/api/thong-diep", (req, _p, c) => {
      const campaignId = new URL(req.url).searchParams.get("campaign_id") ?? undefined;
      return ok(danhSachThongDiep(c.db, campaignId));
    }),
    route("POST", "/api/thong-diep", async (req, _p, c) => {
      const body = await docBody(req);
      const dsLoi: string[] = [];
      const tieuDe = batBuocChuoi(body.tieu_de, "tieu_de", dsLoi);
      const campaignId = tuyChonChuoi(body.campaign_id) || null;
      if (campaignId && !layCampaign(c.db, campaignId)) {
        dsLoi.push("campaign_id không tồn tại.");
      }
      const nguonIds = tuyChonMangChuoi(body.nguon_ids);
      nemLoiValidation(dsLoi);
      return ok(
        taoThongDiep(
          c.db,
          {
            tieu_de: tieuDe,
            noi_dung: tuyChonChuoi(body.noi_dung),
            campaign_id: campaignId,
            nguon_ids: nguonIds,
          },
          c.actor,
        ),
        201,
      );
    }),
    route("GET", "/api/thong-diep/:id", (_req, p, c) => {
      const td = layThongDiep(c.db, p.id!);
      if (!td) loiRequest(404, "KHONG_TIM_THAY", "Không tìm thấy thông điệp.");
      const nguonIds = danhSachNguonCuaThongDiep(c.db, td.id);
      const dsNguon = nguonIds
        .map((id) => layNguon(c.db, id))
        .filter((n): n is NonNullable<typeof n> => n !== null)
        .map((n) => ({ id: n.id, tieu_de: n.tieu_de }));
      // Kế hoạch gắn thông điệp này (nếu đi qua luồng #5) — link quay lại
      // + fact đã xác nhận để trang thông điệp hiển thị lịch kèm múi giờ (#7).
      const kh = c.db
        .query(
          "SELECT id, trang_thai, fact FROM ke_hoach WHERE thong_diep_id = ? ORDER BY cap_nhat_luc DESC LIMIT 1",
        )
        .get(td.id) as { id: string; trang_thai: string; fact: string } | null;
      // Mọi đầu ra dưới một thông điệp (#6): nhãn định dạng, trạng thái
      // review, cờ "đã cũ" (revision ghim thông điệp lệch head), nháp tay,
      // record xuất bản mới nhất → URL trang do server phục vụ + dòng
      // nguồn đã ghim theo chuỗi revision.
      const dsDt = danhSachDoiTuong(c.db);
      const dsDauRa = danhSachBanTheHien(c.db, { thongDiepId: td.id }).map((b) => {
        const def = layDinhDang(b.dinh_dang);
        // Bản thể hiện chỉ giữ tên đối tượng — resolve ngược hồ sơ để
        // action "sinh lại" gửi đúng doi_tuong_id vào context sinh.
        const doiTuongId = dsDt.find((d) => d.ten === b.doi_tuong)?.id ?? null;
        const headRev = b.head_revision_id ? layRevision(c.db, b.head_revision_id) : null;
        const tdRev = headRev?.thong_diep_revision_id
          ? layThongDiepRevision(c.db, headRev.thong_diep_revision_id)
          : null;
        const dsNguonRev = (tdRev?.nguon_revision_ids ?? [])
          .map((id) => layNguonRevision(c.db, id))
          .filter((n): n is NonNullable<typeof n> => n !== null)
          .map((n) => ({ id: n.id, nguon_id: n.nguon_id, tieu_de: n.tieu_de, so_thu_tu: n.so_thu_tu }));
        const dsXb = danhSachXuatBan(c.db, b.id);
        const xbMoi = dsXb[0] ?? null;
        const dsAsset = danhSachAssetBanTheHien(c.db, b.id);
        return {
          ...b,
          dinh_dang_nhan: def?.nhan ?? b.dinh_dang,
          // Gợi ý đính kèm ảnh/asset của định dạng + asset hiện có — UI
          // hiển thị ô yêu cầu/upload khi thiếu, không bịa sẵn có ảnh (#7).
          goi_y_asset: def?.goi_y_asset ?? null,
          ds_asset: dsAsset.map((a) => ({ id: a.id, ten_file: a.ten_file, mime: a.mime })),
          doi_tuong_id: doiTuongId,
          head_revision_so: headRev?.so_thu_tu ?? null,
          la_cu:
            headRev?.thong_diep_revision_id != null &&
            headRev.thong_diep_revision_id !== td.head_revision_id,
          co_nhap: layNhapSoan(c.db, b.id, c.actor) !== null,
          so_xuat_ban: dsXb.length,
          xuat_ban_moi_nhat: xbMoi
            ? { id: xbMoi.id, dich_den: xbMoi.dich_den, tao_luc: xbMoi.tao_luc }
            : null,
          url_trang: xbMoi ? `/p/${b.id}` : null,
          nguon: dsNguonRev,
        };
      });
      return ok({
        ...td,
        campaign: td.campaign_id ? layCampaign(c.db, td.campaign_id) : null,
        nguon_ids: nguonIds,
        ds_nguon: dsNguon,
        ke_hoach: kh ? { ...kh, fact: docFact(kh.fact) } : null,
        ds_dau_ra: dsDauRa,
        revisions: danhSachThongDiepRevision(c.db, td.id),
      });
    }),
    route("PUT", "/api/thong-diep/:id", async (req, p, c) => {
      const body = await docBody(req);
      const dsLoi: string[] = [];
      const tieuDe = batBuocChuoi(body.tieu_de, "tieu_de", dsLoi);
      const duaTren = batBuocChuoi(body.dua_tren_revision_id, "dua_tren_revision_id", dsLoi);
      const campaignId = tuyChonChuoi(body.campaign_id) || null;
      if (campaignId && !layCampaign(c.db, campaignId)) {
        dsLoi.push("campaign_id không tồn tại.");
      }
      const nguonIds =
        body.nguon_ids === undefined ? undefined : tuyChonMangChuoi(body.nguon_ids);
      nemLoiValidation(dsLoi);
      return ok(
        capNhatThongDiep(
          c.db,
          p.id!,
          {
            tieu_de: tieuDe,
            noi_dung: tuyChonChuoi(body.noi_dung),
            campaign_id: campaignId,
            nguon_ids: nguonIds,
          },
          duaTren,
          c.actor,
        ),
      );
    }),
    route("GET", "/api/thong-diep/:id/revision", (_req, p, c) => {
      const td = layThongDiep(c.db, p.id!);
      if (!td) loiRequest(404, "KHONG_TIM_THAY", "Không tìm thấy thông điệp.");
      return ok(danhSachThongDiepRevision(c.db, td.id));
    }),

    // --- Nguồn ---
    route("GET", "/api/nguon", (_req, _p, c) => ok(danhSachNguon(c.db))),
    route("POST", "/api/nguon", async (req, _p, c) => {
      const body = await docBody(req);
      const dsLoi: string[] = [];
      const tieuDe = batBuocChuoi(body.tieu_de, "tieu_de", dsLoi);
      const noiDung = batBuocChuoi(body.noi_dung, "noi_dung", dsLoi);
      const loai = tuyChonChuoi(body.loai) || "van_ban";
      const cacMuc = body.cac_muc !== undefined ? docCacMuc(body.cac_muc, dsLoi) : undefined;
      nemLoiValidation(dsLoi);
      return ok(
        taoNguon(c.db, { tieu_de: tieuDe, noi_dung: noiDung, loai, cac_muc: cacMuc }, c.actor),
        201,
      );
    }),
    route("GET", "/api/nguon/:id", (_req, p, c) => {
      const nguon = layNguon(c.db, p.id!);
      if (!nguon) loiRequest(404, "KHONG_TIM_THAY", "Không tìm thấy nguồn.");
      return ok({ ...nguon, revisions: danhSachNguonRevision(c.db, nguon.id) });
    }),
    route("PUT", "/api/nguon/:id", async (req, p, c) => {
      const body = await docBody(req);
      const dsLoi: string[] = [];
      const tieuDe = batBuocChuoi(body.tieu_de, "tieu_de", dsLoi);
      const noiDung = batBuocChuoi(body.noi_dung, "noi_dung", dsLoi);
      const duaTren = batBuocChuoi(body.dua_tren_revision_id, "dua_tren_revision_id", dsLoi);
      const loai = tuyChonChuoi(body.loai) || undefined;
      const cacMuc = body.cac_muc !== undefined ? docCacMuc(body.cac_muc, dsLoi) : undefined;
      nemLoiValidation(dsLoi);
      return ok(
        capNhatNguon(
          c.db,
          p.id!,
          { tieu_de: tieuDe, noi_dung: noiDung, loai, cac_muc: cacMuc },
          duaTren,
          c.actor,
        ),
      );
    }),
    route("GET", "/api/nguon/:id/revision", (_req, p, c) => {
      const nguon = layNguon(c.db, p.id!);
      if (!nguon) loiRequest(404, "KHONG_TIM_THAY", "Không tìm thấy nguồn.");
      return ok(danhSachNguonRevision(c.db, nguon.id));
    }),
    route("GET", "/api/nguon-revision/:id", (_req, p, c) => {
      const rev = layNguonRevision(c.db, p.id!);
      if (!rev) loiRequest(404, "KHONG_TIM_THAY", "Không tìm thấy revision nguồn.");
      return ok(rev);
    }),

    // --- Nạp nguồn từ text (#17): dán text mới → nguồn + cac_muc chuẩn hóa;
    // nạp lại lên nguồn có sẵn → revision mới. khoa_idem chặn retry tạo trùng.
    route("POST", "/api/nguon/nhap", async (req, _p, c) => {
      const body = await docBody(req);
      const dsLoi: string[] = [];
      const tieuDe = batBuocChuoi(body.tieu_de, "tieu_de", dsLoi);
      const noiDung = batBuocChuoi(body.noi_dung, "noi_dung", dsLoi);
      nemLoiValidation(dsLoi);
      const kq = napVanBan(
        c.db,
        {
          tieu_de: tieuDe,
          noi_dung: noiDung,
          loai: tuyChonChuoi(body.loai) || undefined,
          khoa_idem: tuyChonChuoi(body.khoa_idem) || undefined,
        },
        c.actor,
      );
      return ok(kq, kq.da_tao ? 201 : 200);
    }),
    route("POST", "/api/nguon/:id/nhap", async (req, p, c) => {
      const body = await docBody(req);
      const dsLoi: string[] = [];
      const noiDung = batBuocChuoi(body.noi_dung, "noi_dung", dsLoi);
      nemLoiValidation(dsLoi);
      const kq = capNhatVanBan(
        c.db,
        p.id!,
        {
          noi_dung: noiDung,
          dua_tren_revision_id: tuyChonChuoi(body.dua_tren_revision_id) || undefined,
          khoa_idem: tuyChonChuoi(body.khoa_idem) || undefined,
        },
        c.actor,
      );
      return ok(kq, kq.da_tao ? 201 : 200);
    }),

    // --- Nhập bài viết: dán một bài tạo nguồn + thông điệp + nhiều bản thể hiện ---
    route("POST", "/api/bai-viet", async (req, _p, c) => {
      const body = await docBody(req);
      const dsLoi: string[] = [];
      const tieuDe = batBuocChuoi(body.tieu_de, "tieu_de", dsLoi);
      const noiDung = batBuocChuoi(body.noi_dung, "noi_dung", dsLoi);
      const loai = tuyChonChuoi(body.loai) || "van_ban";
      const cacMuc = body.cac_muc !== undefined ? docCacMuc(body.cac_muc, dsLoi) : undefined;
      const campaignId = tuyChonChuoi(body.campaign_id) || null;
      if (campaignId && !layCampaign(c.db, campaignId)) {
        dsLoi.push("campaign_id không tồn tại.");
      }
      const td = tuyChonObject(body.thong_diep);
      const thongDiep = {
        tieu_de: tuyChonChuoi(td.tieu_de) || undefined,
        noi_dung: typeof td.noi_dung === "string" ? td.noi_dung : undefined,
      };
      const nguonIds =
        body.nguon_ids === undefined ? undefined : tuyChonMangChuoi(body.nguon_ids);
      const dsDauRa =
        body.ds_ban_the_hien === undefined ? undefined : docDsDauRa(body.ds_ban_the_hien, dsLoi);
      nemLoiValidation(dsLoi);
      return ok(
        nhapBaiViet(
          c.db,
          {
            tieu_de: tieuDe,
            noi_dung: noiDung,
            loai,
            cac_muc: cacMuc,
            campaign_id: campaignId,
            thong_diep: thongDiep,
            nguon_ids: nguonIds,
            ds_ban_the_hien: dsDauRa,
          },
          c.actor,
        ),
        201,
      );
    }),

    // --- Bản thể hiện ---
    route("GET", "/api/ban-the-hien", (req, _p, c) => {
      const url = new URL(req.url);
      return ok(
        danhSachBanTheHien(c.db, {
          thongDiepId: url.searchParams.get("thong_diep_id") ?? undefined,
          nguonId: url.searchParams.get("nguon_id") ?? undefined,
          trangThai: url.searchParams.get("trang_thai") ?? undefined,
          campaignId: url.searchParams.get("campaign_id") ?? undefined,
        }),
      );
    }),
    route("POST", "/api/ban-the-hien", async (req, _p, c) => {
      const body = await docBody(req);
      const dsLoi: string[] = [];
      const thongDiepId = batBuocChuoi(body.thong_diep_id, "thong_diep_id", dsLoi);
      const dinhDang = batBuocChuoi(body.dinh_dang, "dinh_dang", dsLoi);
      const def = dinhDang ? layDinhDang(dinhDang) : undefined;
      if (dinhDang && !def) {
        dsLoi.push(`dinh_dang không hợp lệ. Cho phép: ${DANH_SACH_DINH_DANG.join(", ")}.`);
      }
      const ngonNgu = tuyChonChuoi(body.ngon_ngu) || "vi";
      const loiNg = def ? kiemTraNgonNgu(def, ngonNgu) : null;
      if (loiNg) dsLoi.push(loiNg);
      nemLoiValidation(dsLoi);
      const khoa = {
        thong_diep_id: thongDiepId,
        dinh_dang: dinhDang,
        ngon_ngu: ngonNgu,
        doi_tuong: tuyChonChuoi(body.doi_tuong),
        dich_den: tuyChonChuoi(body.dich_den),
      };
      // Cùng bộ khóa định danh → trả bản ghi có sẵn, không tạo trùng.
      const cu = timBanTheHien(c.db, khoa);
      if (cu) return ok({ ...cu, da_tao: false }, 200);
      return ok({ ...taoBanTheHien(c.db, khoa, c.actor), da_tao: true }, 201);
    }),
    route("GET", "/api/ban-the-hien/:id", (_req, p, c) => {
      const bth = layBanTheHien(c.db, p.id!);
      if (!bth) loiRequest(404, "KHONG_TIM_THAY", "Không tìm thấy bản thể hiện.");
      // Mỗi revision resolve đủ provenance đã ghim: context sinh (hồ sơ
      // thương hiệu/đối tượng + ghi đè) và revision thông điệp → revision nguồn.
      const revisions = danhSachRevision(c.db, bth.id).map((r) => {
        const cs = r.context_sinh_id ? layContextSinh(c.db, r.context_sinh_id) : null;
        const tdRev = r.thong_diep_revision_id
          ? layThongDiepRevision(c.db, r.thong_diep_revision_id)
          : null;
        const nguonRevisions = (tdRev?.nguon_revision_ids ?? [])
          .map((id) => layNguonRevision(c.db, id))
          .filter((n) => n !== null)
          .map((n) => ({ id: n.id, nguon_id: n.nguon_id, so_thu_tu: n.so_thu_tu, tieu_de: n.tieu_de }));
        return {
          ...r,
          context_sinh: cs ? docContextSinh(cs) : null,
          thong_diep_revision: tdRev ? { ...tdRev, nguon_revisions: nguonRevisions } : null,
        };
      });
      const thongDiep = layThongDiep(c.db, bth.thong_diep_id);
      return ok({
        ...bth,
        thong_diep: thongDiep,
        revisions,
        ds_xuat_ban: danhSachXuatBan(c.db, bth.id),
        assets: danhSachAssetBanTheHien(c.db, bth.id),
      });
    }),
    route("POST", "/api/ban-the-hien/:id/revision", async (req, p, c) => {
      const body = await docBody(req);
      const dsLoi: string[] = [];
      const noiDung = batBuocChuoi(body.noi_dung, "noi_dung", dsLoi);
      nemLoiValidation(dsLoi);
      const duaTren = tuyChonChuoi(body.dua_tren_revision_id) || null;
      const rev = themRevision(
        c.db,
        { ban_the_hien_id: p.id!, noi_dung: noiDung, dua_tren_revision_id: duaTren },
        c.actor,
      );
      // Nháp autosave của actor được coi là đã dùng xong (#21).
      xoaNhapSoan(c.db, p.id!, c.actor);
      // Trả kèm lỗi field theo schema định dạng để UI báo chỗ cần sửa ngay
      // (#19): vi phạm required/độ dài → feedback cụ thể. Content vẫn lưu;
      // lỗi chỉ là cảnh báo để sửa/duyệt.
      const bth = layBanTheHien(c.db, p.id!);
      const def = bth ? layDinhDang(bth.dinh_dang) : undefined;
      const dsLoiDd = def ? kiemTraNoiDung(def, rev.noi_dung) : [];
      if (bth && def && bth.phien_ban_dinh_dang !== def.phien_ban) {
        dsLoiDd.unshift({
          truong: "_dinh_dang",
          loi: `Bản thể hiện ghim định dạng v${bth.phien_ban_dinh_dang}, registry hiện v${def.phien_ban} — render theo schema mới nhất.`,
        });
      }
      return ok({ ...rev, ds_loi_dinh_dang: dsLoiDd }, 201);
    }),
    // Chuyển trạng thái qua service: ghi một record duyet ghim revision head.
    // `mong_doi_revision_id` bắt buộc khi duyệt — request duyệt cũ (head đã
    // đổi) lỗi sạch 409 thay vì duyệt nhầm revision mới (#21).
    route("POST", "/api/ban-the-hien/:id/trang-thai", async (req, p, c) => {
      const body = await docBody(req);
      return ok(
        chuyenTrangThai(
          c.db,
          p.id!,
          typeof body.trang_thai === "string" ? body.trang_thai : "",
          tuyChonChuoi(body.ghi_chu),
          c.actor,
          tuyChonChuoi(body.mong_doi_revision_id) || undefined,
        ),
      );
    }),
    // Nháp autosave của editor (#21): mỗi actor một nháp cho mỗi bản thể
    // hiện — sửa/reload/phục hồi không mất text chưa lưu.
    route("GET", "/api/ban-the-hien/:id/nhap", (_req, p, c) => {
      const bth = layBanTheHien(c.db, p.id!);
      if (!bth) loiRequest(404, "KHONG_TIM_THAY", "Không tìm thấy bản thể hiện.");
      const nhap = layNhapSoan(c.db, bth.id, c.actor);
      if (!nhap) loiRequest(404, "KHONG_TIM_THAY", "Chưa có nháp cho bản thể hiện này.");
      return ok(nhap);
    }),
    route("PUT", "/api/ban-the-hien/:id/nhap", async (req, p, c) => {
      const body = await docBody(req);
      if (typeof body.noi_dung !== "string") {
        throw new LoiApi(400, "VALIDATION", "noi_dung phải là chuỗi.");
      }
      return ok(
        luuNhapSoan(c.db, p.id!, c.actor, {
          noi_dung: body.noi_dung,
          dua_tren_revision_id:
            body.dua_tren_revision_id === undefined
              ? undefined
              : tuyChonChuoi(body.dua_tren_revision_id) || null,
        }),
      );
    }),
    route("DELETE", "/api/ban-the-hien/:id/nhap", (_req, p, c) => {
      const bth = layBanTheHien(c.db, p.id!);
      if (!bth) loiRequest(404, "KHONG_TIM_THAY", "Không tìm thấy bản thể hiện.");
      xoaNhapSoan(c.db, bth.id, c.actor);
      return ok({ da_xoa: true });
    }),
    route("GET", "/api/ban-the-hien/:id/duyet", (_req, p, c) => {
      const bth = layBanTheHien(c.db, p.id!);
      if (!bth) loiRequest(404, "KHONG_TIM_THAY", "Không tìm thấy bản thể hiện.");
      return ok(danhSachDuyet(c.db, bth.id));
    }),
    // Record xuất bản tách khỏi trạng thái nội dung: ghim revision head +
    // snapshot asset được chọn tại thời điểm đăng (#17). Vòng đời đầy đủ
    // (chỉ đăng khi đã duyệt) nằm ở #21.
    route("POST", "/api/ban-the-hien/:id/xuat-ban", async (req, p, c) => {
      const body = await docBody(req);
      return ok(
        xuatBanBanTheHien(
          c.db,
          p.id!,
          {
            dich_den: tuyChonChuoi(body.dich_den),
            ghi_chu: tuyChonChuoi(body.ghi_chu),
            asset_ids: dsAssetIdBanTheHien(c.db, p.id!),
          },
          c.actor,
        ),
        201,
      );
    }),

    // Asset đính kèm một đầu ra: chọn tường minh, replace toàn bộ (#17).
    route("PUT", "/api/ban-the-hien/:id/assets", async (req, p, c) => {
      const body = await docBody(req);
      const dsLoi: string[] = [];
      if (body.asset_ids !== undefined && !Array.isArray(body.asset_ids)) {
        dsLoi.push("asset_ids phải là một mảng chuỗi.");
      }
      const assetIds = tuyChonMangChuoi(body.asset_ids);
      nemLoiValidation(dsLoi);
      return ok(datAssetBanTheHien(c.db, p.id!, assetIds, c.actor));
    }),
    route("GET", "/api/ban-the-hien/:id/xuat-ban", (_req, p, c) => {
      const bth = layBanTheHien(c.db, p.id!);
      if (!bth) loiRequest(404, "KHONG_TIM_THAY", "Không tìm thấy bản thể hiện.");
      return ok(danhSachXuatBan(c.db, bth.id));
    }),

    // Xem trước (#19): render revision đã ghim (mặc định head) sang
    // markdown/text/HTML an toàn theo schema định dạng, kèm ds_loi field
    // để sửa trước khi duyệt. Không gọi provider, không sửa nội dung.
    route("GET", "/api/ban-the-hien/:id/xem-truoc", (req, p, c) => {
      const bth = layBanTheHien(c.db, p.id!);
      if (!bth) loiRequest(404, "KHONG_TIM_THAY", "Không tìm thấy bản thể hiện.");
      const def = layDinhDang(bth.dinh_dang);
      if (!def) {
        loiRequest(500, "LOI_CAU_HINH", `Định dạng '${bth.dinh_dang}' không còn trong registry.`);
      }
      const revisionId = new URL(req.url).searchParams.get("revision_id") || bth.head_revision_id;
      if (!revisionId) {
        return ok({
          revision_id: null,
          dinh_dang: def.id,
          phien_ban_dinh_dang: bth.phien_ban_dinh_dang,
          html: "",
          markdown: "",
          text: "",
          ds_loi: [],
        });
      }
      const rev = layRevision(c.db, revisionId);
      if (!rev || rev.ban_the_hien_id !== bth.id) {
        loiRequest(404, "KHONG_TIM_THAY", "Không tìm thấy revision của bản thể hiện.");
      }
      const dsLoi = kiemTraNoiDung(def, rev.noi_dung);
      if (bth.phien_ban_dinh_dang !== def.phien_ban) {
        dsLoi.unshift({
          truong: "_dinh_dang",
          loi: `Bản thể hiện ghim định dạng v${bth.phien_ban_dinh_dang}, registry hiện v${def.phien_ban} — render theo schema mới nhất.`,
        });
      }
      return ok({
        revision_id: rev.id,
        dinh_dang: def.id,
        phien_ban_dinh_dang: bth.phien_ban_dinh_dang,
        html: renderHtml(def, rev.noi_dung),
        markdown: renderMarkdown(def, rev.noi_dung),
        text: renderText(def, rev.noi_dung),
        ds_loi: dsLoi,
      });
    }),

    // Tải bundle export deterministic của một record xuất bản (#19):
    // render đúng revision đã ghim tại lúc đăng + manifest dòng nguồn +
    // chỉ asset được chọn tường minh.
    route("GET", "/api/ban-the-hien/:id/xuat-ban/:xbId/tai-ve", async (_req, p, c) => {
      const bth = layBanTheHien(c.db, p.id!);
      if (!bth) loiRequest(404, "KHONG_TIM_THAY", "Không tìm thấy bản thể hiện.");
      const xb = danhSachXuatBan(c.db, bth.id).find((x) => x.id === p.xbId);
      if (!xb) loiRequest(404, "KHONG_TIM_THAY", "Không tìm thấy bản xuất bản.");
      const { tenFile, byte } = await taoBundleXuatBan(c.db, bth, xb, kho);
      return new Response(new Blob([byte]), {
        headers: {
          "content-type": "application/zip",
          "content-disposition": `attachment; filename="${tenFile}"`,
        },
      });
    }),

    // --- Sự kiện mutation nhẹ ---
    route("GET", "/api/su-kien", (req, _p, c) => {
      const url = new URL(req.url);
      return ok(
        danhSachSuKien(c.db, {
          entityLoai: url.searchParams.get("entity_loai") ?? undefined,
          entityId: url.searchParams.get("entity_id") ?? undefined,
        }),
      );
    }),

    // --- Job ---
    route("GET", "/api/job", (req, _p, c) => {
      const trangThai = new URL(req.url).searchParams.get("trang_thai") ?? undefined;
      return ok(danhSachJob(c.db, trangThai));
    }),
    route("POST", "/api/job", async (req, _p, c) => {
      const body = await docBody(req);
      const dsLoi: string[] = [];
      const loai = batBuocChuoi(body.loai, "loai", dsLoi);
      if (loai && !(LOAI_JOB_HO_TRO as readonly string[]).includes(loai)) {
        dsLoi.push(`loai không hỗ trợ. Cho phép: ${LOAI_JOB_HO_TRO.join(", ")}.`);
      }
      const payload = (body.payload ?? {}) as Record<string, unknown>;
      if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
        dsLoi.push("payload phải là một JSON object.");
      }
      const khoaIdem = tuyChonChuoi(body.khoa_idem) || undefined;
      const chaySomNhat = chuanHoaThoiDiem(body.chay_som_nhat, "chay_som_nhat", dsLoi);
      const muiGio = tuyChonChuoi(body.mui_gio);
      if (muiGio && !laMuiGio(muiGio)) {
        dsLoi.push("mui_gio không phải tên timezone IANA hợp lệ.");
      }
      const soLanThuToiDa = tuyChonSo(body.so_lan_thu_toi_da, 1, 20, "so_lan_thu_toi_da", dsLoi);
      const timeoutMs = tuyChonSo(body.timeout_ms, 100, 3_600_000, "timeout_ms", dsLoi);
      const entityLoai = tuyChonChuoi(body.entity_loai);
      const entityId = tuyChonChuoi(body.entity_id);
      let revisionId = tuyChonChuoi(body.revision_id) || null;

      // Fan-out mỗi request giới hạn cấu hình (#20): một request sinh được
      // thêm payload.fan_out biến thể (định dạng/đối tượng/đích khác) — mỗi
      // biến thể một job riêng, tự ghim entity/revision của nó.
      const fanOut = payload.fan_out;
      const dsFanOut: Record<string, unknown>[] = [];
      if (loai === "sinh_ban_the_hien" && fanOut !== undefined) {
        if (!Array.isArray(fanOut) || fanOut.some((f) => typeof f !== "object" || f === null || Array.isArray(f))) {
          dsLoi.push("payload.fan_out phải là mảng object biến thể.");
        } else {
          const toiDa = c.ai.toi_da_fan_out ?? 8;
          if (fanOut.length > toiDa) {
            dsLoi.push(`payload.fan_out có ${fanOut.length} biến thể, vượt giới hạn cấu hình ${toiDa}.`);
          } else {
            dsFanOut.push(...(fanOut as Record<string, unknown>[]));
          }
        }
      }

      let thongDiepId = "";
      let dinhDang = "web";
      let ngonNgu = "vi";
      let dichDen = "";
      if (loai === "sinh_ban_the_hien") {
        thongDiepId = batBuocChuoi(payload.thong_diep_id, "payload.thong_diep_id", dsLoi);
        dinhDang = tuyChonChuoi(payload.dinh_dang) || "bai-viet";
        const def = layDinhDang(dinhDang);
        if (!def) {
          dsLoi.push(`payload.dinh_dang không hợp lệ. Cho phép: ${DANH_SACH_DINH_DANG.join(", ")}.`);
        }
        ngonNgu = tuyChonChuoi(payload.ngon_ngu) || "vi";
        const loiNg = def ? kiemTraNgonNgu(def, ngonNgu) : null;
        if (loiNg) dsLoi.push(loiNg);
        dichDen = tuyChonChuoi(payload.dich_den);
        // Cùng giới hạn với ds_chon của kế hoạch (#6): đích đến ≤120 ký tự.
        if (dichDen.length > 120) {
          dsLoi.push("payload.dich_den quá dài (tối đa 120 ký tự).");
        }
        if (thongDiepId && !layThongDiep(c.db, thongDiepId)) {
          dsLoi.push("payload.thong_diep_id không tồn tại.");
        }
        const thuongHieuId = tuyChonChuoi(payload.thuong_hieu_id);
        if (thuongHieuId && !layThuongHieu(c.db, thuongHieuId)) {
          dsLoi.push("payload.thuong_hieu_id không tồn tại.");
        }
        const doiTuongId = tuyChonChuoi(payload.doi_tuong_id);
        if (doiTuongId && !layDoiTuong(c.db, doiTuongId)) {
          dsLoi.push("payload.doi_tuong_id không tồn tại.");
        }
        if (payload.ghi_de !== undefined) {
          if (typeof payload.ghi_de !== "object" || payload.ghi_de === null || Array.isArray(payload.ghi_de)) {
            dsLoi.push("payload.ghi_de phải là object { thuong_hieu?, doi_tuong? }.");
          } else {
            // Validate + làm sạch: job chỉ lưu phần ghi đè thật sự áp được.
            payload.ghi_de = docGhiDe(payload.ghi_de, dsLoi);
          }
        }
      }
      nemLoiValidation(dsLoi);

      // Lưu state request + enqueue nguyên tử: bản thể hiện đích được tạo/tìm
      // trong cùng transaction với dòng job. Entity/revision job ghim vào
      // (bản thể hiện, head lúc enqueue); handler kiểm lại khi commit.
      c.db.exec("BEGIN IMMEDIATE");
      try {
        let bthId = entityId;
        if (loai === "sinh_ban_the_hien") {
          // Tên hiển thị của đối tượng: hồ sơ được chọn thì lấy tên hồ sơ,
          // không thì giữ chuỗi doi_tuong tự nhập như cũ.
          const dtId = tuyChonChuoi(payload.doi_tuong_id);
          const tenHienThi =
            (dtId ? layDoiTuong(c.db, dtId)?.ten : undefined) ??
            tuyChonChuoi(payload.doi_tuong);
          const khoa = {
            thong_diep_id: thongDiepId,
            dinh_dang: dinhDang,
            ngon_ngu: ngonNgu,
            doi_tuong: tenHienThi,
            dich_den: dichDen,
          };
          // Bản thể hiện định danh bằng bộ khóa (thông điệp, định dạng, ngôn
          // ngữ, đối tượng, đích đến) — trùng bộ khóa thì dùng lại bản ghi cũ.
          const bth = timBanTheHien(c.db, khoa) ?? taoBanTheHien(c.db, khoa, c.actor);
          if (revisionId && revisionId !== (bth.head_revision_id ?? null)) {
            throw new LoiApi(409, "XUNG_DOT_REVISION", "Bản thể hiện đã có revision mới hơn. Tải lại rồi thử lại.", {
              head_revision_id: bth.head_revision_id,
            });
          }
          revisionId = bth.head_revision_id ?? null;
          bthId = bth.id;
          payload.ban_the_hien_id = bth.id;
          payload.dinh_dang = dinhDang;
          payload.ngon_ngu = ngonNgu;
        }
        const { job, da_tao } = enqueueJob(c.db, {
          loai,
          payload,
          khoaIdem: khoaIdem ?? (loai === "sinh_ban_the_hien" ? `sinh_ban_the_hien:${bthId}` : undefined),
          entityLoai: loai === "sinh_ban_the_hien" ? "ban_the_hien" : entityLoai,
          entityId: bthId,
          revisionId,
          chaySomNhat: chaySomNhat,
          muiGio,
          soLanThuToiDa: soLanThuToiDa,
          timeoutMs: timeoutMs,
        });
        // Fan-out: mỗi biến thể = bản thể hiện + job riêng trong cùng
        // transaction request — không có fan-out lồng nhau.
        const dsJobFanOut: unknown[] = [];
        if (loai === "sinh_ban_the_hien") {
          for (const bienThe of dsFanOut) {
            const ddBt = tuyChonChuoi(bienThe.dinh_dang) || dinhDang;
            const nnBt = tuyChonChuoi(bienThe.ngon_ngu) || ngonNgu;
            const defBt = layDinhDang(ddBt);
            const loiNgBt = defBt ? kiemTraNgonNgu(defBt, nnBt) : `payload.fan_out[].dinh_dang '${ddBt}' không hợp lệ.`;
            if (loiNgBt) throw new LoiApi(400, "VALIDATION", loiNgBt);
            // Validate như main path: id đối tượng phải tồn tại, không để id
            // rác lọt vào payload job → job fail vĩnh viễn sau khi đã tạo bth.
            const dtBtId0 = tuyChonChuoi(bienThe.doi_tuong_id);
            if (dtBtId0 && !layDoiTuong(c.db, dtBtId0)) {
              throw new LoiApi(400, "VALIDATION", `payload.fan_out[].doi_tuong_id '${dtBtId0}' không tồn tại.`);
            }
            const dtBtId = dtBtId0 || tuyChonChuoi(payload.doi_tuong_id);
            const tenDtBt =
              (dtBtId ? layDoiTuong(c.db, dtBtId)?.ten : undefined) ??
              tuyChonChuoi(bienThe.doi_tuong) ??
              tuyChonChuoi(payload.doi_tuong);
            const dichDenBt = tuyChonChuoi(bienThe.dich_den) || dichDen;
            if (dichDenBt.length > 120) {
              throw new LoiApi(400, "VALIDATION", "payload.fan_out[].dich_den quá dài (tối đa 120 ký tự).");
            }
            const khoaBt = {
              thong_diep_id: thongDiepId,
              dinh_dang: ddBt,
              ngon_ngu: nnBt,
              doi_tuong: tenDtBt,
              dich_den: dichDenBt,
            };
            const bthBt = timBanTheHien(c.db, khoaBt) ?? taoBanTheHien(c.db, khoaBt, c.actor);
            const { fan_out: _bo, ...payloadCha } = payload;
            const payloadBt = {
              ...payloadCha,
              ...bienThe,
              ban_the_hien_id: bthBt.id,
              thong_diep_id: thongDiepId,
              dinh_dang: ddBt,
              ngon_ngu: nnBt,
            };
            const { job: jobBt, da_tao: taoBt } = enqueueJob(c.db, {
              loai,
              payload: payloadBt,
              khoaIdem: `sinh_ban_the_hien:${bthBt.id}`,
              entityLoai: "ban_the_hien",
              entityId: bthBt.id,
              revisionId: bthBt.head_revision_id ?? null,
              chaySomNhat,
              muiGio,
              soLanThuToiDa,
              timeoutMs,
            });
            dsJobFanOut.push({ ...jobBt, da_tao: taoBt, ban_the_hien_id: bthBt.id });
          }
        }
        c.db.exec("COMMIT");
        return ok({ ...job, da_tao, ds_job_fan_out: dsJobFanOut }, da_tao ? 201 : 200);
      } catch (e) {
        c.db.exec("ROLLBACK");
        throw e;
      }
    }),
    route("GET", "/api/job/:id", (_req, p, c) => {
      const job = layJob(c.db, p.id!);
      if (!job) loiRequest(404, "KHONG_TIM_THAY", "Không tìm thấy job.");
      return ok({ ...job, nhat_ky: nhatKyJob(c.db, job.id) });
    }),
    route("POST", "/api/job/:id/huy", (_req, p, c) => ok(huyJob(c.db, p.id!))),
    route("POST", "/api/job/:id/thu-lai", (_req, p, c) => ok(thuLaiJob(c.db, p.id!))),

    // --- Asset (#17): metadata trong DB, byte trên đĩa local ---
    // Upload: body = byte thô + query ten/nguon_id/ghi_chu/khoa_idem.
    // File .txt/.md còn được nạp thành nguồn (tạo mới hoặc revision mới khi
    // gửi nguon_id) và asset được liên kết nguồn đó.
    route("POST", "/api/assets", async (req, _p, c) => {
      const url = new URL(req.url);
      const ten = sachTenFile(url.searchParams.get("ten") ?? "asset");
      kiemTraGioiHanBody(req);
      const buf = new Uint8Array(await req.arrayBuffer());
      kiemTraByteDaDoc(buf.byteLength);
      // Validate TRƯỚC mọi mutation: file hỏng (đuôi lạ/rỗng/quá lớn/không
      // UTF-8) không được để lại nguồn/revision rỗng.
      const dinhNghia = kiemTraByteAsset(ten, buf);
      let nguonId = url.searchParams.get("nguon_id") || null;
      const ghiChu = url.searchParams.get("ghi_chu") ?? "";
      const khoaIdem = url.searchParams.get("khoa_idem") || undefined;

      // Retry/đăng lại cùng byte: đã có asset → không ghi lại byte. Với
      // văn bản nhắm nguồn rõ vẫn chạy capNhatVanBan (tự no-op khi head đã
      // trùng nội dung file) để re-upload đưa head về nội dung file kể cả
      // sau khi sửa tay. Không nguon_id = retry thuần → trả nguồn đã gắn.
      const tonTai = timAssetTheoChecksum(c.db, buf);
      if (tonTai) {
        let nguon: unknown = null;
        let revision: unknown = null;
        if (dinhNghia.loai === "van_ban" && nguonId) {
          const noiDung = new TextDecoder("utf-8").decode(buf);
          const kq = capNhatVanBan(
            c.db,
            nguonId,
            { noi_dung: noiDung, khoa_idem: khoaIdem ? `asset:${khoaIdem}` : undefined },
            c.actor,
          );
          nguon = kq.nguon;
          revision = kq.revision;
        } else {
          const nguonCu = tonTai.nguon_id ? layNguon(c.db, tonTai.nguon_id) : null;
          nguon = nguonCu;
          revision = nguonCu?.head_revision_id
            ? layNguonRevision(c.db, nguonCu.head_revision_id)
            : null;
        }
        const { asset } = await luuAsset(
          c.db,
          kho,
          { tenFile: ten, byte: buf, nguonId, ghiChu, khoaIdem },
          c.actor,
        );
        return ok({ ...asset, nguon, revision, da_tao: false }, 200);
      }

      // Văn bản: nạp vào nguồn trước để asset ghi đúng liên kết. Dedupe
      // khoa_idem nằm trong napVanBan/capNhatVanBan — khóa revision prefix
      // 'asset:' để không đụng khóa của /api/nguon/nhap.
      let nguon: unknown = null;
      let revision: unknown = null;
      if (dinhNghia.loai === "van_ban") {
        const noiDung = new TextDecoder("utf-8").decode(buf);
        const kq = nguonId
          ? capNhatVanBan(
              c.db,
              nguonId,
              { noi_dung: noiDung, khoa_idem: khoaIdem ? `asset:${khoaIdem}` : undefined },
              c.actor,
            )
          : napVanBan(
              c.db,
              {
                tieu_de: url.searchParams.get("tieu_de") || ten,
                noi_dung: noiDung,
                khoa_idem: khoaIdem ? `asset:${khoaIdem}` : undefined,
              },
              c.actor,
            );
        nguon = kq.nguon;
        revision = kq.revision;
        nguonId = kq.nguon.id;
      }
      const { asset, da_tao } = await luuAsset(
        c.db,
        kho,
        { tenFile: ten, byte: buf, nguonId, ghiChu, khoaIdem },
        c.actor,
      );
      return ok({ ...asset, nguon, revision, da_tao }, da_tao ? 201 : 200);
    }),
    route("GET", "/api/assets", (req, _p, c) => {
      const url = new URL(req.url);
      const trangThai = url.searchParams.get("trang_thai");
      return ok(
        danhSachAsset(c.db, {
          nguonId: url.searchParams.get("nguon_id") ?? undefined,
          // Mặc định chỉ asset hoạt động; ?trang_thai=tat_ca xem cả lưu trữ.
          trangThai: trangThai === "tat_ca" ? undefined : (trangThai ?? "hoat_dong"),
        }),
      );
    }),
    route("GET", "/api/assets/:id", (_req, p, c) => {
      const asset = layAsset(c.db, p.id!);
      if (!asset) loiRequest(404, "KHONG_TIM_THAY", "Không tìm thấy asset.");
      return ok(asset);
    }),
    // Serve byte an toàn: text/MD trả text/plain (không render HTML/script),
    // ảnh trả đúng mime; nosniff + tên file sạch trong disposition.
    route("GET", "/api/assets/:id/noi-dung", async (_req, p, c) => {
      const asset = layAsset(c.db, p.id!);
      if (!asset) loiRequest(404, "KHONG_TIM_THAY", "Không tìm thấy asset.");
      const byte = await kho.doc(asset.duong_dan);
      if (!byte) loiRequest(404, "KHONG_TIM_THAY", "File asset không còn trên đĩa.");
      const mime = asset.loai === "van_ban" ? "text/plain" : asset.mime;
      const tenAnToan = asset.ten_file.replace(/["\\]/g, "_");
      return new Response(byte, {
        headers: {
          "content-type": `${mime}; charset=utf-8`,
          "x-content-type-options": "nosniff",
          "content-disposition": `inline; filename="${tenAnToan}"; filename*=UTF-8''${encodeURIComponent(asset.ten_file)}`,
        },
      });
    }),
    // Xóa chỉ khi không còn tham chiếu; còn tham chiếu → 409, dùng lưu trữ.
    route("DELETE", "/api/assets/:id", async (_req, p, c) => {
      await xoaAsset(c.db, kho, p.id!, c.actor);
      return ok({ da_xoa: true });
    }),
    route("POST", "/api/assets/:id/luu-tru", (_req, p, c) => ok(luuTruAsset(c.db, p.id!, c.actor))),

    // --- Danh mục dùng chung cho UI ---
    // Registry định dạng đầy đủ: id + phiên bản + schema trường (#19).
    route("GET", "/api/dinh-dang", () => ok(danhSachDinhDang())),
    route("GET", "/api/dinh-dang/:id", (_req, p) => {
      const def = layDinhDang(p.id!);
      if (!def) loiRequest(404, "KHONG_TIM_THAY", "Không tìm thấy định dạng.");
      return ok(def);
    }),
  ];

  return async (req) => {
    const url = new URL(req.url);
    for (const r of routes) {
      if (r.method !== req.method) continue;
      const m = r.pattern.exec(url.pathname);
      if (!m) continue;
      try {
        const thamSo = Object.fromEntries(
          r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1]!)]),
        );
        return await r.handler(req, thamSo, ctx);
      } catch (e) {
        if (e instanceof URIError) {
          return loi(new LoiApi(400, "VALIDATION", "Tham số URL không hợp lệ."));
        }
        if (!(e instanceof LoiApi)) {
          log.error("api.loi", { path: url.pathname, loi: String(e) });
        }
        return loi(e);
      }
    }
    return loi(new LoiApi(404, "KHONG_TIM_THAY", "Endpoint không tồn tại."));
  };
}
