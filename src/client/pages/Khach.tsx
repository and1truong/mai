import {
  Badge,
  Button,
  Callout,
  Card,
  Flex,
  Heading,
  Select,
  Table,
  Text,
  TextField,
} from "@radix-ui/themes";
import { useState } from "react";
import { api, fmtLuc, LoiApiClient, useApi, useHashRoute } from "../api.ts";
import { TrangThai } from "../components/TrangThai.tsx";
import type {
  BuocHanhTrinh,
  ChuyenDoi,
  DinhDanh,
  DongY,
  DongYLog,
  GiaTriKhach,
  GiaiThichDoi,
  Khach,
  QuyVe,
  TuongTac,
} from "../../modules/khach/index.ts";
import type { KhachTag, Segment } from "../../modules/khach/segment.ts";

// Trang Khách hàng (#70): danh sách có search/filter (q trên
// ten/email/sdt/identity, tag, segment, trạng thái đời, nguồn identity
// đầu, đã mua) + phân trang; chi tiết gồm identities, consent hiện tại
// + lịch sử, lifecycle + giải thích, tags inline, timeline, hành trình
// tới conversion, quy_về first/last touch, chỉ số giá trị.

const LIMIT = 25;

const NHAN_DOI: Record<string, string> = {
  khach_vang_lai: "Khách vãng lai",
  dang_ky: "Đã đăng ký",
  khach_mua: "Đã mua",
  khach_quen: "Khách quen",
  ngu_dong: "Ngủ đông",
};

const MAU_DOI: Record<string, "gray" | "blue" | "green" | "orange" | "red"> = {
  khach_vang_lai: "gray",
  dang_ky: "blue",
  khach_mua: "green",
  khach_quen: "green",
  ngu_dong: "red",
};

const NHAN_DONG_Y: Record<string, string> = {
  cho: "Cho phép",
  khong: "Không",
  rut: "Rút lại",
};

const NHAN_LOAI_DICH: Record<string, string> = {
  campaign: "Campaign",
  link_dich: "Link đích",
  ban_the_hien: "Bản thể hiện",
  giao_hang: "Giao hàng",
  nguon: "Nguồn",
  khong_ro: "Không rõ",
};

