import type { Database } from "bun:sqlite";
import { LoiApi } from "../../loi.ts";
import { layBanTheHien, layNguon, themRevision } from "../content/index.ts";
import type { NhaCungCap } from "../generation/index.ts";
import { LoiVinhVien, type JobHandler } from "./index.ts";

// Handler của từng loại job nền — đăng ký loại mới ở đây (#20, sau này #13).
// Chữ ký: (payload, ctx) → Promise<ket_qua>. Handler chịu trách nhiệm
// idempotency: kiểm lại entity/revision đích trước khi commit (attempt là
// ít-nhất-một-lần). Ném LoiVinhVien cho lỗi không retry được; lỗi khác → retry.

export const LOAI_JOB_HO_TRO = ["sinh_ban_the_hien"] as const;

export function taoHandlers(db: Database, provider: NhaCungCap): Record<string, JobHandler> {
  return {
    // Sinh revision mới cho một bản thể hiện. Enqueue đã tạo/ghim entity +
    // revision_id (head lúc enqueue); handler kiểm lại head trước khi commit —
    // head trôi → lỗi vĩnh viễn, user retry để ghim head mới.
    sinh_ban_the_hien: async (payload, ctx) => {
      const bthId = ctx.job.entity_id || String(payload.ban_the_hien_id ?? "");
      const mongDoi = ctx.job.revision_id ?? null;

      ctx.baoTienDo({ buoc: "doc_ban_the_hien" });
      const bth = layBanTheHien(ctx.db, bthId);
      if (!bth) throw new LoiVinhVien(`Không tìm thấy bản thể hiện: ${bthId}`);
      const nguon = layNguon(ctx.db, bth.nguon_id);
      if (!nguon) throw new LoiVinhVien(`Không tìm thấy nguồn: ${bth.nguon_id}`);
      if ((bth.head_revision_id ?? null) !== mongDoi) {
        throw new LoiVinhVien("Revision đích đã đổi trong lúc job xếp hàng. Thử lại để ghim head mới.");
      }

      ctx.baoTienDo({ buoc: "goi_provider" });
      const { noiDung } = await provider.sinhBanTheHien({
        nguon,
        dinhDang: bth.dinh_dang,
        doiTuong: String(payload.doi_tuong ?? bth.doi_tuong),
      });

      ctx.baoTienDo({ buoc: "ghi_revision" });
      // Kiểm lại lần cuối: provider có thể chậm, head có thể vừa đổi.
      const bthMoi = layBanTheHien(ctx.db, bthId);
      if (!bthMoi || (bthMoi.head_revision_id ?? null) !== mongDoi) {
        throw new LoiVinhVien("Revision đích đã đổi trong lúc sinh.");
      }
      try {
        const rev = themRevision(
          ctx.db,
          { ban_the_hien_id: bthId, noi_dung: noiDung, dua_tren_revision_id: mongDoi },
          "job",
        );
        return { ban_the_hien_id: bthId, revision_id: rev.id, provider: provider.ten };
      } catch (e) {
        // XUNG_DOT_REVISION và 404 entity = lỗi vĩnh viễn, không retry vô ích.
        if (e instanceof LoiApi && e.status === 409) throw new LoiVinhVien(e.message);
        throw e;
      }
    },
  };
}
