import type { ContextSinhSnapshot } from "../context/index.ts";
import { LoiApi } from "../../loi.ts";

// Module sinh nội dung: interface provider + fixture deterministic.
// Mặc định POC chạy offline bằng fixture — không cần credential.
// Adapter provider thật (P1) cũng là module nội bộ cùng interface này,
// key chỉ đọc từ env phía server.
// `contextSinh` giữ ràng buộc thương hiệu và sở thích đối tượng tách riêng;
// kiểm chứng khác biệt thật khi sinh nằm ở ticket #20.

// Nội dung đầu vào của một lần sinh: thông điệp chuẩn + các nguồn liên kết
// (đã resolve tới đúng revision đã ghim — caller truyền snapshot, không id).
export type NoiDungDauVao = {
  tieu_de: string;
  noi_dung: string;
};

export interface KetQuaSinh {
  noiDung: string;
}

export interface NhaCungCap {
  ten: string;
  sinhBanTheHien(input: {
    thongDiep: NoiDungDauVao;
    dsNguon: NoiDungDauVao[];
    dinhDang: string;
    doiTuong: string;
    ngonNgu?: string;
    contextSinh?: ContextSinhSnapshot | null;
  }): Promise<KetQuaSinh>;
}

// Fixture: output deterministic từ thông điệp + nguồn + context sinh.
// Không gọi mạng. Thông điệp rỗng nội dung → tóm tắt từ nguồn đầu tiên.
const fixture: NhaCungCap = {
  ten: "fixture",
  async sinhBanTheHien({ thongDiep, dsNguon, dinhDang, doiTuong, ngonNgu, contextSinh }) {
    const vanBan = thongDiep.noi_dung.trim() || (dsNguon[0]?.noi_dung ?? "");
    const tomTat = vanBan.trim().split("\n").slice(0, 3).join(" ");
    const dong = [
      `# ${thongDiep.tieu_de}`,
      "",
      `- Kênh: ${dinhDang}`,
      `- Đối tượng: ${contextSinh?.doi_tuong?.ten || doiTuong || "chung"}`,
    ];
    if (ngonNgu) dong.push(`- Ngôn ngữ: ${ngonNgu}`);
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
    if (dsNguon.length > 0) dong.push(`- Nguồn: ${dsNguon.map((n) => n.tieu_de).join("; ")}`);
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
