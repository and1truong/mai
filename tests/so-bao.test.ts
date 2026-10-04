import { describe, expect, test } from "bun:test";
import { lapContextNoiDung, TASK } from "../src/modules/generation/index.ts";
import { seed } from "../src/server/seed.ts";
import { taoServerTam } from "./helpers.ts";

// Test module số báo (#8): field campaign số báo, validation tham
// chiếu/mục lục, chọn mục → sinh, gợi ý khoảng trống tách khỏi nội dung,
// liên kết nguồn chữa cờ thiếu văn bản, tiến độ cấp số, export ZIP,
// lập trường biên tập đi vào context sinh.

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

async function taoSoBao(phanBoSung: Record<string, unknown> = {}): Promise<string> {
  const r = await post("/api/campaign", {
    ten: "Số test",
    so_thu_tu: 9,
    ngay_phat_hanh: "2026-12-01",
    chu_de: "Chủ đề test",
    lap_truong: "Lập trường test",
    chu_bien: "Bt. Test",
    doi_tuong_id: "seed-dt-doc-gia-phuc-am",
    thuong_hieu_id: "seed-th-nxb-phuc-am",
    ...phanBoSung,
  });
  expect(r.status).toBe(201);
  return (await r.json()).du_lieu.id as string;
}

describe("campaign số báo: field + validation", () => {
  test("tạo campaign đầy đủ field số báo + GET trả view phái sinh", async () => {
    const id = await taoSoBao();
    const j = await getJ(`/api/campaign/${id}`);
    const cp = j.du_lieu;
    expect(cp.so_thu_tu).toBe(9);
    expect(cp.ngay_phat_hanh).toBe("2026-12-01");
    expect(cp.chu_de).toBe("Chủ đề test");
    expect(cp.lap_truong).toBe("Lập trường test");
    expect(cp.chu_bien).toBe("Bt. Test");
    expect(cp.doi_tuong_id).toBe("seed-dt-doc-gia-phuc-am");
    // View phái sinh có đủ phần cho trang số báo.
    expect(Array.isArray(cp.tham_chieu_view)).toBe(true);
    expect(Array.isArray(cp.de_xuat_muc_luc)).toBe(true);
    expect(cp.de_xuat_muc_luc.length).toBe(8); // 8 khay mẫu theo story
    expect(Array.isArray(cp.goi_y)).toBe(true);
    expect(cp.tien_do.tong_muc).toBe(0);
    expect(Array.isArray(cp.hang_cho)).toBe(true);
  });

  test("validation: so_thu_tu/ngày/tham chiếu/mục lục sai → một 400 gom lỗi", async () => {
    const r = await post("/api/campaign", {
      ten: "Số lỗi",
      so_thu_tu: "abc",
      ngay_phat_hanh: "15/11/2026",
      doi_tuong_id: "khong-ton-tai",
      tham_chieu: [{ tham_chieu: "", ban_dich: "" }, { tham_chieu: "X 1:1", nguon_id: "ao" }],
      muc_luc: [{ tieu_de: "M", dinh_dang: "dinh-dang-ao" }],
    });
    expect(r.status).toBe(400);
    const j = await r.json();
    expect(j.loi.ma).toBe("VALIDATION");
    const dsLoi = j.loi.chi_tiet as string[];
    expect(dsLoi.some((l) => l.includes("so_thu_tu"))).toBe(true);
    expect(dsLoi.some((l) => l.includes("ngay_phat_hanh"))).toBe(true);
    expect(dsLoi.some((l) => l.includes("doi_tuong_id"))).toBe(true);
    expect(dsLoi.some((l) => l.includes("tham_chieu"))).toBe(true);
    expect(dsLoi.some((l) => l.includes("dinh_dang"))).toBe(true);
  });

  test("PUT giữ field đã lưu khi request chỉ mang một phần", async () => {
    const id = await taoSoBao({ lap_truong: "Lập trường cũ" });
    const r = await put(`/api/campaign/${id}`, { ten: "Số test đổi tên", lap_truong: "Lập trường mới" });
    expect(r.status).toBe(200);
    const j = await getJ(`/api/campaign/${id}`);
    expect(j.du_lieu.ten).toBe("Số test đổi tên");
    expect(j.du_lieu.lap_truong).toBe("Lập trường mới");
    expect(j.du_lieu.so_thu_tu).toBe(9); // không gửi → giữ
    expect(j.du_lieu.chu_bien).toBe("Bt. Test");
  });
});

