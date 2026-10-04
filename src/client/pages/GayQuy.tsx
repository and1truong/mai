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
  BanTheHien,
  Campaign,
  CtaLienKet,
  GhiChuQuyen,
  MucLuc,
  Nguon,
  TacDongGayQuy,
  TrichDanGayQuy,
} from "../../modules/content/index.ts";
import type { HoSoDoiTuong, HoSoThuongHieu } from "../../modules/context/index.ts";
import type { Asset } from "../../modules/nap/index.ts";
import type { GoiYKhoangTrong, ThamChieuView, TienDoSoBao } from "../../modules/so_bao/index.ts";
import type {
  GhiChuQuyenView,
  GoiYGayQuy,
  TacDongView,
  TrichDanView,
} from "../../modules/gay_quy/index.ts";

// Trang Chiến dịch gây quỹ (#10): campaign loại 'gay_quy' — bắt đầu từ
// mục tiêu gây quỹ (không phải một bài viết): mục tiêu + số tiền kèm
// tiền tệ, thông điệp lõi, tác động đã đạt/ước tính với con trỏ bằng
// chứng, trích dẫn có nguồn, CTA quyên góp (đích ngoài được cung cấp),
// ghi chú quyền/đồng ý của asset và ngôn ngữ thứ hai. Nguồn fact tự
// động chiếu mọi field thành mục nguồn — sửa field là đổi nguồn, đầu
// ra phụ thuộc được đánh dấu lại. Luồng duyệt/xuất dùng chung model
// bản thể hiện — trang này chỉ dựng input.

type ChiTietGayQuy = Campaign & {
  thong_diep: { id: string; tieu_de: string }[];
  thong_diep_chu_de: { id: string; tieu_de: string } | null;
  tham_chieu_view: ThamChieuView[];
  de_xuat_muc_luc: MucLuc[];
  goi_y: (GoiYKhoangTrong | GoiYGayQuy)[];
  tien_do: TienDoSoBao;
  hang_cho: BanTheHien[];
  gay_quy: {
    nguon_gay_quy: { id: string; tieu_de: string; head_revision_id: string | null } | null;
    ds_tac_dong_view: TacDongView[];
    ds_trich_dan_view: TrichDanView[];
    ghi_chu_quyen_view: GhiChuQuyenView[];
  } | null;
};

type PhatHien = { thay_doi: { id: string } | null; ds_task: { id: string }[] } | null;

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

const LOAI_CTA = ["quyen_gop", "tai_lieu", "nang_cap", "ho_tro", "chung"];
const NHAN_LOAI_CTA: Record<string, string> = {
  quyen_gop: "Quyên góp",
  tai_lieu: "Tài liệu",
  nang_cap: "Nâng cấp",
  ho_tro: "Hỗ trợ",
  chung: "Chung",
};
const NHAN_TAC_DONG: Record<string, string> = {
  da_dat: "Đã đạt",
  uoc_tinh: "Ước tính",
};

// Server lưu loai "chung" là chuỗi rỗng — UI giữ nhãn "chung" trong Select
// và map hai chiều khi đọc/ghi để không gửi giá trị server từ chối (400).
const loaiVeUI = (v: string) => (v === "" ? "chung" : v);
const loaiVeApi = (v: string) => (v === "chung" ? "" : v);

const idMoi = (tienTo: string) => `${tienTo}-${crypto.randomUUID().slice(0, 8)}`;

export default function GayQuyPage() {
  const path = useHashRoute();
  const id = new URLSearchParams(path.split("?")[1] ?? "").get("id");
  return id ? <ChiTietGayQuyView id={id} /> : <DanhSachGayQuy />;
}

// --- Danh sách + tạo chiến dịch gây quỹ ---

