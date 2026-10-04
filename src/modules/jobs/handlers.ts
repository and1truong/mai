import type { Database } from "bun:sqlite";
import type { BanTheHien } from "../content/index.ts";
import { layBanTheHien, layNguon, taoBanTheHien, themRevision } from "../content/index.ts";
import type { NhaCungCap } from "../generation/index.ts";
import type { JobHandler } from "./index.ts";

// Handler của từng loại job nền. Đăng ký thêm loại mới ở đây.

export const LOAI_JOB_HO_TRO = ["sinh_ban_the_hien"] as const;

export function taoHandlers(db: Database, provider: NhaCungCap): Record<string, JobHandler> {
  return {
    sinh_ban_the_hien: async (payload) => {
      const nguonId = String(payload.nguon_id ?? "");
      const dinhDang = String(payload.dinh_dang ?? "web");
      const doiTuong = String(payload.doi_tuong ?? "");
      const nguon = layNguon(db, nguonId);
      if (!nguon) throw new Error(`Không tìm thấy nguồn: ${nguonId}`);

      let bth = db
        .query("SELECT * FROM ban_the_hien WHERE nguon_id = ? AND dinh_dang = ? LIMIT 1")
        .get(nguonId, dinhDang) as BanTheHien | null;
      if (!bth) {
        try {
          bth = taoBanTheHien(
            db,
            { nguon_id: nguonId, dinh_dang: dinhDang, doi_tuong: doiTuong },
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

      const { noiDung } = await provider.sinhBanTheHien({ nguon, dinhDang, doiTuong });
      // head có thể đổi trong lúc chờ provider → đọc lại trước khi append.
      const bthHienTai = layBanTheHien(db, bth.id);
      if (!bthHienTai) throw new Error(`Bản thể hiện bị xóa trong lúc sinh: ${bth.id}`);
      const rev = themRevision(
        db,
        {
          ban_the_hien_id: bth.id,
          noi_dung: noiDung,
          dua_tren_revision_id: bthHienTai.head_revision_id,
        },
        "job",
      );
      return { ban_the_hien_id: bth.id, revision_id: rev.id, provider: provider.ten };
    },
  };
}
