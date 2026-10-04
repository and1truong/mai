-- #20: record usage mỗi lần gọi provider sinh — ai/model/task, token khi có,
-- thời gian chạy và lỗi. Một dòng per lần gọi (kể cả lần sửa trong cùng
-- attempt); attempt là so_lan_thu của job lúc gọi.
CREATE TABLE su_dung_sinh (
  id TEXT PRIMARY KEY,
  job_id TEXT,
  lan_thu INTEGER NOT NULL DEFAULT 0,
  provider TEXT NOT NULL,
  model TEXT NOT NULL DEFAULT '',
  task TEXT NOT NULL,
  phien_ban_task INTEGER NOT NULL,
  token_vao INTEGER,
  token_ra INTEGER,
  chi_phi_uoc_tinh REAL,               -- chỉ có giá trị khi pricing được cấu hình
  ms INTEGER NOT NULL DEFAULT 0,
  trang_thai TEXT NOT NULL,            -- 'ok' | 'loi'
  loi TEXT NOT NULL DEFAULT '',
  tao_luc TEXT NOT NULL
);
CREATE INDEX idx_su_dung_sinh_job ON su_dung_sinh (job_id, tao_luc);
CREATE INDEX idx_su_dung_sinh_tao_luc ON su_dung_sinh (tao_luc);
