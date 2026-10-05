// Reset: xóa thư mục data, migrate lại, seed lại. Chạy lại được nhiều lần.

import { existsSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { taiCauHinh } from "../src/config.ts";
import { log } from "../src/log.ts";
import { chayMigration, moDb } from "../src/server/db.ts";
import { seed } from "../src/server/seed.ts";
import { chanKhiServerChay } from "./shared.ts";

const cauHinh = await taiCauHinh();
const dataDir = resolve(cauHinh.dataDir);

// Xóa data khi server đang giữ dataDir này → mất dữ liệu. Từ chối trừ khi --chap-nhan.
chanKhiServerChay(dataDir, process.argv.includes("--chap-nhan"), "reset");

if (existsSync(dataDir)) {
  rmSync(dataDir, { recursive: true, force: true });
  log.info("reset.xoa_data", { dataDir });
}

const db = moDb(dataDir);
const apDung = chayMigration(db);
// Truyền dataDir để seed ghi luôn asset fixture (ảnh croissant tiệm bánh)
// vào dataDir/assets/ — caption Instagram có ảnh thật sau reset (#7).
const ketQua = seed(db, "demo", { dataDir });
log.info("reset.xong", { migrations: apDung, ...ketQua });
db.close();
