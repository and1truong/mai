// Adapter fixture cho contract nạp đơn hàng (#64): đọc danh sách đơn mẫu
// từ seed-assets/don-hang-mau.json rồi gọi napDonHang — cùng đường đi của
// adapter hệ thống thật (Shopify/Woo) về sau. Idempotent theo contract
// (khoa_idem dự phòng he_thong:don_hang_ngoai_id): seed chạy lại nhiều
// lần không nhân person/event/conversion.
import type { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { napDonHang, type NhapDonHang } from "./index.ts";

export const TEP_DON_HANG_MAU = join(
  import.meta.dir,
  "../../server/seed-assets/don-hang-mau.json",
);

export function docDonHangMau(duongDan = TEP_DON_HANG_MAU): NhapDonHang[] {
  return JSON.parse(readFileSync(duongDan, "utf8")) as NhapDonHang[];
}

export function napDonHangMau(
  db: Database,
  actor: string,
  duongDan = TEP_DON_HANG_MAU,
): { so_don: number; so_don_moi: number } {
  const ds = docDonHangMau(duongDan);
  let soMoi = 0;
  for (const don of ds) {
    const kq = napDonHang(db, don, actor);
    if (kq.da_tao) soMoi++;
  }
  return { so_don: ds.length, so_don_moi: soMoi };
}
