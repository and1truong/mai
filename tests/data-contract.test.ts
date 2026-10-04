import { describe, expect, test } from "bun:test";
import { seed } from "../src/server/seed.ts";
import { taoServerTam } from "./helpers.ts";

// Test contract dữ liệu của ticket #4 trên database POC thật:
// nhập bài → nguồn/thông điệp/bản thể hiện, provenance theo revision,
// optimistic concurrency, duyệt theo revision, xuất bản tách trạng thái.

type App = Awaited<ReturnType<typeof taoServerTam>>;

function post(app: App, path: string, body: unknown, method = "POST") {
  return fetch(`${app.url}${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function getJson(app: App, path: string) {
  return (await fetch(`${app.url}${path}`)).json();
}

async function choJobXong(app: App, id: string): Promise<string> {
  for (let i = 0; i < 200; i++) {
    const ds = await getJson(app, "/api/job");
    const j = ds.du_lieu.find((x: { id: string }) => x.id === id);
    if (j && j.trang_thai !== "cho" && j.trang_thai !== "dang_chay") return j.trang_thai;
    await Bun.sleep(30);
  }
  return "timeout";
}

describe("contract dữ liệu nội dung (#4)", () => {
  test("POST /api/bai-viet: dán một bài → nguồn + thông điệp + nhiều bản thể hiện", async () => {
    const app = await taoServerTam();
    try {
      const res = await post(app, "/api/bai-viet", {
        tieu_de: "Bài test nhập",
        noi_dung: "Đoạn một.\nĐoạn hai.",
        cac_muc: [
          { id: "f1", loai: "fact", noi_dung: "Fact quan trọng", assets: ["anh-1.png"] },
          { loai: "section", tieu_de: "Mở đầu", noi_dung: "Đoạn một." },
        ],
        ds_ban_the_hien: [
          { dinh_dang: "bai-viet" },
          { dinh_dang: "newsletter", doi_tuong: "Kỹ sư", dich_den: "email" },
        ],
      });
      expect(res.status).toBe(201);
      const { du_lieu } = await res.json();
      expect(du_lieu.nguon.id).toBeTruthy();
      expect(du_lieu.thong_diep.id).toBeTruthy();
      expect(du_lieu.thong_diep.campaign_id).toBeNull(); // bài lẻ không bắt buộc campaign
      expect(du_lieu.ds_ban_the_hien).toHaveLength(2);
      for (const b of du_lieu.ds_ban_the_hien) {
        expect(b.thong_diep_id).toBe(du_lieu.thong_diep.id);
      }

      // Nguồn có revision đầu + cac_muc định danh ổn định kèm asset.
      const nguon = await getJson(app, `/api/nguon/${du_lieu.nguon.id}`);
      expect(nguon.du_lieu.cac_muc).toHaveLength(2);
      expect(nguon.du_lieu.cac_muc[0].id).toBe("f1");
      expect(nguon.du_lieu.cac_muc[0].assets).toEqual(["anh-1.png"]);
      expect(nguon.du_lieu.cac_muc[1].id).toBe("m2"); // id tự gán theo vị trí
      expect(nguon.du_lieu.revisions).toHaveLength(1);
      expect(nguon.du_lieu.revisions[0].cac_muc[0].id).toBe("f1");

      // Thông điệp revision 1 ghim đúng revision nguồn đã dùng.
      const td = await getJson(app, `/api/thong-diep/${du_lieu.thong_diep.id}`);
      expect(td.du_lieu.nguon_ids).toEqual([du_lieu.nguon.id]);
      expect(td.du_lieu.revisions).toHaveLength(1);
      expect(td.du_lieu.revisions[0].nguon_revision_ids).toEqual([
        nguon.du_lieu.revisions[0].id,
      ]);

      // Dedupe danh tính đầu ra: POST lại cùng bộ → trả bản ghi cũ.
      const lai = await post(app, "/api/ban-the-hien", {
        thong_diep_id: du_lieu.thong_diep.id,
        dinh_dang: "bai-viet",
      });
      expect(lai.status).toBe(200);
      expect((await lai.json()).du_lieu.da_tao).toBe(false);
    } finally {
      await app.dong();
    }
  });

  test("thông báo một thông điệp và số tạp chí nhiều thông điệp dùng cùng một model", async () => {
    const app = await taoServerTam();
    try {
      // Bài lẻ: thông điệp không campaign.
      const le = await post(app, "/api/thong-diep", { tieu_de: "Thông báo lẻ" });
      expect(le.status).toBe(201);
      expect((await le.json()).du_lieu.campaign_id).toBeNull();

      // Campaign: nhiều thông điệp cùng nhóm — số tạp chí.
      const cp = await post(app, "/api/campaign", {
        ten: "Tạp chí số 1",
        ghi_de: { doi_tuong: { do_sau: "chuyen_sau" } },
      });
      expect(cp.status).toBe(201);
      const cpId = (await cp.json()).du_lieu.id;
      for (const t of ["Bài một", "Bài hai"]) {
        const td = await post(app, "/api/thong-diep", { tieu_de: t, campaign_id: cpId });
        expect(td.status).toBe(201);
      }
      const chiTiet = await getJson(app, `/api/campaign/${cpId}`);
      expect(chiTiet.du_lieu.thong_diep).toHaveLength(2);
      expect(chiTiet.du_lieu.ghi_de.doi_tuong.do_sau).toBe("chuyen_sau");

      // Xóa campaign → thông điệp còn lại, campaign_id về null (bài đăng lẻ).
      const xoa = await fetch(`${app.url}/api/campaign/${cpId}`, { method: "DELETE" });
      expect(xoa.status).toBe(200);
      const ds = await getJson(app, `/api/thong-diep?campaign_id=${cpId}`);
      expect(ds.du_lieu).toHaveLength(0);
      const tdCon = await getJson(app, `/api/thong-diep`);
      expect(tdCon.du_lieu.length).toBe(3);
    } finally {
      await app.dong();
    }
  });

  test("cập nhật thêm revision; ghi xung đột bị từ chối; revision cũ vẫn truy cập được", async () => {
    const app = await taoServerTam();
    try {
      const tao = await post(app, "/api/nguon", { tieu_de: "N1", noi_dung: "v1" });
      const nguon = (await tao.json()).du_lieu;
      const r1 = nguon.head_revision_id;
      expect(r1).toBeTruthy();

      // Ghi trên base cũ → 409 theo convention envelope.
      const xungDot = await post(
        app,
        `/api/nguon/${nguon.id}`,
        { tieu_de: "N1b", noi_dung: "v2", dua_tren_revision_id: "stale" },
        "PUT",
      );
      expect(xungDot.status).toBe(409);
      expect((await xungDot.json()).loi.ma).toBe("XUNG_DOT_REVISION");

      // Thiếu dua_tren_revision_id → 400 VALIDATION.
      const thieu = await post(
        app,
        `/api/nguon/${nguon.id}`,
        { tieu_de: "N1b", noi_dung: "v2" },
        "PUT",
      );
      expect(thieu.status).toBe(400);

      // Đúng head → revision 2.
      const okRes = await post(
        app,
        `/api/nguon/${nguon.id}`,
        { tieu_de: "N1b", noi_dung: "v2", dua_tren_revision_id: r1 },
        "PUT",
      );
      expect(okRes.status).toBe(200);
      const sau = (await okRes.json()).du_lieu;
      expect(sau.head_revision_id).not.toBe(r1);

      const ds = await getJson(app, `/api/nguon/${nguon.id}/revision`);
      expect(ds.du_lieu).toHaveLength(2);
      // Revision cũ vẫn đọc được qua endpoint riêng.
      const cu = await getJson(app, `/api/nguon-revision/${r1}`);
      expect(cu.du_lieu.noi_dung).toBe("v1");
    } finally {
      await app.dong();
    }
  });

  test("duyệt gắn đúng revision; xuất bản tách khỏi trạng thái nội dung", async () => {
    const app = await taoServerTam();
    try {
      const tao = await post(app, "/api/bai-viet", {
        tieu_de: "Bài duyệt",
        noi_dung: "nội dung",
        ds_ban_the_hien: [{ dinh_dang: "bai-viet" }],
      });
      const bthId = (await tao.json()).du_lieu.ds_ban_the_hien[0].id;

      // Chưa có nội dung → chưa xuất bản được: được sinh ≠ đã đăng.
      const som = await post(app, `/api/ban-the-hien/${bthId}/xuat-ban`, {});
      expect(som.status).toBe(409);
      expect((await som.json()).loi.ma).toBe("XUNG_DOT_TRANG_THAI");

      const rev = await post(app, `/api/ban-the-hien/${bthId}/revision`, {
        noi_dung: "nội dung revision 1",
      });
      expect(rev.status).toBe(201);
      const head = (await rev.json()).du_lieu.id;

      // Chuyển trạng thái ghi record duyet ghim đúng revision head.
      const duyet = await post(app, `/api/ban-the-hien/${bthId}/trang-thai`, {
        trang_thai: "cho_duyet",
        ghi_chu: "gửi duyệt",
      });
      expect(duyet.status).toBe(200);
      const dsDuyet = await getJson(app, `/api/ban-the-hien/${bthId}/duyet`);
      expect(dsDuyet.du_lieu).toHaveLength(1);
      expect(dsDuyet.du_lieu[0].revision_id).toBe(head);
      expect(dsDuyet.du_lieu[0].tu_trang_thai).toBe("nhap");
      expect(dsDuyet.du_lieu[0].den_trang_thai).toBe("cho_duyet");
      expect(dsDuyet.du_lieu[0].ghi_chu).toBe("gửi duyệt");

      // Chưa duyệt → chưa xuất bản được (#21): vòng đời ép phía server.
      const chuaDuyet = await post(app, `/api/ban-the-hien/${bthId}/xuat-ban`, {});
      expect(chuaDuyet.status).toBe(409);
      expect((await chuaDuyet.json()).loi.ma).toBe("XUNG_DOT_TRANG_THAI");

      // Duyệt ghim revision tường minh → mới xuất bản được.
      const duyetOk = await post(app, `/api/ban-the-hien/${bthId}/trang-thai`, {
        trang_thai: "da_duyet",
        mong_doi_revision_id: head,
      });
      expect(duyetOk.status).toBe(200);

      // Xuất bản ghim revision head tại thời điểm đăng.
      const xb = await post(app, `/api/ban-the-hien/${bthId}/xuat-ban`, {
        dich_den: "https://example.test/bai",
      });
      expect(xb.status).toBe(201);
      const xuatBan = (await xb.json()).du_lieu;
      expect(xuatBan.revision_id).toBe(head);
      expect(xuatBan.dich_den).toBe("https://example.test/bai");
      const dsXb = await getJson(app, `/api/ban-the-hien/${bthId}/xuat-ban`);
      expect(dsXb.du_lieu).toHaveLength(1);

      // Sự kiện mutation đủ chuỗi, kèm actor local.
      const sk = await getJson(
        app,
        `/api/su-kien?entity_loai=ban_the_hien&entity_id=${bthId}`,
      );
      const loai = sk.du_lieu.map((d: { su_kien: string }) => d.su_kien);
      for (const s of ["tao", "revision_moi", "trang_thai", "xuat_ban"]) {
        expect(loai).toContain(s);
      }
      expect(sk.du_lieu.every((d: { actor: string }) => d.actor === "demo")).toBe(true);
    } finally {
      await app.dong();
    }
  });

  test("revision đã sinh resolve đúng nguồn và context đã dùng", async () => {
    const app = await taoServerTam();
    try {
      seed(app.db);
      const res = await post(app, "/api/job", {
        loai: "sinh_ban_the_hien",
        payload: {
          thong_diep_id: "seed-td-1",
          dinh_dang: "newsletter",
          doi_tuong_id: "seed-dt-ky-su",
        },
      });
      expect(res.status).toBe(201);
      const job = (await res.json()).du_lieu;
      expect(await choJobXong(app, job.id)).toBe("xong");

      const ds = await getJson(app, "/api/ban-the-hien?nguon_id=seed-nguon-1");
      const bth = ds.du_lieu.find((b: { dinh_dang: string }) => b.dinh_dang === "newsletter");
      const chiTiet = await getJson(app, `/api/ban-the-hien/${bth.id}`);
      const rev = chiTiet.du_lieu.revisions[0];
      // Provenance đầy đủ: context sinh + revision thông điệp → revision nguồn.
      expect(rev.context_sinh.snapshot.doi_tuong.ho_so_id).toBe("seed-dt-ky-su");
      expect(rev.thong_diep_revision.thong_diep_id).toBe("seed-td-1");
      expect(rev.thong_diep_revision.nguon_revisions[0].nguon_id).toBe("seed-nguon-1");
      expect(rev.thong_diep_revision.nguon_revisions[0].so_thu_tu).toBe(1);
    } finally {
      await app.dong();
    }
  });

  test("cac_muc sai kiểu → 400 VALIDATION có chi_tiet", async () => {
    const app = await taoServerTam();
    try {
      const res = await post(app, "/api/nguon", {
        tieu_de: "x",
        noi_dung: "y",
        cac_muc: [{ loai: "khong-co", noi_dung: "z" }, { id: "a", noi_dung: "z" }, { id: "a", noi_dung: "z" }],
      });
      expect(res.status).toBe(400);
      const j = await res.json();
      expect(j.loi.ma).toBe("VALIDATION");
      expect(j.loi.chi_tiet.join(" ")).toContain("loai");
      expect(j.loi.chi_tiet.join(" ")).toContain("trùng");
    } finally {
      await app.dong();
    }
  });
});
