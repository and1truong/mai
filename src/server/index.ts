import { rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { taiCauHinh } from "../config.ts";
import { log } from "../log.ts";
import { layNhaCungCap } from "../modules/generation/index.ts";
import { khoiDongRunner } from "../modules/jobs/index.ts";
import { taoHandlers } from "../modules/jobs/handlers.ts";
import { taoApi } from "./api.ts";
import { chayMigration, moDb } from "./db.ts";
import { loi } from "./http.ts";
import { phucVuTinh } from "./static.ts";

// POC chạy local tin cậy với actor demo cố định. Access control instance: #16 (P1).
export const ACTOR_DEMO = "demo";

export type TuyChonServer = {
  port?: number;
  dataDir?: string;
  chuKyJobMs?: number;
  concurrencyJob?: number;
};

// Một process duy nhất: API + static frontend + job runner nền.
// Khi chạy `bun --hot` (MAI_HOT=1, do scripts/dev.ts đặt): dọn tài nguyên của
// lần chạy trước qua globalThis để không leak connection/interval/port.
const KHOA_CLEANUP = "__mai_cleanup__";

export async function startServer(tuyChon: TuyChonServer = {}) {
  const g = globalThis as Record<string, unknown>;
  if (Bun.env.MAI_HOT === "1" && typeof g[KHOA_CLEANUP] === "function") {
    try {
      await (g[KHOA_CLEANUP] as () => Promise<void>)();
    } catch (e) {
      log.warn("server.cleanup_loi", { loi: String(e) });
    }
    delete g[KHOA_CLEANUP];
  }

  const cauHinh = await taiCauHinh();
  const dataDir = resolve(tuyChon.dataDir ?? cauHinh.dataDir);
  const port = tuyChon.port ?? cauHinh.port;

  const db = moDb(dataDir);
  chayMigration(db);

  const provider = layNhaCungCap(cauHinh.ai.provider);
  const dungRunner = khoiDongRunner(db, taoHandlers(db, provider), {
    chuKyMs: tuyChon.chuKyJobMs ?? cauHinh.jobs.chuKyMs,
    concurrency: tuyChon.concurrencyJob ?? cauHinh.jobs.concurrency,
  });

  const api = taoApi({ db, dataDir, actor: ACTOR_DEMO, provider: provider.ten });
  const distDir = resolve(import.meta.dir, "../../dist/client");

  const server = Bun.serve({
    port,
    async fetch(req) {
      const url = new URL(req.url);
      const batDau = performance.now();
      let res: Response;
      if (url.pathname.startsWith("/api/")) {
        res = await api(req);
      } else {
        res =
          phucVuTinh(distDir, url.pathname) ??
          Response.json(
            {
              ok: false,
              loi: {
                ma: "CHUA_BUILD",
                thong_diep: "Chưa build frontend. Chạy: bun run build",
                chi_tiet: null,
              },
            },
            { status: 404 },
          );
      }
      log.info("http.request", {
        method: req.method,
        path: url.pathname,
        status: res.status,
        ms: Math.round(performance.now() - batDau),
      });
      return res;
    },
    error(e) {
      log.error("server.loi", { loi: String(e) });
      return loi(e);
    },
  });

  log.info("server.khoi_dong", { port: server.port, dataDir, provider: provider.ten });

  // Lockfile cho scripts (reset/restore) biết server nào đang giữ dataDir.
  const tepLock = join(dataDir, "mai.server.lock");
  writeFileSync(
    tepLock,
    JSON.stringify({ pid: process.pid, port: server.port, bat_dau_luc: new Date().toISOString() }),
  );

  const dong = async () => {
    await dungRunner();
    server.stop(true);
    db.close();
    rmSync(tepLock, { force: true });
  };
  if (Bun.env.MAI_HOT === "1") g[KHOA_CLEANUP] = dong;

  return {
    server,
    db,
    dataDir,
    url: `http://localhost:${server.port}`,
    dong,
  };
}

if (import.meta.main) {
  await startServer();
}
