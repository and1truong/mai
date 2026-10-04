// Module review: vòng đời duyệt của một bản thể hiện.
// nhap → cho_duyet → da_duyet | tu_choi; da_duyet/tu_choi có thể quay về nhap.

export const DANH_SACH_TRANG_THAI = ["nhap", "cho_duyet", "da_duyet", "tu_choi"] as const;

export type TrangThai = (typeof DANH_SACH_TRANG_THAI)[number];

const CHUYEN_HOP_LE: Record<TrangThai, readonly TrangThai[]> = {
  nhap: ["cho_duyet"],
  cho_duyet: ["da_duyet", "tu_choi", "nhap"],
  da_duyet: ["nhap"],
  tu_choi: ["nhap"],
};

export function laTrangThai(v: unknown): v is TrangThai {
  return typeof v === "string" && (DANH_SACH_TRANG_THAI as readonly string[]).includes(v);
}

export function chuyenHopLe(tu: string, den: TrangThai): boolean {
  const ds = CHUYEN_HOP_LE[tu as TrangThai];
  return ds !== undefined && ds.includes(den);
}
