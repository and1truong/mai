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

// Test module gây quỹ (#10): campaign loai 'gay_quy' — mục tiêu + số
// tiền kèm tiền tệ, tác động đã đạt/ước tính phân biệt có con trỏ bằng
// chứng, trích dẫn được phép dùng, ghi chú quyền asset, 7 đầu ra đề
// xuất gồm bản ngôn ngữ phụ khi chọn, kiểm chứng chống bịa tên/lời/
// số đo, CTA quyên góp trỏ đúng đích được cung cấp.

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

// Nạp một nguồn tư liệu hiện trường để tác động/trích dẫn có bằng chứng.
async function taoNguonHienTruong(): Promise<string> {
  const r = await post("/api/nguon", {
    tieu_de: `Ghi chú hiện trường test ${crypto.randomUUID().slice(0, 8)}`,
    noi_dung: "Ghi chú test: công trình nước sạch Làng A.",
    loai: "van_ban",
    cac_muc: [
      {
        id: "ht-lang-a",
        loai: "fact",
        tieu_de: "Làng A",
        noi_dung: "Giếng khoan Làng A hoàn thành 2026-01: 500 người dùng nước sạch.",
        assets: [],
      },
      {
        id: "ht-trich-dan",
        loai: "fact",
        tieu_de: "Trích dẫn",
        noi_dung: "Bà X: 'Nước sạch đã về tận làng tôi.'",
        assets: [],
      },
    ],
  });
  expect(r.status).toBe(201);
  return (await r.json()).du_lieu.id as string;
}

async function taoGayQuy(nguonId: string): Promise<string> {
  const r = await post("/api/campaign", {
    ten: "Gây quỹ test",
    loai: "gay_quy",
    muc_tieu: "Gây quỹ công trình nước sạch cho Làng B.",
    so_tien_muc_tieu: 500000000,
    tien_te: "VND",
    thong_diep_loi: "Làng A đã có nước sạch. Làng B là làng tiếp theo.",
    ngon_ngu_phu: "en",
    ds_tac_dong: [
      {
        id: "td-lang-a",
        tieu_de: "Giếng khoan Làng A",
        noi_dung: "500 người dùng nước sạch từ 2026-01.",
        trang_thai: "da_dat",
        so_lieu: "500",
        don_vi: "người",
        nguon_id: nguonId,
        muc_id: "ht-lang-a",
      },
      {
        id: "td-lang-b",
        tieu_de: "Người hưởng lợi Làng B",
        noi_dung: "Ước tính 300 người sẽ có nước sạch.",
        trang_thai: "uoc_tinh",
        so_lieu: "300",
        don_vi: "người",
        nguon_id: nguonId,
        muc_id: "ht-lang-a",
      },
      {
        // Cố ý không nguồn → chưa xác nhận.
        id: "td-chua-do",
        tieu_de: "Tỉ lệ đi học tăng",
        noi_dung: "Chưa đo được.",
        trang_thai: "uoc_tinh",
        so_lieu: "",
        don_vi: "",
        nguon_id: null,
        muc_id: null,
      },
    ],
    ds_trich_dan: [
      {
        id: "tq-ba-x",
        ten_nguoi: "Bà X (Làng A)",
        loi: "Nước sạch đã về tận làng tôi.",
        nguon_id: nguonId,
        muc_id: "ht-trich-dan",
      },
      {
        id: "tq-chua-nguon",
        ten_nguoi: "Người dân Làng B",
        loi: "Chúng tôi cần nước sạch.",
        nguon_id: null,
        muc_id: null,
      },
    ],
    cta: [
      {
        id: "cta-qg",
        nhan: "Quyên góp",
        loai: "quyen_gop",
        url: "https://quyen-gop.example.com/lang-b",
      },
    ],
    tham_chieu: [
      { id: "tc-1", tham_chieu: "Ghi chú hiện trường", ban_dich: "", nguon_id: nguonId },
    ],
  });
  expect(r.status).toBe(201);
  return (await r.json()).du_lieu.id as string;
}

// Chờ job sinh hoàn tất: bth có head revision.
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

