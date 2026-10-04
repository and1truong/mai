import { describe, expect, test } from "bun:test";
import { taoServerTam, duyetBth } from "./helpers.ts";
import { capNhatThongDiep, themRevision } from "../src/modules/content/index.ts";
import { luuContextSinh } from "../src/modules/context/index.ts";

// Test phát hiện thay đổi nguồn + task sửa đầu ra (#14):
// - đổi một fact trong nguồn → mọi bản thể hiện phụ thuộc (ghim qua
//   thong_diep_revision.nguon_revision_ids) có task chinh_xac, lý do nêu mục.
// - bản đã xuất bản → task thu_cong; trang local tiếp tục phục vụ revision
//   đã ghim, lịch sử không đổi.
// - biến thể không liên quan (td ghim nguồn khác) giữ nguyên — không task.
// - đổi hồ sơ thương hiệu/đối tượng → bản có context_sinh ghim revision cũ
//   bị đánh dấu; phụ thuộc không chắc chỉ gắn cờ khong_chac.
// - xử lý lại cùng revision không tạo detection/task trùng (idempotent).
// - đề xuất sửa enqueue job sinh lại; text người viết giữ trong lịch sử;
//   task tự đóng khi head ghim revision nguồn mới.

type App = Awaited<ReturnType<typeof taoServerTam>>;

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

const MUC_NGUON = [
  { id: "ngay_ra_mat", loai: "fact", tieu_de: "Ngày ra mắt", noi_dung: "10/01/2026" },
  { id: "gia", loai: "fact", tieu_de: "Giá", noi_dung: "25000" },
];

async function taoNguonFact(app: App, noiDungGia = "25000") {
  const r = await post(app, "/api/nguon", {
    tieu_de: "Ra mắt sản phẩm X",
    noi_dung: `Ngày ra mắt: 10/01/2026. Giá: ${noiDungGia}.`,
    loai: "fact",
    cac_muc: MUC_NGUON.map((m) => (m.id === "gia" ? { ...m, noi_dung: noiDungGia } : m)),
  });
  expect(r.status).toBe(201);
  return (await r.json()).du_lieu;
}

// Một thông điệp ghim nguồn + một bản thể hiện có revision đầu (ghim tự
// động revision thông điệp head → lập chuỗi provenance chính xác).
async function taoDauRa(app: App, nguonId: string, dinhDang: string, doiTuong = "chung") {
  const rTd = await post(app, "/api/thong-diep", {
    tieu_de: `TD ${dinhDang}`,
    noi_dung: "Nội dung thông điệp.",
    nguon_ids: [nguonId],
  });
  const td = (await rTd.json()).du_lieu;
  const rB = await post(app, "/api/ban-the-hien", {
    thong_diep_id: td.id,
    dinh_dang: dinhDang,
    ngon_ngu: "vi",
    doi_tuong: doiTuong,
  });
  const bth = (await rB.json()).du_lieu;
  const rRev = await post(app, `/api/ban-the-hien/${bth.id}/revision`, {
    noi_dung: JSON.stringify({ tieu_de: `Bản ${dinhDang}`, noi_dung: "text người viết tay" }),
    dua_tren_revision_id: null,
  });
  expect(rRev.status).toBe(201);
  return { td, bth };
}

async function doiGiaNguon(app: App, nguon: { id: string; head_revision_id: string }) {
  const r = await post(
    app,
    `/api/nguon/${nguon.id}`,
    {
      tieu_de: "Ra mắt sản phẩm X",
      noi_dung: "Ngày ra mắt: 10/01/2026. Giá: 30000.",
      loai: "fact",
      cac_muc: MUC_NGUON.map((m) => (m.id === "gia" ? { ...m, noi_dung: "30000" } : m)),
      dua_tren_revision_id: nguon.head_revision_id,
    },
    "PUT",
  );
  expect(r.status).toBe(200);
  return (await r.json()).du_lieu;
}

async function choJob(app: App, jobId: string, lanThu = 200) {
  for (let i = 0; i < lanThu; i++) {
    const { json } = await getJson(app, `/api/job/${jobId}`);
    if (["xong", "loi", "huy"].includes(json.du_lieu.trang_thai)) return json.du_lieu;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`job ${jobId} không xong`);
}

