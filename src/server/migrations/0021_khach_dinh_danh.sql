-- Đồ thị khách hàng (#59, ticket #60): person hợp nhất + nhiều identity.
--
-- khach: person nội bộ với id ổn định. ten/email/sdt là property hiển thị
-- tùy chọn — bản chất định danh nằm ở bảng dinh_danh. lan_dau_thay/
-- lan_cuoi_thay cập nhật khi person được nhìn thấy (tạo, gắn identity,
-- sự kiện tương tác). trang_thai 'da_gop' dành cho merge (ticket sau).
CREATE TABLE khach (
  id TEXT PRIMARY KEY,
  ten TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  sdt TEXT NOT NULL DEFAULT '',
  trang_thai TEXT NOT NULL DEFAULT 'hoat_dong',
  lan_dau_thay TEXT NOT NULL,
  lan_cuoi_thay TEXT NOT NULL,
  tao_luc TEXT NOT NULL,
  tao_boi TEXT NOT NULL
);

-- dinh_danh: một cách nhận diện person. unique (loai, gia_tri_chuan) là
-- rule xung đột tường minh của epic: đụng unique khi gắn vào person khác
-- → 409 XUNG_DOT_DINH_DANH, không auto-merge theo heuristic.
--   loai 'email'     → gia_tri_chuan = email lowercase
--   loai 'sdt'       → chỉ giữ digit và dấu + đầu
--   loai 'visitor'   → id nặc danh nguyên văn (cookie mai_v, ticket #61)
--   loai 'external'  → gia_tri_chuan = '<nguon>:<external_id>' — khóa
--                      scoped theo hệ thống nguồn, tránh đụng id giữa hai
--                      commerce system
--   loai 'social'    → gia_tri_chuan = '<nguon>:<external_id>' tương tự
-- gia_tri_goc giữ dạng người dùng nhập để hiển thị; nguon + external_id
-- là provenance không được mất khi link identity.
CREATE TABLE dinh_danh (
  id TEXT PRIMARY KEY,
  khach_id TEXT NOT NULL REFERENCES khach(id),
  loai TEXT NOT NULL,
  gia_tri_chuan TEXT NOT NULL,
  gia_tri_goc TEXT NOT NULL DEFAULT '',
  nguon TEXT NOT NULL DEFAULT '',
  external_id TEXT NOT NULL DEFAULT '',
  tao_luc TEXT NOT NULL,
  UNIQUE (loai, gia_tri_chuan)
);
CREATE INDEX idx_dinh_danh_khach ON dinh_danh (khach_id);
CREATE INDEX idx_khach_lan_cuoi ON khach (lan_cuoi_thay);
