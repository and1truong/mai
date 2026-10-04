import { existsSync } from "node:fs";
import { resolve } from "node:path";

// Cấu hình MAI: file mai.config.json (mẫu ở mai.config.example.json) + biến môi trường ghi đè.
// Thứ tự ưu tiên: biến môi trường > file config > mặc định.

export type CauHinh = {
  port: number;
  dataDir: string;
  ai: { provider: string };
};

const MAC_DINH: CauHinh = {
  port: 3000,
  dataDir: "./data",
  ai: { provider: "fixture" },
};

export async function taiCauHinh(env: Record<string, string | undefined> = Bun.env): Promise<CauHinh> {
  const duongDanFile = env.MAI_CONFIG ?? "./mai.config.json";
  let tuFile: Partial<CauHinh> = {};
  if (existsSync(duongDanFile)) {
    tuFile = (await Bun.file(duongDanFile).json()) as Partial<CauHinh>;
  }
  return {
    port: Number(env.PORT ?? tuFile.port ?? MAC_DINH.port),
    dataDir: resolve(env.MAI_DATA_DIR ?? tuFile.dataDir ?? MAC_DINH.dataDir),
    ai: {
      provider: env.MAI_AI_PROVIDER ?? tuFile.ai?.provider ?? MAC_DINH.ai.provider,
    },
  };
}
