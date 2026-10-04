// Helper dùng chung cho scripts: kiểm tra server MAI đang chạy.

export async function serverDangChay(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://localhost:${port}/api/health`, {
      signal: AbortSignal.timeout(1000),
    });
    if (!res.ok) return false;
    const j = (await res.json()) as { ok?: boolean };
    return j.ok === true;
  } catch {
    return false;
  }
}

// Từ chối chạy lệnh phá hoại (reset/restore) khi server đang sống.
export async function chanKhiServerChay(
  port: number,
  choPhep: boolean,
  tenLenh: string,
): Promise<void> {
  if (choPhep) return;
  if (await serverDangChay(port)) {
    console.error(`MAI đang chạy trên port ${port}.`);
    console.error(`Dừng server trước khi ${tenLenh}, hoặc thêm --chap-nhan để ép.`);
    process.exit(1);
  }
}
