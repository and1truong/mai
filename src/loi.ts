// Lỗi API và validation dùng chung cho toàn bộ server.
// Convention envelope: { ok: false, loi: { ma, thong_diep, chi_tiet } }.

export class LoiApi extends Error {
  constructor(
    public status: number,
    public ma: string,
    message: string,
    public chiTiet?: unknown,
  ) {
    super(message);
    this.name = "LoiApi";
  }
}

export function loiRequest(status: number, ma: string, thongDiep: string, chiTiet?: unknown): never {
  throw new LoiApi(status, ma, thongDiep, chiTiet);
}

// Bắt buộc một chuỗi không rỗng. Gom lỗi vào dsLoi để trả nhiều lỗi trong một response.
export function batBuocChuoi(v: unknown, ten: string, dsLoi: string[]): string {
  if (typeof v !== "string" || v.trim() === "") {
    dsLoi.push(`${ten} là bắt buộc.`);
    return "";
  }
  return v.trim();
}

export function tuyChonChuoi(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

export function nemLoiValidation(dsLoi: string[]): void {
  if (dsLoi.length > 0) {
    loiRequest(400, "VALIDATION", "Dữ liệu không hợp lệ.", dsLoi);
  }
}
