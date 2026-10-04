import { describe, expect, test } from "bun:test";
import { seed } from "../src/server/seed.ts";
import { taoServerTam } from "./helpers.ts";

// Test cho module context: CRUD hồ sơ, revision hồ sơ, bảng thuật ngữ,
// xem trước context sinh, và context ghi lại khi job sinh nội dung.

type App = Awaited<ReturnType<typeof taoServerTam>>;

// Một server dùng chung cho cả file; `app` được gán trong beforeAll ở cuối file.
let app!: App;

// Đọc `app` lúc gọi (không phải lúc describe đăng ký).
const get = (p: string) => fetch(`${app.url}${p}`);
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
const xoa = (p: string) => fetch(`${app.url}${p}`, { method: "DELETE" });

async function choJobXong(app: App, id: string): Promise<string> {
  for (let i = 0; i < 100; i++) {
    const ds = await (await fetch(`${app.url}/api/job`)).json();
    const j = ds.du_lieu.find((x: { id: string }) => x.id === id);
    if (j && j.trang_thai !== "cho" && j.trang_thai !== "dang_chay") return j.trang_thai;
    await Bun.sleep(30);
  }
  return "timeout";
}

describe("hồ sơ thương hiệu: CRUD + revision + chủ sở hữu", () => {
  test("tạo → list → detail → sửa (tạo revision) → xóa", async () => {
    // Tạo
    const tao = await post("/api/ho-so-thuong-hieu", {
      ten: "Hồ sơ test",
      nhan_dien: "Nhận diện test",
      ngon_ngu_uu_tien: ["vi", "en"],
      claim_duyet: ["Claim A"],
      claim_cam: ["Claim X"],
    });
    expect(tao.status).toBe(201);
    const taoJ = await tao.json();
    expect(taoJ.du_lieu.tao_boi).toBe("demo"); // chủ sở hữu = actor instance
    expect(taoJ.du_lieu.nguon_du_lieu).toBe("nguoi_dung");
    expect(taoJ.du_lieu.claim_duyet).toEqual(["Claim A"]);
    const id = taoJ.du_lieu.id;

    // List
    const ds = await (await get("/api/ho-so-thuong-hieu")).json();
    expect(ds.du_lieu.some((h: { id: string }) => h.id === id)).toBe(true);

    // Detail kèm bảng thuật ngữ
    const chiTiet = await (await get(`/api/ho-so-thuong-hieu/${id}`)).json();
    expect(chiTiet.du_lieu.thuat_ngu).toEqual([]);

    // Revision #1 được ghi khi tạo
    const rev1 = await (await get(`/api/ho-so-thuong-hieu/${id}/revision`)).json();
    expect(rev1.du_lieu.length).toBe(1);
    expect(rev1.du_lieu[0].nguon_du_lieu).toBe("nguoi_dung");

    // Sửa → revision #2
    const sua = await put(`/api/ho-so-thuong-hieu/${id}`, {
      ten: "Hồ sơ test v2",
      nguon_du_lieu: "he_thong",
    });
    expect(sua.status).toBe(200);
    const rev2 = await (await get(`/api/ho-so-thuong-hieu/${id}/revision`)).json();
    expect(rev2.du_lieu.length).toBe(2);
    expect(rev2.du_lieu[0].nguon_du_lieu).toBe("he_thong");

    // Xóa → 404 cả detail lẫn revision
    expect((await xoa(`/api/ho-so-thuong-hieu/${id}`)).status).toBe(200);
    expect((await get(`/api/ho-so-thuong-hieu/${id}`)).status).toBe(404);
    const rev3 = await (await get(`/api/ho-so-thuong-hieu/${id}/revision`)).json();
    expect(rev3.du_lieu.length).toBe(0);
  });

  test("thiếu ten → 400; nguon_du_lieu lạ → 400", async () => {
    const res = await post("/api/ho-so-thuong-hieu", { nhan_dien: "x" });
    expect(res.status).toBe(400);
    const res2 = await post("/api/ho-so-thuong-hieu", { ten: "A", nguon_du_lieu: "ai_do" });
    expect(res2.status).toBe(400);
  });

  test("thay bảng thuật ngữ → sửa được + ghi revision", async () => {
    // Hồ sơ riêng để không đụng seed dùng ở test khác.
    const tao = await post("/api/ho-so-thuong-hieu", { ten: "Hồ sơ thuật ngữ" });
    const id = (await tao.json()).du_lieu.id;

    const putTn = await put(`/api/ho-so-thuong-hieu/${id}/thuat-ngu`, {
      thuat_ngu: [
        { thuat_ngu: "Phúc Âm", giu_nguyen: true, ban_dich: { en: "the Gospel" } },
        { thuat_ngu: "nhà thờ", giu_nguyen: false, ban_dich: { en: "church" } },
      ],
    });
    expect(putTn.status).toBe(200);
    const tn = await putTn.json();
    expect(tn.du_lieu.length).toBe(2);
    expect(tn.du_lieu.find((t: { thuat_ngu: string }) => t.thuat_ngu === "Phúc Âm").giu_nguyen).toBe(
      true,
    );

    // Thay đổi thuật ngữ tạo revision hồ sơ mới (tạo 1 + thay 1 = 2)
    const rev = await (await get(`/api/ho-so-thuong-hieu/${id}/revision`)).json();
    expect(rev.du_lieu.length).toBe(2);
    const snapshot = JSON.parse(rev.du_lieu[0].snapshot);
    expect(snapshot.thuat_ngu.length).toBe(2);

    // Dòng thiếu thuat_ngu → 400
    const loi = await put(`/api/ho-so-thuong-hieu/${id}/thuat-ngu`, {
      thuat_ngu: [{ ban_dich: {} }],
    });
    expect(loi.status).toBe(400);
  });
});

