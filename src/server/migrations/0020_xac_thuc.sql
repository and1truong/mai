-- #16: Xác thực instance tùy chọn — tài khoản local (quản trị/biên tập)
-- chia sẻ một thư viện nội dung + phiên đăng nhập cookie.
-- Chỉ thêm bảng: dữ liệu POC một thư viện hiện có đọc được bình thường
-- sau khi bật chế độ bảo vệ.

CREATE TABLE tai_khoan (
  id TEXT PRIMARY KEY,
  ten_dang_nhap TEXT NOT NULL UNIQUE COLLATE NOCASE,
  ten_hien_thi TEXT NOT NULL,
  vai_tro TEXT NOT NULL CHECK (vai_tro IN ('quan_tri', 'bien_tap')),
  hash_mat_khau TEXT NOT NULL,
  trang_thai TEXT NOT NULL DEFAULT 'hoat_dong' CHECK (trang_thai IN ('hoat_dong', 'vo_hieu')),
  tao_luc TEXT NOT NULL,
  tao_boi TEXT NOT NULL DEFAULT '',
  cap_nhat_luc TEXT NOT NULL
);

-- Token raw chỉ sống trong cookie phía client; DB lưu sha256 để đọc DB
-- không lộ phiên đang hoạt động.
CREATE TABLE phien_dang_nhap (
  id TEXT PRIMARY KEY,
  tai_khoan_id TEXT NOT NULL REFERENCES tai_khoan(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  het_han_luc TEXT NOT NULL,
  tao_luc TEXT NOT NULL,
  ip TEXT NOT NULL DEFAULT '',
  user_agent TEXT NOT NULL DEFAULT ''
);

CREATE INDEX idx_phien_tai_khoan ON phien_dang_nhap(tai_khoan_id);
CREATE INDEX idx_phien_het_han ON phien_dang_nhap(het_han_luc);
