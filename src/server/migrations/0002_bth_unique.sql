-- Một (nguồn, định dạng) chỉ có một bản thể hiện.
-- Chặn tạo trùng khi hai job sinh cùng lúc hoặc retry.

CREATE UNIQUE INDEX IF NOT EXISTS uq_bth_nguon_dinhdang
  ON ban_the_hien (nguon_id, dinh_dang);