function ctxGayQuy(ngonNgu = "vi"): ContextTask {
  return {
    task: TASK.nhap_ban_the_hien,
    thong_diep: { tieu_de: "Gây quỹ X", noi_dung: "", revision_id: null },
    ds_nguon: [],
    dinh_dang: layDinhDang("bao-cao-tac-dong"),
    doi_tuong: "nhà tài trợ",
    ngon_ngu: ngonNgu,
    context_sinh: null,
    thieu_chung_cu: [],
    gioi_han_dau_ra: 100_000,
    gay_quy: {
      ten: "X",
      muc_tieu: "Gây quỹ cho Làng B.",
      so_tien_muc_tieu: 500000000,
      tien_te: "VND",
      thong_diep_loi: "Làng A xong. Làng B tiếp theo.",
      ngon_ngu_phu: "en",
      cta: [
        {
          id: "cta-qg",
          nhan: "Quyên góp",
          loai: "quyen_gop",
          url: "https://quyen-gop.example.com/lang-b",
        },
      ],
      ds_tac_dong: [
        {
          id: "td-a",
          tieu_de: "Giếng khoan Làng A",
          noi_dung: "500 người dùng nước sạch.",
          trang_thai: "da_dat",
          so_lieu: "500",
          don_vi: "người",
          nguon_id: "n1",
          muc_id: null,
          xac_nhan: true,
        },
        {
          id: "td-b",
          tieu_de: "Người hưởng lợi Làng B",
          noi_dung: "Ước tính 300 người.",
          trang_thai: "uoc_tinh",
          so_lieu: "300",
          don_vi: "người",
          nguon_id: "n1",
          muc_id: null,
          xac_nhan: true,
        },
        {
          id: "td-ao",
          tieu_de: "Tỉ lệ đi học tăng",
          noi_dung: "Chưa đo được.",
          trang_thai: "uoc_tinh",
          so_lieu: "",
          don_vi: "",
          nguon_id: null,
          muc_id: null,
          xac_nhan: false,
        },
      ],
      ds_trich_dan: [
        {
          id: "tq-x",
          ten_nguoi: "Bà X (Làng A)",
          loi: "Nước sạch đã về tận làng tôi.",
          nguon_id: "n1",
          muc_id: null,
          xac_nhan: true,
        },
        {
          id: "tq-ao",
          ten_nguoi: "Người dân Làng B",
          loi: "Chúng tôi cần nước sạch.",
          nguon_id: null,
          muc_id: null,
          xac_nhan: false,
        },
      ],
    },
  };
}

