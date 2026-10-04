// Module số báo (#8): campaign mở rộng thành một số tạp chí.
//
// - Mỗi số báo = một campaign có các field số báo (số thứ tự, ngày phát
//   hành, chủ đề, lập trường biên tập, chủ biên, hồ sơ dùng lại) + tham
//   chiếu nguồn được khai báo + mục lục đề xuất sửa được.
// - Mỗi số báo có một thông điệp chủ đề (thong_diep đầu tiên của campaign)
//   gắn các nguồn tham chiếu đã nạp — mọi đầu ra của số sinh từ thông điệp
//   đó, nên trích dẫn đối chiếu được với nguồn thật.
// - Khoảng trống nội dung (thiếu văn bản tham chiếu, thiếu bài giải thích
//   cho thiếu niên, thiếu bài học tài liệu nền) → gợi ý task kèm lý do +
//   bằng chứng; gợi ý KHÔNG tự khẳng định thần học hay tự sinh nội dung.
// - Biên tập chọn mục nào cần nháp (chonMucLuc) — không tự động sinh mọi
//   tổ hợp; job sinh đi qua enqueueJob sinh_ban_the_hien như luồng chung.

import type { Database } from "bun:sqlite";
import { LoiApi, loiRequest } from "../../loi.ts";
import {
  capNhatThongDiep,
  danhSachBanTheHien,
  danhSachThongDiep,
  ghiSuKien,
  layCampaign,
  layNguon,
  taoBanTheHien,
  taoThongDiep,
  timBanTheHien,
  type BanTheHien,
  type Campaign,
  type MucLuc,
  type ThamChieu,
  type ThongDiep,
} from "../content/index.ts";
import {
  danhSachDoiTuong,
  layDoiTuong,
  layThuongHieu,
  type HoSoDoiTuong,
} from "../context/index.ts";
import { DANH_SACH_DINH_DANG, kiemTraNgonNgu, layDinhDang } from "../formats/index.ts";
import { enqueueJob, type Job } from "../jobs/index.ts";

const bayGio = () => new Date().toISOString();

