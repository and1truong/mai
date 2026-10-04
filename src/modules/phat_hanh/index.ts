import type { Database } from "bun:sqlite";
import {
  capNhatNguon,
  capNhatThongDiep,
  ghiSuKien,
  layCampaign,
  layNguon,
  layNguonRevision,
  layThongDiepRevision,
  taoNguon,
  taoThongDiep,
  type Campaign,
  type CtaLienKet,
  type FactPhatHanh,
  type GioiHanPhatHanh,
  type MucLuc,
  type MucNguon,
  type Nguon,
  type ThongDiep,
} from "../content/index.ts";
import { danhSachDoiTuong, type HoSoDoiTuong } from "../context/index.ts";
import { thongDiepChuDe } from "../so_bao/index.ts";

// Module phát hành (#9): một bản phát hành phần mềm B2B = một campaign
// loai 'phat_hanh' gắn phiên bản, ngày, định vị đã duyệt, giới hạn
// gói/vùng/khả dụng, link CTA sửa được và danh sách fact tính năng có
// bằng chứng nguồn. Mọi đầu ra được sinh dưới một thông điệp chủ đề
// (dùng lại luồng chọn/nháp/duyệt/xuất của số báo).
//
// Nguồn phát hành tự động: module chiếu field release thành một nguon
// loại 'fact' (cac_muc có id ổn định 'ph-*') rồi link vào thông điệp chủ
// đề. Nhờ đó:
// - mọi đầu ra sinh ra pin fact release trong chuỗi provenance;
// - sửa field release → revision nguồn mới → phatHienThayDoiNguon (#14)
//   đánh dấu các bản thể hiện phụ thuộc = "vô hiệu hóa nguồn" của story.
// - fact chưa xác nhận (không nguon_id, hoặc nguồn không vào context)
//   đi vào ContextTask.phat_hanh với xac_nhan=false → bộ sinh để
//   [CÂU HỎI], kiemTraDauRa cảnh báo khi claim trình bày như sự thật.

// Bọc ghi trong transaction — lặp lại helper của content (private).
function txn<T>(db: Database, fn: () => T): T {
  if (db.inTransaction) return fn();
  db.exec("BEGIN IMMEDIATE");
  try {
    const r = fn();
    db.exec("COMMIT");
    return r;
  } catch (e) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // transaction đã rollback
    }
    throw e;
  }
}

export function laPhatHanh(cp: Campaign | null | undefined): boolean {
  return !!cp && cp.loai === "phat_hanh";
}

// --- Validation input release ---

const RE_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const LOAI_GIOI_HAN = ["", "goi", "vung", "kha_dung"];
const LOAI_CTA = ["", "tai_lieu", "nang_cap", "ho_tro"];
const DAI_TOI_DA = { tinh_nang: 200, mo_ta: 500, nhan: 200, url: 500, fact: 2000 };

// Đọc mảng giới hạn từ body — undefined = không gửi (PUT partial giữ giá
// trị cũ). Phần tử sai → lỗi validation, không im lặng lọc.
export function kiemTraGioiHan(v: unknown, dsLoi: string[]): GioiHanPhatHanh[] | undefined {
  if (v === undefined) return undefined;
  if (!Array.isArray(v)) {
    dsLoi.push("gioi_han phải là một mảng.");
    return undefined;
  }
  const ds: GioiHanPhatHanh[] = [];
  const daCo = new Set<string>();
  for (const [i, dong] of v.entries()) {
    if (typeof dong !== "object" || dong === null || Array.isArray(dong)) {
      dsLoi.push(`gioi_han[${i}] phải là object.`);
      continue;
    }
    const g = dong as Record<string, unknown>;
    const id = typeof g.id === "string" && g.id ? g.id.trim() : `gh${i + 1}`;
    if (!RE_ID.test(id)) dsLoi.push(`gioi_han[${i}].id '${id}' không hợp lệ (a-z0-9_-, tối đa 64).`);
    if (daCo.has(id)) dsLoi.push(`gioi_han[${i}].id '${id}' trùng với dòng khác.`);
    daCo.add(id);
    const tinhNang = typeof g.tinh_nang === "string" ? g.tinh_nang.trim() : "";
    const moTa = typeof g.mo_ta === "string" ? g.mo_ta.trim() : "";
    if (!tinhNang) dsLoi.push(`gioi_han[${i}].tinh_nang là bắt buộc.`);
    if (tinhNang.length > DAI_TOI_DA.tinh_nang) {
      dsLoi.push(`gioi_han[${i}].tinh_nang vượt ${DAI_TOI_DA.tinh_nang} ký tự.`);
    }
    if (!moTa) dsLoi.push(`gioi_han[${i}].mo_ta là bắt buộc.`);
    if (moTa.length > DAI_TOI_DA.mo_ta) {
      dsLoi.push(`gioi_han[${i}].mo_ta vượt ${DAI_TOI_DA.mo_ta} ký tự.`);
    }
    const loai = typeof g.loai === "string" ? g.loai.trim() : "";
    if (!LOAI_GIOI_HAN.includes(loai)) {
      dsLoi.push(`gioi_han[${i}].loai '${loai}' không hợp lệ. Cho phép: goi, vung, kha_dung hoặc để trống.`);
    }
    ds.push({ id, tinh_nang: tinhNang, loai, mo_ta: moTa });
  }
  return ds;
}

