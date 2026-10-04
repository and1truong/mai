import type { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { LoiApi, batBuocChuoi, loiRequest, nemLoiValidation, tuyChonChuoi } from "../loi.ts";
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
import { capNhatContext, layContext } from "../modules/context/index.ts";
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
        job_cho: (
          c.db.query("SELECT COUNT(*) AS c FROM job WHERE trang_thai = 'cho'").get() as {
            c: number;
          }
        ).c,
      }),
    ),

    // --- Context ---
    route("GET", "/api/context", (_req, _p, c) => ok(layContext(c.db))),
    route("PUT", "/api/context", async (req, _p, c) => {
      const body = await docBody(req);
      const dsLoi: string[] = [];
      const ten = batBuocChuoi(body.ten, "ten", dsLoi);
      nemLoiValidation(dsLoi);
      return ok(
        capNhatContext(
          c.db,
          {
            ten,
            doi_tuong: tuyChonChuoi(body.doi_tuong),
            giong_noi: tuyChonChuoi(body.giong_noi),
            gia_tri: tuyChonChuoi(body.gia_tri),
          },
          c.actor,
        ),
      );
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
      return ok({ ...bth, revisions: danhSachRevision(c.db, bth.id) });
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
