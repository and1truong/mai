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
  // 3 thương hiệu cũ + thương hiệu MaiSuite (#9).
  expect(dem("ho_so_thuong_hieu")).toBe(4);
  // 4 hồ sơ cũ + khách quen khu phố (#7) + độc giả Phúc Âm + thiếu niên (#8)
  // + 6 đối tượng bản phát hành 4.0 (#9).
  expect(dem("ho_so_doi_tuong")).toBe(13);
  expect(dem("thuat_ngu")).toBe(5);
  // 4 thương hiệu + 1 sửa thuật ngữ + 13 đối tượng.
  expect(dem("ho_so_revision")).toBe(18);
  // demo MAI + retry + fact tiệm bánh + KH7/KH14 + ghi chú biên tập số 002
  // + 3 nguồn bằng chứng phát hành + nguồn fact tự động (#9).
  expect(dem("nguon")).toBe(10);
  expect(dem("nguon_revision")).toBe(10);
  expect(dem("thong_diep")).toBe(5); // 3 cũ + chủ đề số 002 + chủ đề phát hành
  // 3 cũ + 3 link nguồn số 002 + 3 tham chiếu + nguồn tự động phát hành.
  expect(dem("thong_diep_nguon")).toBe(10);
  expect(dem("thong_diep_revision")).toBe(5);
  expect(dem("ban_the_hien")).toBe(22); // 14 cũ + 5 số 002 + 3 đầu ra phát hành
  expect(dem("revision")).toBe(22);
  expect(dem("ke_hoach")).toBe(2);
  // Duyệt: 12 cũ + số 002 (5) + phát hành (dev 2, khách 1, sales 2).
  expect(dem("duyet")).toBe(22);
  expect(dem("xuat_ban")).toBe(6); // 4 cũ + bài chính số 002 + hướng dẫn dev
  expect(dem("campaign")).toBe(3); // số 001 + số 002 + bản phát hành 4.0
  expect(dem("su_kien")).toBe(98); // 54 cũ + 23 story #8 + 21 story #9
  db.close();
});
