// Backup: VACUUM INTO cho database (copy nhất quán, atomic phía SQLite),
// cpSync cho thư mục assets. Output: backups/<timestamp>/.

import { cpSync, existsSync, mkdirSync } from "node:fs";
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

const ten = new Date().toISOString().replace(/[:.]/g, "-");
const den = resolve("backups", ten);
mkdirSync(den, { recursive: true });

// VACUUM INTO tạo bản copy nhất quán của db kể cả khi server đang chạy.
const db = moDb(dataDir);
const tepDb = join(den, TEN_DB).replace(/'/g, "''");
db.exec(`VACUUM INTO '${tepDb}'`);
db.close();

const assets = join(dataDir, "assets");
if (existsSync(assets)) {
  cpSync(assets, join(den, "assets"), { recursive: true });
}

log.info("backup.xong", { tu: dataDir, den });
console.log(`Backup xong: ${den}`);