describe("hồ sơ đối tượng", () => {
  test("CRUD + do_sau validation + trường trống giữ nguyên là rỗng", async () => {
    const tao = await post("/api/ho-so-doi-tuong", {
      ten: "Đối tượng test",
      ngon_ngu: "vi",
      do_sau: "vua_phai",
    });
    expect(tao.status).toBe(201);
    const j = await tao.json();
    // Không bịa: trường không nhập vẫn rỗng (UI hiển thị "chưa biết")
    expect(j.du_lieu.nhan_khau_hoc).toBe("");
    expect(j.du_lieu.dia_diem).toBe("");

    const loi = await post("/api/ho-so-doi-tuong", { ten: "X", do_sau: "sieu_sau" });
    expect(loi.status).toBe(400);

    const sua = await put(`/api/ho-so-doi-tuong/${j.du_lieu.id}`, {
      ten: "Đối tượng test v2",
      do_sau: "chuyen_sau",
    });
    expect(sua.status).toBe(200);
    const rev = await (await get(`/api/ho-so-doi-tuong/${j.du_lieu.id}/revision`)).json();
    expect(rev.du_lieu.length).toBe(2);
  });
});

describe("xem trước context sinh", () => {
  test("thương hiệu và đối tượng tách riêng; ghi đè áp đúng", async () => {
    const res = await post("/api/context-sinh/xem-truoc", {
      thuong_hieu_id: "seed-th-nxb-phuc-am",
      doi_tuong_id: "seed-dt-ky-su",
      ghi_de: { doi_tuong: { do_sau: "so_luoc" } },
    });
    expect(res.status).toBe(200);
    const j = (await res.json()).du_lieu;
    // Hai phần tách riêng
    expect(j.thuong_hieu.ten).toContain("Phúc Âm");
    expect(j.doi_tuong.ten).toBe("Kỹ sư (fixture)");
    // Ghi đè campaign áp vào snapshot
    expect(j.doi_tuong.do_sau).toBe("so_luoc");
    // Thuật ngữ đi kèm, giu_nguyen giữ đúng
    expect(
      j.thuong_hieu.thuat_ngu.find((t: { thuat_ngu: string }) => t.thuat_ngu === "Phúc Âm")
        .giu_nguyen,
    ).toBe(true);
    // Tham chiếu revision hồ sơ hiện tại
    expect(j.thuong_hieu.revision_id).toBeTruthy();
    expect(j.doi_tuong.revision_id).toBeTruthy();
  });

  test("không chọn hồ sơ → hai phần null; id lạ → 404", async () => {
    const res = await post("/api/context-sinh/xem-truoc", {});
    const j = (await res.json()).du_lieu;
    expect(j.thuong_hieu).toBeNull();
    expect(j.doi_tuong).toBeNull();

    const loi = await post("/api/context-sinh/xem-truoc", { doi_tuong_id: "khong-co" });
    expect(loi.status).toBe(404);
  });

  test("xem trước không ghi DB", async () => {
    const truoc = (
      app.db.query("SELECT COUNT(*) AS c FROM context_sinh").get() as { c: number }
    ).c;
    await post("/api/context-sinh/xem-truoc", { doi_tuong_id: "seed-dt-moi" });
    const sau = (
      app.db.query("SELECT COUNT(*) AS c FROM context_sinh").get() as { c: number }
    ).c;
    expect(sau).toBe(truoc);
  });
});

