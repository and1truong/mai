-- Lifecycle + giải thích (#59, ticket #65).
--
-- trang_thai_doi: khach_vang_lai → dang_ky → khach_mua → khach_quen →
-- ngu_dong. Cập nhật deterministic trong cùng transaction khi ghi
-- tuong_tac / dong_y / chuyen_doi — transitions luôn phát sinh từ
-- source events, không sửa tay.
-- giai_thich_doi: JSON giải thích vì sao person ở state đó (số đơn,
-- consent, event cuối, ngưỡng ngủ đông) — audit được.
ALTER TABLE khach ADD COLUMN trang_thai_doi TEXT NOT NULL DEFAULT 'khach_vang_lai';
ALTER TABLE khach ADD COLUMN giai_thich_doi TEXT NOT NULL DEFAULT '{}';
