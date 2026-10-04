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
  expect(dem("ho_so_doi_tuong")).toBe(5); // 4 hồ sơ cũ + khách quen khu phố (#7)
  expect(dem("thuat_ngu")).toBe(5);
  expect(dem("ho_so_revision")).toBe(9); // 3 thương hiệu + 1 sửa thuật ngữ + 5 đối tượng
  expect(dem("nguon")).toBe(3); // demo MAI + retry amplification + fact tiệm bánh
  expect(dem("nguon_revision")).toBe(3);
  expect(dem("thong_diep")).toBe(3);
  expect(dem("thong_diep_nguon")).toBe(3);
  expect(dem("thong_diep_revision")).toBe(3);
  expect(dem("ban_the_hien")).toBe(14); // 9 đầu ra cũ + 5 đầu ra tiệm bánh
  expect(dem("revision")).toBe(14);
  expect(dem("ke_hoach")).toBe(2);
  // Duyệt: 6 cũ + tiệm bánh (web 2, IG 2, TikTok 1, GBP 1).
  expect(dem("duyet")).toBe(12);
  expect(dem("xuat_ban")).toBe(4); // 2 cũ + web (→ trang /p) + caption IG
  expect(dem("su_kien")).toBe(54); // 32 cũ + 22 của story #7
  db.close();
});
