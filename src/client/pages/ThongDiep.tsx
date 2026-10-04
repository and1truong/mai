import { Badge, Button, Callout, Card, Flex, Heading, Text } from "@radix-ui/themes";
import { useState } from "react";
import { api, fmtLuc, LoiApiClient, useApi, useHashRoute } from "../api.ts";
import { TrangThai } from "../components/TrangThai.tsx";
import type { BanTheHien, ThongDiep } from "../../modules/content/index.ts";

// Trang lan truyền một thông điệp (#6): mọi đầu ra dưới một thông điệp —
// nhãn định dạng/đối tượng/đích, trạng thái review, nháp tay, cờ "đã cũ",
// thao tác duyệt/xuất/copy/bundle/trang. URL: #/thong-diep?id=<uuid>.
// "Đã xuất" (đã có record xuat_ban — file/trang nội bộ) KHÔNG phải "đã
// đăng" (đã lên mạng xã hội) — MAI không đăng lên nền tảng ngoài.

type DauRa = BanTheHien & {
  dinh_dang_nhan: string;
  doi_tuong_id: string | null;
  head_revision_so: number | null;
  la_cu: boolean;
  co_nhap: boolean;
  so_xuat_ban: number;
  xuat_ban_moi_nhat: { id: string; dich_den: string; tao_luc: string } | null;
  url_trang: string | null;
  nguon: { id: string; nguon_id: string; tieu_de: string; so_thu_tu: number }[];
  // #7: định dạng gợi ý đính kèm asset (vd ảnh cho caption Instagram) +
  // asset hiện có — thiếu ảnh thì hiển thị ô yêu cầu/upload, không bịa.
  goi_y_asset: string | null;
  ds_asset: { id: string; ten_file: string; mime: string }[];
};

type FactKeHoach = {
  ngay_gio?: string;
  mui_gio?: string;
  gia?: string;
  tinh_trang?: string;
  link_dat_hang?: string;
};

type ChiTietTd = ThongDiep & {
  ds_nguon: { id: string; tieu_de: string }[];
  ke_hoach: { id: string; trang_thai: string; fact?: FactKeHoach | null } | null;
  ds_dau_ra: DauRa[];
};

type XemTruoc = { html: string; text: string; ds_loi: { truong: string; loi: string }[] };

const MAU_TRANG_THAI: Record<string, "gray" | "blue" | "green" | "red" | "orange"> = {
  nhap: "gray",
  cho_duyet: "blue",
  da_duyet: "green",
  tu_choi: "red",
  thay_the: "orange",
};

const NHAN_TRANG_THAI: Record<string, string> = {
  nhap: "Nháp",
  cho_duyet: "Chờ duyệt",
  da_duyet: "Đã duyệt",
  tu_choi: "Từ chối",
  thay_the: "Đã thay thế",
};

