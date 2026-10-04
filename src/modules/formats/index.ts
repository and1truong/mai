// Module định dạng nội dung (#19): registry định dạng có phiên bản —
// schema field có kiểu, hỗ trợ ngôn ngữ, validation, render xem trước
// và render export. Tách định dạng khỏi đích đến: một caption vẫn xuất
// được khi chưa có tài khoản kết nối; script video không phải video đã
// render. Định dạng mới đăng ký ở đây, không sửa model lõi.
//
// Canonical: revision.noi_dung là JSON object { <ten trường>: chuỗi | chuỗi[] }.
// Nội dung thường (không phải JSON object, vd output provider markdown)
// được map vào trường 'noi_dung' nếu định dạng khai báo, còn không thì
// giữ ở '_tho' và render kèm cảnh báo field bắt buộc thiếu.

// --- Kiểu schema ---

export type LoaiTruong = "van_ban" | "markdown" | "danh_sach";

export type DinhNghiaTruong = {
  ten: string; // key trong JSON nội dung
  nhan: string; // nhãn hiển thị khi render
  loai: LoaiTruong;
  bat_buoc?: boolean;
  do_dai_toi_da?: number; // ký tự (van_ban/markdown) hoặc ký tự mỗi mục (danh_sach)
  so_muc_toi_da?: number; // chỉ danh_sach
};

export type DinhNghiaDinhDang = {
  id: string;
  phien_ban: number; // tăng khi đổi schema/renderer — ban_the_hien.phien_ban_dinh_dang ghim bản đã dùng
  nhan: string;
  mo_ta: string;
  ngon_ngu: string[];
  truong: DinhNghiaTruong[];
};

// Một vấn đề validation của nội dung theo schema — trả về phản hồi sửa
// cụ thể cho người viết, không phải lỗi cứng chặn lưu.
export type LoiDinhDang = { truong: string; loi: string };

// Giá trị trường sau khi đọc nội dung canonical.
export type TruongGiaTri = Record<string, string | string[]>;

// --- Registry ---

const NGON_NGU = ["vi", "en"];

const DANG_BAI_VIET: DinhNghiaDinhDang = {
  id: "bai-viet",
  phien_ban: 1,
  nhan: "Bài viết",
  mo_ta: "Bài viết/blog đầy đủ: tiêu đề tùy chọn + nội dung Markdown.",
  ngon_ngu: NGON_NGU,
  truong: [
    { ten: "tieu_de", nhan: "Tiêu đề", loai: "van_ban", do_dai_toi_da: 200 },
    { ten: "noi_dung", nhan: "Nội dung", loai: "markdown", bat_buoc: true },
  ],
};

const DANG_NEWSLETTER: DinhNghiaDinhDang = {
  id: "newsletter",
  phien_ban: 1,
  nhan: "Newsletter",
  mo_ta: "Email newsletter: dòng chủ đề, đoạn xem trước và thân email.",
  ngon_ngu: NGON_NGU,
  truong: [
    { ten: "tieu_de", nhan: "Chủ đề", loai: "van_ban", bat_buoc: true, do_dai_toi_da: 150 },
    { ten: "tom_tat", nhan: "Xem trước", loai: "van_ban", do_dai_toi_da: 200 },
    { ten: "noi_dung", nhan: "Nội dung", loai: "markdown", bat_buoc: true },
  ],
};

const DANG_CAPTION: DinhNghiaDinhDang = {
  id: "caption",
  phien_ban: 1,
  nhan: "Caption mạng xã hội",
  mo_ta: "Một bài/caption social đơn lẻ + hashtag; xuất được không cần tài khoản.",
  ngon_ngu: NGON_NGU,
  truong: [
    { ten: "noi_dung", nhan: "Nội dung", loai: "markdown", bat_buoc: true, do_dai_toi_da: 2200 },
    { ten: "hashtag", nhan: "Hashtag", loai: "van_ban", do_dai_toi_da: 500 },
  ],
};

