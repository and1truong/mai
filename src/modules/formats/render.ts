import type { DinhNghiaDinhDang, DinhNghiaTruong, TruongGiaTri } from "./index.ts";
import { docNoiDung } from "./index.ts";

// Render dùng chung cho mọi định dạng: Markdown (canonical export), text
// thường và HTML xem trước. HTML escape toàn bộ input rồi chỉ whitelist
// một tập nhỏ cú pháp Markdown — nội dung không tin cậy không chạy được
// markup/script tự viết.

export { docNoiDung };

// --- Tiện ích chung ---

function giaTriChuoi(v: string | string[] | undefined): string {
  if (v === undefined) return "";
  return Array.isArray(v) ? v.join("\n") : v;
}

function giaTriMang(v: string | string[] | undefined): string[] {
  if (v === undefined) return [];
  return Array.isArray(v) ? v : [v];
}

// --- Markdown (dạng export canonical) ---
// Trường 'tieu_de' render thành '# '; định dạng nhiều trường render mỗi
// trường còn lại dưới một heading '## <nhãn>'. danh_sach → mục đánh số.

function markdownTruong(t: DinhNghiaTruong, fields: TruongGiaTri, nhieuTruong: boolean): string[] {
  const v = fields[t.ten];
  // Nhãn '## <nhãn>' chỉ cho trường phụ — tiêu đề → '#', trường nội dung
  // markdown chính render thân bài không kèm nhãn.
  const coNhan =
    nhieuTruong && t.ten !== "tieu_de" && !(t.loai === "markdown" && t.ten === "noi_dung");
  if (t.loai === "danh_sach") {
    const muc = giaTriMang(v)
      .map((m) => m.trim())
      .filter(Boolean);
    if (muc.length === 0) return [];
    const dong = coNhan ? [`## ${t.nhan}`, ""] : [];
    for (const [i, m] of muc.entries()) {
      // Mục nhiều dòng: thụt dòng tiếp theo để giữ đúng một mục đánh số.
      dong.push(`${i + 1}. ${m.replace(/\n/g, "\n   ")}`);
    }
    dong.push("");
    return dong;
  }
  const s = giaTriChuoi(v).trim();
  if (!s) return [];
  if (t.ten === "tieu_de") return [`# ${s}`, ""];
  const dong = coNhan ? [`## ${t.nhan}`, ""] : [];
  dong.push(s, "");
  return dong;
}

export function renderMarkdown(def: DinhNghiaDinhDang, noiDung: string): string {
  const fields = docNoiDung(def, noiDung);
  const nhieuTruong = def.truong.length > 1;
  const dong: string[] = [];
  for (const t of def.truong) {
    dong.push(...markdownTruong(t, fields, nhieuTruong));
  }
  // Phần không theo schema (vd output provider markdown thường) vẫn hiện.
  const tho = giaTriChuoi(fields._tho).trim();
  if (tho) dong.push(tho, "");
  return dong.join("\n").trimEnd() + "\n";
}

// --- Text thường: bỏ ký hiệu Markdown, giữ Unicode + cấu trúc đoạn/link ---

export function boDauMarkdown(md: string): string {
  return md
    .replace(/\[([^\]]*)\]\(([^)\s]+)[^)]*\)/g, (_m, t: string, u: string) => `${t} (${u})`)
    .replace(/(\*\*|__)(.*?)\1/g, "$2")
    .replace(/(\*|_)(.*?)\1/g, "$2")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^>\s?/gm, "")
    .replace(/^[*+-]\s+/gm, "• ");
}

export function renderText(def: DinhNghiaDinhDang, noiDung: string): string {
  return boDauMarkdown(renderMarkdown(def, noiDung));
}

// --- HTML an toàn ---

const escapeHtml = (s: string): string =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