export default function KhachPage() {
  const path = useHashRoute();
  const id = new URLSearchParams(path.split("?")[1] ?? "").get("id");
  return id ? <ChiTietKhachView id={id} /> : <DanhSachKhach />;
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

function badgeDoi(trangThai: string) {
  return (
    <Badge color={MAU_DOI[trangThai] ?? "gray"} variant="soft">
      {NHAN_DOI[trangThai] ?? trangThai}
    </Badge>
  );
}

// --- Danh sách + filter ---

function DanhSachKhach() {
  const [q, setQ] = useState("");
  const [qGui, setQGui] = useState("");
  const [tag, setTag] = useState("");
  const [trangThaiDoi, setTrangThaiDoi] = useState("");
  const [nguon, setNguon] = useState("");
  const [daMua, setDaMua] = useState("");
  const [segmentId, setSegmentId] = useState("");
  const [offset, setOffset] = useState(0);

  const dsSegment = useApi<{ ds: Pick<Segment, "id" | "ten">[] }>("/api/segment");
  const query = new URLSearchParams();
  if (qGui) query.set("q", qGui);
  if (tag) query.set("tag", tag);
  if (trangThaiDoi) query.set("trang_thai_doi", trangThaiDoi);
  if (nguon) query.set("nguon", nguon);
  if (daMua) query.set("da_mua", daMua);
  if (segmentId) query.set("segment_id", segmentId);
  query.set("limit", String(LIMIT));
  query.set("offset", String(offset));
  const dsKhach = useApi<{ ds_khach: Khach[]; tong: number }>(
    `/api/khach?${query.toString()}`,
  );

  function datLoc() {
    setOffset(0);
    setQGui(q.trim());
  }

  const tong = dsKhach.data?.tong ?? 0;
  const soTrang = Math.max(1, Math.ceil(tong / LIMIT));
  const trang = Math.floor(offset / LIMIT) + 1;

  return (
    <>
      <Heading mb="3">Khách hàng</Heading>
      <Card mb="4">
        <Flex direction="column" gap="2">
          <Flex gap="2" wrap="wrap" align="center">
            <TextField.Root
              placeholder="Tìm theo tên, email, sđt, identity…"
              value={q}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setQ(e.target.value)}
              onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
                if (e.key === "Enter") datLoc();
              }}
              style={{ flex: 2, minWidth: 260 }}
            />
            <TextField.Root
              placeholder="Tag"
              value={tag}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                setTag(e.target.value.trim());
                setOffset(0);
              }}
              style={{ width: 150 }}
            />
            <TextField.Root
              placeholder="Nguồn identity đầu"
              value={nguon}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                setNguon(e.target.value.trim());
                setOffset(0);
              }}
              style={{ width: 170 }}
            />
            <Select.Root
              value={trangThaiDoi || "__all__"}
              onValueChange={(v) => {
                setTrangThaiDoi(v === "__all__" ? "" : v);
                setOffset(0);
              }}
            >
              <Select.Trigger placeholder="Trạng thái đời…" />
              <Select.Content>
                <Select.Item value="__all__">Mọi trạng thái đời</Select.Item>
                {Object.entries(NHAN_DOI).map(([v, nhan]) => (
                  <Select.Item key={v} value={v}>
                    {nhan}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select.Root>
            <Select.Root
              value={daMua || "__all__"}
              onValueChange={(v) => {
                setDaMua(v === "__all__" ? "" : v);
                setOffset(0);
              }}
            >
              <Select.Trigger placeholder="Đã mua…" />
              <Select.Content>
                <Select.Item value="__all__">Mọi khách</Select.Item>
                <Select.Item value="co">Đã mua</Select.Item>
                <Select.Item value="khong">Chưa mua</Select.Item>
              </Select.Content>
            </Select.Root>
            <Select.Root
              value={segmentId || "__all__"}
              onValueChange={(v) => {
                setSegmentId(v === "__all__" ? "" : v);
                setOffset(0);
              }}
            >
              <Select.Trigger placeholder="Segment…" />
              <Select.Content>
                <Select.Item value="__all__">Mọi segment</Select.Item>
                {(dsSegment.data?.ds ?? []).map((s) => (
                  <Select.Item key={s.id} value={s.id}>
                    {s.ten}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select.Root>
            <Button variant="soft" onClick={datLoc}>
              Tìm
            </Button>
          </Flex>
        </Flex>
      </Card>
      <TrangThai
        loading={dsKhach.loading}
        error={dsKhach.error}
        empty={!dsKhach.data?.ds_khach.length}
      >
        <Table.Root>
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeaderCell>Tên</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>Email</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>SĐT</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>Trạng thái</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>Trạng thái đời</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>Thấy lần cuối</Table.ColumnHeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {(dsKhach.data?.ds_khach ?? []).map((k) => (
              <Table.Row key={k.id}>
                <Table.Cell>
                  <a href={`#/khach?id=${k.id}`}>{k.ten || "(chưa đặt tên)"}</a>
                </Table.Cell>
                <Table.Cell>{k.email || "—"}</Table.Cell>
                <Table.Cell>{k.sdt || "—"}</Table.Cell>
                <Table.Cell>{k.trang_thai}</Table.Cell>
                <Table.Cell>{badgeDoi(k.trang_thai_doi)}</Table.Cell>
                <Table.Cell>{fmtLuc(k.lan_cuoi_thay)}</Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Root>
        <Flex justify="between" align="center" mt="3">
          <Text size="1" color="gray">
            Tổng {tong} khách — trang {trang}/{soTrang}
          </Text>
          <Flex gap="2">
            <Button
              size="1"
              variant="soft"
              disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - LIMIT))}
            >
              ← Trước
            </Button>
            <Button
              size="1"
              variant="soft"
              disabled={offset + LIMIT >= tong}
              onClick={() => setOffset(offset + LIMIT)}
            >
              Sau →
            </Button>
          </Flex>
        </Flex>
      </TrangThai>
    </>
  );
}

// --- Chi tiết một khách hàng ---

type KhachChiTiet = Omit<Khach, "giai_thich_doi"> & {
  dinh_danh: DinhDanh[];
  giai_thich_doi: GiaiThichDoi | string;
};

type QuyVeView = {
  chuyen_doi: ChuyenDoi & { chi_tiet: unknown };
  quy_ve: QuyVe[];
};

type HanhTrinhView = {
  chuyen_doi: ChuyenDoi & { chi_tiet: unknown };
  quy_ve: QuyVe[];
  hanh_trinh: (BuocHanhTrinh & { chi_tiet: unknown })[];
};

// Link ref tới trang chi tiết tương ứng (bản thể hiện / campaign).
function linkRef(loai: string, id: string) {
  if (!id) return "—";
  if (loai === "ban_the_hien") {
    return <a href={`#/ban-the-hien?id=${id}`}>{id}</a>;
  }
  if (loai === "campaign") {
    return <a href={`#/phat-hanh?id=${id}`}>{id}</a>;
  }
  return id;
}

function refBuoc(b: BuocHanhTrinh) {
  if (b.campaign_id) return linkRef("campaign", b.campaign_id);
  if (b.link_dich_id) return `link:${b.link_dich_id}`;
  if (b.ban_the_hien_id) return linkRef("ban_the_hien", b.ban_the_hien_id);
  if (b.giao_hang_id) return `giao:${b.giao_hang_id}`;
  if (b.don_hang_ngoai_id) return `đơn:${b.don_hang_ngoai_id}`;
  return b.nguon || "—";
}

function ChiTietKhachView({ id }: { id: string }) {
  const khach = useApi<KhachChiTiet>(`/api/khach/${id}`, [id]);
  const dongY = useApi<{ hien_tai: DongY[]; lich_su: DongYLog[] }>(
    `/api/khach/${id}/dong-y`,
    [id],
  );
  const tags = useApi<{ ds_tag: KhachTag[] }>(`/api/khach/${id}/tags`, [id]);
  const giaTri = useApi<{
    trang_thai_doi: string;
    giai_thich: GiaiThichDoi;
    gia_tri: GiaTriKhach;
  }>(`/api/khach/${id}/gia-tri`, [id]);
  const quyVe = useApi<{ ds: QuyVeView[] }>(`/api/khach/${id}/quy-ve`, [id]);
  const timeline = useApi<{ ds_su_kien: TuongTac[]; tong: number }>(
    `/api/khach/${id}/timeline`,
    [id],
  );
  const hanhTrinh = useApi<HanhTrinhView>(`/api/khach/${id}/hanh-trinh`, [id]);

  const [tagMoi, setTagMoi] = useState("");
  const [dsLoi, setDsLoi] = useState<string[]>([]);
  const [trangTimeline, setTrangTimeline] = useState(0);
  const [chonChuyenDoi, setChonChuyenDoi] = useState("");
  const [loiHanhTrinh, setLoiHanhTrinh] = useState("");
  const [jt, setJt] = useState<HanhTrinhView | null>(null);

  async function doiTag(them: string | null, bo: string | null) {
    setDsLoi([]);
    try {
      await api(`/api/khach/${id}/tags`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...(them ? { them: [them] } : {}),
          ...(bo ? { bo: [bo] } : {}),
          nguon: "tay",
        }),
      });
      setTagMoi("");
      tags.reload();
    } catch (e) {
      setDsLoi(loiText(e));
    }
  }

  // Đổi conversion đích: gọi lại endpoint với ?chuyen_doi_id — projection
  // tính lại khi đọc, không lưu narrative.
  async function xemHanhTrinh(cdId: string) {
    setChonChuyenDoi(cdId);
    setLoiHanhTrinh("");
    if (!cdId) {
      setJt(null);
      return;
    }
    try {
      setJt(
        await api<HanhTrinhView>(
          `/api/khach/${id}/hanh-trinh?chuyen_doi_id=${encodeURIComponent(cdId)}`,
        ),
      );
    } catch (e) {
      setJt(null);
      setLoiHanhTrinh(loiText(e).join(" "));
    }
  }

  const k = khach.data;
  const gt = giaTri.data?.gia_tri;
  const jtHienThi: HanhTrinhView | null = jt ?? hanhTrinh.data ?? null;
  const dsSk = timeline.data?.ds_su_kien ?? [];
  const TT_TIMELINE = 10;
  const skTrang = dsSk.slice(trangTimeline * TT_TIMELINE, (trangTimeline + 1) * TT_TIMELINE);
  const giaiThich = k?.giai_thich_doi;
  const giaiThichObj = typeof giaiThich === "object" ? giaiThich : null;

  return (
    <>
      <Flex align="center" justify="between" mb="3">
        <Heading>Khách hàng{k?.ten ? ` — ${k.ten}` : ""}</Heading>
        <a href="#/khach">← Danh sách khách</a>
      </Flex>
      <TrangThai loading={khach.loading} error={khach.error} empty={!k}>
        {k && (
          <Flex direction="column" gap="4">
            {dsLoi.length > 0 && (
              <Callout.Root color="red">
                {dsLoi.map((l, i) => (
                  <Callout.Text key={i}>{l}</Callout.Text>
                ))}
              </Callout.Root>
            )}

            {/* Lifecycle + giải thích deterministic */}
            <Card>
              <Flex direction="column" gap="2">
                <Flex justify="between" align="center">
                  <Text size="2" weight="bold">
                    Trạng thái đời
                  </Text>
                  {badgeDoi(k.trang_thai_doi)}
                </Flex>
                {giaiThichObj && (
                  <Flex gap="3" wrap="wrap">
                    <Text size="1" color="gray">
                      {giaiThichObj.ly_do}
                    </Text>
                    <Text size="1" color="gray">
                      Đơn mua: {giaiThichObj.so_don_mua} · Consent:{" "}
                      {giaiThichObj.co_dong_y_cho ? "có" : "không"} · Sự kiện cuối:{" "}
                      {fmtLuc(giaiThichObj.su_kien_cuoi_luc)} · Ngưỡng ngủ đông:{" "}
                      {giaiThichObj.nguong_ngu_dong_ngay} ngày
                    </Text>
                  </Flex>
                )}
                <Text size="1" color="gray">
                  Thấy lần đầu: {fmtLuc(k.lan_dau_thay)} · Lần cuối: {fmtLuc(k.lan_cuoi_thay)} ·
                  Tạo lúc: {fmtLuc(k.tao_luc)}
                </Text>
              </Flex>
            </Card>

            {/* Tags — add/remove inline (edit duy nhất trên trang) */}
            <Card>
              <Flex direction="column" gap="2">
                <Text size="2" weight="bold">
                  Tags
                </Text>
                <Flex gap="2" wrap="wrap" align="center">
                  {(tags.data?.ds_tag ?? []).map((t) => (
                    <Badge key={t.tag} color="blue" variant="soft">
                      {t.tag}
                      {t.nguon !== "tay" ? ` (${t.nguon})` : ""}
                      <Button
                        size="1"
                        variant="ghost"
                        color="red"
                        style={{ marginLeft: 4, padding: "0 4px" }}
                        onClick={() => void doiTag(null, t.tag)}
                      >
                        ×
                      </Button>
                    </Badge>
                  ))}
                  {(tags.data?.ds_tag ?? []).length === 0 && (
                    <Text size="1" color="gray">
                      Chưa có tag.
                    </Text>
                  )}
                </Flex>
                <Flex gap="2">
                  <TextField.Root
                    placeholder="Tag mới…"
                    value={tagMoi}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                      setTagMoi(e.target.value)
                    }
                    style={{ width: 220 }}
                  />
                  <Button
                    size="1"
                    variant="soft"
                    disabled={!tagMoi.trim()}
                    onClick={() => void doiTag(tagMoi.trim(), null)}
                  >
                    Thêm tag
                  </Button>
                </Flex>
              </Flex>
            </Card>

            {/* Identities */}
            <Card>
              <Flex direction="column" gap="2">
                <Text size="2" weight="bold">
                  Identities ({k.dinh_danh.length})
                </Text>
                <Table.Root>
                  <Table.Header>
                    <Table.Row>
                      <Table.ColumnHeaderCell>Loại</Table.ColumnHeaderCell>
                      <Table.ColumnHeaderCell>Giá trị gốc</Table.ColumnHeaderCell>
                      <Table.ColumnHeaderCell>Giá trị chuẩn</Table.ColumnHeaderCell>
                      <Table.ColumnHeaderCell>Nguồn</Table.ColumnHeaderCell>
                      <Table.ColumnHeaderCell>Tạo lúc</Table.ColumnHeaderCell>
                    </Table.Row>
                  </Table.Header>
                  <Table.Body>
                    {k.dinh_danh.map((d) => (
                      <Table.Row key={d.id}>
                        <Table.Cell>{d.loai}</Table.Cell>
                        <Table.Cell>{d.gia_tri_goc}</Table.Cell>
                        <Table.Cell>{d.gia_tri_chuan}</Table.Cell>
                        <Table.Cell>{d.nguon}</Table.Cell>
                        <Table.Cell>{fmtLuc(d.tao_luc)}</Table.Cell>
                      </Table.Row>
                    ))}
                    {k.dinh_danh.length === 0 && (
                      <Table.Row>
                        <Table.Cell colSpan={5}>
                          <Text color="gray">Chưa có identity.</Text>
                        </Table.Cell>
                      </Table.Row>
                    )}
                  </Table.Body>
                </Table.Root>
              </Flex>
            </Card>

            {/* Consent hiện tại + lịch sử */}
            <Card>
              <Flex direction="column" gap="2">
                <Text size="2" weight="bold">
                  Consent
                </Text>
                <TrangThai loading={dongY.loading} error={dongY.error}>
                  <Table.Root>
                    <Table.Header>
                      <Table.Row>
                        <Table.ColumnHeaderCell>Kênh</Table.ColumnHeaderCell>
                        <Table.ColumnHeaderCell>Mục đích</Table.ColumnHeaderCell>
                        <Table.ColumnHeaderCell>Trạng thái</Table.ColumnHeaderCell>
                        <Table.ColumnHeaderCell>Nguồn</Table.ColumnHeaderCell>
                        <Table.ColumnHeaderCell>Cập nhật</Table.ColumnHeaderCell>
                      </Table.Row>
                    </Table.Header>
                    <Table.Body>
                      {(dongY.data?.hien_tai ?? []).map((d) => (
                        <Table.Row key={d.id}>
                          <Table.Cell>{d.kenh}</Table.Cell>
                          <Table.Cell>{d.muc_dich}</Table.Cell>
                          <Table.Cell>
                            <Badge
                              color={d.trang_thai === "cho" ? "green" : "red"}
                              variant="soft"
                            >
                              {NHAN_DONG_Y[d.trang_thai] ?? d.trang_thai}
                            </Badge>
                          </Table.Cell>
                          <Table.Cell>{d.nguon}</Table.Cell>
                          <Table.Cell>{fmtLuc(d.cap_nhat_luc)}</Table.Cell>
                        </Table.Row>
                      ))}
                      {(dongY.data?.hien_tai ?? []).length === 0 && (
                        <Table.Row>
                          <Table.Cell colSpan={5}>
                            <Text color="gray">Chưa có consent.</Text>
                          </Table.Cell>
                        </Table.Row>
                      )}
                    </Table.Body>
                  </Table.Root>
                  {(dongY.data?.lich_su ?? []).length > 0 && (
                    <>
                      <Text size="1" color="gray" mt="2">
                        Lịch sử consent:
                      </Text>
                      {(dongY.data?.lich_su ?? []).map((l) => (
                        <Text size="1" key={l.id} color="gray">
                          {fmtLuc(l.luc)} — {l.kenh}/{l.muc_dich}:{" "}
                          {l.tu_trang_thai ? `${NHAN_DONG_Y[l.tu_trang_thai] ?? l.tu_trang_thai} → ` : ""}
                          {NHAN_DONG_Y[l.sang_trang_thai] ?? l.sang_trang_thai} ({l.nguon})
                        </Text>
                      ))}
                    </>
                  )}
                </TrangThai>
              </Flex>
            </Card>

            {/* Chỉ số giá trị */}
            <Card>
              <Flex direction="column" gap="2">
                <Text size="2" weight="bold">
                  Chỉ số giá trị
                </Text>
                <TrangThai loading={giaTri.loading} error={giaTri.error}>
                  {gt && (
                    <Flex gap="4" wrap="wrap">
                      <Text size="1">
                        Số đơn mua: <strong>{gt.so_don}</strong>
                      </Text>
                      {Object.entries(gt.doanh_thu).map(([tien, c]) => (
                        <Text size="1" key={tien}>
                          Doanh thu {tien}: <strong>{c.tong.toLocaleString("vi-VN")}</strong>{" "}
                          (TB/đơn: {Math.round(c.gia_tri_tb).toLocaleString("vi-VN")})
                        </Text>
                      ))}
                      <Text size="1">
                        Tần suất: {gt.tan_suat.toFixed(2)} đơn/90 ngày
                      </Text>
                      <Text size="1" color="gray">
                        Đơn đầu: {fmtLuc(gt.don_dau_luc)} · Đơn cuối:{" "}
                        {fmtLuc(gt.don_cuoi_luc)}
                      </Text>
                    </Flex>
                  )}
                  {gt && gt.so_don === 0 && (
                    <Text size="1" color="gray">
                      Chưa có đơn mua nào.
                    </Text>
                  )}
                </TrangThai>
              </Flex>
            </Card>

            {/* Quy về first/last touch theo conversion */}
            <Card>
              <Flex direction="column" gap="2">
                <Text size="2" weight="bold">
                  Attribution (quy_về)
                </Text>
                <TrangThai loading={quyVe.loading} error={quyVe.error}>
                  {(quyVe.data?.ds ?? []).length === 0 && (
                    <Text size="1" color="gray">
                      Chưa có conversion nào.
                    </Text>
                  )}
                  {(quyVe.data?.ds ?? []).map((x) => (
                    <Card key={x.chuyen_doi.id} variant="surface">
                      <Flex direction="column" gap="1">
                        <Text size="1" weight="bold">
                          Conversion {x.chuyen_doi.loai} lúc {fmtLuc(x.chuyen_doi.xay_ra_luc)}
                          {x.chuyen_doi.gia_tri !== null
                            ? ` — ${x.chuyen_doi.gia_tri.toLocaleString("vi-VN")} ${x.chuyen_doi.tien_te}`
                            : ""}
                        </Text>
                        {x.quy_ve.map((q) => (
                          <Text size="1" key={q.id} color="gray">
                            {q.mo_hinh === "first_touch" ? "First touch" : "Last touch"}:{" "}
                            {NHAN_LOAI_DICH[q.loai_dich] ?? q.loai_dich} {q.dich_id} —{" "}
                            {q.do_tin === "chac" ? "chắc" : "không chắc"}
                          </Text>
                        ))}
                      </Flex>
                    </Card>
                  ))}
                </TrangThai>
              </Flex>
            </Card>

            {/* Hành trình tới conversion — projection, chọn conversion khác */}
            <Card>
              <Flex direction="column" gap="2">
                <Flex justify="between" align="center" wrap="wrap" gap="2">
                  <Text size="2" weight="bold">
                    Hành trình tới conversion
                  </Text>
                  <Select.Root
                    value={chonChuyenDoi || "__latest__"}
                    onValueChange={(v) => void xemHanhTrinh(v === "__latest__" ? "" : v)}
                  >
                    <Select.Trigger placeholder="Conversion mới nhất" />
                    <Select.Content>
                      <Select.Item value="__latest__">Conversion mới nhất</Select.Item>
                      {(quyVe.data?.ds ?? []).map((x) => (
                        <Select.Item key={x.chuyen_doi.id} value={x.chuyen_doi.id}>
                          {x.chuyen_doi.loai} — {fmtLuc(x.chuyen_doi.xay_ra_luc)}
                        </Select.Item>
                      ))}
                    </Select.Content>
                  </Select.Root>
                </Flex>
                {hanhTrinh.error && !jt && !loiHanhTrinh && (
                  <Text size="1" color="gray">
                    {hanhTrinh.error.message}
                  </Text>
                )}
                {loiHanhTrinh && (
                  <Text size="1" color="red">
                    {loiHanhTrinh}
                  </Text>
                )}
                {jtHienThi && (
                  <>
                    <Text size="1" color="gray">
                      Đích: conversion {jtHienThi.chuyen_doi.loai} lúc{" "}
                      {fmtLuc(jtHienThi.chuyen_doi.xay_ra_luc)} —{" "}
                      {jtHienThi.hanh_trinh.length} bước.
                    </Text>
                    <Table.Root>
                      <Table.Header>
                        <Table.Row>
                          <Table.ColumnHeaderCell>Lúc</Table.ColumnHeaderCell>
                          <Table.ColumnHeaderCell>Loại</Table.ColumnHeaderCell>
                          <Table.ColumnHeaderCell>Nguồn</Table.ColumnHeaderCell>
                          <Table.ColumnHeaderCell>Tham chiếu</Table.ColumnHeaderCell>
                          <Table.ColumnHeaderCell>Dấu</Table.ColumnHeaderCell>
                        </Table.Row>
                      </Table.Header>
                      <Table.Body>
                        {jtHienThi.hanh_trinh.map((b) => (
                          <Table.Row key={b.id}>
                            <Table.Cell>{fmtLuc(b.xay_ra_luc)}</Table.Cell>
                            <Table.Cell>{b.loai}</Table.Cell>
                            <Table.Cell>{b.nguon}</Table.Cell>
                            <Table.Cell>{refBuoc(b)}</Table.Cell>
                            <Table.Cell>
                              <Flex gap="1">
                                {b.la_first_touch && (
                                  <Badge color="green" variant="soft">
                                    first touch
                                  </Badge>
                                )}
                                {b.la_last_touch && (
                                  <Badge color="orange" variant="soft">
                                    last touch
                                  </Badge>
                                )}
                              </Flex>
                            </Table.Cell>
                          </Table.Row>
                        ))}
                      </Table.Body>
                    </Table.Root>
                  </>
                )}
              </Flex>
            </Card>

            {/* Timeline tuong_tac — phân trang client theo 10 bước */}
            <Card>
              <Flex direction="column" gap="2">
                <Text size="2" weight="bold">
                  Timeline ({timeline.data?.tong ?? 0} sự kiện)
                </Text>
                <TrangThai loading={timeline.loading} error={timeline.error} empty={!dsSk.length}>
                  <Table.Root>
                    <Table.Header>
                      <Table.Row>
                        <Table.ColumnHeaderCell>Lúc</Table.ColumnHeaderCell>
                        <Table.ColumnHeaderCell>Loại</Table.ColumnHeaderCell>
                        <Table.ColumnHeaderCell>Nguồn</Table.ColumnHeaderCell>
                        <Table.ColumnHeaderCell>Tham chiếu</Table.ColumnHeaderCell>
                      </Table.Row>
                    </Table.Header>
                    <Table.Body>
                      {skTrang.map((s) => (
                        <Table.Row key={s.id}>
                          <Table.Cell>{fmtLuc(s.xay_ra_luc)}</Table.Cell>
                          <Table.Cell>{s.loai}</Table.Cell>
                          <Table.Cell>{s.nguon}</Table.Cell>
                          <Table.Cell>{refBuoc(s as BuocHanhTrinh)}</Table.Cell>
                        </Table.Row>
                      ))}
                    </Table.Body>
                  </Table.Root>
                  {dsSk.length > TT_TIMELINE && (
                    <Flex justify="end" gap="2" mt="2">
                      <Button
                        size="1"
                        variant="soft"
                        disabled={trangTimeline === 0}
                        onClick={() => setTrangTimeline((t) => t - 1)}
                      >
                        ← Trước
                      </Button>
                      <Button
                        size="1"
                        variant="soft"
                        disabled={(trangTimeline + 1) * TT_TIMELINE >= dsSk.length}
                        onClick={() => setTrangTimeline((t) => t + 1)}
                      >
                        Sau →
                      </Button>
                    </Flex>
                  )}
                </TrangThai>
              </Flex>
            </Card>
          </Flex>
        )}
      </TrangThai>
    </>
  );
}
