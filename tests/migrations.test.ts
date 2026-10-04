import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { chayMigration, moDb } from "../src/server/db.ts";

test("migration chạy được và idempotent", () => {
  const dir = mkdtempSync(join(tmpdir(), "mai-mig-"));
  const db = moDb(dir);
  const lan1 = chayMigration(db);
  const lan2 = chayMigration(db);
  expect(lan1.length).toBeGreaterThan(0);
  expect(lan2.length).toBe(0);

  const bang = (db.query("SELECT name FROM sqlite_master WHERE type = 'table'").all() as {
    name: string;
  }[]).map((r) => r.name);
  for (const t of [
    "ho_so_thuong_hieu",
    "ho_so_doi_tuong",
    "thuat_ngu",
    "ho_so_revision",
    "context_sinh",
    "nguon",
    "ban_the_hien",
    "revision",
    "job",
    "schema_migrations",
  ]) {
    expect(bang).toContain(t);
  }
  db.close();
});

test("số migration đã áp dụng với file khác tên → báo lỗi", () => {
  const dir = mkdtempSync(join(tmpdir(), "mai-mig-dup-"));
  const db = moDb(dir);
  chayMigration(db);
  // Giả lập: số 1 đã ghi với tên file khác (đổi tên file sau khi apply).
  db.query("UPDATE schema_migrations SET tep = '0001_ten_cu.sql' WHERE so = 1").run();
  expect(() => chayMigration(db)).toThrow(/0001_ten_cu\.sql/);
  db.close();
});