export function kiemTraCta(v: unknown, dsLoi: string[]): CtaLienKet[] | undefined {
  if (v === undefined) return undefined;
  if (!Array.isArray(v)) {
    dsLoi.push("cta phải là một mảng.");
    return undefined;
  }
  const ds: CtaLienKet[] = [];
  const daCo = new Set<string>();
  for (const [i, dong] of v.entries()) {
    if (typeof dong !== "object" || dong === null || Array.isArray(dong)) {
      dsLoi.push(`cta[${i}] phải là object.`);
      continue;
    }
    const c = dong as Record<string, unknown>;
    const id = typeof c.id === "string" && c.id ? c.id.trim() : `cta${i + 1}`;
    if (!RE_ID.test(id)) dsLoi.push(`cta[${i}].id '${id}' không hợp lệ (a-z0-9_-, tối đa 64).`);
    if (daCo.has(id)) dsLoi.push(`cta[${i}].id '${id}' trùng với dòng khác.`);
    daCo.add(id);
    const nhan = typeof c.nhan === "string" ? c.nhan.trim() : "";
    const url = typeof c.url === "string" ? c.url.trim() : "";
    if (!nhan) dsLoi.push(`cta[${i}].nhan là bắt buộc.`);
    if (nhan.length > DAI_TOI_DA.nhan) dsLoi.push(`cta[${i}].nhan vượt ${DAI_TOI_DA.nhan} ký tự.`);
    if (!url) dsLoi.push(`cta[${i}].url là bắt buộc.`);
    else if (!/^https?:\/\//.test(url) && !url.startsWith("/")) {
      dsLoi.push(`cta[${i}].url '${url}' phải là link http(s) hoặc đường dẫn nội bộ.`);
    }
    if (url.length > DAI_TOI_DA.url) dsLoi.push(`cta[${i}].url vượt ${DAI_TOI_DA.url} ký tự.`);
    const loai = typeof c.loai === "string" ? c.loai.trim() : "";
    if (!LOAI_CTA.includes(loai)) {
      dsLoi.push(`cta[${i}].loai '${loai}' không hợp lệ. Cho phép: tai_lieu, nang_cap, ho_tro hoặc để trống.`);
    }
    ds.push({ id, nhan, loai, url });
  }
  return ds;
}

