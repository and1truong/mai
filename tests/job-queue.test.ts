import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import {
  danhSachJob,
  enqueueJob,
  huyJob,
  khoiDongRunner,
  layJob,
  nhatKyJob,
  thuLaiJob,
  LoiVinhVien,
  type JobHandler,
} from "../src/modules/jobs/index.ts";
import { chayMigration, moDb } from "../src/server/db.ts";
import { seed } from "../src/server/seed.ts";
import { taoServerTam } from "./helpers.ts";

// Test đường lỗi dùng handler giả + SQLite tạm — không cần credential provider.

const dungRunner: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (dungRunner.length) await dungRunner.pop()!();
});

function moDbTam(coSeed = false) {
  const dir = mkdtempSync(join(tmpdir(), "mai-job-"));
  const db = moDb(dir);
  chayMigration(db);
  if (coSeed) seed(db);
  return { db, dir };
}

async function choTrangThai(
  db: ReturnType<typeof moDbTam>["db"],
  id: string,
  den: string[],
  ms = 5000,
): Promise<string> {
  const batDau = Date.now();
  while (Date.now() - batDau < ms) {
    const j = layJob(db, id);
    if (j && den.includes(j.trang_thai)) return j.trang_thai;
    await Bun.sleep(15);
  }
  return layJob(db, id)?.trang_thai ?? "khong_thay";
}

function runner(db: ReturnType<typeof moDbTam>["db"], handlers: Record<string, JobHandler>, tuyChon = {}) {
  const dung = khoiDongRunner(db, handlers, {
    chuKyMs: 10,
    backoffCoSoMs: 5,
    backoffToiDaMs: 50,
    ...tuyChon,
  });
  dungRunner.push(dung);
  return dung;
}

describe("enqueue idempotent", () => {
  test("cùng khoa_idem → đúng một job logic", () => {
    const { db } = moDbTam();
    const a = enqueueJob(db, { loai: "gia", khoaIdem: "k1" });
    const b = enqueueJob(db, { loai: "gia", khoaIdem: "k1" });
    expect(a.da_tao).toBe(true);
    expect(b.da_tao).toBe(false);
    expect(b.job.id).toBe(a.job.id);
    expect(danhSachJob(db).length).toBe(1);
    db.close();
  });

  test("khóa derive: cùng input → cùng job; payload khác → job khác", () => {
    const { db } = moDbTam();
    const a = enqueueJob(db, { loai: "gia", payload: { x: 1 } });
    const b = enqueueJob(db, { loai: "gia", payload: { x: 1 } });
    const c = enqueueJob(db, { loai: "gia", payload: { x: 2 } });
    expect(b.da_tao).toBe(false);
    expect(b.job.id).toBe(a.job.id);
    expect(c.job.id).not.toBe(a.job.id);
    expect(danhSachJob(db).length).toBe(2);
    db.close();
  });

  test("enqueue sau 'xong' → reset về 'cho', chạy lại đúng một job logic", async () => {
    const { db } = moDbTam();
    let goi = 0;
    runner(db, {
      gia: async () => {
        goi++;
        return { lan: goi };
      },
    });
    const a = enqueueJob(db, { loai: "gia", khoaIdem: "k-ket-thuc" });
    expect(await choTrangThai(db, a.job.id, ["xong"])).toBe("xong");
    expect(goi).toBe(1);

    const b = enqueueJob(db, { loai: "gia", khoaIdem: "k-ket-thuc" });
    expect(b.da_tao).toBe(true);
    expect(b.job.id).toBe(a.job.id); // cùng một job logic, không dòng mới
    expect(danhSachJob(db).length).toBe(1);
    expect(await choTrangThai(db, a.job.id, ["xong"])).toBe("xong");
    expect(goi).toBe(2);
    const suKien = nhatKyJob(db, a.job.id).map((d) => d.su_kien);
    expect(suKien).toContain("enqueue_lai");
    db.close();
  });

  test("hủy job 'cho' rồi enqueue lại cùng khóa → khôi phục và chạy", async () => {
    const { db } = moDbTam();
    let goi = 0;
    runner(db, {
      gia: async () => {
        goi++;
        return {};
      },
    });
    const a = enqueueJob(db, {
      loai: "gia",
      khoaIdem: "k-huy-roi-lai",
      chaySomNhat: new Date(Date.now() + 60_000).toISOString(),
    });
    expect(huyJob(db, a.job.id).trang_thai).toBe("huy");

    const b = enqueueJob(db, { loai: "gia", khoaIdem: "k-huy-roi-lai" });
    expect(b.da_tao).toBe(true);
    expect(b.job.id).toBe(a.job.id);
    expect(b.job.trang_thai).toBe("cho");
    expect(await choTrangThai(db, a.job.id, ["xong"])).toBe("xong");
    expect(goi).toBe(1);
    db.close();
  });
});

