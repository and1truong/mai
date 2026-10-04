import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chayMigration, moDb } from "../src/server/db.ts";
import { startServer } from "../src/server/index.ts";
import { seed } from "../src/server/seed.ts";
import { chonDauRa } from "../src/modules/luong/index.ts";
import { taoDoiTuong } from "../src/modules/context/index.ts";
import { LoiApi } from "../src/loi.ts";
import {
  capNhatThongDiep,
  layBanTheHien,
  layNhapSoan,
  layThongDiep,
  luuNhapSoan,
  themRevision,
} from "../src/modules/content/index.ts";

// Test story #6: seed retry amplification, mọi đầu ra dưới một thông điệp,
// trang /p do MAI phục vụ, cờ "đã cũ" khi sửa thông điệp, nháp tay không
// mất, và chonDauRa tách ba script-ngan bằng đích đến.

type App = Awaited<ReturnType<typeof startServer>>;

async function getJson(app: App, path: string) {
  return (await fetch(`${app.url}${path}`)).json();
}

function moDbTam() {
  const dataDir = mkdtempSync(join(tmpdir(), "mai-test-"));
  const db = moDb(dataDir);
  chayMigration(db);
  return { db, dataDir };
}

// Server trên dataDir đã seed sẵn (server mở lại cùng file db).
async function taoServerDaSeed() {
  const { db, dataDir } = moDbTam();
  seed(db);
  db.close();
  const app = await startServer({ port: 0, dataDir, chuKyJobMs: 10 });
  return app;
}

function revNoiDung(db: ReturnType<typeof moDb>, bthId: string): string {
  const b = layBanTheHien(db, bthId)!;
  const r = db
    .query("SELECT noi_dung FROM revision WHERE id = ?")
    .get(b.head_revision_id) as { noi_dung: string } | null;
  return r?.noi_dung ?? "";
}

