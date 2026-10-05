-- Story #9 (Phần mềm B2B): campaign mở rộng thành bản phát hành.
-- Một campaign phát hành = một phiên bản sản phẩm được truyền thông hóa
-- theo đối tượng: phiên bản, ngày phát hành (tái dùng cột số báo), định
-- vị đã duyệt, giới hạn gói/vùng/khả dụng, link CTA sửa được và danh
-- sách fact tính năng có bằng chứng.
--
-- loai: '' = campaign thường, 'so_bao' = số báo (#8), 'phat_hanh' =
-- bản phát hành (#9). Backfill 'so_bao' cho campaign đã có so_thu_tu.
-- gioi_han JSON: [{ id, tinh_nang, loai, mo_ta }]
--   - tinh_nang: tên tính năng bị giới hạn (vd "Passkeys").
--   - loai: 'goi' | 'vung' | 'kha_dung' | '' — nhóm giới hạn.
--   - mo_ta: câu phải hiển thị trên đầu ra bị ảnh hưởng (vd "Chỉ gói
--     Enterprise").
-- cta JSON: [{ id, nhan, loai, url }]
--   - loai: 'tai_lieu' | 'nang_cap' | 'ho_tro' | '' — trỏ đúng trang
--     docs, nâng cấp hay hỗ trợ.
-- ds_fact JSON: [{ id, tinh_nang, noi_dung, nguon_id, muc_id }]
--   - nguon_id/muc_id trỏ về mục nguồn đã nạp làm bằng chứng; null =
--     fact chưa xác nhận → bộ sinh để [CÂU HỎI], không trình bày như
--     sự thật.
-- nguon_phat_hanh_id: nguon loại 'fact' do module phát hành tự chiếu
--   từ field release — chủ đề thông điệp link nó để mọi đầu ra pin
--   fact, và sửa field release sinh revision nguồn mới → phát hiện
--   thay đổi đánh dấu đầu ra phụ thuộc (#14).
ALTER TABLE campaign ADD COLUMN loai TEXT NOT NULL DEFAULT '';
ALTER TABLE campaign ADD COLUMN phien_ban TEXT NOT NULL DEFAULT '';
ALTER TABLE campaign ADD COLUMN dinh_vi TEXT NOT NULL DEFAULT '';
ALTER TABLE campaign ADD COLUMN gioi_han TEXT NOT NULL DEFAULT '[]';
ALTER TABLE campaign ADD COLUMN cta TEXT NOT NULL DEFAULT '[]';
ALTER TABLE campaign ADD COLUMN ds_fact TEXT NOT NULL DEFAULT '[]';
ALTER TABLE campaign ADD COLUMN nguon_phat_hanh_id TEXT NOT NULL DEFAULT '';
UPDATE campaign SET loai = 'so_bao' WHERE loai = '' AND so_thu_tu IS NOT NULL;
