-- Kế hoạch nội dung của luồng POC (#5): intake chưa xong lưu bền, mỗi kế
-- hoạch gắn một thông điệp chuẩn + nguồn chọn kèm + đầu ra đã chọn.
CREATE TABLE ke_hoach (
  id TEXT PRIMARY KEY,
  thong_diep_id TEXT NOT NULL REFERENCES thong_diep(id),
  nguon_id TEXT REFERENCES nguon(id),
  intake TEXT NOT NULL,
  cta TEXT NOT NULL DEFAULT '',
  de_xuat_dau_ra TEXT NOT NULL DEFAULT '[]',
  ds_chon TEXT NOT NULL DEFAULT '[]',
  trang_thai TEXT NOT NULL DEFAULT 'nhap',
  tao_luc TEXT NOT NULL,
  tao_boi TEXT NOT NULL,
  cap_nhat_luc TEXT NOT NULL
);
CREATE INDEX idx_ke_hoach_td ON ke_hoach(thong_diep_id);
