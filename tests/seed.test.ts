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
  // 3 thương hiệu cũ + thương hiệu MaiSuite (#9) + Giọt Nước Chung (#10)
  // + Sở Ban An Khang (#11).
  expect(dem("ho_so_thuong_hieu")).toBe(6);
  // 4 hồ sơ cũ + khách quen khu phố (#7) + độc giả Phúc Âm + thiếu niên (#8)
  // + 6 đối tượng bản phát hành 4.0 (#9) + 4 đối tượng gây quỹ (#10)
  // + 5 đối tượng công quyền (#11).
  expect(dem("ho_so_doi_tuong")).toBe(22);
  expect(dem("thuat_ngu")).toBe(5);
  // 6 thương hiệu + 1 sửa thuật ngữ + 22 đối tượng.
  expect(dem("ho_so_revision")).toBe(29);
  // demo MAI + retry + fact tiệm bánh + KH7/KH14 + ghi chú biên tập số 002
  // + 3 nguồn bằng chứng phát hành + nguồn fact tự động (#9)
  // + 2 nguồn hiện trường/kế hoạch + nguồn fact tự động (#10)
  // + 2 nguồn chính sách/vận hành + nguồn fact tự động (#11).
  expect(dem("nguon")).toBe(16);
  expect(dem("nguon_revision")).toBe(16);
  // 3 cũ + chủ đề số 002 + chủ đề phát hành + chủ đề gây quỹ + chủ đề công quyền.
  expect(dem("thong_diep")).toBe(7);
  // 3 cũ + 3 link nguồn số 002 + 3 tham chiếu + nguồn tự động phát hành
  // + nguồn tự động gây quỹ + 2 tham chiếu
  // + nguồn tự động công quyền + nguồn chính sách + nguồn vận hành.
  expect(dem("thong_diep_nguon")).toBe(16);
  expect(dem("thong_diep_revision")).toBe(7);
  // 14 cũ + 5 số 002 + 3 đầu ra phát hành + 7 đầu ra gây quỹ + 5 đầu ra công quyền.
  expect(dem("ban_the_hien")).toBe(34);
  expect(dem("revision")).toBe(34);
  expect(dem("ke_hoach")).toBe(2);
  // 12 cũ + số 002 (5) + phát hành (dev 2, khách 1, sales 2) + gây quỹ (10)
  // + công quyền (faq 2, checklist 2, trường học 1).
  expect(dem("duyet")).toBe(37);
  // 4 cũ + bài chính số 002 + hướng dẫn dev + báo cáo + trang campaign gây quỹ
  // + FAQ + checklist công quyền.
  expect(dem("xuat_ban")).toBe(10);
  expect(dem("campaign")).toBe(5); // số 001 + số 002 + phát hành 4.0 + gây quỹ + công quyền
  expect(dem("su_kien")).toBe(157); // 54 cũ + 23 story #8 + 21 story #9 + 34 story #10 + 25 story #11
  db.close();
});
