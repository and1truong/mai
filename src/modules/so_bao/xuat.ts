import type { Database } from "bun:sqlite";
import {
  danhSachBanTheHien,
  danhSachXuatBan,
  layNguonRevision,
  layRevision,
  layThongDiep,
  layThongDiepRevision,
  type Campaign,
} from "../content/index.ts";
import { layDoiTuong, layThuongHieu } from "../context/index.ts";
import { layDinhDang, renderHtml, renderMarkdown } from "../formats/index.ts";
import { docHtmlDayDu } from "../formats/xuat.ts";
import { taoZip, type TepZip } from "../formats/zip.ts";
import { layAsset, sachTenFile, type KhoByte } from "../nap/index.ts";
import { docThamChieuView, thongDiepChuDe } from "./index.ts";

// Bundle xuất của một số báo (#8): gói nội dung số gồm bài viết/đầu ra đã
// xuất, danh sách tham chiếu kèm bản dịch + trạng thái văn bản, manifest
// asset và các bản số (md + html theo revision ghim trong xuat_ban).
// Deterministic giống taoBundleXuatBan — cùng record → cùng byte.

export type KetQuaBundleSoBao = { tenFile: string; byte: Uint8Array<ArrayBuffer> };

export async function taoBundleSoBao(
  db: Database,
  cp: Campaign,
  kho: KhoByte,
): Promise<KetQuaBundleSoBao> {
  const td = thongDiepChuDe(db, cp);
  const dsBth = td ? danhSachBanTheHien(db, { thongDiepId: td.id }) : [];
  const thamChieu = docThamChieuView(db, cp);
  const thuongHieu = cp.thuong_hieu_id ? layThuongHieu(db, cp.thuong_hieu_id) : null;
  const doiTuong = cp.doi_tuong_id ? layDoiTuong(db, cp.doi_tuong_id) : null;

  const enc = new TextEncoder();
  const dsTep: TepZip[] = [];
  const manifestAsset: Record<string, unknown>[] = [];
  const tenDaDung = new Set<string>();
  const dsDauRa: Record<string, unknown>[] = [];
  let soThuTuRa = 0;

  for (const b of dsBth) {
    const xb = danhSachXuatBan(db, b.id)[0]; // xuat_ban mới nhất = bản số phục vụ
    if (!xb) continue; // chỉ đầu ra đã xuất đi vào gói số
    const revision = layRevision(db, xb.revision_id);
    const def = layDinhDang(b.dinh_dang);
    if (!revision || !def) continue;
    soThuTuRa += 1;
    const thuMuc = `dau-ra/${String(soThuTuRa).padStart(2, "0")}-${b.dinh_dang}`;
    const tdRev = revision.thong_diep_revision_id
      ? layThongDiepRevision(db, revision.thong_diep_revision_id)
      : null;
    const dsNguon = (tdRev?.nguon_revision_ids ?? [])
      .map((id) => layNguonRevision(db, id))
      .filter((n): n is NonNullable<typeof n> => n !== null)
      .map((n) => ({ id: n.id, nguon_id: n.nguon_id, tieu_de: n.tieu_de, so_thu_tu: n.so_thu_tu }));
    const thongDiep = layThongDiep(db, b.thong_diep_id);

    dsTep.push({
      duong_dan: `${thuMuc}/noi-dung.md`,
      noi_dung: enc.encode(renderMarkdown(def, revision.noi_dung)),
    });
    dsTep.push({
      duong_dan: `${thuMuc}/noi-dung.html`,
      noi_dung: enc.encode(
        docHtmlDayDu(def, renderHtml(def, revision.noi_dung), thongDiep?.tieu_de ?? ""),
      ),
    });

    // Asset của bản xuất: snapshot xuat_ban.asset_ids — cùng quy tắc bundle lẻ.
    const dsAssetTep: string[] = [];
    for (const assetId of xb.asset_ids) {
      const asset = layAsset(db, assetId);
      if (!asset) {
        manifestAsset.push({ id: assetId, thieu: true });
        continue;
      }
      const byte = await kho.doc(asset.duong_dan);
      let tenAnToan = sachTenFile(asset.ten_file);
      if (tenDaDung.has(tenAnToan)) {
        const cham = tenAnToan.lastIndexOf(".");
        tenAnToan =
          cham > 0
            ? `${tenAnToan.slice(0, cham)}-${asset.id.slice(0, 8)}${tenAnToan.slice(cham)}`
            : `${tenAnToan}-${asset.id.slice(0, 8)}`;
      }
      tenDaDung.add(tenAnToan);
      manifestAsset.push({
        id: asset.id,
        ten_file: asset.ten_file,
        loai: asset.loai,
        mime: asset.mime,
        kich_thuoc: asset.kich_thuoc,
        checksum: asset.checksum,
        thieu: !byte,
        tep: byte ? `assets/${tenAnToan}` : null,
        ban_the_hien_id: b.id,
      });
      if (byte) {
        dsTep.push({ duong_dan: `assets/${tenAnToan}`, noi_dung: byte });
        dsAssetTep.push(`assets/${tenAnToan}`);
      }
    }

    dsDauRa.push({
      id: b.id,
      dinh_dang: { id: def.id, phien_ban: b.phien_ban_dinh_dang, nhan: def.nhan },
      ngon_ngu: b.ngon_ngu,
      doi_tuong: b.doi_tuong,
      dich_den: xb.dich_den,
      revision: { id: revision.id, so_thu_tu: revision.so_thu_tu, tao_luc: revision.tao_luc },
      xuat_ban: { id: xb.id, tao_luc: xb.tao_luc, tao_boi: xb.tao_boi },
      nguon: dsNguon,
      assets: dsAssetTep,
      tep: thuMuc,
    });
  }

  const manifest = {
    so_bao: {
      id: cp.id,
      ten: cp.ten,
      so_thu_tu: cp.so_thu_tu,
      ngay_phat_hanh: cp.ngay_phat_hanh,
      chu_de: cp.chu_de,
      lap_truong: cp.lap_truong,
      chu_bien: cp.chu_bien,
      thuong_hieu: thuongHieu ? { id: thuongHieu.id, ten: thuongHieu.ten } : null,
      doi_tuong: doiTuong ? { id: doiTuong.id, ten: doiTuong.ten } : null,
      thong_diep_id: td?.id ?? null,
    },
    tham_chieu: thamChieu.map((t) => ({
      id: t.id,
      tham_chieu: t.tham_chieu,
      ban_dich: t.ban_dich,
      nguon_id: t.nguon_id,
      co_van_ban: t.co_van_ban,
      ghi_chu: t.ghi_chu,
    })),
    dau_ra: dsDauRa,
    assets: manifestAsset,
    tao_luc: cp.cap_nhat_luc, // timestamp dữ liệu — cùng record → cùng byte
  };

  // Danh mục tham chiếu dạng đọc được — đi kèm manifest để biên tập kiểm
  // từng đoạn + bản dịch + trạng thái văn bản mà không cần mở manifest.
  const dongTc = thamChieu.map(
    (t) =>
      `- ${t.tham_chieu} — ${t.ban_dich || "chưa rõ bản dịch"} — ${t.co_van_ban ? `có văn bản (${t.nguon?.tieu_de ?? t.nguon_id})` : "THIẾU VĂN BẢN"}`,
  );
  dsTep.unshift({
    duong_dan: "tham-chieu.md",
    noi_dung: enc.encode(
      [
        `# Tham chiếu — ${cp.ten}`,
        "",
        ...dongTc,
        "",
        cp.lap_truong ? `Lập trường biên tập: ${cp.lap_truong}` : "",
      ].join("\n"),
    ),
  });
  dsTep.push({ duong_dan: "manifest.json", noi_dung: enc.encode(JSON.stringify(manifest, null, 2) + "\n") });

  const so = cp.so_thu_tu !== null ? `so-${String(cp.so_thu_tu).padStart(3, "0")}` : cp.id.slice(0, 8);
  return { tenFile: `mai-${so}.zip`, byte: taoZip(dsTep) };
}
