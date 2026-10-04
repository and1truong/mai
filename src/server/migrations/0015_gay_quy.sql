-- Story #10 (Nonprofit): campaign mở rộng thành chiến dịch gây quỹ.
-- Một campaign gây quỹ = một mục tiêu truyền thông (không phải một bài
-- viết): mục tiêu + số tiền kèm đơn vị tiền tệ, thông điệp lõi, danh
-- sách tác động đã đạt/ước tính có con trỏ bằng chứng, trích dẫn được
-- phép dùng, CTA quyên góp trỏ đích ngoài, ghi chú quyền/đồng ý cho
-- asset do tổ chức cung cấp, và ngôn ngữ thứ hai khi được chọn.
--
-- loai: 'gay_quy' thêm vào danh mục ('', 'so_bao', 'phat_hanh').
-- muc_tieu: mô tả mục tiêu gây quỹ tương lai — khác biệt với tác động
--   đã đạt/ước tính trong ds_tac_dong.
-- so_tien_muc_tieu + tien_te: tổng tiền mục tiêu luôn đi kèm đơn vị
--   tiền tệ (vd 1200000000 + 'VND'); NULL so_tien = chưa đặt.
-- thong_diep_loi: thông điệp lõi đã duyệt — đi vào context sinh giống
--   dinh_vi của bản phát hành.
-- ngon_ngu_phu: mã ngôn ngữ bản dịch thứ hai khi được chọn (vd 'en');
--   rỗng = chỉ một ngôn ngữ.
-- ds_tac_dong JSON: [{ id, tieu_de, noi_dung, trang_thai, so_lieu,
--   don_vi, nguon_id, muc_id }]
--   - trang_thai: 'da_dat' | 'uoc_tinh' — tác động đã đạt được phân biệt
--     với ước tính; ước tính trình bày như đã đạt là cảnh báo review.
--   - so_lieu/don_vi: định lượng khai báo (vd '1.240' + 'người') — bản
--     dịch phải giữ nguyên.
--   - nguon_id/muc_id trỏ mục nguồn đã nạp làm bằng chứng; null = chưa
--     xác nhận → bộ sinh để [CÂU HỎI], không trình bày như sự thật.
-- ds_trich_dan JSON: [{ id, ten_nguoi, loi, nguon_id, muc_id }]
--   - Trích dẫn/lời chứng thực được phép dùng, kèm nguồn tư liệu; đầu
--     ra trích lời không khớp danh sách/nguồn này là cảnh báo "bịa".
-- ghi_chu_quyen JSON: [{ id, asset_id, ghi_chu }]
--   - Ghi chú quyền/đồng ý sử dụng cho asset do tổ chức cung cấp;
--     hiển thị khi review đầu ra đính kèm asset đó.
-- nguon_gay_quy_id: nguon loại 'fact' do module gây quỹ tự chiếu từ
--   field campaign — chủ đề thông điệp link nó để mọi đầu ra pin fact,
--   và sửa field sinh revision nguồn mới → phát hiện thay đổi đánh dấu
--   đầu ra phụ thuộc (#14).
ALTER TABLE campaign ADD COLUMN muc_tieu TEXT NOT NULL DEFAULT '';
ALTER TABLE campaign ADD COLUMN so_tien_muc_tieu REAL;
ALTER TABLE campaign ADD COLUMN tien_te TEXT NOT NULL DEFAULT '';
ALTER TABLE campaign ADD COLUMN thong_diep_loi TEXT NOT NULL DEFAULT '';
ALTER TABLE campaign ADD COLUMN ngon_ngu_phu TEXT NOT NULL DEFAULT '';
ALTER TABLE campaign ADD COLUMN ds_tac_dong TEXT NOT NULL DEFAULT '[]';
ALTER TABLE campaign ADD COLUMN ds_trich_dan TEXT NOT NULL DEFAULT '[]';
ALTER TABLE campaign ADD COLUMN ghi_chu_quyen TEXT NOT NULL DEFAULT '[]';
ALTER TABLE campaign ADD COLUMN nguon_gay_quy_id TEXT NOT NULL DEFAULT '';