// ds_fact: fact tính năng + bằng chứng nguồn. nguon_id đặt thì phải tồn
// tại; muc_id đặt thì phải có trong cac_muc của nguồn đó — con trỏ bằng
// chứng sai không được lưu lặng.
export function kiemTraDsFact(
  db: Database,
  v: unknown,
  dsLoi: string[],
): FactPhatHanh[] | undefined {
  if (v === undefined) return undefined;
  if (!Array.isArray(v)) {
    dsLoi.push("ds_fact phải là một mảng.");
    return undefined;
  }
  const ds: FactPhatHanh[] = [];
  const daCo = new Set<string>();
  for (const [i, dong] of v.entries()) {
    if (typeof dong !== "object" || dong === null || Array.isArray(dong)) {
      dsLoi.push(`ds_fact[${i}] phải là object.`);
      continue;
    }
    const f = dong as Record<string, unknown>;
    const id = typeof f.id === "string" && f.id ? f.id.trim() : `f${i + 1}`;
    if (!RE_ID.test(id)) dsLoi.push(`ds_fact[${i}].id '${id}' không hợp lệ (a-z0-9_-, tối đa 64).`);
    if (daCo.has(id)) dsLoi.push(`ds_fact[${i}].id '${id}' trùng với dòng khác.`);
    daCo.add(id);
    const tinhNang = typeof f.tinh_nang === "string" ? f.tinh_nang.trim() : "";
    const noiDung = typeof f.noi_dung === "string" ? f.noi_dung.trim() : "";
    if (!tinhNang) dsLoi.push(`ds_fact[${i}].tinh_nang là bắt buộc.`);
    if (tinhNang.length > DAI_TOI_DA.tinh_nang) {
      dsLoi.push(`ds_fact[${i}].tinh_nang vượt ${DAI_TOI_DA.tinh_nang} ký tự.`);
    }
    if (!noiDung) dsLoi.push(`ds_fact[${i}].noi_dung là bắt buộc.`);
    if (noiDung.length > DAI_TOI_DA.fact) {
      dsLoi.push(`ds_fact[${i}].noi_dung vượt ${DAI_TOI_DA.fact} ký tự.`);
    }
    let nguonId: string | null = null;
    if (f.nguon_id !== undefined && f.nguon_id !== null && f.nguon_id !== "") {
      if (typeof f.nguon_id !== "string") {
        dsLoi.push(`ds_fact[${i}].nguon_id phải là chuỗi.`);
      } else {
        const n = layNguon(db, f.nguon_id);
        if (!n) {
          dsLoi.push(`ds_fact[${i}].nguon_id '${f.nguon_id}' không tồn tại.`);
        } else {
          nguonId = n.id;
          if (f.muc_id !== undefined && f.muc_id !== null && f.muc_id !== "") {
            if (typeof f.muc_id !== "string") {
              dsLoi.push(`ds_fact[${i}].muc_id phải là chuỗi.`);
            } else if (!n.cac_muc.some((m) => m.id === f.muc_id)) {
              dsLoi.push(
                `ds_fact[${i}].muc_id '${f.muc_id}' không có trong cac_muc của nguồn '${n.tieu_de}'.`,
              );
            }
          }
        }
      }
    }
    if (!nguonId && f.muc_id !== undefined && f.muc_id !== null && f.muc_id !== "") {
      dsLoi.push(`ds_fact[${i}].muc_id yêu cầu kèm nguon_id.`);
    }
    const mucId =
      typeof f.muc_id === "string" && f.muc_id && nguonId ? f.muc_id.trim() : null;
    ds.push({ id, tinh_nang: tinhNang, noi_dung: noiDung, nguon_id: nguonId, muc_id: mucId });
  }
  return ds;
}

// --- Nguồn phát hành tự động ---

// Chiếu field release → một nguon 'fact' xác định (deterministic): mỗi
// field/fact/giới hạn/CTA là một mục có id ổn định để diff revision chỉ
// đúng mục đổi. noi_dung là bản text phẳng của cùng dữ liệu.
export function xayDungNguonPhatHanh(cp: Campaign): {
  tieu_de: string;
  noi_dung: string;
  cac_muc: MucNguon[];
} {
  const muc: MucNguon[] = [
    {
      id: "ph-phien-ban",
      loai: "fact",
      tieu_de: "Phiên bản",
      noi_dung: cp.phien_ban || "(chưa đặt)",
      assets: [],
    },
    {
      id: "ph-ngay",
      loai: "fact",
      tieu_de: "Ngày phát hành",
      noi_dung: cp.ngay_phat_hanh || "(chưa đặt)",
      assets: [],
    },
  ];
  if (cp.dinh_vi) {
    muc.push({
      id: "ph-dinh-vi",
      loai: "section",
      tieu_de: "Định vị đã duyệt",
      noi_dung: cp.dinh_vi,
      assets: [],
    });
  }
  for (const f of cp.ds_fact) {
    muc.push({
      id: `ph-f-${f.id}`,
      loai: "fact",
      tieu_de: `Fact: ${f.tinh_nang}`,
      noi_dung: f.nguon_id ? f.noi_dung : `${f.noi_dung} (CHƯA XÁC NHẬN — cần bằng chứng nguồn)`,
      assets: [],
    });
  }
  for (const g of cp.gioi_han) {
    muc.push({
      id: `ph-gh-${g.id}`,
      loai: "fact",
      tieu_de: `Giới hạn: ${g.tinh_nang}`,
      noi_dung: g.mo_ta,
      assets: [],
    });
  }
  for (const c of cp.cta) {
    muc.push({
      id: `ph-cta-${c.id}`,
      loai: "fact",
      tieu_de: `CTA: ${c.nhan}`,
      noi_dung: c.url,
      assets: [],
    });
  }
  const dong = [
    `Bản phát hành ${cp.ten}${cp.phien_ban ? ` ${cp.phien_ban}` : ""}${cp.ngay_phat_hanh ? ` — phát hành ${cp.ngay_phat_hanh}` : ""}.`,
    cp.dinh_vi ? `Định vị đã duyệt: ${cp.dinh_vi}` : "",
    ...cp.ds_fact.map(
      (f) => `Fact ${f.tinh_nang}: ${f.noi_dung}${f.nguon_id ? "" : " [chưa xác nhận]"}`,
    ),
    ...cp.gioi_han.map((g) => `Giới hạn ${g.tinh_nang}: ${g.mo_ta}`),
    ...cp.cta.map((c) => `CTA ${c.nhan}: ${c.url}`),
  ].filter(Boolean);
  return {
    tieu_de: `Phát hành ${cp.ten} — fact`,
    noi_dung: dong.join("\n"),
    cac_muc: muc,
  };
}

