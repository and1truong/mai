-- Kênh sở hữu (#13): lần giao nội dung qua adapter + danh bạ người nhận
-- opt-in có hỗ trợ hủy đăng ký/suppression.
--
-- giao_hang: một dòng = một lần giao (hoặc đã lên lịch) của một revision
-- đã duyệt tới một kênh. Ghi lại khóa idempotency gửi provider, biên
-- nhận/receipt, URL canonical, lịch hẹn + timezone, số lần thử và lỗi đã
-- xử lý. revision_thanh_cong = revision giao thành công của lần này.
-- trang_thai:
--   'cho_giao'   = đã xếp hàng (chờ job chạy hoặc lịch hẹn tới)
--   'da_giao'    = đã giao tới đích (kênh xác nhận chắc — vd trang nội bộ)
--   'chap_nhan'  = provider đã chấp nhận (khác với đã tới người nhận cuối)
--   'khong_chac' = kết quả mạng mơ hồ — không gửi lại mù, cần người kiểm
--   'xuat_tay'   = hoàn tất bằng export/đăng tay (dry-run, đích không có API)
--   'huy'        = hủy trước khi gửi hoặc bị vô hiệu (revision/duyệt/nguồn đổi)
--   'loi'        = lỗi đã xử lý (có thể retry tay)
CREATE TABLE giao_hang (
  id TEXT PRIMARY KEY,
  ban_the_hien_id TEXT NOT NULL REFERENCES ban_the_hien(id),
  revision_id TEXT NOT NULL,
  kenh TEXT NOT NULL,
  dich_den TEXT NOT NULL DEFAULT '',
  trang_thai TEXT NOT NULL,
  job_id TEXT NOT NULL DEFAULT '',
  khoa_idem TEXT NOT NULL DEFAULT '',
  ma_bien_nhan TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL DEFAULT '',
  len_lich_luc TEXT,
  mui_gio TEXT NOT NULL DEFAULT '',
  so_nguoi_nhan INTEGER NOT NULL DEFAULT 0,
  so_bo_qua INTEGER NOT NULL DEFAULT 0,
  lan_thu INTEGER NOT NULL DEFAULT 0,
  loi TEXT NOT NULL DEFAULT '',
  chi_tiet TEXT NOT NULL DEFAULT '{}',
  revision_thanh_cong TEXT NOT NULL DEFAULT '',
  la_test INTEGER NOT NULL DEFAULT 0,
  tao_luc TEXT NOT NULL,
  tao_boi TEXT NOT NULL,
  xong_luc TEXT
);

CREATE INDEX idx_giao_hang_bth ON giao_hang (ban_the_hien_id, tao_luc);
CREATE INDEX idx_giao_hang_trang_thai ON giao_hang (trang_thai);

-- Người nhận opt-in do chủ sở hữu khai báo — không tự tìm mailing list.
-- token_huy là bí mật theo người nhận cho link hủy đăng ký một chạm.
-- 'huy_dang_ky' = suppression vĩnh viễn: không email nào gửi tới nữa.
CREATE TABLE nguoi_nhan (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  ten TEXT NOT NULL DEFAULT '',
  trang_thai TEXT NOT NULL DEFAULT 'dang_ky',
  token_huy TEXT NOT NULL,
  nguon TEXT NOT NULL DEFAULT '',
  tao_luc TEXT NOT NULL,
  huy_luc TEXT
);
