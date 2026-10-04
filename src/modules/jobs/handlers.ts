import type { Database } from "bun:sqlite";
import type { BanTheHien } from "../content/index.ts";
import { layBanTheHien, layNguon, taoBanTheHien, themRevision } from "../content/index.ts";
import type { GhiDeCampaign } from "../context/index.ts";
import { layDoiTuong, luuContextSinh } from "../context/index.ts";
import type { NhaCungCap } from "../generation/index.ts";
import type { JobHandler } from "./index.ts";

// Handler của từng loại job nền. Đăng ký thêm loại mới ở đây.

export const LOAI_JOB_HO_TRO = ["sinh_ban_the_hien"] as const;

export function taoHandlers(db: Database, provider: NhaCungCap): Record<string, JobHandler> {
  return {
    sinh_ban_the_hien: async (payload) => {
      const nguonId = String(payload.nguon_id ?? "");
      const dinhDang = String(payload.dinh_dang ?? "web");
      const doiTuongText = String(payload.doi_tuong ?? "");
      const thuongHieuId = payload.thuong_hieu_id ? String(payload.thuong_hieu_id) : null;
      const doiTuongId = payload.doi_tuong_id ? String(payload.doi_tuong_id) : null;
      const ghiDe =
        typeof payload.ghi_de === "object" && payload.ghi_de !== null && !Array.isArray(payload.ghi_de)
          ? (payload.ghi_de as GhiDeCampaign)
          : {};
      const nguon = layNguon(db, nguonId);
      if (!nguon) throw new Error(`Không tìm thấy nguồn: ${nguonId}`);

      // Lắp + lưu context sinh trước khi gọi provider: nội dung sinh ra giữ
      // đúng revision context mà nó đã dùng (snapshot tự đủ, tách thương hiệu/đối tượng).
      const contextSinh = luuContextSinh(db, {
        thuong_hieu_id: thuongHieuId,
        doi_tuong_id: doiTuongId,
        ghi_de: ghiDe,
      });
      const snapshot = JSON.parse(contextSinh.snapshot) as Parameters<
        NhaCungCap["sinhBanTheHien"]
      >[0]["contextSinh"];
      const doiTuongHienThi = doiTuongId
        ? (layDoiTuong(db, doiTuongId)?.ten ?? doiTuongText)
        : doiTuongText;

      let bth = db
        .query("SELECT * FROM ban_the_hien WHERE nguon_id = ? AND dinh_dang = ? LIMIT 1")
        .get(nguonId, dinhDang) as BanTheHien | null;
      if (!bth) {
        try {
          bth = taoBanTheHien(
            db,
            { nguon_id: nguonId, dinh_dang: dinhDang, doi_tuong: doiTuongHienThi },
            "job",
          );
        } catch (e) {
          // UNIQUE(nguon_id, dinh_dang): job khác đã tạo trong lúc chờ → đọc lại.
          bth = db
            .query("SELECT * FROM ban_the_hien WHERE nguon_id = ? AND dinh_dang = ? LIMIT 1")
            .get(nguonId, dinhDang) as BanTheHien | null;
          if (!bth) throw e;
        }
      }

      const { noiDung } = await provider.sinhBanTheHien({
        nguon,
        dinhDang,
        doiTuong: doiTuongHienThi,
        contextSinh: snapshot,
      });
      // head có thể đổi trong lúc chờ provider → đọc lại trước khi append.
      const bthHienTai = layBanTheHien(db, bth.id);
      if (!bthHienTai) throw new Error(`Bản thể hiện bị xóa trong lúc sinh: ${bth.id}`);
      const rev = themRevision(
        db,
        {
          ban_the_hien_id: bth.id,
          noi_dung: noiDung,
          dua_tren_revision_id: bthHienTai.head_revision_id,
          context_sinh_id: contextSinh.id,
        },
        "job",
      );
      return {
        ban_the_hien_id: bth.id,
        revision_id: rev.id,
        context_sinh_id: contextSinh.id,
        provider: provider.ten,
      };
    },
  };
}