describe("campaign gây quỹ: tạo + validation", () => {
  test("tạo campaign loai gay_quy → nguồn fact tự động + view phái sinh", async () => {
    const nguonId = await taoNguonHienTruong();
    const id = await taoGayQuy(nguonId);
    const j = await getJ(`/api/campaign/${id}`);
    const cp = j.du_lieu;
    expect(cp.loai).toBe("gay_quy");
    expect(cp.so_tien_muc_tieu).toBe(500000000);
    expect(cp.tien_te).toBe("VND");
    expect(cp.ngon_ngu_phu).toBe("en");
    // Nguồn fact tự động chiếu field gây quỹ thành mục gq-*.
    expect(typeof cp.nguon_gay_quy_id).toBe("string");
    const nguonGq = layNguon(app.db, cp.nguon_gay_quy_id);
    expect(nguonGq).toBeTruthy();
    const dsMucId = nguonGq!.cac_muc.map((m) => m.id);
    expect(dsMucId).toContain("gq-muc-tieu");
    expect(dsMucId).toContain("gq-so-tien");
    expect(dsMucId).toContain("gq-td-td-lang-a");
    expect(dsMucId).toContain("gq-tq-tq-ba-x");
    expect(dsMucId).toContain("gq-cta-cta-qg");
    expect(dsMucId).toContain("gq-ngon-ngu-phu");
    // Tác động ước tính được ghi cờ trong tiêu đề mục chiếu.
    const mucUocTinh = nguonGq!.cac_muc.find((m) => m.id === "gq-td-td-lang-b");
    expect(mucUocTinh?.tieu_de).toContain("ƯỚC TÍNH");
    const mucDaDat = nguonGq!.cac_muc.find((m) => m.id === "gq-td-td-lang-a");
    expect(mucDaDat?.tieu_de).toContain("ĐÃ ĐẠT");
    // Thông điệp chủ đề + view gây quỹ.
    expect(cp.thong_diep_chu_de).toBeTruthy();
    const view = cp.gay_quy.ds_tac_dong_view as {
      id: string;
      co_bang_chung: boolean;
    }[];
    expect(view.find((t) => t.id === "td-lang-a")?.co_bang_chung).toBe(true);
    expect(view.find((t) => t.id === "td-chua-do")?.co_bang_chung).toBe(false);
    // Đề xuất 7 đầu ra: 6 chuẩn + bản ngôn ngữ phụ 'en'.
    expect(cp.de_xuat_muc_luc.length).toBe(7);
    const en = cp.de_xuat_muc_luc.find(
      (m: { id: string }) => m.id === "gq-ngon-ngu-2",
    );
    expect(en?.ngon_ngu).toBe("en");
  });

  test("không chọn ngôn ngữ phụ → đề xuất 6 đầu ra", async () => {
    const nguonId = await taoNguonHienTruong();
    const r = await post("/api/campaign", {
      ten: "Gây quỹ một ngôn ngữ",
      loai: "gay_quy",
      muc_tieu: "x",
      ds_tac_dong: [
        {
          id: "td-1",
          tieu_de: "Giếng khoan Làng A",
          noi_dung: "x",
          trang_thai: "da_dat",
          so_lieu: "",
          don_vi: "",
          nguon_id: nguonId,
          muc_id: "ht-lang-a",
        },
      ],
      ds_trich_dan: [],
      ghi_chu_quyen: [],
      cta: [],
    });
    expect(r.status).toBe(201);
    const id = (await r.json()).du_lieu.id as string;
    const j = await getJ(`/api/campaign/${id}`);
    expect(j.du_lieu.de_xuat_muc_luc.length).toBe(6);
  });

  test("GET /api/gay-quy chỉ trả campaign loại gay_quy", async () => {
    const j = await getJ("/api/gay-quy");
    expect(Array.isArray(j.du_lieu)).toBe(true);
    for (const cp of j.du_lieu) expect(cp.loai).toBe("gay_quy");
    expect(j.du_lieu.some((c: { id: string }) => c.id === "seed-cp-gay-quy-khe-tre")).toBe(
      true,
    );
  });

  test("validation: tác động/trích dẫn/ghi chú quyền sai → 400 gom lỗi", async () => {
    const r = await post("/api/campaign", {
      ten: "Gây quỹ lỗi",
      loai: "gay_quy",
      ds_tac_dong: [
        { id: "td xấu!", tieu_de: "", noi_dung: "x", trang_thai: "sai" },
        { id: "td2", tieu_de: "Y", noi_dung: "" },
      ],
      ds_trich_dan: [{ id: "tq1", ten_nguoi: "", loi: "" }],
      ghi_chu_quyen: [{ id: "q1", asset_id: "asset-ao", ghi_chu: "" }],
    });
    expect(r.status).toBe(400);
    const j = await r.json();
    expect(j.loi.ma).toBe("VALIDATION");
    const dsLoi = (j.loi.chi_tiet as string[]).join(" | ");
    expect(dsLoi).toContain("trang_thai");
    expect(dsLoi).toContain("tieu_de là bắt buộc");
    expect(dsLoi).toContain("ten_nguoi là bắt buộc");
    expect(dsLoi).toContain("asset_id");
  });

  test("so_tien_muc_tieu không kèm tien_te → 400", async () => {
    const r = await post("/api/campaign", {
      ten: "Gây quỹ thiếu tiền tệ",
      loai: "gay_quy",
      so_tien_muc_tieu: 1000,
    });
    expect(r.status).toBe(400);
    expect((await r.json()).loi.chi_tiet.join(" ")).toContain("tien_te");
  });

  test("con trỏ bằng chứng: muc_id lẻ / mục không có trong nguồn → 400", async () => {
    const nguonId = await taoNguonHienTruong();
    const r1 = await post("/api/campaign", {
      ten: "GQ muc lẻ",
      loai: "gay_quy",
      ds_tac_dong: [
        {
          id: "td1",
          tieu_de: "X",
          noi_dung: "y",
          trang_thai: "da_dat",
          nguon_id: null,
          muc_id: "ht-lang-a",
        },
      ],
    });
    expect(r1.status).toBe(400);
    expect((await r1.json()).loi.chi_tiet.join(" ")).toContain(
      "muc_id yêu cầu kèm nguon_id",
    );
    const r2 = await post("/api/campaign", {
      ten: "GQ muc sai",
      loai: "gay_quy",
      ds_tac_dong: [
        {
          id: "td1",
          tieu_de: "X",
          noi_dung: "y",
          trang_thai: "da_dat",
          nguon_id: nguonId,
          muc_id: "muc-ao",
        },
      ],
    });
    expect(r2.status).toBe(400);
    expect((await r2.json()).loi.chi_tiet.join(" ")).toContain("muc_id");
  });

  test("POST suy loại từ field: có ds_tac_dong mà không gửi loai → gay_quy", async () => {
    const r = await post("/api/campaign", {
      ten: "Suy loại gây quỹ",
      ds_tac_dong: [
        {
          id: "td1",
          tieu_de: "X",
          noi_dung: "y",
          trang_thai: "da_dat",
          nguon_id: null,
          muc_id: null,
        },
      ],
    });
    expect(r.status).toBe(201);
    expect((await r.json()).du_lieu.loai).toBe("gay_quy");
  });
});

