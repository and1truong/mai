import { resolve } from "node:path";
import { taiCauHinh } from "../config.ts";
import { log } from "../log.ts";
import { layNhaCungCap } from "../modules/generation/index.ts";
import { khoiDongRunner } from "../modules/jobs/index.ts";
import { taoHandlers } from "../modules/jobs/handlers.ts";
import { taoApi } from "./api.ts";
import { chayMigration, moDb } from "./db.ts";
import { phucVuTinh } from "./static.ts";

// POC chạy local tin cậy với actor demo cố định. Access control instance: #16 (P1).
export const ACTOR_DEMO = "demo";

export type TuyChonServer = {
  port?: number;
  dataDir?: string;
  chuKyJobMs?: number;
};

// Một process duy nhất: API + static frontend + job runner nền.
export async function startServer(tuyChon: TuyChonServer = {}) {
  const cauHinh = await taiCauHinh();
  const dataDir = resolve(tuyChon.dataDir ?? cauHinh.dataDir);
  const port = tuyChon.port ?? cauHinh.port;

  const db = moDb(dataDir);
  chayMigration(db);

  const provider = layNhaCungCap(cauHinh.ai.provider);
  const dungRunner = khoiDongRunner(db, taoHandlers(db, provider), tuyChon.chuKyJobMs ?? 500);

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
  });

  log.info("server.khoi_dong", { port: server.port, dataDir, provider: provider.ten });

  return {
    server,
    db,
    dataDir,
    url: `http://localhost:${server.port}`,
    async dong() {
      dungRunner();
      server.stop(true);
      db.close();
    },
  };
}

if (import.meta.main) {
  await startServer();
}
