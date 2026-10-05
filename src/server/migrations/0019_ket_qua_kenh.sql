-- Đo kết quả kênh sở hữu (#15): mục tiêu, link đích theo dõi, sự kiện
-- first-party, số liệu theo nguồn, và gợi ý hành động tiếp theo.
--
-- Ba nguồn số liệu giữ riêng, không trộn:
--   * provider  — số đếm adapter/provider báo (vd Resend last_event)
--   * su_kien_do — sự kiện first-party do chính MAI ghi (xem /p, click /l)
--   * nhap_tay — kết quả người dùng tự nhập kèm bằng chứng
--
-- muc_tieu_ket_qua: mục tiêu + tiêu chí thành công TÙY CHỌN gắn vào
-- campaign hoặc thong_diep. Một dòng per chủ — PUT upsert.
CREATE TABLE muc_tieu_ket_qua (
  id TEXT PRIMARY KEY,
  chu_loai TEXT NOT NULL,                  -- 'campaign' | 'thong_diep'
  chu_id TEXT NOT NULL,
  mo_ta TEXT NOT NULL DEFAULT '',
  tieu_chi TEXT NOT NULL DEFAULT '[]',     -- JSON [{ten, don_vi?, nguong?}]
  tao_luc TEXT NOT NULL,
  tao_boi TEXT NOT NULL,
  cap_nhat_luc TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_muc_tieu_chu ON muc_tieu_ket_qua (chu_loai, chu_id);

-- Link đích theo dõi: token ngắn → GET /l/<token> ghi sự kiện click rồi
-- redirect 302 tới url_dich. Chủ động tạo và chèn vào nội dung/email.
CREATE TABLE link_dich (
  id TEXT PRIMARY KEY,
  token TEXT NOT NULL UNIQUE,
  url_dich TEXT NOT NULL,
  thong_diep_id TEXT NOT NULL DEFAULT '',
  ban_the_hien_id TEXT NOT NULL DEFAULT '',
  nhan TEXT NOT NULL DEFAULT '',
  tao_luc TEXT NOT NULL,
  tao_boi TEXT NOT NULL
);
CREATE INDEX idx_link_dich_td ON link_dich (thong_diep_id);
CREATE INDEX idx_link_dich_bth ON link_dich (ban_the_hien_id);
-- Dedupe link: một (đích, chủ) một link — chặn race tạo trùng.
CREATE UNIQUE INDEX ux_link_dich_chu ON link_dich (url_dich, thong_diep_id, ban_the_hien_id);

-- Sự kiện do MAI tự đo (first-party): request GET hợp lệ tới /p/<bth> hay
-- /l/<token>. khoa_dedupe gộp hit lặp cùng fingerprint client trong một
-- khung thời gian → số đếm là SỰ KIỆN, không phải người duy nhất.
-- la_bot=1 khi UA khớp heuristic bot/máy quét — vẫn ghi nhưng báo cáo
-- loại khỏi số chính và đếm riêng.
CREATE TABLE su_kien_do (
  id TEXT PRIMARY KEY,
  loai TEXT NOT NULL,                      -- 'xem_trang' | 'click_link'
  doi_tuong_loai TEXT NOT NULL,            -- 'ban_the_hien' | 'link_dich'
  doi_tuong_id TEXT NOT NULL,
  khoa_dedupe TEXT NOT NULL DEFAULT '',
  la_bot INTEGER NOT NULL DEFAULT 0,
  chi_tiet TEXT NOT NULL DEFAULT '{}',
  tao_luc TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_su_kien_do_dedupe ON su_kien_do (khoa_dedupe)
  WHERE khoa_dedupe <> '';
CREATE INDEX idx_su_kien_do_dt ON su_kien_do (doi_tuong_loai, doi_tuong_id, loai);

-- Số liệu gắn chủ: nguon 'provider' (snapshot adapter đọc được) hoặc
-- 'nhap_tay' (người nhập kèm bằng chứng). Ghi cửa sổ đo + timezone + lúc
-- thu thập → độ tươi dữ liệu tính khi đọc báo cáo.
CREATE TABLE so_lieu (
  id TEXT PRIMARY KEY,
  nguon TEXT NOT NULL,                     -- 'provider' | 'nhap_tay'
  chu_loai TEXT NOT NULL,                  -- 'giao_hang' | 'ban_the_hien' | 'thong_diep' | 'campaign'
  chu_id TEXT NOT NULL,
  ten TEXT NOT NULL,                       -- 'email_su_kien' | 'don_dat_truoc' | ...
  gia_tri REAL,
  don_vi TEXT NOT NULL DEFAULT '',
  mo_ta TEXT NOT NULL DEFAULT '',
  bang_chung TEXT NOT NULL DEFAULT '',     -- url/asset/ghi chú bằng chứng (nhap_tay bắt buộc)
  nhan_dinh TEXT NOT NULL DEFAULT '',      -- 'tu_bao' | 'da_do' | ''
  cua_so_tu TEXT,
  cua_so_den TEXT,
  mui_gio TEXT NOT NULL DEFAULT '',
  thu_luc TEXT NOT NULL,                   -- độ tươi = đọc lúc - thu_luc
  chi_tiet TEXT NOT NULL DEFAULT '{}',
  tao_luc TEXT NOT NULL,
  tao_boi TEXT NOT NULL
);
CREATE INDEX idx_so_lieu_chu ON so_lieu (chu_loai, chu_id);

-- Gợi ý hành động tiếp theo: sinh deterministic từ số liệu đã có, mỗi gợi
-- ý kèm quan sát đã dùng + độ bất định. Bền để giữ trạng thái chấp
-- nhận/từ chối và liên kết artifact tạo ra — người dùng quyết, không âm
-- thầm đăng hay sửa nội dung đã duyệt.
CREATE TABLE goi_y_ket_qua (
  id TEXT PRIMARY KEY,
  khoa TEXT NOT NULL UNIQUE,               -- loai:chu_id:tham_so — dedupe ổn định
  loai TEXT NOT NULL,                      -- 'nhap_tiep' | 'cau_hoi' | 'thi_nghiem'
  chu_loai TEXT NOT NULL,
  chu_id TEXT NOT NULL,
  tieu_de TEXT NOT NULL DEFAULT '',
  mo_ta TEXT NOT NULL DEFAULT '',
  quan_sat TEXT NOT NULL DEFAULT '[]',     -- JSON [{mo_ta, gia_tri?, nguon?}]
  bat_dinh TEXT NOT NULL DEFAULT '',       -- 'thap' | 'vua' | 'cao'
  hanh_dong TEXT NOT NULL DEFAULT '{}',    -- JSON tham số tạo artifact khi chấp nhận
  ket_qua TEXT NOT NULL DEFAULT '{}',      -- JSON liên kết entity đã tạo
  trang_thai TEXT NOT NULL DEFAULT 'moi',  -- 'moi' | 'het_han' | 'chap_nhan' | 'tu_choi'
  tao_luc TEXT NOT NULL,
  quyet_luc TEXT
);
CREATE INDEX idx_goi_y_kq_chu ON goi_y_ket_qua (chu_loai, chu_id);
