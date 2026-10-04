import type { Database } from "bun:sqlite";
import { LoiApi } from "../../loi.ts";
import { layBanTheHien, layNguon, themRevisionTrongTxn } from "../content/index.ts";
import type { GhiDeCampaign } from "../context/index.ts";
import { lapContextSinh, luuContextSinhTuSnapshot } from "../context/index.ts";
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

      ctx.baoTienDo({ buoc: "lap_context_sinh" });
      // Lắp context trong bộ nhớ: hồ sơ thiếu/sai → lỗi vĩnh viễn, không retry.
      // Chưa ghi DB — context_sinh chỉ tồn tại khi revision thật sự được ghi.
      let snapshot;
      try {
        snapshot = lapContextSinh(ctx.db, {
          thuong_hieu_id: payload.thuong_hieu_id ? String(payload.thuong_hieu_id) : null,
          doi_tuong_id: payload.doi_tuong_id ? String(payload.doi_tuong_id) : null,
          ghi_de: (payload.ghi_de ?? {}) as GhiDeCampaign,
        });
      } catch (e) {
        if (e instanceof LoiApi) throw new LoiVinhVien(e.message);
        throw e;
      }

      ctx.baoTienDo({ buoc: "goi_provider" });
      const { noiDung } = await provider.sinhBanTheHien({
        nguon,
        dinhDang: bth.dinh_dang,
        doiTuong: String(payload.doi_tuong ?? bth.doi_tuong),
        contextSinh: snapshot,
      });

      ctx.baoTienDo({ buoc: "ghi_revision" });
      // Kiểm lại lần cuối: provider có thể chậm, head có thể vừa đổi.
      const bthMoi = layBanTheHien(ctx.db, bthId);
      if (!bthMoi || (bthMoi.head_revision_id ?? null) !== mongDoi) {
        throw new LoiVinhVien("Revision đích đã đổi trong lúc sinh.");
      }
      // context_sinh + revision cùng một transaction: snapshot chỉ tồn tại khi
      // revision được ghi — không row mồ côi khi job fail hay retry attempt.
      ctx.db.exec("BEGIN IMMEDIATE");
      try {
        const cs = luuContextSinhTuSnapshot(ctx.db, snapshot);
        const rev = themRevisionTrongTxn(
          ctx.db,
          {
            ban_the_hien_id: bthId,
            noi_dung: noiDung,
            dua_tren_revision_id: mongDoi,
            context_sinh_id: cs.id,
          },
          "job",
        );
        ctx.db.exec("COMMIT");
        return {
          ban_the_hien_id: bthId,
          revision_id: rev.id,
          context_sinh_id: cs.id,
          provider: provider.ten,
        };
      } catch (e) {
        ctx.db.exec("ROLLBACK");
        // XUNG_DOT_REVISION và 404 entity = lỗi vĩnh viễn, không retry vô ích.
        if (e instanceof LoiApi && e.status === 409) throw new LoiVinhVien(e.message);
        throw e;
      }
    },
  };
}
