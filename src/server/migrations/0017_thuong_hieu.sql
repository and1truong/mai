-- Story #12 (Thương hiệu toàn cầu): campaign mở rộng thành chiến dịch
-- thương hiệu đa thị trường — claim sản phẩm đã duyệt dùng chung, fact
-- cấp campaign và ghi đè tường minh theo thị trường.
--
-- loai: 'thuong_hieu' thêm vào danh mục ('', 'so_bao', 'phat_hanh',
--   'gay_quy', 'cong_quyen').
-- ds_claim JSON: [{ id, noi_dung, nguon_id, muc_id }]
--   - Claim sản phẩm đã duyệt — mọi thị trường dùng chung, giữ nhất quán.
--   - nguon_id/muc_id trỏ mục nguồn đã nạp làm bằng chứng; null = chưa
--     xác nhận → bộ sinh để [CÂU HỎI], không bịa claim hiệu năng/sức khỏe.
-- giong_van: giọng văn thương hiệu đã duyệt — đi vào context sinh.
-- ds_asset_hinh JSON: [{ id, asset_id, ghi_chu }] — asset hình của chiến
--   dịch được phân phối chung cho mọi thị trường.
-- nguon_thuong_hieu_id: nguồn fact tự động chiếu từ field chung — đổi
--   claim/giọng văn/CTA sinh revision nguồn mới → phát hiện #14 vô hiệu
--   hóa mọi biến thể phụ thuộc trên mọi thị trường.
--
-- thi_truong: hàng ghi đè theo thị trường — mọi field là dữ liệu đội
--   local cung cấp tường minh; không tự quy đổi tiền tệ, không bịa yêu
--   cầu địa phương.
--   ma: mã thị trường ngắn duy nhất trong campaign ('us', 'vn').
--   gia/tien_te: giá đã cung cấp + mã tiền tệ đi kèm; rỗng = chưa đủ
--     → chặn đầu ra cần fact đó.
--   kha_dung: 'co_hang' | 'het_hang' | 'dat_truoc' | '' (chưa có).
--   landing_page/cta_nhan/cta_url: landing page local và CTA ghi đè CTA
--     mặc định của chiến dịch.
--   ds_chi_tiet JSON: [{ doi_tuong_id, chi_tiet }] — lời thoại/ưu đãi đã
--     duyệt riêng cho một đối tượng trên thị trường; đầu ra của đối
--     tượng đó phải giữ nguyên văn.
--   ghi_de JSON: { khoa: chuoi } — ghi đè tự do tường minh, liệt kê như
--     ngoại lệ trên ma trận.
--   ds_nguoi_duyet JSON: [{ id, ten, vai_tro }] — reviewer local được
--     ghi; bat_buoc_duyet = 1 bắt buộc ghi reviewer khi duyệt (#16).
--   nguon_id: nguồn fact tự động chiếu từ field thị trường — đổi field
--     local sinh revision nguồn mới → #14 chỉ vô hiệu hóa biến thể của
--     đúng thị trường đó.
--   thong_diep_id: thông điệp riêng của thị trường — link nguồn chung
--     của chiến dịch + nguồn thị trường + nguồn bằng chứng claim; mọi
--     biến thể của thị trường pin thông điệp này.
ALTER TABLE campaign ADD COLUMN ds_claim TEXT NOT NULL DEFAULT '[]';
ALTER TABLE campaign ADD COLUMN giong_van TEXT NOT NULL DEFAULT '';
ALTER TABLE campaign ADD COLUMN ds_asset_hinh TEXT NOT NULL DEFAULT '[]';
ALTER TABLE campaign ADD COLUMN nguon_thuong_hieu_id TEXT NOT NULL DEFAULT '';
CREATE TABLE thi_truong (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL,
  ma TEXT NOT NULL,
  ten TEXT NOT NULL,
  ngon_ngu TEXT NOT NULL DEFAULT 'vi',
  gia TEXT NOT NULL DEFAULT '',
  tien_te TEXT NOT NULL DEFAULT '',
  kha_dung TEXT NOT NULL DEFAULT '',
  landing_page TEXT NOT NULL DEFAULT '',
  cta_nhan TEXT NOT NULL DEFAULT '',
  cta_url TEXT NOT NULL DEFAULT '',
  ds_chi_tiet TEXT NOT NULL DEFAULT '[]',
  ghi_de TEXT NOT NULL DEFAULT '{}',
  ds_nguoi_duyet TEXT NOT NULL DEFAULT '[]',
  bat_buoc_duyet INTEGER NOT NULL DEFAULT 0,
  nguon_id TEXT NOT NULL DEFAULT '',
  thong_diep_id TEXT NOT NULL DEFAULT '',
  tao_luc TEXT NOT NULL,
  tao_boi TEXT NOT NULL,
  cap_nhat_luc TEXT NOT NULL,
  cap_nhat_boi TEXT NOT NULL,
  UNIQUE (campaign_id, ma)
);
CREATE INDEX idx_thi_truong_campaign ON thi_truong (campaign_id);
