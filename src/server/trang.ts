import type { Database } from "bun:sqlite";
import {
  danhSachXuatBan,
  layBanTheHien,
  layRevision,
  layThongDiep,
} from "../modules/content/index.ts";
import { layDinhDang } from "../modules/formats/index.ts";
import { renderHtml } from "../modules/formats/render.ts";
import { docHtmlDayDu } from "../modules/formats/xuat.ts";
import { escHtml, huyDangKyTheoToken } from "../modules/kenh/index.ts";

// Trang cơ bản do MAI tự phục vụ (#6): GET /p/<ban_the_hien_id> → render
// đúng revision đã ghim trong record xuat_ban mới nhất của bản đó — chỉ
// nội dung đã duyệt + đã xuất mới thành trang; sửa nháp sau đó không đổi
// trang cho tới khi xuất một record mới. Không nằm dưới /api/ — đây là
// URL đọc được người dùng mở thẳng trong trình duyệt local.
export function phucVuTrang(db: Database, pathname: string): Response | null {
  const m = /^\/p\/([a-z0-9-]{8,})$/i.exec(pathname);
  if (!m) return null;
  const bth = layBanTheHien(db, m[1]!);
  const xb = bth ? danhSachXuatBan(db, bth.id)[0] : null;
  const revision = xb ? layRevision(db, xb.revision_id) : null;
  const def = bth ? layDinhDang(bth.dinh_dang) : null;
  if (!bth || !xb || !revision || !def) {
    return Response.json(
      {
        ok: false,
        loi: {
          ma: "KHONG_TIM_THAY",
          thong_diep: "Không có trang: bản thể hiện không tồn tại hoặc chưa từng xuất bản.",
          chi_tiet: null,
        },
      },
      { status: 404 },
    );
  }
  const td = layThongDiep(db, bth.thong_diep_id);
  // Footer nguồn gốc: nhãn định dạng (vd "Script video ngắn" — gắn nhãn
  // là script) + số revision đã ghim. def.nhan/tao_luc là dữ liệu server.
  const footer = [
    "<hr/>",
    `<p><small>Trang do MAI phục vụ — ${def.nhan} · revision #${revision.so_thu_tu} · đã xuất ${xb.tao_luc.slice(0, 10)}</small></p>`,
  ].join("\n");
  const html = docHtmlDayDu(
    def,
    `${renderHtml(def, revision.noi_dung)}\n${footer}`,
    td?.tieu_de ?? "",
  );
  return new Response(html, {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

// Link hủy đăng ký một chạm trong email (#13): GET /huy-dang-ky?token=<t>.
// Token là bí mật theo người nhận (không liệt kê được). Sai token → 404;
// đúng token → suppression vĩnh viễn, kênh email không gửi tới nữa.
export function phucVuHuyDangKy(db: Database, token: string | null): Response {
  const ketQua = token ? huyDangKyTheoToken(db, token) : null;
  if (!ketQua) {
    return new Response(
      "<!doctype html><html><body><p>Link hủy đăng ký không hợp lệ hoặc đã hết hạn.</p></body></html>",
      { status: 404, headers: { "content-type": "text/html; charset=utf-8" } },
    );
  }
  // Email là input người dùng qua API — escape trước khi chèn vào HTML.
  const email = escHtml(ketQua.email);
  const thongDiep = ketQua.da_huy
    ? `Đã hủy đăng ký cho ${email}. Bạn sẽ không nhận email nữa.`
    : `${email} đã hủy đăng ký trước đó.`;
  return new Response(
    `<!doctype html><html><body><p>${thongDiep}</p></body></html>`,
    { headers: { "content-type": "text/html; charset=utf-8" } },
  );
}
