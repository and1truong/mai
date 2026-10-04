import type { Nguon } from "../content/index.ts";
import type { ContextSinhSnapshot } from "../context/index.ts";
import { LoiApi } from "../../loi.ts";

// Module sinh nội dung: interface provider + fixture deterministic.
// Mặc định POC chạy offline bằng fixture — không cần credential.
// Adapter provider thật (P1) cũng là module nội bộ cùng interface này,
// key chỉ đọc từ env phía server.
// `contextSinh` giữ ràng buộc thương hiệu và sở thích đối tượng tách riêng;
// kiểm chứng khác biệt thật khi sinh nằm ở ticket #20.

export interface KetQuaSinh {
  noiDung: string;
}

export interface NhaCungCap {
  ten: string;
  sinhBanTheHien(input: {
    nguon: Nguon;
    dinhDang: string;
    doiTuong: string;
    contextSinh?: ContextSinhSnapshot | null;
  }): Promise<KetQuaSinh>;
}

// Fixture: output deterministic từ nội dung nguồn + context sinh. Không gọi mạng.
const fixture: NhaCungCap = {
  ten: "fixture",
  async sinhBanTheHien({ nguon, dinhDang, doiTuong, contextSinh }) {
    const tomTat = nguon.noi_dung.trim().split("\n").slice(0, 3).join(" ");
    const dong = [
      `# ${nguon.tieu_de}`,
      "",
      `- Kênh: ${dinhDang}`,
      `- Đối tượng: ${contextSinh?.doi_tuong?.ten || doiTuong || "chung"}`,
    ];
    if (contextSinh?.doi_tuong) {
      dong.push(`- Độ sâu: ${contextSinh.doi_tuong.do_sau || "chưa biết"}`);
      dong.push(`- Từ vựng: ${contextSinh.doi_tuong.tu_vung || "chưa biết"}`);
    }
    if (contextSinh?.thuong_hieu) {
      dong.push(`- Thương hiệu: ${contextSinh.thuong_hieu.ten}`);
      const giuNguyen = contextSinh.thuong_hieu.thuat_ngu
        .filter((t) => t.giu_nguyen)
        .map((t) => t.thuat_ngu);
      if (giuNguyen.length > 0) dong.push(`- Thuật ngữ giữ nguyên: ${giuNguyen.join(", ")}`);
    }
    dong.push("", tomTat);
    return { noiDung: dong.join("\n") };
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
