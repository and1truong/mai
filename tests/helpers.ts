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

// Đưa một bản thể hiện qua vòng đời: nhap → cho_duyet → da_duyet với
// mong_doi_revision_id ghim head hiện tại (contract duyệt của #21).
export async function duyetBth(app: { url: string }, bthId: string) {
  const chiTiet = await (await fetch(`${app.url}/api/ban-the-hien/${bthId}`)).json();
  const head = chiTiet.du_lieu.head_revision_id;
  const gui = await fetch(`${app.url}/api/ban-the-hien/${bthId}/trang-thai`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ trang_thai: "cho_duyet" }),
  });
  const duyet = await fetch(`${app.url}/api/ban-the-hien/${bthId}/trang-thai`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ trang_thai: "da_duyet", mong_doi_revision_id: head }),
  });
  return { head, gui, duyet };
}
