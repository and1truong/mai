import { describe, expect, test } from "bun:test";
import { taoServerTam } from "./helpers.ts";
import { seed } from "../src/server/seed.ts";
import { capNhatThongDiep } from "../src/modules/content/index.ts";

// Test luồng POC (#5): intake → kế hoạch → làm rõ → chọn đầu ra → sinh →
// editor/review → home hiển thị state thật.
// - intake (bài viết/sự kiện/mục tiêu) tạo kế hoạch chọn được + lưu bền.
// - fact còn thiếu hiển thị là câu hỏi; sửa intake xong câu hỏi biến mất.
// - chọn đầu ra → bản thể hiện + job sinh (không trùng khi chọn lại).
// - sinh lại một bản thể hiện đề xuất revision mới, giữ nháp/sửa tay khác.
// - home: việc gần đây + nháp chờ review + bản thể hiện đã cũ.

type App = Awaited<ReturnType<typeof taoServerTam>>;

async function appCoSeed(): Promise<App> {
  const app = await taoServerTam();
  seed(app.db);
  return app;
}

function post(app: App, path: string, body: unknown, method = "POST") {
  return fetch(`${app.url}${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function getJson(app: App, path: string) {
  const r = await fetch(`${app.url}${path}`);
  return { status: r.status, json: await r.json() };
}

async function taoKh(app: App, vanBan: string, extra: Record<string, unknown> = {}) {
  const r = await post(app, "/api/ke-hoach", { van_ban: vanBan, ...extra });
  expect(r.status).toBe(200);
  return (await r.json()).du_lieu;
}

describe("ke_hoach: tạo và lưu bền intake", () => {
  test("intake bài viết/sự kiện/mục tiêu đều tạo kế hoạch", async () => {
    const app = await appCoSeed();
    const ds = await taoKh(app, "Ra mắt Mai v1: công cụ biên soạn nội dung có nguồn.");
    expect(ds.ke_hoach.id).toBeTruthy();
    expect(ds.ke_hoach.trang_thai).toBe("nhap");
    expect(ds.ke_hoach.thong_diep_id).toBeTruthy();
    expect(Array.isArray(ds.de_xuat)).toBe(true);
    expect(ds.de_xuat.length).toBeGreaterThan(0);
    app.dong();

    const app2 = await appCoSeed();
    const ev = await taoKh(app2, "Sự kiện workshop hướng dẫn viết bài có nguồn.");
    expect(ev.ke_hoach.id).toBeTruthy();
    const mt = await taoKh(app2, "Mục tiêu: tăng 20% độ phủ thương hiệu trong quý.");
    expect(mt.ke_hoach.id).toBeTruthy();
    app2.dong();
  });

  test("intake chưa xong lưu bền và tiếp tục sau", async () => {
    const app = await appCoSeed();
    const { ke_hoach } = await taoKh(app, "Nháp dở: ý tưởng bài giới thiệu.");

    const put = await post(app, `/api/ke-hoach/${ke_hoach.id}`, {
      van_ban: "Nháp dở đã bổ sung chi tiết về tính năng.",
    }, "PUT");
    expect(put.status).toBe(200);
    const khMoi = (await put.json()).du_lieu.ke_hoach;
    expect(khMoi.intake).toContain("bổ sung chi tiết");

    // Đọc lại (giả lập "quay lại sau") — intake vẫn còn, revision thông điệp mới.
    const { json } = await getJson(app, `/api/ke-hoach/${ke_hoach.id}`);
    expect(json.du_lieu.ke_hoach.intake).toContain("bổ sung chi tiết");
    expect(json.du_lieu.thong_diep.noi_dung).toContain("bổ sung chi tiết");

    const { json: ds } = await getJson(app, "/api/ke-hoach");
    expect(ds.du_lieu.some((k: { id: string }) => k.id === ke_hoach.id)).toBe(true);
    app.dong();
  });

  test("tạo thiếu van_ban → 400; id lạ → 404", async () => {
    const app = await appCoSeed();
    const r = await post(app, "/api/ke-hoach", {});
    expect(r.status).toBe(400);
    const { status } = await getJson(app, "/api/ke-hoach/khong-co");
    expect(status).toBe(404);
    app.dong();
  });
});

describe("làm rõ tối thiểu: fact thiếu là câu hỏi", () => {
  test("thiếu số liệu/ngày/giá → câu hỏi; bổ sung xong → hết câu hỏi", async () => {
    const app = await appCoSeed();
    const ds = await taoKh(app, "Ra mắt sản phẩm mới cho cửa hàng.");
    expect(ds.cau_hoi.length).toBe(3); // so_lieu + moc_thoi_gian + gia_ca
    expect(ds.cau_hoi.join(" ")).toContain("số liệu");
    expect(ds.cau_hoi.join(" ")).toContain("khi nào");
    expect(ds.cau_hoi.join(" ")).toContain("giá");

    const put = await post(app, `/api/ke-hoach/${ds.ke_hoach.id}`, {
      van_ban: "Ra mắt ngày 15/10/2025, giá 120.000đ, dự kiến 500 khách tham dự.",
    }, "PUT");
    const sau = (await put.json()).du_lieu;
    expect(sau.cau_hoi.length).toBe(0);
    app.dong();
  });
});

describe("chọn đầu ra → sinh", () => {
  test("chọn tạo bản thể hiện + job; cấu trúc khác nhau theo định dạng/đối tượng", async () => {
    const app = await appCoSeed();
    const ds = await taoKh(app, "Cập nhật chính sách bảo hành: kéo dài 24 tháng từ 2025.");
    const khId = ds.ke_hoach.id;
    const deXuat = ds.de_xuat as { doi_tuong_id: string | null; dinh_dang: string }[];
    expect(deXuat.length).toBeGreaterThan(0);

    const chon2 = deXuat.slice(0, 2);
    const r = await post(app, `/api/ke-hoach/${khId}/chon`, { ds_chon: chon2 });
    expect(r.status).toBe(200);
    const kq = (await r.json()).du_lieu;
    expect(kq.ds_bth.length).toBe(2);
    expect(kq.ds_job.length).toBe(2);
    expect(kq.ke_hoach.trang_thai).toBe("da_chon");

    // Đợi job chạy xong → mỗi bản thể hiện có revision 'job'.
    await Bun.sleep(400);
    for (const bth of kq.ds_bth) {
      const { json } = await getJson(app, `/api/ban-the-hien/${bth.id}`);
      expect(json.du_lieu.head_revision_id).toBeTruthy();
    }
    app.dong();
  });

  test("chọn lại cùng đầu ra → không tạo trùng bản thể hiện", async () => {
    const app = await appCoSeed();
    const ds = await taoKh(app, "Thông báo bảo trì hệ thống cuối tuần này ngày 05/10/2025.");
    const chon = [{ doi_tuong_id: null, dinh_dang: "newsletter" }];
    const r1 = await post(app, `/api/ke-hoach/${ds.ke_hoach.id}/chon`, { ds_chon: chon });
    const bth1 = (await r1.json()).du_lieu.ds_bth[0].id;
    const r2 = await post(app, `/api/ke-hoach/${ds.ke_hoach.id}/chon`, { ds_chon: chon });
    const bth2 = (await r2.json()).du_lieu.ds_bth[0].id;
    expect(bth2).toBe(bth1);

    const { json } = await getJson(app, `/api/ban-the-hien?thong_diep_id=${ds.ke_hoach.thong_diep_id}`);
    expect(json.du_lieu.length).toBe(1);
    app.dong();
  });

  test("dinh_dang rác / doi_tuong lạ → 400; ds_chon rỗng → 400", async () => {
    const app = await appCoSeed();
    const ds = await taoKh(app, "Thông báo.");
    const r1 = await post(app, `/api/ke-hoach/${ds.ke_hoach.id}/chon`, {
      ds_chon: [{ doi_tuong_id: null, dinh_dang: "rac" }],
    });
    expect(r1.status).toBe(400);
    const r2 = await post(app, `/api/ke-hoach/${ds.ke_hoach.id}/chon`, {
      ds_chon: [{ doi_tuong_id: "khong-co", dinh_dang: "caption" }],
    });
    expect(r2.status).toBe(400);
    const r3 = await post(app, `/api/ke-hoach/${ds.ke_hoach.id}/chon`, { ds_chon: [] });
    expect(r3.status).toBe(400);
    app.dong();
  });

  test("sinh lại đề xuất revision mới, nháp tay của actor giữ nguyên", async () => {
    const app = await appCoSeed();
    const ds = await taoKh(app, "Sản phẩm mới ra mắt ngày 01/11/2025 giá 200.000đ.");
    const r = await post(app, `/api/ke-hoach/${ds.ke_hoach.id}/chon`, {
      ds_chon: [{ doi_tuong_id: null, dinh_dang: "bai-viet" }],
    });
    const bth = (await r.json()).du_lieu.ds_bth[0];
    await Bun.sleep(400);

    const { json: tr1 } = await getJson(app, `/api/ban-the-hien/${bth.id}`);
    const head1 = tr1.du_lieu.head_revision_id;
    const soRev1 = tr1.du_lieu.revisions.length;
    expect(head1).toBeTruthy();

    // Người dùng soạn nháp tay + lưu một revision tay (ghi đè head).
    await post(app, `/api/ban-the-hien/${bth.id}/nhap`, { noi_dung: "## Sửa tay đang dở" }, "PUT");
    await post(app, `/api/ban-the-hien/${bth.id}/revision`, {
      noi_dung: "## Bài sửa tay",
      dua_tren_revision_id: head1,
    });

    // Sinh lại cùng đầu ra → job mới → revision 'job' mới trên head tay.
    const r2 = await post(app, `/api/ke-hoach/${ds.ke_hoach.id}/chon`, {
      ds_chon: [{ doi_tuong_id: null, dinh_dang: "bai-viet" }],
    });
    expect(r2.status).toBe(200);
    const job2 = (await r2.json()).du_lieu.ds_job[0];
    await Bun.sleep(400);

    const { json: jobJson } = await getJson(app, `/api/job/${job2.id}`);
    expect(jobJson.du_lieu.trang_thai).toBe("xong");

    const { json: tr2 } = await getJson(app, `/api/ban-the-hien/${bth.id}`);
    const head2 = tr2.du_lieu.head_revision_id;
    const dsRev = tr2.du_lieu.revisions as { id: string; noi_dung: string; tao_boi: string }[];
    // Job sinh được revision MỚI trên revision tay — không ghi đè sửa tay.
    expect(dsRev.length).toBe(soRev1 + 2);
    const revHead = dsRev.find((x) => x.id === head2);
    expect(revHead).toBeTruthy();
    expect(revHead!.tao_boi).toBe("job");
    expect(revHead!.noi_dung).not.toBe("## Bài sửa tay");

    // Nháp tay khác (nhap_soan của actor) không bị job đụng: PUT lại nháp mới
    // rồi GET — nội dung soạn dở vẫn còn nguyên.
    await post(app, `/api/ban-the-hien/${bth.id}/nhap`, { noi_dung: "## Nháp tiếp theo" }, "PUT");
    const { json: nhap } = await getJson(app, `/api/ban-the-hien/${bth.id}/nhap`);
    expect(nhap.du_lieu.noi_dung).toBe("## Nháp tiếp theo");
    app.dong();
  });
});

describe("home: state thật", () => {
  test("tong-quan trả việc gần đây + chờ duyệt + bản cũ", async () => {
    const app = await appCoSeed();
    const ds = await taoKh(app, "Kế hoạch nội dung tuần này.");
    await post(app, `/api/ke-hoach/${ds.ke_hoach.id}/chon`, {
      ds_chon: [{ doi_tuong_id: null, dinh_dang: "bai-viet" }],
    });
    await Bun.sleep(400);

    const { json } = await getJson(app, "/api/tong-quan");
    const d = json.du_lieu;
    expect(d.viec_gan_day.ke_hoach.length).toBeGreaterThan(0);
    expect(d.viec_gan_day.ke_hoach[0].id).toBe(ds.ke_hoach.id);
    expect(d.viec_gan_day.ban_the_hien.length).toBeGreaterThan(0);
    expect(Array.isArray(d.bth_cho_duyet)).toBe(true);
    expect(Array.isArray(d.bth_cu)).toBe(true);
    app.dong();
  });

  test("bản thể hiện đã cũ: revision ghim lệch head thông điệp", async () => {
    const app = await appCoSeed();
    const ds = await taoKh(app, "Nội dung lần đầu, ngày 10/10/2025.");
    await post(app, `/api/ke-hoach/${ds.ke_hoach.id}/chon`, {
      ds_chon: [{ doi_tuong_id: null, dinh_dang: "bai-viet" }],
    });
    await Bun.sleep(400);

    // Chưa cũ: head revision ghim đúng head thông điệp.
    const { json: tq1 } = await getJson(app, "/api/tong-quan");
    expect(tq1.du_lieu.bth_cu.length).toBe(0);

    // Thông điệp đổi (sửa intake) → bản đã sinh thành cũ.
    const td = ds.ke_hoach.thong_diep_id;
    const { json: tdJson } = await getJson(app, `/api/thong-diep/${td}`);
    capNhatThongDiep(
      app.db,
      td,
      { tieu_de: tdJson.du_lieu.tieu_de, noi_dung: "Nội dung mới hoàn toàn, ngày 11/10/2025." },
      tdJson.du_lieu.head_revision_id,
      "demo",
    );

    const { json: tq2 } = await getJson(app, "/api/tong-quan");
    expect(tq2.du_lieu.bth_cu.length).toBe(1);
    app.dong();
  });
});