describe("PUT field gây quỹ → nguồn tự động đổi → đánh dấu đầu ra", () => {
  test("đổi so_tien_muc_tieu: revision nguồn mới + phat_hien trong response", async () => {
    const nguonId = await taoNguonHienTruong();
    const id = await taoGayQuy(nguonId);
    const cp0 = layCampaign(app.db, id)!;
    const revCu = layNguon(app.db, cp0.nguon_gay_quy_id)!.head_revision_id;

    const r = await put(`/api/campaign/${id}`, {
      ten: "Gây quỹ test",
      so_tien_muc_tieu: 600000000,
    });
    expect(r.status).toBe(200);
    const kq = (await r.json()).du_lieu;
    const revMoi = layNguon(app.db, cp0.nguon_gay_quy_id)!.head_revision_id;
    expect(revMoi).not.toBe(revCu);
    expect(kq.phat_hien).toBeTruthy();
    expect(kq.phat_hien.thay_doi).toBeTruthy();
    const nguonMoi = layNguon(app.db, cp0.nguon_gay_quy_id)!;
    expect(
      nguonMoi.cac_muc.find((m) => m.id === "gq-so-tien")?.noi_dung,
    ).toContain("600");
  });

  test("PUT không đổi nội dung nguồn → không tạo detection rỗng", async () => {
    const nguonId = await taoNguonHienTruong();
    const id = await taoGayQuy(nguonId);
    const r = await put(`/api/campaign/${id}`, { ten: "Gây quỹ test" });
    expect(r.status).toBe(200);
    expect((await r.json()).du_lieu.phat_hien).toBeNull();
  });

  test("PUT xóa tien_te khi vẫn có số tiền → 400", async () => {
    const nguonId = await taoNguonHienTruong();
    const id = await taoGayQuy(nguonId);
    const r = await put(`/api/campaign/${id}`, { ten: "Gây quỹ test", tien_te: "" });
    expect(r.status).toBe(400);
    expect((await r.json()).loi.chi_tiet.join(" ")).toContain("tien_te");
  });
});

