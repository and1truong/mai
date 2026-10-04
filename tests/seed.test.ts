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
  // 4 hồ sơ cũ + khách quen khu phố (#7) + độc giả Phúc Âm + thiếu niên (#8).
  expect(dem("ho_so_doi_tuong")).toBe(7);
  expect(dem("thuat_ngu")).toBe(5);
  expect(dem("ho_so_revision")).toBe(11); // 3 thương hiệu + 1 sửa thuật ngữ + 7 đối tượng
  // demo MAI + retry + fact tiệm bánh + KH7/KH14 + ghi chú biên tập số 002.
  expect(dem("nguon")).toBe(6);
  expect(dem("nguon_revision")).toBe(6);
  expect(dem("thong_diep")).toBe(4); // 3 cũ + thông điệp chủ đề số 002
  expect(dem("thong_diep_nguon")).toBe(6); // 3 cũ + 3 link nguồn số 002
  expect(dem("thong_diep_revision")).toBe(4);
  expect(dem("ban_the_hien")).toBe(19); // 14 cũ + 5 đầu ra số 002
  expect(dem("revision")).toBe(19);
  expect(dem("ke_hoach")).toBe(2);
  // Duyệt: 12 cũ + số 002 (bài chính 2, bài học 1, giải thích thiếu niên 2).
  expect(dem("duyet")).toBe(17);
  expect(dem("xuat_ban")).toBe(5); // 4 cũ + bài chính số 002 (→ trang /p)
  expect(dem("campaign")).toBe(2); // số 001 + số 002
  expect(dem("su_kien")).toBe(77); // 54 cũ + 23 của story #8
  db.close();
});
