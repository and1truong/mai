import { useEffect, useState } from "react";

// Client cho envelope API chuẩn: { ok, du_lieu | loi }.

export class LoiApiClient extends Error {
  constructor(
    public ma: string,
    message: string,
    public chiTiet?: unknown,
  ) {
    super(message);
    this.name = "LoiApiClient";
  }
}

export async function api<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  const j = (await res.json()) as {
    ok: boolean;
    du_lieu?: T;
    loi?: { ma: string; thong_diep: string; chi_tiet?: unknown };
  };
  if (!j.ok) {
    throw new LoiApiClient(
      j.loi?.ma ?? "LOI_KHONG_XAC_DINH",
      j.loi?.thong_diep ?? "Lỗi không xác định.",
      j.loi?.chi_tiet,
    );
  }
  return j.du_lieu as T;
}

export function useApi<T>(path: string | null, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(!!path);
  const [error, setError] = useState<LoiApiClient | null>(null);
  const [tick, setTick] = useState(0);
  const reload = () => setTick((t) => t + 1);

  useEffect(() => {
    if (!path) {
      setData(null);
      setLoading(false);
      setError(null);
      return;
    }
    let alive = true;
    setLoading(true);
    api<T>(path)
      .then((d) => {
        if (alive) {
          setData(d);
          setError(null);
        }
      })
      .catch((e) => {
        if (alive) {
          // Xóa data cũ khi lỗi — không xóa sẽ để data stale (vd GET /nhap
          // 404 sau khi nháp bị tiêu thụ vẫn trả nháp cũ).
          setData(null);
          setError(e instanceof LoiApiClient ? e : new LoiApiClient("LOI_MANG", String(e)));
        }
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, tick, ...deps]);

  return { data, loading, error, reload };
}

export function useHashRoute(): string {
  const doc = () => window.location.hash.replace(/^#/, "") || "/";
  const [path, setPath] = useState(doc);
  useEffect(() => {
    const fn = () => setPath(doc());
    window.addEventListener("hashchange", fn);
    return () => window.removeEventListener("hashchange", fn);
  }, []);
  return path;
}

export function fmtLuc(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("vi-VN");
}
