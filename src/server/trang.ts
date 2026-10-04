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
