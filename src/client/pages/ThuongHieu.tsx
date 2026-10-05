import {
  Badge,
  Button,
  Callout,
  Card,
  Checkbox,
  Flex,
  Heading,
  Select,
  Table,
  Text,
  TextArea,
  TextField,
} from "@radix-ui/themes";
import { useEffect, useState } from "react";
import { api, fmtLuc, LoiApiClient, useApi, useHashRoute } from "../api.ts";
import { TrangThai } from "../components/TrangThai.tsx";
import type {
  AssetHinh,
  Campaign,
  ChiTietDoiTuong,
  ClaimThuongHieu,
  CtaLienKet,
  NguoiDuyetCongQuyen,
  Nguon,
  ThiTruong,
} from "../../modules/content/index.ts";
import type { Asset } from "../../modules/nap/index.ts";
import type { HoSoDoiTuong, HoSoThuongHieu } from "../../modules/context/index.ts";
import type {
  GoiYThuongHieu,
  KetQuaDuyet,
  KetQuaToHop,
  ThiTruongView,
  ThuongHieuView,
} from "../../modules/thuong_hieu/index.ts";
import type { GoiYKhoangTrong } from "../../modules/so_bao/index.ts";

// Trang Chiến dịch thương hiệu toàn cầu (#12): campaign loại
// 'thuong_hieu' — fact chung đã duyệt (claim sản phẩm kèm con trỏ bằng
// chứng, giọng văn, asset hình phân phối, CTA mặc định) + thị trường
// địa phương ghi đè tường minh (giá đã cung cấp kèm tiền tệ — không quy
// đổi, ngôn ngữ, khả dụng, landing page, chi tiết đối tượng, ghi đè tự
// do, reviewer local + bắt buộc duyệt). Sửa field chung → nguồn fact
// chung đổi revision → mọi biến thể mọi thị trường bị đánh dấu cũ
// (#14); sửa thị trường chỉ đánh dấu biến thể của đúng thị trường đó.
// Người dùng chọn đích danh tổ hợp thị trường × định dạng × đối tượng
// × đích đến — không tích Descartes mất kiểm soát — với xem trước quy
// mô và ước tính chi phí khi pricing cấu hình thật. Ma trận biến thể
// gom theo thị trường kèm trạng thái review, ngoại lệ và fact thiếu.

type ChiTietThuongHieu = Campaign & {
  thong_diep: { id: string; tieu_de: string }[];
  goi_y: (GoiYKhoangTrong | GoiYThuongHieu)[];
  hang_cho: { id: string; dinh_dang: string; doi_tuong: string }[];
  thuong_hieu: ThuongHieuView | null;
};

type PhatHien =
  | { thay_doi: { id: string } | null; ds_task: { id: string }[]; so_anh_huong?: number }
  | null;

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

const NHAN_KHA_DUNG: Record<string, string> = {
  "": "—",
  co_hang: "Còn hàng",
  het_hang: "Hết hàng",
  dat_truoc: "Đặt trước",
};

const NHAN_TRANG_THAI_TO_HOP: Record<string, string> = {
  san_sang: "Sẵn sàng",
  da_sinh: "Đã sinh",
  da_co: "Đã có — sinh lại",
  bi_chan: "Bị chặn",
};

const NHAN_FACT_THIEU: Record<string, string> = {
  gia: "giá",
  kha_dung: "khả dụng",
};

const idMoi = (tienTo: string) => `${tienTo}-${crypto.randomUUID().slice(0, 8)}`;

// Thông báo lỗi API gom từ chi_tiet — mẫu chung của các trang campaign.
function docDsLoi(e: unknown): string[] {
  if (e instanceof LoiApiClient) {
    return [e.message, ...(Array.isArray(e.chiTiet) ? e.chiTiet.map(String) : [])];
  }
  return [String(e)];
}

export default function ThuongHieuPage() {
  const path = useHashRoute();
  const id = new URLSearchParams(path.split("?")[1] ?? "").get("id");
  return id ? <ChiTietThuongHieuView id={id} /> : <DanhSachThuongHieu />;
}

// --- Danh sách + tạo chiến dịch thương hiệu ---

