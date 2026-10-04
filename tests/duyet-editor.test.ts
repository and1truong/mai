import { describe, expect, test } from "bun:test";
import { taoServerTam } from "./helpers.ts";
import { seed } from "../src/server/seed.ts";

// Test vòng đời duyệt + nháp autosave + xung đột revision (#21):
// - autosave nháp theo (bản thể hiện, actor), phục hồi sau "reload",
//   tiêu thụ khi lưu revision thành công.
// - optimistic concurrency: hai bên sửa cùng một revision → 409 thay vì
//   last-write-wins.
// - duyệt ghim revision: thiếu mong_doi → 400, mong_doi cũ → 409.
// - sửa sau duyệt làm mất hiệu lực duyệt (da_duyet → thay_the,
//   tu_choi → nhap) và chỉ xuất bản được khi da_duyet.
// - hàng chờ review: lọc danh sách theo trang_thai.

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

async function layHead(app: App, bthId: string): Promise<string> {
  const { json } = await getJson(app, `/api/ban-the-hien/${bthId}`);
  return json.du_lieu.head_revision_id;
}

async function duaLenDuyet(app: App, bthId: string) {
  await post(app, `/api/ban-the-hien/${bthId}/trang-thai`, { trang_thai: "cho_duyet" });
  const head = await layHead(app, bthId);
  return post(app, `/api/ban-the-hien/${bthId}/trang-thai`, {
    trang_thai: "da_duyet",
    mong_doi_revision_id: head,
  });
}

const NOI_DUNG = { tieu_de: "T", noi_dung: "Nội dung" };

describe("nháp soạn (autosave)", () => {
  test("PUT/GET/DELETE nháp; không có → 404; phục hồi giữ base revision", async () => {
    const app = await appCoSeed();
    try {
      const chua = await fetch(`${app.url}/api/ban-the-hien/seed-bth-1/nhap`);
      expect(chua.status).toBe(404);
      expect((await chua.json()).loi.ma).toBe("KHONG_TIM_THAY");

      const head = await layHead(app, "seed-bth-1");
      const luu = await fetch(`${app.url}/api/ban-the-hien/seed-bth-1/nhap`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ noi_dung: "nháp giữa chừng", dua_tren_revision_id: head }),
      });
      expect(luu.status).toBe(200);
      const nhap = (await luu.json()).du_lieu;
      expect(nhap.dua_tren_revision_id).toBe(head);
      expect(nhap.actor).toBe("demo");

      // "Reload": GET lại — text và base giữ nguyên.
      const doc = await getJson(app, "/api/ban-the-hien/seed-bth-1/nhap");
      expect(doc.json.du_lieu.noi_dung).toBe("nháp giữa chừng");

      // Upsert: lưu lần 2 ghi đè; bỏ qua dua_tren → giữ base cũ.
      await fetch(`${app.url}/api/ban-the-hien/seed-bth-1/nhap`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ noi_dung: "nháp lần 2" }),
      });
      const doc2 = await getJson(app, "/api/ban-the-hien/seed-bth-1/nhap");
      expect(doc2.json.du_lieu.noi_dung).toBe("nháp lần 2");
      expect(doc2.json.du_lieu.dua_tren_revision_id).toBe(head);

      const xoa = await fetch(`${app.url}/api/ban-the-hien/seed-bth-1/nhap`, {
        method: "DELETE",
      });
      expect(xoa.status).toBe(200);
      expect((await fetch(`${app.url}/api/ban-the-hien/seed-bth-1/nhap`)).status).toBe(404);
    } finally {
      await app.dong();
    }
  });

  test("lưu revision thành công thì nháp bị tiêu thụ", async () => {
    const app = await appCoSeed();
    try {
      const head = await layHead(app, "seed-bth-1");
      await fetch(`${app.url}/api/ban-the-hien/seed-bth-1/nhap`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ noi_dung: "đang soạn" }),
      });
      const rev = await post(app, "/api/ban-the-hien/seed-bth-1/revision", {
        noi_dung: JSON.stringify(NOI_DUNG),
        dua_tren_revision_id: head,
      });
      expect(rev.status).toBe(201);
      expect((await fetch(`${app.url}/api/ban-the-hien/seed-bth-1/nhap`)).status).toBe(404);
    } finally {
      await app.dong();
    }
  });
});