// Tạo/cập nhật nguồn phát hành tự động. Nội dung + cac_muc giống head
// hiện tại → bỏ qua (PUT không đổi field release không sinh revision rác).
// da_doi=true nghĩa là revision nguồn mới — caller chạy phát hiện #14.
export function dongBoNguonPhatHanh(
  db: Database,
  cp: Campaign,
  tacGia: string,
): { nguon: Nguon; da_doi: boolean } {
  const xd = xayDungNguonPhatHanh(cp);
  const taoMoi = (): { nguon: Nguon; da_doi: boolean } => {
    const nguon = taoNguon(
      db,
      { tieu_de: xd.tieu_de, noi_dung: xd.noi_dung, loai: "fact", cac_muc: xd.cac_muc },
      tacGia,
    );
    db.query("UPDATE campaign SET nguon_phat_hanh_id = ? WHERE id = ?").run(nguon.id, cp.id);
    ghiSuKien(db, "campaign", cp.id, "tao_nguon_phat_hanh", { nguon_id: nguon.id }, tacGia);
    return { nguon, da_doi: true };
  };
  if (!cp.nguon_phat_hanh_id) return taoMoi();
  const nguon = layNguon(db, cp.nguon_phat_hanh_id);
  if (!nguon) return taoMoi(); // nguồn tự động bị xóa tay → chiếu lại
  const head = nguon.head_revision_id ? layNguonRevision(db, nguon.head_revision_id) : null;
  if (
    head &&
    head.noi_dung === xd.noi_dung &&
    JSON.stringify(head.cac_muc) === JSON.stringify(xd.cac_muc)
  ) {
    return { nguon, da_doi: false };
  }
  const moi = capNhatNguon(
    db,
    nguon.id,
    { tieu_de: xd.tieu_de, noi_dung: xd.noi_dung, loai: "fact", cac_muc: xd.cac_muc },
    nguon.head_revision_id,
    tacGia,
  );
  ghiSuKien(
    db,
    "campaign",
    cp.id,
    "dong_bo_nguon_phat_hanh",
    { nguon_id: moi.id, head_revision_id: moi.head_revision_id },
    tacGia,
  );
  return { nguon: moi, da_doi: true };
}

// --- Thông điệp chủ đề của bản phát hành ---

function dsNguonIdsCuaThongDiep(db: Database, thongDiepId: string): string[] {
  return (
    db
      .query("SELECT nguon_id FROM thong_diep_nguon WHERE thong_diep_id = ?")
      .all(thongDiepId) as { nguon_id: string }[]
  ).map((r) => r.nguon_id);
}

// Danh sách nguồn chủ đề phải link: nguồn phát hành tự động + nguồn đã
// gán cho các tài liệu tham chiếu (changelog, tài liệu sản phẩm…) + nguồn
// bằng chứng của từng fact — fact trỏ nguồn hợp lệ phải nằm trong
// provenance thông điệp để bộ sinh coi fact là đã xác nhận, khớp cờ
// co_bang_chung mà UI hiển thị.
function dsNguonBatBuoc(db: Database, cp: Campaign): string[] {
  const ds: string[] = [];
  const them = (id: string | null | undefined) => {
    if (id && !ds.includes(id) && layNguon(db, id)) ds.push(id);
  };
  them(cp.nguon_phat_hanh_id);
  for (const t of cp.tham_chieu) them(t.nguon_id);
  for (const f of cp.ds_fact) them(f.nguon_id);
  return ds;
}

