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
  // + Sở Ban An Khang (#11) + Velocity Footwear (#12).
  expect(dem("ho_so_thuong_hieu")).toBe(7);
  // 4 hồ sơ cũ + khách quen khu phố (#7) + độc giả Phúc Âm + thiếu niên (#8)
  // + 6 đối tượng bản phát hành 4.0 (#9) + 4 đối tượng gây quỹ (#10)
  // + 5 đối tượng công quyền (#11) + 2 runner thương hiệu (#12).
  expect(dem("ho_so_doi_tuong")).toBe(24);
  expect(dem("thuat_ngu")).toBe(5);
  // 7 thương hiệu + 1 sửa thuật ngữ + 24 đối tượng.
  expect(dem("ho_so_revision")).toBe(32);
  // demo MAI + retry + fact tiệm bánh + KH7/KH14 + ghi chú biên tập số 002
  // + 3 nguồn bằng chứng phát hành + nguồn fact tự động (#9)
  // + 2 nguồn hiện trường/kế hoạch + nguồn fact tự động (#10)
  // + 2 nguồn chính sách/vận hành + nguồn fact tự động (#11)
  // + nguồn spec + nguồn chung + 3 nguồn thị trường (#12).
  expect(dem("nguon")).toBe(21);
  expect(dem("nguon_revision")).toBe(21);
  // 3 cũ + chủ đề số 002 + chủ đề phát hành + chủ đề gây quỹ + chủ đề công quyền
  // + 3 thông điệp thị trường (#12).
  expect(dem("thong_diep")).toBe(10);
  // 3 cũ + 3 link nguồn số 002 + 3 tham chiếu + nguồn tự động phát hành
  // + nguồn tự động gây quỹ + 2 tham chiếu
  // + nguồn tự động công quyền + nguồn chính sách + nguồn vận hành
  // + mỗi thông điệp thị trường link nguồn chung + nguồn thị trường +
  // spec bằng chứng (3 link × 3 thị trường, #12).
  expect(dem("thong_diep_nguon")).toBe(25);
  expect(dem("thong_diep_revision")).toBe(10);
  // 14 cũ + 5 số 002 + 3 đầu ra phát hành + 7 đầu ra gây quỹ + 5 đầu ra công quyền
  // + 2 biến thể thương hiệu (#12) + newsletter kênh sở hữu (#13).
  expect(dem("ban_the_hien")).toBe(37);
  expect(dem("revision")).toBe(37);
  expect(dem("ke_hoach")).toBe(2);
  // 12 cũ + số 002 (5) + phát hành (dev 2, khách 1, sales 2) + gây quỹ (10)
  // + công quyền (faq 2, checklist 2, trường học 1)
  // + thương hiệu (bài viết US 2, caption VN 1).
  // +1 newsletter #13 (cho_duyet + da_duyet = 2 record).
  expect(dem("duyet")).toBe(42);
  // 4 cũ + bài chính số 002 + hướng dẫn dev + báo cáo + trang campaign gây quỹ
  // + FAQ + checklist công quyền.
  expect(dem("xuat_ban")).toBe(10);
  expect(dem("campaign")).toBe(6); // số 001 + số 002 + phát hành 4.0 + gây quỹ + công quyền + thương hiệu
  expect(dem("su_kien")).toBe(211); // 54 cũ + 23 story #8 + 21 story #9 + 34 story #10 + 25 story #11 + 27 story #12 + 8 story #13 + 5 story #15 + 8 story #64 + 3 doi_trang_thai_doi #65 + 3 story #70 (tao kh + gan_dinh_danh + dat_dong_y)
  // Story #15: mục tiêu + 2 link đích + snapshot provider + kết quả nhập tay
  // + 3 lần giao fixture + sự kiện first-party.
  expect(dem("muc_tieu_ket_qua")).toBe(1);
  expect(dem("link_dich")).toBe(2);
  expect(dem("su_kien_do")).toBe(18);
  expect(dem("so_lieu")).toBe(2);
  expect(dem("giao_hang")).toBe(3);
  db.close();
});
