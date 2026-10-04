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
import type { BanTheHien, Campaign, MucLuc, Nguon } from "../../modules/content/index.ts";
import type { HoSoDoiTuong, HoSoThuongHieu } from "../../modules/context/index.ts";
import type { GoiYKhoangTrong, ThamChieuView, TienDoSoBao } from "../../modules/so_bao/index.ts";

// Trang Số báo (#8): danh sách campaign số báo + chi tiết một số — field
// số báo sửa được, tham chiếu nguồn gắn cờ thiếu văn bản, mục lục đề xuất
// sửa được + chọn mục để nháp, gợi ý khoảng trống tách khỏi nội dung đã
// đặt, tiến độ cấp số + hàng chờ review, export gói số.

type ChiTietSoBao = Campaign & {
  thong_diep: { id: string; tieu_de: string }[];
  thong_diep_chu_de: { id: string; tieu_de: string } | null;
  tham_chieu_view: ThamChieuView[];
  de_xuat_muc_luc: MucLuc[];
  goi_y: GoiYKhoangTrong[];
  tien_do: TienDoSoBao;
  hang_cho: BanTheHien[];
};

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

export default function SoBaoPage() {
  const path = useHashRoute();
  const id = new URLSearchParams(path.split("?")[1] ?? "").get("id");
  return id ? <ChiTietSoBaoView id={id} /> : <DanhSachSoBao />;
}

// --- Danh sách + tạo số báo ---