describe("retry + backoff + timeout", () => {
  test("lỗi tạm retry trong giới hạn rồi xong", async () => {
    const { db } = moDbTam();
    let goi = 0;
    runner(db, {
      gia: async () => {
        goi++;
        if (goi < 2) throw new Error("lỗi tạm");
        return { lan: goi };
      },
    });
    const { job } = enqueueJob(db, { loai: "gia", khoaIdem: "retry-tam" });
    expect(await choTrangThai(db, job.id, ["xong", "loi"])).toBe("xong");
    const j = layJob(db, job.id)!;
    expect(j.so_lan_thu).toBe(2);
    expect(JSON.parse(j.ket_qua!)).toEqual({ lan: 2 });
    expect(j.loi).toBeNull(); // job 'xong' không còn hiển thị lỗi attempt trước
    // Attempt đầu thất bại phải có lịch retry (backoff) trong nhật ký.
    const suKien = nhatKyJob(db, job.id).map((d) => d.su_kien);
    expect(suKien).toContain("that_bai_se_thu_lai");
    db.close();
  });

  test("lỗi vĩnh viễn → 'loi' ngay, không retry; retry thủ công chạy lại", async () => {
    const { db } = moDbTam();
    let goi = 0;
    runner(db, {
      gia: async () => {
        goi++;
        throw new LoiVinhVien("lỗi vĩnh viễn");
      },
    });
    const { job } = enqueueJob(db, { loai: "gia", khoaIdem: "loi-vv" });
    expect(await choTrangThai(db, job.id, ["loi"])).toBe("loi");
    let j = layJob(db, job.id)!;
    expect(j.so_lan_thu).toBe(1);
    expect(j.loi_vinh_vien).toBe(1);
    expect(goi).toBe(1);

    const moi = thuLaiJob(db, job.id);
    expect(moi.trang_thai).toBe("cho");
    expect(moi.so_lan_thu).toBe(0);
    expect(await choTrangThai(db, job.id, ["loi"])).toBe("loi");
    expect(goi).toBe(2);
    db.close();
  });

  test("hết lượt retry → 'loi' không vĩnh viễn", async () => {
    const { db } = moDbTam();
    let goi = 0;
    runner(db, {
      gia: async () => {
        goi++;
        throw new Error("luôn lỗi");
      },
    });
    const { job } = enqueueJob(db, { loai: "gia", khoaIdem: "het-luot", soLanThuToiDa: 2 });
    expect(await choTrangThai(db, job.id, ["loi"])).toBe("loi");
    const j = layJob(db, job.id)!;
    expect(j.so_lan_thu).toBe(2);
    expect(j.loi_vinh_vien).toBe(0);
    expect(goi).toBe(2);
    db.close();
  });

  test("attempt vượt timeout_ms → thất bại rồi retry trong giới hạn", async () => {
    const { db } = moDbTam();
    let goi = 0;
    runner(db, {
      gia: async () => {
        goi++;
        await Bun.sleep(500);
        return {};
      },
    });
    const { job } = enqueueJob(db, {
      loai: "gia",
      khoaIdem: "timeout-1",
      timeoutMs: 50,
      soLanThuToiDa: 2,
    });
    expect(await choTrangThai(db, job.id, ["loi"])).toBe("loi");
    const j = layJob(db, job.id)!;
    expect(j.so_lan_thu).toBe(2);
    expect(j.loi).toContain("timeout");
    db.close();
  });

  test("attempt quá timeout: ctx.assertConHan chặn zombie ghi side-effect", async () => {
    const { db } = moDbTam();
    let ghiSideEffect = 0;
    runner(db, {
      gia: async (_payload, ctx) => {
        await Bun.sleep(150); // quá timeout 50ms → job đã 'loi'
        ctx.assertConHan(); // phải ném — zombie không được ghi side-effect
        ghiSideEffect++;
        ctx.db
          .query("INSERT INTO job_log (job_id, ts, su_kien) VALUES (?, ?, 'side_effect_ma')")
          .run(ctx.job.id, new Date().toISOString());
        return {};
      },
    });
    const { job } = enqueueJob(db, {
      loai: "gia",
      khoaIdem: "zombie-1",
      timeoutMs: 50,
      soLanThuToiDa: 1,
    });
    expect(await choTrangThai(db, job.id, ["loi"])).toBe("loi");
    await Bun.sleep(250); // chờ zombie chạy hết đường
    expect(ghiSideEffect).toBe(0);
    const suKien = nhatKyJob(db, job.id).map((d) => d.su_kien);
    expect(suKien).not.toContain("side_effect_ma");
    expect(suKien).toContain("zombie_loi_muon");
    db.close();
  });
});

