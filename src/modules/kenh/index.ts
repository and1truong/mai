// Module kênh sở hữu (#13) — giao nội dung đã duyệt tới đích do MAI
// sở hữu (trang nội bộ /p, email opt-in) hoặc xuất tay cho đích chưa có
// tích hợp API. Mỗi adapter khai báo đúng năng lực đã hiện thực:
// xem_truoc / dang / cap_nhat / len_lich / xuat / metric. Kênh không
// hỗ trợ một khả năng thì UI chỉ hiển thị đường thủ công.
//
// Quy tắc an toàn:
// - Chỉ giao revision 'da_duyet' đang là head; kiểm lại ngay trước khi
//   gửi trong job (duyệt bị thu hồi/head trôi/nguồn đổi → vô hiệu hóa).
// - Provider nhận khóa idempotency ổn định theo lần giao — retry không
//   gửi kép. Kết quả mạng mơ hồ → 'khong_chac' + fail vĩnh viễn (không
//   gửi lại mù); người dùng kiểm rồi retry tay, provider dedupe theo khóa.
// - Credential chỉ nằm trong biến môi trường phía server. Config giữ TÊN
//   biến (api_key_env), không giữ giá trị key. Không log/response key.

import type { Database } from "bun:sqlite";
import { LoiApi, loiRequest } from "../../loi.ts";
import { log } from "../../log.ts";
import {
  danhSachXuatBan,
  ghiSuKien,
  layBanTheHien,
  layCampaign,
  layRevision,
  layThongDiep,
  xuatBanBanTheHien,
  type BanTheHien,
  type Revision,
  type ThongDiep,
} from "../content/index.ts";
import { damBaoAudienceGiao, lyDoChanLucGiao } from "./audience.ts";
import {
  docNoiDung,
  layDinhDang,
  renderHtml,
  renderText,
  type DinhNghiaDinhDang,
} from "../formats/index.ts";
import { enqueueJob, huyJob, layJob, LoiVinhVien, type JobHandler } from "../jobs/index.ts";

const bayGio = () => new Date().toISOString();

// Bọc một gói ghi trong transaction; gọi lồng nhau được — giống helper txn
// trong content/luong (local theo convention module).
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

// --- Kiểu public ---

export type NangLucKenh = "xem_truoc" | "dang" | "cap_nhat" | "len_lich" | "xuat" | "metric";

export type GiaoHang = {
  id: string;
  ban_the_hien_id: string;
  revision_id: string;
  kenh: string;
  dich_den: string;
  trang_thai: string; // cho_giao | da_giao | chap_nhan | khong_chac | xuat_tay | huy | loi
  job_id: string;
  khoa_idem: string;
  ma_bien_nhan: string;
  url: string;
  len_lich_luc: string | null;
  mui_gio: string;
  so_nguoi_nhan: number;
  so_bo_qua: number;
  lan_thu: number;
  loi: string;
  chi_tiet: Record<string, unknown>;
  revision_thanh_cong: string;
  la_test: boolean;
  tao_luc: string;
  tao_boi: string;
  xong_luc: string | null;
};

export type NguoiNhan = {
  id: string;
  email: string;
  ten: string;
  trang_thai: string; // dang_ky | huy_dang_ky (suppression vĩnh viễn)
  token_huy: string;
  url_huy_dang_ky: string;
  nguon: string;
  tao_luc: string;
  huy_luc: string | null;
};

export type CauHinhKenh = {
  url_goc?: string; // base URL instance — ghép URL canonical + link hủy đăng ký
  email?: CauHinhEmail;
};

// Adapter email "tương thích Resend": POST {base_url}/emails, Bearer key,
// header Idempotency-Key (tối đa 256 ký tự — khóa của ta ngắn hơn nhiều).
export type CauHinhEmail = {
  base_url?: string;
  api_key_env?: string; // TÊN biến env chứa key — config không giữ key
  from?: string; // identity người gửi được phép, vd "Mai <bao@example.com>"
  nguoi_nhan_test?: string; // email nhận bản test — chỉ gửi test tới đây
  timeout_ms?: number;
};

export type XemTruocGiao = {
  nhan: string; // nhãn adapter — dry-run phải nói rõ không gửi thật
  canh_bao: string[];
  tieu_de: string;
  html: string;
  text: string;
  ds_nguoi_nhan: string[]; // đích sẽ gửi nếu giao thật (email)
  so_bo_qua: number; // người nhận đã suppress sẽ bị bỏ qua
};

export type YeuCauXemTruoc = {
  db: Database;
  bth: BanTheHien;
  revision: Revision;
  thongDiep: ThongDiep;
  def: DinhNghiaDinhDang;
  laTest: boolean;
};

export type YeuCauGiao = YeuCauXemTruoc & {
  giao: GiaoHang;
  tinHieu: AbortSignal;
  assertConHan: () => void;
};

export type KetQuaGiao = {
  trang_thai: "da_giao" | "chap_nhan" | "xuat_tay";
  url?: string;
  ma_bien_nhan?: string;
  so_nguoi_nhan?: number;
  so_bo_qua?: number;
  chi_tiet?: Record<string, unknown>;
};

// Kết quả giao mơ hồ (timeout, 5xx, mất kết nối): provider có thể ĐÃ nhận.
// Job fail vĩnh viễn → người dùng kiểm rồi retry tay với cùng khóa
// idempotency — provider dedupe, không gửi kép.
export class LoiGiaoMoHo extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LoiGiaoMoHo";
  }
}

export type AdapterKenh = {
  id: string;
  nhan: string;
  mo_ta: string;
  nang_luc: NangLucKenh[];
  san_sang: boolean; // đủ cấu hình chạy ngay — email thiếu config → false
  dong_bo?: boolean; // chạy inline trong request, không qua job nền
  xemTruoc?: (yc: YeuCauXemTruoc) => XemTruocGiao;
  gui?: (yc: YeuCauGiao) => Promise<KetQuaGiao>;
  // Metric giao hàng mà provider có sẵn (vd trạng thái cuối theo receipt id).
  layMetric?: (giao: GiaoHang) => Promise<Record<string, unknown>>;
};

// --- Cấu hình ---

function cauHinhMacDinh(): Required<CauHinhKenh> {
  return {
    url_goc: "http://localhost:3000",
    email: {
      base_url: "",
      api_key_env: "MAI_EMAIL_API_KEY",
      from: "",
      nguoi_nhan_test: "",
      timeout_ms: 30_000,
    },
  };
}

export function chuanHoaCauHinhKenh(raw?: CauHinhKenh): Required<CauHinhKenh> {
  const md = cauHinhMacDinh();
  return {
    url_goc: (raw?.url_goc ?? md.url_goc).replace(/\/+$/, ""),
    email: { ...md.email, ...(raw?.email ?? {}) },
  };
}

