-- Ticket #62: consent theo kênh + mục đích.
-- dong_y = trạng thái hiện tại (upsert theo unique khach/kenh/muc_dich);
-- dong_y_log = mọi chuyển trạng thái một dòng — auditable, không ghi đè.

CREATE TABLE dong_y (
  id TEXT PRIMARY KEY,
  khach_id TEXT NOT NULL REFERENCES khach(id),
  kenh TEXT NOT NULL,
  muc_dich TEXT NOT NULL,
  trang_thai TEXT NOT NULL,
  nguon TEXT NOT NULL,
  cap_nhat_luc TEXT NOT NULL,
  UNIQUE (khach_id, kenh, muc_dich)
);
CREATE INDEX idx_dong_y_khach ON dong_y (khach_id);

CREATE TABLE dong_y_log (
  id TEXT PRIMARY KEY,
  khach_id TEXT NOT NULL REFERENCES khach(id),
  kenh TEXT NOT NULL,
  muc_dich TEXT NOT NULL,
  tu_trang_thai TEXT NOT NULL DEFAULT '',
  sang_trang_thai TEXT NOT NULL,
  nguon TEXT NOT NULL,
  luc TEXT NOT NULL
);
CREATE INDEX idx_dong_y_log_khach ON dong_y_log (khach_id, luc, id);
