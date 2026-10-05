import type { Database } from "bun:sqlite";
import { LoiApi } from "../../loi.ts";
import {
  layBanTheHien,
  layRevision,
  layThongDiep,
  themRevisionTrongTxn,
} from "../content/index.ts";
import type { GhiDeCampaign } from "../context/index.ts";
import { lapContextSinh, luuContextSinhTuSnapshot } from "../context/index.ts";
import {
  ghiSuDungSinh,
  kiemTraDauRa,
  lapContextNoiDung,
  LoiProvider,
  TASK,
  type GioiHanContext,
  type KetQuaTask,
  type NhaCungCap,
} from "../generation/index.ts";
import { LoiVinhVien, type JobCtx, type JobHandler } from "./index.ts";

// Handler của từng loại job nền — đăng ký loại mới ở đây (#20, sau này #13).
// Chữ ký: (payload, ctx) → Promise<ket_qua>. Handler chịu trách nhiệm
// idempotency: kiểm lại entity/revision đích trước khi commit (attempt là
// ít-nhất-một-lần). Ném LoiVinhVien cho lỗi không retry được; lỗi khác → retry.

export const LOAI_JOB_HO_TRO = ["sinh_ban_the_hien"] as const;

// Sửa đầu ra không hợp lệ tối đa một lần trong cùng attempt — sau đó fail
// vĩnh viễn để người dùng inspect/sửa thủ công (bounded repair).
const SO_LAN_SUA_TOI_DA = 1;

export type TuyChonHandlers = {
  gioi_han?: Partial<GioiHanContext>;
  gia?: { vao_moi_1k: number; ra_moi_1k: number };
};

// Gọi provider + ghi usage cho MỌI lần gọi (ok lẫn lỗi). LoiApi 4xx/409 và
// LoiProvider vinh_vien → LoiVinhVien (không retry); LoiProvider sua_duoc
// ném lại nguyên trạng cho caller quyết định repair; lỗi còn lại = tạm thời.
async function goiProvider(
  ctx: JobCtx,
  provider: NhaCungCap,
  contextTask: Parameters<NhaCungCap["sinh"]>[0],
  gia?: TuyChonHandlers["gia"],
): Promise<KetQuaTask> {
  const batDau = performance.now();
  try {
    const kq = await provider.sinh(contextTask, ctx.tinHieu);
    ghiSuDungSinh(ctx.db, {
      job_id: ctx.job.id,
      lan_thu: ctx.lanThu,
      provider: provider.ten,
      model: kq.model ?? provider.model,
      task: contextTask.task.id,
      phien_ban_task: contextTask.task.phien_ban,
      token_vao: kq.token_vao,
      token_ra: kq.token_ra,
      gia,
      ms: performance.now() - batDau,
      trang_thai: "ok",
    });
    return kq;
  } catch (e) {
    ghiSuDungSinh(ctx.db, {
      job_id: ctx.job.id,
      lan_thu: ctx.lanThu,
      provider: provider.ten,
      model: provider.model,
      task: contextTask.task.id,
      phien_ban_task: contextTask.task.phien_ban,
      gia,
      ms: performance.now() - batDau,
      trang_thai: "loi",
      loi: e instanceof Error ? e.message : String(e),
    });
    if (e instanceof LoiProvider) {
      if (e.vinh_vien) throw new LoiVinhVien(e.message);
      if (!e.sua_duoc) throw e; // tạm thời — runner retry với backoff
      throw e; // sua_duoc: caller bắt để repair
    }
    if (e instanceof LoiApi && (e.status === 404 || e.status === 409 || e.status === 400)) {
      throw new LoiVinhVien(e.message);
    }
    throw e;
  }
}

