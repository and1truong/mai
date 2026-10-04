import { existsSync } from "node:fs";
import { resolve } from "node:path";

// Cấu hình MAI: file mai.config.json (mẫu ở mai.config.example.json) + biến môi trường ghi đè.
// Thứ tự ưu tiên: biến môi trường > file config > mặc định.

export type CauHinhAi = {
  provider: string; // 'fixture' | 'openai' — adapter live cấu hình được (#20)
  base_url?: string; // endpoint OpenAI-compatible, mặc định https://api.openai.com/v1
  model?: string; // mặc định 'gpt-4o-mini'
  api_key_env?: string; // TÊN biến môi trường chứa key (mặc định MAI_AI_API_KEY) — config không giữ key
  timeout_ms?: number; // timeout một lần gọi provider, mặc định 60_000
  toi_da_ky_tu_nguon?: number; // mỗi nguồn đưa vào context, mặc định 4000
  toi_da_ky_tu_context?: number; // tổng ký tự context, mặc định 16000
  toi_da_ky_tu_dau_ra?: number; // trần nội dung sinh ra, mặc định 12000
  toi_da_fan_out?: number; // số đích/biến thể tối đa một request sinh, mặc định 8
  gia_moi_1k_token_vao?: number; // USD/1k token — chỉ ước tính khi cấu hình tường minh
  gia_moi_1k_token_ra?: number;
};

export type CauHinh = {
  port: number;
  dataDir: string;
  ai: CauHinhAi;
  jobs: { concurrency: number; chuKyMs: number };
};

const MAC_DINH: CauHinh = {
  port: 3000,
  dataDir: "./data",
  ai: { provider: "fixture" },
  jobs: { concurrency: 2, chuKyMs: 500 },
};

function soTuyChon(v: unknown): number | undefined {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

export async function taiCauHinh(env: Record<string, string | undefined> = Bun.env): Promise<CauHinh> {
  const duongDanFile = env.MAI_CONFIG ?? "./mai.config.json";
  let tuFile: Partial<CauHinh> = {};
  if (existsSync(duongDanFile)) {
    tuFile = (await Bun.file(duongDanFile).json()) as Partial<CauHinh>;
  }
  const f = (tuFile.ai ?? {}) as CauHinhAi;
  return {
    port: Number(env.PORT ?? tuFile.port ?? MAC_DINH.port),
    dataDir: resolve(env.MAI_DATA_DIR ?? tuFile.dataDir ?? MAC_DINH.dataDir),
    ai: {
      provider: env.MAI_AI_PROVIDER ?? f.provider ?? MAC_DINH.ai.provider,
      base_url: env.MAI_AI_BASE_URL ?? f.base_url,
      model: env.MAI_AI_MODEL ?? f.model,
      api_key_env: env.MAI_AI_API_KEY_ENV ?? f.api_key_env,
      timeout_ms: soTuyChon(env.MAI_AI_TIMEOUT_MS ?? f.timeout_ms),
      toi_da_ky_tu_nguon: soTuyChon(env.MAI_AI_TOI_DA_KY_TU_NGUON ?? f.toi_da_ky_tu_nguon),
      toi_da_ky_tu_context: soTuyChon(env.MAI_AI_TOI_DA_KY_TU_CONTEXT ?? f.toi_da_ky_tu_context),
      toi_da_ky_tu_dau_ra: soTuyChon(env.MAI_AI_TOI_DA_KY_TU_DAU_RA ?? f.toi_da_ky_tu_dau_ra),
      toi_da_fan_out: soTuyChon(env.MAI_AI_TOI_DA_FAN_OUT ?? f.toi_da_fan_out),
      gia_moi_1k_token_vao: soTuyChon(f.gia_moi_1k_token_vao),
      gia_moi_1k_token_ra: soTuyChon(f.gia_moi_1k_token_ra),
    },
    jobs: {
      concurrency: Math.max(
        1,
        Number(env.MAI_JOB_CONCURRENCY ?? tuFile.jobs?.concurrency ?? MAC_DINH.jobs.concurrency),
      ),
      chuKyMs: Math.max(
        10,
        Number(env.MAI_JOB_CHU_KY_MS ?? tuFile.jobs?.chuKyMs ?? MAC_DINH.jobs.chuKyMs),
      ),
    },
  };
}