const DANG_THREAD: DinhNghiaDinhDang = {
  id: "thread",
  phien_ban: 1,
  nhan: "Thread",
  mo_ta: "Chuỗi bài social có thứ tự — mỗi mục là một bài đăng.",
  ngon_ngu: NGON_NGU,
  truong: [
    { ten: "tieu_de", nhan: "Tiêu đề", loai: "van_ban", do_dai_toi_da: 200 },
    {
      ten: "cac_muc",
      nhan: "Các bài",
      loai: "danh_sach",
      bat_buoc: true,
      so_muc_toi_da: 25,
      do_dai_toi_da: 500,
    },
  ],
};

const TRUONG_SCRIPT: DinhNghiaTruong[] = [
  { ten: "hook", nhan: "Hook", loai: "van_ban", bat_buoc: true, do_dai_toi_da: 300 },
  { ten: "loi_thoai", nhan: "Lời thoại", loai: "markdown", bat_buoc: true },
  { ten: "canh", nhan: "Cảnh gợi ý", loai: "danh_sach", so_muc_toi_da: 30, do_dai_toi_da: 300 },
  { ten: "cta", nhan: "CTA", loai: "van_ban", do_dai_toi_da: 200 },
];

const DANG_SCRIPT_NGAN: DinhNghiaDinhDang = {
  id: "script-ngan",
  phien_ban: 1,
  nhan: "Script video ngắn",
  mo_ta: "Script video ngắn (reels/shorts): hook, lời thoại, cảnh gợi ý, CTA.",
  ngon_ngu: NGON_NGU,
  truong: TRUONG_SCRIPT.map((t) =>
    t.ten === "loi_thoai" ? { ...t, do_dai_toi_da: 1500 } : t,
  ),
};

const DANG_SCRIPT_DAI: DinhNghiaDinhDang = {
  id: "script-dai",
  phien_ban: 1,
  nhan: "Script video dài",
  mo_ta: "Script video dài: hook, lời thoại, cảnh gợi ý, CTA — lời thoại không giới hạn.",
  ngon_ngu: NGON_NGU,
  truong: TRUONG_SCRIPT,
};

const DANG_FAQ: DinhNghiaDinhDang = {
  id: "faq",
  phien_ban: 1,
  nhan: "FAQ",
  mo_ta: "Hỏi-đáp: mỗi mục là một câu hỏi + trả lời (Markdown).",
  ngon_ngu: NGON_NGU,
  truong: [
    { ten: "gioi_thieu", nhan: "Giới thiệu", loai: "markdown" },
    {
      ten: "hoi_dap",
      nhan: "Hỏi đáp",
      loai: "danh_sach",
      bat_buoc: true,
      so_muc_toi_da: 50,
      do_dai_toi_da: 2000,
    },
  ],
};

const REGISTRY: Record<string, DinhNghiaDinhDang> = Object.fromEntries(
  [
    DANG_BAI_VIET,
    DANG_NEWSLETTER,
    DANG_CAPTION,
    DANG_THREAD,
    DANG_SCRIPT_NGAN,
    DANG_SCRIPT_DAI,
    DANG_FAQ,
  ].map((d) => [d.id, d]),
);

export const DANH_SACH_DINH_DANG = Object.keys(REGISTRY);

export type DinhDang = string;

export function laDinhDang(v: unknown): v is DinhDang {
  return typeof v === "string" && v in REGISTRY;
}

export function layDinhDang(id: string): DinhNghiaDinhDang | null {
  return REGISTRY[id] ?? null;
}

export function danhSachDinhDang(): DinhNghiaDinhDang[] {
  return Object.values(REGISTRY);
}

// --- Đọc nội dung canonical ---

// JSON object → giá trị từng trường (chuỗi hoặc mảng chuỗi; kiểu khác ép chuỗi).
// Không phải JSON object → map vào trường markdown 'noi_dung' nếu định dạng
// khai báo; còn không thì giữ nguyên văn ở '_tho'.
export function docNoiDung(def: DinhNghiaDinhDang, noiDung: string): TruongGiaTri {
  let j: unknown = null;
  try {
    j = JSON.parse(noiDung);
  } catch {
    // Không phải JSON → văn bản thường.
  }
  if (typeof j === "object" && j !== null && !Array.isArray(j)) {
    const ra: TruongGiaTri = {};
    for (const [k, v] of Object.entries(j as Record<string, unknown>)) {
      if (typeof v === "string") ra[k] = v;
      else if (Array.isArray(v)) ra[k] = v.map(String);
      else if (v === null || v === undefined) continue;
      else ra[k] = String(v);
    }
    return ra;
  }
  const coNoiDung = def.truong.some((t) => t.ten === "noi_dung" && t.loai === "markdown");
  return coNoiDung ? { noi_dung: noiDung } : { _tho: noiDung };
}

