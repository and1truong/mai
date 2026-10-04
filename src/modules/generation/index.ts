import type { Nguon } from "../content/index.ts";
import { LoiApi } from "../../loi.ts";

// Module sinh nội dung: interface provider + fixture deterministic.
// Mặc định POC chạy offline bằng fixture — không cần credential.
// Adapter provider thật (P1) cũng là module nội bộ cùng interface này,
// key chỉ đọc từ env phía server.

export interface KetQuaSinh {
  noiDung: string;
}

export interface NhaCungCap {
  ten: string;
  sinhBanTheHien(input: {
    nguon: Nguon;
    dinhDang: string;
    doiTuong: string;
  }): Promise<KetQuaSinh>;
}

// Fixture: output deterministic từ nội dung nguồn. Không gọi mạng.
const fixture: NhaCungCap = {
  ten: "fixture",
  async sinhBanTheHien({ nguon, dinhDang, doiTuong }) {
    const tomTat = nguon.noi_dung.trim().split("\n").slice(0, 3).join(" ");
    return {
      noiDung: [
        `# ${nguon.tieu_de}`,
        "",
        `- Kênh: ${dinhDang}`,
        `- Đối tượng: ${doiTuong || "chung"}`,
        "",
        tomTat,
      ].join("\n"),
    };
  },
};

const REGISTRY: Record<string, NhaCungCap> = { fixture };

export function layNhaCungCap(ten: string): NhaCungCap {
  const provider = REGISTRY[ten];
  if (!provider) {
    throw new LoiApi(500, "LOI_CAU_HINH", `Provider sinh nội dung không hỗ trợ: ${ten}`);
  }
  return provider;
}
