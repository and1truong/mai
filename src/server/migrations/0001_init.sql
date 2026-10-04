-- Schema khởi tạo MAI.
-- Ranh giới module: context (thương hiệu/đối tượng), nguồn + bản thể hiện + revision
-- (nội dung), job (job nền trong process).

CREATE TABLE context (
  id TEXT PRIMARY KEY,
  ten TEXT NOT NULL DEFAULT '',
  doi_tuong TEXT NOT NULL DEFAULT '',
  giong_noi TEXT NOT NULL DEFAULT '',
  gia_tri TEXT NOT NULL DEFAULT '',
  cap_nhat_luc TEXT NOT NULL,
  cap_nhat_boi TEXT NOT NULL
);

CREATE TABLE nguon (
  id TEXT PRIMARY KEY,
  tieu_de TEXT NOT NULL,
  noi_dung TEXT NOT NULL,
  loai TEXT NOT NULL DEFAULT 'van_ban',
  tao_luc TEXT NOT NULL,
  tao_boi TEXT NOT NULL,
  cap_nhat_luc TEXT NOT NULL
);

CREATE TABLE ban_the_hien (
  id TEXT PRIMARY KEY,
  nguon_id TEXT NOT NULL REFERENCES nguon(id),
  dinh_dang TEXT NOT NULL,
  doi_tuong TEXT NOT NULL DEFAULT '',
  trang_thai TEXT NOT NULL DEFAULT 'nhap',
  head_revision_id TEXT,
  tao_luc TEXT NOT NULL,
  tao_boi TEXT NOT NULL
);

-- Revision là immutable: không UPDATE, chỉ INSERT revision mới.
CREATE TABLE revision (
  id TEXT PRIMARY KEY,
  ban_the_hien_id TEXT NOT NULL REFERENCES ban_the_hien(id),
  so_thu_tu INTEGER NOT NULL,
  noi_dung TEXT NOT NULL,
  dua_tren_revision_id TEXT,
  tao_luc TEXT NOT NULL,
  tao_boi TEXT NOT NULL,
  UNIQUE (ban_the_hien_id, so_thu_tu)
);

CREATE INDEX idx_revision_bth ON revision (ban_the_hien_id, so_thu_tu);
CREATE INDEX idx_bth_nguon ON ban_the_hien (nguon_id);

-- Job nền trong process: runner đọc hàng 'cho' và chạy handler theo 'loai'.
CREATE TABLE job (
  id TEXT PRIMARY KEY,
  loai TEXT NOT NULL,
  trang_thai TEXT NOT NULL DEFAULT 'cho',
  payload TEXT NOT NULL DEFAULT '{}',
  ket_qua TEXT,
  loi TEXT,
  tao_luc TEXT NOT NULL,
  chay_luc TEXT,
  xong_luc TEXT
);