// --- Validation theo schema: trả phản hồi sửa cụ thể từng trường ---

export function kiemTraNoiDung(def: DinhNghiaDinhDang, noiDung: string): LoiDinhDang[] {
  const fields = docNoiDung(def, noiDung);
  const dsLoi: LoiDinhDang[] = [];
  const daKhaiBao = new Set(def.truong.map((t) => t.ten));

  for (const ten of Object.keys(fields)) {
    if (ten !== "_tho" && !daKhaiBao.has(ten)) {
      dsLoi.push({ truong: ten, loi: `Trường '${ten}' không nằm trong schema định dạng '${def.id}'.` });
    }
  }

  for (const t of def.truong) {
    const v = fields[t.ten];
    if (v === undefined) {
      if (t.bat_buoc) dsLoi.push({ truong: t.ten, loi: `'${t.nhan}' (${t.ten}) là bắt buộc.` });
      continue;
    }
    if (t.loai === "danh_sach") {
      if (!Array.isArray(v)) {
        dsLoi.push({ truong: t.ten, loi: `'${t.ten}' phải là mảng mục.` });
        continue;
      }
      const cacMucCoText = v.filter((m) => m.trim() !== "");
      if (t.bat_buoc && cacMucCoText.length === 0) {
        dsLoi.push({ truong: t.ten, loi: `'${t.nhan}' (${t.ten}) là bắt buộc, cần ít nhất một mục.` });
      }
      if (t.so_muc_toi_da !== undefined && v.length > t.so_muc_toi_da) {
        dsLoi.push({
          truong: t.ten,
          loi: `'${t.ten}' có ${v.length} mục, vượt giới hạn ${t.so_muc_toi_da}.`,
        });
      }
      if (t.do_dai_toi_da !== undefined) {
        for (const [i, m] of v.entries()) {
          if (m.length > t.do_dai_toi_da) {
            dsLoi.push({
              truong: t.ten,
              loi: `'${t.ten}[${i + 1}]' dài ${m.length} ký tự, vượt giới hạn ${t.do_dai_toi_da}.`,
            });
            break; // báo một lần đủ — người sửa tự kiểm lại các mục còn lại
          }
        }
      }
      continue;
    }
    // van_ban | markdown: giá trị chuỗi.
    const s = Array.isArray(v) ? v.join("\n") : v;
    if (t.bat_buoc && s.trim() === "") {
      dsLoi.push({ truong: t.ten, loi: `'${t.nhan}' (${t.ten}) là bắt buộc.` });
      continue;
    }
    if (t.loai === "van_ban" && Array.isArray(v)) {
      dsLoi.push({ truong: t.ten, loi: `'${t.ten}' phải là chuỗi, không phải mảng.` });
    }
    if (t.do_dai_toi_da !== undefined && s.length > t.do_dai_toi_da) {
      dsLoi.push({
        truong: t.ten,
        loi: `'${t.ten}' dài ${s.length} ký tự, vượt giới hạn ${t.do_dai_toi_da}.`,
      });
    }
  }

  if (typeof fields._tho === "string" && fields._tho.trim() !== "") {
    dsLoi.push({
      truong: "_tho",
      loi: "Nội dung không theo schema JSON của định dạng — hiển thị như văn bản thô.",
    });
  }
  return dsLoi;
}

// Kiểm ngôn ngữ đầu ra theo định dạng — gọi từ các endpoint tạo bản thể hiện.
// Bỏ qua khi field vắng (server áp default 'vi' sau).
export function kiemTraNgonNgu(def: DinhNghiaDinhDang, ngonNgu?: string | null): string | null {
  if (!ngonNgu) return null;
  if (!def.ngon_ngu.includes(ngonNgu)) {
    return `Định dạng '${def.id}' không hỗ trợ ngôn ngữ '${ngonNgu}'. Cho phép: ${def.ngon_ngu.join(", ")}.`;
  }
  return null;
}

// --- Render ---
export { markdownSangHtml, renderHtml, renderMarkdown, renderText } from "./render.ts";
