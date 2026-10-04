-- Story #7: sự thật đã xác nhận của intake (sự kiện tiệm bánh). JSON object:
-- { ngay_gio, mui_gio, gia, tinh_trang, link_dat_hang } — lịch dự kiến kèm
-- timezone ở ngay_gio + mui_gio; server ghép các fact này vào thông điệp.
ALTER TABLE ke_hoach ADD COLUMN fact TEXT NOT NULL DEFAULT '{}';
