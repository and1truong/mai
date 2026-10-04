// Helper dùng chung cho scripts: kiểm tra server MAI đang giữ một dataDir.

import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

export const TEN_LOCK = "mai.server.lock";

// Server ghi lockfile {pid, port} vào dataDir khi khởi động, xóa khi dừng.
// Stale lock (process chết -9) → pid không còn sống → coi như không chạy.
export function serverSongTheoLock(dataDir: string): { pid: number; port: number } | null {
  const tep = join(dataDir, TEN_LOCK);
  if (!existsSync(tep)) return null;
  try {
    const lock = JSON.parse(readFileSync(tep, "utf8")) as { pid?: number; port?: number };
    if (typeof lock.pid !== "number") return null;
    try {
      process.kill(lock.pid, 0); // ESRCH = process đã chết
    } catch {
      rmSync(tep, { force: true }); // dọn lock stale
      return null;
    }
    return { pid: lock.pid, port: lock.port ?? 0 };
  } catch {
    return null;
  }
}

// Từ chối chạy lệnh phá hoại (reset/restore) trên dataDir mà server đang giữ.
export function chanKhiServerChay(dataDir: string, choPhep: boolean, tenLenh: string): void {
  if (choPhep) return;
  const lock = serverSongTheoLock(dataDir);
  if (lock) {
    console.error(`MAI đang chạy trên dataDir ${dataDir} (pid ${lock.pid}, port ${lock.port}).`);
    console.error(`Dừng server trước khi ${tenLenh}, hoặc thêm --chap-nhan để ép.`);
    process.exit(1);
  }
}