describe("context sinh + kiểm chứng đầu ra gây quỹ", () => {
  test("ContextTask.gay_quy: xac_nhan chỉ khi nguồn trong provenance", async () => {
    const cp = layCampaign(app.db, "seed-cp-gay-quy-khe-tre")!;
    const j = await getJ(`/api/campaign/${cp.id}`);
    const tdId = j.du_lieu.thong_diep_chu_de.id as string;
    expect(tdId).toBeTruthy();
    const bth = layBanTheHien(app.db, "seed-bth-gq-cau-chuyen")!;
    const ctx = lapContextNoiDung(app.db, {
      bth,
      task: TASK.nhap_ban_the_hien,
      context_sinh: lapContextSinh(app.db, {
        thuong_hieu_id: null,
        doi_tuong_id: null,
        ghi_de: {},
      }),
      doi_tuong: "Công chúng quan tâm (fixture)",
      campaign_id: cp.id,
    });
    const gq = ctx.gay_quy;
    expect(gq).toBeTruthy();
    expect(gq!.ten).toBe("Nước sạch cho Làng Khe Tre");
    const mapTd = new Map(gq!.ds_tac_dong.map((t) => [t.id, t.xac_nhan]));
    expect(mapTd.get("td-gieng-rom")).toBe(true);
    expect(mapTd.get("td-nguoi-khe-tre")).toBe(true);
    expect(mapTd.get("td-hoc-sinh")).toBe(false);
    const mapTq = new Map(gq!.ds_trich_dan.map((t) => [t.id, t.xac_nhan]));
    expect(mapTq.get("tq-ba-hoa")).toBe(true);
    expect(mapTq.get("tq-khe-tre")).toBe(false);
    expect(ctx.thieu_chung_cu).toContain("tac_dong_chua_xac_nhan");
    expect(ctx.thieu_chung_cu).toContain("trich_dan_chua_nguon");
  });

  test("kiemTraDauRa cảnh báo: marker bịa, trích dẫn bịa, ước tính viết như đã đạt, thiếu tiền tệ, số đo lạ", () => {
    const kq = kiemTraDauRa(ctxGayQuy(), {
      noi_dung: JSON.stringify({
        tieu_de: "Báo cáo",
        tac_dong_da_dat: [
          "Giếng khoan Làng A — 500 người. [TD:td-a]",
          "Giếng khác — 999 người. [TD:td-bia]", // marker trỏ id không khai báo
        ],
        tac_dong_uoc_tinh: [
          "Người hưởng lợi Làng B — 300 người. [TD:td-b]", // thiếu nhãn ước tính
          "Tỉ lệ đi học tăng — 20% người. [TD:td-ao]", // chưa xác nhận mà viết như fact
        ],
        muc_tieu: "Mục tiêu gây quỹ: 500000000", // nhắc số tiền mà thiếu VND
        noi_dung:
          'Bà X nói: "Nước sạch đã thay đổi cả làng." Và "Câu nói hoàn toàn bịa không có trong tư liệu."',
        trich_dan: ['"Nước sạch đã về tận làng tôi." — Bà X (Làng A) [TQ:tq-x]'],
        cta: "Quyên góp",
        lien_ket: "https://quyen-gop.example.com/lang-b",
      }),
      trich_dan: [],
      canh_bao: [],
    });
    const cb = kq.canh_bao.join("\n");
    expect(cb).toContain("td-bia");
    expect(cb).toContain("ước tính");
    expect(cb).toContain("td-ao");
    expect(cb).toContain("tiền tệ");
    expect(cb).toContain("bịa lời");
    expect(cb).toContain("20%");
  });

  test("kiemTraDauRa sạch khi đúng convention: ước tính có nhãn, câu hỏi cho mục chưa xác nhận", () => {
    const kq = kiemTraDauRa(ctxGayQuy(), {
      noi_dung: JSON.stringify({
        tieu_de: "Báo cáo",
        tac_dong_da_dat: ["Giếng khoan Làng A — 500 người. [TD:td-a]"],
        tac_dong_uoc_tinh: [
          "Ước tính: Người hưởng lợi Làng B — 300 người. [TD:td-b]",
          "[CÂU HỎI: 'Tỉ lệ đi học tăng' chưa có bằng chứng nguồn.]",
          "[CÂU HỎI: 'Người dân Làng B' chưa có nguồn tư liệu.]",
        ],
        muc_tieu: "Mục tiêu gây quỹ: 500.000.000 VND",
        noi_dung: '"Nước sạch đã về tận làng tôi." — Bà X.',
        trich_dan: ['"Nước sạch đã về tận làng tôi." — Bà X (Làng A) [TQ:tq-x]'],
        cta: "Quyên góp: https://quyen-gop.example.com/lang-b",
        lien_ket: "https://quyen-gop.example.com/lang-b",
      }),
      trich_dan: [],
      canh_bao: [],
    });
    expect(kq.canh_bao).toEqual([]);
  });

  test("kiemTraDauRa: thiếu đích quyên góp được cung cấp → cảnh báo", () => {
    const kq = kiemTraDauRa(ctxGayQuy(), {
      noi_dung: JSON.stringify({
        tieu_de: "Báo cáo",
        tac_dong_da_dat: ["Giếng khoan Làng A — 500 người. [TD:td-a]"],
        tac_dong_uoc_tinh: [],
        muc_tieu: "",
        noi_dung: "Nội dung.",
        trich_dan: [],
        cta: "Quyên góp",
        lien_ket: "https://khac.example.com",
      }),
      trich_dan: [],
      canh_bao: [],
    });
    expect(kq.canh_bao.some((c) => c.includes("quyen-gop.example.com"))).toBe(true);
  });

  test("bản ngôn ngữ phụ mất số liệu/tiền tệ/CTA → cảnh báo; giữ đủ → sạch", () => {
    const ctx = ctxGayQuy("en");
    const kqThieu = kiemTraDauRa(ctx, {
      noi_dung: JSON.stringify({
        tieu_de: "Report",
        tac_dong_da_dat: ["Well Village A — 500 people. [TD:td-a]"],
        tac_dong_uoc_tinh: [],
        muc_tieu: "",
        noi_dung: "Body without numbers.",
        trich_dan: [],
        cta: "Donate",
        lien_ket: "https://quyen-gop.example.com/lang-b",
      }),
      trich_dan: [],
      canh_bao: [],
    });
    const cbThieu = kqThieu.canh_bao.join("\n");
    expect(cbThieu).toContain("Bản en mất định lượng/CTA");
    expect(cbThieu).toContain("VND");

    const kqDu = kiemTraDauRa(ctx, {
      noi_dung: JSON.stringify({
        tieu_de: "Report",
        tac_dong_da_dat: ["Well Village A — 500 people. [TD:td-a]"],
        tac_dong_uoc_tinh: ["Estimated: Người hưởng lợi Làng B — 300 people. [TD:td-b]"],
        muc_tieu: "Goal: 500,000,000 VND",
        noi_dung: "Body.",
        trich_dan: [],
        cta: "Donate: https://quyen-gop.example.com/lang-b",
        lien_ket: "https://quyen-gop.example.com/lang-b",
      }),
      trich_dan: [],
      canh_bao: [],
    });
    const cbDu = kqDu.canh_bao.join("\n");
    expect(cbDu).not.toContain("Bản en mất");
  });
});

