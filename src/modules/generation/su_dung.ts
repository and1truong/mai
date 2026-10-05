import type { Database } from "bun:sqlite";

// Record usage mỗi lần gọi provider (#20): provider/model/task + token khi
// có + thời gian chạy + lỗi. chi_phi_uoc_tinh chỉ được điền khi pricing
// cấu hình tường minh — không đoán giá.
export type SuDungSinh = {
  id: string;
  job_id: string | null;
  lan_thu: number;
  provider: string;
  model: string;
  task: string;
  phien_ban_task: number;
  token_vao: number | null;
  token_ra: number | null;
  chi_phi_uoc_tinh: number | null;
  ms: number;
  trang_thai: string;
  loi: string;
  tao_luc: string;
};

export function ghiSuDungSinh(
  db: Database,
  r: {
    job_id?: string | null;
    lan_thu?: number;
    provider: string;
    model?: string;
    task: string;
    phien_ban_task: number;
    token_vao?: number;
    token_ra?: number;
    gia?: { vao_moi_1k: number; ra_moi_1k: number };
    ms: number;
    trang_thai: "ok" | "loi";
    loi?: string;
  },
): void {
  // Ước tính tiền chỉ khi pricing cấu hình tường minh VÀ provider báo token.
  const chiPhi =
    r.gia && (r.token_vao !== undefined || r.token_ra !== undefined)
      ? ((r.token_vao ?? 0) / 1000) * r.gia.vao_moi_1k +
        ((r.token_ra ?? 0) / 1000) * r.gia.ra_moi_1k
      : null;
  db.query(
    `INSERT INTO su_dung_sinh
       (id, job_id, lan_thu, provider, model, task, phien_ban_task, token_vao, token_ra, chi_phi_uoc_tinh, ms, trang_thai, loi, tao_luc)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    crypto.randomUUID(),
    r.job_id ?? null,
    r.lan_thu ?? 0,
    r.provider,
    r.model ?? "",
    r.task,
    r.phien_ban_task,
    r.token_vao ?? null,
    r.token_ra ?? null,
    chiPhi,
    Math.round(r.ms),
    r.trang_thai,
    r.loi ?? "",
    new Date().toISOString(),
  );
}

export function danhSachSuDungSinh(
  db: Database,
  loc: { job_id?: string } = {},
  gioiHan = 100,
): SuDungSinh[] {
  if (loc.job_id) {
    return db
      .query("SELECT * FROM su_dung_sinh WHERE job_id = ? ORDER BY tao_luc DESC LIMIT ?")
      .all(loc.job_id, gioiHan) as SuDungSinh[];
  }
  return db
    .query("SELECT * FROM su_dung_sinh ORDER BY tao_luc DESC LIMIT ?")
    .all(gioiHan) as SuDungSinh[];
}
