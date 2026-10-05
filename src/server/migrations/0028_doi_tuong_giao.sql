-- #68: snapshot audience per lần giao khi campaign gắn segment — quyết
-- định gửi/bỏ qua (+ lý do) giữ lại cho reporting/audit, không sửa sau.
-- Ghi một lần khi job giao chạy; retry job đọc lại snapshot, không
-- resolve lại (quyết định đóng băng tại thời điểm gửi đầu tiên).
CREATE TABLE doi_tuong_giao (
  id TEXT PRIMARY KEY,
  giao_hang_id TEXT NOT NULL REFERENCES giao_hang(id),
  khach_id TEXT NOT NULL REFERENCES khach(id),
  dinh_danh_id TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  quyet_dinh TEXT NOT NULL,
  ly_do TEXT NOT NULL DEFAULT '',
  tao_luc TEXT NOT NULL
);

CREATE INDEX idx_dtg_giao ON doi_tuong_giao (giao_hang_id);
