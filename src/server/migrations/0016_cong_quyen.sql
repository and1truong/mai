-- Story #11 (Cơ quan công quyền): campaign mở rộng thành chiến dịch
-- giải thích chính sách. Một cơ quan công bố luật mới (vd phân loại
-- rác) và phải giải thích cho nhiều đối tượng khác nhau, rồi quản lý
-- sửa đổi chính sách.
--
-- loai: 'cong_quyen' thêm vào danh mục ('', 'so_bao', 'phat_hanh',
--   'gay_quy').
-- pham_vi_quyen_han: phạm vi quyền hạn của chính sách (địa giới +
--   nhóm đối tượng áp dụng) — đơn giản hóa/dịch phải giữ nguyên.
-- ngay_hieu_luc: ngày chính sách có hiệu lực, ISO "YYYY-MM-DD" — mọi
--   đầu ra nhắc ngày hiệu lực phải khớp revision chính sách đã ghim.
-- ds_yeu_cau JSON: [{ id, noi_dung, loai, doi_tuong_ap_dung, nguon_id, muc_id }]
--   - loai: 'bat_buoc' | 'giai_thich' — yêu cầu bắt buộc phân biệt
--     với ngôn ngữ giải thích; giải thích trình bày như nghĩa vụ là
--     cảnh báo review.
--   - doi_tuong_ap_dung: nhóm đối tượng chịu yêu cầu ('' = chung).
--   - nguon_id/muc_id trỏ mục nguồn chính sách làm bằng chứng; null =
--     chưa xác nhận → bộ sinh để [CÂU HỎI], không bịa luật.
-- ds_ngoai_le JSON: [{ id, noi_dung, yeu_cau_id, nguon_id, muc_id }]
--   - yeu_cau_id liên kết ngoại lệ về yêu cầu nó sửa; ngoại lệ phải
--     sống qua đơn giản hóa/dịch — nhắc yêu cầu mà bỏ ngoại lệ là
--     cảnh báo review.
-- ds_fact_van_hanh JSON: [{ id, tieu_de, noi_dung, nguon_id, muc_id }]
--   - Fact vận hành hỗ trợ (lịch thu gom, điểm thu, hotline) — fact
--     chính sách đã duyệt là ràng buộc.
-- ds_nguoi_duyet JSON: [{ id, ten, vai_tro }] — reviewer local được
--   ghi trong POC; duyet.nguoi_duyet_id ghi ai trong danh sách đã chấm.
-- che_do_bao_ve: 1 = chế độ bảo vệ — duyệt bắt buộc ghi đúng reviewer;
--   móc nối tới quyền tài khoản thật của #16 (tùy chọn trong POC).
-- nguon_chinh_sach_id: nguồn văn bản chính sách chính thức đã nạp —
--   claim yêu cầu/ngày liên kết đúng revision của nó qua provenance.
-- nguon_cong_quyen_id: nguồn fact tự động chiếu từ field campaign —
--   đổi field (vd ngày hiệu lực) sinh revision nguồn mới → phát hiện
--   thay đổi đánh dấu đầu ra phụ thuộc (#14).
-- duyet.nguoi_duyet_id: reviewer được ghi tại lần duyệt (POC); rỗng
--   khi duyệt không kèm reviewer.
ALTER TABLE campaign ADD COLUMN pham_vi_quyen_han TEXT NOT NULL DEFAULT '';
ALTER TABLE campaign ADD COLUMN ngay_hieu_luc TEXT NOT NULL DEFAULT '';
ALTER TABLE campaign ADD COLUMN ds_yeu_cau TEXT NOT NULL DEFAULT '[]';
ALTER TABLE campaign ADD COLUMN ds_ngoai_le TEXT NOT NULL DEFAULT '[]';
ALTER TABLE campaign ADD COLUMN ds_fact_van_hanh TEXT NOT NULL DEFAULT '[]';
ALTER TABLE campaign ADD COLUMN ds_nguoi_duyet TEXT NOT NULL DEFAULT '[]';
ALTER TABLE campaign ADD COLUMN che_do_bao_ve INTEGER NOT NULL DEFAULT 0;
ALTER TABLE campaign ADD COLUMN nguon_chinh_sach_id TEXT NOT NULL DEFAULT '';
ALTER TABLE campaign ADD COLUMN nguon_cong_quyen_id TEXT NOT NULL DEFAULT '';
ALTER TABLE duyet ADD COLUMN nguoi_duyet_id TEXT NOT NULL DEFAULT '';
