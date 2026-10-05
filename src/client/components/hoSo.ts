// Helper chuyển đổi form ↔ API cho trang Hồ sơ.

// Textarea mỗi dòng một mục → mảng chuỗi.
export function tachDong(v: string): string[] {
  return v
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

// Input "a, b" → ["a", "b"].
export function tachPhay(v: string): string[] {
  return v
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

// Text "en: the Gospel\nes: Evangelio" (mỗi dòng hoặc ; một cặp) → map.
export function docBanDich(v: string): Record<string, string> {
  const ketQua: Record<string, string> = {};
  for (const dong of v.split(/\n|;/)) {
    const m = dong.match(/^\s*([^\s:]+)\s*:\s*(.+)\s*$/);
    if (m) ketQua[m[1]!] = m[2]!.trim();
  }
  return ketQua;
}

export function vietBanDich(m: Record<string, string>): string {
  return Object.entries(m)
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");
}

export const NHAN_NGUON_DU_LIEU: Record<string, string> = {
  nguoi_dung: "Người dùng nhập",
  he_thong: "Hệ thống gợi ý",
};
