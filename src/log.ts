// Log local có cấu trúc: mỗi dòng một JSON object.
// Convention: { ts, level, event, ...truong }. Key ascii snake_case. Không log secret.

type TruongLog = Record<string, unknown>;

function ghi(level: string, event: string, truong: TruongLog = {}): void {
  const dong = JSON.stringify({ ts: new Date().toISOString(), level, event, ...truong });
  if (level === "error") console.error(dong);
  else console.log(dong);
}

export const log = {
  info: (event: string, truong?: TruongLog) => ghi("info", event, truong),
  warn: (event: string, truong?: TruongLog) => ghi("warn", event, truong),
  error: (event: string, truong?: TruongLog) => ghi("error", event, truong),
};
