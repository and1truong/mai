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
  MucLuc,
  NgoaiLeCongQuyen,
  NguoiDuyetCongQuyen,
  Nguon,
  FactVanHanh,
  YeuCauCongQuyen,
} from "../../modules/content/index.ts";
import type { HoSoDoiTuong, HoSoThuongHieu } from "../../modules/context/index.ts";
import type { GoiYKhoangTrong, ThamChieuView, TienDoSoBao } from "../../modules/so_bao/index.ts";
import type {
  CongQuyenView,
  DauRaAnhHuong,
  GoiYCongQuyen,
} from "../../modules/cong_quyen/index.ts";

// Trang Cơ quan công quyền (#11): campaign loại 'cong_quyen' — bắt đầu từ
// một chính sách chính thức đã nạp: phiên bản, phạm vi quyền hạn, ngày
// hiệu lực, yêu cầu (bắt buộc | giải thích), ngoại lệ liên kết yêu cầu,
// fact vận hành hỗ trợ, danh sách reviewer thẩm quyền của POC và chế
// độ bảo vệ (#16). Nguồn fact tự động chiếu mọi field thành mục nguồn —
// sửa field (vd đổi ngày hiệu lực) là đổi nguồn: đầu ra phụ thuộc được
// đánh dấu cũ và liệt kê riêng theo đích (nháp / đã xuất / đã lên lịch /
// đã đăng). Cổng review thẩm quyền ghi reviewer vào record duyệt và
// chặn duyệt đầu ra ghim chính sách cũ — trang đã đăng cần revision
// thay thế, lần xuất bản trước vẫn audit được.