describe("phát hiện thay đổi nguồn", () => {
  test("đổi fact → mọi bản phụ thuộc có task chinh_xac; biến thể không liên quan giữ nguyên", async () => {
    const app = await taoServerTam();
    try {
      const nguon1 = await taoNguonFact(app);
      const { bth: bA } = await taoDauRa(app, nguon1.id, "bai-viet");
      const { bth: bB } = await taoDauRa(app, nguon1.id, "caption");
      // Biến thể trên thông điệp ghim nguồn khác — không phụ thuộc nguồn 1.
      const r2 = await post(app, "/api/nguon", {
        tieu_de: "Nguồn khác",
        noi_dung: "Nội dung khác.",
        loai: "van_ban",
      });
      const { bth: bC } = await taoDauRa(app, (await r2.json()).du_lieu.id, "bai-viet");

      const put = await doiGiaNguon(app, nguon1);
      const ph = put.phat_hien;
      expect(ph).not.toBeNull();
      expect(ph.thay_doi).not.toBeNull();
      expect(ph.thay_doi.loai).toBe("nguon");

      // Diff chính xác tới mục: fact gốc vs fact đã đổi.
      const mucGia = ph.thay_doi.ds_thay_doi.find(
        (m: { muc_id: string | null }) => m.muc_id === "gia",
      );
      expect(mucGia.loai_thay_doi).toBe("sua");
      expect(mucGia.cu).toBe("25000");
      expect(mucGia.moi).toBe("30000");

      // Mọi đầu ra dùng fact đó xuất hiện trong danh sách ảnh hưởng.
      const dsTask = ph.ds_task;
      expect(dsTask.map((t: { ban_the_hien_id: string }) => t.ban_the_hien_id).sort()).toEqual(
        [bA.id, bB.id].sort(),
      );
      for (const t of dsTask) {
        expect(t.do_tin).toBe("chinh_xac");
        expect(t.loai).toBe("sinh_lai");
        expect(t.trang_thai).toBe("mo");
        // Lý do nêu đúng mục đổi.
        expect(t.ly_do).toContain("Giá");
        expect(t.ds_muc[0].muc_id).toBe("gia");
      }

      // Bản không liên quan không có task nào — bằng chứng ghim ủng hộ để
      // nguyên.
      const taskC = await getJson(app, `/api/task-sua?ban_the_hien_id=${bC.id}&trang_thai=tat_ca`);
      expect(taskC.json.du_lieu).toHaveLength(0);

      // Sự kiện detection ghi trong SQLite (bảng su_kien, entity
      // thay_doi_nguon).
      const { json: sk } = await getJson(
        app,
        `/api/su-kien?entity_loai=thay_doi_nguon&entity_id=${ph.thay_doi.id}`,
      );
      expect(sk.du_lieu.some((s: { su_kien: string }) => s.su_kien === "phat_hien")).toBe(
        true,
      );
    } finally {
      await app.dong();
    }
  });

  test("bản đã xuất bản → task thu_cong; trang local giữ revision đã ghim", async () => {
    const app = await taoServerTam();
    try {
      const nguon = await taoNguonFact(app);
      const { bth } = await taoDauRa(app, nguon.id, "bai-viet");
      await duyetBth(app, bth.id);
      const xb = await post(app, `/api/ban-the-hien/${bth.id}/xuat-ban`, {});
      expect(xb.status).toBe(201);

      const trangTruoc = await (await fetch(`${app.url}/p/${bth.id}`)).text();

      const put = await doiGiaNguon(app, nguon);
      const task = put.phat_hien.ds_task[0];
      expect(task.loai).toBe("thu_cong");
      expect(task.ly_do).toContain("xuất bản");

      // Trang /p tiếp tục phục vụ revision đã xuất — phát hiện không tự đổi
      // nội dung đang phục vụ; lịch sử ghim giữ nguyên.
      const trangSau = await (await fetch(`${app.url}/p/${bth.id}`)).text();
      expect(trangSau).toBe(trangTruoc);

      // Task thủ công không tự đóng — file/copy bên ngoài sửa bằng tay.
      const { json: jt } = await getJson(app, `/api/task-sua/${task.id}`);
      expect(jt.du_lieu.trang_thai).toBe("mo");
      expect(jt.du_lieu.ban_the_hien.so_xuat_ban).toBe(1);
    } finally {
      await app.dong();
    }
  });

  test("xử lý cùng revision hai lần không tạo detection/task trùng", async () => {
    const app = await taoServerTam();
    try {
      const nguon = await taoNguonFact(app);
      await taoDauRa(app, nguon.id, "bai-viet");
      const put = await doiGiaNguon(app, nguon);
      const idTruoc = put.phat_hien.thay_doi.id;

      // Gọi lại phát hiện bằng tay → trả detection cũ, không task mới.
      const r1 = await post(app, "/api/phat-hien", { loai: "nguon", entity_id: nguon.id });
      const d1 = (await r1.json()).du_lieu;
      expect(d1.thay_doi.id).toBe(idTruoc);
      expect(d1.ds_task).toHaveLength(1);

      const { json: lietKe } = await getJson(app, "/api/task-sua?trang_thai=tat_ca");
      expect(lietKe.du_lieu).toHaveLength(1);

      // PUT nội dung y hệt → revision mới không khác gì → không detection.
      const head = (await getJson(app, `/api/nguon/${nguon.id}`)).json.du_lieu.head_revision_id;
      const r2 = await post(
        app,
        `/api/nguon/${nguon.id}`,
        {
          tieu_de: "Ra mắt sản phẩm X",
          noi_dung: "Ngày ra mắt: 10/01/2026. Giá: 30000.",
          loai: "fact",
          cac_muc: MUC_NGUON.map((m) => (m.id === "gia" ? { ...m, noi_dung: "30000" } : m)),
          dua_tren_revision_id: head,
        },
        "PUT",
      );
      const put2 = (await r2.json()).du_lieu;
      expect(put2.phat_hien.thay_doi).toBeNull();
      const { json: ds } = await getJson(app, `/api/thay-doi?entity_id=${nguon.id}`);
      expect(ds.du_lieu).toHaveLength(1);
    } finally {
      await app.dong();
    }
  });

  test("đổi hồ sơ thương hiệu → bản ghim context cũ bị đánh dấu chinh_xac", async () => {
    const app = await taoServerTam();
    try {
      const rTh = await post(app, "/api/ho-so-thuong-hieu", {
        ten: "TH Test",
        vi_du_giong_van: "Ấm áp",
      });
      const th = (await rTh.json()).du_lieu;

      const nguon = await taoNguonFact(app);
      const { bth } = await taoDauRa(app, nguon.id, "bai-viet");
      // Revision mới ghim context sinh trỏ revision 1 của hồ sơ.
      const ctx = luuContextSinh(app.db, { thuong_hieu_id: th.id });
      const { json: chiTiet } = await getJson(app, `/api/ban-the-hien/${bth.id}`);
      themRevision(
        app.db,
        {
          ban_the_hien_id: bth.id,
          noi_dung: JSON.stringify({ tieu_de: "x", noi_dung: "bản có context" }),
          dua_tren_revision_id: chiTiet.du_lieu.head_revision_id,
          context_sinh_id: ctx.id,
        },
        "job",
      );

      const rPut = await post(
        app,
        `/api/ho-so-thuong-hieu/${th.id}`,
        { ten: "TH Test", vi_du_giong_van: "Trang trọng" },
        "PUT",
      );
      const ph = (await rPut.json()).du_lieu.phat_hien;
      expect(ph).not.toBeNull();
      expect(ph.thay_doi.loai).toBe("thuong_hieu");
      expect(ph.thay_doi.ds_thay_doi.length).toBeGreaterThan(0);
      const task = ph.ds_task.find(
        (t: { ban_the_hien_id: string }) => t.ban_the_hien_id === bth.id,
      );
      expect(task).not.toBeUndefined();
      expect(task.do_tin).toBe("chinh_xac");
    } finally {
      await app.dong();
    }
  });

  test("đổi hồ sơ đối tượng → bản cùng tên không context chỉ gắn cờ khong_chac", async () => {
    const app = await taoServerTam();
    try {
      const rDt = await post(app, "/api/ho-so-doi-tuong", { ten: "Độc giả trẻ" });
      const dt = (await rDt.json()).du_lieu;

      const nguon = await taoNguonFact(app);
      // Bản nhắm đúng tên đối tượng nhưng revision không ghim context_sinh.
      const { bth } = await taoDauRa(app, nguon.id, "caption", "Độc giả trẻ");

      const rPut = await post(
        app,
        `/api/ho-so-doi-tuong/${dt.id}`,
        { ten: "Độc giả trẻ", moi_quan_tam: "Giảm giá" },
        "PUT",
      );
      const ph = (await rPut.json()).du_lieu.phat_hien;
      expect(ph).not.toBeNull();
      const task = ph.ds_task.find(
        (t: { ban_the_hien_id: string }) => t.ban_the_hien_id === bth.id,
      );
      expect(task).not.toBeUndefined();
      expect(task.do_tin).toBe("khong_chac");
      expect(task.ly_do).toContain("không chứng minh được");
    } finally {
      await app.dong();
    }
  });

  test("đề xuất sửa: enqueue sinh lại giữ lịch sử tay; task tự đóng; bỏ qua → 409", async () => {
    const app = await taoServerTam();
    try {
      const nguon = await taoNguonFact(app);
      const { bth } = await taoDauRa(app, nguon.id, "bai-viet");
      const { json: truoc } = await getJson(app, `/api/ban-the-hien/${bth.id}`);
      const revNguoi = truoc.du_lieu.revisions[0];

      const put = await doiGiaNguon(app, nguon);
      const task = put.phat_hien.ds_task[0];

      // Đề xuất → task dang_lam + job sinh_ban_the_hien ghim revision cũ.
      const dx = await post(app, `/api/task-sua/${task.id}/de-xuat`, {});
      expect(dx.status).toBe(200);
      const d = (await dx.json()).du_lieu;
      expect(d.task.trang_thai).toBe("dang_lam");
      const job = await choJob(app, d.job.id);
      expect(job.trang_thai).toBe("xong");

      // Revision đề xuất của job lên head — revision tay giữ nguyên trong
      // lịch sử, không bị ghi đè.
      const { json: sau } = await getJson(app, `/api/ban-the-hien/${bth.id}`);
      expect(sau.du_lieu.revisions).toHaveLength(2);
      expect(sau.du_lieu.revisions[0].id).toBe(revNguoi.id);
      expect(sau.du_lieu.revisions[1].tao_boi).toBe("job");

      // Head mới ghim revision nguồn đã đổi → task tự đóng 'xong'.
      const { json: jt } = await getJson(app, `/api/task-sua/${task.id}`);
      expect(jt.du_lieu.trang_thai).toBe("xong");

      // Đề xuất lại task đã xong → 409.
      const dx2 = await post(app, `/api/task-sua/${task.id}/de-xuat`, {});
      expect(dx2.status).toBe(409);
      expect((await dx2.json()).loi.ma).toBe("XUNG_DOT_TRANG_THAI");
    } finally {
      await app.dong();
    }
  });

  test("chuyển trạng thái task bằng tay: bỏ qua → đề xuất bị chặn", async () => {
    const app = await taoServerTam();
    try {
      const nguon = await taoNguonFact(app);
      await taoDauRa(app, nguon.id, "bai-viet");
      const put = await doiGiaNguon(app, nguon);
      const task = put.phat_hien.ds_task[0];

      const tt = await post(app, `/api/task-sua/${task.id}/trang-thai`, {
        trang_thai: "bo_qua",
      });
      expect(tt.status).toBe(200);
      expect((await tt.json()).du_lieu.trang_thai).toBe("bo_qua");

      const dx = await post(app, `/api/task-sua/${task.id}/de-xuat`, {});
      expect(dx.status).toBe(409);

      const tt2 = await post(app, `/api/task-sua/${task.id}/trang-thai`, {
        trang_thai: "khong_dung",
      });
      expect(tt2.status).toBe(400);
    } finally {
      await app.dong();
    }
  });

  test("PUT thuật ngữ y hệt → không detection giả (khóa thời gian loại khỏi diff)", async () => {
    const app = await taoServerTam();
    try {
      const rTh = await post(app, "/api/ho-so-thuong-hieu", {
        ten: "TH Thuat Ngu",
        vi_du_giong_van: "Ấm áp",
      });
      const th = (await rTh.json()).du_lieu;

      const terms = {
        thuat_ngu: [{ thuat_ngu: "MAI", giu_nguyen: true, ban_dich: { en: "MAI" } }],
      };
      // Lần đầu: thuat_ngu đổi thật (rỗng → có mục) → detection hợp lệ.
      const r1 = await post(app, `/api/ho-so-thuong-hieu/${th.id}/thuat-ngu`, terms, "PUT");
      expect(r1.status).toBe(200);
      // Lần hai y hệt: thayThuatNgu xóa+chèn lại với id/timestamp mới — diff
      // phải bỏ khóa volatile → không detection thứ hai.
      const r2 = await post(app, `/api/ho-so-thuong-hieu/${th.id}/thuat-ngu`, terms, "PUT");
      expect(r2.status).toBe(200);
      const { json: ds } = await getJson(app, `/api/thay-doi?entity_id=${th.id}`);
      expect(ds.du_lieu).toHaveLength(1);
    } finally {
      await app.dong();
    }
  });

  test("đề xuất task khong_chac đối tượng: job hút đúng hồ sơ, task tự đóng", async () => {
    const app = await taoServerTam();
    try {
      const rDt = await post(app, "/api/ho-so-doi-tuong", { ten: "Độc giả trẻ" });
      const dt = (await rDt.json()).du_lieu;
      const nguon = await taoNguonFact(app);
      // Revision head không có context_sinh → task khong_chac; đề xuất sửa
      // phải fallback hồ sơ của detection để job không bỏ quên đối tượng.
      const { bth } = await taoDauRa(app, nguon.id, "caption", "Độc giả trẻ");
      const rPut = await post(
        app,
        `/api/ho-so-doi-tuong/${dt.id}`,
        { ten: "Độc giả trẻ", moi_quan_tam: "Giảm giá" },
        "PUT",
      );
      const ph = (await rPut.json()).du_lieu.phat_hien;
      const task = ph.ds_task.find(
        (t: { ban_the_hien_id: string }) => t.ban_the_hien_id === bth.id,
      );
      expect(task.do_tin).toBe("khong_chac");

      const dx = await post(app, `/api/task-sua/${task.id}/de-xuat`, {});
      expect(dx.status).toBe(200);
      const d = (await dx.json()).du_lieu;
      const job = await choJob(app, d.job.id);
      expect(job.trang_thai).toBe("xong");

      // Head mới ghim context có đối tượng revision ≥ đích → task tự đóng.
      const { json: jt } = await getJson(app, `/api/task-sua/${task.id}`);
      expect(jt.du_lieu.trang_thai).toBe("xong");
    } finally {
      await app.dong();
    }
  });

  test("PUT chỉ đổi tiêu đề nguồn → vẫn tạo detection (tiêu đề đi vào context)", async () => {
    const app = await taoServerTam();
    try {
      const nguon = await taoNguonFact(app);
      const { bth } = await taoDauRa(app, nguon.id, "bai-viet");
      const r = await post(
        app,
        `/api/nguon/${nguon.id}`,
        {
          tieu_de: "Ra mắt sản phẩm X — đợt 2",
          noi_dung: "Ngày ra mắt: 10/01/2026. Giá: 25000.",
          loai: "fact",
          cac_muc: MUC_NGUON,
          dua_tren_revision_id: nguon.head_revision_id,
        },
        "PUT",
      );
      const ph = (await r.json()).du_lieu.phat_hien;
      expect(ph).not.toBeNull();
      expect(ph.thay_doi).not.toBeNull();
      const muc = ph.thay_doi.ds_thay_doi.find(
        (m: { muc_id: string | null }) => m.muc_id === "tieu_de",
      );
      expect(muc).not.toBeUndefined();
      expect(muc.loai_muc).toBe("truong");
      expect(muc.moi).toBe("Ra mắt sản phẩm X — đợt 2");
      const task = ph.ds_task.find(
        (t: { ban_the_hien_id: string }) => t.ban_the_hien_id === bth.id,
      );
      expect(task).not.toBeUndefined();
    } finally {
      await app.dong();
    }
  });

  test("PUT đổi tiêu đề + toàn văn cùng lúc → diff có cả hai; PUT thiếu loai giữ loại cũ", async () => {
    const app = await taoServerTam();
    try {
      const nguon = await taoNguonFact(app);
      const r = await post(
        app,
        `/api/nguon/${nguon.id}`,
        {
          tieu_de: "Tiêu đề mới",
          // cac_muc y hệt nhưng toàn văn đổi — cả hai đổi phải cùng hiện
          // trong ds_thay_doi (không nuốt mục 'Toàn văn').
          noi_dung: "Toàn văn viết lại hoàn toàn.",
          loai: "fact",
          cac_muc: MUC_NGUON,
          dua_tren_revision_id: nguon.head_revision_id,
        },
        "PUT",
      );
      const ph = (await r.json()).du_lieu.phat_hien;
      const ids = ph.thay_doi.ds_thay_doi.map((m: { muc_id: string | null }) => m.muc_id);
      expect(ids).toContain("tieu_de");
      expect(ph.thay_doi.ds_thay_doi.some((m: { loai_muc: string }) => m.loai_muc === "noi_dung")).toBe(
        true,
      );

      // PUT thiếu field `loai` → giữ 'fact' của head, không detection giả.
      const nguon2 = await taoNguonFact(app, "26000");
      const head2 = (await getJson(app, `/api/nguon/${nguon2.id}`)).json.du_lieu
        .head_revision_id;
      const r2 = await post(
        app,
        `/api/nguon/${nguon2.id}`,
        {
          tieu_de: "Ra mắt sản phẩm X",
          noi_dung: "Ngày ra mắt: 10/01/2026. Giá: 26000.",
          cac_muc: MUC_NGUON.map((m) => (m.id === "gia" ? { ...m, noi_dung: "26000" } : m)),
          dua_tren_revision_id: head2,
        },
        "PUT",
      );
      const put2 = (await r2.json()).du_lieu;
      expect(put2.loai).toBe("fact");
      expect(put2.phat_hien.thay_doi).toBeNull();
    } finally {
      await app.dong();
    }
  });

  test("đề xuất task thu_cong → 409 (bản đã xuất bản sửa bằng tay)", async () => {
    const app = await taoServerTam();
    try {
      const nguon = await taoNguonFact(app);
      const { bth } = await taoDauRa(app, nguon.id, "bai-viet");
      await duyetBth(app, bth.id);
      await post(app, `/api/ban-the-hien/${bth.id}/xuat-ban`, {});
      const put = await doiGiaNguon(app, nguon);
      const task = put.phat_hien.ds_task[0];
      expect(task.loai).toBe("thu_cong");

      const dx = await post(app, `/api/task-sua/${task.id}/de-xuat`, {});
      expect(dx.status).toBe(409);
      expect((await dx.json()).loi.ma).toBe("XUNG_DOT_TRANG_THAI");
    } finally {
      await app.dong();
    }
  });

  test("đề xuất khi bản đã ghim nguồn mới qua đường khác → task tự đóng, 409 không job dư", async () => {
    const app = await taoServerTam();
    try {
      const nguon = await taoNguonFact(app);
      const { td, bth } = await taoDauRa(app, nguon.id, "bai-viet");
      const put = await doiGiaNguon(app, nguon);
      const task = put.phat_hien.ds_task[0];
      expect(task.trang_thai).toBe("mo");

      // Sửa qua đường khác: revision thông điệp mới ghim head nguồn mới,
      // rồi revision bản thể hiện mới ghim thông điệp đó.
      capNhatThongDiep(
        app.db,
        td.id,
        { tieu_de: td.tieu_de, noi_dung: td.noi_dung },
        td.head_revision_id,
        "test",
      );
      const { json: chiTiet } = await getJson(app, `/api/ban-the-hien/${bth.id}`);
      themRevision(
        app.db,
        {
          ban_the_hien_id: bth.id,
          noi_dung: JSON.stringify({ tieu_de: "x", noi_dung: "sửa bằng tay" }),
          dua_tren_revision_id: chiTiet.du_lieu.head_revision_id,
        },
        "test",
      );

      // GET tự đóng task (lazy-close) — rồi de-xuat bị chặn 409, không job.
      const dx = await post(app, `/api/task-sua/${task.id}/de-xuat`, {});
      expect(dx.status).toBe(409);
      const { json: jt } = await getJson(app, `/api/task-sua/${task.id}`);
      expect(jt.du_lieu.trang_thai).toBe("xong");
      expect(jt.du_lieu.job_id).toBeNull();
    } finally {
      await app.dong();
    }
  });
});
