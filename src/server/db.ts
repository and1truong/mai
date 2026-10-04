import { Database } from "bun:sqlite";
import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { log } from "../log.ts";

export const TEN_DB = "mai.sqlite";

// Mở (hoặc tạo) database trong dataDir. dataDir là volume bền của một instance:
// chứa mai.sqlite + thư mục assets/.
export function moDb(dataDir: string): Database {
  mkdirSync(join(dataDir, "assets"), { recursive: true });
  const db = new Database(join(dataDir, TEN_DB), { create: true });
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec("PRAGMA busy_timeout = 5000;");
  return db;
}

const THU_MUC_MIGRATION = join(import.meta.dir, "migrations");

// Migration runner tối thiểu: file NNNN_ten.sql, chạy theo thứ tự, mỗi file một transaction.
// Ghi vào bảng schema_migrations nên chạy lại nhiều lần vẫn idempotent.
export function chayMigration(db: Database): number[] {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    so INTEGER PRIMARY KEY,
    tep TEXT NOT NULL DEFAULT '',
    ap_dung_luc TEXT NOT NULL
  );`);
  // Db cũ chưa có cột tep → thêm để phát hiện trùng số.
  const coCotTep = (db.query("PRAGMA table_info(schema_migrations)").all() as { name: string }[]).some(
    (c) => c.name === "tep",
  );
  if (!coCotTep) {
    db.exec("ALTER TABLE schema_migrations ADD COLUMN tep TEXT NOT NULL DEFAULT ''");
  }
  const daApDung = new Map(
    (
      db.query("SELECT so, tep FROM schema_migrations").all() as { so: number; tep: string }[]
    ).map((r) => [r.so, r.tep]),
  );
  const dsTep = readdirSync(THU_MUC_MIGRATION)
    .filter((f) => /^\d{4}_.*\.sql$/.test(f))
    .sort();
  const moiApDung: number[] = [];
  for (const ten of dsTep) {
    const so = Number(ten.slice(0, 4));
    if (daApDung.has(so)) {
      const tepDaGhi = daApDung.get(so);
      if (tepDaGhi && tepDaGhi !== ten) {
        throw new Error(`Migration số ${so} đã áp dụng với file khác: ${tepDaGhi} ≠ ${ten}`);
      }
      continue;
    }
    const sql = readFileSync(join(THU_MUC_MIGRATION, ten), "utf8");
    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec(sql);
      db.query("INSERT INTO schema_migrations (so, tep, ap_dung_luc) VALUES (?, ?, ?)").run(
        so,
        ten,
        new Date().toISOString(),
      );
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
    log.info("migration.ap_dung", { so, tep: ten });
    daApDung.set(so, ten);
    moiApDung.push(so);
  }
  return moiApDung;
}
