// Tạo tài khoản cho một instance MAI (#16): chạy một lần để tạo quản trị
// đầu tiên của bản cài, chạy lại để thêm biên tập. Mật khẩu qua flag
// --mat-khau, env MAI_MAT_KHAU, hoặc hỏi tương tác — không commit vào đâu.
//
//   bun scripts/tao-tai-khoan.ts --ten-dang-nhap admin --mat-khau '...' \
//     --ten-hien-thi 'Quản trị' --vai-tro quan_tri

import { taiCauHinh } from "../src/config.ts";
import { moDb, chayMigration } from "../src/server/db.ts";
import {
  DANH_SACH_VAI_TRO,
  layTaiKhoanTheoTen,
  taoTaiKhoan,
  type VaiTro,
} from "../src/modules/xac_thuc/index.ts";

function docFlag(ten: string): string {
  const i = process.argv.indexOf(`--${ten}`);
  return i >= 0 ? (process.argv[i + 1] ?? "") : "";
}

const tenDangNhap = docFlag("ten-dang-nhap");
if (!tenDangNhap) {
  console.error(
    "Thiếu --ten-dang-nhap. Dùng: bun scripts/tao-tai-khoan.ts --ten-dang-nhap <tên> [--mat-khau <mk>] [--ten-hien-thi <tên hiển thị>] [--vai-tro quan_tri|bien_tap]",
  );
  process.exit(1);
}

const vaiTroRaw = docFlag("vai-tro") || "quan_tri";
if (!(DANH_SACH_VAI_TRO as readonly string[]).includes(vaiTroRaw)) {
  console.error(`--vai-tro không hợp lệ: ${vaiTroRaw}. Cho phép: ${DANH_SACH_VAI_TRO.join(", ")}.`);
  process.exit(1);
}

let matKhau = docFlag("mat-khau") || process.env.MAI_MAT_KHAU || "";
if (!matKhau) {
  matKhau = prompt("Mật khẩu cho tài khoản mới (tối thiểu 8 ký tự):") ?? "";
}
if (matKhau.length < 8) {
  console.error("Mật khẩu tối thiểu 8 ký tự.");
  process.exit(1);
}

const cauHinh = await taiCauHinh();
const db = moDb(cauHinh.dataDir);
chayMigration(db);

if (layTaiKhoanTheoTen(db, tenDangNhap)) {
  console.error(`Tên đăng nhập '${tenDangNhap}' đã tồn tại trong instance này.`);
  db.close();
  process.exit(1);
}

const tk = await taoTaiKhoan(
  db,
  {
    ten_dang_nhap: tenDangNhap,
    ten_hien_thi: docFlag("ten-hien-thi") || tenDangNhap,
    vai_tro: vaiTroRaw as VaiTro,
    mat_khau: matKhau,
  },
  "setup",
);

console.log(
  JSON.stringify({
    ok: true,
    tai_khoan: {
      id: tk.id,
      ten_dang_nhap: tk.ten_dang_nhap,
      vai_tro: tk.vai_tro,
    },
  }),
);

if (cauHinh.bao_mat.che_do !== "bao_ve") {
  console.error(
    "Ghi chú: instance đang chế độ tin_cay — tài khoản có tác dụng khi đặt bao_mat.che_do='bao_ve' (hoặc MAI_BAO_MAT_CHE_DO=bao_ve) rồi chạy lại server.",
  );
}
db.close();
