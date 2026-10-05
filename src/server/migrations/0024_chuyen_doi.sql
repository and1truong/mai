-- Ticket #63: conversion + attribution.
-- chuyen_doi: khach_id nullable — conversion chưa gán được person vẫn giữ.
-- dau_cham_dau: interaction ĐẦU TIÊN có tham chiếu attribution — INSERT OR
--   IGNORE một lần, bất biến (first-touch).
-- quy_ve: kết quả attribution theo model, lưu cùng model đã dùng — hai model
--   (first_touch/last_touch) tính cùng lúc khi ghi conversion.

CREATE TABLE chuyen_doi (
  id TEXT PRIMARY KEY,
  khach_id TEXT,
  loai TEXT NOT NULL,
  gia_tri REAL,
  tien_te TEXT NOT NULL DEFAULT '',
  nguon TEXT NOT NULL,
  xay_ra_luc TEXT NOT NULL,
  khoa_idem TEXT NOT NULL,
  ban_the_hien_id TEXT NOT NULL DEFAULT '',
  campaign_id TEXT NOT NULL DEFAULT '',
  don_hang_ngoai_id TEXT NOT NULL DEFAULT '',
  chi_tiet TEXT NOT NULL DEFAULT '{}',
  tao_luc TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_chuyen_doi_idem ON chuyen_doi (khoa_idem) WHERE khoa_idem <> '';
CREATE INDEX idx_chuyen_doi_khach ON chuyen_doi (khach_id, xay_ra_luc);

CREATE TABLE dau_cham_dau (
  khach_id TEXT PRIMARY KEY REFERENCES khach(id),
  tuong_tac_id TEXT NOT NULL,
  xay_ra_luc TEXT NOT NULL,
  campaign_id TEXT NOT NULL DEFAULT '',
  link_dich_id TEXT NOT NULL DEFAULT '',
  ban_the_hien_id TEXT NOT NULL DEFAULT '',
  giao_hang_id TEXT NOT NULL DEFAULT '',
  nguon TEXT NOT NULL DEFAULT ''
);

CREATE TABLE quy_ve (
  id TEXT PRIMARY KEY,
  chuyen_doi_id TEXT NOT NULL REFERENCES chuyen_doi(id),
  khach_id TEXT,
  mo_hinh TEXT NOT NULL,
  loai_dich TEXT NOT NULL,
  dich_id TEXT NOT NULL DEFAULT '',
  do_tin TEXT NOT NULL,
  tao_luc TEXT NOT NULL,
  UNIQUE (chuyen_doi_id, mo_hinh)
);
CREATE INDEX idx_quy_ve_khach ON quy_ve (khach_id);
CREATE INDEX idx_quy_ve_dich ON quy_ve (loai_dich, dich_id);
