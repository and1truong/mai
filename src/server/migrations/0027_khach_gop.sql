-- Ticket #67 (epic #59): merge person trùng an toàn.
-- khach_gop = audit trail một dòng mỗi lần gộp (nguồn, đích, conflict đã
-- detect, thời điểm, actor). khach.gop_vao_id = con trỏ redirect một
-- chiều tới person đích — person nguồn giữ record, không DELETE.

CREATE TABLE khach_gop (
  id TEXT PRIMARY KEY,
  khach_nguon_id TEXT NOT NULL,
  khach_dich_id TEXT NOT NULL,
  xung_dot TEXT NOT NULL DEFAULT '[]',
  luc TEXT NOT NULL,
  boi TEXT NOT NULL
);
CREATE INDEX idx_khach_gop_nguon ON khach_gop (khach_nguon_id);
CREATE INDEX idx_khach_gop_dich ON khach_gop (khach_dich_id);

ALTER TABLE khach ADD COLUMN gop_vao_id TEXT NOT NULL DEFAULT '';
