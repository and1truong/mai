import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer } from "../src/server/index.ts";

// Smoke/integration harness: server thật trên port ngẫu nhiên + thư mục data tạm.
export async function taoServerTam() {
  const dataDir = mkdtempSync(join(tmpdir(), "mai-test-"));
  const app = await startServer({ port: 0, dataDir, chuKyJobMs: 10 });
  return { ...app, dataDir };
}
