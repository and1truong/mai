// Restore: copy một thư mục backup về lại thư mục data.
// Cú pháp: bun run restore -- backups/<ten> [--thay-the]
// Yêu cầu: dừng server trước khi restore.

import { cpSync, existsSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { taiCauHinh } from "../src/config.ts";
import { log } from "../src/log.ts";
import { TEN_DB } from "../src/server/db.ts";

const nguon = process.argv[2];
const thayThe = process.argv.includes("--thay-the");

if (!nguon) {
  console.error("Cú pháp: bun run restore -- <thu_muc_backup> [--thay-the]");
  process.exit(1);
}

const tu = resolve(nguon);
if (!existsSync(join(tu, TEN_DB))) {
  console.error(`Backup không hợp lệ (thiếu ${TEN_DB}): ${tu}`);
  process.exit(1);
}

const cauHinh = await taiCauHinh();
const dataDir = resolve(cauHinh.dataDir);

if (existsSync(dataDir)) {
  if (!thayThe) {
    console.error(`Thư mục data đã tồn tại: ${dataDir}`);
    console.error("Thêm --thay-the để ghi đè, hoặc xóa thủ công.");
    process.exit(1);
  }
  rmSync(dataDir, { recursive: true, force: true });
}

cpSync(tu, dataDir, { recursive: true });
log.info("restore.xong", { tu, den: dataDir });
console.log(`Restore xong: ${dataDir}`);
