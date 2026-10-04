import {
  Badge,
  Box,
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

// Trang kế hoạch (#5): danh sách + chi tiết một kế hoạch theo luồng
// intake → làm rõ → chọn đầu ra → sinh → sang editor/bản thể hiện.
// Chi tiết đi qua hash query: #/ke-hoach?id=<uuid>.

type KeHoachDong = {
  id: string;
  thong_diep_id: string;
  nguon_id: string | null;
  intake: string;
  cta: string;
  trang_thai: string;
  tao_luc: string;
  cap_nhat_luc: string;
  tieu_de?: string;
};

type DauRa = {
  doi_tuong_id: string | null;
  dinh_dang: string;
  ngon_ngu?: string;
  dich_den?: string;
};

type ChiTietKh = {
  ke_hoach: KeHoachDong;
  thong_diep: { id: string; tieu_de: string } | null;
  nguon: { id: string; tieu_de: string } | null;
  cau_hoi: string[];
  de_xuat: DauRa[];
  ds_chon: DauRa[];
  ho_so_doi_tuong: { id: string; ten: string }[];
};

function khoaDauRa(d: DauRa) {
  // Đích đến thuộc danh tính đầu ra (#6): cùng 'script-ngan' cho hai kênh
  // khác nhau là hai lựa chọn khác nhau, không bị gộp.
  return `${d.doi_tuong_id ?? ""}|${d.dinh_dang}|${d.dich_den ?? ""}`;
}

function DanhSachKh() {
  const ds = useApi<KeHoachDong[]>("/api/ke-hoach");
  return (
    <>
      <Heading mb="3">Kế hoạch</Heading>
      <TrangThai loading={ds.loading} error={ds.error}>
        <Table.Root>
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeaderCell>Tiêu đề</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>Trạng thái</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>Cập nhật</Table.ColumnHeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {(ds.data ?? []).map((k) => (
              <Table.Row key={k.id}>
                <Table.Cell>
                  <a href={`#/ke-hoach?id=${k.id}`}>{k.tieu_de ?? k.id.slice(0, 8)}</a>
                </Table.Cell>
                <Table.Cell>
                  <Badge color={k.trang_thai === "da_chon" ? "green" : "gray"}>
                    {k.trang_thai === "da_chon" ? "Đã chọn" : "Nháp"}
                  </Badge>
                </Table.Cell>
                <Table.Cell>{fmtLuc(k.cap_nhat_luc)}</Table.Cell>
              </Table.Row>
            ))}
            {ds.data && ds.data.length === 0 && (
              <Table.Row>
                <Table.Cell colSpan={3}>
                  <Text color="gray">Chưa có kế hoạch — tạo từ form intake ở Tổng quan.</Text>
                </Table.Cell>
              </Table.Row>
            )}
          </Table.Body>
        </Table.Root>
      </TrangThai>
    </>
  );
}

function ChiTietKhView({ id }: { id: string }) {
  const chiTiet = useApi<ChiTietKh>(`/api/ke-hoach/${id}`, [id]);
  const [tieuDe, setTieuDe] = useState("");
  const [vanBan, setVanBan] = useState("");
  const [cta, setCta] = useState("");
  const [trangThaiLuu, setTrangThaiLuu] = useState("");
  // dsChon là Map khoa → lựa chọn: đề xuất có sẵn lẫn đầu ra tự thêm
  // (dinh_dang + đối tượng + đích đến tự do — vd ba script-ngan).
  const [dsChon, setDsChon] = useState<Map<string, DauRa>>(new Map());
  const [dsLoi, setDsLoi] = useState<string[]>([]);
  const [dangSinh, setDangSinh] = useState(false);
  const [dsBthVuaSinh, setDsBthVuaSinh] = useState<{ id: string; dinh_dang: string }[]>([]);
  const dsDinhDang = useApi<{ id: string; nhan: string }[]>("/api/dinh-dang");
  const [ddThem, setDdThem] = useState("");
  const [dtThem, setDtThem] = useState("");
  const [dichDenThem, setDichDenThem] = useState("");

  // Nạp intake hiện lưu vào form một lần — tiếp tục soạn đúng chỗ đã dừng.
  useEffect(() => {
    const k = chiTiet.data?.ke_hoach;
    if (k) {
      setTieuDe(chiTiet.data!.thong_diep?.tieu_de ?? "");
      setVanBan(k.intake);
      setCta(k.cta ?? "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chiTiet.data?.ke_hoach?.id]);

  async function luu() {
    setDsLoi([]);
    try {
      await api(`/api/ke-hoach/${id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ van_ban: vanBan, tieu_de: tieuDe, cta }),
      });
      setTrangThaiLuu(`Đã lưu ${new Date().toLocaleTimeString("vi")}`);
      chiTiet.reload();
    } catch (e) {
      setDsLoi([e instanceof LoiApiClient ? `${e.ma}: ${e.message}` : String(e)]);
    }
  }

  function themDauRa() {
    setDsLoi([]);
    if (!ddThem) {
      setDsLoi(["Chọn định dạng trước khi thêm."]);
      return;
    }
    const dx: DauRa = {
      doi_tuong_id: dtThem && dtThem !== "__chung__" ? dtThem : null,
      dinh_dang: ddThem,
      ngon_ngu: "vi",
      dich_den: dichDenThem.trim() || undefined,
    };
    const m = new Map(dsChon);
    m.set(khoaDauRa(dx), dx);
    setDsChon(m);
    setDichDenThem("");
  }

  async function sinh() {
    const chon = [...dsChon.values()];
    if (chon.length === 0) {
      setDsLoi(["Chọn ít nhất một đầu ra để sinh."]);
      return;
    }
    setDsLoi([]);
    setDangSinh(true);
    try {
      const kq = await api<{
        ds_bth: { id: string; dinh_dang: string }[];
        ke_hoach: KeHoachDong;
      }>(`/api/ke-hoach/${id}/chon`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ds_chon: chon }),
      });
      setDsBthVuaSinh(kq.ds_bth);
      chiTiet.reload();
    } catch (e) {
      setDsLoi([
        e instanceof LoiApiClient
          ? `${e.ma}: ${e.message}${Array.isArray(e.chiTiet) ? " — " + (e.chiTiet as string[]).join("; ") : ""}`
          : String(e),
      ]);
    } finally {
      setDangSinh(false);
    }
  }

  const d = chiTiet.data;
  const tenDt = (idDt: string | null) =>
    idDt ? (d?.ho_so_doi_tuong.find((x) => x.id === idDt)?.ten ?? idDt) : "Chung";
  const nhom = new Map<string, DauRa[]>();
  for (const dx of d?.de_xuat ?? []) {
    const k = dx.doi_tuong_id ?? "";
    if (!nhom.has(k)) nhom.set(k, []);
    nhom.get(k)!.push(dx);
  }
  const khoaDeXuat = new Set((d?.de_xuat ?? []).map(khoaDauRa));
  const dsThem = [...dsChon.values()].filter((dx) => !khoaDeXuat.has(khoaDauRa(dx)));

  return (
    <>
      <Flex align="baseline" gap="3" mb="3">
        <a href="#/ke-hoach">
          <Text size="2">← Kế hoạch</Text>
        </a>
        <Heading size="5">{d?.thong_diep?.tieu_de ?? "…"}</Heading>
        {d?.ke_hoach.trang_thai === "da_chon" && <Badge color="green">Đã chọn</Badge>}
        {d?.ke_hoach.thong_diep_id && (
          <a href={`#/thong-diep?id=${d.ke_hoach.thong_diep_id}`}>
            <Text size="2">Lan truyền →</Text>
          </a>
        )}
      </Flex>
      <TrangThai loading={chiTiet.loading} error={chiTiet.error}>
        {dsLoi.map((l, i) => (
          <Callout.Root key={i} color="red" mb="2">
            <Callout.Text>{l}</Callout.Text>
          </Callout.Root>
        ))}

        <Card mb="3">
          <Heading size="3" mb="2">
            Intake
          </Heading>
          <Flex direction="column" gap="2">
            <TextField.Root
              value={tieuDe}
              onChange={(e) => setTieuDe(e.target.value)}
              placeholder="Tiêu đề"
            />
            <TextArea
              value={vanBan}
              onChange={(e) => setVanBan(e.target.value)}
              rows={6}
              placeholder="Mô tả ý tưởng, sự kiện hay mục tiêu…"
            />
            <TextField.Root
              value={cta}
              onChange={(e) => setCta(e.target.value)}
              placeholder="CTA (đích hành động mong muốn)"
            />
            {d?.nguon && (
              <Text size="2" color="gray">
                Nguồn kèm: {d.nguon.tieu_de}
              </Text>
            )}
            <Flex align="center" gap="3">
              <Button size="2" onClick={() => void luu()}>
                Lưu
              </Button>
              {trangThaiLuu && (
                <Text size="1" color="gray">
                  {trangThaiLuu}
                </Text>
              )}
            </Flex>
          </Flex>
        </Card>

        {d && d.cau_hoi.length > 0 && (
          <Callout.Root color="amber" mb="3">
            <Callout.Text>
              <Text weight="bold">Cần làm rõ trước khi sinh:</Text>
              <ul style={{ margin: "4px 0 0 16px" }}>
                {d.cau_hoi.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
            </Callout.Text>
          </Callout.Root>
        )}

        <Card mb="3">
          <Heading size="3" mb="2">
            Đầu ra đề xuất
          </Heading>
          <Flex direction="column" gap="2" mb="3">
            {[...nhom.entries()].map(([dtId, ds]) => (
              <Box key={dtId || "chung"}>
                <Text size="2" weight="bold" color="gray">
                  {tenDt(dtId || null)}
                </Text>
                <Flex gap="4" wrap="wrap" mt="1">
                  {ds.map((dx) => {
                    const k = khoaDauRa(dx);
                    return (
                      <label key={k} style={{ display: "flex", gap: 6, alignItems: "center" }}>
                        <Checkbox
                          checked={dsChon.has(k)}
                          onCheckedChange={(v) => {
                            const m = new Map(dsChon);
                            if (v === true) m.set(k, dx);
                            else m.delete(k);
                            setDsChon(m);
                          }}
                        />
                        <Text size="2">
                          {dx.dinh_dang}
                          {dx.dich_den ? ` → ${dx.dich_den}` : ""}
                        </Text>
                      </label>
                    );
                  })}
                </Flex>
              </Box>
            ))}
          </Flex>
          {/* Đầu ra ngoài đề xuất (#6): cùng định dạng ở kênh khác nhau
              hoặc định dạng đề xuất chưa gợi ý (script dài, faq…). */}
          <Flex gap="2" align="center" wrap="wrap" mb="2">
            <Select.Root value={ddThem} onValueChange={setDdThem}>
              <Select.Trigger placeholder="Định dạng…" />
              <Select.Content>
                {(dsDinhDang.data ?? []).map((x) => (
                  <Select.Item key={x.id} value={x.id}>
                    {x.nhan}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select.Root>
            <Select.Root value={dtThem} onValueChange={setDtThem}>
              <Select.Trigger placeholder="Đối tượng…" />
              <Select.Content>
                <Select.Item value="__chung__">Chung</Select.Item>
                {(d?.ho_so_doi_tuong ?? []).map((x) => (
                  <Select.Item key={x.id} value={x.id}>
                    {x.ten}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select.Root>
            <TextField.Root
              placeholder="Đích đến (vd linkedin, youtube)"
              value={dichDenThem}
              onChange={(e) => setDichDenThem(e.target.value)}
              style={{ width: 200 }}
            />
            <Button size="2" variant="soft" onClick={themDauRa}>
              Thêm đầu ra
            </Button>
          </Flex>
          {dsThem.length > 0 && (
            <Flex gap="2" wrap="wrap" mb="2">
              {dsThem.map((dx) => (
                <Badge key={khoaDauRa(dx)} color="purple" variant="soft">
                  {tenDt(dx.doi_tuong_id)} / {dx.dinh_dang}
                  {dx.dich_den ? ` → ${dx.dich_den}` : ""}
                  <button
                    type="button"
                    aria-label="Bỏ chọn"
                    onClick={() => {
                      const m = new Map(dsChon);
                      m.delete(khoaDauRa(dx));
                      setDsChon(m);
                    }}
                    style={{ marginLeft: 4, cursor: "pointer", border: 0, background: "none" }}
                  >
                    ✕
                  </button>
                </Badge>
              ))}
            </Flex>
          )}
          <Flex gap="3" align="center">
            <Button size="2" disabled={dangSinh} onClick={() => void sinh()}>
              {dangSinh ? "Đang enqueue…" : "Sinh các đầu ra đã chọn"}
            </Button>
            {d?.ke_hoach.thong_diep_id && (
              <a href={`#/thong-diep?id=${d.ke_hoach.thong_diep_id}`}>
                <Text size="2">Xem lan truyền →</Text>
              </a>
            )}
          </Flex>
          {d && d.ds_chon.length > 0 && (
            <Text size="1" color="gray" as="p" mt="2">
              Đã chọn:{" "}
              {d.ds_chon
                .map(
                  (c) =>
                    `${tenDt(c.doi_tuong_id)} / ${c.dinh_dang}${c.dich_den ? ` → ${c.dich_den}` : ""}`,
                )
                .join(", ")}
              . Sinh lại cùng lựa chọn tạo revision mới, không đụng nháp tay.
            </Text>
          )}
        </Card>

        {dsBthVuaSinh.length > 0 && (
          <Card>
            <Heading size="3" mb="2">
              Bản thể hiện vừa enqueue
            </Heading>
            <Text size="2" color="gray" mb="2" as="p">
              Job chạy nền; mở bản thể hiện để xem đề xuất AI rồi soạn/duyệt trong editor.{" "}
              {d?.ke_hoach.thong_diep_id && (
                <a href={`#/thong-diep?id=${d.ke_hoach.thong_diep_id}`}>
                  Xem tất cả đầu ra dưới một thông điệp →
                </a>
              )}
            </Text>
            <Flex direction="column" gap="1">
              {dsBthVuaSinh.map((b) => (
                <a key={b.id} href={`#/ban-the-hien?id=${b.id}`}>
                  {b.dinh_dang} — mở bản thể hiện
                </a>
              ))}
            </Flex>
          </Card>
        )}
      </TrangThai>
    </>
  );
}

export default function KeHoachPage() {
  const path = useHashRoute();
  const id = path.match(/[?&]id=([^&]+)/)?.[1];
  return id ? <ChiTietKhView key={id} id={id} /> : <DanhSachKh />;
}