function DanhSachThuongHieu() {
  const { data, loading, error, reload } = useApi<Campaign[]>("/api/thuong-hieu");
  const [ten, setTen] = useState("");
  const [dsLoi, setDsLoi] = useState<string[]>([]);
  const [dangGui, setDangGui] = useState(false);

  async function tao() {
    setDangGui(true);
    setDsLoi([]);
    try {
      const cp = await api<Campaign>("/api/campaign", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ loai: "thuong_hieu", ten }),
      });
      window.location.hash = `#/thuong-hieu?id=${cp.id}`;
    } catch (e) {
      setDsLoi(docDsLoi(e));
      setDangGui(false);
      reload();
    }
  }

  return (
    <>
      <Heading mb="3">Chiến dịch thương hiệu toàn cầu</Heading>
      <Card mb="4">
        <Flex direction="column" gap="2">
          <Text size="2" weight="bold">
            Tạo chiến dịch mới
          </Text>
          <Text size="1" color="gray">
            Một campaign nguồn dùng chung nhiều thị trường: claim đã duyệt,
            giọng văn, asset hình và CTA mặc định ở tầng chung; giá/khả
            dụng/CTA local ghi đè tường minh theo từng thị trường.
          </Text>
          <Flex gap="2" wrap="wrap">
            <TextField.Root
              placeholder="Tên chiến dịch (bắt buộc)"
              value={ten}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTen(e.target.value)}
              style={{ flex: 2, minWidth: 220 }}
            />
          </Flex>
          {dsLoi.length > 0 && (
            <Callout.Root color="red">
              {dsLoi.map((l, i) => (
                <Callout.Text key={i}>{l}</Callout.Text>
              ))}
            </Callout.Root>
          )}
          <Flex justify="end">
            <Button onClick={tao} disabled={dangGui || !ten.trim()}>
              Tạo chiến dịch
            </Button>
          </Flex>
        </Flex>
      </Card>
      <TrangThai loading={loading} error={error} empty={!data?.length}>
        <Table.Root>
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeaderCell>Tên chiến dịch</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>Thông điệp lõi</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>Số claim</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>Tạo lúc</Table.ColumnHeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {(data ?? []).map((cp) => (
              <Table.Row key={cp.id}>
                <Table.Cell>
                  <a href={`#/thuong-hieu?id=${cp.id}`}>{cp.ten}</a>
                </Table.Cell>
                <Table.Cell>{cp.thong_diep_loi || "—"}</Table.Cell>
                <Table.Cell>{cp.ds_claim.length}</Table.Cell>
                <Table.Cell>{fmtLuc(cp.tao_luc)}</Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Root>
      </TrangThai>
    </>
  );
}

// --- Chi tiết một chiến dịch thương hiệu ---

function ChiTietThuongHieuView({ id }: { id: string }) {
  const chiTiet = useApi<ChiTietThuongHieu>(`/api/campaign/${id}`, [id]);
  const dsNguon = useApi<Nguon[]>("/api/nguon");
  const dsDoiTuong = useApi<HoSoDoiTuong[]>("/api/ho-so-doi-tuong");
  const dsHoSoTh = useApi<HoSoThuongHieu[]>("/api/ho-so-thuong-hieu");
  const dsDinhDang = useApi<{ id: string; nhan: string }[]>("/api/dinh-dang");
  const dsAsset = useApi<Asset[]>("/api/assets");

  const [form, setForm] = useState({
    ten: "",
    mo_ta: "",
    thong_diep_loi: "",
    dinh_vi: "",
    giong_van: "",
    thuong_hieu_id: "",
    doi_tuong_id: "",
  });
  const [ctaNhan, setCtaNhan] = useState("");
  const [ctaUrl, setCtaUrl] = useState("");
  const [dsClaim, setDsClaim] = useState<ClaimThuongHieu[]>([]);
  const [dsAssetHinh, setDsAssetHinh] = useState<AssetHinh[]>([]);
  const [dsLoi, setDsLoi] = useState<string[]>([]);
  const [dangGui, setDangGui] = useState(false);
  const [phatHien, setPhatHien] = useState<PhatHien>(null);
  const [ttSua, setTtSua] = useState<string | null>(null);
  const [dsChon, setDsChon] = useState<Set<string>>(new Set());
  const [ketQuaXemTruoc, setKetQuaXemTruoc] = useState<{
    ds_ket_qua: KetQuaToHop[];
    uoc_tinh: {
      la_uoc_luong: boolean;
      so_bien_the: number;
      chi_phi_uoc_tinh_usd: number;
    } | null;
  } | null>(null);
  const [ketQuaSinh, setKetQuaSinh] = useState<KetQuaToHop[] | null>(null);
  const [ketQuaDuyet, setKetQuaDuyet] = useState<KetQuaDuyet[] | null>(null);

  // Nạp form từ campaign — ghim theo id để không ghi đè nháp khi reload.
  useEffect(() => {
    const cp = chiTiet.data;
    if (!cp) return;
    setForm({
      ten: cp.ten,
      mo_ta: cp.mo_ta,
      thong_diep_loi: cp.thong_diep_loi,
      dinh_vi: cp.dinh_vi,
      giong_van: cp.giong_van,
      thuong_hieu_id: cp.thuong_hieu_id ?? "",
      doi_tuong_id: cp.doi_tuong_id ?? "",
    });
    const cta = cp.cta[0];
    setCtaNhan(cta?.nhan ?? "");
    setCtaUrl(cta?.url ?? "");
    setDsClaim(cp.ds_claim.map((c) => ({ ...c })));
    setDsAssetHinh(cp.ds_asset_hinh.map((a) => ({ ...a })));
    setPhatHien(null);
    setKetQuaSinh(null);
    setKetQuaDuyet(null);
  }, [chiTiet.data?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function luuChung() {
    setDangGui(true);
    setDsLoi([]);
    setPhatHien(null);
    try {
      const cta: CtaLienKet[] = ctaNhan.trim() || ctaUrl.trim()
        ? [{ id: "cta-chinh", nhan: ctaNhan.trim(), loai: "", url: ctaUrl.trim() }]
        : [];
      const kq = await api<Campaign & { phat_hien: PhatHien }>(`/api/campaign/${id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ten: form.ten,
          mo_ta: form.mo_ta,
          thong_diep_loi: form.thong_diep_loi,
          dinh_vi: form.dinh_vi,
          giong_van: form.giong_van,
          thuong_hieu_id: form.thuong_hieu_id || null,
          doi_tuong_id: form.doi_tuong_id || null,
          cta,
          ds_claim: dsClaim.filter((c) => c.noi_dung.trim()),
          ds_asset_hinh: dsAssetHinh.filter((a) => a.asset_id.trim()),
        }),
      });
      if (kq.phat_hien) setPhatHien(kq.phat_hien);
      chiTiet.reload();
    } catch (e) {
      setDsLoi(docDsLoi(e));
    }
    setDangGui(false);
  }

  const view = chiTiet.data?.thuong_hieu ?? null;
  const dsDeXuat = view?.de_xuat_to_hop ?? [];

  // Tick chọn tổ hợp đề xuất — key = id đề xuất.
  function doiTickToHop(khoa: string) {
    setDsChon((cu) => {
      const moi = new Set(cu);
      if (moi.has(khoa)) moi.delete(khoa);
      else moi.add(khoa);
      return moi;
    });
  }

  function dsChonPayload() {
    return dsDeXuat
      .filter((d) => dsChon.has(d.id))
      .map((d) => ({
        thi_truong_id: d.thi_truong_id,
        dinh_dang: d.dinh_dang,
        doi_tuong_id: d.doi_tuong_id,
        dich_den: d.dich_den || undefined,
      }));
  }

  async function xemTruoc() {
    setDsLoi([]);
    setKetQuaSinh(null);
    try {
      const kq = await api<typeof ketQuaXemTruoc>(
        `/api/campaign/${id}/to-hop/xem-truoc`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ds_chon: dsChonPayload() }),
        },
      );
      setKetQuaXemTruoc(kq);
    } catch (e) {
      setDsLoi(docDsLoi(e));
      setKetQuaXemTruoc(null);
    }
  }

  async function sinhToHop() {
    setDsLoi([]);
    setKetQuaSinh(null);
    try {
      const kq = await api<{ ds_ket_qua: KetQuaToHop[] }>(
        `/api/campaign/${id}/to-hop`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ds_chon: dsChonPayload() }),
        },
      );
      setKetQuaSinh(kq.ds_ket_qua);
      setDsChon(new Set());
      setKetQuaXemTruoc(null);
      setTimeout(() => chiTiet.reload(), 1500);
      setTimeout(() => chiTiet.reload(), 4000);
    } catch (e) {
      setDsLoi(docDsLoi(e));
    }
  }

  return (
    <>
      <Flex align="baseline" gap="3" mb="3">
        <Heading>{chiTiet.data?.ten ?? "Chiến dịch thương hiệu"}</Heading>
        <Text size="2" color="gray">
          #{id}
        </Text>
      </Flex>
      <TrangThai loading={chiTiet.loading} error={chiTiet.error} empty={!chiTiet.data}>
        {phatHien && (
          <Callout.Root color="orange" mb="3">
            <Callout.Text>
              Thay đổi nguồn đã đánh dấu đầu ra phụ thuộc:{" "}
              {phatHien.so_anh_huong ?? "?"} đầu ra, {phatHien.ds_task.length} task
              sửa. Xem trang Thay đổi để xử lý.
            </Callout.Text>
          </Callout.Root>
        )}
        {(chiTiet.data?.goi_y ?? []).length > 0 && (
          <Card mb="3">
            <Text size="2" weight="bold">
              Gợi ý
            </Text>
            {(chiTiet.data?.goi_y ?? []).map((g, i) => (
              <Text as="p" size="2" key={i} color="orange">
                • {(g as { noi_dung?: string }).noi_dung ?? g.id}
              </Text>
            ))}
          </Card>
        )}

        {/* --- Fact chung của chiến dịch --- */}
        <Card mb="4">
          <Flex direction="column" gap="2">
            <Text size="2" weight="bold">
              Fact chung (claim đã duyệt, giọng văn, asset, CTA mặc định)
            </Text>
            <Text size="1" color="gray">
              Sửa field ở đây → nguồn fact chung đổi → mọi biến thể của
              mọi thị trường bị đánh dấu cũ theo cơ chế thay đổi nguồn.
            </Text>
            <Flex gap="2" wrap="wrap">
              <TextField.Root
                placeholder="Tên chiến dịch"
                value={form.ten}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setForm({ ...form, ten: e.target.value })
                }
                style={{ flex: 1, minWidth: 240 }}
              />
              <Select.Root
                value={form.thuong_hieu_id || "khong"}
                onValueChange={(v: string) =>
                  setForm({ ...form, thuong_hieu_id: v === "khong" ? "" : v })
                }
              >
                <Select.Trigger placeholder="Hồ sơ thương hiệu" />
                <Select.Content>
                  <Select.Item value="khong">— Không gắn hồ sơ —</Select.Item>
                  {(dsHoSoTh.data ?? []).map((h) => (
                    <Select.Item key={h.id} value={h.id}>
                      {h.ten}
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select.Root>
              <Select.Root
                value={form.doi_tuong_id || "khong"}
                onValueChange={(v: string) =>
                  setForm({ ...form, doi_tuong_id: v === "khong" ? "" : v })
                }
              >
                <Select.Trigger placeholder="Đối tượng chính" />
                <Select.Content>
                  <Select.Item value="khong">— Đối tượng chính —</Select.Item>
                  {(dsDoiTuong.data ?? []).map((d) => (
                    <Select.Item key={d.id} value={d.id}>
                      {d.ten}
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select.Root>
            </Flex>
            <TextField.Root
              placeholder="Thông điệp lõi dùng chung"
              value={form.thong_diep_loi}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                setForm({ ...form, thong_diep_loi: e.target.value })
              }
            />
            <Flex gap="2" wrap="wrap">
              <TextField.Root
                placeholder="Định vị (ví dụ: giày chạy cho runner thi đấu)"
                value={form.dinh_vi}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setForm({ ...form, dinh_vi: e.target.value })
                }
                style={{ flex: 1, minWidth: 240 }}
              />
              <TextField.Root
                placeholder="Giọng văn (ví dụ: gọn, tự tin, không phóng đại)"
                value={form.giong_van}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setForm({ ...form, giong_van: e.target.value })
                }
                style={{ flex: 1, minWidth: 240 }}
              />
            </Flex>
            <Flex gap="2" wrap="wrap">
              <TextField.Root
                placeholder="Nhãn CTA mặc định"
                value={ctaNhan}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCtaNhan(e.target.value)}
                style={{ flex: 1, minWidth: 160 }}
              />
              <TextField.Root
                placeholder="URL CTA mặc định (https:// hoặc /duong-dan)"
                value={ctaUrl}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCtaUrl(e.target.value)}
                style={{ flex: 2, minWidth: 260 }}
              />
            </Flex>

            <Text size="1" weight="bold" mt="1">
              Claim đã duyệt (kèm con trỏ bằng chứng)
            </Text>
            {dsClaim.map((cl, i) => (
              <Flex gap="2" key={cl.id} align="center" wrap="wrap">
                <Text size="1" color="gray" style={{ width: 70 }}>
                  {cl.id}
                </Text>
                <TextField.Root
                  placeholder="Nội dung claim đã duyệt"
                  value={cl.noi_dung}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    setDsClaim(
                      dsClaim.map((x, j) => (j === i ? { ...x, noi_dung: e.target.value } : x)),
                    )
                  }
                  style={{ flex: 2, minWidth: 240 }}
                />
                <Select.Root
                  value={cl.nguon_id ?? "khong"}
                  onValueChange={(v: string) =>
                    setDsClaim(
                      dsClaim.map((x, j) =>
                        j === i ? { ...x, nguon_id: v === "khong" ? null : v, muc_id: null } : x,
                      ),
                    )
                  }
                >
                  <Select.Trigger placeholder="Nguồn bằng chứng" />
                  <Select.Content>
                    <Select.Item value="khong">— Chưa có bằng chứng —</Select.Item>
                    {(dsNguon.data ?? []).map((n) => (
                      <Select.Item key={n.id} value={n.id}>
                        {n.tieu_de}
                      </Select.Item>
                    ))}
                  </Select.Content>
                </Select.Root>
                {cl.nguon_id && (
                  <Select.Root
                    value={cl.muc_id ?? "khong"}
                    onValueChange={(v: string) =>
                      setDsClaim(
                        dsClaim.map((x, j) =>
                          j === i ? { ...x, muc_id: v === "khong" ? null : v } : x,
                        ),
                      )
                    }
                  >
                    <Select.Trigger placeholder="Mục" />
                    <Select.Content>
                      <Select.Item value="khong">— Cả nguồn —</Select.Item>
                      {(dsNguon.data ?? [])
                        .find((n) => n.id === cl.nguon_id)
                        ?.cac_muc.map((m) => (
                          <Select.Item key={m.id} value={m.id}>
                            {m.tieu_de ?? m.id}
                          </Select.Item>
                        ))}
                    </Select.Content>
                  </Select.Root>
                )}
                <Button
                  variant="ghost"
                  color="red"
                  onClick={() => setDsClaim(dsClaim.filter((_, j) => j !== i))}
                >
                  Xóa
                </Button>
              </Flex>
            ))}
            <Flex>
              <Button
                variant="soft"
                onClick={() =>
                  setDsClaim([
                    ...dsClaim,
                    { id: idMoi("cl"), noi_dung: "", nguon_id: null, muc_id: null },
                  ])
                }
              >
                + Thêm claim
              </Button>
            </Flex>

            <Text size="1" weight="bold" mt="1">
              Asset hình phân phối chung
            </Text>
            {dsAssetHinh.map((a, i) => (
              <Flex gap="2" key={a.id} align="center" wrap="wrap">
                <Select.Root
                  value={a.asset_id || "khong"}
                  onValueChange={(v: string) =>
                    setDsAssetHinh(
                      dsAssetHinh.map((x, j) =>
                        j === i ? { ...x, asset_id: v === "khong" ? "" : v } : x,
                      ),
                    )
                  }
                >
                  <Select.Trigger placeholder="Chọn asset" />
                  <Select.Content>
                    <Select.Item value="khong">— Chọn asset —</Select.Item>
                    {(dsAsset.data ?? []).map((s) => (
                      <Select.Item key={s.id} value={s.id}>
                        {s.ten_file}
                      </Select.Item>
                    ))}
                  </Select.Content>
                </Select.Root>
                <TextField.Root
                  placeholder="Ghi chú cách dùng đã duyệt"
                  value={a.ghi_chu}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    setDsAssetHinh(
                      dsAssetHinh.map((x, j) => (j === i ? { ...x, ghi_chu: e.target.value } : x)),
                    )
                  }
                  style={{ flex: 1, minWidth: 240 }}
                />
                <Button
                  variant="ghost"
                  color="red"
                  onClick={() => setDsAssetHinh(dsAssetHinh.filter((_, j) => j !== i))}
                >
                  Xóa
                </Button>
              </Flex>
            ))}
            <Flex justify="between">
              <Button
                variant="soft"
                onClick={() =>
                  setDsAssetHinh([...dsAssetHinh, { id: idMoi("ah"), asset_id: "", ghi_chu: "" }])
                }
              >
                + Thêm asset
              </Button>
              <Button onClick={luuChung} disabled={dangGui}>
                Lưu fact chung
              </Button>
            </Flex>
            {dsLoi.length > 0 && (
              <Callout.Root color="red">
                {dsLoi.map((l, i) => (
                  <Callout.Text key={i}>{l}</Callout.Text>
                ))}
              </Callout.Root>
            )}
          </Flex>
        </Card>

        {/* --- Thị trường + ghi đè --- */}
        <Card mb="4">
          <Flex direction="column" gap="2">
            <Text size="2" weight="bold">
              Thị trường + ghi đè local
            </Text>
            <Text size="1" color="gray">
              Giá/khả dụng/CTA/chi tiết là giá trị local được cung cấp —
              giữ nguyên văn, không tự quy đổi. Thiếu giá hoặc khả dụng →
              thị trường "chưa đủ" và tổ hợp của nó bị chặn.
            </Text>
            <Table.Root>
              <Table.Header>
                <Table.Row>
                  <Table.ColumnHeaderCell>Mã</Table.ColumnHeaderCell>
                  <Table.ColumnHeaderCell>Tên</Table.ColumnHeaderCell>
                  <Table.ColumnHeaderCell>Ngôn ngữ</Table.ColumnHeaderCell>
                  <Table.ColumnHeaderCell>Giá</Table.ColumnHeaderCell>
                  <Table.ColumnHeaderCell>Khả dụng</Table.ColumnHeaderCell>
                  <Table.ColumnHeaderCell>Ngoại lệ</Table.ColumnHeaderCell>
                  <Table.ColumnHeaderCell></Table.ColumnHeaderCell>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {(view?.ds_thi_truong ?? []).map((tt) => (
                  <Table.Row key={tt.id}>
                    <Table.Cell>
                      <Badge color="gray">{tt.ma}</Badge>
                    </Table.Cell>
                    <Table.Cell>
                      {tt.ten}
                      {tt.chua_du && (
                        <Badge color="red" ml="2">
                          chưa đủ: {tt.fact_thieu.map((f) => NHAN_FACT_THIEU[f] ?? f).join(", ")}
                        </Badge>
                      )}
                    </Table.Cell>
                    <Table.Cell>{tt.ngon_ngu}</Table.Cell>
                    <Table.Cell>
                      {tt.gia ? `${tt.gia} ${tt.tien_te}` : "—"}
                    </Table.Cell>
                    <Table.Cell>{NHAN_KHA_DUNG[tt.kha_dung] ?? "—"}</Table.Cell>
                    <Table.Cell>
                      <Flex gap="1" wrap="wrap">
                        {tt.ngoai_le.length === 0 && <Text size="1" color="gray">—</Text>}
                        {tt.ngoai_le.map((x) => (
                          <Badge key={x} color="orange" variant="soft">
                            {x}
                          </Badge>
                        ))}
                      </Flex>
                    </Table.Cell>
                    <Table.Cell>
                      <Button
                        size="1"
                        variant="soft"
                        onClick={() => setTtSua(ttSua === tt.id ? null : tt.id)}
                      >
                        {ttSua === tt.id ? "Đóng" : "Sửa"}
                      </Button>
                    </Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table.Root>
            {(view?.ds_thi_truong ?? [])
              .filter((tt) => tt.id === ttSua)
              .map((tt) => (
                <FormThiTruong
                  key={tt.id}
                  cp={chiTiet.data!}
                  ttCu={tt}
                  dsDoiTuong={dsDoiTuong.data ?? []}
                  khiXong={() => {
                    setTtSua(null);
                    chiTiet.reload();
                  }}
                />
              ))}
            <FormThiTruong
              cp={chiTiet.data!}
              ttCu={null}
              dsDoiTuong={dsDoiTuong.data ?? []}
              khiXong={() => chiTiet.reload()}
            />
          </Flex>
        </Card>

        {/* --- Chọn tổ hợp sinh --- */}
        <Card mb="4">
          <Flex direction="column" gap="2">
            <Text size="2" weight="bold">
              Chọn tổ hợp sinh (thị trường × định dạng × đối tượng)
            </Text>
            <Text size="1" color="gray">
              Chỉ tổ hợp tick chọn mới sinh — không tích Descartes tự động.
              Giới hạn mỗi request theo cấu hình server.
            </Text>
            {dsDeXuat.length === 0 && (
              <Text size="2" color="gray">
                Thêm thị trường trước để có tổ hợp đề xuất.
              </Text>
            )}
            <Table.Root>
              <Table.Header>
                <Table.Row>
                  <Table.ColumnHeaderCell></Table.ColumnHeaderCell>
                  <Table.ColumnHeaderCell>Thị trường</Table.ColumnHeaderCell>
                  <Table.ColumnHeaderCell>Định dạng</Table.ColumnHeaderCell>
                  <Table.ColumnHeaderCell>Đối tượng</Table.ColumnHeaderCell>
                  <Table.ColumnHeaderCell>Ghi chú</Table.ColumnHeaderCell>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {dsDeXuat.map((d) => (
                  <Table.Row key={d.id}>
                    <Table.Cell>
                      <Checkbox
                        checked={dsChon.has(d.id)}
                        onCheckedChange={() => doiTickToHop(d.id)}
                      />
                    </Table.Cell>
                    <Table.Cell>
                      <Badge color="gray">{d.thi_truong_ma}</Badge>
                    </Table.Cell>
                    <Table.Cell>
                      {dsDinhDang.data?.find((x) => x.id === d.dinh_dang)?.nhan ?? d.dinh_dang}
                    </Table.Cell>
                    <Table.Cell>{d.doi_tuong || "Chung"}</Table.Cell>
                    <Table.Cell>
                      <Text size="1" color="gray">
                        {d.ly_do}
                      </Text>
                    </Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table.Root>
            <Flex gap="2" justify="end">
              <Button variant="soft" onClick={xemTruoc} disabled={dsChon.size === 0}>
                Xem trước quy mô ({dsChon.size})
              </Button>
              <Button onClick={sinhToHop} disabled={dsChon.size === 0}>
                Sinh {dsChon.size} tổ hợp đã chọn
              </Button>
            </Flex>
            {ketQuaXemTruoc && (
              <Card>
                <Text size="2" weight="bold">
                  Xem trước {ketQuaXemTruoc.ds_ket_qua.length} tổ hợp
                </Text>
                {ketQuaXemTruoc.uoc_tinh ? (
                  <Text size="2">
                    Ước tính chi phí: ~${ketQuaXemTruoc.uoc_tinh.chi_phi_uoc_tinh_usd} cho{" "}
                    {ketQuaXemTruoc.uoc_tinh.so_bien_the} biến thể (ước lượng theo
                    pricing cấu hình).
                  </Text>
                ) : (
                  <Text size="2" color="gray">
                    Provider chưa cấu hình pricing — không có ước tính chi phí.
                  </Text>
                )}
                {ketQuaXemTruoc.ds_ket_qua.map((k, i) => (
                  <Flex key={i} gap="2" align="center">
                    <Badge
                      color={
                        k.trang_thai === "bi_chan"
                          ? "red"
                          : k.trang_thai === "da_co"
                            ? "orange"
                            : "green"
                      }
                    >
                      {NHAN_TRANG_THAI_TO_HOP[k.trang_thai]}
                    </Badge>
                    <Text size="2">
                      {k.thi_truong_ma} — {k.dinh_dang} — {k.doi_tuong || "Chung"} (
                      {k.ngon_ngu})
                    </Text>
                    {k.fact_thieu.length > 0 && (
                      <Text size="1" color="red">
                        thiếu: {k.fact_thieu.map((f) => NHAN_FACT_THIEU[f] ?? f).join(", ")}
                      </Text>
                    )}
                  </Flex>
                ))}
              </Card>
            )}
            {ketQuaSinh && (
              <Card>
                <Text size="2" weight="bold">
                  Đã enqueue
                </Text>
                {ketQuaSinh.map((k, i) => (
                  <Flex key={i} gap="2" align="center">
                    <Badge color={k.trang_thai === "bi_chan" ? "red" : "blue"}>
                      {NHAN_TRANG_THAI_TO_HOP[k.trang_thai]}
                    </Badge>
                    <Text size="2">
                      {k.thi_truong_ma} — {k.dinh_dang} — {k.doi_tuong || "Chung"}
                    </Text>
                    {k.job_id && (
                      <a href={`#/job?id=${k.job_id}`}>
                        <Text size="1" color="blue">
                          job {k.job_id.slice(0, 12)}
                        </Text>
                      </a>
                    )}
                  </Flex>
                ))}
              </Card>
            )}
          </Flex>
        </Card>

        {/* --- Ma trận biến thể theo thị trường --- */}
        {(view?.ds_thi_truong ?? []).map((tt) => (
          <MaTranThiTruong
            key={tt.id}
            cp={chiTiet.data!}
            tt={tt}
            ketQuaDuyet={ketQuaDuyet}
            setKetQuaDuyet={setKetQuaDuyet}
            reload={chiTiet.reload}
          />
        ))}
      </TrangThai>
    </>
  );
}

