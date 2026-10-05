import {
  Badge,
  Button,
  Callout,
  Card,
  Code,
  Flex,
  Heading,
  Select,
  Separator,
  Table,
  Text,
  TextField,
} from "@radix-ui/themes";
import { useEffect, useState } from "react";
import { api, fmtLuc, LoiApiClient, useApi } from "../api.ts";
import { TrangThai } from "../components/TrangThai.tsx";
import type { BanTheHien, Campaign, ThongDiep } from "../../modules/content/index.ts";
import type {
  BaoCaoKetQua,
  GoiYKetQua,
  LinkDich,
  SoLieu,
} from "../../modules/ket_qua/index.ts";

// Trang kết quả (#15): báo cáo gom theo thông điệp/kênh/bản thể hiện với
// định nghĩa metric tường minh, link đích theo dõi, kết quả nhập tay kèm
// bằng chứng, và gợi ý hành động tiếp theo kèm quan sát + độ bất định.
// URL: #/ket-qua.

const NHAN_LOAI_GY: Record<string, string> = {
  nhap_tiep: "Nháp tiếp theo",
  cau_hoi: "Câu hỏi làm rõ",
  thi_nghiem: "Thí nghiệm",
};

const MAU_LOAI_GY: Record<string, "blue" | "amber" | "indigo"> = {
  nhap_tiep: "blue",
  cau_hoi: "amber",
  thi_nghiem: "indigo",
};

const MAU_BAT_DINH: Record<string, "green" | "orange" | "red"> = {
  thap: "green",
  vua: "orange",
  cao: "red",
};

const NHAN_BAT_DINH: Record<string, string> = {
  thap: "thấp",
  vua: "vừa",
  cao: "cao",
};

const NHAN_NGUON: Record<string, string> = {
  first_party: "first-party",
  provider: "provider",
  nhap_tay: "nhập tay",
  he_thong: "hệ thống",
};

function docLoi(e: unknown): string {
  return e instanceof LoiApiClient ? `${e.ma}: ${e.message}` : String(e);
}

// Ô chọn chủ (campaign/thong_diep/ban_the_hien) cho form nhập kết quả.
function ChonChu({
  chuLoai,
  setChuLoai,
  chuId,
  setChuId,
  dsCampaign,
  dsThongDiep,
  dsBth,
}: {
  chuLoai: string;
  setChuLoai: (v: string) => void;
  chuId: string;
  setChuId: (v: string) => void;
  dsCampaign: Campaign[];
  dsThongDiep: ThongDiep[];
  dsBth: { ban_the_hien_id: string; dinh_dang: string }[];
}) {
  const dsChu: { id: string; nhan: string }[] =
    chuLoai === "campaign"
      ? dsCampaign.map((c) => ({ id: c.id, nhan: c.ten }))
      : chuLoai === "ban_the_hien"
        ? dsBth.map((b) => ({ id: b.ban_the_hien_id, nhan: `${b.dinh_dang} · ${b.ban_the_hien_id}` }))
        : dsThongDiep.map((t) => ({ id: t.id, nhan: t.tieu_de }));
  return (
    <Flex gap="2" wrap="wrap" align="center">
      <Select.Root
        value={chuLoai}
        onValueChange={(v) => {
          setChuLoai(v);
          setChuId("");
        }}
      >
        <Select.Trigger placeholder="Loại chủ…" />
        <Select.Content>
          <Select.Item value="campaign">Campaign</Select.Item>
          <Select.Item value="thong_diep">Thông điệp</Select.Item>
          <Select.Item value="ban_the_hien">Bản thể hiện</Select.Item>
        </Select.Content>
      </Select.Root>
      <Select.Root value={chuId} onValueChange={setChuId}>
        <Select.Trigger placeholder="Chọn chủ…" />
        <Select.Content>
          {dsChu.map((c) => (
            <Select.Item key={c.id} value={c.id}>
              {c.nhan}
            </Select.Item>
          ))}
        </Select.Content>
      </Select.Root>
    </Flex>
  );
}

