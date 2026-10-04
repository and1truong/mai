-- Nháp autosave của editor (#21): một dòng nháp đang soạn cho mỗi
-- (bản thể hiện, actor). Ghim revision mà nháp dựa trên để phát hiện
-- xung đột khi head đổi — không phải revision, không ghi đè head.
CREATE TABLE nhap_soan (
  id TEXT PRIMARY KEY,
  ban_the_hien_id TEXT NOT NULL REFERENCES ban_the_hien(id),
  actor TEXT NOT NULL,
  noi_dung TEXT NOT NULL,
  dua_tren_revision_id TEXT,
  cap_nhat_luc TEXT NOT NULL
);
CREATE UNIQUE INDEX uq_nhap_soan_bth_actor ON nhap_soan (ban_the_hien_id, actor);
CREATE INDEX idx_nhap_soan_bth ON nhap_soan (ban_the_hien_id);