// Lấy hoặc tạo thông điệp chủ đề của bản phát hành. Khi đã có: union link
// nguồn mới + refresh revision thông điệp khi pin nguồn cũ — nguồn phát
// hành vừa đổi revision thì head thông điệp phải ghim bản mới để đầu ra
// sinh sau đó đọc fact mới (đầu ra cũ vẫn pin bản cũ → #14 đánh dấu).
export function damBaoThongDiepPhatHanh(
  db: Database,
  cp: Campaign,
  tacGia: string,
): ThongDiep {
  return txn(db, () => {
    const moi = layCampaign(db, cp.id)!; // đọc lại sau khi gán nguon_phat_hanh_id
    const batBuoc = dsNguonBatBuoc(db, moi);
    const cu = thongDiepChuDe(db, moi);
    const tieuDe = `Phát hành ${moi.ten}`;
    if (!cu) {
      const td = taoThongDiep(
        db,
        {
          tieu_de: tieuDe,
          noi_dung:
            moi.mo_ta ||
            `Bản phát hành ${moi.ten}${moi.phien_ban ? ` ${moi.phien_ban}` : ""}${moi.ngay_phat_hanh ? ` — ${moi.ngay_phat_hanh}` : ""}.${moi.dinh_vi ? `\nĐịnh vị: ${moi.dinh_vi}` : ""}`,
          campaign_id: moi.id,
          nguon_ids: batBuoc,
        },
        tacGia,
      );
      ghiSuKien(db, "campaign", moi.id, "tao_thong_diep_chu_de", { thong_diep_id: td.id }, tacGia);
      return td;
    }
    const linkHienCo = dsNguonIdsCuaThongDiep(db, cu.id);
    const union = [...linkHienCo];
    for (const id of batBuoc) {
      if (!union.includes(id)) union.push(id);
    }
    const pinned = cu.head_revision_id
      ? (layThongDiepRevision(db, cu.head_revision_id)?.nguon_revision_ids ?? [])
      : [];
    const heads = union
      .map((id) => layNguon(db, id)?.head_revision_id)
      .filter((x): x is string => !!x);
    const pinMoi = pinned.length === heads.length && pinned.every((p) => heads.includes(p));
    const linkMoi = union.length !== linkHienCo.length;
    if (!linkMoi && pinMoi) return cu;
    return capNhatThongDiep(
      db,
      cu.id,
      { tieu_de: cu.tieu_de, noi_dung: cu.noi_dung, campaign_id: moi.id, nguon_ids: union },
      cu.head_revision_id ?? "",
      tacGia,
    );
  });
}

// --- Đề xuất đầu ra theo đối tượng ---

// Tìm hồ sơ đối tượng theo từ khóa: khớp `ten` trước (định danh rõ nhất),
// rồi mới các field mô tả — tránh gắn nhầm hồ sơ khớp keyword ở field phụ
// nhưng tên thuộc persona khác. Không có hồ sơ → null (đầu ra vẫn tạo
// được, context chỉ thiếu hồ sơ).
function timDoiTuong(db: Database, re: RegExp): HoSoDoiTuong | null {
  const ds = danhSachDoiTuong(db);
  return (
    ds.find((d) => re.test(d.ten)) ??
    ds.find((d) =>
      re.test(`${d.moi_quan_tam} ${d.kien_thuc_nen} ${d.nhu_cau_giao_tiep} ${d.nhan_khau_hoc}`),
    ) ??
    null
  );
}

// Regex hẹp cố ý: chỉ khớp persona chuyên developer — từ chung ("kỹ thuật",
// "tích hợp") đụng tên hồ sơ khác ("Lãnh đạo kỹ thuật") và gắn nhầm persona.
const RE_DEV = /dev|developer|lập\s*trình|engineer/i;
const RE_TIEM_NANG = /tiềm\s*năng|prospect|khách\s*hàng\s*mới/i;
const RE_BAO_MAT = /bảo\s*mật|an\s*ninh|security|ciso|mua\s*bảo\s*mật/i;
const RE_SALES = /sales|bán\s*hàng|kinh\s*doanh/i;
const RE_SUPPORT = /support|hỗ\s*trợ|chăm\s*sóc/i;
const RE_KHACH_HANG = /khách\s*hàng|customer|người\s*dùng\s*hiện/i;