export function escHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function giaTriChuoi(v: string | string[] | undefined): string {
  return Array.isArray(v) ? v.join("\n") : (v ?? "");
}

// --- Adapter: trang nội bộ ---

function adapterTrangNoiBo(cauHinh: Required<CauHinhKenh>): AdapterKenh {
  return {
    id: "trang_noi_bo",
    nhan: "Trang nội bộ",
    mo_ta:
      "Đăng revision đã duyệt thành trang /p/<id> do MAI host — URL canonical đọc được. Giao revision mới hơn = cập nhật trang.",
    nang_luc: ["xem_truoc", "dang", "cap_nhat", "len_lich", "xuat"],
    san_sang: true,
    xemTruoc: (yc) => {
      const noiDung = dungNoiDungGiao(yc);
      return {
        nhan: "Trang nội bộ",
        canh_bao: [],
        tieu_de: noiDung.tieu_de,
        html: noiDung.html,
        text: noiDung.text,
        ds_nguoi_nhan: [],
        so_bo_qua: 0,
      };
    },
    gui: async (yc) => {
      yc.assertConHan();
      // Idempotent: /p phục vụ xuat_ban mới nhất — đã phục vụ đúng revision
      // này rồi thì không tạo record trùng khi job retry.
      const dsXb = danhSachXuatBan(yc.db, yc.bth.id);
      let xb = dsXb[0]?.revision_id === yc.revision.id ? dsXb[0] : null;
      if (!xb) {
        xb = xuatBanBanTheHien(
          yc.db,
          yc.bth.id,
          { dich_den: "", ghi_chu: `giao:${yc.giao.id}` },
          "job",
        );
      }
      return {
        trang_thai: "da_giao",
        url: `${cauHinh.url_goc}/p/${yc.bth.id}`,
        ma_bien_nhan: xb.id,
      };
    },
  };
}

// --- Adapter: email (tương thích Resend) ---

function docKeyEmail(cauHinh: Required<CauHinhKenh>): string {
  const ten = cauHinh.email.api_key_env || "MAI_EMAIL_API_KEY";
  return Bun.env[ten] ?? "";
}

function adapterEmail(cauHinh: Required<CauHinhKenh>): AdapterKenh {
  const cfg = cauHinh.email;
  const sanSang = Boolean(cfg.base_url && cfg.from && docKeyEmail(cauHinh));
  const dsDangKy = (db: Database) =>
    danhSachNguoiNhanRaw(db).filter((n) => n.trang_thai === "dang_ky");
  return {
    id: "email",
    nhan: "Email",
    mo_ta:
      "Gửi qua API tương thích Resend (POST /emails + Idempotency-Key). Người nhận = danh bạ opt-in, link hủy đăng ký tự động kèm mỗi email.",
    nang_luc: ["xem_truoc", "dang", "cap_nhat", "len_lich", "metric"],
    san_sang: sanSang,
    xemTruoc: (yc) => {
      const email = dungEmail(yc, `${cauHinh.url_goc}/huy-dang-ky?token=<token-moi-nguoi-nhan>`);
      const ds = yc.laTest
        ? cfg.nguoi_nhan_test
          ? [cfg.nguoi_nhan_test]
          : []
        : dsDangKy(yc.db).map((n) => n.email);
      const tong = danhSachNguoiNhanRaw(yc.db).length;
      return {
        nhan: yc.laTest ? "Email test" : "Email",
        canh_bao: yc.laTest
          ? [`Chỉ gửi tới người nhận test đã cấu hình: ${cfg.nguoi_nhan_test || "(chưa cấu hình)"}.`]
          : [],
        tieu_de: email.subject,
        html: email.html,
        text: email.text,
        ds_nguoi_nhan: ds,
        so_bo_qua: yc.laTest ? 0 : tong - ds.length,
      };
    },
    gui: async (yc) => {
      const key = docKeyEmail(cauHinh);
      if (!cfg.base_url || !cfg.from || !key) {
        throw new LoiApi(
          500,
          "LOI_CAU_HINH",
          "Kênh email chưa cấu hình đủ (base_url / from / biến env api_key).",
        );
      }
      let dsDen: { id: string; email: string; urlHuy: string }[];
      let soBoQua = 0;
      if (yc.giao.la_test) {
        const test = cfg.nguoi_nhan_test?.trim();
        if (!test) {
          throw new LoiApi(500, "LOI_CAU_HINH", "Chưa cấu hình kenh.email.nguoi_nhan_test.");
        }
        dsDen = [{ id: "", email: test, urlHuy: "" }];
      } else {
        // #68: audience resolve từ segment (snapshot trong chi_tiet lúc
        // giao) thay danh bạ nguoi_nhan mặc định.
        const audience = Array.isArray(yc.giao.chi_tiet.audience)
          ? (yc.giao.chi_tiet.audience as { id: string; email: string; urlHuy: string }[])
          : null;
        if (audience) {
          dsDen = audience;
          soBoQua = Number(yc.giao.chi_tiet.audience_bo_qua) || 0;
        } else {
          const tatCa = danhSachNguoiNhanRaw(yc.db);
          const dangKy = tatCa.filter((n) => n.trang_thai === "dang_ky");
          // Suppression: đã hủy đăng ký không bao giờ nằm trong danh sách gửi.
          soBoQua = tatCa.length - dangKy.length;
          dsDen = dangKy.map((n) => ({
            id: n.id,
            email: n.email,
            urlHuy: `${cauHinh.url_goc}/huy-dang-ky?token=${n.token_huy}`,
          }));
        }
      }
      if (dsDen.length === 0) {
        throw new LoiApi(400, "VALIDATION", "Không có người nhận nào đang đăng ký.");
      }
      // Checkpoint theo người nhận: retry job chỉ gửi phần chưa gửi —
      // không đốt lại email cho người provider đã chấp nhận.
      const daGui = new Set<string>(
        Array.isArray(yc.giao.chi_tiet.da_gui)
          ? (yc.giao.chi_tiet.da_gui as string[])
          : [],
      );
      const bienNhan: Record<string, string> =
        typeof yc.giao.chi_tiet.bien_nhan === "object" && yc.giao.chi_tiet.bien_nhan !== null
          ? { ...(yc.giao.chi_tiet.bien_nhan as Record<string, string>) }
          : {};
      // #68: người nhận audience bị chặn NGAY TRƯỚC GỬI (hủy đăng ký/
      // rút consent giữa hai attempt) — snapshot không sửa, lý do ghi
      // vào chi_tiet.bo_qua_gui (khach_id → ly_do), đếm vào so_bo_qua.
      const boQuaGui: Record<string, string> =
        typeof yc.giao.chi_tiet.bo_qua_gui === "object" && yc.giao.chi_tiet.bo_qua_gui !== null
          ? { ...(yc.giao.chi_tiet.bo_qua_gui as Record<string, string>) }
          : {};
      const laAudience = Array.isArray(yc.giao.chi_tiet.audience);
      for (const den of dsDen) {
        if (den.id && daGui.has(den.id)) continue;
        if (den.id && den.id in boQuaGui) continue;
        yc.assertConHan();
        if (laAudience) {
          const chan = lyDoChanLucGiao(yc.db, den.id, den.email, "email");
          if (chan) {
            boQuaGui[den.id] = chan;
            ghiChiTietGiao(yc.db, yc.giao.id, { bo_qua_gui: { ...boQuaGui } });
            continue;
          }
        }
        const email = dungEmail(yc, den.urlHuy || undefined);
        // Khóa idempotency per (lần giao, người nhận) — retry cùng khóa:
        // provider dedupe thay vì gửi kép.
        const khoa = `giao:${yc.giao.id}:${den.id || "test"}`.slice(0, 250);
        const res = await guiMotEmail(cauHinh, key, {
          from: cfg.from!,
          to: [den.email],
          subject: email.subject,
          html: email.html,
          text: email.text,
          urlHuy: den.urlHuy,
          khoaIdem: khoa,
          tinHieu: yc.tinHieu,
        });
        bienNhan[den.email] = res.id;
        if (den.id) {
          daGui.add(den.id);
          ghiChiTietGiao(yc.db, yc.giao.id, {
            da_gui: [...daGui],
            bien_nhan: bienNhan,
          });
        }
      }
      return {
        trang_thai: "chap_nhan",
        ma_bien_nhan: Object.values(bienNhan).join(", "),
        so_nguoi_nhan: dsDen.length - Object.keys(boQuaGui).length,
        so_bo_qua: soBoQua + Object.keys(boQuaGui).length,
        chi_tiet: { da_gui: [...daGui], bien_nhan: bienNhan, bo_qua_gui: { ...boQuaGui } },
      };
    },
    // Metric có sẵn của provider: GET /emails/{id} trả sự kiện cuối
    // (delivered/bounced…) — 'chap_nhan' chỉ là provider đã nhận, đây là
    // bước kiểm tới đích thực tế.
    layMetric: async (giao) => {
      const key = docKeyEmail(cauHinh);
      if (!cfg.base_url || !key) {
        return { loi: "Kênh email chưa cấu hình — không lấy được metric." };
      }
      const bienNhan =
        typeof giao.chi_tiet.bien_nhan === "object" && giao.chi_tiet.bien_nhan !== null
          ? (giao.chi_tiet.bien_nhan as Record<string, string>)
          : {};
      const ra: Record<string, unknown> = {};
      for (const [email, id] of Object.entries(bienNhan)) {
        try {
          const res = await fetch(`${cfg.base_url}/emails/${encodeURIComponent(id)}`, {
            headers: { authorization: `Bearer ${key}` },
            signal: AbortSignal.timeout(cfg.timeout_ms || 30_000),
          });
          if (res.ok) {
            const j = (await res.json()) as Record<string, unknown>;
            ra[email] = { id, su_kien_cuoi: j.last_event ?? j.status ?? null };
          } else {
            ra[email] = { id, loi: `provider ${res.status}` };
          }
        } catch (e) {
          ra[email] = { id, loi: e instanceof Error ? e.message : String(e) };
        }
      }
      return ra;
    },
  };
}