describe("lên lịch + hủy", () => {
  test("job lên lịch không chạy trước hạn và tồn tại qua restart runner", async () => {
    const { db } = moDbTam();
    let goi = 0;
    const handlers = {
      gia: async () => {
        goi++;
        return {};
      },
    };
    const som = new Date(Date.now() + 200).toISOString();
    const { job } = enqueueJob(db, {
      loai: "gia",
      khoaIdem: "lich-1",
      chaySomNhat: som,
      muiGio: "Asia/Ho_Chi_Minh",
    });
    const dung1 = runner(db, handlers);
    await Bun.sleep(80); // chưa tới hạn → vẫn chờ
    expect(layJob(db, job.id)!.trang_thai).toBe("cho");
    expect(goi).toBe(0);

    // "Restart": dừng runner, chạy runner mới trên cùng db → job lên lịch còn nguyên.
    await dung1();
    dungRunner.pop();
    expect(layJob(db, job.id)!.trang_thai).toBe("cho");

    runner(db, handlers);
    expect(await choTrangThai(db, job.id, ["xong"])).toBe("xong");
    const j = layJob(db, job.id)!;
    expect(goi).toBe(1);
    expect(j.mui_gio).toBe("Asia/Ho_Chi_Minh");
    expect(Date.parse(j.chay_luc!)).toBeGreaterThanOrEqual(Date.parse(som) - 20);
    db.close();
  });

  test("hủy job đang xếp → không thực thi", async () => {
    const { db } = moDbTam();
    let goi = 0;
    runner(db, {
      gia: async () => {
        goi++;
        return {};
      },
    });
    const { job } = enqueueJob(db, {
      loai: "gia",
      khoaIdem: "huy-cho",
      chaySomNhat: new Date(Date.now() + 60).toISOString(),
    });
    const huy = huyJob(db, job.id);
    expect(huy.trang_thai).toBe("huy");
    await Bun.sleep(150); // qua hạn lên lịch → vẫn không chạy
    expect(layJob(db, job.id)!.trang_thai).toBe("huy");
    expect(goi).toBe(0);
    db.close();
  });

  test("hủy job đang chạy → kết quả trễ bị bỏ, không thành active", async () => {
    const { db } = moDbTam();
    let release: () => void = () => {};
    const chan = new Promise<void>((r) => {
      release = r;
    });
    runner(db, {
      gia: async () => {
        await chan;
        return { tre: 1 };
      },
    });
    const { job } = enqueueJob(db, { loai: "gia", khoaIdem: "huy-chay", timeoutMs: 5000 });
    expect(await choTrangThai(db, job.id, ["dang_chay"])).toBe("dang_chay");
    expect(huyJob(db, job.id).trang_thai).toBe("huy");
    release();
    await Bun.sleep(100);
    const j = layJob(db, job.id)!;
    expect(j.trang_thai).toBe("huy");
    expect(j.ket_qua).toBeNull();
    expect(nhatKyJob(db, job.id).some((d) => d.su_kien === "ket_qua_bo_qua")).toBe(true);
    db.close();
  });
});

