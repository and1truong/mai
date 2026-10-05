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
  FactPhatHanh,
  GioiHanPhatHanh,
  MucLuc,
  Nguon,
} from "../../modules/content/index.ts";
import type { HoSoDoiTuong, HoSoThuongHieu } from "../../modules/context/index.ts";
import type { GoiYKhoangTrong, ThamChieuView, TienDoSoBao } from "../../modules/so_bao/index.ts";
import type { GoiYPhatHanh } from "../../modules/phat_hanh/index.ts";

// Trang Bản phát hành (#9): campaign loại 'phat_hanh' — field release
// (phiên bản, ngày, định vị, giới hạn gói/vùng/khả dụng, CTA, fact có
// con trỏ bằng chứng vào nguồn), nguồn fact tự động, tham chiếu nguồn,
// đầu ra theo đối tượng chọn để nháp, gợi ý khoảng trống. Luồng
// duyệt/xuất dùng chung model bản thể hiện — trang này chỉ dựng input.

type ChiTietPhatHanh = Campaign & {
  thong_diep: { id: string; tieu_de: string }[];
  thong_diep_chu_de: { id: string; tieu_de: string } | null;
  tham_chieu_view: ThamChieuView[];
  de_xuat_muc_luc: MucLuc[];
  goi_y: (GoiYKhoangTrong | GoiYPhatHanh)[];
  tien_do: TienDoSoBao;
  hang_cho: BanTheHien[];
  phat_hanh: {
    nguon_phat_hanh: { id: string; tieu_de: string; head_revision_id: string | null } | null;
    ds_fact_view: {
      co_bang_chung: boolean;
      nguon: { id: string; tieu_de: string } | null;
      muc: { id: string; tieu_de: string } | null;
    }[] | null;
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

const LOAI_GIOI_HAN = ["goi", "vung", "kha_dung", "chung"];
const LOAI_CTA = ["tai_lieu", "nang_cap", "ho_tro", "chung"];

// Server lưu loai "chung" là chuỗi rỗng — UI giữ nhãn "chung" trong Select
// và map hai chiều khi đọc/ghi để không gửi giá trị server từ chối (400).
const loaiVeUI = (v: string) => (v === "" ? "chung" : v);
const loaiVeApi = (v: string) => (v === "chung" ? "" : v);

const idMoi = (tienTo: string) => `${tienTo}-${crypto.randomUUID().slice(0, 8)}`;

export default function PhatHanhPage() {
  const path = useHashRoute();
  const id = new URLSearchParams(path.split("?")[1] ?? "").get("id");
  return id ? <ChiTietPhatHanhView id={id} /> : <DanhSachPhatHanh />;
}

// --- Danh sách + tạo bản phát hành ---

function DanhSachPhatHanh() {
  const { data, loading, error, reload } = useApi<Campaign[]>("/api/phat-hanh");
  const [ten, setTen] = useState("");
  const [phienBan, setPhienBan] = useState("");
  const [ngayPhatHanh, setNgayPhatHanh] = useState("");
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
          loai: "phat_hanh",
          ten,
          phien_ban: phienBan,
          ngay_phat_hanh: ngayPhatHanh,
        }),
      });
      window.location.hash = `#/phat-hanh?id=${cp.id}`;
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

  return (
    <>
      <Heading mb="3">Bản phát hành</Heading>
      <Card mb="4">
        <Flex direction="column" gap="2">
          <Text size="2" weight="bold">
            Tạo bản phát hành mới
          </Text>
          <Flex gap="2" wrap="wrap">
            <TextField.Root
              placeholder="Tên bản phát hành (bắt buộc)"
              value={ten}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTen(e.target.value)}
              style={{ flex: 2, minWidth: 220 }}
            />
            <TextField.Root
              placeholder="Phiên bản (vd: 4.0)"
              value={phienBan}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPhienBan(e.target.value)}
              style={{ width: 160 }}
            />
            <TextField.Root
              type="date"
              value={ngayPhatHanh}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                setNgayPhatHanh(e.target.value)
              }
              style={{ width: 160 }}
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
              Tạo bản phát hành
            </Button>
          </Flex>
        </Flex>
      </Card>
      <TrangThai loading={loading} error={error} empty={!data?.length}>
        <Table.Root>
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeaderCell>Phiên bản</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>Tên</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>Ngày phát hành</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>Tạo lúc</Table.ColumnHeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {(data ?? []).map((cp) => (
              <Table.Row key={cp.id}>
                <Table.Cell>{cp.phien_ban || "—"}</Table.Cell>
                <Table.Cell>
                  <a href={`#/phat-hanh?id=${cp.id}`}>{cp.ten}</a>
                </Table.Cell>
                <Table.Cell>{cp.ngay_phat_hanh || "—"}</Table.Cell>
                <Table.Cell>{fmtLuc(cp.tao_luc)}</Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Root>
      </TrangThai>
    </>
  );
}

// --- Chi tiết một bản phát hành ---

function ChiTietPhatHanhView({ id }: { id: string }) {
  const chiTiet = useApi<ChiTietPhatHanh>(`/api/campaign/${id}`, [id]);
  const dsDinhDang = useApi<{ id: string; nhan: string }[]>("/api/dinh-dang");
  const dsDoiTuong = useApi<HoSoDoiTuong[]>("/api/ho-so-doi-tuong");
  const dsThuongHieu = useApi<HoSoThuongHieu[]>("/api/ho-so-thuong-hieu");
  const dsNguon = useApi<Nguon[]>("/api/nguon");
  const dsDauRa = useApi<BanTheHien[]>(`/api/ban-the-hien?campaign_id=${id}`, [id]);

  const [form, setForm] = useState({
    ten: "",
    mo_ta: "",
    phien_ban: "",
    ngay_phat_hanh: "",
    dinh_vi: "",
    thuong_hieu_id: "",
    doi_tuong_id: "",
  });
  const [dsFact, setDsFact] = useState<FactPhatHanh[]>([]);
  const [gioiHan, setGioiHan] = useState<GioiHanPhatHanh[]>([]);
  const [cta, setCta] = useState<CtaLienKet[]>([]);
  const [mucLuc, setMucLuc] = useState<MucLuc[]>([]);
  const [mucLucDirty, setMucLucDirty] = useState(false);
  const [releaseDirty, setReleaseDirty] = useState(false);
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
      phien_ban: cp.phien_ban,
      ngay_phat_hanh: cp.ngay_phat_hanh,
      dinh_vi: cp.dinh_vi,
      thuong_hieu_id: cp.thuong_hieu_id ?? "",
      doi_tuong_id: cp.doi_tuong_id ?? "",
    });
    setDsFact(cp.ds_fact);
    setGioiHan(cp.gioi_han.map((g) => ({ ...g, loai: loaiVeUI(g.loai) })));
    setCta(cp.cta.map((c) => ({ ...c, loai: loaiVeUI(c.loai) })));
    setMucLuc(cp.muc_luc);
    setMucLucDirty(false);
    setReleaseDirty(false);
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

  // Một nút lưu cho mọi field release — PUT gửi đủ mảng (server thay
  // toàn bộ mảng có mặt). Đổi field release → nguồn fact tự động nhận
  // revision mới → server trả phat_hien để báo đầu ra bị ảnh hưởng.
  async function luuPhatHanh() {
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
          phien_ban: form.phien_ban,
          ngay_phat_hanh: form.ngay_phat_hanh,
          dinh_vi: form.dinh_vi,
          thuong_hieu_id: form.thuong_hieu_id || null,
          doi_tuong_id: form.doi_tuong_id || null,
          gioi_han: gioiHan.map((g) => ({ ...g, loai: loaiVeApi(g.loai) })),
          cta: cta.map((c) => ({ ...c, loai: loaiVeApi(c.loai) })),
          ds_fact: dsFact,
        }),
      });
      setReleaseDirty(false);
      setTrangThaiLuu(`Đã lưu ${new Date().toLocaleTimeString("vi")}`);
      if (kq.phat_hien?.thay_doi) {
        const n = kq.phat_hien.ds_task.length;
        setThongBaoPhatHien(
          `Nguồn phát hành vừa đổi — ${n > 0 ? `${n} task sửa mới cho đầu ra phụ thuộc` : "không có đầu ra nào bị ảnh hưởng"}. Xem trang Thay đổi.`,
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
      setDsLoi(["Tham chiếu mới cần nhãn (vd: changelog 4.0, tài liệu SSO)."]);
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
  const factView = cp?.phat_hanh?.ds_fact_view ?? null;
  const nguonPh = cp?.phat_hanh?.nguon_phat_hanh ?? null;

  return (
    <>
      <Flex align="center" justify="between" mb="3">
        <Heading>
          Bản phát hành{cp?.phien_ban ? ` ${cp.phien_ban}` : ""}
          {cp?.ten ? ` — ${cp.ten}` : ""}
        </Heading>
        <a href="#/phat-hanh">← Danh sách bản phát hành</a>
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

            {/* Thông tin bản phát hành */}
            <Card>
              <Flex direction="column" gap="2">
                <Flex justify="between" align="center">
                  <Text size="2" weight="bold">
                    Thông tin bản phát hành
                  </Text>
                  <Flex gap="2" align="center">
                    {releaseDirty && (
                      <Text size="1" color="amber">
                        Có sửa chưa lưu
                      </Text>
                    )}
                    {trangThaiLuu && (
                      <Text size="1" color="gray">
                        {trangThaiLuu}
                      </Text>
                    )}
                    <Button size="1" variant="soft" onClick={luuPhatHanh}>
                      Lưu bản phát hành
                    </Button>
                  </Flex>
                </Flex>
                <Flex gap="2" wrap="wrap">
                  <TextField.Root
                    value={form.ten}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                      setForm({ ...form, ten: e.target.value });
                      setReleaseDirty(true);
                    }}
                    placeholder="Tên bản phát hành"
                    style={{ flex: 2, minWidth: 220 }}
                  />
                  <TextField.Root
                    value={form.phien_ban}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                      setForm({ ...form, phien_ban: e.target.value });
                      setReleaseDirty(true);
                    }}
                    placeholder="Phiên bản (vd: 4.0)"
                    style={{ width: 140 }}
                  />
                  <TextField.Root
                    type="date"
                    value={form.ngay_phat_hanh}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                      setForm({ ...form, ngay_phat_hanh: e.target.value });
                      setReleaseDirty(true);
                    }}
                    style={{ width: 160 }}
                  />
                </Flex>
                <TextField.Root
                  value={form.mo_ta}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                    setForm({ ...form, mo_ta: e.target.value });
                    setReleaseDirty(true);
                  }}
                  placeholder="Mô tả ngắn"
                />
                <TextArea
                  value={form.dinh_vi}
                  onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => {
                    setForm({ ...form, dinh_vi: e.target.value });
                    setReleaseDirty(true);
                  }}
                  placeholder="Định vị đã duyệt — hướng truyền đạt của bản phát hành; bộ sinh áp đúng hướng này, không tự đổi"
                  rows={2}
                />
                <Flex gap="2" wrap="wrap">
                  <Select.Root
                    value={form.thuong_hieu_id || "__none__"}
                    onValueChange={(v) => {
                      setForm({ ...form, thuong_hieu_id: v === "__none__" ? "" : v });
                      setReleaseDirty(true);
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
                      setReleaseDirty(true);
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
                  {nguonPh && (
                    <Button size="1" variant="outline" asChild>
                      <a href={`#/nguon?id=${nguonPh.id}`}>Nguồn fact tự động</a>
                    </Button>
                  )}
                  <Button size="1" variant="outline" asChild>
                    <a href={`/api/campaign/${id}/xuat`} download>
                      Tải gói (ZIP)
                    </a>
                  </Button>
                </Flex>
                <Text size="1" color="gray">
                  Nguồn fact tự động chiếu toàn bộ field release thành mục nguồn — sửa field
                  ở đây là đổi nguồn, đầu ra phụ thuộc được đánh dấu lại.
                </Text>
              </Flex>
            </Card>

            {/* Fact tính năng có con trỏ bằng chứng */}
            <Card>
              <Flex direction="column" gap="2">
                <Text size="2" weight="bold">
                  Fact tính năng ({dsFact.length})
                </Text>
                <Text size="1" color="gray">
                  Mỗi fact phải trỏ nguồn đã nạp (changelog, tài liệu). Fact không có nguồn
                  hoặc nguồn chưa vào tham chiếu được gắn cờ "chưa xác nhận" — đầu ra chỉ
                  được để dạng câu hỏi, không được trình bày như sự thật.
                </Text>
                {dsFact.map((f, i) => {
                  const view = factView?.[i];
                  const nguonChon = dsNguon.data?.find((n) => n.id === f.nguon_id) ?? null;
                  return (
                    <Card key={f.id} variant="surface">
                      <Flex direction="column" gap="2">
                        <Flex gap="2" align="center" wrap="wrap">
                          <Badge variant="outline">{f.id}</Badge>
                          <TextField.Root
                            value={f.tinh_nang}
                            onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                              const ds = [...dsFact];
                              ds[i] = { ...f, tinh_nang: e.target.value };
                              setDsFact(ds);
                              setReleaseDirty(true);
                            }}
                            placeholder="Tên tính năng (vd: Passkeys)"
                            style={{ minWidth: 200, flex: 1 }}
                          />
                          {view &&
                            (view.co_bang_chung ? (
                              <Badge color="green">
                                Có bằng chứng{view.nguon?.tieu_de ? ` — ${view.nguon.tieu_de}` : ""}
                              </Badge>
                            ) : (
                              <Badge color="amber">Chưa xác nhận</Badge>
                            ))}
                          <Button
                            size="1"
                            variant="ghost"
                            color="red"
                            onClick={() => {
                              setDsFact(dsFact.filter((x) => x.id !== f.id));
                              setReleaseDirty(true);
                            }}
                          >
                            Xóa
                          </Button>
                        </Flex>
                        <TextArea
                          value={f.noi_dung}
                          onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => {
                            const ds = [...dsFact];
                            ds[i] = { ...f, noi_dung: e.target.value };
                            setDsFact(ds);
                            setReleaseDirty(true);
                          }}
                          placeholder="Nội dung fact — phải từ tài liệu đã nạp, không bịa số liệu/bước kỹ thuật"
                          rows={2}
                        />
                        <Flex gap="2" wrap="wrap">
                          <Select.Root
                            value={f.nguon_id || "__none__"}
                            onValueChange={(v) => {
                              const ds = [...dsFact];
                              ds[i] = { ...f, nguon_id: v === "__none__" ? null : v, muc_id: null };
                              setDsFact(ds);
                              setReleaseDirty(true);
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
                              value={f.muc_id || "__all__"}
                              onValueChange={(v) => {
                                const ds = [...dsFact];
                                ds[i] = { ...f, muc_id: v === "__all__" ? null : v };
                                setDsFact(ds);
                                setReleaseDirty(true);
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
                    setDsFact([
                      ...dsFact,
                      { id: idMoi("fact"), tinh_nang: "", noi_dung: "", nguon_id: null, muc_id: null },
                    ]);
                    setReleaseDirty(true);
                  }}
                >
                  + Thêm fact
                </Button>
              </Flex>
            </Card>

            {/* Giới hạn gói/vùng/khả dụng */}
            <Card>
              <Flex direction="column" gap="2">
                <Text size="2" weight="bold">
                  Giới hạn gói/vùng/khả dụng ({gioiHan.length})
                </Text>
                <Text size="1" color="gray">
                  Nhắc tính năng bị giới hạn thì đầu ra phải hiển thị mô tả giới hạn —
                  kiểm chứng sẽ cảnh báo nếu đầu ra bỏ sót.
                </Text>
                {gioiHan.map((g, i) => (
                  <Flex key={g.id} gap="2" align="center" wrap="wrap">
                    <TextField.Root
                      value={g.tinh_nang}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                        const ds = [...gioiHan];
                        ds[i] = { ...g, tinh_nang: e.target.value };
                        setGioiHan(ds);
                        setReleaseDirty(true);
                      }}
                      placeholder="Tính năng (vd: SSO)"
                      style={{ minWidth: 160 }}
                    />
                    <Select.Root
                      value={g.loai}
                      onValueChange={(v) => {
                        const ds = [...gioiHan];
                        ds[i] = { ...g, loai: v };
                        setGioiHan(ds);
                        setReleaseDirty(true);
                      }}
                    >
                      <Select.Trigger />
                      <Select.Content>
                        {LOAI_GIOI_HAN.map((l) => (
                          <Select.Item key={l} value={l}>
                            {l}
                          </Select.Item>
                        ))}
                      </Select.Content>
                    </Select.Root>
                    <TextField.Root
                      value={g.mo_ta}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                        const ds = [...gioiHan];
                        ds[i] = { ...g, mo_ta: e.target.value };
                        setGioiHan(ds);
                        setReleaseDirty(true);
                      }}
                      placeholder="Mô tả giới hạn (vd: chỉ gói Enterprise)"
                      style={{ flex: 1, minWidth: 240 }}
                    />
                    <Button
                      size="1"
                      variant="ghost"
                      color="red"
                      onClick={() => {
                        setGioiHan(gioiHan.filter((x) => x.id !== g.id));
                        setReleaseDirty(true);
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
                    setGioiHan([
                      ...gioiHan,
                      { id: idMoi("gh"), tinh_nang: "", loai: "goi", mo_ta: "" },
                    ]);
                    setReleaseDirty(true);
                  }}
                >
                  + Thêm giới hạn
                </Button>
              </Flex>
            </Card>

            {/* Link CTA */}
            <Card>
              <Flex direction="column" gap="2">
                <Text size="2" weight="bold">
                  Link CTA ({cta.length})
                </Text>
                <Text size="1" color="gray">
                  Đường dẫn sửa được trỏ đúng trang tài liệu, nâng cấp hay hỗ trợ — bộ sinh
                  chọn link theo loại phù hợp từng đầu ra.
                </Text>
                {cta.map((c, i) => (
                  <Flex key={c.id} gap="2" align="center" wrap="wrap">
                    <TextField.Root
                      value={c.nhan}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                        const ds = [...cta];
                        ds[i] = { ...c, nhan: e.target.value };
                        setCta(ds);
                        setReleaseDirty(true);
                      }}
                      placeholder="Nhãn (vd: Tài liệu tích hợp)"
                      style={{ minWidth: 180 }}
                    />
                    <Select.Root
                      value={c.loai}
                      onValueChange={(v) => {
                        const ds = [...cta];
                        ds[i] = { ...c, loai: v };
                        setCta(ds);
                        setReleaseDirty(true);
                      }}
                    >
                      <Select.Trigger />
                      <Select.Content>
                        {LOAI_CTA.map((l) => (
                          <Select.Item key={l} value={l}>
                            {l}
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
                        setReleaseDirty(true);
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
                        setReleaseDirty(true);
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
                    setCta([...cta, { id: idMoi("cta"), nhan: "", loai: "tai_lieu", url: "" }]);
                    setReleaseDirty(true);
                  }}
                >
                  + Thêm CTA
                </Button>
              </Flex>
            </Card>

            {/* Tham chiếu nguồn = tài liệu đã nạp đưa vào provenance */}
            <Card>
              <Flex direction="column" gap="2">
                <Text size="2" weight="bold">
                  Tài liệu bằng chứng (tham chiếu nguồn)
                </Text>
                <Text size="1" color="gray">
                  Changelog, tài liệu sản phẩm đã nạp vào Nguồn rồi khai báo ở đây — chỉ
                  nguồn trong danh sách này (và nguồn fact tự động) được đưa vào context
                  sinh cho mọi đầu ra của bản phát hành.
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
                    placeholder="Tài liệu mới (vd: Changelog 4.0)"
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
                      Áp dụng 8 đầu ra đề xuất
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
                  Mỗi mục là một đầu ra cho một đối tượng/định dạng — tick rồi bấm nháp;
                  đầu ra sinh vào hàng chờ review, không tự xuất bản.
                </Text>
                {mucLucDirty && (
                  <Text size="1" color="amber">
                    Danh sách có sửa chưa lưu — bấm "Lưu danh sách" trước khi nháp.
                  </Text>
                )}
                {mucLuc.length === 0 && (
                  <Text size="2" color="gray">
                    Chưa có đầu ra nào — bấm "Áp dụng 8 đầu ra đề xuất" để lấy mẫu theo
                    đối tượng, hoặc thêm tay.
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
                        style={{ minWidth: 200 }}
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
                      <TextField.Root
                        value={m.dich_den}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                          const ds = [...mucLuc];
                          ds[i] = { ...m, dich_den: e.target.value };
                          suaMucLuc(ds);
                        }}
                        placeholder="Đích đến"
                        style={{ width: 120 }}
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
                        dinh_dang: "thay-doi-khach-hang",
                        doi_tuong_id: cp.doi_tuong_id,
                        dich_den: "",
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
                  Mọi đầu ra của bản phát hành ({(dsDauRa.data ?? []).length})
                </Text>
                <Table.Root>
                  <Table.Header>
                    <Table.Row>
                      <Table.ColumnHeaderCell>Định dạng</Table.ColumnHeaderCell>
                      <Table.ColumnHeaderCell>Đối tượng</Table.ColumnHeaderCell>
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
