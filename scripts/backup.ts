// Backup: checkpoint WAL rồi copy toàn bộ thư mục data → backups/<timestamp>/.
// Quy trình an toàn khi server đang chạy, nhưng khuyến nghị backup khi server dừng.

import { cpSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { taiCauHinh } from "../src/config.ts";
import { log } from "../src/log.ts";
import { moDb, TEN_DB } from "../src/server/db.ts";

const cauHinh = await taiCauHinh();
const dataDir = resolve(cauHinh.dataDir);

if (!existsSync(join(dataDir, TEN_DB))) {
  log.error("backup.khong_co_data", { dataDir });
  console.error(`Không có dữ liệu để backup: ${dataDir}`);
  process.exit(1);
}

// Checkpoint WAL để file .sqlite chứa đầy đủ dữ liệu trước khi copy.
const db = moDb(dataDir);
db.exec("PRAGMA wal_checkpoint(TRUNCATE);");
db.close();

const ten = new Date().toISOString().replace(/[:.]/g, "-");
const den = resolve("backups", ten);
cpSync(dataDir, den, { recursive: true });

log.info("backup.xong", { tu: dataDir, den });
console.log(`Backup xong: ${den}`);
