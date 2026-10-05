-- Sự kiện tương tác theo person (#59, ticket #61): event bất biến theo
-- thời gian — xem trang, click link, đăng ký, mở/click mail, mua, hủy
-- đăng ký... Mỗi event có nguồn (provenance bắt buộc), tham chiếu lỏng
-- tới entity MAI (không FK — trang/link/campaign có thể đổi đời sau),
-- khóa idempotency cho ingestion, chi_tiet JSON mở rộng không redesign.
--
-- khoa_idem bắt buộc từ contract POST /api/khach/su-kien: delivery lặp
-- của integration → INSERT OR IGNORE trùng khóa, không nhân event.
-- Bridge visitor (cookie mai_v) tự sinh khóa deterministic theo khung
-- khử trùng — xem file modules/khach.
CREATE TABLE tuong_tac (
  id TEXT PRIMARY KEY,
  khach_id TEXT NOT NULL REFERENCES khach(id),
  loai TEXT NOT NULL,
  nguon TEXT NOT NULL,
  xay_ra_luc TEXT NOT NULL,
  ban_the_hien_id TEXT NOT NULL DEFAULT '',
  campaign_id TEXT NOT NULL DEFAULT '',
  link_dich_id TEXT NOT NULL DEFAULT '',
  giao_hang_id TEXT NOT NULL DEFAULT '',
  don_hang_ngoai_id TEXT NOT NULL DEFAULT '',
  khoa_idem TEXT NOT NULL DEFAULT '',
  chi_tiet TEXT NOT NULL DEFAULT '{}',
  tao_luc TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_tuong_tac_idem ON tuong_tac (khoa_idem)
  WHERE khoa_idem <> '';
CREATE INDEX idx_tuong_tac_khach ON tuong_tac (khach_id, xay_ra_luc, id);