// --- Form tạo/sửa một thị trường ---

function FormThiTruong({
  cp,
  ttCu,
  dsDoiTuong,
  khiXong,
}: {
  cp: Campaign;
  ttCu: ThiTruongView | null;
  dsDoiTuong: HoSoDoiTuong[];
  khiXong: () => void;
}) {
  const [f, setF] = useState({
    ma: ttCu?.ma ?? "",
    ten: ttCu?.ten ?? "",
    ngon_ngu: ttCu?.ngon_ngu ?? "vi",
    gia: ttCu?.gia ?? "",
    tien_te: ttCu?.tien_te ?? "",
    kha_dung: ttCu?.kha_dung ?? "",
    landing_page: ttCu?.landing_page ?? "",
    cta_nhan: ttCu?.cta_nhan ?? "",
    cta_url: ttCu?.cta_url ?? "",
    bat_buoc_duyet: ttCu ? ttCu.bat_buoc_duyet === 1 : false,
  });
  const [dsChiTiet, setDsChiTiet] = useState<ChiTietDoiTuong[]>(
    ttCu?.ds_chi_tiet.map((c) => ({ ...c })) ?? [],
  );
  const [dsGhiDe, setDsGhiDe] = useState<{ khoa: string; gia_tri: string }[]>(
    ttCu ? Object.entries(ttCu.ghi_de).map(([k, v]) => ({ khoa: k, gia_tri: v })) : [],
  );
  const [dsNguoiDuyet, setDsNguoiDuyet] = useState<NguoiDuyetCongQuyen[]>(
    ttCu?.ds_nguoi_duyet.map((x) => ({ ...x })) ?? [],
  );
  const [dsLoi, setDsLoi] = useState<string[]>([]);
  const [dangGui, setDangGui] = useState(false);
  const [mo, setMo] = useState(!!ttCu); // form tạo mới gập mặc định

  async function gui() {
    setDangGui(true);
    setDsLoi([]);
    try {
      const ghiDe: Record<string, string> = {};
      for (const g of dsGhiDe) {
        if (g.khoa.trim()) ghiDe[g.khoa.trim()] = g.gia_tri;
      }
      const body = {
        ma: f.ma,
        ten: f.ten,
        ngon_ngu: f.ngon_ngu,
        gia: f.gia,
        tien_te: f.tien_te,
        kha_dung: f.kha_dung,
        landing_page: f.landing_page,
        cta_nhan: f.cta_nhan,
        cta_url: f.cta_url,
        bat_buoc_duyet: f.bat_buoc_duyet ? 1 : 0,
        ds_chi_tiet: dsChiTiet.filter((c) => c.doi_tuong_id && c.chi_tiet.trim()),
        ghi_de: ghiDe,
        ds_nguoi_duyet: dsNguoiDuyet.filter((x) => x.id && x.ten),
      };
      const url = ttCu
        ? `/api/campaign/${cp.id}/thi-truong/${ttCu.id}`
        : `/api/campaign/${cp.id}/thi-truong`;
      await api<ThiTruong>(url, {
        method: ttCu ? "PUT" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      khiXong();
      if (!ttCu) {
        setF({ ...f, ma: "", ten: "" });
        setMo(false);
      }
    } catch (e) {
      setDsLoi(docDsLoi(e));
    }
    setDangGui(false);
  }

  if (!mo && !ttCu) {
    return (
      <Flex justify="start" mt="2">
        <Button variant="soft" onClick={() => setMo(true)}>
          + Thêm thị trường
        </Button>
      </Flex>
    );
  }

  return (
    <Card style={{ background: "var(--gray-a2)" }}>
      <Flex direction="column" gap="2">
        <Text size="2" weight="bold">
          {ttCu ? `Sửa thị trường '${ttCu.ten}'` : "Thêm thị trường"}
        </Text>
        <Flex gap="2" wrap="wrap">
          <TextField.Root
            placeholder="Mã (a-z0-9-, vd: us, vn)"
            value={f.ma}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              setF({ ...f, ma: e.target.value })
            }
            style={{ width: 150 }}
            disabled={!!ttCu}
          />
          <TextField.Root
            placeholder="Tên thị trường"
            value={f.ten}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              setF({ ...f, ten: e.target.value })
            }
            style={{ flex: 1, minWidth: 180 }}
          />
          <Select.Root
            value={f.ngon_ngu}
            onValueChange={(v: string) => setF({ ...f, ngon_ngu: v })}
          >
            <Select.Trigger placeholder="Ngôn ngữ" />
            <Select.Content>
              <Select.Item value="vi">vi — tiếng Việt</Select.Item>
              <Select.Item value="en">en — English</Select.Item>
            </Select.Content>
          </Select.Root>
        </Flex>
        <Flex gap="2" wrap="wrap">
          <TextField.Root
            placeholder="Giá đã cung cấp (nguyên văn)"
            value={f.gia}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              setF({ ...f, gia: e.target.value })
            }
            style={{ width: 200 }}
          />
          <TextField.Root
            placeholder="Tiền tệ (USD/VND)"
            value={f.tien_te}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              setF({ ...f, tien_te: e.target.value })
            }
            style={{ width: 130 }}
          />
          <Select.Root
            value={f.kha_dung || "khong"}
            onValueChange={(v: string) => setF({ ...f, kha_dung: v === "khong" ? "" : v })}
          >
            <Select.Trigger placeholder="Khả dụng" />
            <Select.Content>
              <Select.Item value="khong">— Chưa có khả dụng —</Select.Item>
              <Select.Item value="co_hang">Còn hàng</Select.Item>
              <Select.Item value="het_hang">Hết hàng</Select.Item>
              <Select.Item value="dat_truoc">Đặt trước</Select.Item>
            </Select.Content>
          </Select.Root>
        </Flex>
        <Flex gap="2" wrap="wrap">
          <TextField.Root
            placeholder="Landing page local (https:// hoặc /duong-dan)"
            value={f.landing_page}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              setF({ ...f, landing_page: e.target.value })
            }
            style={{ flex: 1, minWidth: 260 }}
          />
          <TextField.Root
            placeholder="Nhãn CTA local (ghi đè)"
            value={f.cta_nhan}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              setF({ ...f, cta_nhan: e.target.value })
            }
            style={{ width: 180 }}
          />
          <TextField.Root
            placeholder="URL CTA local"
            value={f.cta_url}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              setF({ ...f, cta_url: e.target.value })
            }
            style={{ flex: 1, minWidth: 220 }}
          />
        </Flex>

        <Text size="1" weight="bold">
          Chi tiết theo đối tượng (lời thoại/ưu đãi đã duyệt riêng)
        </Text>
        {dsChiTiet.map((ct, i) => (
          <Flex gap="2" key={i} align="center" wrap="wrap">
            <Select.Root
              value={ct.doi_tuong_id || "khong"}
              onValueChange={(v: string) =>
                setDsChiTiet(
                  dsChiTiet.map((x, j) =>
                    j === i ? { ...x, doi_tuong_id: v === "khong" ? "" : v } : x,
                  ),
                )
              }
            >
              <Select.Trigger placeholder="Đối tượng" />
              <Select.Content>
                <Select.Item value="khong">— Đối tượng —</Select.Item>
                {dsDoiTuong.map((d) => (
                  <Select.Item key={d.id} value={d.id}>
                    {d.ten}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select.Root>
            <TextField.Root
              placeholder="Chi tiết đã duyệt cho đối tượng này"
              value={ct.chi_tiet}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                setDsChiTiet(
                  dsChiTiet.map((x, j) => (j === i ? { ...x, chi_tiet: e.target.value } : x)),
                )
              }
              style={{ flex: 1, minWidth: 260 }}
            />
            <Button
              variant="ghost"
              color="red"
              onClick={() => setDsChiTiet(dsChiTiet.filter((_, j) => j !== i))}
            >
              Xóa
            </Button>
          </Flex>
        ))}
        <Button
          variant="soft"
          size="1"
          onClick={() => setDsChiTiet([...dsChiTiet, { doi_tuong_id: "", chi_tiet: "" }])}
        >
          + Chi tiết đối tượng
        </Button>

        <Text size="1" weight="bold">
          Ghi đè tự do (khoa: giá trị)
        </Text>
        {dsGhiDe.map((g, i) => (
          <Flex gap="2" key={i} align="center" wrap="wrap">
            <TextField.Root
              placeholder="khoa (a-z0-9_-)"
              value={g.khoa}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                setDsGhiDe(dsGhiDe.map((x, j) => (j === i ? { ...x, khoa: e.target.value } : x)))
              }
              style={{ width: 200 }}
            />
            <TextField.Root
              placeholder="giá trị"
              value={g.gia_tri}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                setDsGhiDe(dsGhiDe.map((x, j) => (j === i ? { ...x, gia_tri: e.target.value } : x)))
              }
              style={{ flex: 1, minWidth: 260 }}
            />
            <Button
              variant="ghost"
              color="red"
              onClick={() => setDsGhiDe(dsGhiDe.filter((_, j) => j !== i))}
            >
              Xóa
            </Button>
          </Flex>
        ))}
        <Button
          variant="soft"
          size="1"
          onClick={() => setDsGhiDe([...dsGhiDe, { khoa: "", gia_tri: "" }])}
        >
          + Ghi đè
        </Button>

        <Text size="1" weight="bold">
          Reviewer local (của thị trường này)
        </Text>
        {dsNguoiDuyet.map((r, i) => (
          <Flex gap="2" key={i} align="center" wrap="wrap">
            <TextField.Root
              placeholder="id (vd: rev-us-1)"
              value={r.id}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                setDsNguoiDuyet(
                  dsNguoiDuyet.map((x, j) => (j === i ? { ...x, id: e.target.value } : x)),
                )
              }
              style={{ width: 160 }}
            />
            <TextField.Root
              placeholder="Tên reviewer"
              value={r.ten}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                setDsNguoiDuyet(
                  dsNguoiDuyet.map((x, j) => (j === i ? { ...x, ten: e.target.value } : x)),
                )
              }
              style={{ width: 200 }}
            />
            <TextField.Root
              placeholder="Vai trò"
              value={r.vai_tro}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                setDsNguoiDuyet(
                  dsNguoiDuyet.map((x, j) => (j === i ? { ...x, vai_tro: e.target.value } : x)),
                )
              }
              style={{ flex: 1, minWidth: 160 }}
            />
            <Button
              variant="ghost"
              color="red"
              onClick={() => setDsNguoiDuyet(dsNguoiDuyet.filter((_, j) => j !== i))}
            >
              Xóa
            </Button>
          </Flex>
        ))}
        <Button
          variant="soft"
          size="1"
          onClick={() =>
            setDsNguoiDuyet([...dsNguoiDuyet, { id: idMoi("rev"), ten: "", vai_tro: "" }])
          }
        >
          + Reviewer
        </Button>
        <Flex align="center" gap="2">
          <Checkbox
            checked={f.bat_buoc_duyet}
            onCheckedChange={(v: boolean | "indeterminate") =>
              setF({ ...f, bat_buoc_duyet: v === true })
            }
          />
          <Text size="2">Bắt buộc ghi reviewer local khi duyệt</Text>
        </Flex>

        {dsLoi.length > 0 && (
          <Callout.Root color="red">
            {dsLoi.map((l, i) => (
              <Callout.Text key={i}>{l}</Callout.Text>
            ))}
          </Callout.Root>
        )}
        <Flex justify="end" gap="2">
          {!ttCu && (
            <Button variant="ghost" onClick={() => setMo(false)}>
              Đóng
            </Button>
          )}
          <Button onClick={gui} disabled={dangGui}>
            {ttCu ? "Lưu thị trường" : "Tạo thị trường"}
          </Button>
        </Flex>
      </Flex>
    </Card>
  );
}

