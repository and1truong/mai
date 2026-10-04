// Restore: copy backup sang thư mục tạm cạnh dataDir rồi đổi chỗ bằng rename
// (lỗi giữa chừng không mất data hiện tại). Từ chối khi server đang chạy.
// Cú pháp: bun run restore -- backups/<ten> [--thay-the] [--chap-nhan]

import { cpSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { taiCauHinh } from "../src/config.ts";
import { log } from "../src/log.ts";
import { TEN_DB } from "../src/server/db.ts";
import { chanKhiServerChay } from "./shared.ts";

const nguon = process.argv[2];
const thayThe = process.argv.includes("--thay-the");

if (!nguon) {
  console.error("Cú pháp: bun run restore -- <thu_muc_backup> [--thay-the] [--chap-nhan]");
  process.exit(1);
}

const tu = resolve(nguon);
if (!existsSync(join(tu, TEN_DB))) {
  console.error(`Backup không hợp lệ (thiếu ${TEN_DB}): ${tu}`);
  process.exit(1);
}

const cauHinh = await taiCauHinh();
const dataDir = resolve(cauHinh.dataDir);

chanKhiServerChay(dataDir, process.argv.includes("--chap-nhan"), "restore");

if (existsSync(dataDir) && !thayThe) {
  console.error(`Thư mục data đã tồn tại: ${dataDir}`);
  console.error("Thêm --thay-the để ghi đè, hoặc xóa thủ công.");
  process.exit(1);
}

const tmp = `${dataDir}.restore-tmp`;
const cu = `${dataDir}.restore-cu`;
for (const d of [tmp, cu]) {
  if (existsSync(d)) rmSync(d, { recursive: true, force: true });
}

cpSync(tu, tmp, { recursive: true });
try {
  if (existsSync(dataDir)) renameSync(dataDir, cu);
  renameSync(tmp, dataDir);
  if (existsSync(cu)) rmSync(cu, { recursive: true, force: true });
} catch {
  // dataDir là mountpoint (vd docker -v): không rename được → dọn nội dung
  // rồi copy từng entry của backup vào, giữ nguyên mountpoint.
  if (existsSync(cu)) renameSync(cu, dataDir); // khôi phục nếu đã dời
  mkdirSync(dataDir, { recursive: true });
  for (const entry of readdirSync(dataDir)) {
    rmSync(join(dataDir, entry), { recursive: true, force: true });
  }
  for (const entry of readdirSync(tmp)) {
    cpSync(join(tmp, entry), join(dataDir, entry), { recursive: true });
  }
  rmSync(tmp, { recursive: true, force: true });
  log.warn("restore.fallback_mountpoint", { dataDir });
}

log.info("restore.xong", { tu, den: dataDir });
console.log(`Restore xong: ${dataDir}`);