export function taoHandlers(
  db: Database,
  provider: NhaCungCap,
  tuyChon: TuyChonHandlers = {},
): Record<string, JobHandler> {
  return {
    // Sinh revision mới cho một bản thể hiện. Enqueue đã tạo/ghim entity +
    // revision_id (head lúc enqueue); handler kiểm lại head trước khi commit —
    // head trôi → lỗi vĩnh viễn, user retry để ghim head mới. Retry job KHÔNG
    // ghi đè sửa tay: sửa tay tạo revision mới → head trôi → job loi, không
    // âm thầm kích hoạt kết quả cũ.
    sinh_ban_the_hien: async (payload, ctx) => {
      const bthId = ctx.job.entity_id || String(payload.ban_the_hien_id ?? "");
      const mongDoi = ctx.job.revision_id ?? null;

      ctx.baoTienDo({ buoc: "doc_ban_the_hien" });
      const bth = layBanTheHien(ctx.db, bthId);
      if (!bth) throw new LoiVinhVien(`Không tìm thấy bản thể hiện: ${bthId}`);
      const thongDiep = layThongDiep(ctx.db, bth.thong_diep_id);
      if (!thongDiep) throw new LoiVinhVien(`Không tìm thấy thông điệp: ${bth.thong_diep_id}`);
      if ((bth.head_revision_id ?? null) !== mongDoi) {
        throw new LoiVinhVien("Revision đích đã đổi trong lúc job xếp hàng. Thử lại để ghim head mới.");
      }
      // #11: job ĐÃ LÊN LỊCH mà revision đích ghim thong_diep revision cũ
      // (nguồn đã đổi — vd ngày hiệu lực của chính sách) không được chạy
      // tiếp trước khi review lại — nội dung được sinh sẽ nói về nguồn
      // cũ. Job ad-hoc/repair (không lịch) không bị chặn; sau khi review
      // + retry job ghim head mới và chạy bình thường.
      if (ctx.job.chay_som_nhat !== null && bth.head_revision_id) {
        const revDich = layRevision(ctx.db, bth.head_revision_id);
        if (
          revDich?.thong_diep_revision_id &&
          thongDiep.head_revision_id &&
          revDich.thong_diep_revision_id !== thongDiep.head_revision_id
        ) {
          throw new LoiVinhVien(
            "Nội dung đã lên lịch đang ghim nguồn cũ — review lại đầu ra trước khi chạy.",
          );
        }
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

      // Bộ dựng context nội dung: chọn đúng revision nguồn đã ghim qua chuỗi
      // thông điệp, ép giới hạn đầu vào, báo chứng cứ thiếu — ghi lại phần
      // đã đưa vào để trích dẫn resolve được. Entity biến mất giữa chừng →
      // lỗi vĩnh viễn như ở bước lắp context sinh.
      let ctxTask;
      try {
        ctxTask = lapContextNoiDung(ctx.db, {
          bth,
          task: TASK.nhap_ban_the_hien,
          context_sinh: snapshot,
          doi_tuong: String(payload.doi_tuong ?? bth.doi_tuong),
          gioi_han: tuyChon.gioi_han,
          // Số báo (#8): campaign_id từ payload → lập trường + cờ thiếu
          // văn bản tham chiếu trong context. Vắng mặt → td.campaign_id.
          campaign_id: payload.campaign_id ? String(payload.campaign_id) : undefined,
          // Thương hiệu (#12): thi trường của tổ hợp → fact local nguyên
          // văn vào context (giá/khả dụng/CTA local/chi tiết đối tượng).
          thi_truong_id: payload.thi_truong_id ? String(payload.thi_truong_id) : undefined,
        });
      } catch (e) {
        if (e instanceof LoiApi) throw new LoiVinhVien(e.message);
        throw e;
      }
      if (ctxTask.ds_nguon.length === 0) {
        ctx.baoTienDo({ buoc: "lap_context_sinh", canh_bao: "khong_co_nguon" });
      }

      ctx.baoTienDo({ buoc: "goi_provider" });
      ctx.assertConHan(); // attempt đã timeout/hủy → không gọi provider nữa
      // Vòng sinh + sửa có biên: output sai schema/claim hoặc lỗi sua_duoc
      // (JSON hỏng) → một lần repair kèm ds lỗi, sau đó fail vĩnh viễn.
      let kq: KetQuaTask | null = null;
      let kt: ReturnType<typeof kiemTraDauRa> | null = null;
      let dsLoiTruoc: string[] = [];
      for (let lan = 0; lan <= SO_LAN_SUA_TOI_DA; lan++) {
        const ctxGoi = lan === 0 ? ctxTask : { ...ctxTask, sua_loi: dsLoiTruoc };
        try {
          kq = await goiProvider(ctx, provider, ctxGoi, tuyChon.gia);
        } catch (e) {
          if (e instanceof LoiProvider && e.sua_duoc) {
            // Hết budget sửa → thống nhất fail vĩnh viễn, không đốt attempt.
            dsLoiTruoc = [e.message];
            if (lan < SO_LAN_SUA_TOI_DA) continue;
            break;
          }
          throw e;
        }
        kt = kiemTraDauRa(ctxTask, kq);
        if (kt.hop_le) break;
        dsLoiTruoc = kt.loi_cung;
      }
      if (!kq || !kt?.hop_le) {
        throw new LoiVinhVien(
          `Đầu ra không hợp lệ sau ${SO_LAN_SUA_TOI_DA} lần sửa: ${dsLoiTruoc.join(" | ")}`,
        );
      }

      ctx.baoTienDo({ buoc: "ghi_revision" });
      // Kiểm lại lần cuối: provider có thể chậm, head có thể vừa đổi.
      const bthMoi = layBanTheHien(ctx.db, bthId);
      if (!bthMoi || (bthMoi.head_revision_id ?? null) !== mongDoi) {
        throw new LoiVinhVien("Revision đích đã đổi trong lúc sinh.");
      }
      ctx.assertConHan(); // chặn zombie commit revision sau khi job 'loi'
      // Provenance ghi đúng revision mà context thực sự dùng (không đọc lại
      // head — head thông điệp có thể đã trôi kể từ lúc lắp context).
      const tdRevId = ctxTask.thong_diep.revision_id;
      // context_sinh + revision cùng một transaction: snapshot chỉ tồn tại khi
      // revision được ghi — không row mồ côi khi job fail hay retry attempt.
      ctx.db.exec("BEGIN IMMEDIATE");
      try {
        const cs = luuContextSinhTuSnapshot(ctx.db, snapshot);
        const rev = themRevisionTrongTxn(
          ctx.db,
          {
            ban_the_hien_id: bthId,
            noi_dung: kq.noi_dung,
            dua_tren_revision_id: mongDoi,
            context_sinh_id: cs.id,
            thong_diep_revision_id: tdRevId,
          },
          "job",
        );
        ctx.db.exec("COMMIT");
        return {
          ban_the_hien_id: bthId,
          revision_id: rev.id,
          context_sinh_id: cs.id,
          thong_diep_revision_id: tdRevId,
          provider: provider.ten,
          model: kq.model ?? provider.model ?? "",
          task: { id: ctxTask.task.id, phien_ban: ctxTask.task.phien_ban },
          so_trich_dan: kq.trich_dan.length,
          so_nguon_context: ctxTask.ds_nguon.length,
          nguon_da_cat_gon: ctxTask.ds_nguon.filter((n) => n.da_cat_gon).length,
          thieu_chung_cu: ctxTask.thieu_chung_cu,
          canh_bao: kt.canh_bao,
          la_fixture: provider.la_fixture,
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
