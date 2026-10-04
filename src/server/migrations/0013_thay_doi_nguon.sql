-- #14: phát hiện thay đổi nguồn và task sửa các bản thể hiện phụ thuộc.
-- "Nguồn" ở đây gồm cả nguồn nội dung (nguon) lẫn hồ sơ thương hiệu/đối tượng —
-- cùng một cơ chế: một revision nguồn mới → một record thay_doi_nguon.

-- Một lần phát hiện = diff giữa revision trước và revision mới của một entity.
-- UNIQUE (loai, den_revision_id): xử lý lại cùng một revision mới trả về đúng
-- record đã ghi — không tạo detection trùng.
CREATE TABLE thay_doi_nguon (
  id TEXT PRIMARY KEY,
  loai TEXT NOT NULL,                            -- 'nguon' | 'thuong_hieu' | 'doi_tuong'
  entity_id TEXT NOT NULL,                       -- nguon.id hoặc id hồ sơ
  tu_revision_id TEXT NOT NULL,
  den_revision_id TEXT NOT NULL,
  -- JSON diff mức mục (nguon: cac_muc) hoặc mức trường (hồ sơ: snapshot).
  ds_thay_doi TEXT NOT NULL DEFAULT '[]',
  tao_luc TEXT NOT NULL,
  tao_boi TEXT NOT NULL,
  UNIQUE (loai, den_revision_id)
);
CREATE INDEX idx_thay_doi_nguon_entity ON thay_doi_nguon (loai, entity_id, tao_luc);

-- Task sửa một đầu ra bị ảnh hưởng bởi một thay_doi_nguon.
-- loai 'sinh_lai': bản chỉ tồn tại trong MAI → đề xuất sinh lại + review;
-- loai 'thu_cong': bản đã xuất bản trước đó → file/copy bên ngoài MAI không
--   sửa được, task là nhắc việc tay, chỉ đóng khi người dùng đánh dấu.
-- UNIQUE (thay_doi_nguon_id, ban_the_hien_id): cùng detection không tạo task
-- trùng cho một bản thể hiện.
CREATE TABLE task_sua (
  id TEXT PRIMARY KEY,
  thay_doi_nguon_id TEXT NOT NULL REFERENCES thay_doi_nguon(id),
  ban_the_hien_id TEXT NOT NULL REFERENCES ban_the_hien(id),
  loai TEXT NOT NULL,                            -- 'sinh_lai' | 'thu_cong'
  do_tin TEXT NOT NULL,                          -- 'chinh_xac' | 'khong_chac'
  ly_do TEXT NOT NULL DEFAULT '',
  -- JSON diff theo đúng revision mà bản này đã ghim (khác nhau giữa các bản).
  ds_muc TEXT NOT NULL DEFAULT '[]',
  trang_thai TEXT NOT NULL DEFAULT 'mo',         -- 'mo' | 'dang_lam' | 'xong' | 'bo_qua'
  job_id TEXT,                                   -- job sinh lại đã enqueue (nếu có)
  tao_luc TEXT NOT NULL,
  tao_boi TEXT NOT NULL,
  cap_nhat_luc TEXT NOT NULL,
  UNIQUE (thay_doi_nguon_id, ban_the_hien_id)
);
CREATE INDEX idx_task_sua_bth ON task_sua (ban_the_hien_id, trang_thai);
CREATE INDEX idx_task_sua_tdn ON task_sua (thay_doi_nguon_id, trang_thai);