type ChiTietCongQuyen = Campaign & {
  thong_diep: { id: string; tieu_de: string }[];
  thong_diep_chu_de: { id: string; tieu_de: string } | null;
  tham_chieu_view: ThamChieuView[];
  de_xuat_muc_luc: MucLuc[];
  goi_y: (GoiYKhoangTrong | GoiYCongQuyen)[];
  tien_do: TienDoSoBao;
  hang_cho: BanTheHien[];
  cong_quyen: CongQuyenView | null;
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

const NHAN_LOAI_YEU_CAU: Record<string, string> = {
  bat_buoc: "Bắt buộc",
  giai_thich: "Giải thích",
};

const NHAN_DOI_TUONG_AP_DUNG: Record<string, string> = {
  "": "Tất cả",
  ho_gia_dinh: "Hộ gia đình",
  doanh_nghiep: "Doanh nghiệp",
  truong_hoc: "Trường học",
  nha_thau: "Nhà thầu",
  nguoi_nhap_cu: "Người nhập cư",
};

const NHAN_NHOM_ANH_HUONG: Record<keyof CongQuyenView["anh_huong"], string> = {
  nhap: "Bản nháp phụ thuộc",
  da_xuat: "Đã xuất (trang nội bộ)",
  da_len_lich: "Đã lên lịch",
  da_dang: "Đã đăng ra ngoài",
};

const idMoi = (tienTo: string) => `${tienTo}-${crypto.randomUUID().slice(0, 8)}`;

export default function CongQuyenPage() {
  const path = useHashRoute();
  const id = new URLSearchParams(path.split("?")[1] ?? "").get("id");
  return id ? <ChiTietCongQuyenView id={id} /> : <DanhSachCongQuyen />;
}

// --- Danh sách + tạo chiến dịch công quyền ---

function DanhSachCongQuyen() {
  const { data, loading, error, reload } = useApi<Campaign[]>("/api/cong-quyen");
  const [ten, setTen] = useState("");
  const [phienBan, setPhienBan] = useState("");
  const [ngayHieuLuc, setNgayHieuLuc] = useState("");
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
          loai: "cong_quyen",
          ten,
          phien_ban: phienBan,
          ngay_hieu_luc: ngayHieuLuc || undefined,
        }),
      });
      window.location.hash = `#/cong-quyen?id=${cp.id}`;
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
      <Heading mb="3">Cơ quan công quyền</Heading>
      <Card mb="4">
        <Flex direction="column" gap="2">
          <Text size="2" weight="bold">
            Tạo chiến dịch chính sách mới
          </Text>
          <Text size="1" color="gray">
            Bắt đầu từ một văn bản chính sách chính thức — nạp nguồn trước ở trang
            Nguồn, rồi gắn nguồn chính sách, yêu cầu và ngoại lệ ở trang chi tiết.
          </Text>
          <Flex gap="2" wrap="wrap">
            <TextField.Root
              placeholder="Tên chính sách (bắt buộc)"
              value={ten}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTen(e.target.value)}
              style={{ flex: 2, minWidth: 220 }}
            />
            <TextField.Root
              placeholder="Phiên bản (vd: 1.0 / dự thảo 3)"
              value={phienBan}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPhienBan(e.target.value)}
              style={{ width: 220 }}
            />
            <TextField.Root
              placeholder="Ngày hiệu lực (YYYY-MM-DD)"
              value={ngayHieuLuc}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNgayHieuLuc(e.target.value)}
              style={{ width: 200 }}
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
              <Table.ColumnHeaderCell>Tên chính sách</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>Phiên bản</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>Ngày hiệu lực</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>Phạm vi</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>Tạo lúc</Table.ColumnHeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {(data ?? []).map((cp) => (
              <Table.Row key={cp.id}>
                <Table.Cell>
                  <a href={`#/cong-quyen?id=${cp.id}`}>{cp.ten}</a>
                </Table.Cell>
                <Table.Cell>{cp.phien_ban || "—"}</Table.Cell>
                <Table.Cell>{cp.ngay_hieu_luc || "—"}</Table.Cell>
                <Table.Cell>{cp.pham_vi_quyen_han || "—"}</Table.Cell>
                <Table.Cell>{fmtLuc(cp.tao_luc)}</Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Root>
      </TrangThai>
    </>
  );
}

// --- Chi tiết một chiến dịch công quyền ---

function ChiTietCongQuyenView({ id }: { id: string }) {
  const chiTiet = useApi<ChiTietCongQuyen>(`/api/campaign/${id}`, [id]);
  const dsDinhDang = useApi<{ id: string; nhan: string }[]>("/api/dinh-dang");
  const dsDoiTuong = useApi<HoSoDoiTuong[]>("/api/ho-so-doi-tuong");
  const dsThuongHieu = useApi<HoSoThuongHieu[]>("/api/ho-so-thuong-hieu");
  const dsNguon = useApi<Nguon[]>("/api/nguon");
  const dsDauRa = useApi<BanTheHien[]>(`/api/ban-the-hien?campaign_id=${id}`, [id]);

  const [form, setForm] = useState({
    ten: "",
    mo_ta: "",
    phien_ban: "",
    pham_vi_quyen_han: "",
    ngay_hieu_luc: "",
    ngon_ngu_phu: "",
    nguon_chinh_sach_id: "",
    che_do_bao_ve: false,
    thuong_hieu_id: "",
    doi_tuong_id: "",
  });
  const [dsYeuCau, setDsYeuCau] = useState<YeuCauCongQuyen[]>([]);
  const [dsNgoaiLe, setDsNgoaiLe] = useState<NgoaiLeCongQuyen[]>([]);
  const [dsFact, setDsFact] = useState<FactVanHanh[]>([]);
  const [dsNguoiDuyet, setDsNguoiDuyet] = useState<NguoiDuyetCongQuyen[]>([]);
  const [mucLuc, setMucLuc] = useState<MucLuc[]>([]);
  const [mucLucDirty, setMucLucDirty] = useState(false);
  const [keHoachDirty, setKeHoachDirty] = useState(false);
  const [chon, setChon] = useState<Set<string>>(new Set());
  const [dsLoi, setDsLoi] = useState<string[]>([]);
  const [trangThaiLuu, setTrangThaiLuu] = useState("");
  const [thongBaoPhatHien, setThongBaoPhatHien] = useState("");
  const [dangSinh, setDangSinh] = useState(false);
  const [chonNguoiDuyet, setChonNguoiDuyet] = useState<Record<string, string>>({});
  const [dangDuyet, setDangDuyet] = useState<string | null>(null);

  useEffect(() => {
    const cp = chiTiet.data;
    if (!cp) return;
    setForm({
      ten: cp.ten,
      mo_ta: cp.mo_ta,
      phien_ban: cp.phien_ban,
      pham_vi_quyen_han: cp.pham_vi_quyen_han,
      ngay_hieu_luc: cp.ngay_hieu_luc,
      ngon_ngu_phu: cp.ngon_ngu_phu,
      nguon_chinh_sach_id: cp.nguon_chinh_sach_id,
      che_do_bao_ve: cp.che_do_bao_ve === 1,
      thuong_hieu_id: cp.thuong_hieu_id ?? "",
      doi_tuong_id: cp.doi_tuong_id ?? "",
    });
    setDsYeuCau(cp.ds_yeu_cau);
    setDsNgoaiLe(cp.ds_ngoai_le);
    setDsFact(cp.ds_fact_van_hanh);
    setDsNguoiDuyet(cp.ds_nguoi_duyet);
    setMucLuc(cp.muc_luc);
    setMucLucDirty(false);
    setKeHoachDirty(false);
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

  // Một nút lưu cho mọi field chính sách — PUT gửi đủ mảng (server thay
  // toàn bộ mảng có mặt). Đổi field → nguồn fact tự động nhận revision
  // mới → server trả phat_hien báo đầu ra bị ảnh hưởng.
  async function luuChinhSach() {
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
          pham_vi_quyen_han: form.pham_vi_quyen_han,
          ngay_hieu_luc: form.ngay_hieu_luc,
          ngon_ngu_phu: form.ngon_ngu_phu,
          nguon_chinh_sach_id: form.nguon_chinh_sach_id,
          che_do_bao_ve: form.che_do_bao_ve,
          thuong_hieu_id: form.thuong_hieu_id || null,
          doi_tuong_id: form.doi_tuong_id || null,
          ds_yeu_cau: dsYeuCau,
          ds_ngoai_le: dsNgoaiLe,
          ds_fact_van_hanh: dsFact,
          ds_nguoi_duyet: dsNguoiDuyet,
        }),
      });
      setKeHoachDirty(false);
      setTrangThaiLuu(`Đã lưu ${new Date().toLocaleTimeString("vi")}`);
      if (kq.phat_hien?.thay_doi) {
        const n = kq.phat_hien.ds_task.length;
        setThongBaoPhatHien(
          `Chính sách vừa đổi — ${n > 0 ? `${n} task sửa mới cho đầu ra phụ thuộc` : "không có đầu ra nào bị ảnh hưởng"}. Nhóm ảnh hưởng ở dưới liệt kê theo đích.`,
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

  // Duyệt/từ chối trong cổng review thẩm quyền — server ghi reviewer
  // vào record duyet và chặn duyệt đầu ra ghim chính sách cũ (409).
  async function duyetDauRa(bthId: string, headRevisionId: string | null, den: "da_duyet" | "tu_choi") {
    setDsLoi([]);
    setDangDuyet(bthId);
    try {
      await api(`/api/ban-the-hien/${bthId}/trang-thai`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          trang_thai: den,
          mong_doi_revision_id: headRevisionId ?? undefined,
          nguoi_duyet_id: chonNguoiDuyet[bthId] || undefined,
        }),
      });
      chiTiet.reload();
      dsDauRa.reload();
    } catch (e) {
      setDsLoi(loiText(e));
    } finally {
      setDangDuyet(null);
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

  // Ô chọn nguồn + mục bằng chứng — dùng chung cho yêu cầu/ngoại lệ/fact.
  function ChonBangChung({
    nguonId,
    mucId,
    onDoi,
  }: {
    nguonId: string | null;
    mucId: string | null;
    onDoi: (nguonId: string | null, mucId: string | null) => void;
  }) {
    const nguonChon = dsNguon.data?.find((n) => n.id === nguonId) ?? null;
    return (
      <Flex gap="2" wrap="wrap">
        <Select.Root
          value={nguonId || "__none__"}
          onValueChange={(v) => onDoi(v === "__none__" ? null : v, null)}
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
            value={mucId || "__all__"}
            onValueChange={(v) => onDoi(nguonId, v === "__all__" ? null : v)}
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
    );
  }

  const cp = chiTiet.data;
  const cq = cp?.cong_quyen ?? null;
  const nhanDd = (dd: string) => dsDinhDang.data?.find((x) => x.id === dd)?.nhan ?? dd;
  const bthCuaMuc = new Map<string, { bth: BanTheHien; daXuat: boolean }>();
  for (const m of cp?.tien_do.muc ?? []) {
    if (m.ban_the_hien) bthCuaMuc.set(m.muc.id, { bth: m.ban_the_hien, daXuat: m.da_xuat_ban });
  }
  const idDaLuu = new Set((cp?.muc_luc ?? []).map((m) => m.id));
  const chonHopLe = new Set([...chon].filter((x) => idDaLuu.has(x)));
  const ycView = cq?.ds_yeu_cau_view ?? [];
  const nlView = cq?.ds_ngoai_le_view ?? [];
  const fvView = cq?.ds_fact_van_hanh_view ?? [];
  // Ngôn ngữ cho phép trên đầu ra: vi + ngôn ngữ thứ hai đã chọn.
  const dsNgonNgu = ["vi", ...(cp?.ngon_ngu_phu ? [cp.ngon_ngu_phu] : [])];
  const idYeuCau = new Set(dsYeuCau.map((x) => x.id));
  const soDauRaBiAnhHuong = cq
    ? new Set(
        [...cq.anh_huong.nhap, ...cq.anh_huong.da_xuat, ...cq.anh_huong.da_len_lich, ...cq.anh_huong.da_dang].map(
          (x) => x.ban_the_hien_id,
        ),
      ).size
    : 0;

  return (
    <>
      <Flex align="center" justify="between" mb="3">
        <Heading>Cơ quan công quyền{cp?.ten ? ` — ${cp.ten}` : ""}</Heading>
        <a href="#/cong-quyen">← Danh sách chính sách</a>
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
            {soDauRaBiAnhHuong > 0 && (
              <Callout.Root color="orange">
                <Callout.Text>
                  {soDauRaBiAnhHuong} đầu ra đang ghim chính sách cũ — xem nhóm ảnh hưởng theo
                  đích ở dưới; đầu ra cũ không được duyệt/chạy tiếp cho tới khi sinh lại và
                  review lại.
                </Callout.Text>
              </Callout.Root>
            )}

            {/* Văn bản chính sách + field ràng buộc */}
            <Card>
              <Flex direction="column" gap="2">
                <Flex justify="between" align="center">
                  <Text size="2" weight="bold">
                    Chính sách
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
                    <Button size="1" variant="soft" onClick={luuChinhSach}>
                      Lưu chính sách
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
                    placeholder="Tên chính sách"
                    style={{ flex: 2, minWidth: 220 }}
                  />
                  <TextField.Root
                    value={form.phien_ban}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                      setForm({ ...form, phien_ban: e.target.value });
                      setKeHoachDirty(true);
                    }}
                    placeholder="Phiên bản (vd: ban hanh 2027)"
                    style={{ width: 220 }}
                  />
                  <TextField.Root
                    value={form.ngay_hieu_luc}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                      setForm({ ...form, ngay_hieu_luc: e.target.value });
                      setKeHoachDirty(true);
                    }}
                    placeholder="Ngày hiệu lực (YYYY-MM-DD)"
                    style={{ width: 200 }}
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
                <TextField.Root
                  value={form.pham_vi_quyen_han}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                    setForm({ ...form, pham_vi_quyen_han: e.target.value });
                    setKeHoachDirty(true);
                  }}
                  placeholder="Phạm vi quyền hạn (vd: địa bàn thành phố An Khang, mọi hộ gia đình và cơ sở kinh doanh)"
                />
                <Flex gap="2" wrap="wrap" align="center">
                  <Select.Root
                    value={form.nguon_chinh_sach_id || "__none__"}
                    onValueChange={(v) => {
                      setForm({ ...form, nguon_chinh_sach_id: v === "__none__" ? "" : v });
                      setKeHoachDirty(true);
                    }}
                  >
                    <Select.Trigger placeholder="Văn bản chính sách chính thức…" />
                    <Select.Content>
                      <Select.Item value="__none__">Chưa liên kết</Select.Item>
                      {(dsNguon.data ?? []).map((n) => (
                        <Select.Item key={n.id} value={n.id}>
                          {n.tieu_de}
                        </Select.Item>
                      ))}
                    </Select.Content>
                  </Select.Root>
                  <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <Checkbox
                      checked={form.che_do_bao_ve}
                      onCheckedChange={(v) => {
                        setForm({ ...form, che_do_bao_ve: v === true });
                        setKeHoachDirty(true);
                      }}
                    />
                    <Text size="1">Chế độ bảo vệ — duyệt phải ghi reviewer (#16)</Text>
                  </label>
                </Flex>
                <TextArea
                  value={form.mo_ta}
                  onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => {
                    setForm({ ...form, mo_ta: e.target.value });
                    setKeHoachDirty(true);
                  }}
                  placeholder="Mô tả ngắn về chính sách"
                  rows={2}
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
                  {cq?.nguon_cong_quyen && (
                    <Button size="1" variant="outline" asChild>
                      <a href={`#/nguon?id=${cq.nguon_cong_quyen.id}`}>Nguồn fact tự động</a>
                    </Button>
                  )}
                  {cq?.nguon_chinh_sach && (
                    <Button size="1" variant="outline" asChild>
                      <a href={`#/nguon?id=${cq.nguon_chinh_sach.id}`}>
                        Văn bản: {cq.nguon_chinh_sach.tieu_de}
                      </a>
                    </Button>
                  )}
                </Flex>
                <Text size="1" color="gray">
                  Nguồn fact tự động chiếu phiên bản, phạm vi, ngày hiệu lực và từng yêu
                  cầu/ngoại lệ/fact thành mục nguồn — sửa field ở đây là đổi nguồn, đầu ra
                  phụ thuộc được đánh dấu lại.
                </Text>
              </Flex>
            </Card>

            {/* Yêu cầu chính sách — bắt buộc vs giải thích, mỗi mục trỏ bằng chứng */}
            <Card>
              <Flex direction="column" gap="2">
                <Text size="2" weight="bold">
                  Yêu cầu chính sách ({dsYeuCau.length})
                </Text>
                <Text size="1" color="gray">
                  "Bắt buộc" là nghĩa vụ pháp lý — đầu ra phải trình bày nguyên văn nghĩa
                  vụ; "giải thích" chỉ giải thích, không được viết như điều bắt buộc. Mỗi
                  yêu cầu trỏ nguồn đã nạp; yêu cầu chưa có bằng chứng chỉ được để dạng câu
                  hỏi.
                </Text>
                {dsYeuCau.map((y, i) => {
                  const view = ycView[i];
                  return (
                    <Card key={y.id} variant="surface">
                      <Flex direction="column" gap="2">
                        <Flex gap="2" align="center" wrap="wrap">
                          <Badge variant="outline">{y.id}</Badge>
                          <Select.Root
                            value={y.loai || "bat_buoc"}
                            onValueChange={(v) => {
                              const ds = [...dsYeuCau];
                              ds[i] = { ...y, loai: v as YeuCauCongQuyen["loai"] };
                              setDsYeuCau(ds);
                              setKeHoachDirty(true);
                            }}
                          >
                            <Select.Trigger />
                            <Select.Content>
                              <Select.Item value="bat_buoc">Bắt buộc</Select.Item>
                              <Select.Item value="giai_thich">Giải thích</Select.Item>
                            </Select.Content>
                          </Select.Root>
                          <Select.Root
                            value={y.doi_tuong_ap_dung || "__tat_ca__"}
                            onValueChange={(v) => {
                              const ds = [...dsYeuCau];
                              ds[i] = { ...y, doi_tuong_ap_dung: v === "__tat_ca__" ? "" : v };
                              setDsYeuCau(ds);
                              setKeHoachDirty(true);
                            }}
                          >
                            <Select.Trigger placeholder="Đối tượng áp dụng…" />
                            <Select.Content>
                              {Object.entries(NHAN_DOI_TUONG_AP_DUNG).map(([k, nhan]) => (
                                <Select.Item key={k || "__tat_ca__"} value={k || "__tat_ca__"}>
                                  {nhan}
                                </Select.Item>
                              ))}
                            </Select.Content>
                          </Select.Root>
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
                              setDsYeuCau(dsYeuCau.filter((x) => x.id !== y.id));
                              setDsNgoaiLe(dsNgoaiLe.filter((x) => x.yeu_cau_id !== y.id));
                              setKeHoachDirty(true);
                            }}
                          >
                            Xóa
                          </Button>
                        </Flex>
                        <TextArea
                          value={y.noi_dung}
                          onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => {
                            const ds = [...dsYeuCau];
                            ds[i] = { ...y, noi_dung: e.target.value };
                            setDsYeuCau(ds);
                            setKeHoachDirty(true);
                          }}
                          placeholder="Nội dung yêu cầu như trong văn bản chính sách — không viết lại theo ý mình"
                          rows={2}
                        />
                        <ChonBangChung
                          nguonId={y.nguon_id}
                          mucId={y.muc_id}
                          onDoi={(nId, mId) => {
                            const ds = [...dsYeuCau];
                            ds[i] = { ...y, nguon_id: nId, muc_id: mId };
                            setDsYeuCau(ds);
                            setKeHoachDirty(true);
                          }}
                        />
                      </Flex>
                    </Card>
                  );
                })}
                <Button
                  size="1"
                  variant="outline"
                  style={{ alignSelf: "flex-start" }}
                  onClick={() => {
                    setDsYeuCau([
                      ...dsYeuCau,
                      {
                        id: idMoi("yc"),
                        noi_dung: "",
                        loai: "bat_buoc",
                        doi_tuong_ap_dung: "",
                        nguon_id: null,
                        muc_id: null,
                      },
                    ]);
                    setKeHoachDirty(true);
                  }}
                >
                  + Thêm yêu cầu
                </Button>
              </Flex>
            </Card>

            {/* Ngoại lệ — liên kết yêu cầu để đầu ra giữ điều kiện loại trừ */}
            <Card>
              <Flex direction="column" gap="2">
                <Text size="2" weight="bold">
                  Ngoại lệ ({dsNgoaiLe.length})
                </Text>
                <Text size="1" color="gray">
                  Ngoại lệ của một yêu cầu phải đi cùng yêu cầu đó trong đầu ra — bản dịch
                  hay tóm tắt không được bỏ ngoại lệ. Liên kết yêu cầu tương ứng.
                </Text>
                {dsNgoaiLe.map((x, i) => {
                  const view = nlView[i];
                  return (
                    <Card key={x.id} variant="surface">
                      <Flex direction="column" gap="2">
                        <Flex gap="2" align="center" wrap="wrap">
                          <Badge variant="outline">{x.id}</Badge>
                          <Select.Root
                            value={x.yeu_cau_id || "__chung__"}
                            onValueChange={(v) => {
                              const ds = [...dsNgoaiLe];
                              ds[i] = { ...x, yeu_cau_id: v === "__chung__" ? "" : v };
                              setDsNgoaiLe(ds);
                              setKeHoachDirty(true);
                            }}
                          >
                            <Select.Trigger placeholder="Thuộc yêu cầu…" />
                            <Select.Content>
                              <Select.Item value="__chung__">Chung</Select.Item>
                              {dsYeuCau.map((yc) => (
                                <Select.Item key={yc.id} value={yc.id}>
                                  {yc.id} — {yc.noi_dung.slice(0, 50) || "…"}
                                </Select.Item>
                              ))}
                            </Select.Content>
                          </Select.Root>
                          {x.yeu_cau_id && !idYeuCau.has(x.yeu_cau_id) && (
                            <Badge color="red">Yêu cầu đã xóa</Badge>
                          )}
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
                              setDsNgoaiLe(dsNgoaiLe.filter((k) => k.id !== x.id));
                              setKeHoachDirty(true);
                            }}
                          >
                            Xóa
                          </Button>
                        </Flex>
                        <TextArea
                          value={x.noi_dung}
                          onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => {
                            const ds = [...dsNgoaiLe];
                            ds[i] = { ...x, noi_dung: e.target.value };
                            setDsNgoaiLe(ds);
                            setKeHoachDirty(true);
                          }}
                          placeholder="Điều kiện ngoại lệ như trong văn bản (vd: hộ có hộ khẩu tạm trú được gia hạn 6 tháng)"
                          rows={2}
                        />
                        <ChonBangChung
                          nguonId={x.nguon_id}
                          mucId={x.muc_id}
                          onDoi={(nId, mId) => {
                            const ds = [...dsNgoaiLe];
                            ds[i] = { ...x, nguon_id: nId, muc_id: mId };
                            setDsNgoaiLe(ds);
                            setKeHoachDirty(true);
                          }}
                        />
                      </Flex>
                    </Card>
                  );
                })}
                <Button
                  size="1"
                  variant="outline"
                  style={{ alignSelf: "flex-start" }}
                  onClick={() => {
                    setDsNgoaiLe([
                      ...dsNgoaiLe,
                      { id: idMoi("nl"), noi_dung: "", yeu_cau_id: "", nguon_id: null, muc_id: null },
                    ]);
                    setKeHoachDirty(true);
                  }}
                >
                  + Thêm ngoại lệ
                </Button>
              </Flex>
            </Card>

            {/* Fact vận hành hỗ trợ — điểm thu, lịch thu, đường dây nóng */}
            <Card>
              <Flex direction="column" gap="2">
                <Text size="2" weight="bold">
                  Fact vận hành ({dsFact.length})
                </Text>
                <Text size="1" color="gray">
                  Thông tin vận hành hỗ trợ (điểm thu gom, lịch thu, đường dây nóng) — không
                  phải yêu cầu pháp lý. Mỗi fact trỏ nguồn đã nạp.
                </Text>
                {dsFact.map((f, i) => {
                  const view = fvView[i];
                  return (
                    <Card key={f.id} variant="surface">
                      <Flex direction="column" gap="2">
                        <Flex gap="2" align="center" wrap="wrap">
                          <Badge variant="outline">{f.id}</Badge>
                          <TextField.Root
                            value={f.tieu_de}
                            onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                              const ds = [...dsFact];
                              ds[i] = { ...f, tieu_de: e.target.value };
                              setDsFact(ds);
                              setKeHoachDirty(true);
                            }}
                            placeholder="Tiêu đề fact (vd: Điểm thu gom tái chế)"
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
                              setDsFact(dsFact.filter((k) => k.id !== f.id));
                              setKeHoachDirty(true);
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
                            setKeHoachDirty(true);
                          }}
                          placeholder="Nội dung fact từ tư liệu đã nạp"
                          rows={2}
                        />
                        <ChonBangChung
                          nguonId={f.nguon_id}
                          mucId={f.muc_id}
                          onDoi={(nId, mId) => {
                            const ds = [...dsFact];
                            ds[i] = { ...f, nguon_id: nId, muc_id: mId };
                            setDsFact(ds);
                            setKeHoachDirty(true);
                          }}
                        />
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
                      { id: idMoi("fv"), tieu_de: "", noi_dung: "", nguon_id: null, muc_id: null },
                    ]);
                    setKeHoachDirty(true);
                  }}
                >
                  + Thêm fact
                </Button>
              </Flex>
            </Card>

            {/* Reviewer thẩm quyền của POC — ghi vào record duyệt */}
            <Card>
              <Flex direction="column" gap="2">
                <Text size="2" weight="bold">
                  Người duyệt thẩm quyền ({dsNguoiDuyet.length})
                </Text>
                <Text size="1" color="gray">
                  Reviewer local được ghi trong POC — cổng review ghi người chấm vào record
                  duyệt; bật chế độ bảo vệ (#16) thì duyệt bắt buộc phải chọn reviewer.
                </Text>
                {dsNguoiDuyet.map((r, i) => (
                  <Flex key={r.id} gap="2" align="center" wrap="wrap">
                    <Badge variant="outline">{r.id}</Badge>
                    <TextField.Root
                      value={r.ten}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                        const ds = [...dsNguoiDuyet];
                        ds[i] = { ...r, ten: e.target.value };
                        setDsNguoiDuyet(ds);
                        setKeHoachDirty(true);
                      }}
                      placeholder="Tên reviewer (vd: Nguyễn Thị Lan)"
                      style={{ minWidth: 200 }}
                    />
                    <TextField.Root
                      value={r.vai_tro}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                        const ds = [...dsNguoiDuyet];
                        ds[i] = { ...r, vai_tro: e.target.value };
                        setDsNguoiDuyet(ds);
                        setKeHoachDirty(true);
                      }}
                      placeholder="Vai trò (vd: tham mưu pháp chế)"
                      style={{ minWidth: 200, flex: 1 }}
                    />
                    <Button
                      size="1"
                      variant="ghost"
                      color="red"
                      onClick={() => {
                        setDsNguoiDuyet(dsNguoiDuyet.filter((x) => x.id !== r.id));
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
                    setDsNguoiDuyet([
                      ...dsNguoiDuyet,
                      { id: idMoi("nd"), ten: "", vai_tro: "" },
                    ]);
                    setKeHoachDirty(true);
                  }}
                >
                  + Thêm reviewer
                </Button>
              </Flex>
            </Card>

            {/* Điều khoản nguồn mơ hồ → câu hỏi review, không phải luật bịa */}
            {cq && cq.dieu_khoan_mo_ho.length > 0 && (
              <Card>
                <Flex direction="column" gap="2">
                  <Text size="2" weight="bold">
                    Điều khoản nguồn mơ hồ ({cq.dieu_khoan_mo_ho.length})
                  </Text>
                  <Text size="1" color="gray">
                    Mệnh đề chứa từ ngữ mơ hồ trong nguồn đã nạp — đầu ra để thành câu hỏi
                    cho thẩm quyền, không diễn giải thay luật.
                  </Text>
                  {cq.dieu_khoan_mo_ho.map((dk) => (
                    <Card key={dk.id} variant="surface">
                      <Flex direction="column" gap="1">
                        <Flex gap="2" align="center" wrap="wrap">
                          <Badge color="amber">{dk.danh_dau}</Badge>
                          <Text size="1" color="gray">
                            {dk.nguon_tieu_de}
                            {dk.muc_id ? ` — mục ${dk.muc_id}` : ""}
                          </Text>
                        </Flex>
                        <Text size="1">{dk.trich}</Text>
                      </Flex>
                    </Card>
                  ))}
                </Flex>
              </Card>
            )}

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

            {/* Cổng review thẩm quyền — claim gắn revision chính sách */}
            {cq && (
              <Card>
                <Flex direction="column" gap="2">
                  <Text size="2" weight="bold">
                    Cổng review thẩm quyền ({cq.dau_ra.length} đầu ra)
                  </Text>
                  <Text size="1" color="gray">
                    Mỗi đầu ra ghi revision chính sách mà nội dung ghim — duyệt ở đây chọn
                    reviewer đã khai báo và server chặn duyệt đầu ra đang ghim chính sách
                    cũ. Đầu ra "cũ" phải sinh lại rồi mới duyệt được.
                  </Text>
                  <Table.Root>
                    <Table.Header>
                      <Table.Row>
                        <Table.ColumnHeaderCell>Định dạng</Table.ColumnHeaderCell>
                        <Table.ColumnHeaderCell>Đối tượng</Table.ColumnHeaderCell>
                        <Table.ColumnHeaderCell>Ngôn ngữ</Table.ColumnHeaderCell>
                        <Table.ColumnHeaderCell>Trạng thái</Table.ColumnHeaderCell>
                        <Table.ColumnHeaderCell>Revision chính sách</Table.ColumnHeaderCell>
                        <Table.ColumnHeaderCell>Review</Table.ColumnHeaderCell>
                      </Table.Row>
                    </Table.Header>
                    <Table.Body>
                      {cq.dau_ra.map((d) => (
                        <Table.Row key={d.ban_the_hien_id}>
                          <Table.Cell>
                            <a href={`#/ban-the-hien?id=${d.ban_the_hien_id}`}>
                              {nhanDd(d.dinh_dang)}
                            </a>
                          </Table.Cell>
                          <Table.Cell>{d.doi_tuong || "chung"}</Table.Cell>
                          <Table.Cell>{d.ngon_ngu || "vi"}</Table.Cell>
                          <Table.Cell>
                            <Flex gap="1" align="center">
                              <Badge color={MAU_TRANG_THAI[d.trang_thai] ?? "gray"}>
                                {NHAN_TRANG_THAI[d.trang_thai] ?? d.trang_thai}
                              </Badge>
                              {d.la_cu && <Badge color="orange">Cũ</Badge>}
                            </Flex>
                          </Table.Cell>
                          <Table.Cell>
                            {d.revision_chinh_sach ? (
                              <Text size="1">rev {d.revision_chinh_sach.so_thu_tu}</Text>
                            ) : (
                              <Text size="1" color="gray">
                                —
                              </Text>
                            )}
                            {d.nguoi_duyet_cuoi && (
                              <Text size="1" color="gray">
                                {" "}· duyệt bởi {d.nguoi_duyet_cuoi.ten}
                              </Text>
                            )}
                          </Table.Cell>
                          <Table.Cell>
                            {d.trang_thai === "cho_duyet" && !d.la_cu ? (
                              <Flex gap="2" align="center">
                                <Select.Root
                                  value={chonNguoiDuyet[d.ban_the_hien_id] || "__none__"}
                                  onValueChange={(v) =>
                                    setChonNguoiDuyet({
                                      ...chonNguoiDuyet,
                                      [d.ban_the_hien_id]: v === "__none__" ? "" : v,
                                    })
                                  }
                                >
                                  <Select.Trigger placeholder="Reviewer…" />
                                  <Select.Content>
                                    <Select.Item value="__none__">Không ghi</Select.Item>
                                    {cq.ds_nguoi_duyet.map((r) => (
                                      <Select.Item key={r.id} value={r.id}>
                                        {r.ten}
                                      </Select.Item>
                                    ))}
                                  </Select.Content>
                                </Select.Root>
                                <Button
                                  size="1"
                                  onClick={() => duyetDauRa(d.ban_the_hien_id, d.head_revision_id, "da_duyet")}
                                  disabled={
                                    dangDuyet === d.ban_the_hien_id ||
                                    (cq.che_do_bao_ve === 1 && !chonNguoiDuyet[d.ban_the_hien_id])
                                  }
                                >
                                  Duyệt
                                </Button>
                                <Button
                                  size="1"
                                  variant="soft"
                                  color="red"
                                  onClick={() => duyetDauRa(d.ban_the_hien_id, d.head_revision_id, "tu_choi")}
                                  disabled={dangDuyet === d.ban_the_hien_id}
                                >
                                  Từ chối
                                </Button>
                              </Flex>
                            ) : d.trang_thai === "cho_duyet" && d.la_cu ? (
                              <Text size="1" color="orange">
                                Ghim chính sách cũ — sinh lại rồi mới duyệt
                              </Text>
                            ) : (
                              <Text size="1" color="gray">
                                —
                              </Text>
                            )}
                          </Table.Cell>
                        </Table.Row>
                      ))}
                    </Table.Body>
                  </Table.Root>
                </Flex>
              </Card>
            )}

            {/* Ảnh hưởng của thay đổi chính sách — 4 đích liệt kê riêng */}
            {cq && soDauRaBiAnhHuong > 0 && (
              <Card>
                <Flex direction="column" gap="2">
                  <Text size="2" weight="bold">
                    Ảnh hưởng của thay đổi chính sách
                  </Text>
                  <Text size="1" color="gray">
                    Đầu ra phụ thuộc đang ghim chính sách cũ hoặc có task sửa mở — liệt kê
                    riêng theo đích: nháp cần sinh lại, đã xuất cần revision thay thế được
                    review rồi xuất bản lại, đã lên lịch bị chặn chạy cho tới khi review,
                    đã đăng cần sửa copy tay ở đích ngoài (task sửa, không tự cập nhật).
                  </Text>
                  {(["nhap", "da_xuat", "da_len_lich", "da_dang"] as const).map((nhom) => {
                    const ds = cq.anh_huong[nhom];
                    if (ds.length === 0) return null;
                    return (
                      <Card key={nhom} variant="surface">
                        <Flex direction="column" gap="1">
                          <Text size="2" weight="medium">
                            {NHAN_NHOM_ANH_HUONG[nhom]} ({ds.length})
                          </Text>
                          {ds.map((x: DauRaAnhHuong) => (
                            <Flex key={x.ban_the_hien_id} gap="2" align="center" wrap="wrap">
                              <a href={`#/ban-the-hien?id=${x.ban_the_hien_id}`}>
                                {nhanDd(x.dinh_dang)}
                              </a>
                              <Badge variant="outline">{x.doi_tuong || "chung"}</Badge>
                              {x.ngon_ngu !== "vi" && <Badge color="purple">{x.ngon_ngu}</Badge>}
                              <Badge color={MAU_TRANG_THAI[x.trang_thai] ?? "gray"}>
                                {NHAN_TRANG_THAI[x.trang_thai] ?? x.trang_thai}
                              </Badge>
                              {x.la_cu && <Badge color="orange">Nguồn cũ</Badge>}
                              {x.ds_task_mo.length > 0 && (
                                <Badge color="amber">{x.ds_task_mo.length} task sửa</Badge>
                              )}
                              {x.job_len_lich_id && (
                                <Badge color="red">Job đã lên lịch bị chặn</Badge>
                              )}
                              {x.ds_xuat_ban.some((xb) => xb.dich_den.trim() !== "") && (
                                <Badge color="indigo">
                                  Đã đăng:{" "}
                                  {x.ds_xuat_ban
                                    .filter((xb) => xb.dich_den.trim() !== "")
                                    .map((xb) => xb.dich_den)
                                    .join(", ")}
                                </Badge>
                              )}
                            </Flex>
                          ))}
                        </Flex>
                      </Card>
                    );
                  })}
                </Flex>
              </Card>
            )}

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
                  Mỗi mục là một đầu ra cho một đối tượng/định dạng/ngôn ngữ — FAQ hộ gia
                  đình, checklist doanh nghiệp, bài giải thích trường học, tóm tắt nhà
                  thầu và bản dịch ngôn ngữ giản dị (khi chọn ngôn ngữ thứ hai).
                </Text>
                {mucLucDirty && (
                  <Text size="1" color="amber">
                    Danh sách có sửa chưa lưu — bấm "Lưu danh sách" trước khi nháp.
                  </Text>
                )}
                {mucLuc.length === 0 && (
                  <Text size="2" color="gray">
                    Chưa có đầu ra nào — bấm "Áp dụng đầu ra đề xuất" để lấy mẫu theo nhóm
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
                        dinh_dang: "faq-cong-dan",
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

            {/* Gợi ý khoảng trống + câu hỏi review */}
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
