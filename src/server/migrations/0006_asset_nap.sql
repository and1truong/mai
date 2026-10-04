-- Nạp nguồn + asset local (#17): metadata file, đính kèm tường minh vào
-- đầu ra, snapshot asset lúc xuất bản, idempotency key cho ingest.

-- Byte gốc nằm trong MAI_DATA_DIR/assets/<duong_dan>; DB chỉ giữ metadata.
-- duong_dan = '<id>.<ext>' do server đặt → tên file upload không ghi đè
-- được file ứng dụng hay thoát khỏi thư mục data.
CREATE TABLE asset (
  id TEXT PRIMARY KEY,
  ten_file TEXT NOT NULL,                            -- tên gốc đã làm sạch, chỉ để hiển thị
  duong_dan TEXT NOT NULL UNIQUE,
  loai TEXT NOT NULL,                                -- 'van_ban' | 'hinh_anh'
  mime TEXT NOT NULL,
  kich_thuoc INTEGER NOT NULL,
  checksum TEXT NOT NULL,                            -- sha256 hex của byte gốc
  nguon_id TEXT REFERENCES nguon(id) ON DELETE SET NULL,  -- liên kết nguồn tùy chọn
  ghi_chu TEXT NOT NULL DEFAULT '',                  -- attribution/quyền tùy chọn
  khoa_idem TEXT,                                    -- dedupe retry cùng request nạp
  trang_thai TEXT NOT NULL DEFAULT 'hoat_dong',      -- 'hoat_dong' | 'luu_tru'
  tao_luc TEXT NOT NULL,
  tao_boi TEXT NOT NULL
);
-- SQLite: UNIQUE trên cột nullable vẫn cho nhiều NULL → partial index chặn
-- trùng khoa_idem mà vẫn cho phần lớn row không khóa.
CREATE UNIQUE INDEX uq_asset_khoa_idem ON asset (khoa_idem) WHERE khoa_idem IS NOT NULL;
CREATE INDEX idx_asset_nguon ON asset (nguon_id);
CREATE INDEX idx_asset_checksum ON asset (checksum);

-- Asset được chọn tường minh vào một đầu ra: export/xuất bản chỉ gồm phần
-- này — asset của nguồn không tự trôi vào đầu ra.
CREATE TABLE ban_the_hien_asset (
  ban_the_hien_id TEXT NOT NULL REFERENCES ban_the_hien(id) ON DELETE CASCADE,
  asset_id TEXT NOT NULL REFERENCES asset(id),
  tao_luc TEXT NOT NULL,
  PRIMARY KEY (ban_the_hien_id, asset_id)
);
CREATE INDEX idx_btha_asset ON ban_the_hien_asset (asset_id);

-- Record xuất bản snapshot danh sách asset được chọn tại thời điểm đăng:
-- đổi chọn sau đó không viết lại được bằng chứng đã đăng.
ALTER TABLE xuat_ban ADD COLUMN asset_ids TEXT NOT NULL DEFAULT '[]';

-- Ingest cùng khoa_idem → cùng một revision, retry không tạo trùng.
ALTER TABLE nguon_revision ADD COLUMN khoa_idem TEXT;
CREATE UNIQUE INDEX uq_nguon_revision_khoa_idem
  ON nguon_revision (khoa_idem) WHERE khoa_idem IS NOT NULL;
