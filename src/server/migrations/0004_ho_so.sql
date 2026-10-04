-- Hồ sơ thương hiệu + hồ sơ đối tượng thay cho bảng `context` một dòng của bootstrap.
-- Một hồ sơ = một preset tái sử dụng; mọi cập nhật ghi một revision immutable.
-- `context_sinh` là snapshot context đã lắp cho một lần sinh nội dung:
-- ràng buộc thương hiệu và sở thích đối tượng tách riêng trong `snapshot`.

DROP TABLE context;

CREATE TABLE ho_so_thuong_hieu (
  id TEXT PRIMARY KEY,
  ten TEXT NOT NULL,
  nhan_dien TEXT NOT NULL DEFAULT '',
  ngon_ngu_uu_tien TEXT NOT NULL DEFAULT '[]',   -- JSON mảng mã ngôn ngữ
  vi_du_giong_van TEXT NOT NULL DEFAULT '',
  nguyen_tac TEXT NOT NULL DEFAULT '',           -- nguyên tắc biên tập
  claim_duyet TEXT NOT NULL DEFAULT '[]',        -- JSON mảng claim được duyệt
  claim_cam TEXT NOT NULL DEFAULT '[]',          -- JSON mảng claim bị cấm
  assets TEXT NOT NULL DEFAULT '[]',             -- JSON mảng tham chiếu asset (byte do #17)
  la_fixture INTEGER NOT NULL DEFAULT 0,         -- 1 = dữ liệu demo seed
  nguon_du_lieu TEXT NOT NULL DEFAULT 'nguoi_dung', -- 'nguoi_dung' | 'he_thong'
  tao_luc TEXT NOT NULL,
  tao_boi TEXT NOT NULL,
  cap_nhat_luc TEXT NOT NULL,
  cap_nhat_boi TEXT NOT NULL
);

-- Trường text rỗng = chưa biết; không bịa nhân khẩu học hay kiến thức hành vi.
CREATE TABLE ho_so_doi_tuong (
  id TEXT PRIMARY KEY,
  ten TEXT NOT NULL,
  ngon_ngu TEXT NOT NULL DEFAULT '',
  dia_diem TEXT NOT NULL DEFAULT '',
  kien_thuc_nen TEXT NOT NULL DEFAULT '',
  moi_quan_tam TEXT NOT NULL DEFAULT '',
  do_sau TEXT NOT NULL DEFAULT '',               -- '' = chưa biết, xem DANH_SACH_DO_SAU
  tu_vung TEXT NOT NULL DEFAULT '',
  quan_he_to_chuc TEXT NOT NULL DEFAULT '',
  nhu_cau_giao_tiep TEXT NOT NULL DEFAULT '',
  nhan_khau_hoc TEXT NOT NULL DEFAULT '',        -- tùy chọn
  la_fixture INTEGER NOT NULL DEFAULT 0,
  nguon_du_lieu TEXT NOT NULL DEFAULT 'nguoi_dung',
  tao_luc TEXT NOT NULL,
  tao_boi TEXT NOT NULL,
  cap_nhat_luc TEXT NOT NULL,
  cap_nhat_boi TEXT NOT NULL
);

-- Bảng dịch thuật ngữ của một hồ sơ thương hiệu; chủ sở hữu sửa được.
-- giu_nguyen = 1: giữ nguyên thuật ngữ ở mọi ngôn ngữ được yêu cầu.
CREATE TABLE thuat_ngu (
  id TEXT PRIMARY KEY,
  thuong_hieu_id TEXT NOT NULL REFERENCES ho_so_thuong_hieu(id) ON DELETE CASCADE,
  thuat_ngu TEXT NOT NULL,
  giu_nguyen INTEGER NOT NULL DEFAULT 1,
  ban_dich TEXT NOT NULL DEFAULT '{}',           -- JSON {ma_ngon_ngu: bản dịch}
  cap_nhat_luc TEXT NOT NULL,
  cap_nhat_boi TEXT NOT NULL,
  UNIQUE (thuong_hieu_id, thuat_ngu)
);

-- Revision hồ sơ immutable: snapshot JSON toàn bộ hồ sơ tại thời điểm đó.
-- nguon_du_lieu đánh dấu thông tin do người dùng nhập hay do hệ thống gợi ý.
CREATE TABLE ho_so_revision (
  id TEXT PRIMARY KEY,
  loai TEXT NOT NULL,                            -- 'thuong_hieu' | 'doi_tuong'
  ho_so_id TEXT NOT NULL,
  so_thu_tu INTEGER NOT NULL,
  snapshot TEXT NOT NULL,
  nguon_du_lieu TEXT NOT NULL DEFAULT 'nguoi_dung',
  tao_luc TEXT NOT NULL,
  tao_boi TEXT NOT NULL,
  UNIQUE (loai, ho_so_id, so_thu_tu)
);

-- Context sinh: tham chiếu revision hồ sơ + ghi đè campaign + snapshot đã lắp.
-- Không khai báo FK tới hồ sơ: snapshot tự đủ, hồ sơ gốc có thể bị xóa sau.
CREATE TABLE context_sinh (
  id TEXT PRIMARY KEY,
  thuong_hieu_id TEXT,
  thuong_hieu_revision_id TEXT,
  doi_tuong_id TEXT,
  doi_tuong_revision_id TEXT,
  ghi_de TEXT NOT NULL DEFAULT '{}',
  snapshot TEXT NOT NULL,
  tao_luc TEXT NOT NULL
);

-- Revision nội dung giữ lại context đã dùng khi sinh (NULL = nhập tay).
ALTER TABLE revision ADD COLUMN context_sinh_id TEXT;
