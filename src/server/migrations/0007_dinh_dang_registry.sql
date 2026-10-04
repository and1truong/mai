-- #19: registry định dạng có phiên bản thay id cũ.
-- 'web' -> 'bai-viet' (định dạng bài viết mặc định),
-- 'mang-xa-hoi' -> 'caption' (bài social một đoạn).
-- phien_ban_dinh_dang giữ giá trị đã ghim (= 1, khớp phiên bản registry).

UPDATE ban_the_hien SET dinh_dang = 'bai-viet' WHERE dinh_dang = 'web';
UPDATE ban_the_hien SET dinh_dang = 'caption' WHERE dinh_dang = 'mang-xa-hoi';