// URL được phép thành link: scheme http/https/mailto hoặc đường dẫn nội bộ.
// Scheme khác (javascript:, data:, vbscript:…) render như text thường.
function laUrlAnToan(u: string): boolean {
  return /^(https?:\/\/|mailto:|\/|#)/i.test(u);
}

// Inline Markdown trên text đã escape: **bold**, *italic*, `code`, [t](url),
// URL trần http(s) → link. Regex chạy trên chuỗi đã escape nên mọi markup
// gốc của input đã bị vô hiệu.
function inlineHtml(escaped: string): string {
  let s = escaped.replace(
    /\[([^\]]+)\]\(([^)\s]+)\)/g,
    (_m, t: string, u: string) =>
      laUrlAnToan(u) ? `<a href="${u}">${t}</a>` : `${t} (${u})`,
  );
  s = s.replace(/(\*\*|__)(.+?)\1/g, "<strong>$2</strong>");
  s = s.replace(/(\*|_)([^*_]+?)\1/g, "<em>$2</em>");
  s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
  s = s.replace(
    /(^|[\s(])(https?:\/\/[^\s<)&]+[^\s<>&.,;:'")!\]])/g,
    (_m, p: string, u: string) => `${p}<a href="${u}">${u}</a>`,
  );
  return s;
}

// Markdown → HTML whitelist: heading, danh sách -/*/1., trích dẫn, hr, đoạn.
// Input escape trước → không có HTML thô nào từ nội dung lọt qua.
export function markdownSangHtml(md: string): string {
  const dong = md.split("\n");
  const ra: string[] = [];
  let moDs: "" | "ul" | "ol" = "";
  const dongDs = () => {
    if (moDs) ra.push(moDs === "ul" ? "</ul>" : "</ol>");
    moDs = "";
  };
  for (const line of dong) {
    const s = line.trimEnd();
    if (/^#{1,6}\s/.test(s)) {
      dongDs();
      const cap = Math.min(s.match(/^#+/)![0].length, 3) + 1; // # → h2, ## → h3, ###+ → h4
      ra.push(`<h${cap}>${inlineHtml(escapeHtml(s.replace(/^#+\s+/, "")))}</h${cap}>`);
      continue;
    }
    if (/^(-{3,}|\*{3,})\s*$/.test(s)) {
      dongDs();
      ra.push("<hr/>");
      continue;
    }
    const mUl = /^[*+-]\s+/.test(s);
    const mOl = /^\d+\.\s+/.test(s);
    if (mUl || mOl) {
      const loai = mUl ? "ul" : "ol";
      if (moDs !== loai) {
        dongDs();
        ra.push(`<${loai}>`);
        moDs = loai;
      }
      ra.push(`<li>${inlineHtml(escapeHtml(s.replace(/^([*+-]|\d+\.)\s+/, "")))}</li>`);
      continue;
    }
    if (/^>\s?/.test(s)) {
      dongDs();
      ra.push(`<blockquote>${inlineHtml(escapeHtml(s.replace(/^>\s?/, "")))}</blockquote>`);
      continue;
    }
    if (s.trim() === "") {
      dongDs();
      continue;
    }
    dongDs();
    ra.push(`<p>${inlineHtml(escapeHtml(s))}</p>`);
  }
  dongDs();
  return ra.join("\n");
}

// HTML xem trước: field 'tieu_de' → <h1>, còn lại <h2> nhãn khi định dạng
// nhiều trường; markdown render qua whitelist, van_ban escape + linkify.
export function renderHtml(def: DinhNghiaDinhDang, noiDung: string): string {
  const fields = docNoiDung(def, noiDung);
  const nhieuTruong = def.truong.length > 1;
  const ra: string[] = [];
  for (const t of def.truong) {
    const v = fields[t.ten];
    const rong =
      v === undefined || (Array.isArray(v) ? v.every((m) => !m.trim()) : !v.trim());
    if (rong) continue;
    if (t.ten === "tieu_de") {
      ra.push(`<h1>${inlineHtml(escapeHtml(giaTriChuoi(v)))}</h1>`);
      continue;
    }
    // Nhãn <h2> chỉ cho trường phụ — trường nội dung markdown chính render
    // thân bài không kèm nhãn.
    if (nhieuTruong && !(t.loai === "markdown" && t.ten === "noi_dung"))
      ra.push(`<h2>${escapeHtml(t.nhan)}</h2>`);
    if (t.loai === "danh_sach") {
      ra.push("<ol>");
      for (const m of giaTriMang(v)) {
        if (m.trim()) ra.push(`<li>${inlineHtml(escapeHtml(m))}</li>`);
      }
      ra.push("</ol>");
      continue;
    }
    const s = giaTriChuoi(v);
    if (t.loai === "markdown") ra.push(markdownSangHtml(s));
    else ra.push(`<p>${inlineHtml(escapeHtml(s))}</p>`);
  }
  const tho = giaTriChuoi(fields._tho).trim();
  if (tho) {
    if (nhieuTruong) ra.push("<h2>Nội dung</h2>");
    ra.push(markdownSangHtml(tho));
  }
  return ra.join("\n");
}
