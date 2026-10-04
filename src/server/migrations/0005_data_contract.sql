-- Contract dữ liệu nội dung (#4): campaign + thông điệp chuẩn + revision
-- nguồn/thông điệp immutable; bản thể hiện gắn thông điệp thay nguồn;
-- record duyệt theo revision và xuất bản tách khỏi trạng thái;
-- log sự kiện mutation nhẹ kèm actor local.

-- Nguồn: entity giữ state hiện tại (như hồ sơ), revision là snapshot immutable.
-- cac_muc: JSON mảng {id, loai: 'section'|'fact', tieu_de, noi_dung, assets} —
-- định danh fact/section có cấu trúc + tham chiếu asset (byte do #17 sở hữu).
ALTER TABLE nguon ADD COLUMN head_revision_id TEXT;
ALTER TABLE nguon ADD COLUMN cac_muc TEXT NOT NULL DEFAULT '[]';

CREATE TABLE nguon_revision (
  id TEXT PRIMARY KEY,
  nguon_id TEXT NOT NULL REFERENCES nguon(id),
  so_thu_tu INTEGER NOT NULL,
  tieu_de TEXT NOT NULL DEFAULT '',
  loai TEXT NOT NULL DEFAULT 'van_ban',
  noi_dung TEXT NOT NULL DEFAULT '',
  cac_muc TEXT NOT NULL DEFAULT '[]',
  dua_tren_revision_id TEXT,
  tao_luc TEXT NOT NULL,
  tao_boi TEXT NOT NULL,
  UNIQUE (nguon_id, so_thu_tu)
);

-- Nhóm mục tiêu/campaign tùy chọn: một bài đăng lẻ không bắt buộc campaign.
CREATE TABLE campaign (
  id TEXT PRIMARY KEY,
  ten TEXT NOT NULL,
  mo_ta TEXT NOT NULL DEFAULT '',
  ghi_de TEXT NOT NULL DEFAULT '{}',             -- ghi đè context mặc định của campaign
  tao_luc TEXT NOT NULL,
  tao_boi TEXT NOT NULL,
  cap_nhat_luc TEXT NOT NULL,
  cap_nhat_boi TEXT NOT NULL
);

-- Thông điệp chuẩn: một thông điệp → nhiều bản thể hiện theo đối tượng.
CREATE TABLE thong_diep (
  id TEXT PRIMARY KEY,
  campaign_id TEXT REFERENCES campaign(id) ON DELETE SET NULL,
  tieu_de TEXT NOT NULL,
  noi_dung TEXT NOT NULL DEFAULT '',
  head_revision_id TEXT,
  tao_luc TEXT NOT NULL,
  tao_boi TEXT NOT NULL,
  cap_nhat_luc TEXT NOT NULL,
  cap_nhat_boi TEXT NOT NULL
);

-- Quan hệ nhiều-nhiều nguồn ↔ thông điệp.
CREATE TABLE thong_diep_nguon (
  thong_diep_id TEXT NOT NULL REFERENCES thong_diep(id) ON DELETE CASCADE,
  nguon_id TEXT NOT NULL REFERENCES nguon(id) ON DELETE CASCADE,
  PRIMARY KEY (thong_diep_id, nguon_id)
);

-- Revision thông điệp immutable: snapshot nội dung + revision nguồn đã dùng.
CREATE TABLE thong_diep_revision (
  id TEXT PRIMARY KEY,
  thong_diep_id TEXT NOT NULL REFERENCES thong_diep(id),
  so_thu_tu INTEGER NOT NULL,
  tieu_de TEXT NOT NULL DEFAULT '',
  noi_dung TEXT NOT NULL DEFAULT '',
  nguon_revision_ids TEXT NOT NULL DEFAULT '[]',
  dua_tren_revision_id TEXT,
  tao_luc TEXT NOT NULL,
  tao_boi TEXT NOT NULL,
  UNIQUE (thong_diep_id, so_thu_tu)
);

-- Backfill nguồn hiện có: revision 1 từ state hiện tại + thông điệp wrapper.
INSERT INTO nguon_revision (id, nguon_id, so_thu_tu, tieu_de, loai, noi_dung, cac_muc, dua_tren_revision_id, tao_luc, tao_boi)
  SELECT 'nrev-' || id, id, 1, tieu_de, loai, noi_dung, '[]', NULL, cap_nhat_luc, tao_boi FROM nguon;
UPDATE nguon SET head_revision_id = 'nrev-' || id;

INSERT INTO thong_diep (id, campaign_id, tieu_de, noi_dung, head_revision_id, tao_luc, tao_boi, cap_nhat_luc, cap_nhat_boi)
  SELECT 'td-' || id, NULL, tieu_de, noi_dung, NULL, tao_luc, tao_boi, cap_nhat_luc, tao_boi FROM nguon;
INSERT INTO thong_diep_nguon (thong_diep_id, nguon_id) SELECT 'td-' || id, id FROM nguon;
INSERT INTO thong_diep_revision (id, thong_diep_id, so_thu_tu, tieu_de, noi_dung, nguon_revision_ids, dua_tren_revision_id, tao_luc, tao_boi)
  SELECT 'tdrev-' || id, 'td-' || id, 1, tieu_de, noi_dung, json_array('nrev-' || id), NULL, tao_luc, tao_boi FROM nguon;
UPDATE thong_diep SET head_revision_id = 'tdrev-' || substr(id, 4);

-- Bản thể hiện: gắn thông điệp thay nguồn; thêm ngôn ngữ, phiên bản định dạng
-- và đích đến tùy chọn. Phải rebuild bảng: DROP TABLE bảng cha bắn FK check
-- khi bảng con (revision) còn dữ liệu → giữ revision sang bảng đỡ không FK.
CREATE TABLE revision_giu AS SELECT * FROM revision;
DROP TABLE revision;

CREATE TABLE revision (
  id TEXT PRIMARY KEY,
  ban_the_hien_id TEXT NOT NULL REFERENCES ban_the_hien(id),
  so_thu_tu INTEGER NOT NULL,
  noi_dung TEXT NOT NULL,
  dua_tren_revision_id TEXT,
  context_sinh_id TEXT,
  thong_diep_revision_id TEXT,
  tao_luc TEXT NOT NULL,
  tao_boi TEXT NOT NULL,
  UNIQUE (ban_the_hien_id, so_thu_tu)
);

CREATE TABLE ban_the_hien_moi (
  id TEXT PRIMARY KEY,
  thong_diep_id TEXT NOT NULL REFERENCES thong_diep(id),
  dinh_dang TEXT NOT NULL,
  ngon_ngu TEXT NOT NULL DEFAULT 'vi',
  phien_ban_dinh_dang INTEGER NOT NULL DEFAULT 1,
  doi_tuong TEXT NOT NULL DEFAULT '',
  dich_den TEXT NOT NULL DEFAULT '',
  trang_thai TEXT NOT NULL DEFAULT 'nhap',
  head_revision_id TEXT,
  tao_luc TEXT NOT NULL,
  tao_boi TEXT NOT NULL
);
INSERT INTO ban_the_hien_moi (id, thong_diep_id, dinh_dang, doi_tuong, trang_thai, head_revision_id, tao_luc, tao_boi)
  SELECT id, 'td-' || nguon_id, dinh_dang, doi_tuong, trang_thai, head_revision_id, tao_luc, tao_boi FROM ban_the_hien;
DROP TABLE ban_the_hien;
ALTER TABLE ban_the_hien_moi RENAME TO ban_the_hien;

INSERT INTO revision (id, ban_the_hien_id, so_thu_tu, noi_dung, dua_tren_revision_id, context_sinh_id, thong_diep_revision_id, tao_luc, tao_boi)
  SELECT id, ban_the_hien_id, so_thu_tu, noi_dung, dua_tren_revision_id, context_sinh_id, NULL, tao_luc, tao_boi FROM revision_giu;
DROP TABLE revision_giu;

-- Một đầu ra = một (thông điệp, định dạng, ngôn ngữ, đối tượng, đích đến).
CREATE UNIQUE INDEX uq_bth_td_dinh_dang
  ON ban_the_hien (thong_diep_id, dinh_dang, ngon_ngu, doi_tuong, dich_den);
CREATE INDEX idx_bth_td ON ban_the_hien (thong_diep_id);
CREATE INDEX idx_revision_bth ON revision (ban_the_hien_id, so_thu_tu);
CREATE INDEX idx_td_nguon_nguon ON thong_diep_nguon (nguon_id);
CREATE INDEX idx_thong_diep_campaign ON thong_diep (campaign_id);

-- Record duyệt gắn đúng revision nội dung được chấm tại thời điểm chuyển.
CREATE TABLE duyet (
  id TEXT PRIMARY KEY,
  ban_the_hien_id TEXT NOT NULL REFERENCES ban_the_hien(id),
  revision_id TEXT,
  tu_trang_thai TEXT NOT NULL,
  den_trang_thai TEXT NOT NULL,
  ghi_chu TEXT NOT NULL DEFAULT '',
  tao_luc TEXT NOT NULL,
  tao_boi TEXT NOT NULL
);
CREATE INDEX idx_duyet_bth ON duyet (ban_the_hien_id, tao_luc);
CREATE INDEX idx_duyet_rev ON duyet (revision_id);

-- Record xuất bản tách khỏi trạng thái nội dung: được sinh ≠ đã đăng.
CREATE TABLE xuat_ban (
  id TEXT PRIMARY KEY,
  ban_the_hien_id TEXT NOT NULL REFERENCES ban_the_hien(id),
  revision_id TEXT NOT NULL,
  dich_den TEXT NOT NULL DEFAULT '',
  ghi_chu TEXT NOT NULL DEFAULT '',
  tao_luc TEXT NOT NULL,
  tao_boi TEXT NOT NULL
);
CREATE INDEX idx_xuat_ban_bth ON xuat_ban (ban_the_hien_id, tao_luc);
CREATE INDEX idx_xuat_ban_rev ON xuat_ban (revision_id);

-- Log sự kiện mutation nhẹ, append-only, kèm actor local. #16 gắn authz sau.
CREATE TABLE su_kien (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_loai TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  su_kien TEXT NOT NULL,
  du_lieu TEXT NOT NULL DEFAULT '{}',
  actor TEXT NOT NULL,
  tao_luc TEXT NOT NULL
);
CREATE INDEX idx_su_kien_entity ON su_kien (entity_loai, entity_id, id);