function TheDauRa({
  b,
  thongDiepId,
  reload,
}: {
  b: DauRa;
  thongDiepId: string;
  reload: () => void;
}) {
  const [dsLoi, setDsLoi] = useState<string[]>([]);
  const [xemTruoc, setXemTruoc] = useState<XemTruoc | null>(null);
  const [moXemTruoc, setMoXemTruoc] = useState(false);
  const [ghiChu, setGhiChu] = useState("");

  async function chay(fn: () => Promise<unknown>) {
    setDsLoi([]);
    setGhiChu("");
    try {
      await fn();
      reload();
    } catch (e) {
      setDsLoi([e instanceof LoiApiClient ? `${e.ma}: ${e.message}` : String(e)]);
    }
  }

  async function chuyenTt(den: string) {
    await chay(async () => {
      await api(`/api/ban-the-hien/${b.id}/trang-thai`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          trang_thai: den,
          ...(den === "da_duyet" ? { mong_doi_revision_id: b.head_revision_id } : {}),
        }),
      });
    });
  }

  async function copyText() {
    setDsLoi([]);
    setGhiChu("");
    try {
      const xt = xemTruoc ?? (await api<XemTruoc>(`/api/ban-the-hien/${b.id}/xem-truoc`));
      setXemTruoc(xt);
      await navigator.clipboard.writeText(xt.text);
      setGhiChu("Đã copy text.");
    } catch (e) {
      setDsLoi([e instanceof LoiApiClient ? `${e.ma}: ${e.message}` : String(e)]);
    }
  }

  async function toggleXemTruoc() {
    if (!moXemTruoc && !xemTruoc) {
      try {
        setXemTruoc(await api<XemTruoc>(`/api/ban-the-hien/${b.id}/xem-truoc`));
      } catch (e) {
        setDsLoi([e instanceof LoiApiClient ? `${e.ma}: ${e.message}` : String(e)]);
        return;
      }
    }
    setMoXemTruoc((v) => !v);
  }

  async function sinhLai() {
    await chay(async () => {
      await api("/api/job", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          loai: "sinh_ban_the_hien",
          payload: {
            thong_diep_id: thongDiepId,
            dinh_dang: b.dinh_dang,
            ngon_ngu: b.ngon_ngu,
            doi_tuong_id: b.doi_tuong_id ?? undefined,
            doi_tuong: b.doi_tuong || undefined,
            dich_den: b.dich_den || undefined,
          },
        }),
      });
      setGhiChu("Đã enqueue job sinh lại — revision mới đè lên head, nháp tay giữ nguyên.");
    });
  }

  return (
    <Card mb="3">
      <Flex direction="column" gap="2">
        <Flex align="center" gap="2" wrap="wrap">
          <Heading size="3">{b.dinh_dang_nhan}</Heading>
          <Badge variant="outline">{b.doi_tuong || "chung"}</Badge>
          {b.dich_den && <Badge color="cyan">{b.dich_den}</Badge>}
          <Badge>{b.ngon_ngu}</Badge>
          <Badge color={MAU_TRANG_THAI[b.trang_thai] ?? "gray"}>
            {NHAN_TRANG_THAI[b.trang_thai] ?? b.trang_thai}
          </Badge>
          {b.la_cu && <Badge color="amber">Đã cũ — nguồn/thông điệp đổi</Badge>}
          {b.co_nhap && <Badge variant="soft">Có nháp tay</Badge>}
          {b.so_xuat_ban > 0 && <Badge color="indigo">Đã xuất ×{b.so_xuat_ban}</Badge>}
          {/* #7: đầu ra có kênh đích là bản để đăng tay — MAI không tự
              đăng lên nền tảng ngoài. */}
          {b.dich_den && <Badge color="orange" variant="soft">Đăng tay</Badge>}
        </Flex>
        <Text size="1" color="gray">
          head {b.head_revision_so ? `#${b.head_revision_so}` : "—"}
          {b.nguon.length > 0 &&
            ` · nguồn: ${b.nguon.map((n) => `${n.tieu_de} (rev ${n.so_thu_tu})`).join(", ")}`}
          {b.xuat_ban_moi_nhat &&
            ` · xuất gần nhất: ${fmtLuc(b.xuat_ban_moi_nhat.tao_luc)}${b.xuat_ban_moi_nhat.dich_den ? ` → ${b.xuat_ban_moi_nhat.dich_den}` : ""}`}
        </Text>
        {dsLoi.map((l, i) => (
          <Callout.Root key={i} color="red" size="1">
            <Callout.Text>{l}</Callout.Text>
          </Callout.Root>
        ))}
        {ghiChu && (
          <Text size="1" color="green">
            {ghiChu}
          </Text>
        )}

        {/* #7: định dạng gợi ý asset mà chưa có → ô yêu cầu/upload; không
            bịa sẵn có ảnh. Asset đính kèm đi vào bundle xuất. */}
        {b.goi_y_asset && (
          <Flex align="center" gap="2" wrap="wrap">
            {b.ds_asset.length > 0 ? (
              <Text size="1" color="gray">
                Đính kèm: {b.ds_asset.map((a) => a.ten_file).join(", ")}
              </Text>
            ) : (
              <>
                <Text size="1" color="amber">
                  Cần {b.goi_y_asset} — chưa có ảnh đính kèm.
                </Text>
                <input
                  type="file"
                  aria-label={`Tải ${b.goi_y_asset}`}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    void chay(async () => {
                      const asset = await api<{ id: string }>(
                        `/api/assets?ten=${encodeURIComponent(f.name)}&khoa_idem=${encodeURIComponent(`tai-len:${b.id}:${f.name}`)}`,
                        { method: "POST", body: f },
                      );
                      await api(`/api/ban-the-hien/${b.id}/assets`, {
                        method: "PUT",
                        headers: { "content-type": "application/json" },
                        body: JSON.stringify({
                          asset_ids: [...b.ds_asset.map((a) => a.id), asset.id],
                        }),
                      });
                      setGhiChu(`Đã đính kèm ${f.name}.`);
                    });
                  }}
                />
              </>
            )}
          </Flex>
        )}

        <Flex gap="2" wrap="wrap" align="center">
          <Button size="1" variant="soft" asChild>
            <a href={`#/ban-the-hien?id=${b.id}`}>Mở editor</a>
          </Button>
          {b.trang_thai === "nhap" && (
            <Button size="1" onClick={() => void chuyenTt("cho_duyet")}>
              Gửi duyệt
            </Button>
          )}
          {b.trang_thai === "cho_duyet" && (
            <>
              <Button size="1" color="green" onClick={() => void chuyenTt("da_duyet")}>
                Duyệt
              </Button>
              <Button size="1" color="red" variant="soft" onClick={() => void chuyenTt("tu_choi")}>
                Từ chối
              </Button>
            </>
          )}
          {(b.trang_thai === "da_duyet" ||
            b.trang_thai === "tu_choi" ||
            b.trang_thai === "thay_the") && (
            <Button size="1" variant="soft" onClick={() => void chuyenTt("nhap")}>
              Mở lại nháp
            </Button>
          )}
          {b.trang_thai === "thay_the" && (
            <Button size="1" onClick={() => void chuyenTt("cho_duyet")}>
              Gửi duyệt bản mới
            </Button>
          )}
          {b.trang_thai === "da_duyet" && (
            <Button
              size="1"
              color="indigo"
              variant="soft"
              onClick={() =>
                void chay(async () => {
                  await api(`/api/ban-the-hien/${b.id}/xuat-ban`, {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({}),
                  });
                  setGhiChu("Đã xuất bản — tạo record mới ghim head revision.");
                })
              }
            >
              Xuất bản
            </Button>
          )}
          {b.xuat_ban_moi_nhat && (
            <Button size="1" variant="soft" asChild>
              <a href={`/api/ban-the-hien/${b.id}/xuat-ban/${b.xuat_ban_moi_nhat.id}/tai-ve`}>
                Tải bundle
              </a>
            </Button>
          )}
          {b.url_trang && (
            <Button size="1" variant="soft" color="green" asChild>
              <a href={b.url_trang} target="_blank" rel="noreferrer">
                Mở trang
              </a>
            </Button>
          )}
          <Button size="1" variant="soft" onClick={() => void copyText()}>
            Copy text
          </Button>
          <Button size="1" variant="soft" onClick={() => void toggleXemTruoc()}>
            {moXemTruoc ? "Đóng xem trước" : "Xem trước"}
          </Button>
          <Button size="1" variant="outline" onClick={() => void sinhLai()}>
            Sinh lại
          </Button>
        </Flex>

        {moXemTruoc && xemTruoc && (
          <Card variant="surface">
            {xemTruoc.ds_loi.length > 0 && (
              <Callout.Root color="amber" size="1" mb="2">
                {xemTruoc.ds_loi.map((l, i) => (
                  <Callout.Text key={i}>
                    {l.truong}: {l.loi}
                  </Callout.Text>
                ))}
              </Callout.Root>
            )}
            {/* HTML đã qua renderer whitelist phía server */}
            <BoxXemTruoc html={xemTruoc.html} />
          </Card>
        )}
      </Flex>
    </Card>
  );
}

