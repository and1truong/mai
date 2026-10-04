import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { chayMigration, moDb } from "../src/server/db.ts";
import { seed } from "../src/server/seed.ts";

test("seed idempotent: chạy 2 lần vẫn đúng 1 bộ dữ liệu demo", () => {
  const dir = mkdtempSync(join(tmpdir(), "mai-seed-"));
  const db = moDb(dir);
  chayMigration(db);
  seed(db);
  seed(db);

  const dem = (t: string) =>
    (db.query(`SELECT COUNT(*) AS c FROM ${t}`).get() as { c: number }).c;
  expect(dem("ho_so_thuong_hieu")).toBe(3);
  expect(dem("ho_so_doi_tuong")).toBe(3);
  expect(dem("thuat_ngu")).toBe(5);
  expect(dem("ho_so_revision")).toBe(7); // 3 thương hiệu + 1 sửa thuật ngữ + 3 đối tượng
  expect(dem("nguon")).toBe(1);
  expect(dem("ban_the_hien")).toBe(1);
  expect(dem("revision")).toBe(1);
  db.close();
});
