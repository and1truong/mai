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
  expect(dem("ho_so_doi_tuong")).toBe(4); // kỹ sư + không chuyên + mới + lãnh đạo kỹ thuật (#6)
  expect(dem("thuat_ngu")).toBe(5);
  expect(dem("ho_so_revision")).toBe(8); // 3 thương hiệu + 1 sửa thuật ngữ + 4 đối tượng
  expect(dem("nguon")).toBe(2); // demo MAI + retry amplification
  expect(dem("nguon_revision")).toBe(2);
  expect(dem("thong_diep")).toBe(2);
  expect(dem("thong_diep_nguon")).toBe(2);
  expect(dem("thong_diep_revision")).toBe(2);
  expect(dem("ban_the_hien")).toBe(9); // 1 demo + 8 đầu ra story creator
  expect(dem("revision")).toBe(9);
  expect(dem("ke_hoach")).toBe(1);
  // Duyệt: bài viết 2 (gửi+duyệt) + LinkedIn 2 + thread 1 + script dài 1.
  expect(dem("duyet")).toBe(6);
  expect(dem("xuat_ban")).toBe(2); // bài viết (→ trang /p) + bài LinkedIn
  expect(dem("su_kien")).toBe(32); // 4 demo + 28 của story #6
  db.close();
});