function TheGoiY({ g, reload }: { g: GoiYKetQua; reload: () => void }) {
  const [loi, setLoi] = useState<string | null>(null);
  const [dangChay, setDangChay] = useState(false);

  async function quyet(hanhDong: "chap-nhan" | "tu-choi") {
    setLoi(null);
    setDangChay(true);
    try {
      await api(`/api/goi-y-ket-qua/${g.id}/${hanhDong}`, { method: "POST" });
      reload();
    } catch (e) {
      setLoi(docLoi(e));
    } finally {
      setDangChay(false);
    }
  }

  return (
    <Card variant="surface">
      <Flex direction="column" gap="2">
        <Flex align="center" gap="2" wrap="wrap">
          <Badge color={MAU_LOAI_GY[g.loai] ?? "gray"}>{NHAN_LOAI_GY[g.loai] ?? g.loai}</Badge>
          <Text size="2" weight="bold">
            {g.tieu_de}
          </Text>
          <Badge color={MAU_BAT_DINH[g.bat_dinh] ?? "gray"} variant="soft">
            bất định: {NHAN_BAT_DINH[g.bat_dinh] ?? g.bat_dinh}
          </Badge>
          <Badge variant="outline">
            {g.trang_thai === "moi"
              ? "Mới"
              : g.trang_thai === "chap_nhan"
                ? "Đã chấp nhận"
                : g.trang_thai === "het_han"
                  ? "Hết hạn"
                  : "Đã từ chối"}
          </Badge>
        </Flex>
        <Text size="1" color="gray" as="p">
          {g.mo_ta}
        </Text>
        {g.quan_sat.length > 0 && (
          <Flex direction="column" gap="1">
            <Text size="1" weight="bold">
              Quan sát đã dùng
            </Text>
            {g.quan_sat.map((q, i) => (
              <Text key={i} size="1" color="gray">
                · {q.mo_ta}
                {q.gia_tri !== undefined ? `: ${q.gia_tri}` : ""} [{NHAN_NGUON[q.nguon] ?? q.nguon}]
              </Text>
            ))}
          </Flex>
        )}
        {g.trang_thai === "moi" && (
          <Flex gap="2">
            <Button size="1" onClick={() => void quyet("chap-nhan")} disabled={dangChay}>
              Chấp nhận
            </Button>
            <Button
              size="1"
              variant="soft"
              color="red"
              onClick={() => void quyet("tu-choi")}
              disabled={dangChay}
            >
              Từ chối
            </Button>
          </Flex>
        )}
        {g.trang_thai === "chap_nhan" && Object.keys(g.ket_qua).length > 0 && (
          <Code size="1" style={{ whiteSpace: "pre-wrap" }}>
            {JSON.stringify(g.ket_qua, null, 2)}
          </Code>
        )}
        {loi && (
          <Callout.Root color="red" size="1">
            <Callout.Text>{loi}</Callout.Text>
          </Callout.Root>
        )}
      </Flex>
    </Card>
  );
}