describe("xung đột + vòng đời duyệt", () => {
  test("hai bên sửa cùng revision → bên sau nhận 409, dữ liệu không mất âm thầm", async () => {
    const app = await appCoSeed();
    try {
      const head = await layHead(app, "seed-bth-1");
      const a = await post(app, "/api/ban-the-hien/seed-bth-1/revision", {
        noi_dung: JSON.stringify({ ...NOI_DUNG, noi_dung: "bản A" }),
        dua_tren_revision_id: head,
      });
      expect(a.status).toBe(201);
      // B: cùng base head cũ — bị từ chối rõ ràng.
      const b = await post(app, "/api/ban-the-hien/seed-bth-1/revision", {
        noi_dung: JSON.stringify({ ...NOI_DUNG, noi_dung: "bản B" }),
        dua_tren_revision_id: head,
      });
      expect(b.status).toBe(409);
      expect((await b.json()).loi.ma).toBe("XUNG_DOT_REVISION");
      // B lưu lên head mới (revision A) → được.
      const b2 = await post(app, "/api/ban-the-hien/seed-bth-1/revision", {
        noi_dung: JSON.stringify({ ...NOI_DUNG, noi_dung: "bản B" }),
        dua_tren_revision_id: (await a.json()).du_lieu.id,
      });
      expect(b2.status).toBe(201);
      // Lịch sử giữ đủ 3 revision — không ghi đè.
      const { json } = await getJson(app, "/api/ban-the-hien/seed-bth-1");
      expect(json.du_lieu.revisions).toHaveLength(3);
    } finally {
      await app.dong();
    }
  });

  test("duyệt phải ghim revision; request duyệt cũ lỗi 409 sạch", async () => {
    const app = await appCoSeed();
    try {
      await post(app, "/api/ban-the-hien/seed-bth-1/trang-thai", { trang_thai: "cho_duyet" });
      const thieu = await post(app, "/api/ban-the-hien/seed-bth-1/trang-thai", {
        trang_thai: "da_duyet",
      });
      expect(thieu.status).toBe(400);

      const head = await layHead(app, "seed-bth-1");
      const khac = await post(app, "/api/ban-the-hien/seed-bth-1/revision", {
        noi_dung: JSON.stringify(NOI_DUNG),
        dua_tren_revision_id: head,
      });
      expect(khac.status).toBe(201);
      // Request duyệt soạn khi head còn cũ → đã cũ → 409.
      const cu = await post(app, "/api/ban-the-hien/seed-bth-1/trang-thai", {
        trang_thai: "da_duyet",
        mong_doi_revision_id: head,
      });
      expect(cu.status).toBe(409);
      expect((await cu.json()).loi.ma).toBe("XUNG_DOT_REVISION");
    } finally {
      await app.dong();
    }
  });

  test("revision mới sau duyệt → thay_the, duyệt chỉ tính cho revision đã chấm", async () => {
    const app = await appCoSeed();
    try {
      const duyet = await duaLenDuyet(app, "seed-bth-1");
      expect(duyet.status).toBe(200);

      const head = await layHead(app, "seed-bth-1");
      const rev = await post(app, "/api/ban-the-hien/seed-bth-1/revision", {
        noi_dung: JSON.stringify({ ...NOI_DUNG, noi_dung: "sửa sau duyệt" }),
        dua_tren_revision_id: head,
      });
      expect(rev.status).toBe(201);

      const { json } = await getJson(app, "/api/ban-the-hien/seed-bth-1");
      expect(json.du_lieu.trang_thai).toBe("thay_the");
      // Chưa duyệt lại → chưa xuất bản được.
      const xb = await post(app, "/api/ban-the-hien/seed-bth-1/xuat-ban", {});
      expect(xb.status).toBe(409);
      // Sự kiện tự động ghi lý do.
      const sk = await getJson(
        app,
        "/api/su-kien?entity_loai=ban_the_hien&entity_id=seed-bth-1",
      );
      const auto = sk.json.du_lieu.find(
        (s: { su_kien: string }) => s.su_kien === "trang_thai_tu_dong",
      );
      expect(JSON.parse(auto.du_lieu).den).toBe("thay_the");

      // Duyệt lại revision mới → xuất bản được.
      expect((await duaLenDuyet(app, "seed-bth-1")).status).toBe(200);
      const xb2 = await post(app, "/api/ban-the-hien/seed-bth-1/xuat-ban", {});
      expect(xb2.status).toBe(201);
    } finally {
      await app.dong();
    }
  });

  test("revision mới sau từ chối → về nhap (được sửa tiếp)", async () => {
    const app = await appCoSeed();
    try {
      await post(app, "/api/ban-the-hien/seed-bth-1/trang-thai", { trang_thai: "cho_duyet" });
      await post(app, "/api/ban-the-hien/seed-bth-1/trang-thai", { trang_thai: "tu_choi" });
      const head = await layHead(app, "seed-bth-1");
      await post(app, "/api/ban-the-hien/seed-bth-1/revision", {
        noi_dung: JSON.stringify(NOI_DUNG),
        dua_tren_revision_id: head,
      });
      const { json } = await getJson(app, "/api/ban-the-hien/seed-bth-1");
      expect(json.du_lieu.trang_thai).toBe("nhap");
    } finally {
      await app.dong();
    }
  });

  test("khôi phục revision cũ = revision mới, lịch sử không bị viết lại", async () => {
    const app = await appCoSeed();
    try {
      const head0 = await layHead(app, "seed-bth-1");
      const { json: truoc } = await getJson(app, "/api/ban-the-hien/seed-bth-1");
      const noiDungCu = truoc.du_lieu.revisions[0].noi_dung;
      const rev2 = await post(app, "/api/ban-the-hien/seed-bth-1/revision", {
        noi_dung: JSON.stringify({ ...NOI_DUNG, noi_dung: "bản mới" }),
        dua_tren_revision_id: head0,
      });
      const head2 = (await rev2.json()).du_lieu.id;
      // Khôi phục nội dung revision đầu thành revision mới dựa trên head.
      const phucHoi = await post(app, "/api/ban-the-hien/seed-bth-1/revision", {
        noi_dung: noiDungCu,
        dua_tren_revision_id: head2,
      });
      expect(phucHoi.status).toBe(201);
      const { json: sau } = await getJson(app, "/api/ban-the-hien/seed-bth-1");
      expect(sau.du_lieu.revisions).toHaveLength(3); // không mất revision giữa
      expect(sau.du_lieu.revisions[2].dua_tren_revision_id).toBe(head2);
      expect(sau.du_lieu.revisions[2].noi_dung).toBe(noiDungCu);
    } finally {
      await app.dong();
    }
  });

  test("lọc danh sách theo trạng thái — hàng chờ review", async () => {
    const app = await appCoSeed();
    try {
      await post(app, "/api/ban-the-hien/seed-bth-1/trang-thai", { trang_thai: "cho_duyet" });
      const cho = await getJson(app, "/api/ban-the-hien?trang_thai=cho_duyet");
      expect(cho.json.du_lieu.some((b: { id: string }) => b.id === "seed-bth-1")).toBe(true);
      const nhap = await getJson(app, "/api/ban-the-hien?trang_thai=nhap");
      expect(nhap.json.du_lieu.some((b: { id: string }) => b.id === "seed-bth-1")).toBe(false);
      const tatCa = await getJson(app, "/api/ban-the-hien");
      expect(tatCa.json.du_lieu.length).toBeGreaterThan(0);
    } finally {
      await app.dong();
    }
  });
});
