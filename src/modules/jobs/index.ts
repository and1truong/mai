import type { Database } from "bun:sqlite";
import { log } from "../../log.ts";

// Module job: job nền chạy trong cùng process (không worker riêng, không Redis).
// Job là một dòng trong bảng `job`; runner poll định kỳ và gọi handler theo `loai`.

export type Job = {
  id: string;
  loai: string;
  trang_thai: "cho" | "dang_chay" | "xong" | "loi";
  payload: string;
  ket_qua: string | null;
  loi: string | null;
  tao_luc: string;
  chay_luc: string | null;
  xong_luc: string | null;
};

export type JobHandler = (payload: Record<string, unknown>) => Promise<Record<string, unknown>>;

const bayGio = () => new Date().toISOString();

export function taoJob(db: Database, loai: string, payload: Record<string, unknown>): Job {
  const id = crypto.randomUUID();
  db.query("INSERT INTO job (id, loai, trang_thai, payload, tao_luc) VALUES (?, ?, 'cho', ?, ?)").run(
    id,
    loai,
    JSON.stringify(payload),
    bayGio(),
  );
  return db.query("SELECT * FROM job WHERE id = ?").get(id) as Job;
}

export function danhSachJob(db: Database, gioiHan = 50): Job[] {
  return db.query("SELECT * FROM job ORDER BY tao_luc DESC LIMIT ?").all(gioiHan) as Job[];
}

// Khởi động runner trong process. Trả về hàm dừng runner.
// Requeue job 'dang_chay' mồ côi (server restart giữa chừng) về 'cho'.
export function khoiDongRunner(
  db: Database,
  handlers: Record<string, JobHandler>,
  chuKyMs = 500,
): () => void {
  const moCoi = db
    .query("UPDATE job SET trang_thai = 'cho' WHERE trang_thai = 'dang_chay'")
    .run().changes;
  if (moCoi > 0) log.warn("job.requeue_mo_coi", { so: moCoi });

  let dangChay = false;
  let inFlight: Promise<void> | null = null;
  const timer = setInterval(() => {
    if (dangChay) return;
    dangChay = true;
    const p = chayMotJob(db, handlers);
    inFlight = p;
    void p
      .catch((e) => log.error("job.loi_runner", { loi: String(e) }))
      .finally(() => {
        dangChay = false;
        inFlight = null;
      });
  }, chuKyMs);
  timer.unref?.();
  log.info("job.runner_bat_dau", { chuKyMs });

  // Dừng runner: chờ job in-flight xong hẳn để quanh `--hot` reload job không
  // bị requeue rồi chạy trùng ở process mới.
  return async () => {
    clearInterval(timer);
    if (inFlight) {
      try {
        await inFlight;
      } catch {
        /* lỗi đã log ở trên */
      }
    }
  };
}

async function chayMotJob(db: Database, handlers: Record<string, JobHandler>): Promise<void> {
  const job = db
    .query("SELECT * FROM job WHERE trang_thai = 'cho' ORDER BY tao_luc LIMIT 1")
    .get() as Job | null;
  if (!job) return;
  db.query("UPDATE job SET trang_thai = 'dang_chay', chay_luc = ? WHERE id = ?").run(bayGio(), job.id);
  log.info("job.bat_dau", { id: job.id, loai: job.loai });
  try {
    const handler = handlers[job.loai];
    if (!handler) throw new Error(`Không có handler cho loại job: ${job.loai}`);
    const payload = JSON.parse(job.payload) as Record<string, unknown>;
    const ketQua = await handler(payload);
    db.query("UPDATE job SET trang_thai = 'xong', ket_qua = ?, xong_luc = ? WHERE id = ?").run(
      JSON.stringify(ketQua),
      bayGio(),
      job.id,
    );
    log.info("job.xong", { id: job.id, loai: job.loai });
  } catch (e) {
    const thongDiep = e instanceof Error ? e.message : String(e);
    db.query("UPDATE job SET trang_thai = 'loi', loi = ?, xong_luc = ? WHERE id = ?").run(
      thongDiep,
      bayGio(),
      job.id,
    );
    log.warn("job.loi", { id: job.id, loai: job.loai, thong_diep: thongDiep });
  }
}