describe("recovery sau restart", () => {
  test("attempt 'dang_chay' hết lease được thu hồi và chạy lại đúng một lần", async () => {
    const { db } = moDbTam();
    db.query(
      `INSERT INTO job (id, loai, trang_thai, khoa_idem, payload, so_lan_thu, lease_den, tao_luc)
       VALUES ('cr-1', 'gia', 'dang_chay', 'cr-1', '{}', 1, ?, ?)`,
    ).run(new Date(Date.now() - 60_000).toISOString(), new Date().toISOString());
    let goi = 0;
    runner(db, {
      gia: async () => {
        goi++;
        return { phuc_hoi: true };
      },
    });
    expect(await choTrangThai(db, "cr-1", ["xong"])).toBe("xong");
    expect(goi).toBe(1);
    const j = layJob(db, "cr-1")!;
    expect(j.so_lan_thu).toBe(2);
    const suKien = nhatKyJob(db, "cr-1").map((d) => d.su_kien);
    expect(suKien).toContain("thu_hoi_lease");
    db.close();
  });
});

describe("API job", () => {
  async function post(app: Awaited<ReturnType<typeof taoServerTam>>, path: string, body: unknown) {
    return fetch(`${app.url}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  test("enqueue sinh_ban_the_hien: nguyên tử, dedupe khi sống, reset sau hủy", async () => {
    const app = await taoServerTam();
    try {
      seed(app.db);
      // Lên lịch xa để job ở 'cho' — tránh race với runner trong test.
      const res = await post(app, "/api/job", {
        loai: "sinh_ban_the_hien",
        payload: { thong_diep_id: "seed-td-1", dinh_dang: "caption" },
        chay_som_nhat: new Date(Date.now() + 60_000).toISOString(),
      });
      expect(res.status).toBe(201);
      const { du_lieu: job } = await res.json();
      expect(job.da_tao).toBe(true);
      expect(job.entity_loai).toBe("ban_the_hien");
      expect(job.entity_id).toBeTruthy();
      // Bản thể hiện đã được tạo trong cùng request (nguyên tử).
      const bth = await (await fetch(`${app.url}/api/ban-the-hien/${job.entity_id}`)).json();
      expect(bth.du_lieu.id).toBe(job.entity_id);

      // Enqueue lặp trong khi job còn sống → cùng job logic, không tạo thêm.
      const res2 = await post(app, "/api/job", {
        loai: "sinh_ban_the_hien",
        payload: { thong_diep_id: "seed-td-1", dinh_dang: "caption" },
      });
      expect(res2.status).toBe(200);
      const job2 = (await res2.json()).du_lieu;
      expect(job2.id).toBe(job.id);
      expect(job2.da_tao).toBe(false);

      // Hủy rồi enqueue lại → cùng job logic được reset, không bị khóa vĩnh viễn.
      const huy = await post(app, `/api/job/${job.id}/huy`, {});
      expect(huy.status).toBe(200);
      const res3 = await post(app, "/api/job", {
        loai: "sinh_ban_the_hien",
        payload: { thong_diep_id: "seed-td-1", dinh_dang: "caption" },
      });
      expect(res3.status).toBe(201);
      const job3 = (await res3.json()).du_lieu;
      expect(job3.id).toBe(job.id);
      expect(job3.da_tao).toBe(true);

      const chiTiet = await (await fetch(`${app.url}/api/job/${job.id}`)).json();
      const suKien = (chiTiet.du_lieu.nhat_ky as { su_kien: string }[]).map((d) => d.su_kien);
      expect(suKien).toContain("enqueue");
      expect(suKien).toContain("enqueue_lai");
    } finally {
      await app.dong();
    }
  });

  test("revision đích đổi trong lúc xếp → 'loi' vĩnh viễn; thu-lai ghim head mới → xong", async () => {
    const app = await taoServerTam();
    try {
      seed(app.db);
      // Enqueue có lên lịch ngắn → head còn thời gian trôi trước khi attempt chạy.
      // doi_tuong "chung" khớp danh tính của seed-bth-1 → job ghim đúng bản đó.
      const res = await post(app, "/api/job", {
        loai: "sinh_ban_the_hien",
        payload: { thong_diep_id: "seed-td-1", dinh_dang: "bai-viet", doi_tuong: "chung" },
        chay_som_nhat: new Date(Date.now() + 300).toISOString(),
        mui_gio: "Asia/Ho_Chi_Minh",
      });
      expect(res.status).toBe(201);
      const { du_lieu: job } = await res.json();
      const head = (
        await (await fetch(`${app.url}/api/ban-the-hien/seed-bth-1`)).json()
      ).du_lieu.head_revision_id;
      expect(job.entity_id).toBe("seed-bth-1");
      expect(job.revision_id).toBe(head);

      // Head trôi trước khi job chạy.
      const rev = await post(app, "/api/ban-the-hien/seed-bth-1/revision", {
        noi_dung: "rev chen ngang",
        dua_tren_revision_id: head,
      });
      expect(rev.status).toBe(201);

      let j: { trang_thai: string; loi_vinh_vien: number } | null = null;
      for (let i = 0; i < 200; i++) {
        const ds = await (await fetch(`${app.url}/api/job/${job.id}`)).json();
        j = ds.du_lieu;
        if (j!.trang_thai === "loi" || j!.trang_thai === "xong") break;
        await Bun.sleep(30);
      }
      expect(j!.trang_thai).toBe("loi");
      expect(j!.loi_vinh_vien).toBe(1);

      // Retry thủ công: ghim head mới rồi chạy lại → xong.
      const retry = await post(app, `/api/job/${job.id}/thu-lai`, {});
      expect(retry.status).toBe(200);
      for (let i = 0; i < 200; i++) {
        const ds = await (await fetch(`${app.url}/api/job/${job.id}`)).json();
        if (["loi", "xong"].includes(ds.du_lieu.trang_thai)) {
          j = ds.du_lieu;
          break;
        }
        await Bun.sleep(30);
      }
      expect(j!.trang_thai).toBe("xong");
    } finally {
      await app.dong();
    }
  });

  test("lỗi chuyển trạng thái: hủy job xong → 409; retry job chờ → 409", async () => {
    const app = await taoServerTam();
    try {
      seed(app.db);
      const res = await post(app, "/api/job", {
        loai: "sinh_ban_the_hien",
        payload: { thong_diep_id: "seed-td-1", dinh_dang: "bai-viet" },
      });
      const { du_lieu: job } = await res.json();
      // Chờ job xong.
      for (let i = 0; i < 200; i++) {
        const ds = await (await fetch(`${app.url}/api/job/${job.id}`)).json();
        if (ds.du_lieu.trang_thai === "xong") break;
        await Bun.sleep(30);
      }
      const huy = await post(app, `/api/job/${job.id}/huy`, {});
      expect(huy.status).toBe(409);
      expect((await huy.json()).loi.ma).toBe("XUNG_DOT_JOB");

      // Job 'cho' không retry được.
      const res2 = await post(app, "/api/job", {
        loai: "sinh_ban_the_hien",
        payload: { thong_diep_id: "seed-td-1", dinh_dang: "newsletter" },
        chay_som_nhat: new Date(Date.now() + 60_000).toISOString(),
      });
      const { du_lieu: job2 } = await res2.json();
      const retry = await post(app, `/api/job/${job2.id}/thu-lai`, {});
      expect(retry.status).toBe(409);
      // Hủy job đang xếp được.
      const huyOk = await post(app, `/api/job/${job2.id}/huy`, {});
      expect(huyOk.status).toBe(200);
      expect((await huyOk.json()).du_lieu.trang_thai).toBe("huy");
    } finally {
      await app.dong();
    }
  });

  test("validation trường mới: chay_som_nhat/mui_gio/timeout_ms sai → 400", async () => {
    const app = await taoServerTam();
    try {
      seed(app.db);
      const gui = (extra: Record<string, unknown>) =>
        post(app, "/api/job", {
          loai: "sinh_ban_the_hien",
          payload: { thong_diep_id: "seed-td-1", dinh_dang: "bai-viet" },
          ...extra,
        });
      expect((await gui({ chay_som_nhat: "khong-phai-ngay" })).status).toBe(400);
      expect((await gui({ mui_gio: "Khong/Ton_Tai" })).status).toBe(400);
      expect((await gui({ timeout_ms: 1 })).status).toBe(400);
      expect((await gui({ so_lan_thu_toi_da: 0 })).status).toBe(400);
    } finally {
      await app.dong();
    }
  });
});