function BoxXemTruoc({ html }: { html: string }) {
  return (
    <div
      style={{ borderTop: "1px solid var(--gray-5)", paddingTop: 8 }}
      // eslint-disable-next-line react/no-danger -- renderer server whitelist
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

function ChiTietTd({ id }: { id: string }) {
  const chiTiet = useApi<ChiTietTd>(`/api/thong-diep/${id}`, [id]);
  const d = chiTiet.data;

  return (
    <>
      <Flex align="baseline" gap="3" mb="3" wrap="wrap">
        <a href={d?.ke_hoach ? `#/ke-hoach?id=${d.ke_hoach.id}` : "#/ke-hoach"}>
          <Text size="2">← {d?.ke_hoach ? "Kế hoạch" : "Danh sách kế hoạch"}</Text>
        </a>
        <Heading size="5">{d?.tieu_de ?? "…"}</Heading>
      </Flex>
      <TrangThai loading={chiTiet.loading} error={chiTiet.error}>
        {d && (
          <>
            <Card mb="3" variant="surface">
              <Flex direction="column" gap="1">
                <Text size="2" color="gray" as="p" style={{ whiteSpace: "pre-wrap" }}>
                  {d.noi_dung}
                </Text>
                <Text size="1" color="gray">
                  {d.ds_nguon.length > 0
                    ? `Nguồn: ${d.ds_nguon.map((n) => n.tieu_de).join(", ")}`
                    : "Không gắn nguồn."}
                  {" · "}
                  {d.ds_dau_ra.length} đầu ra
                  {d.ke_hoach &&
                    ` · kế hoạch ${d.ke_hoach.trang_thai === "da_chon" ? "đã chọn" : "nháp"}`}
                </Text>
                {/* #7: lịch dự kiến kèm múi giờ từ fact đã xác nhận — hiển
                    thị một ngày cụ thể thay vì ngày tương đối mơ hồ. */}
                {d.ke_hoach?.fact?.ngay_gio && (
                  <Text size="1" color="gray">
                    Lịch dự kiến: {fmtLuc(d.ke_hoach.fact.ngay_gio)}
                    {d.ke_hoach.fact.mui_gio ? ` (${d.ke_hoach.fact.mui_gio})` : ""}
                    {d.ke_hoach.fact.gia ? ` · Giá: ${d.ke_hoach.fact.gia}` : ""}
                    {d.ke_hoach.fact.tinh_trang ? ` · ${d.ke_hoach.fact.tinh_trang}` : ""}
                  </Text>
                )}
              </Flex>
            </Card>
            {d.ds_dau_ra.length === 0 && (
              <Text color="gray">
                Chưa có đầu ra — quay lại kế hoạch để chọn định dạng cần sinh.
              </Text>
            )}
            {d.ds_dau_ra.map((b) => (
              <TheDauRa key={b.id} b={b} thongDiepId={d.id} reload={chiTiet.reload} />
            ))}
          </>
        )}
      </TrangThai>
    </>
  );
}

export default function ThongDiepPage() {
  const path = useHashRoute();
  const id = path.match(/[?&]id=([^&]+)/)?.[1];
  return <ChiTietTd key={id} id={id ?? ""} />;
}