describe("mục lục + chọn mục để nháp", () => {
  test("PUT muc-luc + POST them + trùng khay → 409", async () => {
    const id = await taoSoBao();
    const muc = {
      id: "m1",
      tieu_de: "Bài chính",
      dinh_dang: "bai-viet",
      doi_tuong_id: "seed-dt-doc-gia-phuc-am",
      dich_den: "",
      ly_do: "",
    };
    const r1 = await put(`/api/campaign/${id}/muc-luc`, { muc_luc: [muc] });
    expect(r1.status).toBe(200);
    // Thêm mục mới khác khay → ok.
    const r2 = await post(`/api/campaign/${id}/muc-luc/them`, {
      muc: { ...muc, id: "m2", dich_den: "website" },
    });
    expect(r2.status).toBe(200);
    // Thêm mục trùng khay đầu ra → 409.
    const r3 = await post(`/api/campaign/${id}/muc-luc/them`, {
      muc: { ...muc, id: "m3" },
    });
    expect(r3.status).toBe(409);
    // PUT muc-luc có 2 mục cùng khay → 400.
    const r4 = await put(`/api/campaign/${id}/muc-luc`, {
      muc_luc: [muc, { ...muc, id: "m4" }],
    });
    expect(r4.status).toBe(400);
  });

  test("POST chon: chỉ mục được chọn tạo đầu ra + job ghim head; id lạ → 400", async () => {
    const id = await taoSoBao({
      tham_chieu: [
        {
          id: "t1",
          tham_chieu: "Khải Huyền 7:9-17",
          ban_dich: "Bản dịch truyền thống",
          nguon_id: "seed-nguon-kh7-002",
          ghi_chu: "",
        },
      ],
      muc_luc: [
        {
          id: "m1",
          tieu_de: "Bài chính",
          dinh_dang: "bai-viet",
          doi_tuong_id: "seed-dt-doc-gia-phuc-am",
          dich_den: "",
          ly_do: "",
        },
        {
          id: "m2",
          tieu_de: "Newsletter",
          dinh_dang: "newsletter",
          doi_tuong_id: null,
          dich_den: "",
          ly_do: "",
        },
      ],
    });
    // Id lạ → 400, không tạo gì.
    const rSai = await post(`/api/campaign/${id}/chon`, { ds_muc_id: ["khong-co"] });
    expect(rSai.status).toBe(400);
    // Chỉ chọn m1 — m2 không tự động sinh.
    const r = await post(`/api/campaign/${id}/chon`, { ds_muc_id: ["m1"] });
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.du_lieu.ds_bth.length).toBe(1);
    expect(j.du_lieu.ds_job.length).toBe(1);
    const bth = j.du_lieu.ds_bth[0];
    const job = j.du_lieu.ds_job[0];
    // Thông điệp chủ đề được tạo và gắn nguồn tham chiếu đã nạp.
    const td = j.du_lieu.thong_diep;
    expect(td.campaign_id).toBe(id);
    const links = app.db
      .query("SELECT nguon_id FROM thong_diep_nguon WHERE thong_diep_id = ?")
      .all(td.id) as { nguon_id: string }[];
    expect(links.map((x) => x.nguon_id)).toContain("seed-nguon-kh7-002");
    // Job ghim đúng convention: revision head + khoa_idem theo bản.
    expect(job.khoa_idem).toBe(`sinh_ban_the_hien:${bth.id}`);
    expect(job.revision_id).toBe(bth.head_revision_id);
    const payload = JSON.parse(job.payload);
    expect(payload.campaign_id).toBe(id);
    expect(payload.lap_truong).toBe("Lập trường test");
    // Đầu ra không được chọn (m2) không tồn tại.
    const dsBth = (await getJ(`/api/ban-the-hien?campaign_id=${id}`)).du_lieu;
    expect(dsBth.length).toBe(1);
    expect(dsBth[0].dinh_dang).toBe("bai-viet");
    // Tiến độ phản ánh đúng.
    const chiTiet = await getJ(`/api/campaign/${id}`);
    expect(chiTiet.du_lieu.tien_do.muc_co_dau_ra).toBe(1);
    expect(chiTiet.du_lieu.tien_do.tong_dau_ra).toBe(1);
  });
});