function txn<T>(db: Database, fn: () => T): T {
  if (db.inTransaction) return fn();
  db.exec("BEGIN IMMEDIATE");
  try {
    const r = fn();
    db.exec("COMMIT");
    return r;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

// --- Validation input ---

// Đọc + validate danh sách tham chiếu từ request. Trả undefined khi body
// không có field; lỗi từng mục gom vào dsLoi để trả một 400 duy nhất.
export function kiemTraThamChieu(
  db: Database,
  body: unknown,
  dsLoi: string[],
): ThamChieu[] | undefined {
  if (body === undefined) return undefined;
  if (!Array.isArray(body)) {
    dsLoi.push("tham_chieu phải là mảng các tham chiếu.");
    return undefined;
  }
  const ds: ThamChieu[] = [];
  const daCoId = new Set<string>();
  for (const [i, x] of body.entries()) {
    if (typeof x !== "object" || x === null || Array.isArray(x)) {
      dsLoi.push(`tham_chieu[${i}] phải là object.`);
      continue;
    }
    const r = x as Record<string, unknown>;
    const id = typeof r.id === "string" && r.id.trim() ? r.id.trim() : `tc${i + 1}`;
    if (daCoId.has(id)) {
      dsLoi.push(`tham_chieu[${i}].id '${id}' trùng với mục trước.`);
      continue;
    }
    daCoId.add(id);
    const tc = typeof r.tham_chieu === "string" ? r.tham_chieu.trim() : "";
    if (!tc) {
      dsLoi.push(`tham_chieu[${i}].tham_chieu bắt buộc.`);
      continue;
    }
    if (tc.length > 300) {
      dsLoi.push(`tham_chieu[${i}].tham_chieu quá dài (tối đa 300 ký tự).`);
      continue;
    }
    const bd = typeof r.ban_dich === "string" ? r.ban_dich.trim() : "";
    if (bd.length > 200) {
      dsLoi.push(`tham_chieu[${i}].ban_dich quá dài (tối đa 200 ký tự).`);
      continue;
    }
    let nguonId: string | null = null;
    if (r.nguon_id !== undefined && r.nguon_id !== null && r.nguon_id !== "") {
      if (typeof r.nguon_id !== "string") {
        dsLoi.push(`tham_chieu[${i}].nguon_id phải là chuỗi.`);
        continue;
      }
      if (!layNguon(db, r.nguon_id)) {
        dsLoi.push(`tham_chieu[${i}].nguon_id '${r.nguon_id}' không tồn tại.`);
        continue;
      }
      nguonId = r.nguon_id;
    }
    const ghiChu = typeof r.ghi_chu === "string" ? r.ghi_chu.trim() : "";
    if (ghiChu.length > 500) {
      dsLoi.push(`tham_chieu[${i}].ghi_chu quá dài (tối đa 500 ký tự).`);
      continue;
    }
    ds.push({ id, tham_chieu: tc, ban_dich: bd, nguon_id: nguonId, ghi_chu: ghiChu });
  }
  return ds;
}

// Đọc + validate mục lục từ request: định dạng phải trong registry, đối
// tượng phải tồn tại, hai mục cùng danh tính đầu ra (dinh_dang + đối tượng
// + đích đến) là trùng — một đầu ra chỉ có một khay.
export function kiemTraMucLuc(
  db: Database,
  body: unknown,
  dsLoi: string[],
): MucLuc[] | undefined {
  if (body === undefined) return undefined;
  if (!Array.isArray(body)) {
    dsLoi.push("muc_luc phải là mảng các mục.");
    return undefined;
  }
  const ds: MucLuc[] = [];
  const daCoId = new Set<string>();
  const daCoKhoa = new Set<string>();
  for (const [i, x] of body.entries()) {
    if (typeof x !== "object" || x === null || Array.isArray(x)) {
      dsLoi.push(`muc_luc[${i}] phải là object.`);
      continue;
    }
    const r = x as Record<string, unknown>;
    const id = typeof r.id === "string" && r.id.trim() ? r.id.trim() : `muc${i + 1}`;
    if (daCoId.has(id)) {
      dsLoi.push(`muc_luc[${i}].id '${id}' trùng với mục trước.`);
      continue;
    }
    daCoId.add(id);
    const tieuDe = typeof r.tieu_de === "string" ? r.tieu_de.trim() : "";
    if (!tieuDe) {
      dsLoi.push(`muc_luc[${i}].tieu_de bắt buộc.`);
      continue;
    }
    if (tieuDe.length > 200) {
      dsLoi.push(`muc_luc[${i}].tieu_de quá dài (tối đa 200 ký tự).`);
      continue;
    }
    const dd = typeof r.dinh_dang === "string" ? r.dinh_dang : "";
    if (!dd || !layDinhDang(dd)) {
      dsLoi.push(
        `muc_luc[${i}].dinh_dang '${dd}' không hợp lệ. Cho phép: ${DANH_SACH_DINH_DANG.join(", ")}.`,
      );
      continue;
    }
    let doiTuongId: string | null = null;
    if (r.doi_tuong_id !== undefined && r.doi_tuong_id !== null && r.doi_tuong_id !== "") {
      if (typeof r.doi_tuong_id !== "string") {
        dsLoi.push(`muc_luc[${i}].doi_tuong_id phải là chuỗi.`);
        continue;
      }
      if (!layDoiTuong(db, r.doi_tuong_id)) {
        dsLoi.push(`muc_luc[${i}].doi_tuong_id '${r.doi_tuong_id}' không tồn tại.`);
        continue;
      }
      doiTuongId = r.doi_tuong_id;
    }
    const dichDen = typeof r.dich_den === "string" ? r.dich_den.trim() : "";
    if (dichDen.length > 120) {
      dsLoi.push(`muc_luc[${i}].dich_den quá dài (tối đa 120 ký tự).`);
      continue;
    }
    const khoa = `${dd}|${doiTuongId ?? ""}|${dichDen}`;
    if (daCoKhoa.has(khoa)) {
      dsLoi.push(
        `muc_luc[${i}] trùng khay đầu ra (cùng định dạng '${dd}' + đối tượng + đích đến '${dichDen}').`,
      );
      continue;
    }
    daCoKhoa.add(khoa);
    const lyDo = typeof r.ly_do === "string" ? r.ly_do.trim() : "";
    if (lyDo.length > 500) {
      dsLoi.push(`muc_luc[${i}].ly_do quá dài (tối đa 500 ký tự).`);
      continue;
    }
    ds.push({
      id,
      tieu_de: tieuDe,
      dinh_dang: dd,
      doi_tuong_id: doiTuongId,
      dich_den: dichDen,
      ly_do: lyDo,
    });
  }
  return ds;
}

// --- Hồ sơ đối tượng thiếu niên ---

// Hồ sơ "độc giả trẻ/thiếu niên": nhận diện qua từ khóa trên tên + hồ sơ —
// deterministic, giải thích được (cùng tinh thần LUAT_DE_XUAT của luồng).
export const RE_THIEU_NIEN =
  /thiếu\s*niên|thanh\s*thiếu\s*niên|teen|trẻ\s*em|độc\s*giả\s*trẻ|trẻ\b/i;

export function timHoSoThieuNien(db: Database): HoSoDoiTuong | null {
  return (
    danhSachDoiTuong(db).find((d) =>
      RE_THIEU_NIEN.test(
        `${d.ten} ${d.tu_vung} ${d.moi_quan_tam} ${d.kien_thuc_nen} ${d.nhan_khau_hoc}`,
      ),
    ) ?? null
  );
}

// --- Mục lục đề xuất ---

// Mẫu mục lục đề xuất của một số (8 khay theo story #8). Id cố định để
// chọn/lọc lặp lại được; biên tập sửa xóa thêm tự do trước khi nháp.
export function deXuatMucLuc(db: Database, cp: Campaign): MucLuc[] {
  const dtChinh = cp.doi_tuong_id;
  const dtThieuNien = timHoSoThieuNien(db);
  const ds: MucLuc[] = [
    {
      id: "muc-bai-chinh",
      tieu_de: "Bài chính",
      dinh_dang: "bai-viet",
      doi_tuong_id: dtChinh,
      dich_den: "",
      ly_do: "Bài dẫn chủ đề số báo.",
    },
    {
      id: "muc-hoc-tai-lieu",
      tieu_de: "Học tài liệu nền",
      dinh_dang: "hoc-tai-lieu",
      doi_tuong_id: dtChinh,
      dich_den: "",
      ly_do: "Bài học đi sát các đoạn tham chiếu đã khai báo.",
    },
    {
      id: "muc-giai-thich-tn",
      tieu_de: "Giải thích cho thiếu niên",
      dinh_dang: "giai-thich-thieu-nien",
      doi_tuong_id: dtThieuNien?.id ?? null,
      dich_den: "",
      ly_do: "Diễn giải đơn giản cho độc giả trẻ — giữ diễn giải/bằng chứng đã duyệt.",
    },
    {
      id: "muc-hoi-dap",
      tieu_de: "Hỏi-đáp độc giả",
      dinh_dang: "hoi-dap-doc-gia",
      doi_tuong_id: dtChinh,
      dich_den: "",
      ly_do: "Chuyên mục giải đáp câu hỏi độc giả quanh chủ đề số.",
    },
    {
      id: "muc-ban-web",
      tieu_de: "Bản website",
      dinh_dang: "bai-viet",
      doi_tuong_id: dtChinh,
      dich_den: "website",
      ly_do: "Bản web của bài chính phục vụ trang nội bộ /p/…",
    },
    {
      id: "muc-newsletter",
      tieu_de: "Newsletter",
      dinh_dang: "newsletter",
      doi_tuong_id: dtChinh,
      dich_den: "",
      ly_do: "Bản tin email dẫn vào số báo.",
    },
    {
      id: "muc-chuoi-social",
      tieu_de: "Chuỗi social",
      dinh_dang: "chuoi-social",
      doi_tuong_id: dtChinh,
      dich_den: "mxh",
      ly_do: "Chuỗi bài mạng xã hội kéo độc giả về số.",
    },
    {
      id: "muc-script-thao-luan",
      tieu_de: "Script thảo luận/video",
      dinh_dang: "script-thao-luan",
      doi_tuong_id: dtChinh,
      dich_den: "video",
      ly_do: "Script nhóm thảo luận hoặc video mở số.",
    },
  ];
  return ds;
}

// --- Thông điệp chủ đề của số ---

// Thông điệp chủ đề = thong_diep đầu tiên (sớm nhất) của campaign — một số
// báo luôn có đúng một chủ đề; bài viết khác của số có thể là thong_diep
// riêng trong cùng campaign.
export function thongDiepChuDe(db: Database, cp: Campaign): ThongDiep | null {
  const ds = danhSachThongDiep(db, cp.id);
  return ds.length > 0 ? ds[ds.length - 1]! : null;
}

// Lấy hoặc tạo thông điệp chủ đề cho số báo. Khi tạo: gắn tất cả nguồn
// tham chiếu đã có văn bản để bộ sinh đối chiếu trích dẫn với nguồn thật.
// Khi đã có: bảo đảm nguồn tham chiếu mới được link vào thông điệp (không
// gỡ link biên tập đã thêm tay).
export function damBaoThongDiepChuDe(db: Database, cp: Campaign, tacGia: string): ThongDiep {
  return txn(db, () => {
    const nguonIds = cp.tham_chieu
      .map((t) => t.nguon_id)
      .filter((x): x is string => !!x && !!layNguon(db, x));
    const cu = thongDiepChuDe(db, cp);
    if (!cu) {
      const tieuDe =
        `Số ${cp.so_thu_tu ?? "?"}${cp.chu_de ? ` — ${cp.chu_de}` : ""}`.replace("Số ?", cp.ten) ||
        cp.ten;
      const td = taoThongDiep(
        db,
        {
          tieu_de: tieuDe,
          noi_dung:
            cp.mo_ta ||
            `Số ${cp.so_thu_tu ?? "?"}: ${cp.chu_de}${cp.lap_truong ? `\nLập trường biên tập: ${cp.lap_truong}` : ""}`,
          campaign_id: cp.id,
          nguon_ids: nguonIds,
        },
        tacGia,
      );
      ghiSuKien(db, "campaign", cp.id, "tao_thong_diep_chu_de", { thong_diep_id: td.id }, tacGia);
      return td;
    }
    // Bảo đảm link nguồn: union link hiện có + nguồn tham chiếu đã nạp.
    const linkHienCo = danhSachNguonIdsCuaThongDiep(db, cu.id);
    const thieu = nguonIds.filter((n) => !linkHienCo.includes(n));
    if (thieu.length > 0) {
      const moi = capNhatThongDiep(
        db,
        cu.id,
        {
          tieu_de: cu.tieu_de,
          noi_dung: cu.noi_dung,
          campaign_id: cp.id,
          nguon_ids: [...linkHienCo, ...thieu],
        },
        cu.head_revision_id ?? "",
        tacGia,
      );
      return moi;
    }
    return cu;
  });
}

function danhSachNguonIdsCuaThongDiep(db: Database, thongDiepId: string): string[] {
  return (
    db
      .query("SELECT nguon_id FROM thong_diep_nguon WHERE thong_diep_id = ?")
      .all(thongDiepId) as { nguon_id: string }[]
  ).map((r) => r.nguon_id);
}

// --- Trạng thái tham chiếu ---

// Tham chiếu "có văn bản" khi nguon_id trỏ tới nguồn còn tồn tại — trích
// dẫn/tham chiếu câu đối chiếu được với nguồn thật.
export type ThamChieuView = ThamChieu & {
  co_van_ban: boolean;
  nguon: { id: string; tieu_de: string } | null;
};

export function docThamChieuView(db: Database, cp: Campaign): ThamChieuView[] {
  return cp.tham_chieu.map((t) => {
    const n = t.nguon_id ? layNguon(db, t.nguon_id) : null;
    return { ...t, co_van_ban: !!n, nguon: n ? { id: n.id, tieu_de: n.tieu_de } : null };
  });
}

// --- Chọn mục lục → sinh ---

// Danh tính đầu ra của một mục: dùng chung khi map mục → bản thể hiện đã
// tồn tại (tienDo, goiY) và khi tạo/enqueue (chonMucLuc).
export function khoaDauRaMuc(
  db: Database,
  thongDiepId: string,
  muc: MucLuc,
): { thong_diep_id: string; dinh_dang: string; ngon_ngu: string; doi_tuong: string; dich_den: string } {
  const dtTen = muc.doi_tuong_id ? (layDoiTuong(db, muc.doi_tuong_id)?.ten ?? "") : "";
  return {
    thong_diep_id: thongDiepId,
    dinh_dang: muc.dinh_dang,
    ngon_ngu: "vi",
    doi_tuong: dtTen,
    dich_den: muc.dich_den,
  };
}

// Chọn các mục trong mục lục để nháp: find-or-create bản thể hiện dưới
// thông điệp chủ đề rồi enqueue job sinh (ghim head + khoa_idem theo bản —
// đúng quy tắc enqueue của luồng chung). Payload mang theo campaign_id để
// handler lấy lập trường biên tập + cờ thiếu văn bản từ số báo.
export function chonMucLuc(
  db: Database,
  campaignId: string,
  dsMucId: string[],
  tacGia: string,
): { ds_bth: BanTheHien[]; ds_job: Job[]; thong_diep: ThongDiep } {
  return txn(db, () => {
    const cp = layCampaign(db, campaignId);
    if (!cp) loiRequest(404, "KHONG_TIM_THAY", "Không tìm thấy campaign.");
    if (!Array.isArray(dsMucId) || dsMucId.length === 0) {
      loiRequest(400, "VALIDATION", "ds_muc_id phải là mảng id mục không rỗng.");
    }
    const dsLoi: string[] = [];
    const dsMuc = dsMucId.map((mid, i) => {
      const muc = cp.muc_luc.find((m) => m.id === mid);
      if (!muc) dsLoi.push(`ds_muc_id[${i}] '${mid}' không có trong mục lục.`);
      return muc;
    });
    // Validate lại định dạng/đối tượng tồn kho — hồ sơ có thể đã bị xóa
    // sau khi mục lục lưu.
    for (const [i, muc] of dsMuc.entries()) {
      if (!muc) continue;
      const dd = layDinhDang(muc.dinh_dang);
      if (!dd) {
        dsLoi.push(`ds_muc_id[${i}]: định dạng '${muc.dinh_dang}' không còn trong registry.`);
        continue;
      }
      const loiNg = kiemTraNgonNgu(dd, "vi");
      if (loiNg) dsLoi.push(`ds_muc_id[${i}]: ${loiNg}`);
      if (muc.doi_tuong_id && !layDoiTuong(db, muc.doi_tuong_id)) {
        dsLoi.push(`ds_muc_id[${i}]: đối tượng '${muc.doi_tuong_id}' không còn tồn tại.`);
      }
    }
    if (dsLoi.length > 0) throw new LoiApi(400, "VALIDATION", "ds_muc_id không hợp lệ.", dsLoi);

    const td = damBaoThongDiepChuDe(db, cp, tacGia);
    const dsBth: BanTheHien[] = [];
    const dsJob: Job[] = [];
    for (const muc of dsMuc as MucLuc[]) {
      const khoa = khoaDauRaMuc(db, td.id, muc);
      const bth = timBanTheHien(db, khoa) ?? taoBanTheHien(db, khoa, tacGia);
      dsBth.push(bth);
      const { job } = enqueueJob(db, {
        loai: "sinh_ban_the_hien",
        payload: {
          thong_diep_id: td.id,
          dinh_dang: muc.dinh_dang,
          ngon_ngu: "vi",
          doi_tuong: khoa.doi_tuong || undefined,
          doi_tuong_id: muc.doi_tuong_id ?? undefined,
          dich_den: muc.dich_den || undefined,
          thuong_hieu_id: cp.thuong_hieu_id ?? undefined,
          // Lập trường biên tập của số đi vào context sinh — bộ sinh áp
          // lập trường đã cấu hình, không ngầm áp diễn giải riêng.
          lap_truong: cp.lap_truong || undefined,
          campaign_id: cp.id,
          ghi_de: cp.ghi_de,
        },
        entityLoai: "ban_the_hien",
        entityId: bth.id,
        revisionId: bth.head_revision_id ?? null,
        khoaIdem: `sinh_ban_the_hien:${bth.id}`,
      });
      dsJob.push(job);
    }
    ghiSuKien(
      db,
      "campaign",
      cp.id,
      "chon_muc_luc",
      { so_muc: dsBth.length, ds_muc_id: dsMucId },
      tacGia,
    );
    return { ds_bth: dsBth, ds_job: dsJob, thong_diep: td };
  });
}

// --- Tiến độ cấp số ---

export type MucTienDo = {
  muc: MucLuc;
  ban_the_hien: BanTheHien | null;
  da_xuat_ban: boolean;
};

export type TienDoSoBao = {
  tong_muc: number;
  muc_co_dau_ra: number;
  tong_dau_ra: number;
  cho_duyet: number;
  da_duyet: number;
  da_xuat: number;
  muc: MucTienDo[];
};

// Tiến độ cấp số: mỗi mục mục lục resolve sang bản thể hiện theo danh tính;
// đếm theo trạng thái review + số bản đã xuất (record xuat_ban).
export function tienDoSoBao(db: Database, cp: Campaign): TienDoSoBao {
  const td = thongDiepChuDe(db, cp);
  const muc: MucTienDo[] = cp.muc_luc.map((m) => {
    const bth = td ? timBanTheHien(db, khoaDauRaMuc(db, td.id, m)) : null;
    const daXuat = bth
      ? (db
          .query("SELECT COUNT(*) AS c FROM xuat_ban WHERE ban_the_hien_id = ?")
          .get(bth.id) as { c: number }).c > 0
      : false;
    return { muc: m, ban_the_hien: bth, da_xuat_ban: daXuat };
  });
  const dsBth = td ? danhSachBanTheHien(db, { thongDiepId: td.id }) : [];
  return {
    tong_muc: cp.muc_luc.length,
    muc_co_dau_ra: muc.filter((m) => m.ban_the_hien !== null).length,
    tong_dau_ra: dsBth.length,
    cho_duyet: dsBth.filter((b) => b.trang_thai === "cho_duyet").length,
    da_duyet: dsBth.filter((b) => b.trang_thai === "da_duyet").length,
    da_xuat: dsBth.filter(
      (b) =>
        (
          db
            .query("SELECT COUNT(*) AS c FROM xuat_ban WHERE ban_the_hien_id = ?")
            .get(b.id) as { c: number }
        ).c > 0,
    ).length,
    muc,
  };
}

// --- Gợi ý khoảng trống nội dung ---

// Một gợi ý task từ khoảng trống: KHÔNG phải nội dung đã đặt hay đã duyệt —
// chỉ là đề xuất việc kèm lý do + bằng chứng để biên tập quyết định.
export type GoiYKhoangTrong = {
  id: string;
  loai: "thieu_van_ban_tham_chieu" | "thieu_giai_thich" | "thieu_hoc_tai_lieu";
  tieu_de: string;
  ly_do: string;
  bang_chung: string[];
  // Mục đề xuất để thêm vào mục lục khi gợi ý là "thiếu một đầu ra" —
  // vắng mặt khi gợi ý là "thiếu văn bản nguồn" (việc nạp nguồn, không
  // phải viết bài).
  de_xuat_muc?: MucLuc;
};

// Bản thể hiện "phủ" một khoảng trống khi còn ở vòng đời hữu dụng:
// nhap/cho_duyet/da_duyet hoặc đã xuất. tu_choi/thay_the KHÔNG phủ — bản bị
// từ chối không lấp khoảng trống, kể cả khi nó từng được xuất trước khi
// chuyển trạng thái.
function bthPhu(db: Database, thongDiepId: string, dinhDang: string): boolean {
  return danhSachBanTheHien(db, { thongDiepId }).some((b) => {
    if (b.dinh_dang !== dinhDang) return false;
    if (["tu_choi", "thay_the"].includes(b.trang_thai)) return false;
    if (["nhap", "cho_duyet", "da_duyet"].includes(b.trang_thai)) return true;
    const soXb = (
      db
        .query("SELECT COUNT(*) AS c FROM xuat_ban WHERE ban_the_hien_id = ?")
        .get(b.id) as { c: number }
    ).c;
    return soXb > 0;
  });
}

// Tính lại mỗi lần đọc (không lưu) — sửa số báo xong gợi ý tự cập nhật.
export function goiYKhoangTrong(db: Database, cp: Campaign): GoiYKhoangTrong[] {
  const ds: GoiYKhoangTrong[] = [];
  const td = thongDiepChuDe(db, cp);
  const tcView = docThamChieuView(db, cp);

  // 1) Tham chiếu đã khai báo mà chưa có văn bản nguồn → gắn cờ + gợi ý nạp.
  for (const t of tcView) {
    if (t.co_van_ban) continue;
    ds.push({
      id: `goi-y-tc-${t.id}`,
      loai: "thieu_van_ban_tham_chieu",
      tieu_de: `Thiếu văn bản nguồn cho '${t.tham_chieu}'`,
      ly_do: `Số báo khai báo tham chiếu '${t.tham_chieu}' (${t.ban_dich || "chưa rõ bản dịch"}) nhưng chưa nạp văn bản — trích dẫn và tham chiếu câu không đối chiếu được với nguồn thật.`,
      bang_chung: [`tham_chieu: ${t.tham_chieu}`, `ban_dich: ${t.ban_dich || "—"}`],
    });
  }

  if (!td) return ds; // chưa có thông điệp chủ đề → chưa đủ ngữ cảnh đoán khoảng trống đầu ra

  const coThamChieuCoVanBan = tcView.some((t) => t.co_van_ban);

  // 2) Có hồ sơ đối tượng thiếu niên + có tài liệu nền đã khai báo nhưng
  //    chưa có bản giải thích nào đang phục vụ → gợi ý viết bài giải thích.
  const dtThieuNien = timHoSoThieuNien(db);
  if (dtThieuNien && coThamChieuCoVanBan && !bthPhu(db, td.id, "giai-thich-thieu-nien")) {
    ds.push({
      id: "goi-y-thieu-giai-thich",
      loai: "thieu_giai_thich",
      tieu_de: `Thiếu bài giải thích cho ${dtThieuNien.ten}`,
      ly_do: `Số báo có tham chiếu nền và có hồ sơ đối tượng '${dtThieuNien.ten}' nhưng chưa có bài giải thích nào phục vụ đối tượng này.`,
      bang_chung: [
        `hồ sơ đối tượng: ${dtThieuNien.ten} (${dtThieuNien.id})`,
        `tham chiếu đã có văn bản: ${tcView.filter((t) => t.co_van_ban).map((t) => t.tham_chieu).join(", ")}`,
      ],
      de_xuat_muc: {
        id: "muc-giai-thich-tn",
        tieu_de: `Giải thích cho ${dtThieuNien.ten}`,
        dinh_dang: "giai-thich-thieu-nien",
        doi_tuong_id: dtThieuNien.id,
        dich_den: "",
        ly_do: "Khoảng trống phát hiện tự động — biên tập quyết định có nháp hay không.",
      },
    });
  }

  // 3) Có tham chiếu có văn bản nhưng chưa có bài học tài liệu nền → gợi ý.
  if (coThamChieuCoVanBan && !bthPhu(db, td.id, "hoc-tai-lieu")) {
    ds.push({
      id: "goi-y-thieu-hoc-tai-lieu",
      loai: "thieu_hoc_tai_lieu",
      tieu_de: "Thiếu bài học tài liệu nền",
      ly_do: "Số báo đã khai báo tham chiếu có văn bản nguồn nhưng chưa có bài học đi sát các đoạn này.",
      bang_chung: [
        `tham chiếu đã có văn bản: ${tcView.filter((t) => t.co_van_ban).map((t) => t.tham_chieu).join(", ")}`,
      ],
      de_xuat_muc: {
        id: "muc-hoc-tai-lieu",
        tieu_de: "Học tài liệu nền",
        dinh_dang: "hoc-tai-lieu",
        doi_tuong_id: cp.doi_tuong_id,
        dich_den: "",
        ly_do: "Khoảng trống phát hiện tự động — biên tập quyết định có nháp hay không.",
      },
    });
  }

  return ds;
}

// --- Thêm mục gợi ý vào mục lục ---

// Thêm một mục vào mục lục đã lưu (từ gợi ý hoặc tay). Trùng khóa đầu ra
// hoặc trùng id → 409/400 theo convention; trả campaign đã cập nhật.
export function themMucLuc(
  db: Database,
  campaignId: string,
  muc: MucLuc,
  tacGia: string,
): Campaign {
  return txn(db, () => {
    const cp = layCampaign(db, campaignId);
    if (!cp) loiRequest(404, "KHONG_TIM_THAY", "Không tìm thấy campaign.");
    const dsLoi: string[] = [];
    const dsMoi = kiemTraMucLuc(db, [muc], dsLoi);
    if (dsLoi.length > 0 || !dsMoi || dsMoi.length === 0) {
      throw new LoiApi(400, "VALIDATION", "Mục thêm không hợp lệ.", dsLoi);
    }
    const moi = dsMoi[0]!;
    if (cp.muc_luc.some((m) => m.id === moi.id)) {
      throw new LoiApi(409, "XUNG_DOT_TRANG_THAI", `Mục lục đã có mục id '${moi.id}'.`);
    }
    const khoaMoi = `${moi.dinh_dang}|${moi.doi_tuong_id ?? ""}|${moi.dich_den}`;
    if (
      cp.muc_luc.some(
        (m) => `${m.dinh_dang}|${m.doi_tuong_id ?? ""}|${m.dich_den}` === khoaMoi,
      )
    ) {
      throw new LoiApi(
        409,
        "XUNG_DOT_TRANG_THAI",
        `Mục lục đã có khay đầu ra '${moi.dinh_dang}' với cùng đối tượng và đích đến.`,
      );
    }
    const mucLuc = [...cp.muc_luc, moi];
    db.query("UPDATE campaign SET muc_luc = ?, cap_nhat_luc = ?, cap_nhat_boi = ? WHERE id = ?").run(
      JSON.stringify(mucLuc),
      bayGio(),
      tacGia,
      campaignId,
    );
    ghiSuKien(db, "campaign", campaignId, "them_muc_luc", { muc_id: moi.id }, tacGia);
    return layCampaign(db, campaignId)!;
  });
}

// --- Liên kết nguồn cho tham chiếu ---

// Gán nguồn văn bản cho một tham chiếu đã khai báo (chữa cờ thiếu văn
// bản): cập nhật tham_chieu + bảo đảm nguồn được link vào thông điệp chủ
// đề để bộ sinh/đối chiếu thấy văn bản thật.
export function lienKetNguonThamChieu(
  db: Database,
  campaignId: string,
  refId: string,
  nguonId: string,
  tacGia: string,
): Campaign {
  return txn(db, () => {
    const cp = layCampaign(db, campaignId);
    if (!cp) loiRequest(404, "KHONG_TIM_THAY", "Không tìm thấy campaign.");
    const nguon = layNguon(db, nguonId);
    if (!nguon) loiRequest(400, "VALIDATION", `Nguồn '${nguonId}' không tồn tại.`);
    const idx = cp.tham_chieu.findIndex((t) => t.id === refId);
    if (idx < 0) loiRequest(404, "KHONG_TIM_THAY", `Tham chiếu '${refId}' không có trên số báo.`);
    const dsTc = cp.tham_chieu.map((t, i) =>
      i === idx ? { ...t, nguon_id: nguonId } : t,
    );
    db.query(
      "UPDATE campaign SET tham_chieu = ?, cap_nhat_luc = ?, cap_nhat_boi = ? WHERE id = ?",
    ).run(JSON.stringify(dsTc), bayGio(), tacGia, campaignId);
    // Link nguồn vào thông điệp chủ đề (tạo td nếu chưa có).
    const cpMoi = layCampaign(db, campaignId)!;
    damBaoThongDiepChuDe(db, cpMoi, tacGia);
    ghiSuKien(
      db,
      "campaign",
      campaignId,
      "lien_ket_tham_chieu",
      { tham_chieu_id: refId, nguon_id: nguonId },
      tacGia,
    );
    return cpMoi;
  });
}

// --- Lập trường đi vào context sinh ---

// Lập trường + cờ thiếu văn bản tham chiếu cho lần sinh nằm trong
// lapContextNoiDung (generation/context.ts): payload.campaign_id ưu tiên,
// fallback thong_diep.campaign_id.

// Kiểm hồ sơ tham chiếu ở campaign — api.ts gọi trước khi tạo/cập nhật.
export function kiemTraHoSoSoBao(
  db: Database,
  body: { thuong_hieu_id?: unknown; doi_tuong_id?: unknown },
  dsLoi: string[],
): void {
  if (
    body.thuong_hieu_id !== undefined &&
    body.thuong_hieu_id !== null &&
    body.thuong_hieu_id !== ""
  ) {
    if (typeof body.thuong_hieu_id !== "string") {
      dsLoi.push("thuong_hieu_id phải là chuỗi.");
    } else if (!layThuongHieu(db, body.thuong_hieu_id)) {
      dsLoi.push(`thuong_hieu_id '${body.thuong_hieu_id}' không tồn tại.`);
    }
  }
  if (
    body.doi_tuong_id !== undefined &&
    body.doi_tuong_id !== null &&
    body.doi_tuong_id !== ""
  ) {
    if (typeof body.doi_tuong_id !== "string") {
      dsLoi.push("doi_tuong_id phải là chuỗi.");
    } else if (!layDoiTuong(db, body.doi_tuong_id)) {
      dsLoi.push(`doi_tuong_id '${body.doi_tuong_id}' không tồn tại.`);
    }
  }
}
