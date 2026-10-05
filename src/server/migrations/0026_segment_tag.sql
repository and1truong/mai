-- Segment động + tag tay (#59, ticket #66).
--
-- segment: ten + quy_tac JSON (DSL {all:[], any:[]} — xem
-- modules/khach/segment.ts). Membership KHÔNG materialize: tính
-- deterministic khi đọc qua thanhVienSegment — cùng data cùng kết quả.
-- campaign.segment_id: liên kết audience cho #68; segment đang được
-- campaign dùng → DELETE 409.
CREATE TABLE segment (
  id TEXT PRIMARY KEY,
  ten TEXT NOT NULL,
  quy_tac TEXT NOT NULL,
  tao_luc TEXT NOT NULL,
  tao_boi TEXT NOT NULL
);

ALTER TABLE campaign ADD COLUMN segment_id TEXT NOT NULL DEFAULT '';

-- Tag tay trên person: nguon audit ai gắn (tay | automation | import).
CREATE TABLE khach_tag (
  khach_id TEXT NOT NULL REFERENCES khach(id) ON DELETE CASCADE,
  tag TEXT NOT NULL,
  nguon TEXT NOT NULL,
  tao_luc TEXT NOT NULL,
  PRIMARY KEY (khach_id, tag)
);
