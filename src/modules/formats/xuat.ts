import type { Database } from "bun:sqlite";
import { LoiApi } from "../../loi.ts";
import {
  layNguonRevision,
  layRevision,
  layThongDiep,
  layThongDiepRevision,
  type BanTheHien,
  type XuatBan,
} from "../content/index.ts";
import { layAsset, sachTenFile, type KhoByte } from "../nap/index.ts";
import { layDinhDang } from "./index.ts";
import { renderHtml, renderMarkdown } from "./render.ts";
import { taoZip, type TepZip } from "./zip.ts";

// Bundle xuất bản tải về (#19): render đúng revision đã ghim trong record
// xuat_ban — không sinh lại nội dung, không gọi provider. Chỉ chứa asset
// được chọn tường minh tại thời điểm đăng (xuat_ban.asset_ids); ghi chú
// duyệt/xuất bản và record thư viện khác không lọt vào bundle.

const CSS = `body{font-family:system-ui,sans-serif;max-width:46rem;margin:2rem auto;padding:0 1rem;line-height:1.55;color:#1a1a1a}h1{font-size:1.6rem}h2{font-size:1.15rem;margin-top:1.6rem}ol,ul{padding-left:1.5rem}blockquote{border-left:3px solid #ccc;margin:0;padding:.2rem 1rem;color:#555}code{background:#f3f3f3;padding:.1rem .3rem;border-radius:4px}hr{border:none;border-top:1px solid #ddd}`;

function docHtmlDayDu(def: { nhan: string }, html: string, tieuDe: string): string {
  const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return [
    "<!doctype html>",
    `<html lang="vi"><head><meta charset="utf-8"><title>${escape(tieuDe || def.nhan)}</title>`,
    `<style>${CSS}</style></head><body>`,
    html,
    "</body></html>",
  ].join("\n");
}

export type KetQuaBundle = { tenFile: string; byte: Uint8Array<ArrayBuffer> };

export async function taoBundleXuatBan(
  db: Database,
  bth: BanTheHien,
  xb: XuatBan,
  kho: KhoByte,
): Promise<KetQuaBundle> {
  const def = layDinhDang(bth.dinh_dang);
  if (!def) {
    throw new LoiApi(
      500,
      "LOI_CAU_HINH",
      `Định dạng '${bth.dinh_dang}' không còn trong registry.`,
    );
  }
  const revision = layRevision(db, xb.revision_id);
  if (!revision) {
    throw new LoiApi(404, "KHONG_TIM_THAY", "Revision đã đăng không còn tồn tại.");
  }
  const thongDiep = layThongDiep(db, bth.thong_diep_id);
  const tdRev = revision.thong_diep_revision_id
    ? layThongDiepRevision(db, revision.thong_diep_revision_id)
    : null;
  const dsNguon = (tdRev?.nguon_revision_ids ?? [])
    .map((id) => layNguonRevision(db, id))
    .filter((n): n is NonNullable<typeof n> => n !== null)
    .map((n) => ({ id: n.id, nguon_id: n.nguon_id, tieu_de: n.tieu_de, so_thu_tu: n.so_thu_tu }));

  const md = renderMarkdown(def, revision.noi_dung);
  const html = docHtmlDayDu(def, renderHtml(def, revision.noi_dung), thongDiep?.tieu_de ?? "");
  const enc = new TextEncoder();

  // Manifest dòng nguồn + danh mục asset. Không timestamp phát sinh →
  // cùng record xuất bản → cùng byte bundle.
  const dsAsset: TepZip[] = [];
  const manifestAsset: Record<string, unknown>[] = [];
  for (const assetId of xb.asset_ids) {
    const asset = layAsset(db, assetId);
    if (!asset) {
      manifestAsset.push({ id: assetId, thieu: true });
      continue;
    }
    const byte = await kho.doc(asset.duong_dan);
    const tenAnToan = sachTenFile(asset.ten_file) || `${asset.id}.bin`;
    manifestAsset.push({
      id: asset.id,
      ten_file: asset.ten_file,
      loai: asset.loai,
      mime: asset.mime,
      kich_thuoc: asset.kich_thuoc,
      checksum: asset.checksum,
      tep: byte ? `assets/${tenAnToan}` : null,
    });
    if (byte) dsAsset.push({ duong_dan: `assets/${tenAnToan}`, noi_dung: byte });
  }

  const manifest = {
    dinh_dang: { id: def.id, phien_ban: def.phien_ban, nhan: def.nhan },
    ban_the_hien_id: bth.id,
    ngon_ngu: bth.ngon_ngu,
    doi_tuong: bth.doi_tuong,
    dich_den: xb.dich_den,
    revision: {
      id: revision.id,
      so_thu_tu: revision.so_thu_tu,
      tao_luc: revision.tao_luc,
      tao_boi: revision.tao_boi,
    },
    xuat_ban: { id: xb.id, tao_luc: xb.tao_luc, tao_boi: xb.tao_boi },
    thong_diep: thongDiep
      ? { id: thongDiep.id, tieu_de: thongDiep.tieu_de, revision_id: tdRev?.id ?? null }
      : null,
    nguon: dsNguon,
    assets: manifestAsset,
  };

  const byte = taoZip([
    { duong_dan: "noi-dung.md", noi_dung: enc.encode(md) },
    { duong_dan: "noi-dung.html", noi_dung: enc.encode(html) },
    { duong_dan: "manifest.json", noi_dung: enc.encode(JSON.stringify(manifest, null, 2) + "\n") },
    ...dsAsset,
  ]);
  return { tenFile: `mai-${def.id}-rev${revision.so_thu_tu}.zip`, byte };
}
