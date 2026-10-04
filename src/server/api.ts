import type { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { basename, extname, join } from "node:path";
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
  danhSachBanTheHien,
  danhSachNguon,
  danhSachRevision,
  layBanTheHien,
  layNguon,
  capNhatTrangThai,
  taoBanTheHien,
  taoNguon,
  themRevision,
  type BanTheHien,
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
  type GhiDeCampaign,
  type NguonDuLieu,
  type NhapThuatNgu,
} from "../modules/context/index.ts";
import { DANH_SACH_DINH_DANG, laDinhDang } from "../modules/formats/index.ts";
import { DANH_SACH_TRANG_THAI, laTrangThai, chuyenHopLe } from "../modules/review/index.ts";
import {
  danhSachJob,
  enqueueJob,
  huyJob,
  layJob,
  nhatKyJob,
  thuLaiJob,
} from "../modules/jobs/index.ts";
import { LOAI_JOB_HO_TRO } from "../modules/jobs/handlers.ts";
import { docBody, kiemTraByteDaDoc, kiemTraGioiHanBody, loi, ok } from "./http.ts";

export type ApiCtx = {
  db: Database;
  dataDir: string;
  actor: string;
  provider: string;
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

const EXT_ASSET_CHO_PHEP = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".txt", ".md", ".pdf"]);

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
  for (const [i, dong] of v.entries()) {
    if (typeof dong !== "object" || dong === null) {
      dsLoi.push(`thuat_ngu[${i}] phải là object.`);
      continue;
    }
    const t = dong as Record<string, unknown>;
    const thuatNgu = typeof t.thuat_ngu === "string" ? t.thuat_ngu.trim() : "";
    if (!thuatNgu) dsLoi.push(`thuat_ngu[${i}].thuat_ngu là bắt buộc.`);
    const giuNguyen = t.giu_nguyen !== false && t.giu_nguyen !== 0;
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

function docGhiDe(v: unknown, dsLoi: string[]): GhiDeCampaign {
  const ghiDe = tuyChonObject(v);
  for (const k of Object.keys(ghiDe)) {
    if (k !== "thuong_hieu" && k !== "doi_tuong") {
      dsLoi.push(`ghi_de.${k} không hỗ trợ. Cho phép: thuong_hieu, doi_tuong.`);
      continue;
    }
    ghiDe[k] = tuyChonObject(ghiDe[k]);
  }
  return ghiDe as GhiDeCampaign;
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

export function taoApi(ctx: ApiCtx): (req: Request) => Promise<Response> {
  const routes: Route[] = [
    route("GET", "/api/health", (_req, _p, c) =>
      ok({ trang_thai: "hoat_dong", provider: c.provider }),
    ),

    route("GET", "/api/tong-quan", (_req, _p, c) =>
      ok({
        nguon: (c.db.query("SELECT COUNT(*) AS c FROM nguon").get() as { c: number }).c,
        ban_the_hien: (c.db.query("SELECT COUNT(*) AS c FROM ban_the_hien").get() as { c: number }).c,
        revision: (c.db.query("SELECT COUNT(*) AS c FROM revision").get() as { c: number }).c,
        ho_so_thuong_hieu: (c.db.query("SELECT COUNT(*) AS c FROM ho_so_thuong_hieu").get() as { c: number }).c,
        ho_so_doi_tuong: (c.db.query("SELECT COUNT(*) AS c FROM ho_so_doi_tuong").get() as { c: number }).c,
        job_cho: (
          c.db.query("SELECT COUNT(*) AS c FROM job WHERE trang_thai = 'cho'").get() as {
            c: number;
          }
        ).c,
      }),
    ),

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
      return ok({ ...cs, snapshot: JSON.parse(cs.snapshot) as unknown });
    }),

    // --- Nguồn ---
    route("GET", "/api/nguon", (_req, _p, c) => ok(danhSachNguon(c.db))),
    route("POST", "/api/nguon", async (req, _p, c) => {
      const body = await docBody(req);
      const dsLoi: string[] = [];
      const tieuDe = batBuocChuoi(body.tieu_de, "tieu_de", dsLoi);
      const noiDung = batBuocChuoi(body.noi_dung, "noi_dung", dsLoi);
      const loai = tuyChonChuoi(body.loai) || "van_ban";
      nemLoiValidation(dsLoi);
      return ok(taoNguon(c.db, { tieu_de: tieuDe, noi_dung: noiDung, loai }, c.actor), 201);
    }),

    // --- Bản thể hiện ---
    route("GET", "/api/ban-the-hien", (req, _p, c) => {
      const url = new URL(req.url);
      const nguonId = url.searchParams.get("nguon_id") ?? undefined;
      return ok(danhSachBanTheHien(c.db, nguonId));
    }),
    route("GET", "/api/ban-the-hien/:id", (_req, p, c) => {
      const bth = layBanTheHien(c.db, p.id!);
      if (!bth) loiRequest(404, "KHONG_TIM_THAY", "Không tìm thấy bản thể hiện.");
      // Mỗi revision kèm context sinh đã dùng (null = nhập tay).
      const revisions = danhSachRevision(c.db, bth.id).map((r) => ({
        ...r,
        context_sinh: r.context_sinh_id ? layContextSinh(c.db, r.context_sinh_id) : null,
      }));
      return ok({ ...bth, revisions });
    }),
    route("POST", "/api/ban-the-hien/:id/revision", async (req, p, c) => {
      const body = await docBody(req);
      const dsLoi: string[] = [];
      const noiDung = batBuocChuoi(body.noi_dung, "noi_dung", dsLoi);
      nemLoiValidation(dsLoi);
      const duaTren = tuyChonChuoi(body.dua_tren_revision_id) || null;
      return ok(
        themRevision(c.db, { ban_the_hien_id: p.id!, noi_dung: noiDung, dua_tren_revision_id: duaTren }, c.actor),
        201,
      );
    }),
    route("POST", "/api/ban-the-hien/:id/trang-thai", async (req, p, c) => {
      const body = await docBody(req);
      const den = body.trang_thai;
      if (!laTrangThai(den)) {
        loiRequest(400, "VALIDATION", "trang_thai không hợp lệ.", [`Cho phép: ${DANH_SACH_TRANG_THAI.join(", ")}`]);
      }
      const bth = layBanTheHien(c.db, p.id!);
      if (!bth) loiRequest(404, "KHONG_TIM_THAY", "Không tìm thấy bản thể hiện.");
      if (!chuyenHopLe(bth.trang_thai, den)) {
        loiRequest(
          409,
          "XUNG_DOT_TRANG_THAI",
          `Không thể chuyển từ '${bth.trang_thai}' sang '${den}'.`,
        );
      }
      return ok(capNhatTrangThai(c.db, bth.id, den));
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

      let nguonId = "";
      let dinhDang = "web";
      if (loai === "sinh_ban_the_hien") {
        nguonId = batBuocChuoi(payload.nguon_id, "payload.nguon_id", dsLoi);
        dinhDang = tuyChonChuoi(payload.dinh_dang) || "web";
        if (!laDinhDang(dinhDang)) {
          dsLoi.push(`payload.dinh_dang không hợp lệ. Cho phép: ${DANH_SACH_DINH_DANG.join(", ")}.`);
        }
        if (nguonId && !layNguon(c.db, nguonId)) {
          dsLoi.push("payload.nguon_id không tồn tại.");
        }
        const thuongHieuId = tuyChonChuoi(payload.thuong_hieu_id);
        if (thuongHieuId && !layThuongHieu(c.db, thuongHieuId)) {
          dsLoi.push("payload.thuong_hieu_id không tồn tại.");
        }
        const doiTuongId = tuyChonChuoi(payload.doi_tuong_id);
        if (doiTuongId && !layDoiTuong(c.db, doiTuongId)) {
          dsLoi.push("payload.doi_tuong_id không tồn tại.");
        }
        if (payload.ghi_de !== undefined && (typeof payload.ghi_de !== "object" || payload.ghi_de === null || Array.isArray(payload.ghi_de))) {
          dsLoi.push("payload.ghi_de phải là object { thuong_hieu?, doi_tuong? }.");
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
          let bth = c.db
            .query("SELECT * FROM ban_the_hien WHERE nguon_id = ? AND dinh_dang = ? LIMIT 1")
            .get(nguonId, dinhDang) as BanTheHien | null;
          if (!bth) {
            bth = taoBanTheHien(
              c.db,
              { nguon_id: nguonId, dinh_dang: dinhDang, doi_tuong: tuyChonChuoi(payload.doi_tuong) },
              c.actor,
            );
          }
          if (revisionId && revisionId !== (bth.head_revision_id ?? null)) {
            throw new LoiApi(409, "XUNG_DOT_REVISION", "Bản thể hiện đã có revision mới hơn. Tải lại rồi thử lại.", {
              head_revision_id: bth.head_revision_id,
            });
          }
          revisionId = bth.head_revision_id ?? null;
          bthId = bth.id;
          payload.ban_the_hien_id = bth.id;
          payload.dinh_dang = dinhDang;
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
        c.db.exec("COMMIT");
        return ok({ ...job, da_tao }, da_tao ? 201 : 200);
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

    // --- Asset upload ---
    route("POST", "/api/assets", async (req, _p, c) => {
      const url = new URL(req.url);
      const ten = basename(url.searchParams.get("ten") ?? "asset");
      const ext = extname(ten).toLowerCase() || ".bin";
      if (!EXT_ASSET_CHO_PHEP.has(ext)) {
        loiRequest(400, "VALIDATION", "Đuôi file không hỗ trợ.", [
          `Cho phép: ${[...EXT_ASSET_CHO_PHEP].join(", ")}`,
        ]);
      }
      kiemTraGioiHanBody(req);
      const buf = await req.arrayBuffer();
      kiemTraByteDaDoc(buf.byteLength);
      if (buf.byteLength === 0) loiRequest(400, "VALIDATION", "Body rỗng.");
      const file = `${crypto.randomUUID()}${ext}`;
      await Bun.write(join(c.dataDir, "assets", file), buf);
      log.info("asset.luu", { file, bytes: buf.byteLength });
      return ok({ file }, 201);
    }),
    route("GET", "/api/assets/:ten", (_req, p, c) => {
      const ten = basename(p.ten!);
      const tep = join(c.dataDir, "assets", ten);
      if (basename(tep) !== ten || !existsSync(tep)) {
        loiRequest(404, "KHONG_TIM_THAY", "Không tìm thấy asset.");
      }
      return new Response(Bun.file(tep));
    }),

    // --- Danh mục dùng chung cho UI ---
    route("GET", "/api/dinh-dang", () => ok(DANH_SACH_DINH_DANG)),
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