function DanhSachSoBao() {
  const { data, loading, error, reload } = useApi<Campaign[]>("/api/campaign");
  const [ten, setTen] = useState("");
  const [soThuTu, setSoThuTu] = useState("");
  const [ngayPhatHanh, setNgayPhatHanh] = useState("");
  const [chuDe, setChuDe] = useState("");
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
          ten,
          so_thu_tu: soThuTu.trim() ? Number(soThuTu) : null,
          ngay_phat_hanh: ngayPhatHanh,
          chu_de: chuDe,
        }),
      });
      window.location.hash = `#/so-bao?id=${cp.id}`;
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
      <Heading mb="3">Số báo</Heading>
      <Card mb="4">
        <Flex direction="column" gap="2">
          <Text size="2" weight="bold">
            Tạo số báo mới
          </Text>
          <Flex gap="2" wrap="wrap">
            <TextField.Root
              placeholder="Tên số báo (bắt buộc)"
              value={ten}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTen(e.target.value)}
              style={{ flex: 2, minWidth: 220 }}
            />
            <TextField.Root
              placeholder="Số thứ tự"
              value={soThuTu}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSoThuTu(e.target.value)}
              style={{ width: 110 }}
            />
            <TextField.Root
              type="date"
              value={ngayPhatHanh}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                setNgayPhatHanh(e.target.value)
              }
              style={{ width: 160 }}
            />
            <TextField.Root
              placeholder="Chủ đề số"
              value={chuDe}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setChuDe(e.target.value)}
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
              Tạo số báo
            </Button>
          </Flex>
        </Flex>
      </Card>
      <TrangThai loading={loading} error={error} empty={!data?.length}>
        <Table.Root>
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeaderCell>Số</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>Tên</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>Chủ đề</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>Phát hành</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>Chủ biên</Table.ColumnHeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {(data ?? []).map((cp) => (
              <Table.Row key={cp.id}>
                <Table.Cell>{cp.so_thu_tu ?? "—"}</Table.Cell>
                <Table.Cell>
                  <a href={`#/so-bao?id=${cp.id}`}>{cp.ten}</a>
                </Table.Cell>
                <Table.Cell>{cp.chu_de || "—"}</Table.Cell>
                <Table.Cell>{cp.ngay_phat_hanh || "—"}</Table.Cell>
                <Table.Cell>{cp.chu_bien || "—"}</Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Root>
      </TrangThai>
    </>
  );
}

// --- Chi tiết một số báo ---

function ChiTietSoBaoView({ id }: { id: string }) {
  const chiTiet = useApi<ChiTietSoBao>(`/api/campaign/${id}`, [id]);
  const dsDinhDang = useApi<{ id: string; nhan: string }[]>("/api/dinh-dang");
  const dsDoiTuong = useApi<HoSoDoiTuong[]>("/api/ho-so-doi-tuong");
  const dsThuongHieu = useApi<HoSoThuongHieu[]>("/api/ho-so-thuong-hieu");
  const dsNguon = useApi<Nguon[]>("/api/nguon");
  const dsDauRa = useApi<BanTheHien[]>(`/api/ban-the-hien?campaign_id=${id}`, [id]);

  // Field số báo sửa được — nạp từ server một lần khi đổi số.
  const [form, setForm] = useState({
    ten: "",
    mo_ta: "",
    so_thu_tu: "",
    ngay_phat_hanh: "",
    chu_de: "",
    lap_truong: "",
    chu_bien: "",
    thuong_hieu_id: "",
    doi_tuong_id: "",
  });
  const [mucLuc, setMucLuc] = useState<MucLuc[]>([]);
  // dirty = user đang sửa mục lục cục bộ chưa lưu — refetch server không
  // được ghi đè bản nháp đó (và bản nháp cũ không được ghi đè mục server
  // vừa thêm qua POST /them).
  const [mucLucDirty, setMucLucDirty] = useState(false);
  const [chon, setChon] = useState<Set<string>>(new Set());
  const [dsLoi, setDsLoi] = useState<string[]>([]);
  const [trangThaiLuu, setTrangThaiLuu] = useState("");
  const [dangSinh, setDangSinh] = useState(false);
  const [nguonLienKet, setNguonLienKet] = useState<Record<string, string>>({});
  const [tcMoi, setTcMoi] = useState({ tham_chieu: "", ban_dich: "", nguon_id: "", ghi_chu: "" });

  useEffect(() => {
    const cp = chiTiet.data;
    if (!cp) return;
    setForm({
      ten: cp.ten,
      mo_ta: cp.mo_ta,
      so_thu_tu: cp.so_thu_tu !== null ? String(cp.so_thu_tu) : "",
      ngay_phat_hanh: cp.ngay_phat_hanh,
      chu_de: cp.chu_de,
      lap_truong: cp.lap_truong,
      chu_bien: cp.chu_bien,
      thuong_hieu_id: cp.thuong_hieu_id ?? "",
      doi_tuong_id: cp.doi_tuong_id ?? "",
    });
    setMucLuc(cp.muc_luc);
    setMucLucDirty(false);
    setNguonLienKet({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chiTiet.data?.id]);

  // Resync mục lục khi server đổi mà user không sửa cục bộ — giữ bản nháp
  // đang sửa, tránh state cũ nuốt mục server vừa thêm.
  useEffect(() => {
    const cp = chiTiet.data;
    if (!cp || mucLucDirty) return;
    setMucLuc(cp.muc_luc);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chiTiet.data, mucLucDirty]);

  // Mọi sửa cục bộ vào mục lục đi qua đây để đánh dấu dirty.
  function suaMucLuc(ds: MucLuc[]) {
    setMucLuc(ds);
    setMucLucDirty(true);
  }

  function loiText(e: unknown): string[] {
    if (e instanceof LoiApiClient) {
      return [
        `${e.ma}: ${e.message}`,
        ...(Array.isArray(e.chiTiet) ? (e.chiTiet as unknown[]).map(String) : []),
      ];
    }
    return [String(e)];
  }

  async function luuThongTin() {
    setDsLoi([]);
    setTrangThaiLuu("");
    try {
      await api(`/api/campaign/${id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ten: form.ten,
          mo_ta: form.mo_ta,
          so_thu_tu: form.so_thu_tu.trim() ? Number(form.so_thu_tu) : null,
          ngay_phat_hanh: form.ngay_phat_hanh,
          chu_de: form.chu_de,
          lap_truong: form.lap_truong,
          chu_bien: form.chu_bien,
          thuong_hieu_id: form.thuong_hieu_id || null,
          doi_tuong_id: form.doi_tuong_id || null,
        }),
      });
      setTrangThaiLuu(`Đã lưu ${new Date().toLocaleTimeString("vi")}`);
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
    // `chon` có thể giữ id mục mới chưa lưu hay mục đã xóa — chỉ gửi id
    // còn trong mục lục đã lưu (server validate theo bản lưu, không theo
    // nháp cục bộ) để tránh 400 'không có trong mục lục'.
    if (chonHopLe.size === 0) {
      setDsLoi(["Tick ít nhất một mục trong mục lục để nháp."]);
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
      setDsLoi(["Tham chiếu mới cần nội dung tham chiếu."]);
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
              id: `tc-${crypto.randomUUID().slice(0, 8)}`,
              tham_chieu: tcMoi.tham_chieu.trim(),
              ban_dich: tcMoi.ban_dich.trim(),
              nguon_id: tcMoi.nguon_id || null,
              ghi_chu: tcMoi.ghi_chu.trim(),
            },
          ],
        }),
      });
      setTcMoi({ tham_chieu: "", ban_dich: "", nguon_id: "", ghi_chu: "" });
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
      // Server đã ghi mục vào muc_luc đã lưu. Đang sửa cục bộ → chỉ merge
      // mục mới vào bản nháp (giữ sửa của user); sạch → nhận mảng server.
      if (mucLucDirty) {
        const moi = cpMoi.muc_luc.at(-1);
        if (moi && !mucLuc.some((m) => m.id === moi.id)) {
          setMucLuc([...mucLuc, moi]);
        }
      } else {
        setMucLuc(cpMoi.muc_luc);
      }
      chiTiet.reload();
    } catch (e) {
      setDsLoi(loiText(e));
    }
  }

  function apDungMauDeXuat() {
    const cp = chiTiet.data;
    if (!cp) return;
    // Điền mẫu đề xuất cho chỗ còn trống theo id — mục biên tập đã thêm/
    // sửa giữ nguyên.
    const daCo = new Set(mucLuc.map((m) => m.id));
    suaMucLuc([...mucLuc, ...cp.de_xuat_muc_luc.filter((m) => !daCo.has(m.id))]);
  }

  const cp = chiTiet.data;
  const nhanDd = (dd: string) => dsDinhDang.data?.find((x) => x.id === dd)?.nhan ?? dd;
  const bthCuaMuc = new Map<string, { bth: BanTheHien; daXuat: boolean }>();
  for (const m of cp?.tien_do.muc ?? []) {
    if (m.ban_the_hien) bthCuaMuc.set(m.muc.id, { bth: m.ban_the_hien, daXuat: m.da_xuat_ban });
  }
  // Tick hợp lệ = id còn trong mục lục đã lưu trên server — mục mới thêm
  // cục bộ chưa lưu hay mục đã xóa (kể cả server bỏ) không được gửi nháp.
  const idDaLuu = new Set((cp?.muc_luc ?? []).map((m) => m.id));
  const chonHopLe = new Set([...chon].filter((x) => idDaLuu.has(x)));

  return (
    <>
      <Flex align="center" justify="between" mb="3">
        <Heading>
          Số báo{cp?.so_thu_tu !== null && cp?.so_thu_tu !== undefined ? ` ${cp.so_thu_tu}` : ""}
          {cp?.chu_de ? ` — ${cp.chu_de}` : ""}
        </Heading>
        <a href="#/so-bao">← Danh sách số báo</a>
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

            {/* Thông tin số báo */}
            <Card>
              <Flex direction="column" gap="2">
                <Flex justify="between" align="center">
                  <Text size="2" weight="bold">
                    Thông tin số báo
                  </Text>
                  <Flex gap="2" align="center">
                    {trangThaiLuu && (
                      <Text size="1" color="gray">
                        {trangThaiLuu}
                      </Text>
                    )}
                    <Button size="1" variant="soft" onClick={luuThongTin}>
                      Lưu thông tin số
                    </Button>
                  </Flex>
                </Flex>
                <Flex gap="2" wrap="wrap">
                  <TextField.Root
                    value={form.ten}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                      setForm({ ...form, ten: e.target.value })
                    }
                    placeholder="Tên số báo"
                    style={{ flex: 2, minWidth: 220 }}
                  />
                  <TextField.Root
                    value={form.so_thu_tu}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                      setForm({ ...form, so_thu_tu: e.target.value })
                    }
                    placeholder="Số thứ tự"
                    style={{ width: 110 }}
                  />
                  <TextField.Root
                    type="date"
                    value={form.ngay_phat_hanh}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                      setForm({ ...form, ngay_phat_hanh: e.target.value })
                    }
                    style={{ width: 160 }}
                  />
                  <TextField.Root
                    value={form.chu_bien}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                      setForm({ ...form, chu_bien: e.target.value })
                    }
                    placeholder="Chủ biên"
                    style={{ flex: 1, minWidth: 160 }}
                  />
                </Flex>
                <TextField.Root
                  value={form.chu_de}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    setForm({ ...form, chu_de: e.target.value })
                  }
                  placeholder="Chủ đề số"
                />
                <TextArea
                  value={form.lap_truong}
                  onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
                    setForm({ ...form, lap_truong: e.target.value })
                  }
                  placeholder="Lập trường biên tập — định hướng diễn giải do tòa soạn cấu hình; bộ sinh áp đúng hướng này"
                  rows={2}
                />
                <Flex gap="2" wrap="wrap">
                  <Select.Root
                    value={form.thuong_hieu_id || "__none__"}
                    onValueChange={(v) =>
                      setForm({ ...form, thuong_hieu_id: v === "__none__" ? "" : v })
                    }
                  >
                    <Select.Trigger placeholder="Thương hiệu (style/thuật ngữ dùng lại)…" />
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
                    onValueChange={(v) =>
                      setForm({ ...form, doi_tuong_id: v === "__none__" ? "" : v })
                    }
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
                  <Button size="1" variant="outline" asChild>
                    <a href={`/api/campaign/${id}/xuat`} download>
                      Tải gói số (ZIP)
                    </a>
                  </Button>
                </Flex>
              </Flex>
            </Card>

            {/* Tham chiếu nguồn đã khai báo */}
            <Card>
              <Flex direction="column" gap="2">
                <Text size="2" weight="bold">
                  Tham chiếu đã khai báo
                </Text>
                <Text size="1" color="gray">
                  Mỗi tham chiếu ghi bản dịch đã chọn; nguồn văn bản liên kết để trích dẫn
                  đối chiếu được. Thiếu văn bản bị gắn cờ.
                </Text>
                <Table.Root>
                  <Table.Header>
                    <Table.Row>
                      <Table.ColumnHeaderCell>Tham chiếu</Table.ColumnHeaderCell>
                      <Table.ColumnHeaderCell>Bản dịch</Table.ColumnHeaderCell>
                      <Table.ColumnHeaderCell>Văn bản nguồn</Table.ColumnHeaderCell>
                      <Table.ColumnHeaderCell>Ghi chú</Table.ColumnHeaderCell>
                    </Table.Row>
                  </Table.Header>
                  <Table.Body>
                    {cp.tham_chieu_view.map((t) => (
                      <Table.Row key={t.id}>
                        <Table.Cell>{t.tham_chieu}</Table.Cell>
                        <Table.Cell>{t.ban_dich || "—"}</Table.Cell>
                        <Table.Cell>
                          {t.co_van_ban ? (
                            <Flex gap="2" align="center">
                              <Badge color="green">Có văn bản</Badge>
                              <Text size="1" color="gray">
                                {t.nguon?.tieu_de}
                              </Text>
                            </Flex>
                          ) : (
                            <Flex gap="2" align="center" wrap="wrap">
                              <Badge color="amber">Thiếu văn bản</Badge>
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
                    placeholder="Tham chiếu mới (vd: Sáng Thế 1:1-5)"
                    value={tcMoi.tham_chieu}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                      setTcMoi({ ...tcMoi, tham_chieu: e.target.value })
                    }
                    style={{ minWidth: 220 }}
                  />
                  <TextField.Root
                    placeholder="Bản dịch"
                    value={tcMoi.ban_dich}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                      setTcMoi({ ...tcMoi, ban_dich: e.target.value })
                    }
                    style={{ width: 180 }}
                  />
                  <Select.Root
                    value={tcMoi.nguon_id || "__none__"}
                    onValueChange={(v) => setTcMoi({ ...tcMoi, nguon_id: v === "__none__" ? "" : v })}
                  >
                    <Select.Trigger placeholder="Nguồn văn bản (tùy chọn)…" />
                    <Select.Content>
                      <Select.Item value="__none__">Chưa nạp văn bản</Select.Item>
                      {(dsNguon.data ?? []).map((n) => (
                        <Select.Item key={n.id} value={n.id}>
                          {n.tieu_de}
                        </Select.Item>
                      ))}
                    </Select.Content>
                  </Select.Root>
                  <Button size="1" variant="soft" onClick={themThamChieu}>
                    Thêm tham chiếu
                  </Button>
                </Flex>
              </Flex>
            </Card>

            {/* Tiến độ cấp số */}
            <Card>
              <Flex gap="3" wrap="wrap" align="center">
                <Text size="2" weight="bold">
                  Tiến độ số
                </Text>
                <Badge variant="outline">
                  Mục lục: {cp.tien_do.muc_co_dau_ra}/{cp.tien_do.tong_muc} có đầu ra
                </Badge>
                <Badge color="blue">Chờ duyệt: {cp.tien_do.cho_duyet}</Badge>
                <Badge color="green">Đã duyệt: {cp.tien_do.da_duyet}</Badge>
                <Badge color="indigo">Đã xuất: {cp.tien_do.da_xuat}</Badge>
              </Flex>
            </Card>

            {/* Mục lục đề xuất — sửa được + chọn mục để nháp */}
            <Card>
              <Flex direction="column" gap="2">
                <Flex justify="between" align="center">
                  <Text size="2" weight="bold">
                    Mục lục đề xuất (sửa được)
                  </Text>
                  <Flex gap="2">
                    <Button size="1" variant="outline" onClick={apDungMauDeXuat}>
                      Áp dụng mẫu đề xuất
                    </Button>
                    <Button size="1" variant="soft" onClick={luuMucLuc}>
                      Lưu mục lục
                    </Button>
                    <Button
                      size="1"
                      onClick={sinhChon}
                      disabled={dangSinh || mucLucDirty || chonHopLe.size === 0}
                    >
                      Nháp {chonHopLe.size > 0 ? `${chonHopLe.size} ` : ""}mục đã chọn
                    </Button>
                  </Flex>
                </Flex>
                <Text size="1" color="gray">
                  Tick các mục cần nháp rồi bấm "Nháp mục đã chọn" — chỉ mục được chọn mới
                  sinh, không tự động sinh mọi tổ hợp.
                </Text>
                {mucLucDirty && (
                  <Text size="1" color="amber">
                    Mục lục có sửa chưa lưu — bấm "Lưu mục lục" trước khi nháp các mục đã
                    chọn.
                  </Text>
                )}
                {mucLuc.length === 0 && (
                  <Text size="2" color="gray">
                    Chưa có mục nào — bấm "Áp dụng mẫu đề xuất" để lấy 8 khay mẫu, hoặc thêm
                    từ gợi ý bên dưới.
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
                      <TextField.Root
                        value={m.ly_do}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                          const ds = [...mucLuc];
                          ds[i] = { ...m, ly_do: e.target.value };
                          suaMucLuc(ds);
                        }}
                        placeholder="Lý do"
                        style={{ flex: 1, minWidth: 160 }}
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
                        id: `muc-${crypto.randomUUID().slice(0, 8)}`,
                        tieu_de: "",
                        dinh_dang: "bai-viet",
                        doi_tuong_id: cp.doi_tuong_id,
                        dich_den: "",
                        ly_do: "",
                      },
                    ])
                  }
                >
                  + Thêm mục
                </Button>
              </Flex>
            </Card>

            {/* Gợi ý khoảng trống — tách khỏi nội dung đã đặt/đã duyệt */}
            <Card>
              <Flex direction="column" gap="2">
                <Text size="2" weight="bold">
                  Gợi ý khoảng trống nội dung
                </Text>
                <Text size="1" color="gray">
                  Đây là đề xuất việc kèm lý do/bằng chứng — không phải nội dung đã đặt hay
                  đã duyệt, và không tự khẳng định diễn giải.
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
                            Thêm vào mục lục
                          </Button>
                        )}
                      </Flex>
                      <Text size="1">{g.ly_do}</Text>
                      <Flex direction="column">
                        {g.bang_chung.map((b, i) => (
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

            {/* Hàng chờ review + mọi đầu ra của số */}
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
                  Mọi đầu ra của số ({(dsDauRa.data ?? []).length})
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