// 8 đầu ra theo đối tượng của story #9 — id cố định để chọn/lọc lặp lại
// được; PM sửa xóa thêm tự do qua muc_luc trước khi nháp.
export function deXuatDauRaPhatHanh(db: Database, cp: Campaign): MucLuc[] {
  const dtDev = timDoiTuong(db, RE_DEV);
  const dtTiemNang = timDoiTuong(db, RE_TIEM_NANG);
  const dtBaoMat = timDoiTuong(db, RE_BAO_MAT);
  const dtSales = timDoiTuong(db, RE_SALES);
  const dtSupport = timDoiTuong(db, RE_SUPPORT);
  const dtKhach = timDoiTuong(db, RE_KHACH_HANG) ?? null;
  const dtChinh = cp.doi_tuong_id;
  return [
    {
      id: "ph-dev",
      tieu_de: "Hướng dẫn tích hợp (developer)",
      dinh_dang: "huong-dan-tich-hop",
      doi_tuong_id: dtDev?.id ?? null,
      dich_den: "",
      ly_do: "Tài liệu tích hợp cho developer: bước, yêu cầu trước, giới hạn kỹ thuật.",
    },
    {
      id: "ph-khach",
      tieu_de: "Thay đổi cho khách hàng",
      dinh_dang: "thay-doi-khach-hang",
      doi_tuong_id: dtKhach?.id ?? dtChinh,
      dich_den: "",
      ly_do: "Giải thích bản phát hành thay đổi gì cho khách hàng hiện tại.",
    },
    {
      id: "ph-tiem-nang",
      tieu_de: "Lợi ích cho khách hàng tiềm năng",
      dinh_dang: "loi-ich-tiem-nang",
      doi_tuong_id: dtTiemNang?.id ?? null,
      dich_den: "",
      ly_do: "Lợi ích của bản phát hành cho prospect đang đánh giá.",
    },
    {
      id: "ph-bao-mat",
      tieu_de: "Kiểm soát cho bên mua bảo mật",
      dinh_dang: "kiem-soat-bao-mat",
      doi_tuong_id: dtBaoMat?.id ?? null,
      dich_den: "",
      ly_do: "Kiểm soát + giới hạn cho người mua bảo mật — chỉ claim có bằng chứng.",
    },
    {
      id: "ph-sales",
      tieu_de: "Brief sales",
      dinh_dang: "brief-ban-hang",
      doi_tuong_id: dtSales?.id ?? null,
      dich_den: "",
      ly_do: "Brief nội bộ cho đội sales: thông điệp chính, điểm bán, xử lý phản đối.",
    },
    {
      id: "ph-support",
      tieu_de: "FAQ support",
      dinh_dang: "faq",
      doi_tuong_id: dtSupport?.id ?? null,
      dich_den: "",
      ly_do: "Hỏi đáp cho đội support trả lời khách sau khi phát hành.",
    },
    {
      id: "ph-linkedin",
      tieu_de: "Bài LinkedIn",
      dinh_dang: "caption",
      doi_tuong_id: null,
      dich_den: "linkedin",
      ly_do: "Bài đăng LinkedIn công bố bản phát hành.",
    },
    {
      id: "ph-email",
      tieu_de: "Email phân đoạn",
      dinh_dang: "email-phan-doan",
      doi_tuong_id: dtKhach?.id ?? dtChinh,
      dich_den: "email",
      ly_do: "Nháp email phân đoạn — giao qua dịch vụ gửi sở hữu khi đã tích hợp.",
    },
  ];
}

// --- View phái sinh cho API/UI ---

export type FactView = FactPhatHanh & {
  co_bang_chung: boolean;
  nguon: { id: string; tieu_de: string } | null;
  muc: { id: string; tieu_de: string } | null;
};