describe("nội dung đã sinh giữ context đã dùng", () => {
  test("job sinh với hồ sơ → revision.context_sinh_id trỏ snapshot đúng", async () => {
    const res = await post("/api/job", {
      loai: "sinh_ban_the_hien",
      payload: {
        nguon_id: "seed-nguon-1",
        dinh_dang: "newsletter",
        thuong_hieu_id: "seed-th-creator",
        doi_tuong_id: "seed-dt-khong-chuyen",
      },
    });
    expect(res.status).toBe(201);
    const job = (await res.json()).du_lieu;
    expect(await choJobXong(app, job.id)).toBe("xong");

    const bths = await (await get("/api/ban-the-hien?nguon_id=seed-nguon-1")).json();
    const bth = bths.du_lieu.find((b: { dinh_dang: string }) => b.dinh_dang === "newsletter");
    const chiTiet = await (await get(`/api/ban-the-hien/${bth.id}`)).json();
    const rev = chiTiet.du_lieu.revisions[0];
    expect(rev.context_sinh_id).toBeTruthy();
    // Fixture ghi thông tin context vào nội dung
    expect(rev.noi_dung).toContain("Người đọc không chuyên");
    expect(rev.noi_dung).toContain("Creator solo");
    // Snapshot lưu đủ: revision id của hai hồ sơ tại thời điểm sinh
    const snapshot = JSON.parse(rev.context_sinh.snapshot);
    expect(snapshot.thuong_hieu.ho_so_id).toBe("seed-th-creator");
    expect(snapshot.doi_tuong.ho_so_id).toBe("seed-dt-khong-chuyen");
  });

  test("job thiếu hồ sơ tồn tại → 400 tại API", async () => {
    const res = await post("/api/job", {
      loai: "sinh_ban_the_hien",
      payload: { nguon_id: "seed-nguon-1", dinh_dang: "web", doi_tuong_id: "khong-co" },
    });
    expect(res.status).toBe(400);
  });
});

describe("seed fixture", () => {
  test("3 thương hiệu + 3 đối tượng, đánh dấu fixture + he_thong", () => {
    const th = app.db
      .query(
        "SELECT ten, la_fixture, nguon_du_lieu FROM ho_so_thuong_hieu WHERE la_fixture = 1 ORDER BY id",
      )
      .all() as { ten: string; la_fixture: number; nguon_du_lieu: string }[];
    expect(th.length).toBe(3);
    expect(th.every((t) => t.la_fixture === 1 && t.nguon_du_lieu === "he_thong")).toBe(true);

    const dt = app.db
      .query("SELECT ten FROM ho_so_doi_tuong WHERE la_fixture = 1 ORDER BY id")
      .all() as { ten: string }[];
    expect(dt.length).toBe(3);

    const tn = app.db
      .query(
        "SELECT COUNT(*) AS c FROM thuat_ngu WHERE thuong_hieu_id = 'seed-th-nxb-phuc-am' AND giu_nguyen = 1",
      )
      .get() as { c: number };
    expect(tn.c).toBe(4);
  });
});

// Đăng ký server cho toàn file.
import { beforeAll, afterAll } from "bun:test";
beforeAll(async () => {
  app = await taoServerTam();
  seed(app.db);
});
afterAll(async () => {
  await app.dong();
});