export default function KetQuaPage() {
  const [tdId, setTdId] = useState("");
  const [cpId, setCpId] = useState("");
  const dsTd = useApi<ThongDiep[]>("/api/thong-diep");
  const dsCp = useApi<Campaign[]>("/api/campaign");
  const query =
    tdId ? `?thong_diep_id=${tdId}` : cpId ? `?campaign_id=${cpId}` : "";
  const baoCao = useApi<BaoCaoKetQua>(`/api/bao-cao-ket-qua${query}`, [tdId, cpId]);
  const dsGoiY = useApi<{ ds_goi_y: GoiYKetQua[] }>(
    `/api/goi-y-ket-qua${tdId ? `?thong_diep_id=${tdId}` : ""}`,
    [tdId],
  );
  const dsLink = useApi<{ ds_link: (LinkDich & { so_click: number })[] }>(
    `/api/link-dich${tdId ? `?thong_diep_id=${tdId}` : ""}`,
    [tdId],
  );

  const [loi, setLoi] = useState<string | null>(null);
  const [ghiChu, setGhiChu] = useState("");

  // Form mục tiêu
  const [mtMoTa, setMtMoTa] = useState("");
  const [mtTieuChi, setMtTieuChi] = useState("");
  const [mtChuLoai, setMtChuLoai] = useState("thong_diep");
  const [mtChuId, setMtChuId] = useState("");

  // Form link đích
  const [lkUrl, setLkUrl] = useState("");
  const [lkNhan, setLkNhan] = useState("");
  const [lkTd, setLkTd] = useState("");
  const [lkBth, setLkBth] = useState("");

  // Form kết quả nhập tay
  const [kqChuLoai, setKqChuLoai] = useState("thong_diep");
  const [kqChuId, setKqChuId] = useState("");
  const [kqTen, setKqTen] = useState("");
  const [kqGiaTri, setKqGiaTri] = useState("");
  const [kqDonVi, setKqDonVi] = useState("");
  const [kqBangChung, setKqBangChung] = useState("");
  const [kqNhanDinh, setKqNhanDinh] = useState("tu_bao");

  // Khi đổi phạm vi thông điệp → đồng bộ default chủ của các form.
  useEffect(() => {
    if (tdId) {
      setMtChuLoai("thong_diep");
      setMtChuId(tdId);
      setKqChuLoai("thong_diep");
      setKqChuId(tdId);
      setLkTd(tdId);
    }
  }, [tdId]);

  async function chay(fn: () => Promise<unknown>, ghiChuOk: string) {
    setLoi(null);
    setGhiChu("");
    try {
      await fn();
      setGhiChu(ghiChuOk);
      baoCao.reload();
      dsGoiY.reload();
      dsLink.reload();
    } catch (e) {
      setLoi(docLoi(e));
    }
  }

  async function luuMucTieu() {
    if (!mtChuId) return;
    await chay(async () => {
      // Mỗi dòng tiêu chí: "tên | đơn vị | ngưỡng" — tách | tùy chọn.
      const tieuChi = mtTieuChi
        .split("\n")
        .map((d) => d.trim())
        .filter(Boolean)
        .map((d) => {
          const [ten, donVi, nguong] = d.split("|").map((s) => s.trim());
          const n = Number(nguong);
          return {
            ten: ten ?? "",
            don_vi: donVi || undefined,
            nguong: Number.isFinite(n) && nguong ? n : undefined,
          };
        });
      await api("/api/muc-tieu", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          chu_loai: mtChuLoai,
          chu_id: mtChuId,
          mo_ta: mtMoTa,
          tieu_chi: tieuChi,
        }),
      });
    }, "Đã lưu mục tiêu.");
  }

  async function taoLink() {
    if (!lkUrl.trim() || (!lkTd && !lkBth)) return;
    await chay(async () => {
      const r = await api<{ link: LinkDich; da_tao: boolean }>("/api/link-dich", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          url_dich: lkUrl,
          thong_diep_id: lkTd || undefined,
          ban_the_hien_id: lkBth || undefined,
          nhan: lkNhan,
        }),
      });
      setGhiChu(r.da_tao ? `Đã tạo link theo dõi: ${r.link.url_theo_doi}` : "Link đích trùng — dùng lại link cũ.");
      setLkUrl("");
      setLkNhan("");
    }, "");
  }

  async function nhapKetQuaMoi() {
    if (!kqChuId || !kqTen.trim() || !kqBangChung.trim()) return;
    await chay(async () => {
      const giaTri = kqGiaTri.trim() ? Number(kqGiaTri) : undefined;
      await api("/api/ket-qua", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          chu_loai: kqChuLoai,
          chu_id: kqChuId,
          ten: kqTen,
          gia_tri: giaTri,
          don_vi: kqDonVi,
          bang_chung: kqBangChung,
          nhan_dinh: kqNhanDinh,
        }),
      });
      setKqTen("");
      setKqGiaTri("");
      setKqDonVi("");
      setKqBangChung("");
    }, "Đã nhập kết quả.");
  }

  async function thuMetric() {
    await chay(async () => {
      const r = await api<{ da_thu: number; bo_qua: number; loi: number }>(
        "/api/metric/thu-thap",
        { method: "POST" },
      );
      setGhiChu(
        `Đã thu ${r.da_thu} snapshot metric (bỏ qua ${r.bo_qua} lần giao` +
          `${r.loi > 0 ? `, lỗi ${r.loi}` : ""}).`,
      );
    }, "");
  }

  const bc = baoCao.data;

  return (
    <Flex direction="column" gap="4">
      <Flex align="center" justify="between" wrap="wrap" gap="2">
        <Heading size="5">Kết quả</Heading>
        <Flex gap="2" align="center" wrap="wrap">
          <Select.Root
            value={cpId}
            onValueChange={(v) => {
              setCpId(v === "__all__" ? "" : v);
            }}
          >
            <Select.Trigger placeholder="Campaign: tất cả" />
            <Select.Content>
              <Select.Item value="__all__">Campaign: tất cả</Select.Item>
              {(dsCp.data ?? []).map((c) => (
                <Select.Item key={c.id} value={c.id}>
                  {c.ten}
                </Select.Item>
              ))}
            </Select.Content>
          </Select.Root>
          <Select.Root value={tdId} onValueChange={(v) => setTdId(v === "__all__" ? "" : v)}>
            <Select.Trigger placeholder="Thông điệp: tất cả" />
            <Select.Content>
              <Select.Item value="__all__">Thông điệp: tất cả</Select.Item>
              {(dsTd.data ?? [])
                .filter((t) => !cpId || t.campaign_id === cpId)
                .map((t) => (
                  <Select.Item key={t.id} value={t.id}>
                    {t.tieu_de}
                  </Select.Item>
                ))}
            </Select.Content>
          </Select.Root>
          <Button size="1" variant="soft" onClick={() => void thuMetric()}>
            Thu thập metric
          </Button>
        </Flex>
      </Flex>

      {ghiChu && (
        <Text size="1" color="green">
          {ghiChu}
        </Text>
      )}
      {loi && (
        <Callout.Root color="red" size="1">
          <Callout.Text>{loi}</Callout.Text>
        </Callout.Root>
      )}

      <TrangThai loading={baoCao.loading} error={baoCao.error}>
        {bc && (
          <Flex direction="column" gap="4">
            {/* Định nghĩa metric + giới hạn — luôn hiện để không ai đọc
                số đếm nhầm thành người duy nhất hay tỉ lệ chuyển đổi. */}
            <Card>
              <Flex direction="column" gap="2">
                <Flex align="center" gap="2" wrap="wrap">
                  <Heading size="3">Định nghĩa metric</Heading>
                  {bc.mau_nho && (
                    <Badge color="amber">mẫu nhỏ — không suy tỉ lệ/độ ý nghĩa</Badge>
                  )}
                  <Badge variant="outline">
                    cửa sổ: {bc.cua_so.tu ? `${fmtLuc(bc.cua_so.tu)} → ${fmtLuc(bc.cua_so.den)}` : "trống"}{" "}
                    ({bc.cua_so.mui_gio})
                  </Badge>
                  <Badge variant="outline">
                    sự kiện mới nhất: {fmtLuc(bc.do_tuoi.su_kien_moi_nhat)}
                  </Badge>
                  <Badge variant="outline">
                    snapshot provider: {fmtLuc(bc.do_tuoi.snapshot_provider_moi_nhat)}
                  </Badge>
                </Flex>
                {Object.entries(bc.dinh_nghia).map(([k, v]) => (
                  <Text key={k} size="1" color="gray">
                    <Code size="1">{k}</Code> — {v}
                  </Text>
                ))}
                <Separator size="4" />
                <Text size="1" weight="bold">
                  Giới hạn
                </Text>
                {bc.gioi_han.map((g, i) => (
                  <Text key={i} size="1" color="gray">
                    · {g}
                  </Text>
                ))}
                <Text size="1" color="amber">
                  Reach social:{" "}
                  {bc.social.trang_thai === "khong_co"
                    ? "không có"
                    : String(bc.social.trang_thai)}{" "}
                  — {bc.social.ghi_chu}
                </Text>
              </Flex>
            </Card>

            {/* Mục tiêu + tiêu chí thành công */}
            <Card>
              <Flex direction="column" gap="2">
                <Heading size="3">Mục tiêu</Heading>
                {bc.muc_tieu ? (
                  <Flex direction="column" gap="1">
                    <Text size="1">{bc.muc_tieu.mo_ta}</Text>
                    {bc.muc_tieu.tieu_chi.map((tc, i) => (
                      <Text key={i} size="1" color="gray">
                        · {tc.ten}
                        {tc.don_vi ? ` (${tc.don_vi})` : ""}
                        {tc.nguong !== undefined ? ` ≥ ${tc.nguong}` : ""}
                      </Text>
                    ))}
                    <Text size="1" color="gray">
                      gắn: {bc.muc_tieu.chu_loai} · cập nhật {fmtLuc(bc.muc_tieu.cap_nhat_luc)}
                    </Text>
                  </Flex>
                ) : (
                  <Text size="1" color="gray">
                    Chưa có mục tiêu trong phạm vi.
                  </Text>
                )}
                <Separator size="4" />
                <ChonChu
                  chuLoai={mtChuLoai}
                  setChuLoai={setMtChuLoai}
                  chuId={mtChuId}
                  setChuId={setMtChuId}
                  dsCampaign={dsCp.data ?? []}
                  dsThongDiep={dsTd.data ?? []}
                  dsBth={bc.theo_ban_the_hien as { ban_the_hien_id: string; dinh_dang: string }[]}
                />
                <TextField.Root
                  size="1"
                  placeholder="Mô tả mục tiêu (vd: gây quỹ 5 triệu cho lò bánh)"
                  value={mtMoTa}
                  onChange={(e) => setMtMoTa(e.target.value)}
                />
                <TextField.Root
                  size="1"
                  placeholder="Tiêu chí — mỗi dòng: tên | đơn vị | ngưỡng"
                  value={mtTieuChi}
                  onChange={(e) => setMtTieuChi(e.target.value)}
                />
                <Flex>
                  <Button size="1" onClick={() => void luuMucTieu()} disabled={!mtChuId}>
                    Lưu mục tiêu
                  </Button>
                </Flex>
              </Flex>
            </Card>

            {/* So sánh theo thông điệp */}
            <Card>
              <Flex direction="column" gap="2">
                <Heading size="3">Theo thông điệp</Heading>
                <Table.Root size="1">
                  <Table.Header>
                    <Table.Row>
                      <Table.ColumnHeaderCell>Thông điệp</Table.ColumnHeaderCell>
                      <Table.ColumnHeaderCell>Đầu ra</Table.ColumnHeaderCell>
                      <Table.ColumnHeaderCell>Xem trang</Table.ColumnHeaderCell>
                      <Table.ColumnHeaderCell>Click link</Table.ColumnHeaderCell>
                      <Table.ColumnHeaderCell>Email đã gửi</Table.ColumnHeaderCell>
                      <Table.ColumnHeaderCell>Sự kiện email</Table.ColumnHeaderCell>
                      <Table.ColumnHeaderCell>Nhập tay</Table.ColumnHeaderCell>
                    </Table.Row>
                  </Table.Header>
                  <Table.Body>
                    {bc.theo_thong_diep.map((r) => (
                      <Table.Row key={String(r.thong_diep_id)}>
                        <Table.Cell>
                          <Text size="1">{String(r.tieu_de)}</Text>
                        </Table.Cell>
                        <Table.Cell>{String(r.so_dau_ra)}</Table.Cell>
                        <Table.Cell>
                          {String(r.xem_trang)}
                          {Number(r.xem_loai_bot) > 0 && (
                            <Text size="1" color="gray">{` (+${r.xem_loai_bot} bot)`}</Text>
                          )}
                        </Table.Cell>
                        <Table.Cell>
                          {String(r.click_link)}
                          {Number(r.click_loai_bot) > 0 && (
                            <Text size="1" color="gray">{` (+${r.click_loai_bot} bot)`}</Text>
                          )}
                        </Table.Cell>
                        <Table.Cell>{String(r.email_da_gui)}</Table.Cell>
                        <Table.Cell>
                          <Text size="1" color="gray">
                            {Object.entries(r.email_su_kien as Record<string, number>)
                              .map(([k, v]) => `${k}:${v}`)
                              .join(" · ") || "—"}
                          </Text>
                        </Table.Cell>
                        <Table.Cell>{String(r.so_nhap_tay)}</Table.Cell>
                      </Table.Row>
                    ))}
                    {bc.theo_thong_diep.length === 0 && (
                      <Table.Row>
                        <Table.Cell>
                          <Text size="1" color="gray">
                            Chưa có thông điệp nào trong phạm vi.
                          </Text>
                        </Table.Cell>
                      </Table.Row>
                    )}
                  </Table.Body>
                </Table.Root>
              </Flex>
            </Card>

            {/* So sánh theo kênh — reach social nêu rõ "không có", xuất tay
                không tính là đã đăng hay đã xem. */}
            <Card>
              <Flex direction="column" gap="2">
                <Heading size="3">Theo kênh</Heading>
                <Table.Root size="1">
                  <Table.Header>
                    <Table.Row>
                      <Table.ColumnHeaderCell>Kênh</Table.ColumnHeaderCell>
                      <Table.ColumnHeaderCell>Lần giao</Table.ColumnHeaderCell>
                      <Table.ColumnHeaderCell>Thành công</Table.ColumnHeaderCell>
                      <Table.ColumnHeaderCell>Số liệu</Table.ColumnHeaderCell>
                      <Table.ColumnHeaderCell>Ghi chú</Table.ColumnHeaderCell>
                    </Table.Row>
                  </Table.Header>
                  <Table.Body>
                    {bc.theo_kenh.map((r) => (
                      <Table.Row key={String(r.kenh)}>
                        <Table.Cell>
                          <Badge variant="outline">{String(r.nhan)}</Badge>
                        </Table.Cell>
                        <Table.Cell>
                          {String(r.lan_giao)}
                          {Number(r.cho_giao) > 0 && (
                            <Text size="1" color="gray">{` (chờ ${r.cho_giao})`}</Text>
                          )}
                        </Table.Cell>
                        <Table.Cell>{String(r.thanh_cong)}</Table.Cell>
                        <Table.Cell>
                          <Text size="1">
                            {r.da_gui !== undefined ? `đã gửi ${r.da_gui} · ` : ""}
                            {r.bo_qua_suppress !== undefined && Number(r.bo_qua_suppress) > 0
                              ? `suppression ${r.bo_qua_suppress} · `
                              : ""}
                            {r.xem_trang !== undefined ? `xem ${r.xem_trang} (bot ${r.loai_bot})` : ""}
                            {Object.entries(
                              (r.su_kien_provider ?? {}) as Record<string, number>,
                            )
                              .map(([k, v]) => ` ${k}:${v}`)
                              .join("")}
                          </Text>
                        </Table.Cell>
                        <Table.Cell>
                          <Text size="1" color="gray">
                            {r.ghi_chu !== undefined ? String(r.ghi_chu) : ""}
                          </Text>
                        </Table.Cell>
                      </Table.Row>
                    ))}
                  </Table.Body>
                </Table.Root>
              </Flex>
            </Card>

            {/* Theo đối tượng — gom xem/click/giao theo nhãn đối tượng
                tự do trên đầu ra. Số đếm là sự kiện, không phải người
                duy nhất giữa các nhóm. */}
            <Card>
              <Flex direction="column" gap="2">
                <Heading size="3">Theo đối tượng</Heading>
                <Table.Root size="1">
                  <Table.Header>
                    <Table.Row>
                      <Table.ColumnHeaderCell>Đối tượng</Table.ColumnHeaderCell>
                      <Table.ColumnHeaderCell>Đầu ra</Table.ColumnHeaderCell>
                      <Table.ColumnHeaderCell>Xem</Table.ColumnHeaderCell>
                      <Table.ColumnHeaderCell>Click</Table.ColumnHeaderCell>
                      <Table.ColumnHeaderCell>Giao ok</Table.ColumnHeaderCell>
                    </Table.Row>
                  </Table.Header>
                  <Table.Body>
                    {bc.theo_doi_tuong.map((r) => (
                      <Table.Row key={String(r.doi_tuong)}>
                        <Table.Cell>
                          <Text size="1">{String(r.doi_tuong)}</Text>
                        </Table.Cell>
                        <Table.Cell>{String(r.so_dau_ra)}</Table.Cell>
                        <Table.Cell>{String(r.xem_trang)}</Table.Cell>
                        <Table.Cell>{String(r.click_link)}</Table.Cell>
                        <Table.Cell>
                          {String(r.lan_giao_thanh_cong)}/{String(r.lan_giao)}
                        </Table.Cell>
                      </Table.Row>
                    ))}
                  </Table.Body>
                </Table.Root>
              </Flex>
            </Card>

            {/* Theo bản thể hiện — định dạng/đối tượng/dích đến. */}
            <Card>
              <Flex direction="column" gap="2">
                <Heading size="3">Theo bản thể hiện</Heading>
                <Table.Root size="1">
                  <Table.Header>
                    <Table.Row>
                      <Table.ColumnHeaderCell>Đầu ra</Table.ColumnHeaderCell>
                      <Table.ColumnHeaderCell>Định dạng</Table.ColumnHeaderCell>
                      <Table.ColumnHeaderCell>Đối tượng</Table.ColumnHeaderCell>
                      <Table.ColumnHeaderCell>Xem</Table.ColumnHeaderCell>
                      <Table.ColumnHeaderCell>Click</Table.ColumnHeaderCell>
                      <Table.ColumnHeaderCell>Giao ok</Table.ColumnHeaderCell>
                    </Table.Row>
                  </Table.Header>
                  <Table.Body>
                    {bc.theo_ban_the_hien.map((r) => (
                      <Table.Row key={String(r.ban_the_hien_id)}>
                        <Table.Cell>
                          <a href={`#/ban-the-hien?id=${r.ban_the_hien_id}`}>
                            <Text size="1">{String(r.ban_the_hien_id)}</Text>
                          </a>
                          {r.url_trang ? (
                            <Text size="1" color="gray">{` · /p/${String(r.ban_the_hien_id).slice(0, 8)}…`}</Text>
                          ) : null}
                        </Table.Cell>
                        <Table.Cell>{String(r.dinh_dang)}</Table.Cell>
                        <Table.Cell>
                          <Text size="1">{String(r.doi_tuong)}</Text>
                        </Table.Cell>
                        <Table.Cell>{String(r.xem_trang)}</Table.Cell>
                        <Table.Cell>{String(r.click_link)}</Table.Cell>
                        <Table.Cell>
                          {String(r.lan_giao_thanh_cong)}/{String(r.lan_giao)}
                        </Table.Cell>
                      </Table.Row>
                    ))}
                    {bc.theo_ban_the_hien.length === 0 && (
                      <Table.Row>
                        <Table.Cell>
                          <Text size="1" color="gray">
                            Chưa có đầu ra nào.
                          </Text>
                        </Table.Cell>
                      </Table.Row>
                    )}
                  </Table.Body>
                </Table.Root>
              </Flex>
            </Card>

            {/* Link đích theo dõi */}
            <Card>
              <Flex direction="column" gap="2">
                <Heading size="3">Link đích theo dõi</Heading>
                <Text size="1" color="gray">
                  Tạo URL /l/&lt;token&gt; để chèn vào nội dung — mỗi lượt qua link ghi
                  click_link (đã lọc dedupe + bot).
                </Text>
                <Flex gap="2" wrap="wrap" align="center">
                  <TextField.Root
                    size="1"
                    placeholder="https://đích…"
                    value={lkUrl}
                    onChange={(e) => setLkUrl(e.target.value)}
                    style={{ width: 260 }}
                  />
                  <TextField.Root
                    size="1"
                    placeholder="Nhãn (tùy chọn)"
                    value={lkNhan}
                    onChange={(e) => setLkNhan(e.target.value)}
                    style={{ width: 160 }}
                  />
                  <Select.Root value={lkTd} onValueChange={(v) => setLkTd(v === "__none__" ? "" : v)}>
                    <Select.Trigger placeholder="Gắn thông điệp…" />
                    <Select.Content>
                      <Select.Item value="__none__">Không gắn thông điệp</Select.Item>
                      {(dsTd.data ?? []).map((t) => (
                        <Select.Item key={t.id} value={t.id}>
                          {t.tieu_de}
                        </Select.Item>
                      ))}
                    </Select.Content>
                  </Select.Root>
                  <Select.Root value={lkBth} onValueChange={(v) => setLkBth(v === "__none__" ? "" : v)}>
                    <Select.Trigger placeholder="Hoặc gắn bản thể hiện…" />
                    <Select.Content>
                      <Select.Item value="__none__">Không gắn bản</Select.Item>
                      {(
                        bc.theo_ban_the_hien as { ban_the_hien_id: string; dinh_dang: string }[]
                      ).map((b) => (
                        <Select.Item key={b.ban_the_hien_id} value={b.ban_the_hien_id}>
                          {b.dinh_dang} · {b.ban_the_hien_id}
                        </Select.Item>
                      ))}
                    </Select.Content>
                  </Select.Root>
                  <Button
                    size="1"
                    onClick={() => void taoLink()}
                    disabled={!lkUrl.trim() || (!lkTd && !lkBth)}
                  >
                    Tạo link
                  </Button>
                </Flex>
                <Table.Root size="1">
                  <Table.Body>
                    {(dsLink.data?.ds_link ?? []).map((l) => (
                      <Table.Row key={l.id}>
                        <Table.Cell>
                          <Flex direction="column" gap="1">
                            <Text size="1">{l.nhan || l.url_dich}</Text>
                            <Text size="1" color="gray">
                              <Code size="1">{l.url_theo_doi}</Code> → {l.url_dich}
                            </Text>
                          </Flex>
                        </Table.Cell>
                        <Table.Cell>
                          <Text size="1">{l.so_click} click</Text>
                        </Table.Cell>
                      </Table.Row>
                    ))}
                    {(dsLink.data?.ds_link ?? []).length === 0 && (
                      <Table.Row>
                        <Table.Cell>
                          <Text size="1" color="gray">
                            Chưa có link đích nào.
                          </Text>
                        </Table.Cell>
                      </Table.Row>
                    )}
                  </Table.Body>
                </Table.Root>
              </Flex>
            </Card>

            {/* Kết quả nhập tay — bằng chứng bắt buộc, nhãn tự báo trừ
                khi đo được. */}
            <Card>
              <Flex direction="column" gap="2">
                <Heading size="3">Kết quả đã kiểm chứng (nhập tay)</Heading>
                <ChonChu
                  chuLoai={kqChuLoai}
                  setChuLoai={setKqChuLoai}
                  chuId={kqChuId}
                  setChuId={setKqChuId}
                  dsCampaign={dsCp.data ?? []}
                  dsThongDiep={dsTd.data ?? []}
                  dsBth={bc.theo_ban_the_hien as { ban_the_hien_id: string; dinh_dang: string }[]}
                />
                <Flex gap="2" wrap="wrap" align="center">
                  <TextField.Root
                    size="1"
                    placeholder="Tên số liệu (vd: tien_gay_quy)"
                    value={kqTen}
                    onChange={(e) => setKqTen(e.target.value)}
                    style={{ width: 220 }}
                  />
                  <TextField.Root
                    size="1"
                    placeholder="Giá trị (số)"
                    value={kqGiaTri}
                    onChange={(e) => setKqGiaTri(e.target.value)}
                    style={{ width: 120 }}
                  />
                  <TextField.Root
                    size="1"
                    placeholder="Đơn vị"
                    value={kqDonVi}
                    onChange={(e) => setKqDonVi(e.target.value)}
                    style={{ width: 100 }}
                  />
                  <Select.Root value={kqNhanDinh} onValueChange={setKqNhanDinh}>
                    <Select.Trigger />
                    <Select.Content>
                      <Select.Item value="tu_bao">Tự báo</Select.Item>
                      <Select.Item value="da_do">Đã đo</Select.Item>
                    </Select.Content>
                  </Select.Root>
                </Flex>
                <TextField.Root
                  size="1"
                  placeholder="Bằng chứng (bắt buộc — vd: sao kê, ảnh chụp dashboard)"
                  value={kqBangChung}
                  onChange={(e) => setKqBangChung(e.target.value)}
                />
                <Flex>
                  <Button
                    size="1"
                    onClick={() => void nhapKetQuaMoi()}
                    disabled={!kqChuId || !kqTen.trim() || !kqBangChung.trim()}
                  >
                    Nhập kết quả
                  </Button>
                </Flex>
                <Table.Root size="1">
                  <Table.Body>
                    {bc.nhap_tay.map((s: SoLieu) => (
                      <Table.Row key={s.id}>
                        <Table.Cell>
                          <Flex direction="column" gap="1">
                            <Flex gap="2" align="center" wrap="wrap">
                              <Text size="1" weight="bold">
                                {s.ten}
                              </Text>
                              {s.gia_tri !== null && (
                                <Text size="1">
                                  {s.gia_tri}
                                  {s.don_vi ? ` ${s.don_vi}` : ""}
                                </Text>
                              )}
                              <Badge color={s.nhan_dinh === "da_do" ? "green" : "orange"} variant="soft">
                                {s.nhan_dinh === "da_do" ? "đã đo" : "tự báo"}
                              </Badge>
                            </Flex>
                            <Text size="1" color="gray">
                              {s.chu_loai}:{s.chu_id} · bằng chứng: {s.bang_chung}
                            </Text>
                            <Text size="1" color="gray">
                              {s.cua_so_tu ? `cửa sổ ${fmtLuc(s.cua_so_tu)} → ${fmtLuc(s.cua_so_den)}` : ""}{" "}
                              ({s.mui_gio}) · nhập {fmtLuc(s.tao_luc)}
                            </Text>
                          </Flex>
                        </Table.Cell>
                      </Table.Row>
                    ))}
                    {bc.nhap_tay.length === 0 && (
                      <Table.Row>
                        <Table.Cell>
                          <Text size="1" color="gray">
                            Chưa có kết quả nhập tay nào trong phạm vi.
                          </Text>
                        </Table.Cell>
                      </Table.Row>
                    )}
                  </Table.Body>
                </Table.Root>
              </Flex>
            </Card>
          </Flex>
        )}
      </TrangThai>

      {/* Gợi ý hành động tiếp theo */}
      <Card>
        <Flex direction="column" gap="2">
          <Heading size="3">Gợi ý tiếp theo</Heading>
          <Text size="1" color="gray">
            Đề xuất từ quan sát đã ghi — tương quan không phải nhân quả. Chấp nhận
            tạo nháp/thí nghiệm liên kết dưới cùng thông điệp; không tự đăng hay sửa
            nội dung đã duyệt.
          </Text>
          <TrangThai loading={dsGoiY.loading} error={dsGoiY.error}>
            <Flex direction="column" gap="2">
              {(dsGoiY.data?.ds_goi_y ?? []).map((g) => (
                <TheGoiY key={g.id} g={g} reload={dsGoiY.reload} />
              ))}
              {(dsGoiY.data?.ds_goi_y ?? []).length === 0 && (
                <Text size="1" color="gray">
                  Chưa có gợi ý nào — cần ít nhất một lần giao thành công hoặc sự kiện đo.
                </Text>
              )}
            </Flex>
          </TrangThai>
        </Flex>
      </Card>
    </Flex>
  );
}
