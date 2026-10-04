import type { Database } from "bun:sqlite";
import { loiRequest } from "../../loi.ts";
import {
  layBanTheHien,
  layNguonRevision,
  layThongDiep,
  layThongDiepRevision,
  type BanTheHien,
} from "../content/index.ts";
import type { ContextSinhSnapshot } from "../context/index.ts";
import { layDinhDang } from "../formats/index.ts";
import type { ContextTask, NguonContext } from "./index.ts";
import type { TaskDinhNghia } from "./task.ts";

// Bộ dựng context cho một lần sinh (#20): chọn đúng revision thông điệp
// head → revision nguồn đã ghim trong chuỗi, ép giới hạn đầu vào và chỉ ra
// chứng cứ còn thiếu. Mọi phần đưa vào đều được ghi lại trong chính object
// (ds_nguon.revision_id) để provenance/trích dẫn resolve về đúng bản đã dùng.

export type GioiHanContext = {
  toi_da_ky_tu_nguon: number;
  toi_da_ky_tu_context: number;
  toi_da_ky_tu_dau_ra: number;
};

export const MAC_DINH_GIOI_HAN_CONTEXT: GioiHanContext = {
  toi_da_ky_tu_nguon: 4_000,
  toi_da_ky_tu_context: 16_000,
  toi_da_ky_tu_dau_ra: 12_000,
};

// Cắt gọn một văn bản ở ranh đoạn/câu gần trần; đánh dấu [...] khi bị cắt.
export function catGon(vanBan: string, toiDa: number): { text: string; daCat: boolean } {
  if (vanBan.length <= toiDa) return { text: vanBan, daCat: false };
  const dat = vanBan.slice(0, toiDa);
  const ranh = Math.max(dat.lastIndexOf("\n\n"), dat.lastIndexOf(". "), dat.lastIndexOf("\n"));
  // Chỉ cắt theo ranh khi không mất quá nửa phần cho phép.
  const dung = ranh > toiDa * 0.5 ? dat.slice(0, ranh) : dat;
  return { text: dung.trimEnd() + "\n[...]", daCat: true };
}

// Chứng cứ còn thiếu trong input — heuristic deterministic, không phải suy
// đoán AI: provider dùng danh sách này để để câu hỏi/khoảng trống thay vì bịa
// giá/ngày/số liệu tác động.
export function thieuChungCu(vanBanNguon: string): string[] {
  const ds: string[] = [];
  if (!/\d/.test(vanBanNguon)) ds.push("so_lieu");
  if (!/ngày|tháng|năm|tuần|quý|\b(19|20)\d{2}\b/i.test(vanBanNguon)) ds.push("moc_thoi_gian");
  if (!/giá|cước phí|miễn phí|khuyến mãi|đồng|vnđ|usd|\d[\d.,]*\s*(đ|₫|\$)/i.test(vanBanNguon)) ds.push("gia_ca");
  return ds;
}

export function lapContextNoiDung(
  db: Database,
  input: {
    bth: BanTheHien;
    task: TaskDinhNghia;
    context_sinh: ContextSinhSnapshot | null;
    doi_tuong: string;
    gioi_han?: Partial<GioiHanContext>;
  },
): ContextTask {
  const gioiHan: GioiHanContext = { ...MAC_DINH_GIOI_HAN_CONTEXT, ...input.gioi_han };
  const bth = layBanTheHien(db, input.bth.id);
  if (!bth) loiRequest(404, "KHONG_TIM_THAY", "Không tìm thấy bản thể hiện.");
  const thongDiep = layThongDiep(db, bth.thong_diep_id);
  if (!thongDiep) loiRequest(404, "KHONG_TIM_THAY", "Không tìm thấy thông điệp.");
  const tdRev = thongDiep.head_revision_id
    ? layThongDiepRevision(db, thongDiep.head_revision_id)
    : null;

  // Chuỗi ghim: revision thông điệp đã ghim sẵn revision nguồn đã dùng —
  // resolve đúng phiên bản, giữ thứ tự khai báo.
  const ds_nguon: NguonContext[] = [];
  let tongKyTu = 0;
  for (const id of tdRev?.nguon_revision_ids ?? []) {
    const n = layNguonRevision(db, id);
    if (!n) continue;
    if (tongKyTu >= gioiHan.toi_da_ky_tu_context) break;
    const toiDa = Math.min(gioiHan.toi_da_ky_tu_nguon, gioiHan.toi_da_ky_tu_context - tongKyTu);
    const { text, daCat } = catGon(n.noi_dung, toiDa);
    tongKyTu += text.length;
    ds_nguon.push({
      revision_id: n.id,
      nguon_id: n.nguon_id,
      so_thu_tu: n.so_thu_tu,
      tieu_de: n.tieu_de,
      noi_dung: text,
      da_cat_gon: daCat,
    });
  }

  const vanBanNguon = [
    tdRev?.tieu_de ?? thongDiep.tieu_de,
    tdRev?.noi_dung ?? thongDiep.noi_dung,
    ...ds_nguon.map((n) => n.noi_dung),
  ].join("\n");

  return {
    task: input.task,
    thong_diep: {
      tieu_de: tdRev?.tieu_de ?? thongDiep.tieu_de,
      noi_dung: tdRev?.noi_dung ?? thongDiep.noi_dung,
      revision_id: tdRev?.id ?? null,
    },
    ds_nguon,
    dinh_dang: layDinhDang(bth.dinh_dang),
    doi_tuong: input.doi_tuong,
    ngon_ngu: bth.ngon_ngu,
    context_sinh: input.context_sinh,
    thieu_chung_cu: thieuChungCu(vanBanNguon),
    gioi_han_dau_ra: gioiHan.toi_da_ky_tu_dau_ra,
  };
}