describe("gợi ý khoảng trống + liên kết nguồn tham chiếu", () => {
  test("thiếu văn bản → cờ + gợi ý; liên kết nguồn → hết cờ và link vào thông điệp", async () => {
    const id = await taoSoBao({
      tham_chieu: [
        {
          id: "t1",
          tham_chieu: "Khải Huyền 7:9-17",
          ban_dich: "Bản dịch truyền thống",
          nguon_id: "seed-nguon-kh7-002",
          ghi_chu: "",
        },
        {
          id: "t2",
          tham_chieu: "Khải Huyền 5:5-12",
          ban_dich: "Bản dịch truyền thống",
          nguon_id: null,
          ghi_chu: "chưa nạp văn bản",
        },
      ],
      muc_luc: [
        {
          id: "m1",
          tieu_de: "Bài chính",
          dinh_dang: "bai-viet",
          doi_tuong_id: null,
          dich_den: "",
          ly_do: "",
        },
      ],
    });
    // Chọn một mục → thông điệp chủ đề tồn tại → gợi ý đầu ra chạy được.
    await post(`/api/campaign/${id}/chon`, { ds_muc_id: ["m1"] });
    let j = await getJ(`/api/campaign/${id}`);
    const t2 = j.du_lieu.tham_chieu_view.find((t: { id: string }) => t.id === "t2");
    expect(t2.co_van_ban).toBe(false);
    // Gợi ý thiếu văn bản tách khỏi nội dung đã đặt/đã duyệt.
    const goiYTc = j.du_lieu.goi_y.find((g: { loai: string }) => g.loai === "thieu_van_ban_tham_chieu");
    expect(goiYTc).toBeTruthy();
    expect(goiYTc.tieu_de).toContain("Khải Huyền 5:5-12");
    expect(goiYTc.bang_chung.length).toBeGreaterThan(0);
    // Độc giả Phúc Âm + thiếu niên fixture + tham chiếu có văn bản → còn
    // gợi ý thiếu bài giải thích và thiếu bài học tài liệu nền.
    expect(j.du_lieu.goi_y.some((g: { loai: string }) => g.loai === "thieu_giai_thich")).toBe(true);
    expect(j.du_lieu.goi_y.some((g: { loai: string }) => g.loai === "thieu_hoc_tai_lieu")).toBe(true);

    // Liên kết nguồn cho t2 → hết cờ, nguồn link vào thông điệp chủ đề.
    const nguon = await post("/api/nguon", {
      tieu_de: "Khải Huyền 5:5-12 (test)",
      noi_dung: "Văn bản test Khải Huyền 5.",
      loai: "van_ban",
    });
    const nguonId = (await nguon.json()).du_lieu.id;
    const r = await post(`/api/campaign/${id}/tham-chieu/t2/nguon`, { nguon_id: nguonId });
    expect(r.status).toBe(200);
    j = await getJ(`/api/campaign/${id}`);
    expect(j.du_lieu.tham_chieu_view.find((t: { id: string }) => t.id === "t2").co_van_ban).toBe(true);
    expect(
      j.du_lieu.goi_y.some((g: { loai: string }) => g.loai === "thieu_van_ban_tham_chieu"),
    ).toBe(false);
    const links = app.db
      .query("SELECT nguon_id FROM thong_diep_nguon WHERE thong_diep_id = ?")
      .all(j.du_lieu.thong_diep_chu_de.id) as { nguon_id: string }[];
    expect(links.map((x) => x.nguon_id)).toContain(nguonId);
    // Ref lạ → 404.
    const rSai = await post(`/api/campaign/${id}/tham-chieu/ao/nguon`, { nguon_id: nguonId });
    expect(rSai.status).toBe(404);
  });
});

describe("lập trường biên tập + cờ thiếu văn bản trong context sinh", () => {
  test("lapContextNoiDung: campaign số báo → lap_truong + van_ban_tham_chieu", async () => {
    const id = await taoSoBao({
      lap_truong: "Diễn giải biểu tượng",
      tham_chieu: [
        {
          id: "t1",
          tham_chieu: "Khải Huyền 7:9-17",
          ban_dich: "Bản dịch truyền thống",
          nguon_id: "seed-nguon-kh7-002",
          ghi_chu: "",
        },
        {
          id: "t2",
          tham_chieu: "Khải Huyền 5:5-12",
          ban_dich: "",
          nguon_id: null,
          ghi_chu: "",
        },
      ],
    });
    // Chọn một mục → tạo thông điệp chủ đề + bản thể hiện.
    await put(`/api/campaign/${id}/muc-luc`, {
      muc_luc: [
        {
          id: "m1",
          tieu_de: "Bài chính",
          dinh_dang: "bai-viet",
          doi_tuong_id: null,
          dich_den: "",
          ly_do: "",
        },
      ],
    });
    const chon = await post(`/api/campaign/${id}/chon`, { ds_muc_id: ["m1"] });
    const bth = (await chon.json()).du_lieu.ds_bth[0];
    const ctx = lapContextNoiDung(app.db, {
      bth,
      task: TASK.nhap_ban_the_hien,
      context_sinh: null,
      doi_tuong: bth.doi_tuong || "chung",
      campaign_id: id,
    });
    expect(ctx.lap_truong).toBe("Diễn giải biểu tượng");
    // t2 không có nguồn → cờ thiếu văn bản tham chiếu.
    expect(ctx.thieu_chung_cu).toContain("van_ban_tham_chieu");
  });
});