// Dựng subject + thân email một lần cho cả preview lẫn gửi thật —
// link hủy đăng ký đổi theo người nhận (urlHuy rỗng = email test).
function dungEmail(
  yc: YeuCauXemTruoc,
  urlHuy?: string,
): { subject: string; html: string; text: string } {
  const nd = dungNoiDungGiao(yc);
  const footerHtml = urlHuy
    ? `<hr/><p><small><a href="${escHtml(urlHuy)}">Hủy đăng ký</a></small></p>`
    : "";
  const footerText = urlHuy ? `\n\nHủy đăng ký: ${urlHuy}` : "";
  return { subject: nd.tieu_de, html: nd.html + footerHtml, text: nd.text + footerText };
}

async function guiMotEmail(
  cauHinh: Required<CauHinhKenh>,
  key: string,
  input: {
    from: string;
    to: string[];
    subject: string;
    html: string;
    text: string;
    urlHuy?: string;
    khoaIdem: string;
    tinHieu: AbortSignal;
  },
): Promise<{ id: string }> {
  const mailHeaders: Record<string, string> = {};
  if (input.urlHuy) mailHeaders["List-Unsubscribe"] = `<${input.urlHuy}>`;
  let res: Response;
  try {
    res = await fetch(`${cauHinh.email.base_url}/emails`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${key}`,
        "idempotency-key": input.khoaIdem,
      },
      body: JSON.stringify({
        from: input.from,
        to: input.to,
        subject: input.subject,
        html: input.html,
        text: input.text,
        headers: mailHeaders,
      }),
      signal: AbortSignal.any([
        input.tinHieu,
        AbortSignal.timeout(cauHinh.email.timeout_ms || 30_000),
      ]),
    });
  } catch (e) {
    // Timeout / DNS / reset giữa chừng: không biết provider đã nhận chưa.
    throw new LoiGiaoMoHo(
      `Lỗi mạng khi gọi provider email: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  if (res.ok) {
    const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { id: String(j.id ?? "") };
  }
  const thongDiep = (await res.text().catch(() => "")).slice(0, 300);
  if (res.status === 429) {
    // Provider từ chối rõ vì rate limit — email chưa đi, retry backoff được.
    throw new Error(`Provider rate limit (429): ${thongDiep}`);
  }
  if (res.status >= 400 && res.status < 500) {
    // 4xx = provider từ chối rõ ràng → lỗi vĩnh viễn, retry vô ích.
    throw new LoiVinhVien(`Provider từ chối (${res.status}): ${thongDiep}`);
  }
  // 5xx: có thể provider đã ghi rồi lỗi — mơ hồ, không gửi lại mù.
  throw new LoiGiaoMoHo(`Provider lỗi ${res.status} — không rõ đã nhận chưa.`);
}

// --- Adapter: dry-run ---

function adapterDryRun(cauHinh: Required<CauHinhKenh>): AdapterKenh {
  const dungPreview = (yc: YeuCauXemTruoc) => {
    const email = dungEmail(yc, `${cauHinh.url_goc}/huy-dang-ky?token=<token-moi-nguoi-nhan>`);
    const tatCa = danhSachNguoiNhanRaw(yc.db);
    const dangKy = tatCa.filter((n) => n.trang_thai === "dang_ky");
    return {
      nhan: "DRY-RUN — không gửi thật",
      canh_bao: [
        "Đây là bản dựng trước của email. Không email nào được gửi.",
        `Sẽ gửi tới ${dangKy.length} người đang đăng ký nếu giao thật (${tatCa.length - dangKy.length} đã hủy/suppress sẽ bị bỏ qua).`,
      ],
      tieu_de: email.subject,
      html: email.html,
      text: email.text,
      ds_nguoi_nhan: dangKy.map((n) => n.email),
      so_bo_qua: tatCa.length - dangKy.length,
    };
  };
  return {
    id: "dry_run",
    nhan: "Dry-run",
    mo_ta:
      "Dựng đúng payload email sẽ gửi và trả preview gắn nhãn — KHÔNG gửi thật. Dùng được không cần credential trả phí.",
    nang_luc: ["xem_truoc", "dang"],
    dong_bo: true,
    san_sang: true,
    xemTruoc: dungPreview,
    gui: async (yc) => {
      const p = dungPreview(yc);
      return {
        trang_thai: "xuat_tay",
        so_nguoi_nhan: 0,
        so_bo_qua: p.so_bo_qua,
        chi_tiet: {
          nhan: p.nhan,
          email_mau: { subject: p.tieu_de, html: p.html, text: p.text },
          ds_nguoi_nhan: p.ds_nguoi_nhan,
        },
      };
    },
  };
}

// --- Adapter: xuất tay ---

function adapterXuatTay(): AdapterKenh {
  return {
    id: "xuat_tay",
    nhan: "Xuất tay",
    mo_ta:
      "Đích chưa có tích hợp API (social, Google Business, script YouTube/TikTok) — ghi nhận xuất bản + link tải bundle để đăng thủ công.",
    nang_luc: ["xem_truoc", "xuat"],
    dong_bo: true,
    san_sang: true,
    xemTruoc: (yc) => {
      const noiDung = dungNoiDungGiao(yc);
      return {
        nhan: "Xuất tay — đăng thủ công",
        canh_bao: ["Đích này không có API — bundle tải về để đăng tay, không có biên nhận tự động."],
        tieu_de: noiDung.tieu_de,
        html: noiDung.html,
        text: noiDung.text,
        ds_nguoi_nhan: [],
        so_bo_qua: 0,
      };
    },
    gui: async (yc) => {
      // Export tay cũng là một record xuat_ban (idempotent như trang nội
      // bộ): retry không tạo record trùng cho cùng revision.
      const dsXb = danhSachXuatBan(yc.db, yc.bth.id);
      let xb = dsXb[0]?.revision_id === yc.revision.id ? dsXb[0] : null;
      if (!xb) {
        xb = xuatBanBanTheHien(
          yc.db,
          yc.bth.id,
          { dich_den: yc.giao.dich_den, ghi_chu: `giao:${yc.giao.id}` },
          "job",
        );
      }
      return {
        trang_thai: "xuat_tay",
        url: `/api/ban-the-hien/${yc.bth.id}/xuat-ban/${xb.id}/tai-ve`,
        ma_bien_nhan: xb.id,
        chi_tiet: { huong_dan: "Tải bundle rồi đăng thủ công lên đích." },
      };
    },
  };
}

// --- Registry adapter ---

export function layDsKenh(cauHinhRaw?: CauHinhKenh): AdapterKenh[] {
  const cauHinh = chuanHoaCauHinhKenh(cauHinhRaw);
  return [adapterTrangNoiBo(cauHinh), adapterEmail(cauHinh), adapterDryRun(cauHinh), adapterXuatTay()];
}

export function layAdapter(cauHinhRaw: CauHinhKenh | undefined, kenh: string): AdapterKenh | null {
  return layDsKenh(cauHinhRaw).find((a) => a.id === kenh) ?? null;
}

// Gợi ý kênh theo đích của đầu ra: đích social/bên ngoài chưa có API →
// xuất tay; định dạng email/newsletter → email; mặc định trang nội bộ.
export function goiYKenh(bth: BanTheHien): { kenh: string; ly_do: string } {
  const dich = bth.dich_den.toLowerCase();
  if (bth.dinh_dang.includes("email") || bth.dinh_dang === "newsletter") {
    return { kenh: "email", ly_do: "Định dạng email/newsletter." };
  }
  if (dich && !["", "web", "website", "trang", "page"].includes(dich)) {
    return { kenh: "xuat_tay", ly_do: `Đích '${bth.dich_den}' chưa có tích hợp API — xuất bundle đăng tay.` };
  }
  return { kenh: "trang_noi_bo", ly_do: "Trang nội bộ do MAI host." };
}

// --- Đọc/ghi DB ---

type DongGiao = Omit<GiaoHang, "chi_tiet" | "la_test"> & { chi_tiet: string; la_test: number };

function docDongGiao(r: DongGiao): GiaoHang {
  let chiTiet: Record<string, unknown> = {};
  try {
    const j = JSON.parse(r.chi_tiet || "{}");
    if (typeof j === "object" && j !== null && !Array.isArray(j)) chiTiet = j as Record<string, unknown>;
  } catch {
    // chi_tiet hỏng → giữ {} — trạng thái chính vẫn đọc được.
  }
  return { ...r, chi_tiet: chiTiet, la_test: r.la_test === 1 };
}

function docGiaoRaw(db: Database, id: string): GiaoHang | null {
  const r = db.query("SELECT * FROM giao_hang WHERE id = ?").get(id) as DongGiao | null;
  return r ? docDongGiao(r) : null;
}

function dsGiaoRaw(db: Database, bthId: string): GiaoHang[] {
  return (
    db
      .query("SELECT * FROM giao_hang WHERE ban_the_hien_id = ? ORDER BY tao_luc DESC, id DESC")
      .all(bthId) as DongGiao[]
  ).map(docDongGiao);
}

// Lý do một lần giao (đang chờ/đã lên lịch) hết hiệu lực — cùng predicate
// dùng ở ba chỗ: kiểm trước khi tạo, đọc danh sách (vô hiệu lazy), và job
// kiểm lại ngay trước khi gửi. Trả null = còn hiệu lực.
function lyDoVoHieu(db: Database, bth: BanTheHien, revisionId: string): string | null {
  if (bth.trang_thai !== "da_duyet") return "chua_duyet";
  if (!bth.head_revision_id) return "chua_co_noi_dung";
  if (bth.head_revision_id !== revisionId) return "revision_da_doi";
  const rev = layRevision(db, revisionId);
  if (!rev) return "revision_da_xoa";
  // Nguồn/context đổi sau khi revision đích được sinh → nội dung ghim nguồn
  // cũ — vô hiệu, chờ review/sinh lại rồi giao mới.
  const td = layThongDiep(db, bth.thong_diep_id);
  if (
    td?.head_revision_id &&
    rev.thong_diep_revision_id &&
    rev.thong_diep_revision_id !== td.head_revision_id
  ) {
    return "nguon_da_doi";
  }
  return null;
}

export function kiemTraConHieuGiao(db: Database, giao: GiaoHang): string | null {
  const bth = layBanTheHien(db, giao.ban_the_hien_id);
  if (!bth) return "ban_the_hien_da_xoa";
  return lyDoVoHieu(db, bth, giao.revision_id);
}

// Vô hiệu một lần 'cho_giao': đánh 'huy' kèm lý do + hủy job nền nếu còn.
// goiTuJob=true khi gọi từ chính handler đang chạy — không hủy job của
// chính mình (job sẽ kết thúc 'loi' bởi LoiVinhVien caller ném).
function voHieuGiao(db: Database, giao: GiaoHang, lyDo: string, goiTuJob = false): void {
  const ts = bayGio();
  db.query(
    `UPDATE giao_hang SET trang_thai = 'huy', loi = ?, xong_luc = ? WHERE id = ? AND trang_thai = 'cho_giao'`,
  ).run(lyDo, ts, giao.id);
  if (!goiTuJob && giao.job_id) {
    try {
      huyJob(db, giao.job_id);
    } catch {
      // Job đã kết thúc/không còn — giao vẫn 'huy' đúng.
    }
  }
}

// Đọc có vệ sinh lazy (giống dongTaskTuDong): lần 'cho_giao' mà điều kiện
// đã đổi → vô hiệu ngay tại lần đọc; job chết 'loi'/'huy' → đồng bộ cờ.
// Một điểm kiểm duy nhất — không cần chạm mọi đường mutation.
function docGiaoHieuLuc(db: Database, giao: GiaoHang): GiaoHang {
  if (giao.trang_thai !== "cho_giao") return giao;
  const lyDo = kiemTraConHieuGiao(db, giao);
  if (lyDo) {
    voHieuGiao(db, giao, lyDo);
    log.info("kenh.vo_hieu", { id: giao.id, ly_do: lyDo });
    return docGiaoRaw(db, giao.id) ?? giao;
  }
  if (giao.job_id) {
    const job = layJob(db, giao.job_id);
    if (job?.trang_thai === "loi") {
      db.query(
        `UPDATE giao_hang SET trang_thai = 'loi', loi = ?, xong_luc = ? WHERE id = ? AND trang_thai = 'cho_giao'`,
      ).run(job.loi ?? "job loi", bayGio(), giao.id);
      return docGiaoRaw(db, giao.id) ?? giao;
    }
    if (job?.trang_thai === "huy") {
      db.query(
        `UPDATE giao_hang SET trang_thai = 'huy', loi = 'job_da_huy', xong_luc = ? WHERE id = ? AND trang_thai = 'cho_giao'`,
      ).run(bayGio(), giao.id);
      return docGiaoRaw(db, giao.id) ?? giao;
    }
  }
  return giao;
}

export function layGiaoHang(db: Database, id: string): GiaoHang | null {
  const g = docGiaoRaw(db, id);
  return g ? docGiaoHieuLuc(db, g) : null;
}

export function danhSachGiao(db: Database, bthId: string): GiaoHang[] {
  return dsGiaoRaw(db, bthId).map((g) => docGiaoHieuLuc(db, g));
}

// Toàn cục cho trang Kênh: N lần giao mới nhất kèm định dạng đầu ra để
// hiển thị nhãn — lazy vệ sinh giống danh sách theo bth.
export function danhSachTatCaGiao(
  db: Database,
  gioiHan = 100,
): (GiaoHang & { dinh_dang: string })[] {
  const ds = (
    db
      .query(
        `SELECT g.*, b.dinh_dang AS dinh_dang FROM giao_hang g
         JOIN ban_the_hien b ON b.id = g.ban_the_hien_id
         ORDER BY g.tao_luc DESC, g.id DESC LIMIT ?`,
      )
      .all(gioiHan) as (DongGiao & { dinh_dang: string })[]
  ).map((r) => ({ ...docDongGiao(r), dinh_dang: r.dinh_dang }));
  return ds.map((g) => ({ ...docGiaoHieuLuc(db, g), dinh_dang: g.dinh_dang }));
}

function capNhatGiao(
  db: Database,
  id: string,
  patch: {
    trang_thai?: string;
    job_id?: string;
    ma_bien_nhan?: string;
    url?: string;
    so_nguoi_nhan?: number;
    so_bo_qua?: number;
    lan_thu?: number;
    loi?: string;
    chi_tiet?: Record<string, unknown>;
    revision_thanh_cong?: string;
    xong_luc?: string | null;
  },
  chiKhiChoGiao = false,
): void {
  const cot: string[] = [];
  const giaTri: (string | number | null)[] = [];
  for (const [k, v] of Object.entries(patch)) {
    cot.push(`${k} = ?`);
    giaTri.push(k === "chi_tiet" ? JSON.stringify(v ?? {}) : (v as string | number | null));
  }
  if (cot.length === 0) return;
  // chiKhiChoGiao: không đè trạng thái khi user đã hủy giữa chừng —
  // job/catch đến sau lần hủy tay thì ghi này thành no-op.
  db.query(
    `UPDATE giao_hang SET ${cot.join(", ")} WHERE id = ?` +
      (chiKhiChoGiao ? ` AND trang_thai = 'cho_giao'` : ""),
  ).run(...giaTri, id);
}

// Merge vào chi_tiet JSON của lần giao — checkpoint giữa các người nhận.
function ghiChiTietGiao(db: Database, id: string, patch: Record<string, unknown>): void {
  const g = docGiaoRaw(db, id);
  if (!g) return;
  capNhatGiao(db, id, { chi_tiet: { ...g.chi_tiet, ...patch } });
}

// --- Tạo lần giao ---

export type NhapGiao = {
  ban_the_hien_id: string;
  kenh: string;
  dich_den?: string;
  len_lich_luc?: string | null; // ISO — đã chuẩn hóa ở tầng API
  mui_gio?: string;
  la_test?: boolean;
};

export async function taoGiaoHang(
  db: Database,
  input: NhapGiao,
  cauHinhRaw: CauHinhKenh | undefined,
  tacGia: string,
): Promise<{ giao: GiaoHang; da_tao: boolean }> {
  const cauHinh = chuanHoaCauHinhKenh(cauHinhRaw);
  const bth = layBanTheHien(db, input.ban_the_hien_id);
  if (!bth) loiRequest(404, "KHONG_TIM_THAY", "Không tìm thấy bản thể hiện.");
  const adapter = layAdapter(cauHinhRaw, input.kenh);
  if (!adapter) {
    loiRequest(400, "VALIDATION", `Kênh '${input.kenh}' không tồn tại.`, {
      kenh_ho_tro: layDsKenh(cauHinhRaw).map((a) => a.id),
    });
  }
  const dichDen = (input.dich_den ?? bth.dich_den ?? "").trim();
  const lenLich = input.len_lich_luc?.trim() || null;
  if (lenLich && !adapter!.nang_luc.includes("len_lich")) {
    loiRequest(400, "VALIDATION", `Kênh '${input.kenh}' không hỗ trợ lên lịch.`);
  }
  if (!adapter!.nang_luc.includes("dang") && !adapter!.nang_luc.includes("xuat")) {
    loiRequest(400, "VALIDATION", `Kênh '${input.kenh}' không hỗ trợ đăng/xuất.`);
  }
  if (input.la_test && input.kenh !== "email") {
    loiRequest(400, "VALIDATION", "Chỉ kênh email có chế độ gửi test.");
  }

  // Hiệu lực đầu ra: phải da_duyet + đúng head + nguồn chưa trôi.
  const lyDo = lyDoVoHieu(db, bth, bth.head_revision_id ?? "");
  if (lyDo) {
    throw new LoiApi(
      409,
      "XUNG_DOT_TRANG_THAI",
      `Đầu ra chưa sẵn sàng giao: ${lyDo}.`,
      { ly_do: lyDo },
    );
  }
  const revision = layRevision(db, bth.head_revision_id!)!;

  // Dedupe: còn một lần 'cho_giao' cùng (bth, kênh, revision, đích, test) →
  // trả lần đó — retry/double-submit không tạo lần giao thứ hai.
  const tonTai = dsGiaoRaw(db, bth.id).find(
    (g) =>
      g.trang_thai === "cho_giao" &&
      g.kenh === input.kenh &&
      g.revision_id === revision.id &&
      g.dich_den === dichDen &&
      g.la_test === !!input.la_test,
  );
  if (tonTai) return { giao: tonTai, da_tao: false };

  const id = crypto.randomUUID();
  const ts = bayGio();
  // Một transaction cho toàn bộ ghi: giao_hang + sự kiện + job + job_id.
  // Crash giữa các bước không để lại dòng 'cho_giao' mồ côi không job.
  txn(db, () => {
    db.query(
      `INSERT INTO giao_hang
         (id, ban_the_hien_id, revision_id, kenh, dich_den, trang_thai, khoa_idem,
          len_lich_luc, mui_gio, la_test, tao_luc, tao_boi)
       VALUES (?, ?, ?, ?, ?, 'cho_giao', ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      bth.id,
      revision.id,
      input.kenh,
      dichDen,
      `giao:${id}`,
      lenLich,
      (input.mui_gio ?? "").trim(),
      input.la_test ? 1 : 0,
      ts,
      tacGia,
    );
    ghiSuKien(
      db,
      "giao_hang",
      id,
      "tao",
      { ban_the_hien_id: bth.id, kenh: input.kenh, len_lich_luc: lenLich, la_test: !!input.la_test },
      tacGia,
    );
    if (!adapter!.dong_bo) {
      // Job bền: tồn tại qua restart, theo lịch hẹn + timezone nếu có.
      const { job } = enqueueJob(db, {
        loai: "giao_kenh",
        payload: { giao_hang_id: id },
        khoaIdem: `giao_kenh:${id}`,
        entityLoai: "giao_hang",
        entityId: id,
        revisionId: revision.id,
        chaySomNhat: lenLich,
        muiGio: (input.mui_gio ?? "").trim() || undefined,
      });
      capNhatGiao(db, id, { job_id: job.id });
    }
  });
  const giao = docGiaoRaw(db, id)!;

  if (adapter!.dong_bo) {
    // Adapter đồng bộ (dry-run, xuất tay): chạy ngay trong request.
    const thongDiep = layThongDiep(db, bth.thong_diep_id)!;
    const def = layDinhDang(bth.dinh_dang)!;
    const yc: YeuCauGiao = {
      db,
      giao,
      bth,
      revision,
      thongDiep,
      def,
      laTest: giao.la_test,
      tinHieu: new AbortController().signal,
      assertConHan: () => {},
    };
    try {
      const kq = await adapter!.gui!(yc);
      capNhatGiao(
        db,
        giao.id,
        {
          trang_thai: kq.trang_thai,
          url: kq.url ?? "",
          ma_bien_nhan: kq.ma_bien_nhan ?? "",
          so_nguoi_nhan: kq.so_nguoi_nhan ?? 0,
          so_bo_qua: kq.so_bo_qua ?? 0,
          chi_tiet: { ...docGiaoRaw(db, giao.id)!.chi_tiet, ...(kq.chi_tiet ?? {}) },
          revision_thanh_cong: revision.id,
          xong_luc: bayGio(),
        },
        true,
      );
      ghiSuKien(db, "giao_hang", giao.id, "giao_xong", { kenh: input.kenh, trang_thai: kq.trang_thai }, tacGia);
    } catch (e) {
      capNhatGiao(
        db,
        giao.id,
        {
          trang_thai: "loi",
          loi: e instanceof Error ? e.message : String(e),
          xong_luc: bayGio(),
        },
        true,
      );
    }
    return { giao: docGiaoRaw(db, id)!, da_tao: true };
  }

  return { giao: docGiaoRaw(db, id)!, da_tao: true };
}

// --- Hủy / retry tay ---

export function huyGiaoHang(db: Database, id: string): GiaoHang {
  const giao = docGiaoRaw(db, id);
  if (!giao) loiRequest(404, "KHONG_TIM_THAY", "Không tìm thấy lần giao.");
  if (giao.trang_thai !== "cho_giao") {
    throw new LoiApi(
      409,
      "XUNG_DOT_JOB",
      `Chỉ hủy được lần giao đang chờ (hiện '${giao.trang_thai}').`,
    );
  }
  voHieuGiao(db, giao, "huy_tay");
  ghiSuKien(db, "giao_hang", id, "huy", {}, "he_thong");
  return docGiaoRaw(db, id)!;
}

// Retry tay cho lần 'loi'/'khong_chac': cùng khoa_idem provider — retry an
// toàn, provider dedupe nếu lần trước đã nhận. Vẫn đi qua kiểm hiệu lực.
export function thuLaiGiaoHang(
  db: Database,
  id: string,
  cauHinhRaw: CauHinhKenh | undefined,
): GiaoHang {
  const giao = docGiaoRaw(db, id);
  if (!giao) loiRequest(404, "KHONG_TIM_THAY", "Không tìm thấy lần giao.");
  if (!["loi", "khong_chac"].includes(giao.trang_thai)) {
    throw new LoiApi(
      409,
      "XUNG_DOT_JOB",
      `Chỉ retry được lần giao 'loi'/'khong_chac' (hiện '${giao.trang_thai}').`,
    );
  }
  const lyDo = kiemTraConHieuGiao(db, giao);
  if (lyDo) {
    voHieuGiao(db, giao, lyDo);
    throw new LoiApi(409, "XUNG_DOT_TRANG_THAI", `Lần giao đã vô hiệu: ${lyDo}.`, { ly_do: lyDo });
  }
  // Một transaction cho enqueue + patch + sự kiện — cùng lý do taoGiaoHang.
  txn(db, () => {
    const { job } = enqueueJob(db, {
      loai: "giao_kenh",
      payload: { giao_hang_id: giao.id },
      khoaIdem: `giao_kenh:${giao.id}`,
      entityLoai: "giao_hang",
      entityId: giao.id,
      revisionId: giao.revision_id,
    });
    capNhatGiao(db, giao.id, {
      trang_thai: "cho_giao",
      job_id: job.id,
      loi: "",
      xong_luc: null,
    });
    ghiSuKien(db, "giao_hang", giao.id, "thu_lai", {}, "he_thong");
  });
  return docGiaoRaw(db, giao.id)!;
}

// --- Xem trước ---

export function xemTruocGiao(
  db: Database,
  bthId: string,
  kenh: string,
  cauHinhRaw: CauHinhKenh | undefined,
  laTest = false,
): XemTruocGiao {
  const adapter = layAdapter(cauHinhRaw, kenh);
  if (!adapter?.xemTruoc) {
    loiRequest(400, "VALIDATION", `Kênh '${kenh}' không hỗ trợ xem trước.`);
  }
  const bth = layBanTheHien(db, bthId);
  if (!bth) loiRequest(404, "KHONG_TIM_THAY", "Không tìm thấy bản thể hiện.");
  const revision = bth.head_revision_id ? layRevision(db, bth.head_revision_id) : null;
  if (!revision) {
    loiRequest(409, "XUNG_DOT_TRANG_THAI", "Đầu ra chưa có nội dung để xem trước.");
  }
  const thongDiep = layThongDiep(db, bth.thong_diep_id);
  const def = layDinhDang(bth.dinh_dang);
  if (!thongDiep || !def) loiRequest(404, "KHONG_TIM_THAY", "Thiếu thông điệp/định dạng.");
  return adapter!.xemTruoc!({ db, bth, revision, thongDiep, def, laTest });
}

function dungNoiDungGiao(yc: YeuCauXemTruoc): { tieu_de: string; html: string; text: string } {
  const fields = docNoiDung(yc.def, yc.revision.noi_dung);
  const tieuDe = giaTriChuoi(fields.tieu_de).trim() || yc.thongDiep.tieu_de;
  return {
    tieu_de: tieuDe,
    html: renderHtml(yc.def, yc.revision.noi_dung),
    text: renderText(yc.def, yc.revision.noi_dung),
  };
}

// --- Người nhận opt-in + suppression ---

// Dòng raw (kèm token) cho nội bộ — adapter email cần token để ghép link.
type DongNguoiNhan = Omit<NguoiNhan, "url_huy_dang_ky">;

function docDongNguoiNhan(r: DongNguoiNhan, urlGoc: string): NguoiNhan {
  return {
    ...r,
    url_huy_dang_ky: `${urlGoc}/huy-dang-ky?token=${r.token_huy}`,
  };
}

function danhSachNguoiNhanRaw(db: Database): DongNguoiNhan[] {
  return db.query("SELECT * FROM nguoi_nhan ORDER BY tao_luc").all() as DongNguoiNhan[];
}

export function danhSachNguoiNhan(db: Database, urlGoc: string): NguoiNhan[] {
  return danhSachNguoiNhanRaw(db).map((r) => docDongNguoiNhan(r, urlGoc));
}

export function themNguoiNhan(
  db: Database,
  input: { email: string; ten?: string; nguon?: string },
  urlGoc: string,
  tacGia: string,
): { nguoi_nhan: NguoiNhan; da_tao: boolean } {
  const email = input.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    loiRequest(400, "VALIDATION", "Email người nhận không hợp lệ.");
  }
  const cu = db.query("SELECT * FROM nguoi_nhan WHERE email = ?").get(email) as
    | DongNguoiNhan
    | null;
  if (cu) {
    // Suppression mạnh: đã hủy đăng ký thì thêm lại không tự hồi sinh —
    // trả bản ghi hiện có (UI hiển thị trạng thái 'huy_dang_ky').
    return { nguoi_nhan: docDongNguoiNhan(cu, urlGoc), da_tao: false };
  }
  const id = crypto.randomUUID();
  db.query(
    `INSERT INTO nguoi_nhan (id, email, ten, trang_thai, token_huy, nguon, tao_luc)
     VALUES (?, ?, ?, 'dang_ky', ?, ?, ?)`,
  ).run(
    id,
    email,
    (input.ten ?? "").trim(),
    crypto.randomUUID().replaceAll("-", ""),
    (input.nguon ?? "").trim(),
    bayGio(),
  );
  ghiSuKien(db, "nguoi_nhan", id, "them", { email }, tacGia);
  const r = db.query("SELECT * FROM nguoi_nhan WHERE id = ?").get(id) as DongNguoiNhan;
  return { nguoi_nhan: docDongNguoiNhan(r, urlGoc), da_tao: true };
}

export function huyDangKyNguoiNhan(db: Database, id: string, urlGoc: string): NguoiNhan {
  const r = db.query("SELECT * FROM nguoi_nhan WHERE id = ?").get(id) as DongNguoiNhan | null;
  if (!r) loiRequest(404, "KHONG_TIM_THAY", "Không tìm thấy người nhận.");
  if (r.trang_thai === "dang_ky") {
    db.query(
      "UPDATE nguoi_nhan SET trang_thai = 'huy_dang_ky', huy_luc = ? WHERE id = ?",
    ).run(bayGio(), id);
    ghiSuKien(db, "nguoi_nhan", id, "huy_dang_ky", {}, "he_thong");
  }
  const moi = db.query("SELECT * FROM nguoi_nhan WHERE id = ?").get(id) as DongNguoiNhan;
  return docDongNguoiNhan(moi, urlGoc);
}

// Link hủy trong email: token là bí mật theo người nhận — sai token = 404.
export function huyDangKyTheoToken(
  db: Database,
  token: string,
): { email: string; da_huy: boolean } | null {
  const r = db
    .query("SELECT * FROM nguoi_nhan WHERE token_huy = ?")
    .get(token.trim()) as DongNguoiNhan | null;
  if (!r) return null;
  if (r.trang_thai === "dang_ky") {
    db.query(
      "UPDATE nguoi_nhan SET trang_thai = 'huy_dang_ky', huy_luc = ? WHERE id = ?",
    ).run(bayGio(), r.id);
    ghiSuKien(db, "nguoi_nhan", r.id, "huy_dang_ky", { qua: "link_email" }, "he_thong");
    return { email: r.email, da_huy: true };
  }
  return { email: r.email, da_huy: false };
}

// --- Handler job nền ---

// Job 'giao_kenh': kiểm lại hiệu lực (đúng revision + quyền duyệt còn) rồi
// gọi adapter. Mỗi attempt ít-nhất-một-lần — adapter + checkpoint chịu
// trách nhiệm idempotent; kết quả mơ hồ → 'khong_chac' + LoiVinhVien.
export function taoHandlerGiaoKenh(cauHinhRaw: CauHinhKenh | undefined): JobHandler {
  const cauHinh = chuanHoaCauHinhKenh(cauHinhRaw);
  return async (payload, ctx) => {
    const giaoId = String(payload.giao_hang_id ?? ctx.job.entity_id ?? "");
    const giao = docGiaoRaw(ctx.db, giaoId);
    if (!giao) throw new LoiVinhVien(`Không tìm thấy lần giao: ${giaoId}`);
    if (giao.trang_thai !== "cho_giao") {
      // Đã xử lý/xong/hủy trong lúc xếp hàng — không giao lại.
      return { bo_qua: true, trang_thai: giao.trang_thai };
    }
    capNhatGiao(ctx.db, giaoId, { lan_thu: ctx.lanThu });

    const lyDo = kiemTraConHieuGiao(ctx.db, giao);
    if (lyDo) {
      voHieuGiao(ctx.db, giao, lyDo, true);
      throw new LoiVinhVien(`Lần giao vô hiệu trước khi gửi: ${lyDo}.`);
    }
    const bth = layBanTheHien(ctx.db, giao.ban_the_hien_id)!;
    const revision = layRevision(ctx.db, giao.revision_id)!;
    const thongDiep = layThongDiep(ctx.db, bth.thong_diep_id)!;
    const def = layDinhDang(bth.dinh_dang);
    if (!def) throw new LoiVinhVien(`Không tìm thấy định dạng: ${bth.dinh_dang}`);
    const adapter = layAdapter(cauHinhRaw, giao.kenh);
    if (!adapter?.gui) {
      throw new LoiVinhVien(`Kênh '${giao.kenh}' không hỗ trợ đăng.`);
    }

    // #68: campaign gắn segment → resolve audience tại thời điểm gửi
    // (sau kiểm duyệt — chưa duyệt không tới đây) + snapshot
    // doi_tuong_giao ghi một lần; retry job đọc lại snapshot.
    const campaign = thongDiep.campaign_id
      ? layCampaign(ctx.db, thongDiep.campaign_id)
      : null;
    if (campaign?.segment_id && giao.kenh === "email") {
      const audience = damBaoAudienceGiao(
        ctx.db,
        giaoId,
        campaign.segment_id,
        giao.kenh,
        cauHinh.url_goc ?? "",
      );
      if (audience) {
        ghiChiTietGiao(ctx.db, giaoId, {
          audience: audience.ds_gui,
          audience_bo_qua: audience.so_bo_qua,
          audience_segment_id: audience.segment_id,
        });
        // Counter trên giao_hang phản ánh resolve ngay — lần giao lỗi
        // (vd toàn bộ bị gate) vẫn báo đúng so_bo_qua thay vì 0.
        capNhatGiao(ctx.db, giaoId, {
          so_nguoi_nhan: audience.ds_gui.length,
          so_bo_qua: audience.so_bo_qua,
        });
      }
    }

    ctx.baoTienDo({ buoc: "gui", kenh: giao.kenh });
    ctx.assertConHan();
    try {
      const kq = await adapter.gui({
        db: ctx.db,
        giao: docGiaoRaw(ctx.db, giaoId)!,
        bth,
        revision,
        thongDiep,
        def,
        laTest: giao.la_test,
        tinHieu: ctx.tinHieu,
        assertConHan: ctx.assertConHan,
      });
      ctx.assertConHan();
      capNhatGiao(
        ctx.db,
        giaoId,
        {
          trang_thai: kq.trang_thai,
          url: kq.url ?? "",
          ma_bien_nhan: kq.ma_bien_nhan ?? "",
          so_nguoi_nhan: kq.so_nguoi_nhan ?? 0,
          so_bo_qua: kq.so_bo_qua ?? 0,
          // Merge trên chi_tiet đọc lại từ DB — giao in-memory đọc trước
          // resolve audience/checkpoint nên stale, đè mất audience_*.
          chi_tiet: { ...docGiaoRaw(ctx.db, giaoId)!.chi_tiet, ...(kq.chi_tiet ?? {}) },
          revision_thanh_cong: revision.id,
          loi: "",
          xong_luc: bayGio(),
        },
        true,
      );
      ghiSuKien(ctx.db, "giao_hang", giaoId, "giao_xong", { kenh: giao.kenh, trang_thai: kq.trang_thai }, "job");
      return {
        giao_hang_id: giaoId,
        kenh: giao.kenh,
        trang_thai: kq.trang_thai,
        url: kq.url ?? "",
        so_nguoi_nhan: kq.so_nguoi_nhan ?? 0,
        so_bo_qua: kq.so_bo_qua ?? 0,
      };
    } catch (e) {
      if (e instanceof LoiGiaoMoHo) {
        // Provider có thể đã nhận — đưa ra cho người kiểm, không retry mù.
        // chiKhiChoGiao: user hủy giữa lúc fetch chờ → không lật 'huy' lại.
        capNhatGiao(
          ctx.db,
          giaoId,
          { trang_thai: "khong_chac", loi: e.message, xong_luc: bayGio() },
          true,
        );
        ghiSuKien(ctx.db, "giao_hang", giaoId, "khong_chac", { loi: e.message }, "job");
        throw new LoiVinhVien(e.message);
      }
      if (e instanceof LoiVinhVien) {
        capNhatGiao(
          ctx.db,
          giaoId,
          { trang_thai: "loi", loi: e.message, xong_luc: bayGio() },
          true,
        );
        throw e;
      }
      if (e instanceof LoiApi) {
        capNhatGiao(
          ctx.db,
          giaoId,
          { trang_thai: "loi", loi: e.message, xong_luc: bayGio() },
          true,
        );
        throw new LoiVinhVien(e.message);
      }
      // Lỗi tạm thời (429, lỗi bên mình): job retry theo backoff. Ghi 'loi'
      // mềm ngay — job còn sống thì lần đọc sau vẫn 'cho_giao' qua job status;
      // job chết hẳn mới hiển thị 'loi' (docGiaoHieuLuc đồng bộ theo job).
      capNhatGiao(ctx.db, giaoId, { loi: e instanceof Error ? e.message : String(e) }, true);
      throw e;
    }
  };
}
