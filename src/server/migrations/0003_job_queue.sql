-- Job queue bền: idempotency key, entity/revision tham chiếu, attempt/timeout,
-- lease/recovery, lên lịch, tiến độ, nhật ký thực thi có cấu trúc.
-- Trạng thái: 'cho' | 'dang_chay' | 'xong' | 'loi' | 'huy'.

ALTER TABLE job ADD COLUMN khoa_idem TEXT;
ALTER TABLE job ADD COLUMN entity_loai TEXT NOT NULL DEFAULT '';
ALTER TABLE job ADD COLUMN entity_id TEXT NOT NULL DEFAULT '';
ALTER TABLE job ADD COLUMN revision_id TEXT;
ALTER TABLE job ADD COLUMN so_lan_thu INTEGER NOT NULL DEFAULT 0;
ALTER TABLE job ADD COLUMN so_lan_thu_toi_da INTEGER NOT NULL DEFAULT 3;
ALTER TABLE job ADD COLUMN timeout_ms INTEGER NOT NULL DEFAULT 120000;
ALTER TABLE job ADD COLUMN chay_som_nhat TEXT;
ALTER TABLE job ADD COLUMN mui_gio TEXT NOT NULL DEFAULT '';
ALTER TABLE job ADD COLUMN lease_token TEXT;
ALTER TABLE job ADD COLUMN lease_den TEXT;
ALTER TABLE job ADD COLUMN tien_do TEXT NOT NULL DEFAULT '{}';
ALTER TABLE job ADD COLUMN loi_vinh_vien INTEGER NOT NULL DEFAULT 0;

-- Job từ schema cũ chưa có khóa: gán khóa ổn định theo id.
UPDATE job SET khoa_idem = 'legacy:' || id WHERE khoa_idem IS NULL;

-- Một khoa_idem = đúng một job logic. Enqueue lặp cùng khóa → trả job đã có.
CREATE UNIQUE INDEX uq_job_khoa_idem ON job (khoa_idem);

-- Runner lấy job 'cho' đã tới hạn; recovery lấy 'dang_chay' hết lease.
CREATE INDEX idx_job_runnable ON job (trang_thai, chay_som_nhat, tao_luc);
CREATE INDEX idx_job_lease ON job (trang_thai, lease_den);

-- Nhật ký thực thi có cấu trúc, một dòng mỗi sự kiện, append-only.
CREATE TABLE job_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id TEXT NOT NULL REFERENCES job(id),
  ts TEXT NOT NULL,
  su_kien TEXT NOT NULL,
  du_lieu TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX idx_job_log_job ON job_log (job_id, id);
