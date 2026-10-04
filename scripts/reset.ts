// Reset: xóa thư mục data, migrate lại, seed lại. Chạy lại được nhiều lần.

import { existsSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { taiCauHinh } from "../src/config.ts";
import { log } from "../src/log.ts";
import { chayMigration, moDb } from "../src/server/db.ts";
import { seed } from "../src/server/seed.ts";

const cauHinh = await taiCauHinh();
const dataDir = resolve(cauHinh.dataDir);

if (existsSync(dataDir)) {
  rmSync(dataDir, { recursive: true, force: true });
  log.info("reset.xoa_data", { dataDir });
}

const db = moDb(dataDir);
const apDung = chayMigration(db);
const ketQua = seed(db);
log.info("reset.xong", { migrations: apDung, ...ketQua });
db.close();
