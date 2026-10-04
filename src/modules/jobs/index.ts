import { createHash } from "node:crypto";
import type { Database } from "bun:sqlite";
import { LoiApi, loiRequest } from "../../loi.ts";
import { log } from "../../log.ts";

// Module job: hàng đợi bền trên SQLite, runner chạy trong cùng process.
// Không worker riêng, không Redis, không broker — xem ADR-0001.
//
// Ngữ nghĩa chính:
// - Trạng thái: 'cho' → 'dang_chay' → 'xong' | 'loi' | 'huy'.
// - Attempt ÍT-NHẤT-MỘT-LẦN: crash giữa attempt → job chạy lại khi lease hết hạn.
//   Handler phải tự idempotent (kiểm lại entity/revision đích trước khi commit).
//   Idempotency hiệu ứng từ xa (gửi mail, publish…) thuộc handler/provider.
// - khoa_idem ổn định: cùng khóa → đúng một job logic. Job còn sống
//   ('cho'/'dang_chay') → dedupe, trả dòng cũ. Job đã kết thúc
//   ('xong'/'loi'/'huy') → reset về 'cho' và chạy lại cùng dòng đó.
// - Attempt chạy dưới timeout + lease; lỗi tạm retry với backoff có biên;
//   lỗi vĩnh viễn (LoiVinhVien) hoặc hết lượt → 'loi', inspect/retry được.

export type TrangThaiJob = "cho" | "dang_chay" | "xong" | "loi" | "huy";

export type Job = {
  id: string;
  loai: string;
  trang_thai: TrangThaiJob;
  khoa_idem: string;
  entity_loai: string;
  entity_id: string;
  revision_id: string | null;
  payload: string;
  ket_qua: string | null;
  loi: string | null;
  loi_vinh_vien: number;
  so_lan_thu: number;
  so_lan_thu_toi_da: number;
  timeout_ms: number;
  chay_som_nhat: string | null;
  mui_gio: string;
  tien_do: string;
  lease_token: string | null;
  lease_den: string | null;
  tao_luc: string;
  chay_luc: string | null;
  xong_luc: string | null;
};

export type JobLog = {
  id: number;
  job_id: string;
  ts: string;
  su_kien: string;
  du_lieu: string;
};

// Context handler nhận mỗi attempt. Đây là interface cho #20 và #13:
// đăng ký handler mới trong handlers.ts theo đúng chữ ký này.
export type JobCtx = {
  db: Database;
  job: Job; // snapshot lúc claim: entity_loai/entity_id/revision_id, so_lan_thu…
  lanThu: number;
  // Ghi tiến độ (JSON) vào dòng job — inspect/UI đọc được. Không ném lỗi.
  baoTienDo: (tienDo: Record<string, unknown>) => void;
};

export type JobHandler = (
  payload: Record<string, unknown>,
  ctx: JobCtx,
) => Promise<Record<string, unknown>>;

// Lỗi vĩnh viễn: runner fail ngay, không retry (vd revision đích đã đổi,
// entity không còn, payload sai). Mọi lỗi khác = tạm thời → retry có backoff.
export class LoiVinhVien extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LoiVinhVien";
  }
}

class LoiTimeout extends Error {
  constructor() {
    super("Job vượt timeout_ms.");
    this.name = "LoiTimeout";
  }
}

const bayGio = () => new Date().toISOString();

const MAC_DINH_SO_LAN_THU = 3;
const MAC_DINH_TIMEOUT_MS = 120_000;
const MAC_DINH_BACKOFF_CO_SO_MS = 250;
const MAC_DINH_BACKOFF_TOI_DA_MS = 30_000;
// Lease = timeout + đệm: attempt bị treo vẫn bị thu hồi sau hạn này.
const DEM_LEASE_MS = 5_000;

export type TuyChonEnqueue = {
  loai: string;
  payload?: Record<string, unknown>;
  khoaIdem?: string;
  entityLoai?: string;
  entityId?: string;
  revisionId?: string | null;
  chaySomNhat?: string | null; // ISO; null/undefined → chạy ngay
  muiGio?: string;
  soLanThuToiDa?: number;
  timeoutMs?: number;
};

// Khóa idempotency mặc định: hash ổn định của loại + entity + payload.
export function khoaIdemMacDinh(t: TuyChonEnqueue): string {
  const goc = JSON.stringify({
    loai: t.loai,
    entity: `${t.entityLoai ?? ""}:${t.entityId ?? ""}`,
    payload: t.payload ?? {},
  });
  return `${t.loai}:${createHash("sha256").update(goc).digest("hex").slice(0, 32)}`;
}