describe("export gói số báo (ZIP)", () => {
  test("GET xuat → ZIP manifest + tham chiếu + chỉ đầu ra đã xuất", async () => {
    const cp = (await getJ("/api/campaign/seed-cp-so-002")).du_lieu;
    expect(cp.so_thu_tu).toBe(2);
    const res = await get("/api/campaign/seed-cp-so-002/xuat");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/zip");
    const buf = new Uint8Array(await res.arrayBuffer());
    // Parser tối thiểu cho ZIP STORE (giống dinh-dang.test.ts).
    const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    const dsTep = new Map<string, string>();
    let p = 0;
    const dec = new TextDecoder();
    while (p + 4 <= v.byteLength && v.getUint32(p, true) === 0x04034b50) {
      const tenLen = v.getUint16(p + 26, true);
      const extLen = v.getUint16(p + 28, true);
      const n = v.getUint32(p + 18, true);
      const ten = dec.decode(buf.subarray(p + 30, p + 30 + tenLen));
      const batDau = p + 30 + tenLen + extLen;
      dsTep.set(ten, dec.decode(buf.subarray(batDau, batDau + n)));
      p = batDau + n;
    }
    const manifest = JSON.parse(dsTep.get("manifest.json") ?? "{}");
    expect(manifest.so_bao.id).toBe("seed-cp-so-002");
    expect(manifest.so_bao.so_thu_tu).toBe(2);
    expect(manifest.so_bao.chu_de).toBe("Chiên Con và 144.000 người");
    expect(manifest.so_bao.lap_truong).toContain("biểu tượng");
    expect(manifest.so_bao.chu_bien).toBe("Bt. Ngọc Lan");
    // Tham chiếu kèm bản dịch + cờ thiếu văn bản.
    expect(manifest.tham_chieu.length).toBe(3);
    const tcKh5 = manifest.tham_chieu.find((t: { id: string }) => t.id === "tc-kh5");
    expect(tcKh5.co_van_ban).toBe(false);
    const tcKh7 = manifest.tham_chieu.find((t: { id: string }) => t.id === "tc-kh7");
    expect(tcKh7.co_van_ban).toBe(true);
    // Chỉ đầu ra đã xuất (bài chính) đi vào gói; bản chờ duyệt/nháp không.
    expect(manifest.dau_ra.length).toBe(1);
    expect(manifest.dau_ra[0].dinh_dang.id).toBe("bai-viet");
    expect(dsTep.get("dau-ra/01-bai-viet/noi-dung.md")).toContain("Chiên Con");
    expect(dsTep.get("tham-chieu.md")).toContain("THIẾU VĂN BẢN");
    expect(dsTep.get("tham-chieu.md")).toContain("Bản dịch truyền thống");
  });
});

describe("seed số báo demo 002", () => {
  test("số 002 đầy đủ + không tái dùng tiêu đề số 001", async () => {
    const cp = (await getJ("/api/campaign/seed-cp-so-002")).du_lieu;
    expect(cp.ten).toBe("Phúc Âm — Số 002");
    expect(cp.chu_de).toBe("Chiên Con và 144.000 người");
    const cp1 = (await getJ("/api/campaign/seed-cp-so-001")).du_lieu;
    // Chủ đề số 002 không tái dùng tên số 001 làm phụ đề.
    expect(cp.chu_de).not.toBe(cp1.ten);
    expect(cp.chu_de).not.toContain(cp1.ten);
    expect(cp.ten).not.toBe(cp1.ten);
    // Bài giải thích thiếu niên bị từ chối nhưng giữ diễn giải/bằng chứng đã duyệt.
    const bthTn = (await getJ("/api/ban-the-hien/seed-bth-so002-giai-thich-tn")).du_lieu;
    expect(bthTn.trang_thai).toBe("tu_choi");
    const nd = JSON.parse(bthTn.revisions[0].noi_dung);
    expect(nd.dien_giai).toContain("biểu tượng");
    expect(nd.bang_chung.length).toBe(3);
    expect(nd.vi_du.length).toBeGreaterThan(0); // đổi ví dụ cho thiếu niên
    // Hàng chờ review chứa bài học chờ duyệt.
    expect(cp.hang_cho.some((b: { id: string }) => b.id === "seed-bth-so002-hoc-kt")).toBe(true);
  });
});

import { beforeAll, afterAll } from "bun:test";
beforeAll(async () => {
  app = await taoServerTam();
  seed(app.db);
});
afterAll(async () => {
  await app.dong();
});