describe("chọn đầu ra → sinh → nội dung gây quỹ", () => {
  test("nháp báo cáo tác động: marker TD/TQ, ước tính có nhãn, CTA trỏ đích quyên góp", async () => {
    // Campaign riêng để không đụng đầu ra seed (sinh lại đầu ra đã
    // duyệt đánh dấu 'thay_the').
    const nguonId = await taoNguonHienTruong();
    const id = await taoGayQuy(nguonId);
    const j = await getJ(`/api/campaign/${id}`);
    const mucBaoCao = j.du_lieu.de_xuat_muc_luc.find(
      (m: { id: string }) => m.id === "gq-bao-cao",
    );
    const r0 = await put(`/api/campaign/${id}`, {
      ten: "Gây quỹ test",
      muc_luc: [mucBaoCao],
    });
    expect(r0.status).toBe(200);
    const r = await post(`/api/campaign/${id}/chon`, {
      ds_muc_id: ["gq-bao-cao"],
    });
    expect(r.status).toBe(200);
    const bthInfo = (await r.json()).du_lieu.ds_bth[0];
    const bth = await choSinh(bthInfo.id);
    const nd = JSON.parse(bth.head_revision!.noi_dung as string);
    expect((nd.tac_dong_da_dat as string[]).join("\n")).toContain("[TD:td-lang-a]");
    const uocTinh = (nd.tac_dong_uoc_tinh as string[]).join("\n");
    expect(uocTinh).toContain("ước");
    expect(nd.lien_ket).toBe("https://quyen-gop.example.com/lang-b");
  });

  test("mục lục có bản ngôn ngữ phụ khi chọn ngon_ngu_phu", async () => {
    const j = await getJ("/api/campaign/seed-cp-gay-quy-khe-tre");
    const mucEn = j.du_lieu.muc_luc.find((m: { id: string }) => m.id === "gq-ngon-ngu-2");
    expect(mucEn?.ngon_ngu).toBe("en");
  });
});