describe("Story #6 — creator solo: phân phối ý tưởng kỹ thuật", () => {
  test("seed: thông điệp retry có 8 đầu ra, phân hóa đối tượng, không bịa số liệu", () => {
    const { db } = moDbTam();
    seed(db);
    try {
      const td = layThongDiep(db, "seed-td-retry");
      expect(td).toBeTruthy();

      const dsBth = db
        .query("SELECT * FROM ban_the_hien WHERE thong_diep_id = 'seed-td-retry'")
        .all() as { id: string; dinh_dang: string; dich_den: string }[];
      expect(dsBth.length).toBe(8);
      const theoDd = (dd: string) => dsBth.filter((b) => b.dinh_dang === dd);
      expect(theoDd("bai-viet").length).toBe(1);
      expect(theoDd("newsletter").length).toBe(1);
      expect(theoDd("caption").length).toBe(1);
      expect(theoDd("thread").length).toBe(1);
      expect(theoDd("script-dai").length).toBe(1);
      // Ba script video ngắn phân biệt bằng đích đến, không gộp nhau.
      const ngan = theoDd("script-ngan");
      expect(ngan.length).toBe(3);
      expect(new Set(ngan.map((b) => b.dich_den)).size).toBe(3);

      // Bản kỹ sư giải thích cơ chế; bản lãnh đạo nói tác động vận hành.
      expect(revNoiDung(db, "seed-bth-retry-bai-viet")).toContain("khuếch đại");
      expect(revNoiDung(db, "seed-bth-retry-linkedin")).toContain("vận hành");
      // Newsletter có lời mở cá nhân là placeholder — người viết tự sửa,
      // hệ thống không bịa trải nghiệm.
      expect(revNoiDung(db, "seed-bth-retry-newsletter")).toContain("Lời mở cá nhân");
      // Script dài đủ hook/lời thoại/cảnh/cta theo schema định dạng.
      const yt = JSON.parse(revNoiDung(db, "seed-bth-retry-youtube"));
      expect(yt.hook).toBeTruthy();
      expect(yt.loi_thoai.length).toBeGreaterThan(500);
      expect(yt.canh.length).toBeGreaterThanOrEqual(2);
      expect(yt.cta).toBeTruthy();

      // Không bịa số liệu sự cố: mọi đầu ra không chứa claim % sự cố/downtime.
      for (const b of dsBth) {
        expect(revNoiDung(db, b.id)).not.toMatch(/\d+%\s*(sự cố|downtime|uptime)/i);
      }

      // LinkedIn đã xuất: record xuat_ban tồn tại, trạng thái vẫn da_duyet —
      // "đã xuất" (file/trang nội bộ) không phải "đã đăng" (lên mạng ngoài).
      const lk = layBanTheHien(db, "seed-bth-retry-linkedin")!;
      expect(lk.trang_thai).toBe("da_duyet");
      const soXb = db
        .query("SELECT COUNT(*) AS c FROM xuat_ban WHERE ban_the_hien_id = 'seed-bth-retry-linkedin'")
        .get() as { c: number };
      expect(soXb.c).toBe(1);
    } finally {
      db.close();
    }
  });

  test("GET /api/thong-diep/:id — mọi đầu ra một chỗ, kèm nhãn + link trang", async () => {
    const app = await taoServerDaSeed();
    try {
      const res = await getJson(app, "/api/thong-diep/seed-td-retry");
      expect(res.ok).toBe(true);
      const ds = res.du_lieu.ds_dau_ra;
      expect(ds.length).toBe(8);
      for (const b of ds) {
        expect(b.dinh_dang_nhan).toBeTruthy();
        expect(b.trang_thai).toBeTruthy();
        expect(b.nguon.length).toBeGreaterThan(0);
        expect(b.nguon[0].tieu_de).toContain("Retry amplification");
      }
      const baiViet = ds.find((b: { dinh_dang: string }) => b.dinh_dang === "bai-viet");
      expect(baiViet.so_xuat_ban).toBe(1);
      expect(baiViet.url_trang).toBe(`/p/${baiViet.id}`);
      expect(baiViet.trang_thai).toBe("da_duyet");
      const linkedin = ds.find((b: { dinh_dang: string }) => b.dinh_dang === "caption");
      expect(linkedin.so_xuat_ban).toBe(1);
      expect(linkedin.xuat_ban_moi_nhat.id).toBeTruthy();
      expect(linkedin.dich_den).toBe("linkedin");
      const newsletter = ds.find((b: { dinh_dang: string }) => b.dinh_dang === "newsletter");
      expect(newsletter.so_xuat_ban).toBe(0);
      expect(newsletter.url_trang).toBeNull();
      // Kế hoạch gắn lên thông điệp để client link ngược.
      expect(res.du_lieu.ke_hoach.trang_thai).toBe("da_chon");
    } finally {
      await app.dong();
    }
  });

  test("/p/<bth_id> — trang do MAI phục vụ ghim revision đã xuất; chưa xuất → 404", async () => {
    const app = await taoServerDaSeed();
    try {
      const res = await fetch(`${app.url}/p/seed-bth-retry-bai-viet`);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/html");
      const html = await res.text();
      expect(html).toContain("Retry amplification");
      expect(html).toContain("Trang do MAI phục vụ");

      const chuaXuat = await fetch(`${app.url}/p/seed-bth-retry-newsletter`);
      expect(chuaXuat.status).toBe(404);
      expect((await chuaXuat.json()).loi.ma).toBe("KHONG_TIM_THAY");
      expect((await fetch(`${app.url}/p/khong-co`)).status).toBe(404);

      // Revision mới đè lên bài viết → trang vẫn giữ revision đã xuất.
      const b = layBanTheHien(app.db, "seed-bth-retry-bai-viet")!;
      themRevision(
        app.db,
        {
          ban_the_hien_id: b.id,
          noi_dung: JSON.stringify({
            tieu_de: "BẢN CHƯA DUYỆT",
            noi_dung: "Nội dung chưa review.",
          }),
          dua_tren_revision_id: b.head_revision_id,
        },
        "demo",
      );
      const res2 = await fetch(`${app.url}/p/seed-bth-retry-bai-viet`);
      expect(res2.status).toBe(200);
      const html2 = await res2.text();
      expect(html2).toContain("Retry amplification");
      expect(html2).not.toContain("BẢN CHƯA DUYỆT");
    } finally {
      await app.dong();
    }
  });

  test("sửa thông điệp → đầu ra cờ 'đã cũ'; nháp tay LinkedIn giữ nguyên", async () => {
    const app = await taoServerDaSeed();
    try {
      // Người viết sửa nháp LinkedIn sau khi bản đã xuất.
      const lk = layBanTheHien(app.db, "seed-bth-retry-linkedin")!;
      luuNhapSoan(app.db, lk.id, "demo", {
        noi_dung: "NHAP TAY DA SUA",
        dua_tren_revision_id: lk.head_revision_id,
      });
      // Sửa phần giải thích chuẩn: revision thông điệp mới.
      const td = layThongDiep(app.db, "seed-td-retry")!;
      capNhatThongDiep(
        app.db,
        td.id,
        {
          tieu_de: td.tieu_de,
          noi_dung: `${td.noi_dung}\n\nBổ sung ví dụ hedged request.`,
          nguon_ids: ["seed-nguon-retry"],
        },
        td.head_revision_id!,
        "demo",
      );

      const res = await getJson(app, "/api/thong-diep/seed-td-retry");
      const ds = res.du_lieu.ds_dau_ra;
      // Mọi đầu ra ghim revision thông điệp cũ → báo "đã cũ", không âm
      // thầm đổi nội dung.
      expect(ds.every((b: { la_cu: boolean }) => b.la_cu === true)).toBe(true);
      const linkedin = ds.find(
        (b: { id: string }) => b.id === "seed-bth-retry-linkedin",
      );
      expect(linkedin.co_nhap).toBe(true);
      // Nháp tay không bị ghi đè.
      expect(layNhapSoan(app.db, "seed-bth-retry-linkedin", "demo")!.noi_dung).toBe(
        "NHAP TAY DA SUA",
      );
    } finally {
      await app.dong();
    }
  });

  test("POST /api/job — dich_den >120 bị từ chối cho payload chính và fan_out", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "mai-test-"));
    const db = moDb(dataDir);
    chayMigration(db);
    seed(db);
    db.close();
    const app = await startServer({ port: 0, dataDir, chuKyJobMs: 10 });
    try {
      const dai = "x".repeat(121);
      const post = (body: unknown) =>
        fetch(`${app.url}/api/job`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
      const chinh = await post({
        loai: "sinh_ban_the_hien",
        payload: { thong_diep_id: "seed-td-retry", dinh_dang: "script-ngan", dich_den: dai },
      });
      expect(chinh.status).toBe(400);
      expect((await chinh.json()).loi.ma).toBe("VALIDATION");
      const fanOut = await post({
        loai: "sinh_ban_the_hien",
        payload: {
          thong_diep_id: "seed-td-retry",
          dinh_dang: "script-ngan",
          fan_out: [{ dinh_dang: "script-ngan", dich_den: dai }],
        },
      });
      expect(fanOut.status).toBe(400);
      expect((await fanOut.json()).loi.ma).toBe("VALIDATION");
    } finally {
      await app.dong();
    }
  });

  test("chonDauRa: ba script-ngan ba đích → ba bản thể hiện riêng + validate dich_den", () => {
    const { db } = moDbTam();
    seed(db);
    try {
      const kq = chonDauRa(
        db,
        "seed-kh-retry",
        [
          { doi_tuong_id: null, dinh_dang: "script-ngan", dich_den: "tiktok-a" },
          { doi_tuong_id: null, dinh_dang: "script-ngan", dich_den: "tiktok-b" },
          { doi_tuong_id: null, dinh_dang: "script-ngan", dich_den: "tiktok-c" },
        ],
        "demo",
      );
      expect(new Set(kq.ds_bth.map((b) => b.id)).size).toBe(3);
      // Lựa chọn trùng đích bị lọc khỏi ds_chon.
      const kq2 = chonDauRa(
        db,
        "seed-kh-retry",
        [
          { doi_tuong_id: null, dinh_dang: "script-ngan", dich_den: "tiktok-a" },
          { doi_tuong_id: null, dinh_dang: "script-ngan", dich_den: "tiktok-a" },
        ],
        "demo",
      );
      expect(kq2.ds_bth.length).toBe(1);
      // dich_den không phải chuỗi → LoiApi VALIDATION (không phải TypeError → 500).
      let loi: unknown;
      try {
        chonDauRa(
          db,
          "seed-kh-retry",
          [{ doi_tuong_id: null, dinh_dang: "script-ngan", dich_den: 5 as never }],
          "demo",
        );
      } catch (e) {
        loi = e;
      }
      expect(loi).toBeInstanceOf(LoiApi);
      expect((loi as LoiApi).ma).toBe("VALIDATION");
    } finally {
      db.close();
    }
  });

  test("chonDauRa: khóa dedupe theo danh tính chuẩn hóa — không đếm thừa đầu ra", () => {
    const { db } = moDbTam();
    seed(db);
    try {
      // "vi" ngầm định vs "vi" tường minh → cùng một bản thể hiện.
      const kq = chonDauRa(
        db,
        "seed-kh-retry",
        [
          { doi_tuong_id: null, dinh_dang: "script-ngan", dich_den: "clip-x" },
          { doi_tuong_id: null, dinh_dang: "script-ngan", ngon_ngu: "vi", dich_den: "clip-x" },
        ],
        "demo",
      );
      expect(kq.ds_bth.length).toBe(1);
      expect(kq.ds_job.length).toBe(1);
      // Hai hồ sơ trùng tên → cùng một đầu ra (danh tính theo tên đã resolve).
      const dt2 = taoDoiTuong(db, { ten: "Kỹ sư (fixture)" }, "demo");
      const kq2 = chonDauRa(
        db,
        "seed-kh-retry",
        [
          { doi_tuong_id: "seed-dt-ky-su", dinh_dang: "script-ngan", dich_den: "clip-y" },
          { doi_tuong_id: dt2.id, dinh_dang: "script-ngan", dich_den: "clip-y" },
        ],
        "demo",
      );
      expect(kq2.ds_bth.length).toBe(1);
      expect(kq2.ds_job.length).toBe(1);
    } finally {
      db.close();
    }
  });
});