function ghiNhatKy(db: Database, jobId: string, suKien: string, duLieu: unknown = {}): void {
  db.query("INSERT INTO job_log (job_id, ts, su_kien, du_lieu) VALUES (?, ?, ?, ?)").run(
    jobId,
    bayGio(),
    suKien,
    JSON.stringify(duLieu ?? {}),
  );
}

// Enqueue nguyên tử theo khoa_idem: INSERT OR IGNORE rồi đọc lại.
// - Job cùng khóa đang 'cho'/'dang_chay' → dedupe: da_tao=false, trả dòng cũ.
// - Job cùng khóa đã kết thúc ('xong'/'loi'/'huy') → reset về 'cho' với tham
//   số mới và chạy lại đúng một job logic (khoa_idem unique → không tạo dòng
//   thứ hai). Hủy/kết thúc một job KHÔNG khóa vĩnh viễn việc enqueue lại.
// Hàm không mở transaction — caller bọc BEGIN/COMMIT khi cần ghi request state
// cùng lúc (vd tạo bản thể hiện + enqueue trong một giao dịch).
export function enqueueJob(db: Database, t: TuyChonEnqueue): { job: Job; da_tao: boolean } {
  const khoa = t.khoaIdem?.trim() || khoaIdemMacDinh(t);
  const id = crypto.randomUUID();
  db.query(
    `INSERT OR IGNORE INTO job
       (id, loai, trang_thai, khoa_idem, entity_loai, entity_id, revision_id,
        payload, so_lan_thu_toi_da, timeout_ms, chay_som_nhat, mui_gio, tao_luc)
     VALUES (?, ?, 'cho', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    t.loai,
    khoa,
    t.entityLoai ?? "",
    t.entityId ?? "",
    t.revisionId ?? null,
    JSON.stringify(t.payload ?? {}),
    t.soLanThuToiDa ?? MAC_DINH_SO_LAN_THU,
    t.timeoutMs ?? MAC_DINH_TIMEOUT_MS,
    t.chaySomNhat ?? null,
    t.muiGio ?? "",
    bayGio(),
  );
  const job = db.query("SELECT * FROM job WHERE khoa_idem = ?").get(khoa) as Job;
  if (job.id === id) {
    ghiNhatKy(db, job.id, "enqueue", { khoa_idem: khoa, chay_som_nhat: job.chay_som_nhat });
    log.info("job.enqueue", { id: job.id, loai: job.loai, khoa_idem: khoa });
    return { job, da_tao: true };
  }
  if (job.trang_thai === "cho" || job.trang_thai === "dang_chay") {
    return { job, da_tao: false };
  }
  // Job đã kết thúc: reset về 'cho' — cùng một job logic chạy lần mới.
  const r = db
    .query(
      `UPDATE job SET trang_thai = 'cho', so_lan_thu = 0,
         loi = NULL, loi_vinh_vien = 0, ket_qua = NULL, tien_do = '{}',
         loai = ?, entity_loai = ?, entity_id = ?, revision_id = ?, payload = ?,
         so_lan_thu_toi_da = ?, timeout_ms = ?, chay_som_nhat = ?, mui_gio = ?,
         chay_luc = NULL, xong_luc = NULL, lease_token = NULL, lease_den = NULL
       WHERE id = ? AND trang_thai IN ('xong', 'loi', 'huy')`,
    )
    .run(
      t.loai,
      t.entityLoai ?? "",
      t.entityId ?? "",
      t.revisionId ?? null,
      JSON.stringify(t.payload ?? {}),
      t.soLanThuToiDa ?? MAC_DINH_SO_LAN_THU,
      t.timeoutMs ?? MAC_DINH_TIMEOUT_MS,
      t.chaySomNhat ?? null,
      t.muiGio ?? "",
      job.id,
    );
  if (r.changes === 0) {
    // Vừa bị claim/thay đổi giữa chừng → coi như dedupe.
    return { job: layJob(db, job.id)!, da_tao: false };
  }
  ghiNhatKy(db, job.id, "enqueue_lai", { tu_trang_thai: job.trang_thai, khoa_idem: khoa });
  log.info("job.enqueue_lai", { id: job.id, loai: t.loai, khoa_idem: khoa });
  return { job: layJob(db, job.id)!, da_tao: true };
}

export function layJob(db: Database, id: string): Job | null {
  return (db.query("SELECT * FROM job WHERE id = ?").get(id) as Job | null) ?? null;
}

export function danhSachJob(db: Database, trangThai?: string, gioiHan = 50): Job[] {
  if (trangThai) {
    return db
      .query("SELECT * FROM job WHERE trang_thai = ? ORDER BY tao_luc DESC LIMIT ?")
      .all(trangThai, gioiHan) as Job[];
  }
  return db.query("SELECT * FROM job ORDER BY tao_luc DESC LIMIT ?").all(gioiHan) as Job[];
}

export function nhatKyJob(db: Database, jobId: string, gioiHan = 200): JobLog[] {
  return db
    .query("SELECT * FROM job_log WHERE job_id = ? ORDER BY id DESC LIMIT ?")
    .all(jobId, gioiHan) as JobLog[];
}

// Hủy job 'cho' (chặn thực thi đang xếp) hoặc 'dang_chay' (đánh dấu hủy; commit
// của attempt đang chạy bị guard từ chối → kết quả đã hủy không thành active).
export function huyJob(db: Database, id: string): Job {
  const r = db
    .query(
      `UPDATE job SET trang_thai = 'huy', xong_luc = ?, lease_token = NULL, lease_den = NULL
       WHERE id = ? AND trang_thai IN ('cho', 'dang_chay')`,
    )
    .run(bayGio(), id);
  const job = layJob(db, id);
  if (!job) loiRequest(404, "KHONG_TIM_THAY", "Không tìm thấy job.");
  if (r.changes === 0) {
    throw new LoiApi(409, "XUNG_DOT_JOB", `Không thể hủy job ở trạng thái '${job.trang_thai}'.`);
  }
  ghiNhatKy(db, id, "huy", {});
  log.info("job.huy", { id, loai: job.loai });
  return layJob(db, id)!;
}

// Retry thủ công cho job 'loi': reset attempt, ghim lại revision đích hiện tại
// khi entity là bản thể hiện (head có thể đã đổi kể từ lần chạy trước).
export function thuLaiJob(db: Database, id: string): Job {
  const job = layJob(db, id);
  if (!job) loiRequest(404, "KHONG_TIM_THAY", "Không tìm thấy job.");
  if (job.trang_thai !== "loi") {
    throw new LoiApi(409, "XUNG_DOT_JOB", `Chỉ retry được job 'loi' (hiện '${job.trang_thai}').`);
  }
  let revisionId = job.revision_id;
  if (job.entity_loai === "ban_the_hien" && job.entity_id) {
    const head = db
      .query("SELECT head_revision_id AS h FROM ban_the_hien WHERE id = ?")
      .get(job.entity_id) as { h: string | null } | null;
    if (head) revisionId = head.h;
  }
  db.query(
    `UPDATE job SET trang_thai = 'cho', so_lan_thu = 0, loi = NULL, loi_vinh_vien = 0,
       ket_qua = NULL, tien_do = '{}', chay_som_nhat = NULL, chay_luc = NULL, xong_luc = NULL,
       lease_token = NULL, lease_den = NULL, revision_id = ?
     WHERE id = ? AND trang_thai = 'loi'`,
  ).run(revisionId, id);
  ghiNhatKy(db, id, "thu_lai", { revision_id: revisionId });
  log.info("job.thu_lai", { id, loai: job.loai });
  return layJob(db, id)!;
}

// --- Runner ---

export type TuyChonRunner = {
  chuKyMs?: number; // chu kỳ poll, mặc định 500
  concurrency?: number; // số attempt chạy song song, mặc định 2
  backoffCoSoMs?: number; // backoff = coSo * 2^(attempt-1), mặc định 250ms
  backoffToiDaMs?: number; // trần backoff, mặc định 30s
};

function backoffMs(lanThu: number, coSo: number, toiDa: number): number {
  return Math.min(coSo * 2 ** Math.max(0, lanThu - 1), toiDa);
}

// Thu hồi attempt 'dang_chay' hết lease (hoặc lease NULL — job cũ/crash trước khi
// ghi lease): còn lượt → requeue với backoff; hết lượt → 'loi'.
function thuHoiLease(
  db: Database,
  coSo: number,
  toiDa: number,
): void {
  const now = bayGio();
  const hetHan = db
    .query(
      `SELECT * FROM job WHERE trang_thai = 'dang_chay'
         AND (lease_den IS NULL OR lease_den < ?)`,
    )
    .all(now) as Job[];
  for (const j of hetHan) {
    if (j.so_lan_thu >= j.so_lan_thu_toi_da) {
      db.query(
        `UPDATE job SET trang_thai = 'loi', loi = ?, loi_vinh_vien = 0, xong_luc = ?,
           lease_token = NULL, lease_den = NULL
         WHERE id = ? AND trang_thai = 'dang_chay'`,
      ).run("Job hết lease quá số lần thử tối đa.", now, j.id);
      ghiNhatKy(db, j.id, "loi", { ly_do: "het_lease_het_luot", lan_thu: j.so_lan_thu });
      log.warn("job.het_lease_het_luot", { id: j.id, loai: j.loai, lan_thu: j.so_lan_thu });
    } else {
      const somNhat = new Date(Date.now() + backoffMs(j.so_lan_thu, coSo, toiDa)).toISOString();
      db.query(
        `UPDATE job SET trang_thai = 'cho', chay_som_nhat = ?, lease_token = NULL, lease_den = NULL
         WHERE id = ? AND trang_thai = 'dang_chay'`,
      ).run(somNhat, j.id);
      ghiNhatKy(db, j.id, "thu_hoi_lease", { lan_thu: j.so_lan_thu, chay_som_nhat: somNhat });
      log.warn("job.thu_hoi_lease", { id: j.id, loai: j.loai, lan_thu: j.so_lan_thu });
    }
  }
}

// Claim một job 'cho' đã tới hạn: UPDATE có guard trạng thái → không claim trùng.
function claimMotJob(db: Database): Job | null {
  const now = bayGio();
  const hang = db
    .query(
      `SELECT id FROM job WHERE trang_thai = 'cho'
         AND (chay_som_nhat IS NULL OR chay_som_nhat <= ?)
       ORDER BY tao_luc LIMIT 1`,
    )
    .get(now) as { id: string } | null;
  if (!hang) return null;
  const token = crypto.randomUUID();
  const job0 = layJob(db, hang.id)!;
  const leaseDen = new Date(Date.now() + job0.timeout_ms + DEM_LEASE_MS).toISOString();
  const r = db
    .query(
      `UPDATE job SET trang_thai = 'dang_chay', so_lan_thu = so_lan_thu + 1,
         chay_luc = ?, lease_token = ?, lease_den = ?
       WHERE id = ? AND trang_thai = 'cho'`,
    )
    .run(now, token, leaseDen, hang.id);
  if (r.changes === 0) return null;
  return layJob(db, hang.id);
}

// Commit kết quả attempt có guard (id + 'dang_chay' + lease_token): job đã bị
// hủy/thu hồi giữa chừng → 0 dòng → kết quả đã hủy không thành active.
function commitKetQua(db: Database, job: Job, ketQua: string): void {
  const r = db
    .query(
      `UPDATE job SET trang_thai = 'xong', ket_qua = ?, tien_do = '{}', xong_luc = ?,
         lease_token = NULL, lease_den = NULL
       WHERE id = ? AND trang_thai = 'dang_chay' AND lease_token = ?`,
    )
    .run(ketQua, bayGio(), job.id, job.lease_token);
  if (r.changes === 0) {
    ghiNhatKy(db, job.id, "ket_qua_bo_qua", { ly_do: "job_doi_trang_thai_giua_attempt" });
    log.warn("job.ket_qua_bo_qua", { id: job.id, loai: job.loai });
  } else {
    ghiNhatKy(db, job.id, "xong", { lan_thu: job.so_lan_thu });
    log.info("job.xong", { id: job.id, loai: job.loai, lan_thu: job.so_lan_thu });
  }
}

function commitThatBai(
  db: Database,
  job: Job,
  e: unknown,
  coSo: number,
  toiDa: number,
): void {
  const thongDiep = e instanceof Error ? e.message : String(e);
  const vinhVien = e instanceof LoiVinhVien;
  const hetLuot = job.so_lan_thu >= job.so_lan_thu_toi_da;
  const guard = `id = ? AND trang_thai = 'dang_chay' AND lease_token = ?`;
  if (vinhVien || hetLuot) {
    const r = db
      .query(
        `UPDATE job SET trang_thai = 'loi', loi = ?, loi_vinh_vien = ?, xong_luc = ?,
           lease_token = NULL, lease_den = NULL WHERE ${guard}`,
      )
      .run(thongDiep, vinhVien ? 1 : 0, bayGio(), job.id, job.lease_token);
    if (r.changes === 0) {
      ghiNhatKy(db, job.id, "ket_qua_bo_qua", { ly_do: "job_doi_trang_thai_giua_attempt" });
      return;
    }
    ghiNhatKy(db, job.id, "loi", { lan_thu: job.so_lan_thu, vinh_vien: vinhVien, loi: thongDiep });
    log.warn("job.loi", { id: job.id, loai: job.loai, lan_thu: job.so_lan_thu, vinh_vien: vinhVien, loi: thongDiep });
    return;
  }
  const doiMs = backoffMs(job.so_lan_thu, coSo, toiDa);
  const somNhat = new Date(Date.now() + doiMs).toISOString();
  const r = db
    .query(
      `UPDATE job SET trang_thai = 'cho', loi = ?, chay_som_nhat = ?,
         lease_token = NULL, lease_den = NULL WHERE ${guard}`,
    )
    .run(thongDiep, somNhat, job.id, job.lease_token);
  if (r.changes === 0) {
    ghiNhatKy(db, job.id, "ket_qua_bo_qua", { ly_do: "job_doi_trang_thai_giua_attempt" });
    return;
  }
  ghiNhatKy(db, job.id, "that_bai_se_thu_lai", { lan_thu: job.so_lan_thu, doi_ms: doiMs, loi: thongDiep });
  log.warn("job.thu_lai_sau", { id: job.id, loai: job.loai, lan_thu: job.so_lan_thu, doi_ms: doiMs, loi: thongDiep });
}

function capNhatTienDo(db: Database, job: Job, tienDo: Record<string, unknown>): void {
  try {
    const json = JSON.stringify(tienDo);
    db.query(
      `UPDATE job SET tien_do = ? WHERE id = ? AND trang_thai = 'dang_chay' AND lease_token = ?`,
    ).run(json, job.id, job.lease_token);
    ghiNhatKy(db, job.id, "tien_do", tienDo);
  } catch {
    // Tiến độ là best-effort: không làm hỏng attempt vì lỗi ghi phụ.
  }
}

async function chayAttempt(
  db: Database,
  handlers: Record<string, JobHandler>,
  job: Job,
  coSo: number,
  toiDa: number,
): Promise<void> {
  ghiNhatKy(db, job.id, "bat_dau", { lan_thu: job.so_lan_thu, lease_den: job.lease_den });
  log.info("job.bat_dau", { id: job.id, loai: job.loai, lan_thu: job.so_lan_thu });
  const ctx: JobCtx = {
    db,
    job,
    lanThu: job.so_lan_thu,
    baoTienDo: (t) => capNhatTienDo(db, job, t),
  };
  try {
    const handler = handlers[job.loai];
    if (!handler) throw new LoiVinhVien(`Không có handler cho loại job: ${job.loai}`);
    const payload = JSON.parse(job.payload) as Record<string, unknown>;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const ketQua = await Promise.race([
      Promise.resolve().then(() => handler(payload, ctx)),
      new Promise<never>((_res, rej) => {
        timer = setTimeout(() => rej(new LoiTimeout()), job.timeout_ms);
        timer.unref?.();
      }),
    ]).finally(() => clearTimeout(timer));
    commitKetQua(db, job, JSON.stringify(ketQua ?? {}));
  } catch (e) {
    commitThatBai(db, job, e, coSo, toiDa);
  }
}

// Khởi động runner trong process; trả về hàm dừng (chờ attempt in-flight xong).
// Recovery chạy mỗi tick: attempt mất chủ (restart giữa job) tự quay lại 'cho'
// khi lease hết hạn — không mất job, không kích hoạt kết quả trùng vì commit có guard.
export function khoiDongRunner(
  db: Database,
  handlers: Record<string, JobHandler>,
  tuyChon: TuyChonRunner = {},
): () => Promise<void> {
  const chuKyMs = tuyChon.chuKyMs ?? 500;
  const concurrency = Math.max(1, tuyChon.concurrency ?? 2);
  const coSo = tuyChon.backoffCoSoMs ?? MAC_DINH_BACKOFF_CO_SO_MS;
  const toiDa = tuyChon.backoffToiDaMs ?? MAC_DINH_BACKOFF_TOI_DA_MS;

  thuHoiLease(db, coSo, toiDa);

  const inFlight = new Set<Promise<void>>();
  const timer = setInterval(() => {
    try {
      thuHoiLease(db, coSo, toiDa);
      while (inFlight.size < concurrency) {
        const job = claimMotJob(db);
        if (!job) break;
        const p = chayAttempt(db, handlers, job, coSo, toiDa).finally(() => inFlight.delete(p));
        inFlight.add(p);
      }
    } catch (e) {
      log.error("job.loi_runner", { loi: String(e) });
    }
  }, chuKyMs);
  timer.unref?.();
  log.info("job.runner_bat_dau", { chuKyMs, concurrency });

  return async () => {
    clearInterval(timer);
    await Promise.allSettled([...inFlight]);
  };
}
