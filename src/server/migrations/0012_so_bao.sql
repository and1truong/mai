-- Story #8 (Nhà xuất bản): campaign mở rộng thành số báo (issue).
-- Một campaign số báo = một số tạp chí: số thứ tự, ngày phát hành, chủ đề,
-- lập trường biên tập, chủ biên, hồ sơ style/đối tượng dùng lại, tham chiếu
-- được cung cấp (JSON ThamChieu[]) và mục lục đề xuất sửa được (JSON MucLuc[]).
-- Cột mới đều tùy chọn/mặc định — campaign thường (không phải số báo) vẫn dùng được.
--
-- tham_chieu JSON: [{ id, tham_chieu, ban_dich, nguon_id, ghi_chu }]
--   - tham_chieu: tên đoạn tham chiếu người dùng khai báo (vd "Khải Huyền 7").
--   - ban_dich: bản dịch đã chọn, ghi rõ để trích dẫn kiểm được.
--   - nguon_id: nguon chứa văn bản tham chiếu đã nạp; null = chưa có văn bản
--     (bị gắn cờ thiếu nguồn, không cho bộ sinh bịa trích dẫn).
-- muc_luc JSON: [{ id, tieu_de, dinh_dang, doi_tuong_id, dich_den, ly_do }]
--   Mục lục đề xuất của số — biên tập sửa và chọn mục nào cần nháp;
--   không tự động sinh mọi mục.
ALTER TABLE campaign ADD COLUMN so_thu_tu INTEGER;
ALTER TABLE campaign ADD COLUMN ngay_phat_hanh TEXT NOT NULL DEFAULT '';
ALTER TABLE campaign ADD COLUMN chu_de TEXT NOT NULL DEFAULT '';
ALTER TABLE campaign ADD COLUMN lap_truong TEXT NOT NULL DEFAULT '';
ALTER TABLE campaign ADD COLUMN chu_bien TEXT NOT NULL DEFAULT '';
ALTER TABLE campaign ADD COLUMN thuong_hieu_id TEXT;
ALTER TABLE campaign ADD COLUMN doi_tuong_id TEXT;
ALTER TABLE campaign ADD COLUMN tham_chieu TEXT NOT NULL DEFAULT '[]';
ALTER TABLE campaign ADD COLUMN muc_luc TEXT NOT NULL DEFAULT '[]';
