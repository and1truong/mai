import { kiemTraNoiDung } from "../formats/index.ts";
import type { ContextTask, KetQuaTask } from "./index.ts";

// Kiểm chứng đầu ra sinh (#20). Hai mức:
// - loi_cung: schema định dạng vi phạm hoặc claim bị cấm → repair có biên
//   rồi fail vĩnh viễn. Schema hợp lệ một mình KHÔNG chứng minh đúng sự thật.
// - canh_bao: trích dẫn không resolve tới nguồn đã đưa vào, thuật ngữ giữ
//   nguyên bị bỏ sót → đưa ra review thay vì chặn.
export type KetQuaKiemTra = {
  hop_le: boolean;
  loi_cung: string[];
  canh_bao: string[];
};

export function kiemTraDauRa(ctx: ContextTask, kq: KetQuaTask): KetQuaKiemTra {
  const loiCung: string[] = [];
  const canhBao: string[] = [...kq.canh_bao];

  // Schema định dạng — lỗi cứng vì đầu ra không lưu được dạng canonical.
  if (ctx.dinh_dang) {
    for (const l of kiemTraNoiDung(ctx.dinh_dang, kq.noi_dung)) {
      // Nội dung không-JSON fallback '_tho' cũng là vi phạm: provider phải
      // trả canonical JSON theo schema.
      loiCung.push(`${l.truong}: ${l.loi}`);
    }
  }

  // Claim bị cấm của thương hiệu: lỗi biên tập nghiêm → lỗi cứng.
  for (const c of ctx.context_sinh?.thuong_hieu?.claim_cam ?? []) {
    if (c && kq.noi_dung.includes(c)) {
      loiCung.push(`Đầu ra chứa claim bị cấm: "${c.slice(0, 80)}".`);
    }
  }

  // Trích dẫn chỉ hợp lệ khi resolve tới revision nguồn ĐÃ đưa vào context —
  // id bịa hay trỏ nguồn ngoài context → cảnh báo review, không phải "đúng".
  const nguonDaDua = new Set(ctx.ds_nguon.map((n) => n.revision_id));
  const bia = new Set<string>();
  for (const t of kq.trich_dan) {
    if (!nguonDaDua.has(t.nguon_revision_id)) bia.add(t.nguon_revision_id);
  }
  if (bia.size > 0) {
    canhBao.push(`Trích dẫn không khớp nguồn đã đưa vào context: ${[...bia].join(", ")}.`);
  }

  // Thuật ngữ giữ nguyên: chỉ cảnh báo khi từ có trong input mà đầu ra bỏ —
  // không yêu cầu xuất hiện bất kể ngữ cảnh.
  const vanBanDauVao = [ctx.thong_diep.noi_dung, ...ctx.ds_nguon.map((n) => n.noi_dung)].join("\n");
  for (const t of ctx.context_sinh?.thuong_hieu?.thuat_ngu ?? []) {
    if (t.giu_nguyen && t.thuat_ngu && vanBanDauVao.includes(t.thuat_ngu) && !kq.noi_dung.includes(t.thuat_ngu)) {
      canhBao.push(`Thuật ngữ giữ nguyên '${t.thuat_ngu}' có trong nguồn nhưng không có trong đầu ra.`);
    }
  }

  return { hop_le: loiCung.length === 0, loi_cung: loiCung, canh_bao: canhBao };
}
