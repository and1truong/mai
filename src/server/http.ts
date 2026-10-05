import { LoiApi } from "../loi.ts";

// Helper HTTP dùng chung: envelope thành công/lỗi, đọc JSON body.

export function ok(duLieu: unknown, status = 200): Response {
  return Response.json({ ok: true, du_lieu: duLieu }, { status });
}

export function loi(e: unknown): Response {
  if (e instanceof LoiApi) {
    return Response.json(
      { ok: false, loi: { ma: e.ma, thong_diep: e.message, chi_tiet: e.chiTiet ?? null } },
      { status: e.status },
    );
  }
  return Response.json(
    { ok: false, loi: { ma: "LOI_NOI_BO", thong_diep: "Lỗi nội bộ.", chi_tiet: null } },
    { status: 500 },
  );
}

// Giới hạn kích thước body cho mọi endpoint đọc body.
export const GIOI_HAN_BODY = 50 * 1024 * 1024;

function loiQuaLon(): LoiApi {
  return new LoiApi(413, "PAYLOAD_QUA_LON", `Body vượt giới hạn ${GIOI_HAN_BODY} byte.`);
}

export function kiemTraGioiHanBody(req: Request): void {
  const n = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(n) && n > GIOI_HAN_BODY) throw loiQuaLon();
}

// content-length có thể thiếu/giả (chunked) → kiểm lại kích thước thực sau khi đọc.
export function kiemTraByteDaDoc(soByte: number): void {
  if (soByte > GIOI_HAN_BODY) throw loiQuaLon();
}

export async function docBody(req: Request): Promise<Record<string, unknown>> {
  kiemTraGioiHanBody(req);
  const text = await req.text();
  kiemTraByteDaDoc(Buffer.byteLength(text));
  if (!text.trim()) return {};
  try {
    const body = JSON.parse(text) as unknown;
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      throw new LoiApi(400, "VALIDATION", "Body phải là một JSON object.");
    }
    return body as Record<string, unknown>;
  } catch (e) {
    if (e instanceof LoiApi) throw e;
    throw new LoiApi(400, "VALIDATION", "Body không phải JSON hợp lệ.");
  }
}
