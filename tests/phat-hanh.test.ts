import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { layDinhDang } from "../src/modules/formats/index.ts";
import {
  kiemTraDauRa,
  lapContextNoiDung,
  TASK,
  type ContextTask,
} from "../src/modules/generation/index.ts";
import { lapContextSinh } from "../src/modules/context/index.ts";
import { layBanTheHien, layCampaign, layNguon } from "../src/modules/content/index.ts";
import { thongDiepChuDe } from "../src/modules/so_bao/index.ts";
import { seed } from "../src/server/seed.ts";
import { taoServerTam } from "./helpers.ts";

// Test module bản phát hành (#9): campaign loai 'phat_hanh' + field
// release, validation mảng fact/giới hạn/CTA, nguồn fact tự động vào
// provenance + đánh dấu đầu ra khi sửa field, 8 đầu ra đề xuất theo đối
// tượng, fact chưa xác nhận chỉ được để câu hỏi, giới hạn phải hiển thị
// khi tính năng bị giới hạn được nhắc, luồng chọn → sinh → duyệt dùng
// lại model chung.

type App = Awaited<ReturnType<typeof taoServerTam>>;
let app!: App;

const get = (p: string) => fetch(`${app.url}${p}`);
const getJ = async (p: string) => (await get(p)).json();
const post = (p: string, body: unknown) =>
  fetch(`${app.url}${p}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
const put = (p: string, body: unknown) =>
  fetch(`${app.url}${p}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

// Nạp một nguồn fact để fact của release có bằng chứng hợp lệ.
async function taoNguonBangChung(): Promise<string> {
  const r = await post("/api/nguon", {
    tieu_de: `Changelog test ${crypto.randomUUID().slice(0, 8)}`,
    noi_dung: "Changelog test: tính năng Passkeys và Audit log.",
    loai: "van_ban",
    cac_muc: [
      {
        id: "cl-passkeys",
        loai: "fact",
        tieu_de: "Passkeys",
        noi_dung: "Hỗ trợ đăng nhập bằng passkeys (WebAuthn) cho tất cả tài khoản.",
        assets: [],
      },
      {
        id: "cl-audit-log",
        loai: "fact",
        tieu_de: "Audit log",
        noi_dung: "Ghi audit log toàn bộ sự kiện đăng nhập và đổi quyền; giữ 365 ngày.",
        assets: [],
      },
    ],
  });
  expect(r.status).toBe(201);
  return (await r.json()).du_lieu.id as string;
}

async function taoPhatHanh(nguonId: string): Promise<string> {
  const r = await post("/api/campaign", {
    ten: "Phát hành test",
    loai: "phat_hanh",
    phien_ban: "4.0",
    ngay_phat_hanh: "2026-11-01",
    dinh_vi: "Định vị test: nhấn bảo mật.",
    tham_chieu: [{ id: "tc-1", tham_chieu: "Changelog test", ban_dich: "", nguon_id: nguonId }],
    ds_fact: [
      {
        id: "f-passkeys",
        tinh_nang: "Passkeys",
        noi_dung: "Đăng nhập bằng passkeys cho tất cả tài khoản.",
        nguon_id: nguonId,
        muc_id: "cl-passkeys",
      },
      {
        // Cố ý không nguồn → chưa xác nhận.
        id: "f-nhanh",
        tinh_nang: "Hiệu năng",
        noi_dung: "Nhanh hơn 10 lần.",
        nguon_id: null,
        muc_id: null,
      },
    ],
    gioi_han: [
      { id: "gh-sso", tinh_nang: "SSO SAML", loai: "goi", mo_ta: "chỉ gói Enterprise" },
    ],
    cta: [{ id: "c-docs", nhan: "Tài liệu", loai: "tai_lieu", url: "https://docs.example.com/v4" }],
  });
  expect(r.status).toBe(201);
  return (await r.json()).du_lieu.id as string;
}

// Chờ job sinh hoàn tất: bth có head revision. Job lỗi thì head không
// bao giờ có → hết thời gian vẫn báo bth hiện tại để assert fail rõ.
async function choSinh(
  bthId: string,
  ms = 20000,
): Promise<
  Record<string, unknown> & {
    head_revision?: { id: string; noi_dung: string };
  }
> {
  const den = Date.now() + ms;
  let bth: Record<string, unknown> | null = null;
  while (Date.now() < den) {
    const j = await getJ(`/api/ban-the-hien/${bthId}`);
    bth = j.du_lieu;
    if (bth?.head_revision_id) {
      const rev = (bth.revisions as { id: string; noi_dung: string }[]).find(
        (r) => r.id === bth!.head_revision_id,
      );
      return { ...bth, head_revision: rev };
    }
    await Bun.sleep(120);
  }
  throw new Error(`hết thời gian chờ sinh ${bthId}: ${JSON.stringify(bth)}`);
}

describe("campaign phát hành: tạo + validation", () => {
  test("tạo campaign loai phat_hanh → nguồn fact tự động + view phái sinh", async () => {
    const nguonId = await taoNguonBangChung();
    const id = await taoPhatHanh(nguonId);
    const j = await getJ(`/api/campaign/${id}`);
    const cp = j.du_lieu;
    expect(cp.loai).toBe("phat_hanh");
    expect(cp.phien_ban).toBe("4.0");
    expect(cp.dinh_vi).toBe("Định vị test: nhấn bảo mật.");
    // Nguồn fact tự động tồn tại, chiếu field release thành mục ph-*.
    expect(typeof cp.nguon_phat_hanh_id).toBe("string");
    const nguonPh = layNguon(app.db, cp.nguon_phat_hanh_id);
    expect(nguonPh).toBeTruthy();
    const dsMucId = nguonPh!.cac_muc.map((m) => m.id);
    expect(dsMucId).toContain("ph-phien-ban");
    expect(dsMucId).toContain("ph-f-f-passkeys");
    expect(dsMucId).toContain("ph-gh-gh-sso");
    expect(dsMucId).toContain("ph-cta-c-docs");
    // Fact chưa xác nhận được ghi cờ trong nội dung mục chiếu.
    const mucChuaXacNhan = nguonPh!.cac_muc.find((m) => m.id === "ph-f-f-nhanh");
    expect(mucChuaXacNhan?.noi_dung).toContain("CHƯA XÁC NHẬN");
    // Thông điệp chủ đề tồn tại + view phát hành.
    expect(cp.thong_diep_chu_de).toBeTruthy();
    expect(cp.phat_hanh.nguon_phat_hanh.id).toBe(cp.nguon_phat_hanh_id);
    const view = cp.phat_hanh.ds_fact_view as {
      id: string;
      co_bang_chung: boolean;
    }[];
    expect(view.find((f) => f.id === "f-passkeys")?.co_bang_chung).toBe(true);
    expect(view.find((f) => f.id === "f-nhanh")?.co_bang_chung).toBe(false);
    // Đề xuất 8 đầu ra theo đối tượng của story.
    expect(cp.de_xuat_muc_luc.length).toBe(8);
    const dsDinhDang = cp.de_xuat_muc_luc.map((m: { dinh_dang: string }) => m.dinh_dang);
    for (const dd of [
      "huong-dan-tich-hop",
      "thay-doi-khach-hang",
      "loi-ich-tiem-nang",
      "kiem-soat-bao-mat",
      "brief-ban-hang",
      "faq",
      "caption",
      "email-phan-doan",
    ]) {
      expect(dsDinhDang).toContain(dd);
    }
  });

  test("GET /api/phat-hanh chỉ trả campaign loại phát hành", async () => {
    const j = await getJ("/api/phat-hanh");
    expect(Array.isArray(j.du_lieu)).toBe(true);
    for (const cp of j.du_lieu) expect(cp.loai).toBe("phat_hanh");
    expect(j.du_lieu.some((c: { id: string }) => c.id === "seed-cp-phat-hanh-40")).toBe(true);
  });

  test("validation: fact/giới hạn/CTA sai cấu trúc → một 400 gom lỗi", async () => {
    const r = await post("/api/campaign", {
      ten: "Phát hành lỗi",
      loai: "phat_hanh",
      ds_fact: [
        { id: "f xấu!", tinh_nang: "X", noi_dung: "", nguon_id: "ao", muc_id: null },
        { id: "f2", tinh_nang: "", noi_dung: "y" },
      ],
      gioi_han: [{ id: "gh", tinh_nang: "X", loai: "sai", mo_ta: "" }],
      cta: [{ id: "c", nhan: "", loai: "tai_lieu", url: "khong-phai-url" }],
    });
    expect(r.status).toBe(400);
    const j = await r.json();
    expect(j.loi.ma).toBe("VALIDATION");
    const dsLoi = (j.loi.chi_tiet as string[]).join(" | ");
    expect(dsLoi).toContain("nguon_id");
    expect(dsLoi).toContain("loai");
    expect(dsLoi).toContain("url");
  });

  test("ds_fact trỏ mục không có trong nguồn → 400", async () => {
    const nguonId = await taoNguonBangChung();
    const r = await post("/api/campaign", {
      ten: "Phát hành mục sai",
      loai: "phat_hanh",
      ds_fact: [
        { id: "f1", tinh_nang: "X", noi_dung: "y", nguon_id: nguonId, muc_id: "muc-ao" },
      ],
    });
    expect(r.status).toBe(400);
    expect((await r.json()).loi.chi_tiet.join(" ")).toContain("muc_id");
  });

  test("ds_fact gửi muc_id mà không có nguon_id → 400", async () => {
    const r = await post("/api/campaign", {
      ten: "Phát hành muc lẻ",
      loai: "phat_hanh",
      ds_fact: [
        { id: "f1", tinh_nang: "X", noi_dung: "y", nguon_id: null, muc_id: "cl-passkeys" },
      ],
    });
    expect(r.status).toBe(400);
    expect((await r.json()).loi.chi_tiet.join(" ")).toContain("muc_id yêu cầu kèm nguon_id");
  });

  test("nguồn bằng chứng của fact tự vào provenance thông điệp chủ đề", async () => {
    // Fact trỏ nguồn hợp lệ nhưng nguồn đó không phải tài liệu tham chiếu:
    // provenance phải link nguồn để bộ sinh coi fact là đã xác nhận, khớp
    // cờ co_bang_chung trên UI.
    const nguonId = await taoNguonBangChung();
    const r = await post("/api/campaign", {
      ten: "Phát hành fact lẻ",
      loai: "phat_hanh",
      ds_fact: [
        {
          id: "f1",
          tinh_nang: "Passkeys",
          noi_dung: "Đăng nhập bằng passkeys.",
          nguon_id: nguonId,
          muc_id: "cl-passkeys",
        },
      ],
    });
    expect(r.status).toBe(201);
    const id = ((await r.json()).du_lieu as { id: string }).id;
    const cp = layCampaign(app.db, id)!;
    const td = thongDiepChuDe(app.db, cp)!;
    const links = (
      app.db
        .query("SELECT nguon_id FROM thong_diep_nguon WHERE thong_diep_id = ?")
        .all(td.id) as { nguon_id: string }[]
    ).map((x) => x.nguon_id);
    expect(links).toContain(nguonId);
    expect(links).toContain(cp.nguon_phat_hanh_id);
  });

  test("đề xuất đầu ra gắn đúng hồ sơ đối tượng theo persona seed", async () => {
    const j = await getJ("/api/campaign/seed-cp-phat-hanh-40");
    const khoa = (m: { id: string }) => m.id;
    const mucLuc = j.du_lieu.de_xuat_muc_luc as {
      id: string;
      doi_tuong_id: string | null;
    }[];
    const tim = (id: string) => mucLuc.find((m) => khoa(m) === id);
    // Đầu ra developer phải mang persona 'Lập trình viên tích hợp' — không
    // được đụng 'Kỹ sư' hay 'Lãnh đạo kỹ thuật' khớp keyword chung.
    expect(tim("ph-dev")?.doi_tuong_id).toBe("seed-dt-dev-40");
    expect(tim("ph-khach")?.doi_tuong_id).toBe("seed-dt-khach-hang-40");
    expect(tim("ph-tiem-nang")?.doi_tuong_id).toBe("seed-dt-tiem-nang-40");
    expect(tim("ph-bao-mat")?.doi_tuong_id).toBe("seed-dt-bao-mat-40");
    expect(tim("ph-sales")?.doi_tuong_id).toBe("seed-dt-sales-40");
    expect(tim("ph-support")?.doi_tuong_id).toBe("seed-dt-support-40");
  });

  test("GET /api/campaign?loai=so_bao loại campaign phát hành khỏi danh sách", async () => {
    const j = await getJ("/api/campaign?loai=so_bao");
    expect(Array.isArray(j.du_lieu)).toBe(true);
    expect(j.du_lieu.some((c: { loai: string }) => c.loai === "phat_hanh")).toBe(false);
    expect(j.du_lieu.length).toBeGreaterThan(0);
  });

  test("loai sai danh mục → 400; đổi loai đã đặt → 400", async () => {
    const r1 = await post("/api/campaign", { ten: "X", loai: "sai_loai" });
    expect(r1.status).toBe(400);
    const nguonId = await taoNguonBangChung();
    const id = await taoPhatHanh(nguonId);
    const r2 = await put(`/api/campaign/${id}`, { ten: "X", loai: "so_bao" });
    expect(r2.status).toBe(400);
    const j2 = await r2.json();
    expect(j2.loi.chi_tiet.join(" ")).toContain("phat_hanh");
  });

  test("POST suy loại từ field: có ds_fact mà không gửi loai → phat_hanh", async () => {
    const r = await post("/api/campaign", {
      ten: "Suy loại",
      ds_fact: [{ id: "f1", tinh_nang: "X", noi_dung: "y", nguon_id: null, muc_id: null }],
    });
    expect(r.status).toBe(201);
    expect((await r.json()).du_lieu.loai).toBe("phat_hanh");
  });
});

describe("PUT field release → nguồn tự động đổi → đánh dấu đầu ra", () => {
  test("đổi phien_ban: revision nguồn mới + phat_hien trong response", async () => {
    const nguonId = await taoNguonBangChung();
    const id = await taoPhatHanh(nguonId);
    const cp0 = layCampaign(app.db, id)!;
    const revCu = layNguon(app.db, cp0.nguon_phat_hanh_id)!.head_revision_id;

    const r = await put(`/api/campaign/${id}`, {
      ten: "Phát hành test",
      phien_ban: "4.0.1",
    });
    expect(r.status).toBe(200);
    const kq = (await r.json()).du_lieu;
    const revMoi = layNguon(app.db, cp0.nguon_phat_hanh_id)!.head_revision_id;
    expect(revMoi).not.toBe(revCu);
    // phat_hien.trả detection — không có đầu ra nào nên ds_task rỗng.
    expect(kq.phat_hien).toBeTruthy();
    expect(kq.phat_hien.thay_doi).toBeTruthy();
    // Mục phiên bản trong nguồn fact mang giá trị mới.
    const nguonMoi = layNguon(app.db, cp0.nguon_phat_hanh_id)!;
    expect(nguonMoi.cac_muc.find((m) => m.id === "ph-phien-ban")?.noi_dung).toContain("4.0.1");
  });

  test("PUT không đổi nội dung nguồn → không tạo detection rỗng", async () => {
    const nguonId = await taoNguonBangChung();
    const id = await taoPhatHanh(nguonId);
    const r = await put(`/api/campaign/${id}`, { ten: "Phát hành test" });
    expect(r.status).toBe(200);
    expect((await r.json()).du_lieu.phat_hien).toBeNull();
  });

  test("PUT chỉ một phần: field release khác giữ nguyên", async () => {
    const nguonId = await taoNguonBangChung();
    const id = await taoPhatHanh(nguonId);
    await put(`/api/campaign/${id}`, { ten: "Đổi tên phát hành" });
    const j = await getJ(`/api/campaign/${id}`);
    expect(j.du_lieu.ten).toBe("Đổi tên phát hành");
    expect(j.du_lieu.phien_ban).toBe("4.0");
    expect(j.du_lieu.ds_fact.length).toBe(2);
    expect(j.du_lieu.gioi_han.length).toBe(1);
    expect(j.du_lieu.cta.length).toBe(1);
  });
});

describe("context sinh + kiểm chứng đầu ra phát hành", () => {
  test("ContextTask.phat_hanh: fact xac_nhan chỉ khi nguồn trong provenance", async () => {
    const cp = layCampaign(app.db, "seed-cp-phat-hanh-40")!;
    const j = await getJ(`/api/campaign/${cp.id}`);
    const tdId = j.du_lieu.thong_diep_chu_de.id as string;
    // Tạo bth tay để có input cho lapContextNoiDung.
    const bth = layBanTheHien(app.db, "seed-bth-ph-khach")!;
    const ctx = lapContextNoiDung(app.db, {
      bth,
      task: TASK.nhap_ban_the_hien,
      context_sinh: lapContextSinh(app.db, {
        thuong_hieu_id: null,
        doi_tuong_id: null,
        ghi_de: {},
      }),
      doi_tuong: "Khách hàng doanh nghiệp (fixture)",
      campaign_id: cp.id,
    });
    const ph = ctx.phat_hanh;
    expect(ph).toBeTruthy();
    expect(ph!.phien_ban).toBe("4.0");
    expect(ph!.ten).toBe("MaiSuite 4.0");
    const map = new Map(ph!.ds_fact.map((f) => [f.id, f.xac_nhan]));
    expect(map.get("fact-passkeys")).toBe(true);
    expect(map.get("fact-sso")).toBe(true);
    // fact-hieu-nang không nguon_id → chưa xác nhận → cờ thiếu chứng cứ.
    expect(map.get("fact-hieu-nang")).toBe(false);
    expect(ctx.thieu_chung_cu).toContain("fact_chua_xac_nhan");
    expect(ph!.gioi_han.length).toBe(3);
    expect(ph!.cta.length).toBe(3);
  });

  test("nguồn sửa xóa mục fact trỏ tới → fact xac_nhan=false", async () => {
    // Cùng semantic con trỏ bằng chứng với gây quỹ: muc_id chỉ còn hiệu
    // lực khi mục đó còn trong cac_muc của revision nguồn đã ghim.
    const nguonId = await taoNguonBangChung();
    const id = await taoPhatHanh(nguonId);
    const j = await getJ(`/api/campaign/${id}`);
    const mucDev = j.du_lieu.de_xuat_muc_luc.find(
      (m: { id: string }) => m.id === "ph-dev",
    );
    await put(`/api/campaign/${id}`, {
      ten: "Phát hành test",
      muc_luc: [mucDev],
    });
    const r = await post(`/api/campaign/${id}/chon`, { ds_muc_id: ["ph-dev"] });
    expect(r.status).toBe(200);
    const bthId = (await r.json()).du_lieu.ds_bth[0].id as string;
    const bth = layBanTheHien(app.db, bthId)!;
    const lam = () =>
      lapContextNoiDung(app.db, {
        bth,
        task: TASK.nhap_ban_the_hien,
        context_sinh: null,
        doi_tuong: "dev",
        campaign_id: id,
      });
    const mapTruoc = new Map(lam().phat_hanh!.ds_fact.map((f) => [f.id, f.xac_nhan]));
    expect(mapTruoc.get("f-passkeys")).toBe(true);

    // Revision nguồn mới xóa mục cl-passkeys mà fact trỏ tới.
    const nguon = layNguon(app.db, nguonId)!;
    const up = await put(`/api/nguon/${nguonId}`, {
      tieu_de: nguon.tieu_de,
      noi_dung: nguon.noi_dung,
      dua_tren_revision_id: nguon.head_revision_id,
      cac_muc: nguon.cac_muc.filter((m) => m.id !== "cl-passkeys"),
    });
    expect(up.status).toBe(200);
    await put(`/api/campaign/${id}`, { ten: "Phát hành test" });

    const ctx = lam();
    const map = new Map(ctx.phat_hanh!.ds_fact.map((f) => [f.id, f.xac_nhan]));
    expect(map.get("f-passkeys")).toBe(false);
    expect(ctx.thieu_chung_cu).toContain("fact_chua_xac_nhan");
  });

  test("kiemTraDauRa cảnh báo: giới hạn thiếu, claim chưa xác nhận, marker bịa", () => {
    const ctx: ContextTask = {
      task: TASK.nhap_ban_the_hien,
      thong_diep: { tieu_de: "Phát hành X", noi_dung: "", revision_id: null },
      ds_nguon: [],
      dinh_dang: layDinhDang("thay-doi-khach-hang"),
      doi_tuong: "khách",
      ngon_ngu: "vi",
      context_sinh: null,
      thieu_chung_cu: [],
      gioi_han_dau_ra: 100_000,
      phat_hanh: {
        ten: "X",
        phien_ban: "4.0",
        ngay_phat_hanh: "2026-11-01",
        dinh_vi: "",
        gioi_han: [
          { id: "gh-sso", tinh_nang: "SSO SAML", loai: "goi", mo_ta: "chỉ gói Enterprise" },
        ],
        cta: [],
        ds_fact: [
          {
            id: "f-ao",
            tinh_nang: "Passkeys",
            noi_dung: "x",
            nguon_id: null,
            muc_id: null,
            xac_nhan: false,
          },
        ],
      },
    };
    const kq = kiemTraDauRa(ctx, {
      noi_dung: JSON.stringify({
        tieu_de: "X 4.0",
        cac_thay_doi: [
          "Passkeys đăng nhập không mật khẩu",
          "SSO SAML nhiều IdP [F:f-bia]", // marker trỏ id không khai báo
        ],
      }),
      trich_dan: [],
      canh_bao: [],
    });
    // Nhắc 'SSO SAML' mà không hiển thị 'chỉ gói Enterprise' → cảnh báo.
    expect(kq.canh_bao.some((c) => c.includes("gh-sso"))).toBe(true);
    // Passkeys là fact chưa xác nhận nhưng trình bày như sự thật → cảnh báo.
    expect(kq.canh_bao.some((c) => c.includes("f-ao"))).toBe(true);
    // Marker [F:f-bia] không có trong ds_fact → cảnh báo marker bịa.
    expect(kq.canh_bao.some((c) => c.includes("f-bia"))).toBe(true);
  });

  test("kiemTraDauRa sạch khi giới hạn hiển thị + fact chưa xác nhận để câu hỏi", () => {
    const ctx: ContextTask = {
      task: TASK.nhap_ban_the_hien,
      thong_diep: { tieu_de: "X", noi_dung: "", revision_id: null },
      ds_nguon: [],
      dinh_dang: layDinhDang("thay-doi-khach-hang"),
      doi_tuong: "khách",
      ngon_ngu: "vi",
      context_sinh: null,
      thieu_chung_cu: [],
      gioi_han_dau_ra: 100_000,
      phat_hanh: {
        ten: "X",
        phien_ban: "4.0",
        ngay_phat_hanh: "2026-11-01",
        dinh_vi: "",
        gioi_han: [
          { id: "gh-sso", tinh_nang: "SSO SAML", loai: "goi", mo_ta: "chỉ gói Enterprise" },
        ],
        cta: [],
        ds_fact: [
          {
            id: "f-ao",
            tinh_nang: "Passkeys",
            noi_dung: "x",
            nguon_id: null,
            muc_id: null,
            xac_nhan: false,
          },
        ],
      },
    };
    const kq = kiemTraDauRa(ctx, {
      noi_dung: JSON.stringify({
        tieu_de: "X 4.0",
        cac_thay_doi: ["SSO SAML nhiều IdP — chỉ gói Enterprise [GH:gh-sso]"],
        gioi_han: ["SSO SAML: chỉ gói Enterprise [GH:gh-sso]"],
        con_thieu: ["[CÂU HỎI: 'Passkeys' chưa có bằng chứng nguồn.]"],
      }),
      trich_dan: [],
      canh_bao: [],
    });
    const canhBaoPh = kq.canh_bao.filter((c) => c.includes("gh-sso") || c.includes("f-ao"));
    expect(canhBaoPh).toEqual([]);
  });
});

describe("chọn đầu ra → sinh → nội dung release", () => {
  test("nháp hướng dẫn developer: [F:]/[GH:] marker + câu hỏi cho fact chưa xác nhận", async () => {
    // Campaign riêng để không đụng đầu ra seed (sinh lại đầu ra đã
    // duyệt đánh dấu 'thay_the').
    const nguonId = await taoNguonBangChung();
    const id = await taoPhatHanh(nguonId);
    const j0 = await getJ(`/api/campaign/${id}`);
    const dsMuc = (j0.du_lieu.de_xuat_muc_luc as { id: string }[]).filter((m) =>
      ["ph-dev", "ph-email"].includes(m.id),
    );
    expect(dsMuc.length).toBe(2);
    const r0 = await put(`/api/campaign/${id}`, {
      ten: "Phát hành test",
      muc_luc: dsMuc,
    });
    expect(r0.status).toBe(200);
    const r = await post(`/api/campaign/${id}/chon`, {
      ds_muc_id: ["ph-dev", "ph-email"],
    });
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.du_lieu.ds_bth.length).toBe(2);
    const bthDev = j.du_lieu.ds_bth.find(
      (b: { dinh_dang: string }) => b.dinh_dang === "huong-dan-tich-hop",
    );
    const bth = await choSinh(bthDev.id);
    const nd = JSON.parse(bth.head_revision!.noi_dung as string);
    // Claim tính năng đi kèm marker [F:<fact_id>] của release.
    const cacBuoc = (nd.cac_buoc as string[]).join("\n");
    expect(cacBuoc).toContain("[F:f-passkeys]");
    // Giới hạn phải hiển thị khi tính năng bị giới hạn được nhắc.
    expect((nd.gioi_han as string[]).join("\n")).toContain("[GH:gh-sso]");
    expect((nd.gioi_han as string[]).join("\n")).toContain("Enterprise");
    // Fact chưa xác nhận chỉ ở dạng câu hỏi — không phải dòng claim.
    expect(cacBuoc).toContain("[CÂU HỎI");
    expect(cacBuoc).not.toMatch(/nhanh hơn 10 lần[^[]*$/m);
    // CTA trỏ đúng trang tài liệu đã khai báo.
    expect(nd.lien_ket).toBe("https://docs.example.com/v4");
  });
});

describe("demo seed: bản phát hành 4.0 lưu bền", () => {
  test("campaign + đầu ra dev/khách/sales tồn tại, dev đã xuất phục vụ /p/", async () => {
    const j = await getJ("/api/campaign/seed-cp-phat-hanh-40");
    const cp = j.du_lieu;
    expect(cp.loai).toBe("phat_hanh");
    expect(cp.phien_ban).toBe("4.0");
    expect(cp.muc_luc.length).toBe(8);
    const rDev = await get("/api/ban-the-hien/seed-bth-ph-dev");
    const dev = (await rDev.json()).du_lieu;
    expect(dev.trang_thai).toBe("da_duyet");
    // Trang nội bộ phục vụ bản đã xuất.
    const page = await get("/p/seed-bth-ph-dev");
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain("Hướng dẫn tích hợp MaiSuite 4.0");
    const khach = (await (await get("/api/ban-the-hien/seed-bth-ph-khach")).json()).du_lieu;
    expect(khach.trang_thai).toBe("cho_duyet");
    const sales = (await (await get("/api/ban-the-hien/seed-bth-ph-sales")).json()).du_lieu;
    expect(sales.trang_thai).toBe("da_duyet");
  });

  test("sửa field release trên demo → task sửa cho đầu ra phụ thuộc", async () => {
    const r = await put("/api/campaign/seed-cp-phat-hanh-40", {
      ten: "MaiSuite 4.0",
      ngay_phat_hanh: "2026-11-15",
    });
    expect(r.status).toBe(200);
    const kq = (await r.json()).du_lieu;
    expect(kq.phat_hien?.thay_doi).toBeTruthy();
    const dsTask = kq.phat_hien.ds_task as { ban_the_hien_id: string; loai: string }[];
    // Đầu ra đã xuất (dev) cần sửa thủ công; đầu ra chưa xuất sinh lại.
    const taskDev = dsTask.find((t) => t.ban_the_hien_id === "seed-bth-ph-dev");
    const taskKhach = dsTask.find((t) => t.ban_the_hien_id === "seed-bth-ph-khach");
    expect(taskDev).toBeTruthy();
    expect(taskDev!.loai).toBe("thu_cong");
    expect(taskKhach).toBeTruthy();
    expect(taskKhach!.loai).toBe("sinh_lai");
  });
});

beforeAll(async () => {
  app = await taoServerTam();
  seed(app.db);
});
afterAll(async () => {
  await app.dong();
});
