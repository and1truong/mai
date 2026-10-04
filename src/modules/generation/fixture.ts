import type { ContextTask, KetQuaTask, NguonContext, TrichDan } from "./index.ts";
import type { DinhNghiaTruong } from "../formats/index.ts";

// Adapter fixture (#20): cùng input → cùng output, không mạng, không ngẫu
// nhiên. Sinh canonical JSON theo schema định dạng + trích dẫn tham chiếu
// đúng revision nguồn đã đưa vào — cùng contract với adapter live nên mọi
// đường kiểm chứng (schema, trích dẫn, usage) đều đi qua đoạn chung đó.

function cauDau(vanBan: string): string {
  return (
    vanBan
      .split(/\n+|(?<=[.!?])\s+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0)[0] ?? ""
  );
}

function trichTatCa(dsNguon: NguonContext[]): TrichDan[] {
  return dsNguon.map((n) => ({
    nguon_revision_id: n.revision_id,
    doan: cauDau(n.noi_dung).slice(0, 80),
  }));
}

// Câu bổ sung chứng cứ thiếu: để câu hỏi tường minh, không bịa số liệu.
function dongThieuChungCu(ctx: ContextTask): string[] {
  const nhan: Record<string, string> = {
    so_lieu: "số liệu cụ thể",
    moc_thoi_gian: "mốc thời gian",
    gia_ca: "thông tin giá",
  };
  return ctx.thieu_chung_cu.map(
    (t) => `[CÂU HỎI: nguồn chưa có ${nhan[t] ?? t} — cần người viết bổ sung.]`,
  );
}

// Cắt có chủ đích: giữ đuôi "…" để output vẫn validate hợp lệ schema khi
// input dài — fixture tự sinh vi phạm thì repair không bao giờ cứu được.
function catChuoi(s: string, toiDa?: number): string {
  if (!toiDa || s.length <= toiDa) return s;
  return `${s.slice(0, toiDa - 1)}…`;
}

// Gán nội dung cho một trường theo kiểu — deterministic từ context.
function noiDungTruong(t: DinhNghiaTruong, ctx: ContextTask): string | string[] {
  const dongMeta = [
    `Đối tượng: ${ctx.context_sinh?.doi_tuong?.ten || ctx.doi_tuong || "chung"}`,
    `Ngôn ngữ: ${ctx.ngon_ngu}`,
  ];
  if (ctx.context_sinh?.thuong_hieu?.ten) {
    dongMeta.push(`Thương hiệu: ${ctx.context_sinh.thuong_hieu.ten}`);
  }
  const dongThieu = dongThieuChungCu(ctx);

  switch (t.loai) {
    case "van_ban": {
      let s: string;
      if (t.ten === "tieu_de") s = ctx.thong_diep.tieu_de;
      else if (t.ten === "tom_tat" || t.ten === "gioi_thieu" || t.ten === "hook") {
        s = cauDau(ctx.thong_diep.noi_dung || ctx.ds_nguon[0]?.noi_dung || ctx.thong_diep.tieu_de);
      } else if (t.ten === "cta") s = `Tìm hiểu thêm: ${ctx.thong_diep.tieu_de}`;
      else if (t.ten === "hashtag") s = `#mai #${ctx.dinh_dang?.id ?? "noi-dung"}`;
      else s = ctx.thong_diep.tieu_de;
      return catChuoi(s, t.do_dai_toi_da);
    }
    case "markdown": {
      const dong: string[] = [];
      if (t.ten !== "noi_dung") dong.push(`## ${t.nhan}`);
      dong.push(cauDau(ctx.thong_diep.noi_dung) || ctx.thong_diep.tieu_de);
      for (const [i, n] of ctx.ds_nguon.entries()) {
        const trich = cauDau(n.noi_dung);
        if (trich) dong.push(`\n${trich} [src${i + 1}]`);
      }
      if (dongThieu.length > 0) dong.push("", ...dongThieu);
      dong.push("", `— ${dongMeta.join(" · ")}`);
      return catChuoi(dong.join("\n"), t.do_dai_toi_da);
    }
    case "danh_sach": {
      // Một mục cho mỗi nguồn (có đánh số để khớp trích dẫn); thiếu nguồn →
      // một mục từ thông điệp. CTA/cảnh gợi ý vẫn là mục văn bản fixture.
      const goc =
        ctx.ds_nguon.length === 0
          ? [cauDau(ctx.thong_diep.noi_dung) || ctx.thong_diep.tieu_de]
          : ctx.ds_nguon.map((n, i) => `${n.tieu_de}: ${cauDau(n.noi_dung)} [src${i + 1}]`);
      const dsMuc = t.so_muc_toi_da ? goc.slice(0, t.so_muc_toi_da) : goc;
      return dsMuc.map((m) => catChuoi(m, t.do_dai_toi_da));
    }
  }
}

function sinhNhapBth(ctx: ContextTask): KetQuaTask {
  const def = ctx.dinh_dang;
  const fields: Record<string, string | string[]> = {};
  for (const t of def?.truong ?? []) {
    fields[t.ten] = noiDungTruong(t, ctx);
  }
  // Trần đầu ra: cắt nội dung markdown quá dài trước khi serialize.
  const json = JSON.stringify(fields);
  let noiDung = json;
  if (json.length > ctx.gioi_han_dau_ra) {
    for (const t of def?.truong ?? []) {
      const v = fields[t.ten];
      if (t.loai === "markdown" && typeof v === "string" && v.length > ctx.gioi_han_dau_ra / 2) {
        fields[t.ten] = `${v.slice(0, Math.floor(ctx.gioi_han_dau_ra / 2))}\n[...]`;
      }
    }
    noiDung = JSON.stringify(fields);
  }
  return { noi_dung: noiDung, trich_dan: trichTatCa(ctx.ds_nguon), canh_bao: [] };
}

export const fixture = {
  ten: "fixture",
  la_fixture: true,
  async sinh(ctx: ContextTask): Promise<KetQuaTask> {
    switch (ctx.task.id) {
      case "nhap_ban_the_hien":
        return sinhNhapBth(ctx);
      case "lap_ke_hoach":
        // Đề xuất đầu ra: bài viết + caption theo đối tượng hiện có.
        return {
          noi_dung: JSON.stringify({
            ds_dau_ra: [
              { dinh_dang: "bai-viet", doi_tuong: ctx.doi_tuong || "chung", ly_do: "kênh sở hữu đầy đủ" },
              { dinh_dang: "caption", doi_tuong: ctx.doi_tuong || "chung", ly_do: "điểm chạm mạng xã hội" },
            ],
          }),
          trich_dan: trichTatCa(ctx.ds_nguon),
          canh_bao: [],
        };
      case "localize":
        // Fixture không dịch thật: giữ nguyên trường, đánh dấu ngôn ngữ đích.
        // Contract noi_dung luôn là canonical JSON như adapter live.
        return {
          noi_dung: JSON.stringify({ noi_dung: ctx.thong_diep.noi_dung }),
          trich_dan: trichTatCa(ctx.ds_nguon),
          canh_bao: [`fixture không dịch thật — trả nguyên văn (đích: ${ctx.ngon_ngu}).`],
        };
      case "de_xuat_revision":
        return {
          noi_dung: JSON.stringify({ noi_dung: ctx.thong_diep.noi_dung }),
          trich_dan: trichTatCa(ctx.ds_nguon),
          canh_bao: ["fixture giữ nguyên nội dung gốc — đề xuất cần review người."],
        };
      default:
        throw new Error(`Fixture không hỗ trợ task: ${ctx.task.id}`);
    }
  },
};
