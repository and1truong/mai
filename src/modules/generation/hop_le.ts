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

  // Bản phát hành (#9): giới hạn phải hiển thị trên đầu ra bị ảnh hưởng;
  // fact chưa xác nhận không được trình bày như sự thật; marker bằng chứng
  // phải trỏ fact/giới hạn có trong context — không bịa nguồn.
  const ph = ctx.phat_hanh;
  if (ph) {
    const dauRa = kq.noi_dung.toLowerCase();
    for (const g of ph.gioi_han) {
      if (!g.tinh_nang || !g.mo_ta) continue;
      if (
        dauRa.includes(g.tinh_nang.toLowerCase()) &&
        !dauRa.includes(g.mo_ta.toLowerCase())
      ) {
        canhBao.push(
          `Giới hạn '${g.mo_ta}' của '${g.tinh_nang}' chưa hiển thị trên đầu ra dù tính năng được nhắc.`,
        );
      }
    }
    for (const f of ph.ds_fact) {
      if (f.xac_nhan || !f.tinh_nang) continue;
      const dongNham = kq.noi_dung
        .split(/\n/)
        .some(
          (dong) =>
            dong.toLowerCase().includes(f.tinh_nang.toLowerCase()) &&
            !/câu\s*hỏi/i.test(dong),
        );
      if (dongNham) {
        canhBao.push(
          `Fact '${f.tinh_nang}' chưa có bằng chứng nguồn — đầu ra đang nhắc nó ngoài câu hỏi, cần xác nhận trước khi công bố.`,
        );
      }
    }
    const idFact = new Set(ph.ds_fact.map((f) => f.id));
    const idGh = new Set(ph.gioi_han.map((g) => g.id));
    for (const m of kq.noi_dung.matchAll(/\[F:([a-z0-9_-]+)\]/gi)) {
      if (!idFact.has(m[1]!)) canhBao.push(`Đầu ra tham chiếu fact '${m[1]}' không có trong bản phát hành.`);
    }
    for (const m of kq.noi_dung.matchAll(/\[GH:([a-z0-9_-]+)\]/gi)) {
      if (!idGh.has(m[1]!)) canhBao.push(`Đầu ra tham chiếu giới hạn '${m[1]}' không có trong bản phát hành.`);
    }
  }

  return { hop_le: loiCung.length === 0, loi_cung: loiCung, canh_bao: canhBao };
}
