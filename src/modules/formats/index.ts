// Module định dạng/giao hàng: danh sách kênh đầu ra hỗ trợ.
// Logic render/deliver chi tiết đến ở các ticket sau; đây là ranh giới module.

export const DANH_SACH_DINH_DANG = ["web", "newsletter", "mang-xa-hoi"] as const;

export type DinhDang = (typeof DANH_SACH_DINH_DANG)[number];

export function laDinhDang(v: unknown): v is DinhDang {
  return typeof v === "string" && (DANH_SACH_DINH_DANG as readonly string[]).includes(v);
}