function DanhSachGayQuy() {
  const { data, loading, error, reload } = useApi<Campaign[]>("/api/gay-quy");
  const [ten, setTen] = useState("");
  const [mucTieu, setMucTieu] = useState("");
  const [soTien, setSoTien] = useState("");
  const [tienTe, setTienTe] = useState("");
  const [dsLoi, setDsLoi] = useState<string[]>([]);
  const [dangGui, setDangGui] = useState(false);

  async function tao() {
    setDangGui(true);
    setDsLoi([]);
    try {
      const cp = await api<Campaign>("/api/campaign", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          loai: "gay_quy",
          ten,
          muc_tieu: mucTieu,
          so_tien_muc_tieu: soTien.trim() === "" ? null : Number(soTien),
          tien_te: tienTe,
        }),
      });
      window.location.hash = `#/gay-quy?id=${cp.id}`;
    } catch (e) {
      if (e instanceof LoiApiClient) {
        setDsLoi([e.message, ...(Array.isArray(e.chiTiet) ? e.chiTiet.map(String) : [])]);
      } else {
        setDsLoi([String(e)]);
      }
      setDangGui(false);
      reload();
    }
  }

  const hienSoTien = (cp: Campaign) =>
    cp.so_tien_muc_tieu !== null
      ? `${cp.so_tien_muc_tieu.toLocaleString("vi-VN")}${cp.tien_te ? ` ${cp.tien_te}` : ""}`
      : "—";

  return (
    <>
      <Heading mb="3">Chiến dịch gây quỹ</Heading>
      <Card mb="4">
        <Flex direction="column" gap="2">
          <Text size="2" weight="bold">
            Tạo chiến dịch gây quỹ mới
          </Text>
          <Text size="1" color="gray">
            Bắt đầu từ mục tiêu, không phải một bài viết — kế hoạch truyền
            thông nối đối tượng, thông điệp lõi, bằng chứng và CTA quyên góp.
          </Text>
          <Flex gap="2" wrap="wrap">
            <TextField.Root
              placeholder="Tên chiến dịch (bắt buộc)"
              value={ten}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTen(e.target.value)}
              style={{ flex: 2, minWidth: 220 }}
            />
            <TextField.Root
              placeholder="Số tiền mục tiêu (vd: 1200000000)"
              value={soTien}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSoTien(e.target.value)}
              style={{ width: 220 }}
            />
            <TextField.Root
              placeholder="Tiền tệ (vd: VND)"
              value={tienTe}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTienTe(e.target.value)}
              style={{ width: 140 }}
            />
          </Flex>
          <TextField.Root
            placeholder="Mục tiêu (vd: gây quỹ cho công trình nước sạch ngôi làng tiếp theo)"
            value={mucTieu}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setMucTieu(e.target.value)}
          />
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
              <Table.ColumnHeaderCell>Tên</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>Mục tiêu</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>Số tiền mục tiêu</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>Tạo lúc</Table.ColumnHeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {(data ?? []).map((cp) => (
              <Table.Row key={cp.id}>
                <Table.Cell>
                  <a href={`#/gay-quy?id=${cp.id}`}>{cp.ten}</a>
                </Table.Cell>
                <Table.Cell>{cp.muc_tieu || "—"}</Table.Cell>
                <Table.Cell>{hienSoTien(cp)}</Table.Cell>
                <Table.Cell>{fmtLuc(cp.tao_luc)}</Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Root>
      </TrangThai>
    </>
  );
}

// --- Chi tiết một chiến dịch gây quỹ ---

function ChiTietGayQuyView({ id }: { id: string }) {
  const chiTiet = useApi<ChiTietGayQuy>(`/api/campaign/${id}`, [id]);
  const dsDinhDang = useApi<{ id: string; nhan: string }[]>("/api/dinh-dang");
  const dsDoiTuong = useApi<HoSoDoiTuong[]>("/api/ho-so-doi-tuong");
  const dsThuongHieu = useApi<HoSoThuongHieu[]>("/api/ho-so-thuong-hieu");
  const dsNguon = useApi<Nguon[]>("/api/nguon");
  const dsAsset = useApi<Asset[]>("/api/assets");
  const dsDauRa = useApi<BanTheHien[]>(`/api/ban-the-hien?campaign_id=${id}`, [id]);

  const [form, setForm] = useState({
    ten: "",
    mo_ta: "",
    muc_tieu: "",
    so_tien_muc_tieu: "",
    tien_te: "",
    thong_diep_loi: "",
    ngon_ngu_phu: "",
    thuong_hieu_id: "",
    doi_tuong_id: "",
  });
  const [dsTacDong, setDsTacDong] = useState<TacDongGayQuy[]>([]);
  const [dsTrichDan, setDsTrichDan] = useState<TrichDanGayQuy[]>([]);
  const [cta, setCta] = useState<CtaLienKet[]>([]);
  const [ghiChuQuyen, setGhiChuQuyen] = useState<GhiChuQuyen[]>([]);
  const [mucLuc, setMucLuc] = useState<MucLuc[]>([]);
  const [mucLucDirty, setMucLucDirty] = useState(false);
  const [keHoachDirty, setKeHoachDirty] = useState(false);
  const [chon, setChon] = useState<Set<string>>(new Set());
  const [dsLoi, setDsLoi] = useState<string[]>([]);
  const [trangThaiLuu, setTrangThaiLuu] = useState("");
  const [thongBaoPhatHien, setThongBaoPhatHien] = useState("");
  const [dangSinh, setDangSinh] = useState(false);
  const [nguonLienKet, setNguonLienKet] = useState<Record<string, string>>({});
  const [tcMoi, setTcMoi] = useState({ tham_chieu: "", nguon_id: "", ghi_chu: "" });

  useEffect(() => {
    const cp = chiTiet.data;
    if (!cp) return;
    setForm({
      ten: cp.ten,
      mo_ta: cp.mo_ta,
      muc_tieu: cp.muc_tieu,
      so_tien_muc_tieu: cp.so_tien_muc_tieu !== null ? String(cp.so_tien_muc_tieu) : "",
      tien_te: cp.tien_te,
      thong_diep_loi: cp.thong_diep_loi,
      ngon_ngu_phu: cp.ngon_ngu_phu,
      thuong_hieu_id: cp.thuong_hieu_id ?? "",
      doi_tuong_id: cp.doi_tuong_id ?? "",
    });
    setDsTacDong(cp.ds_tac_dong);
    setDsTrichDan(cp.ds_trich_dan);
    setCta(cp.cta.map((c) => ({ ...c, loai: loaiVeUI(c.loai) })));
    setGhiChuQuyen(cp.ghi_chu_quyen);
    setMucLuc(cp.muc_luc);
    setMucLucDirty(false);
    setKeHoachDirty(false);
    setNguonLienKet({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chiTiet.data?.id]);

  // Resync mục lục khi server đổi mà user không sửa cục bộ.
  useEffect(() => {
    const cp = chiTiet.data;
    if (!cp || mucLucDirty) return;
    setMucLuc(cp.muc_luc);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chiTiet.data, mucLucDirty]);

  function loiText(e: unknown): string[] {
    if (e instanceof LoiApiClient) {
      return [
        `${e.ma}: ${e.message}`,
        ...(Array.isArray(e.chiTiet) ? (e.chiTiet as unknown[]).map(String) : []),
      ];
    }
    return [String(e)];
  }

  // Một nút lưu cho mọi field kế hoạch — PUT gửi đủ mảng (server thay
  // toàn bộ mảng có mặt). Đổi field → nguồn fact tự động nhận revision
  // mới → server trả phat_hien để báo đầu ra bị ảnh hưởng.
  async function luuKeHoach() {
    setDsLoi([]);
    setTrangThaiLuu("");
    setThongBaoPhatHien("");
    try {
      const kq = await api<Campaign & { phat_hien?: PhatHien }>(`/api/campaign/${id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ten: form.ten,
          mo_ta: form.mo_ta,
          muc_tieu: form.muc_tieu,
          so_tien_muc_tieu:
            form.so_tien_muc_tieu.trim() === "" ? null : Number(form.so_tien_muc_tieu),
          tien_te: form.tien_te,
          thong_diep_loi: form.thong_diep_loi,
          ngon_ngu_phu: form.ngon_ngu_phu,
          thuong_hieu_id: form.thuong_hieu_id || null,
          doi_tuong_id: form.doi_tuong_id || null,
          cta: cta.map((c) => ({ ...c, loai: loaiVeApi(c.loai) })),
          ds_tac_dong: dsTacDong,
          ds_trich_dan: dsTrichDan,
          ghi_chu_quyen: ghiChuQuyen,
        }),
      });
      setKeHoachDirty(false);
      setTrangThaiLuu(`Đã lưu ${new Date().toLocaleTimeString("vi")}`);
      if (kq.phat_hien?.thay_doi) {
        const n = kq.phat_hien.ds_task.length;
        setThongBaoPhatHien(
          `Nguồn chiến dịch vừa đổi — ${n > 0 ? `${n} task sửa mới cho đầu ra phụ thuộc` : "không có đầu ra nào bị ảnh hưởng"}. Xem trang Thay đổi.`,
        );
      }
      chiTiet.reload();
    } catch (e) {
      setDsLoi(loiText(e));
    }
  }

  async function luuMucLuc() {
    setDsLoi([]);
    try {
      const cpMoi = await api<Campaign>(`/api/campaign/${id}/muc-luc`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ muc_luc: mucLuc }),
      });
      setMucLuc(cpMoi.muc_luc);
      setMucLucDirty(false);
      setTrangThaiLuu(`Đã lưu mục lục ${new Date().toLocaleTimeString("vi")}`);
      chiTiet.reload();
    } catch (e) {
      setDsLoi(loiText(e));
    }
  }

  async function sinhChon() {
    if (chonHopLe.size === 0) {
      setDsLoi(["Tick ít nhất một đầu ra trong mục lục để nháp."]);
      return;
    }
    setDsLoi([]);
    setDangSinh(true);
    try {
      await api(`/api/campaign/${id}/chon`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ds_muc_id: [...chonHopLe] }),
      });
      setChon(new Set());
      chiTiet.reload();
      dsDauRa.reload();
    } catch (e) {
      setDsLoi(loiText(e));
    } finally {
      setDangSinh(false);
    }
  }

  async function lienKetNguon(refId: string) {
    const nguonId = nguonLienKet[refId];
    if (!nguonId) {
      setDsLoi(["Chọn nguồn trước khi liên kết."]);
      return;
    }
    setDsLoi([]);
    try {
      await api(`/api/campaign/${id}/tham-chieu/${refId}/nguon`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ nguon_id: nguonId }),
      });
      chiTiet.reload();
    } catch (e) {
      setDsLoi(loiText(e));
    }
  }

  async function themThamChieu() {
    const cp = chiTiet.data;
    if (!cp) return;
    if (!tcMoi.tham_chieu.trim()) {
      setDsLoi(["Tài liệu mới cần nhãn (vd: ghi chú hiện trường làng A)."]);
      return;
    }
    setDsLoi([]);
    try {
      await api(`/api/campaign/${id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ten: cp.ten,
          tham_chieu: [
            ...cp.tham_chieu,
            {
              id: idMoi("tc"),
              tham_chieu: tcMoi.tham_chieu.trim(),
              ban_dich: "",
              nguon_id: tcMoi.nguon_id || null,
              ghi_chu: tcMoi.ghi_chu.trim(),
            },
          ],
        }),
      });
      setTcMoi({ tham_chieu: "", nguon_id: "", ghi_chu: "" });
      chiTiet.reload();
    } catch (e) {
      setDsLoi(loiText(e));
    }
  }

  async function themMucGoiY(muc: MucLuc) {
    setDsLoi([]);
    try {
      const cpMoi = await api<Campaign>(`/api/campaign/${id}/muc-luc/them`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ muc }),
      });
      if (mucLucDirty) {
        const moi = cpMoi.muc_luc.at(-1);
        if (moi && !mucLuc.some((m) => m.id === moi.id)) setMucLuc([...mucLuc, moi]);
      } else {
        setMucLuc(cpMoi.muc_luc);
      }
      chiTiet.reload();
    } catch (e) {
      setDsLoi(loiText(e));
    }
  }

  function suaMucLuc(ds: MucLuc[]) {
    setMucLuc(ds);
    setMucLucDirty(true);
  }

  function apDungMauDeXuat() {
    const cp = chiTiet.data;
    if (!cp) return;
    const daCo = new Set(mucLuc.map((m) => m.id));
    suaMucLuc([...mucLuc, ...cp.de_xuat_muc_luc.filter((m) => !daCo.has(m.id))]);
  }

  const cp = chiTiet.data;
  const nhanDd = (dd: string) => dsDinhDang.data?.find((x) => x.id === dd)?.nhan ?? dd;
  const bthCuaMuc = new Map<string, { bth: BanTheHien; daXuat: boolean }>();
  for (const m of cp?.tien_do.muc ?? []) {
    if (m.ban_the_hien) bthCuaMuc.set(m.muc.id, { bth: m.ban_the_hien, daXuat: m.da_xuat_ban });
  }
  const idDaLuu = new Set((cp?.muc_luc ?? []).map((m) => m.id));
  const chonHopLe = new Set([...chon].filter((x) => idDaLuu.has(x)));
  const tdView = cp?.gay_quy?.ds_tac_dong_view ?? [];
  const tqView = cp?.gay_quy?.ds_trich_dan_view ?? [];
  const quyenView = cp?.gay_quy?.ghi_chu_quyen_view ?? [];
  const nguonGq = cp?.gay_quy?.nguon_gay_quy ?? null;
  // Ngôn ngữ cho phép trên đầu ra: vi + ngôn ngữ thứ hai đã chọn.
  const dsNgonNgu = ["vi", ...(cp?.ngon_ngu_phu ? [cp.ngon_ngu_phu] : [])];

  return (
    <>
      <Flex align="center" justify="between" mb="3">
        <Heading>
          Chiến dịch gây quỹ{cp?.ten ? ` — ${cp.ten}` : ""}
        </Heading>
        <a href="#/gay-quy">← Danh sách chiến dịch</a>
      </Flex>
      <TrangThai loading={chiTiet.loading} error={chiTiet.error} empty={!cp}>
        {cp && (
          <Flex direction="column" gap="4">
            {dsLoi.length > 0 && (
              <Callout.Root color="red">
                {dsLoi.map((l, i) => (
                  <Callout.Text key={i}>{l}</Callout.Text>
                ))}
              </Callout.Root>
            )}
            {thongBaoPhatHien && (
              <Callout.Root color="amber">
                <Callout.Text>{thongBaoPhatHien}</Callout.Text>
              </Callout.Root>
            )}

            {/* Mục tiêu + thông tin chiến dịch */}
            <Card>
              <Flex direction="column" gap="2">
                <Flex justify="between" align="center">
                  <Text size="2" weight="bold">
                    Mục tiêu gây quỹ
                  </Text>
                  <Flex gap="2" align="center">
                    {keHoachDirty && (
                      <Text size="1" color="amber">
                        Có sửa chưa lưu
                      </Text>
                    )}
                    {trangThaiLuu && (
                      <Text size="1" color="gray">
                        {trangThaiLuu}
                      </Text>
                    )}
                    <Button size="1" variant="soft" onClick={luuKeHoach}>
                      Lưu kế hoạch
                    </Button>
                  </Flex>
                </Flex>
                <Flex gap="2" wrap="wrap">
                  <TextField.Root
                    value={form.ten}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                      setForm({ ...form, ten: e.target.value });
                      setKeHoachDirty(true);
                    }}
                    placeholder="Tên chiến dịch"
                    style={{ flex: 2, minWidth: 220 }}
                  />
                  <TextField.Root
                    value={form.so_tien_muc_tieu}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                      setForm({ ...form, so_tien_muc_tieu: e.target.value });
                      setKeHoachDirty(true);
                    }}
                    placeholder="Số tiền mục tiêu"
                    style={{ width: 180 }}
                  />
                  <TextField.Root
                    value={form.tien_te}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                      setForm({ ...form, tien_te: e.target.value });
                      setKeHoachDirty(true);
                    }}
                    placeholder="Tiền tệ (vd: VND)"
                    style={{ width: 140 }}
                  />
                  <TextField.Root
                    value={form.ngon_ngu_phu}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                      setForm({ ...form, ngon_ngu_phu: e.target.value });
                      setKeHoachDirty(true);
                    }}
                    placeholder="Ngôn ngữ 2 (vd: en)"
                    style={{ width: 150 }}
                  />
                </Flex>
                <TextArea
                  value={form.muc_tieu}
                  onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => {
                    setForm({ ...form, muc_tieu: e.target.value });
                    setKeHoachDirty(true);
                  }}
                  placeholder="Mục tiêu gây quỹ — mục tiêu tương lai, đầu ra phải phân biệt với tác động đã đạt"
                  rows={2}
                />
                <TextArea
                  value={form.thong_diep_loi}
                  onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => {
                    setForm({ ...form, thong_diep_loi: e.target.value });
                    setKeHoachDirty(true);
                  }}
                  placeholder="Thông điệp lõi — câu nối tác động đã đạt với lời kêu gọi; bộ sinh giữ đúng hướng này"
                  rows={2}
                />
                <TextField.Root
                  value={form.mo_ta}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                    setForm({ ...form, mo_ta: e.target.value });
                    setKeHoachDirty(true);
                  }}
                  placeholder="Mô tả ngắn"
                />
                <Flex gap="2" wrap="wrap">
                  <Select.Root
                    value={form.thuong_hieu_id || "__none__"}
                    onValueChange={(v) => {
                      setForm({ ...form, thuong_hieu_id: v === "__none__" ? "" : v });
                      setKeHoachDirty(true);
                    }}
                  >
                    <Select.Trigger placeholder="Thương hiệu…" />
                    <Select.Content>
                      <Select.Item value="__none__">Không gắn thương hiệu</Select.Item>
                      {(dsThuongHieu.data ?? []).map((t) => (
                        <Select.Item key={t.id} value={t.id}>
                          {t.ten}
                        </Select.Item>
                      ))}
                    </Select.Content>
                  </Select.Root>
                  <Select.Root
                    value={form.doi_tuong_id || "__none__"}
                    onValueChange={(v) => {
                      setForm({ ...form, doi_tuong_id: v === "__none__" ? "" : v });
                      setKeHoachDirty(true);
                    }}
                  >
                    <Select.Trigger placeholder="Đối tượng chính…" />
                    <Select.Content>
                      <Select.Item value="__none__">Không gắn đối tượng</Select.Item>
                      {(dsDoiTuong.data ?? []).map((d) => (
                        <Select.Item key={d.id} value={d.id}>
                          {d.ten}
                        </Select.Item>
                      ))}
                    </Select.Content>
                  </Select.Root>
                  {cp.thong_diep_chu_de && (
                    <Button size="1" variant="outline" asChild>
                      <a href={`#/thong-diep?id=${cp.thong_diep_chu_de.id}`}>
                        Thông điệp chủ đề: {cp.thong_diep_chu_de.tieu_de}
                      </a>
                    </Button>
                  )}
                  {nguonGq && (
                    <Button size="1" variant="outline" asChild>
                      <a href={`#/nguon?id=${nguonGq.id}`}>Nguồn fact tự động</a>
                    </Button>
                  )}
                  <Button size="1" variant="outline" asChild>
                    <a href={`/api/campaign/${id}/xuat`} download>
                      Tải gói (ZIP)
                    </a>
                  </Button>
                </Flex>
                <Text size="1" color="gray">
                  Nguồn fact tự động chiếu toàn bộ field chiến dịch thành mục nguồn — sửa field
                  ở đây là đổi nguồn, đầu ra phụ thuộc được đánh dấu lại.
                </Text>
              </Flex>
            </Card>

            {/* Tác động đã đạt / ước tính — mỗi mục trỏ bằng chứng */}
            <Card>
              <Flex direction="column" gap="2">
                <Text size="2" weight="bold">
                  Tác động ({dsTacDong.length})
                </Text>
                <Text size="1" color="gray">
                  Mỗi tác động phải trỏ nguồn đã nạp (ghi chú hiện trường, số liệu). "Đã đạt"
                  và "ước tính" là hai trạng thái khác nhau — đầu ra không được trộn, ước
                  tính luôn phải ghi rõ. Mục không có bằng chứng chỉ được để dạng câu hỏi.
                </Text>
                {dsTacDong.map((t, i) => {
                  const view = tdView[i];
                  const nguonChon = dsNguon.data?.find((n) => n.id === t.nguon_id) ?? null;
                  return (
                    <Card key={t.id} variant="surface">
                      <Flex direction="column" gap="2">
                        <Flex gap="2" align="center" wrap="wrap">
                          <Badge variant="outline">{t.id}</Badge>
                          <Select.Root
                            value={t.trang_thai || "da_dat"}
                            onValueChange={(v) => {
                              const ds = [...dsTacDong];
                              ds[i] = { ...t, trang_thai: v as TacDongGayQuy["trang_thai"] };
                              setDsTacDong(ds);
                              setKeHoachDirty(true);
                            }}
                          >
                            <Select.Trigger />
                            <Select.Content>
                              <Select.Item value="da_dat">Đã đạt</Select.Item>
                              <Select.Item value="uoc_tinh">Ước tính</Select.Item>
                            </Select.Content>
                          </Select.Root>
                          <TextField.Root
                            value={t.tieu_de}
                            onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                              const ds = [...dsTacDong];
                              ds[i] = { ...t, tieu_de: e.target.value };
                              setDsTacDong(ds);
                              setKeHoachDirty(true);
                            }}
                            placeholder="Tác động (vd: Giếng khoan làng Bản Rọm)"
                            style={{ minWidth: 200, flex: 1 }}
                          />
                          <TextField.Root
                            value={t.so_lieu}
                            onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                              const ds = [...dsTacDong];
                              ds[i] = { ...t, so_lieu: e.target.value };
                              setDsTacDong(ds);
                              setKeHoachDirty(true);
                            }}
                            placeholder="Số liệu (vd: 1.240)"
                            style={{ width: 130 }}
                          />
                          <TextField.Root
                            value={t.don_vi}
                            onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                              const ds = [...dsTacDong];
                              ds[i] = { ...t, don_vi: e.target.value };
                              setDsTacDong(ds);
                              setKeHoachDirty(true);
                            }}
                            placeholder="Đơn vị (vd: người)"
                            style={{ width: 120 }}
                          />
                          {view &&
                            (view.co_bang_chung ? (
                              <Badge color="green">
                                Có bằng chứng
                                {view.nguon?.tieu_de ? ` — ${view.nguon.tieu_de}` : ""}
                              </Badge>
                            ) : (
                              <Badge color="amber">Chưa xác nhận</Badge>
                            ))}
                          <Button
                            size="1"
                            variant="ghost"
                            color="red"
                            onClick={() => {
                              setDsTacDong(dsTacDong.filter((x) => x.id !== t.id));
                              setKeHoachDirty(true);
                            }}
                          >
                            Xóa
                          </Button>
                        </Flex>
                        <TextArea
                          value={t.noi_dung}
                          onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => {
                            const ds = [...dsTacDong];
                            ds[i] = { ...t, noi_dung: e.target.value };
                            setDsTacDong(ds);
                            setKeHoachDirty(true);
                          }}
                          placeholder="Nội dung tác động — phải từ tư liệu đã nạp, không bịa số đo"
                          rows={2}
                        />
                        <Flex gap="2" wrap="wrap">
                          <Select.Root
                            value={t.nguon_id || "__none__"}
                            onValueChange={(v) => {
                              const ds = [...dsTacDong];
                              ds[i] = { ...t, nguon_id: v === "__none__" ? null : v, muc_id: null };
                              setDsTacDong(ds);
                              setKeHoachDirty(true);
                            }}
                          >
                            <Select.Trigger placeholder="Nguồn bằng chứng…" />
                            <Select.Content>
                              <Select.Item value="__none__">Chưa có bằng chứng</Select.Item>
                              {(dsNguon.data ?? []).map((n) => (
                                <Select.Item key={n.id} value={n.id}>
                                  {n.tieu_de}
                                </Select.Item>
                              ))}
                            </Select.Content>
                          </Select.Root>
                          {nguonChon && nguonChon.cac_muc.length > 0 && (
                            <Select.Root
                              value={t.muc_id || "__all__"}
                              onValueChange={(v) => {
                                const ds = [...dsTacDong];
                                ds[i] = { ...t, muc_id: v === "__all__" ? null : v };
                                setDsTacDong(ds);
                                setKeHoachDirty(true);
                              }}
                            >
                              <Select.Trigger placeholder="Mục (tùy chọn)…" />
                              <Select.Content>
                                <Select.Item value="__all__">Cả nguồn</Select.Item>
                                {nguonChon.cac_muc.map((m) => (
                                  <Select.Item key={m.id} value={m.id}>
                                    {m.tieu_de || m.id}
                                  </Select.Item>
                                ))}
                              </Select.Content>
                            </Select.Root>
                          )}
                        </Flex>
                      </Flex>
                    </Card>
                  );
                })}
                <Button
                  size="1"
                  variant="outline"
                  style={{ alignSelf: "flex-start" }}
                  onClick={() => {
                    setDsTacDong([
                      ...dsTacDong,
                      {
                        id: idMoi("td"),
                        tieu_de: "",
                        noi_dung: "",
                        trang_thai: "da_dat",
                        so_lieu: "",
                        don_vi: "",
                        nguon_id: null,
                        muc_id: null,
                      },
                    ]);
                    setKeHoachDirty(true);
                  }}
                >
                  + Thêm tác động
                </Button>
              </Flex>
            </Card>

            {/* Trích dẫn — chỉ từ tư liệu đã cung cấp */}
            <Card>
              <Flex direction="column" gap="2">
                <Text size="2" weight="bold">
                  Trích dẫn ({dsTrichDan.length})
                </Text>
                <Text size="1" color="gray">
                  Lời người trong câu chuyện nhân văn chỉ được đến từ đây — không bịa tên
                  hay lời người thụ hưởng. Mỗi trích dẫn trỏ ghi chú hiện trường đã nạp.
                </Text>
                {dsTrichDan.map((t, i) => {
                  const view = tqView[i];
                  const nguonChon = dsNguon.data?.find((n) => n.id === t.nguon_id) ?? null;
                  return (
                    <Card key={t.id} variant="surface">
                      <Flex direction="column" gap="2">
                        <Flex gap="2" align="center" wrap="wrap">
                          <Badge variant="outline">{t.id}</Badge>
                          <TextField.Root
                            value={t.ten_nguoi}
                            onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                              const ds = [...dsTrichDan];
                              ds[i] = { ...t, ten_nguoi: e.target.value };
                              setDsTrichDan(ds);
                              setKeHoachDirty(true);
                            }}
                            placeholder="Tên người như trong tư liệu"
                            style={{ minWidth: 200, flex: 1 }}
                          />
                          {view &&
                            (view.co_bang_chung ? (
                              <Badge color="green">
                                Có nguồn{view.nguon?.tieu_de ? ` — ${view.nguon.tieu_de}` : ""}
                              </Badge>
                            ) : (
                              <Badge color="amber">Chưa có nguồn</Badge>
                            ))}
                          <Button
                            size="1"
                            variant="ghost"
                            color="red"
                            onClick={() => {
                              setDsTrichDan(dsTrichDan.filter((x) => x.id !== t.id));
                              setKeHoachDirty(true);
                            }}
                          >
                            Xóa
                          </Button>
                        </Flex>
                        <TextArea
                          value={t.loi}
                          onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => {
                            const ds = [...dsTrichDan];
                            ds[i] = { ...t, loi: e.target.value };
                            setDsTrichDan(ds);
                            setKeHoachDirty(true);
                          }}
                          placeholder="Lời nguyên văn trong tư liệu — đầu ra chỉ được dùng lời này"
                          rows={2}
                        />
                        <Flex gap="2" wrap="wrap">
                          <Select.Root
                            value={t.nguon_id || "__none__"}
                            onValueChange={(v) => {
                              const ds = [...dsTrichDan];
                              ds[i] = { ...t, nguon_id: v === "__none__" ? null : v, muc_id: null };
                              setDsTrichDan(ds);
                              setKeHoachDirty(true);
                            }}
                          >
                            <Select.Trigger placeholder="Nguồn tư liệu…" />
                            <Select.Content>
                              <Select.Item value="__none__">Chưa có nguồn</Select.Item>
                              {(dsNguon.data ?? []).map((n) => (
                                <Select.Item key={n.id} value={n.id}>
                                  {n.tieu_de}
                                </Select.Item>
                              ))}
                            </Select.Content>
                          </Select.Root>
                          {nguonChon && nguonChon.cac_muc.length > 0 && (
                            <Select.Root
                              value={t.muc_id || "__all__"}
                              onValueChange={(v) => {
                                const ds = [...dsTrichDan];
                                ds[i] = { ...t, muc_id: v === "__all__" ? null : v };
                                setDsTrichDan(ds);
                                setKeHoachDirty(true);
                              }}
                            >
                              <Select.Trigger placeholder="Mục (tùy chọn)…" />
                              <Select.Content>
                                <Select.Item value="__all__">Cả nguồn</Select.Item>
                                {nguonChon.cac_muc.map((m) => (
                                  <Select.Item key={m.id} value={m.id}>
                                    {m.tieu_de || m.id}
                                  </Select.Item>
                                ))}
                              </Select.Content>
                            </Select.Root>
                          )}
                        </Flex>
                      </Flex>
                    </Card>
                  );
                })}
                <Button
                  size="1"
                  variant="outline"
                  style={{ alignSelf: "flex-start" }}
                  onClick={() => {
                    setDsTrichDan([
                      ...dsTrichDan,
                      { id: idMoi("tq"), ten_nguoi: "", loi: "", nguon_id: null, muc_id: null },
                    ]);
                    setKeHoachDirty(true);
                  }}
                >
                  + Thêm trích dẫn
                </Button>
              </Flex>
            </Card>

            {/* Link CTA — quyên góp trỏ đích ngoài được cung cấp */}
            <Card>
              <Flex direction="column" gap="2">
                <Text size="2" weight="bold">
                  Link CTA ({cta.length})
                </Text>
                <Text size="1" color="gray">
                  CTA loại "Quyên góp" trỏ đúng đích ngoài do tổ chức cung cấp — xem trước
                  đầu ra hiện link cuối này trước khi duyệt.
                </Text>
                {cta.map((c, i) => (
                  <Flex key={c.id} gap="2" align="center" wrap="wrap">
                    <TextField.Root
                      value={c.nhan}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                        const ds = [...cta];
                        ds[i] = { ...c, nhan: e.target.value };
                        setCta(ds);
                        setKeHoachDirty(true);
                      }}
                      placeholder="Nhãn (vd: Quyên góp ngay)"
                      style={{ minWidth: 180 }}
                    />
                    <Select.Root
                      value={c.loai}
                      onValueChange={(v) => {
                        const ds = [...cta];
                        ds[i] = { ...c, loai: v };
                        setCta(ds);
                        setKeHoachDirty(true);
                      }}
                    >
                      <Select.Trigger />
                      <Select.Content>
                        {LOAI_CTA.map((l) => (
                          <Select.Item key={l} value={l}>
                            {NHAN_LOAI_CTA[l] ?? l}
                          </Select.Item>
                        ))}
                      </Select.Content>
                    </Select.Root>
                    <TextField.Root
                      value={c.url}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                        const ds = [...cta];
                        ds[i] = { ...c, url: e.target.value };
                        setCta(ds);
                        setKeHoachDirty(true);
                      }}
                      placeholder="https://…"
                      style={{ flex: 1, minWidth: 240 }}
                    />
                    <Button
                      size="1"
                      variant="ghost"
                      color="red"
                      onClick={() => {
                        setCta(cta.filter((x) => x.id !== c.id));
                        setKeHoachDirty(true);
                      }}
                    >
                      Xóa
                    </Button>
                  </Flex>
                ))}
                <Button
                  size="1"
                  variant="outline"
                  style={{ alignSelf: "flex-start" }}
                  onClick={() => {
                    setCta([...cta, { id: idMoi("cta"), nhan: "", loai: "quyen_gop", url: "" }]);
                    setKeHoachDirty(true);
                  }}
                >
                  + Thêm CTA
                </Button>
              </Flex>
            </Card>

            {/* Ghi chú quyền/đồng ý của asset tổ chức cung cấp */}
            <Card>
              <Flex direction="column" gap="2">
                <Text size="2" weight="bold">
                  Ghi chú quyền asset ({ghiChuQuyen.length})
                </Text>
                <Text size="1" color="gray">
                  Quyền/đồng ý sử dụng của từng asset do tổ chức cung cấp — hiển thị trên
                  màn review khi đầu ra đính kèm asset đó.
                </Text>
                {ghiChuQuyen.map((q, i) => {
                  const view = quyenView[i];
                  return (
                    <Flex key={q.id} gap="2" align="center" wrap="wrap">
                      <Select.Root
                        value={q.asset_id || "__none__"}
                        onValueChange={(v) => {
                          const ds = [...ghiChuQuyen];
                          ds[i] = { ...q, asset_id: v === "__none__" ? "" : v };
                          setGhiChuQuyen(ds);
                          setKeHoachDirty(true);
                        }}
                      >
                        <Select.Trigger placeholder="Asset…" />
                        <Select.Content>
                          <Select.Item value="__none__">Chọn asset</Select.Item>
                          {(dsAsset.data ?? []).map((a) => (
                            <Select.Item key={a.id} value={a.id}>
                              {a.ten_file}
                            </Select.Item>
                          ))}
                        </Select.Content>
                      </Select.Root>
                      <TextField.Root
                        value={q.ghi_chu}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                          const ds = [...ghiChuQuyen];
                          ds[i] = { ...q, ghi_chu: e.target.value };
                          setGhiChuQuyen(ds);
                          setKeHoachDirty(true);
                        }}
                        placeholder="Ghi chú quyền/đồng ý (vd: đã có đồng ý bằng văn bản của người trong ảnh)"
                        style={{ flex: 1, minWidth: 280 }}
                      />
                      {view?.asset === null && <Badge color="amber">Asset đã xóa</Badge>}
                      <Button
                        size="1"
                        variant="ghost"
                        color="red"
                        onClick={() => {
                          setGhiChuQuyen(ghiChuQuyen.filter((x) => x.id !== q.id));
                          setKeHoachDirty(true);
                        }}
                      >
                        Xóa
                      </Button>
                    </Flex>
                  );
                })}
                <Button
                  size="1"
                  variant="outline"
                  style={{ alignSelf: "flex-start" }}
                  onClick={() => {
                    setGhiChuQuyen([
                      ...ghiChuQuyen,
                      { id: idMoi("q"), asset_id: "", ghi_chu: "" },
                    ]);
                    setKeHoachDirty(true);
                  }}
                >
                  + Thêm ghi chú quyền
                </Button>
              </Flex>
            </Card>

            {/* Tư liệu bằng chứng = nguồn đã nạp đưa vào provenance */}
            <Card>
              <Flex direction="column" gap="2">
                <Text size="2" weight="bold">
                  Tư liệu bằng chứng (tham chiếu nguồn)
                </Text>
                <Text size="1" color="gray">
                  Ghi chú hiện trường, số liệu đo, tư liệu tổ chức đã nạp vào Nguồn rồi khai
                  báo ở đây — chỉ nguồn trong danh sách này (và nguồn fact tự động) được
                  đưa vào context sinh cho mọi đầu ra của chiến dịch.
                </Text>
                <Table.Root>
                  <Table.Header>
                    <Table.Row>
                      <Table.ColumnHeaderCell>Tài liệu</Table.ColumnHeaderCell>
                      <Table.ColumnHeaderCell>Nguồn đã nạp</Table.ColumnHeaderCell>
                      <Table.ColumnHeaderCell>Ghi chú</Table.ColumnHeaderCell>
                    </Table.Row>
                  </Table.Header>
                  <Table.Body>
                    {cp.tham_chieu_view.map((t) => (
                      <Table.Row key={t.id}>
                        <Table.Cell>{t.tham_chieu}</Table.Cell>
                        <Table.Cell>
                          {t.co_van_ban ? (
                            <Flex gap="2" align="center">
                              <Badge color="green">Đã liên kết</Badge>
                              <Text size="1" color="gray">
                                {t.nguon?.tieu_de}
                              </Text>
                            </Flex>
                          ) : (
                            <Flex gap="2" align="center" wrap="wrap">
                              <Badge color="amber">Chưa liên kết</Badge>
                              <Select.Root
                                value={nguonLienKet[t.id] ?? ""}
                                onValueChange={(v) =>
                                  setNguonLienKet({ ...nguonLienKet, [t.id]: v })
                                }
                              >
                                <Select.Trigger placeholder="Chọn nguồn…" />
                                <Select.Content>
                                  {(dsNguon.data ?? []).map((n) => (
                                    <Select.Item key={n.id} value={n.id}>
                                      {n.tieu_de}
                                    </Select.Item>
                                  ))}
                                </Select.Content>
                              </Select.Root>
                              <Button size="1" variant="soft" onClick={() => lienKetNguon(t.id)}>
                                Liên kết
                              </Button>
                            </Flex>
                          )}
                        </Table.Cell>
                        <Table.Cell>{t.ghi_chu || "—"}</Table.Cell>
                      </Table.Row>
                    ))}
                  </Table.Body>
                </Table.Root>
                <Flex gap="2" wrap="wrap" align="center">
                  <TextField.Root
                    placeholder="Tài liệu mới (vd: Ghi chú hiện trường làng Bản Rọm)"
                    value={tcMoi.tham_chieu}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                      setTcMoi({ ...tcMoi, tham_chieu: e.target.value })
                    }
                    style={{ minWidth: 220 }}
                  />
                  <Select.Root
                    value={tcMoi.nguon_id || "__none__"}
                    onValueChange={(v) => setTcMoi({ ...tcMoi, nguon_id: v === "__none__" ? "" : v })}
                  >
                    <Select.Trigger placeholder="Nguồn đã nạp (tùy chọn)…" />
                    <Select.Content>
                      <Select.Item value="__none__">Chưa nạp</Select.Item>
                      {(dsNguon.data ?? []).map((n) => (
                        <Select.Item key={n.id} value={n.id}>
                          {n.tieu_de}
                        </Select.Item>
                      ))}
                    </Select.Content>
                  </Select.Root>
                  <TextField.Root
                    placeholder="Ghi chú"
                    value={tcMoi.ghi_chu}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                      setTcMoi({ ...tcMoi, ghi_chu: e.target.value })
                    }
                    style={{ width: 160 }}
                  />
                  <Button size="1" variant="soft" onClick={themThamChieu}>
                    Thêm tài liệu
                  </Button>
                </Flex>
              </Flex>
            </Card>

            {/* Tiến độ */}
            <Card>
              <Flex gap="3" wrap="wrap" align="center">
                <Text size="2" weight="bold">
                  Tiến độ
                </Text>
                <Badge variant="outline">
                  Đầu ra: {cp.tien_do.muc_co_dau_ra}/{cp.tien_do.tong_muc} mục có bản
                </Badge>
                <Badge color="blue">Chờ duyệt: {cp.tien_do.cho_duyet}</Badge>
                <Badge color="green">Đã duyệt: {cp.tien_do.da_duyet}</Badge>
                <Badge color="indigo">Đã xuất: {cp.tien_do.da_xuat}</Badge>
              </Flex>
            </Card>

            {/* Đầu ra theo đối tượng — mục lục sửa được + chọn để nháp */}
            <Card>
              <Flex direction="column" gap="2">
                <Flex justify="between" align="center">
                  <Text size="2" weight="bold">
                    Đầu ra theo đối tượng (sửa được)
                  </Text>
                  <Flex gap="2">
                    <Button size="1" variant="outline" onClick={apDungMauDeXuat}>
                      Áp dụng đầu ra đề xuất
                    </Button>
                    <Button size="1" variant="soft" onClick={luuMucLuc}>
                      Lưu danh sách
                    </Button>
                    <Button
                      size="1"
                      onClick={sinhChon}
                      disabled={dangSinh || mucLucDirty || chonHopLe.size === 0}
                    >
                      Nháp {chonHopLe.size > 0 ? `${chonHopLe.size} ` : ""}đầu ra đã chọn
                    </Button>
                  </Flex>
                </Flex>
                <Text size="1" color="gray">
                  Mỗi mục là một đầu ra cho một đối tượng/định dạng/ngôn ngữ — tick rồi bấm
                  nháp; đầu ra sinh vào hàng chờ review, không tự xuất bản. Mục ngôn ngữ thứ
                  hai chỉ xuất hiện khi chiến dịch đã chọn ngôn ngữ phụ.
                </Text>
                {mucLucDirty && (
                  <Text size="1" color="amber">
                    Danh sách có sửa chưa lưu — bấm "Lưu danh sách" trước khi nháp.
                  </Text>
                )}
                {mucLuc.length === 0 && (
                  <Text size="2" color="gray">
                    Chưa có đầu ra nào — bấm "Áp dụng đầu ra đề xuất" để lấy mẫu theo đối
                    tượng, hoặc thêm tay.
                  </Text>
                )}
                {mucLuc.map((m, i) => {
                  const info = bthCuaMuc.get(m.id);
                  return (
                    <Flex key={m.id} gap="2" align="center" wrap="wrap">
                      <Checkbox
                        checked={chon.has(m.id)}
                        onCheckedChange={(v) => {
                          const s = new Set(chon);
                          if (v) s.add(m.id);
                          else s.delete(m.id);
                          setChon(s);
                        }}
                      />
                      <TextField.Root
                        value={m.tieu_de}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                          const ds = [...mucLuc];
                          ds[i] = { ...m, tieu_de: e.target.value };
                          suaMucLuc(ds);
                        }}
                        style={{ minWidth: 180 }}
                      />
                      <Select.Root
                        value={m.dinh_dang}
                        onValueChange={(v) => {
                          const ds = [...mucLuc];
                          ds[i] = { ...m, dinh_dang: v };
                          suaMucLuc(ds);
                        }}
                      >
                        <Select.Trigger />
                        <Select.Content>
                          {(dsDinhDang.data ?? []).map((x) => (
                            <Select.Item key={x.id} value={x.id}>
                              {x.nhan}
                            </Select.Item>
                          ))}
                        </Select.Content>
                      </Select.Root>
                      <Select.Root
                        value={m.doi_tuong_id ?? "__chung__"}
                        onValueChange={(v) => {
                          const ds = [...mucLuc];
                          ds[i] = { ...m, doi_tuong_id: v === "__chung__" ? null : v };
                          suaMucLuc(ds);
                        }}
                      >
                        <Select.Trigger />
                        <Select.Content>
                          <Select.Item value="__chung__">Chung</Select.Item>
                          {(dsDoiTuong.data ?? []).map((x) => (
                            <Select.Item key={x.id} value={x.id}>
                              {x.ten}
                            </Select.Item>
                          ))}
                        </Select.Content>
                      </Select.Root>
                      <Select.Root
                        value={m.ngon_ngu || "vi"}
                        onValueChange={(v) => {
                          const ds = [...mucLuc];
                          ds[i] = { ...m, ngon_ngu: v };
                          suaMucLuc(ds);
                        }}
                      >
                        <Select.Trigger />
                        <Select.Content>
                          {dsNgonNgu.map((nn) => (
                            <Select.Item key={nn} value={nn}>
                              {nn}
                            </Select.Item>
                          ))}
                        </Select.Content>
                      </Select.Root>
                      <TextField.Root
                        value={m.dich_den}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                          const ds = [...mucLuc];
                          ds[i] = { ...m, dich_den: e.target.value };
                          suaMucLuc(ds);
                        }}
                        placeholder="Đích đến"
                        style={{ width: 110 }}
                      />
                      {info && (
                        <Flex gap="1" align="center">
                          <Badge color={MAU_TRANG_THAI[info.bth.trang_thai] ?? "gray"}>
                            {NHAN_TRANG_THAI[info.bth.trang_thai] ?? info.bth.trang_thai}
                          </Badge>
                          {info.daXuat && <Badge color="indigo">Đã xuất</Badge>}
                          <Button size="1" variant="ghost" asChild>
                            <a href={`#/ban-the-hien?id=${info.bth.id}`}>Mở</a>
                          </Button>
                        </Flex>
                      )}
                      <Button
                        size="1"
                        variant="ghost"
                        color="red"
                        onClick={() => suaMucLuc(mucLuc.filter((x) => x.id !== m.id))}
                      >
                        Xóa
                      </Button>
                    </Flex>
                  );
                })}
                <Button
                  size="1"
                  variant="outline"
                  style={{ alignSelf: "flex-start" }}
                  onClick={() =>
                    suaMucLuc([
                      ...mucLuc,
                      {
                        id: idMoi("muc"),
                        tieu_de: "",
                        dinh_dang: "cau-chuyen-nhan-van",
                        doi_tuong_id: cp.doi_tuong_id,
                        dich_den: "",
                        ngon_ngu: "vi",
                        ly_do: "",
                      },
                    ])
                  }
                >
                  + Thêm đầu ra
                </Button>
              </Flex>
            </Card>

            {/* Gợi ý khoảng trống */}
            <Card>
              <Flex direction="column" gap="2">
                <Text size="2" weight="bold">
                  Gợi ý khoảng trống
                </Text>
                {cp.goi_y.length === 0 && (
                  <Text size="2" color="gray">
                    Không có khoảng trống nào được phát hiện.
                  </Text>
                )}
                {cp.goi_y.map((g) => (
                  <Card key={g.id} variant="surface">
                    <Flex direction="column" gap="1">
                      <Flex justify="between" align="center">
                        <Text size="2" weight="medium">
                          {g.tieu_de}
                        </Text>
                        {g.de_xuat_muc && (
                          <Button size="1" variant="soft" onClick={() => themMucGoiY(g.de_xuat_muc!)}>
                            Thêm vào danh sách
                          </Button>
                        )}
                      </Flex>
                      <Text size="1">{g.ly_do}</Text>
                      <Flex direction="column">
                        {(g.bang_chung ?? []).map((b, i) => (
                          <Text key={i} size="1" color="gray">
                            • {b}
                          </Text>
                        ))}
                      </Flex>
                    </Flex>
                  </Card>
                ))}
              </Flex>
            </Card>

            {/* Hàng chờ review + mọi đầu ra */}
            <Card>
              <Flex direction="column" gap="2">
                <Text size="2" weight="bold">
                  Hàng chờ review ({cp.hang_cho.length})
                </Text>
                {cp.hang_cho.length === 0 && (
                  <Text size="2" color="gray">
                    Không có đầu ra nào chờ duyệt.
                  </Text>
                )}
                {cp.hang_cho.map((b) => (
                  <Flex key={b.id} gap="2" align="center">
                    <a href={`#/ban-the-hien?id=${b.id}`}>{nhanDd(b.dinh_dang)}</a>
                    <Badge variant="outline">{b.doi_tuong || "chung"}</Badge>
                    {b.ngon_ngu !== "vi" && <Badge color="purple">{b.ngon_ngu}</Badge>}
                    {b.dich_den && <Badge color="cyan">{b.dich_den}</Badge>}
                    <Text size="1" color="gray">
                      {fmtLuc(b.tao_luc)}
                    </Text>
                  </Flex>
                ))}
              </Flex>
            </Card>

            <Card>
              <Flex direction="column" gap="2">
                <Text size="2" weight="bold">
                  Mọi đầu ra của chiến dịch ({(dsDauRa.data ?? []).length})
                </Text>
                <Table.Root>
                  <Table.Header>
                    <Table.Row>
                      <Table.ColumnHeaderCell>Định dạng</Table.ColumnHeaderCell>
                      <Table.ColumnHeaderCell>Đối tượng</Table.ColumnHeaderCell>
                      <Table.ColumnHeaderCell>Ngôn ngữ</Table.ColumnHeaderCell>
                      <Table.ColumnHeaderCell>Đích đến</Table.ColumnHeaderCell>
                      <Table.ColumnHeaderCell>Trạng thái</Table.ColumnHeaderCell>
                      <Table.ColumnHeaderCell />
                    </Table.Row>
                  </Table.Header>
                  <Table.Body>
                    {(dsDauRa.data ?? []).map((b) => (
                      <Table.Row key={b.id}>
                        <Table.Cell>{nhanDd(b.dinh_dang)}</Table.Cell>
                        <Table.Cell>{b.doi_tuong || "chung"}</Table.Cell>
                        <Table.Cell>{b.ngon_ngu || "vi"}</Table.Cell>
                        <Table.Cell>{b.dich_den || "—"}</Table.Cell>
                        <Table.Cell>
                          <Badge color={MAU_TRANG_THAI[b.trang_thai] ?? "gray"}>
                            {NHAN_TRANG_THAI[b.trang_thai] ?? b.trang_thai}
                          </Badge>
                        </Table.Cell>
                        <Table.Cell>
                          <a href={`#/ban-the-hien?id=${b.id}`}>Mở</a>
                        </Table.Cell>
                      </Table.Row>
                    ))}
                  </Table.Body>
                </Table.Root>
              </Flex>
            </Card>
          </Flex>
        )}
      </TrangThai>
    </>
  );
}