describe("demo seed: chiến dịch gây quỹ Làng Khe Tre lưu bền", () => {
  test("campaign + 7 mục lục + đầu ra các trạng thái, báo cáo phục vụ /p/", async () => {
    const j = await getJ("/api/campaign/seed-cp-gay-quy-khe-tre");
    const cp = j.du_lieu;
    expect(cp.loai).toBe("gay_quy");
    expect(cp.so_tien_muc_tieu).toBe(1200000000);
    expect(cp.tien_te).toBe("VND");
    expect(cp.muc_luc.length).toBe(7);
    expect(cp.gay_quy.ds_tac_dong_view.length).toBe(5);
    expect(cp.gay_quy.ds_trich_dan_view.length).toBe(3);
    expect(cp.gay_quy.ghi_chu_quyen_view.length).toBe(1);

    const baoCao = (await (await get("/api/ban-the-hien/seed-bth-gq-bao-cao")).json())
      .du_lieu;
    expect(baoCao.trang_thai).toBe("da_duyet");
    const page = await get("/p/seed-bth-gq-bao-cao");
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("Báo cáo tác động");

    const cauChuyen = (
      await (await get("/api/ban-the-hien/seed-bth-gq-cau-chuyen")).json()
    ).du_lieu;
    expect(cauChuyen.trang_thai).toBe("cho_duyet");
    // Ghi chú quyền của asset đính kèm hiển thị khi review.
    expect(Array.isArray(cauChuyen.ghi_chu_quyen)).toBe(true);
    expect(cauChuyen.ghi_chu_quyen.length).toBe(1);
    expect(cauChuyen.ghi_chu_quyen[0].ghi_chu).toContain("đồng ý");

    const en = (await (await get("/api/ban-the-hien/seed-bth-gq-en")).json()).du_lieu;
    expect(en.ngon_ngu).toBe("en");
    expect(en.trang_thai).toBe("da_duyet");
    const ig = (await (await get("/api/ban-the-hien/seed-bth-gq-ig")).json()).du_lieu;
    expect(ig.trang_thai).toBe("nhap");
  });

  test("ghi_chu_quyen không hiển thị cho bth không đính asset", async () => {
    const j = await getJ("/api/ban-the-hien/seed-bth-gq-bao-cao");
    expect(j.du_lieu.ghi_chu_quyen).toEqual([]);
  });

  test("gợi ý khoảng trống: tác động chưa xác nhận + trích dẫn chưa nguồn", async () => {
    const j = await getJ("/api/campaign/seed-cp-gay-quy-khe-tre");
    const goiY = j.du_lieu.goi_y as { loai: string }[];
    expect(goiY.some((g) => g.loai === "tac_dong_chua_xac_nhan")).toBe(true);
    expect(goiY.some((g) => g.loai === "trich_dan_chua_nguon")).toBe(true);
  });

  test("sửa số tiền mục tiêu trên demo → task sửa cho đầu ra phụ thuộc", async () => {
    const r = await put("/api/campaign/seed-cp-gay-quy-khe-tre", {
      ten: "Nước sạch cho Làng Khe Tre",
      so_tien_muc_tieu: 1300000000,
    });
    expect(r.status).toBe(200);
    const kq = (await r.json()).du_lieu;
    expect(kq.phat_hien?.thay_doi).toBeTruthy();
    const dsTask = kq.phat_hien.ds_task as { ban_the_hien_id: string; loai: string }[];
    const taskXuat = dsTask.find((t) => t.ban_the_hien_id === "seed-bth-gq-bao-cao");
    const taskNhap = dsTask.find((t) => t.ban_the_hien_id === "seed-bth-gq-cau-chuyen");
    expect(taskXuat).toBeTruthy();
    expect(taskXuat!.loai).toBe("thu_cong");
    expect(taskNhap).toBeTruthy();
    // Trả lại giá trị cũ để các assert khác không lệ thuộc thứ tự test.
    await put("/api/campaign/seed-cp-gay-quy-khe-tre", {
      ten: "Nước sạch cho Làng Khe Tre",
      so_tien_muc_tieu: 1200000000,
    });
  });
});

beforeAll(async () => {
  app = await taoServerTam();
  seed(app.db, "demo", { dataDir: app.dataDir });
});
afterAll(async () => {
  await app.dong();
});