// ds_fact kèm trạng thái bằng chứng: nguồn còn tồn tại và mục chỉ định
// còn trong cac_muc. Fact thiếu bằng chứng = claim chưa xác nhận.
export function docFactView(db: Database, cp: Campaign): FactView[] {
  return cp.ds_fact.map((f) => {
    const n = f.nguon_id ? layNguon(db, f.nguon_id) : null;
    const muc =
      n && f.muc_id ? (n.cac_muc.find((m) => m.id === f.muc_id) ?? null) : null;
    return {
      ...f,
      co_bang_chung: !!n && (!f.muc_id || !!muc),
      nguon: n ? { id: n.id, tieu_de: n.tieu_de } : null,
      muc: muc ? { id: muc.id, tieu_de: muc.tieu_de ?? muc.id } : null,
    };
  });
}

export type GoiYPhatHanh = {
  id: string;
  loai: "fact_chua_xac_nhan" | "thieu_tai_lieu" | "thieu_dau_ra" | "thieu_cta";
  tieu_de: string;
  ly_do: string;
  // Chứng cứ đi kèm để người đọc đối chiếu nhanh (cùng vai trò
  // GoiYKhoangTrong.bang_chung của số báo).
  bang_chung: string[];
  // Mục đề xuất để thêm vào mục lục — chỉ có khi gợi ý là 'thieu_dau_ra'.
  de_xuat_muc?: MucLuc;
};

// Gợi ý khoảng trống của bản phát hành — tính lại mỗi lần đọc:
// - fact chưa có bằng chứng nguồn (claim sẽ bị gắn cờ/để [CÂU HỎI]);
// - tham chiếu khai báo nhưng chưa nạp tài liệu;
// - đầu ra đề xuất còn thiếu trong mục lục đã lưu;
// - chưa khai báo CTA nào (link CTA phải trỏ đúng trang).
export function goiYPhatHanh(db: Database, cp: Campaign): GoiYPhatHanh[] {
  const ds: GoiYPhatHanh[] = [];
  for (const f of docFactView(db, cp)) {
    if (f.co_bang_chung) continue;
    ds.push({
      id: `goi-y-fact-${f.id}`,
      loai: "fact_chua_xac_nhan",
      tieu_de: `Fact '${f.tinh_nang}' chưa có bằng chứng nguồn`,
      ly_do: `Fact '${f.tinh_nang}' chưa trỏ nguồn/mục nào đã nạp — đầu ra nhắc nó sẽ phải để [CÂU HỎI] thay vì trình bày như sự thật. Gán nguon_id + muc_id sau khi nạp tài liệu.`,
      bang_chung: [`tinh_nang: ${f.tinh_nang}`, `noi_dung: ${f.noi_dung || "—"}`],
    });
  }
  for (const t of cp.tham_chieu) {
    if (t.nguon_id && layNguon(db, t.nguon_id)) continue;
    ds.push({
      id: `goi-y-tl-${t.id}`,
      loai: "thieu_tai_lieu",
      tieu_de: `Thiếu tài liệu cho '${t.tham_chieu}'`,
      ly_do: `Bản phát hành khai báo tài liệu '${t.tham_chieu}' nhưng chưa nạp văn bản — claim trích từ đó không đối chiếu được. Nạp nguồn rồi liên kết.`,
      bang_chung: [`tham_chieu: ${t.tham_chieu}`, `ban_dich: ${t.ban_dich || "—"}`],
    });
  }
  const deXuat = deXuatDauRaPhatHanh(db, cp);
  const daCo = new Set(cp.muc_luc.map((m) => `${m.dinh_dang}|${m.doi_tuong_id ?? ""}|${m.dich_den}`));
  const thieu = deXuat.filter(
    (d) => !daCo.has(`${d.dinh_dang}|${d.doi_tuong_id ?? ""}|${d.dich_den}`),
  );
  for (const d of thieu) {
    ds.push({
      id: `goi-y-dau-ra-${d.id}`,
      loai: "thieu_dau_ra",
      tieu_de: `Thiếu đầu ra '${d.tieu_de}'`,
      ly_do: d.ly_do || `Đầu ra đề xuất cho đối tượng này chưa có trong mục lục — thêm để nháp.`,
      bang_chung: [`dinh_dang: ${d.dinh_dang}`, `dich_den: ${d.dich_den || "—"}`],
      de_xuat_muc: d,
    });
  }
  if (cp.cta.length === 0) {
    ds.push({
      id: "goi-y-cta-rong",
      loai: "thieu_cta",
      tieu_de: "Chưa khai báo link CTA",
      ly_do: "Đầu ra cần link trỏ đúng trang tài liệu/nâng cấp/hỗ trợ — khai báo ít nhất một CTA.",
      bang_chung: [],
    });
  }
  return ds;
}
