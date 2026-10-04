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
  // 3 thương hiệu cũ + thương hiệu MaiSuite (#9) + Giọt Nước Chung (#10).
  expect(dem("ho_so_thuong_hieu")).toBe(5);
  // 4 hồ sơ cũ + khách quen khu phố (#7) + độc giả Phúc Âm + thiếu niên (#8)
  // + 6 đối tượng bản phát hành 4.0 (#9) + 4 đối tượng gây quỹ (#10).
  expect(dem("ho_so_doi_tuong")).toBe(17);
  expect(dem("thuat_ngu")).toBe(5);
  // 5 thương hiệu + 1 sửa thuật ngữ + 17 đối tượng.
  expect(dem("ho_so_revision")).toBe(23);
  // demo MAI + retry + fact tiệm bánh + KH7/KH14 + ghi chú biên tập số 002
  // + 3 nguồn bằng chứng phát hành + nguồn fact tự động (#9)
  // + 2 nguồn hiện trường/kế hoạch + nguồn fact tự động (#10).
  expect(dem("nguon")).toBe(13);
  expect(dem("nguon_revision")).toBe(13);
  // 3 cũ + chủ đề số 002 + chủ đề phát hành + chủ đề gây quỹ.
  expect(dem("thong_diep")).toBe(6);
  // 3 cũ + 3 link nguồn số 002 + 3 tham chiếu + nguồn tự động phát hành
  // + nguồn tự động gây quỹ + 2 tham chiếu.
  expect(dem("thong_diep_nguon")).toBe(13);
  expect(dem("thong_diep_revision")).toBe(6);
  // 14 cũ + 5 số 002 + 3 đầu ra phát hành + 7 đầu ra gây quỹ.
  expect(dem("ban_the_hien")).toBe(29);
  expect(dem("revision")).toBe(29);
  expect(dem("ke_hoach")).toBe(2);
  // 12 cũ + số 002 (5) + phát hành (dev 2, khách 1, sales 2) + gây quỹ (10).
  expect(dem("duyet")).toBe(32);
  // 4 cũ + bài chính số 002 + hướng dẫn dev + báo cáo + trang campaign gây quỹ.
  expect(dem("xuat_ban")).toBe(8);
  expect(dem("campaign")).toBe(4); // số 001 + số 002 + phát hành 4.0 + gây quỹ
  expect(dem("su_kien")).toBe(132); // 54 cũ + 23 story #8 + 21 story #9 + 34 story #10
  db.close();
});