// --- Ma trận biến thể của một thị trường ---

function MaTranThiTruong({
  cp,
  tt,
  ketQuaDuyet,
  setKetQuaDuyet,
  reload,
}: {
  cp: Campaign;
  tt: ThiTruongView;
  ketQuaDuyet: KetQuaDuyet[] | null;
  setKetQuaDuyet: (k: KetQuaDuyet[]) => void;
  reload: () => void;
}) {
  const [dsChon, setDsChon] = useState<Set<string>>(new Set());
  const [nguoiDuyetId, setNguoiDuyetId] = useState("");
  const [dsLoi, setDsLoi] = useState<string[]>([]);

  function doiTick(bthId: string) {
    setDsChon((cu) => {
      const moi = new Set(cu);
      if (moi.has(bthId)) moi.delete(bthId);
      else moi.add(bthId);
      return moi;
    });
  }

  async function duyetChon() {
    setDsLoi([]);
    setKetQuaDuyet([]);
    try {
      const kq = await api<{ ds_ket_qua: KetQuaDuyet[] }>(
        `/api/campaign/${cp.id}/duyet`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            ds: [...dsChon].map((bthId) => ({
              ban_the_hien_id: bthId,
              nguoi_duyet_id: nguoiDuyetId || undefined,
            })),
          }),
        },
      );
      setKetQuaDuyet(kq.ds_ket_qua);
      setDsChon(new Set());
      reload();
    } catch (e) {
      setDsLoi(docDsLoi(e));
    }
  }

  return (
    <Card mb="4" key={tt.id}>
      <Flex direction="column" gap="2">
        <Flex align="center" gap="2">
          <Text size="2" weight="bold">
            Biến thể — {tt.ten} ({tt.ma}, {tt.ngon_ngu})
          </Text>
          {tt.chua_du && <Badge color="red">chưa đủ fact</Badge>}
          {tt.bat_buoc_duyet === 1 && <Badge color="orange">bắt buộc reviewer</Badge>}
        </Flex>
        {tt.ds_bien_the.length === 0 && (
          <Text size="2" color="gray">
            Chưa có biến thể — chọn tổ hợp ở trên để sinh.
          </Text>
        )}
        {tt.ds_bien_the.length > 0 && (
          <Table.Root>
            <Table.Header>
              <Table.Row>
                <Table.ColumnHeaderCell></Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>Định dạng</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>Đối tượng</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>Đích</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>Trạng thái</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>Nguồn chung</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>Reviewer</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>Ngoại lệ</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell></Table.ColumnHeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {tt.ds_bien_the.map((b) => (
                <Table.Row key={b.ban_the_hien_id}>
                  <Table.Cell>
                    <Checkbox
                      checked={dsChon.has(b.ban_the_hien_id)}
                      onCheckedChange={() => doiTick(b.ban_the_hien_id)}
                      disabled={b.trang_thai === "thay_the"}
                    />
                  </Table.Cell>
                  <Table.Cell>{b.dinh_dang}</Table.Cell>
                  <Table.Cell>{b.doi_tuong || "Chung"}</Table.Cell>
                  <Table.Cell>{b.dich_den || "—"}</Table.Cell>
                  <Table.Cell>
                    <Badge color={MAU_TRANG_THAI[b.trang_thai] ?? "gray"}>
                      {NHAN_TRANG_THAI[b.trang_thai] ?? b.trang_thai}
                    </Badge>
                    {b.la_cu && (
                      <Badge color="red" ml="1">
                        cũ
                      </Badge>
                    )}
                    {b.da_xuat && (
                      <Badge color="green" ml="1">
                        đã xuất
                      </Badge>
                    )}
                  </Table.Cell>
                  <Table.Cell>
                    {b.revision_nguon_chung
                      ? `r${b.revision_nguon_chung.so_thu_tu}`
                      : "—"}
                  </Table.Cell>
                  <Table.Cell>{b.nguoi_duyet_cuoi?.ten ?? "—"}</Table.Cell>
                  <Table.Cell>
                    {b.ds_task_mo.length > 0 ? (
                      <Badge color="orange">{b.ds_task_mo.length} task mở</Badge>
                    ) : (
                      "—"
                    )}
                  </Table.Cell>
                  <Table.Cell>
                    <a href={`#/ban-the-hien?id=${b.ban_the_hien_id}`}>
                      <Text size="1" color="blue">
                        mở
                      </Text>
                    </a>
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table.Root>
        )}
        {tt.ds_bien_the.length > 0 && (
          <Flex gap="2" align="center" justify="end">
            {tt.ds_nguoi_duyet.length > 0 && (
              <Select.Root value={nguoiDuyetId || "khong"} onValueChange={(v: string) => setNguoiDuyetId(v === "khong" ? "" : v)}>
                <Select.Trigger placeholder="Reviewer local" />
                <Select.Content>
                  <Select.Item value="khong">— Không ghi reviewer —</Select.Item>
                  {tt.ds_nguoi_duyet.map((r) => (
                    <Select.Item key={r.id} value={r.id}>
                      {r.ten} ({r.vai_tro || r.id})
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select.Root>
            )}
            <Button onClick={duyetChon} disabled={dsChon.size === 0}>
              Duyệt {dsChon.size} biến thể đã chọn
            </Button>
          </Flex>
        )}
        {(ketQuaDuyet ?? []).length > 0 && (
          <Card>
            {(ketQuaDuyet ?? [])
              .filter((k) => k.thi_truong_ma === tt.ma)
              .map((k, i) => (
                <Flex key={i} gap="2" align="center">
                  <Badge color={k.ok ? "green" : "red"}>{k.ok ? "OK" : "Lỗi"}</Badge>
                  <Text size="2">{k.ban_the_hien_id.slice(0, 12)}</Text>
                  {k.loi && (
                    <Text size="1" color="red">
                      {k.loi}
                    </Text>
                  )}
                </Flex>
              ))}
          </Card>
        )}
        {dsLoi.length > 0 && (
          <Callout.Root color="red">
            {dsLoi.map((l, i) => (
              <Callout.Text key={i}>{l}</Callout.Text>
            ))}
          </Callout.Root>
        )}
      </Flex>
    </Card>
  );
}
