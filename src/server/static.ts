import { existsSync, statSync } from "node:fs";
import { extname, join, normalize, resolve, sep } from "node:path";

// Phục vụ frontend đã build trong dist/client.
// Path không trùng file → fallback index.html (SPA/hash routing).

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".json": "application/json",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

export function phucVuTinh(distDir: string, pathname: string): Response | null {
  const goc = resolve(distDir);
  const anToan = normalize(pathname).replace(/^([/\\])+/, "");
  let tep = join(goc, anToan);
  if (!tep.startsWith(goc + sep) && tep !== goc) return null;
  if (!existsSync(tep) || statSync(tep).isDirectory()) {
    tep = join(goc, "index.html");
    if (!existsSync(tep)) return null;
  }
  const contentType = MIME[extname(tep)] ?? "application/octet-stream";
  return new Response(Bun.file(tep), { headers: { "content-type": contentType } });
}
