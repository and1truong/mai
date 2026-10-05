import {
  Badge,
  Button,
  Callout,
  Card,
  Code,
  Flex,
  Heading,
  Table,
  Text,
  TextField,
} from "@radix-ui/themes";
import { useState } from "react";
import { api, fmtLuc, LoiApiClient, useApi } from "../api.ts";
import { TrangThai } from "../components/TrangThai.tsx";
import type { GiaoHang, NguoiNhan } from "../../modules/kenh/index.ts";

// Trang kênh sở hữu (#13): danh mục adapter theo năng lực đã hiện thực,
// danh bạ người nhận opt-in (thêm tay, hủy đăng ký = suppression), và
// lịch sử các lần giao toàn hệ thống. URL: #/kenh.

type Kenh = {
  id: string;
  nhan: string;
  mo_ta: string;
  nang_luc: string[];
  san_sang: boolean;
  dong_bo: boolean;
};

const NHAN_NANG_LUC: Record<string, string> = {
  xem_truoc: "xem trước",
  dang: "đăng",
  cap_nhat: "cập nhật",
  len_lich: "lên lịch",
  xuat: "xuất",
  metric: "metric",
};

export const MAU_GIAO: Record<string, "gray" | "blue" | "green" | "red" | "orange" | "indigo"> = {
  cho_giao: "blue",
  da_giao: "green",
  chap_nhan: "green",
  khong_chac: "orange",
  xuat_tay: "indigo",
  huy: "gray",
  loi: "red",
};

export const NHAN_GIAO: Record<string, string> = {
  cho_giao: "Chờ giao",
  da_giao: "Đã giao",
  chap_nhan: "Đã chấp nhận",
  khong_chac: "Không chắc",
  xuat_tay: "Xuất tay",
  huy: "Đã hủy",
  loi: "Lỗi",
};

function TheGiaoHang({
  g,
  reload,
}: {
  g: GiaoHang & { dinh_dang?: string };
  reload: () => void;
}) {
  const [loi, setLoi] = useState<string | null>(null);
  const [metric, setMetric] = useState<string | null>(null);

  async function chay(fn: () => Promise<unknown>) {
    setLoi(null);
    try {
      await fn();
      reload();
    } catch (e) {
      setLoi(e instanceof LoiApiClient ? `${e.ma}: ${e.message}` : String(e));
    }
  }

  return (
    <Table.Row>
      <Table.Cell>
        <Flex direction="column" gap="1">
          <Flex gap="2" align="center" wrap="wrap">
            <Badge variant="outline">{g.kenh}</Badge>
            <Badge color={MAU_GIAO[g.trang_thai] ?? "gray"}>
              {NHAN_GIAO[g.trang_thai] ?? g.trang_thai}
            </Badge>
            {g.la_test && <Badge color="amber" variant="soft">test</Badge>}
            {g.dinh_dang && <Text size="1" color="gray">{g.dinh_dang}</Text>}
          </Flex>
          <Text size="1" color="gray">
            {fmtLuc(g.tao_luc)}
            {g.len_lich_luc ? ` · hẹn ${fmtLuc(g.len_lich_luc)} (${g.mui_gio || "—"})` : ""}
            {g.xong_luc ? ` · xong ${fmtLuc(g.xong_luc)}` : ""}
            {g.lan_thu > 1 ? ` · thử ×${g.lan_thu}` : ""}
          </Text>
          {g.url && (
            <Text size="1">
              <a href={g.url} target="_blank" rel="noreferrer">
                {g.url}
              </a>
            </Text>
          )}
          {g.ma_bien_nhan && (
            <Text size="1" color="gray">
              biên nhận: {g.ma_bien_nhan}
            </Text>
          )}
          {g.so_nguoi_nhan > 0 && (
            <Text size="1" color="gray">
              {g.so_nguoi_nhan} người nhận{g.so_bo_qua > 0 ? ` · bỏ qua ${g.so_bo_qua} đã hủy` : ""}
            </Text>
          )}
          {g.loi && (
            <Text size="1" color="red">
              {g.loi}
            </Text>
          )}
          {g.chi_tiet.nhan != null && (
            <Text size="1" color="amber">
              {String(g.chi_tiet.nhan)}
            </Text>
          )}
          {metric && (
            <Code size="1" style={{ whiteSpace: "pre-wrap" }}>
              {metric}
            </Code>
          )}
          {loi && (
            <Callout.Root color="red" size="1">
              <Callout.Text>{loi}</Callout.Text>
            </Callout.Root>
          )}
        </Flex>
      </Table.Cell>
      <Table.Cell>
        <Flex gap="1" wrap="wrap">
          {g.trang_thai === "cho_giao" && (
            <Button
              size="1"
              variant="soft"
              color="red"
              onClick={() => void chay(() => api(`/api/giao-hang/${g.id}/huy`, { method: "POST" }))}
            >
              Hủy
            </Button>
          )}
          {(g.trang_thai === "loi" || g.trang_thai === "khong_chac") && (
            <Button
              size="1"
              variant="soft"
              onClick={() =>
                void chay(() => api(`/api/giao-hang/${g.id}/thu-lai`, { method: "POST" }))
              }
            >
              Thử lại
            </Button>
          )}
          {g.trang_thai === "chap_nhan" && g.ma_bien_nhan && (
            <Button
              size="1"
              variant="soft"
              onClick={() =>
                void chay(async () => {
                  const m = await api<Record<string, unknown>>(`/api/giao-hang/${g.id}/metric`);
                  setMetric(JSON.stringify(m, null, 2));
                })
              }
            >
              Metric
            </Button>
          )}
          <Button size="1" variant="soft" asChild>
            <a href={`#/thong-diep?id=${g.ban_the_hien_id}`}>Đầu ra</a>
          </Button>
        </Flex>
      </Table.Cell>
    </Table.Row>
  );
}

export default function KenhPage() {
  const dsKenh = useApi<{ ds_kenh: Kenh[] }>("/api/kenh");
  const dsNguoiNhan = useApi<{ ds_nguoi_nhan: NguoiNhan[] }>("/api/nguoi-nhan");
  const dsGiao = useApi<{ ds_giao: (GiaoHang & { dinh_dang: string })[] }>("/api/giao-hang");
  const [email, setEmail] = useState("");
  const [ten, setTen] = useState("");
  const [loi, setLoi] = useState<string | null>(null);
  const [ghiChu, setGhiChu] = useState("");

  async function them() {
    setLoi(null);
    setGhiChu("");
    try {
      const r = await api<{ da_tao: boolean; nguoi_nhan: NguoiNhan }>("/api/nguoi-nhan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, ten }),
      });
      setGhiChu(
        r.da_tao
          ? `Đã thêm ${r.nguoi_nhan.email}.`
          : `${r.nguoi_nhan.email} đã tồn tại (trạng thái ${r.nguoi_nhan.trang_thai}).`,
      );
      setEmail("");
      setTen("");
      dsNguoiNhan.reload();
    } catch (e) {
      setLoi(e instanceof LoiApiClient ? `${e.ma}: ${e.message}` : String(e));
    }
  }

  async function huyDangKy(id: string) {
    setLoi(null);
    try {
      await api(`/api/nguoi-nhan/${id}/huy-dang-ky`, { method: "POST" });
      dsNguoiNhan.reload();
    } catch (e) {
      setLoi(e instanceof LoiApiClient ? `${e.ma}: ${e.message}` : String(e));
    }
  }

  return (
    <Flex direction="column" gap="4">
      <Heading size="5">Kênh sở hữu</Heading>

      <TrangThai loading={dsKenh.loading} error={dsKenh.error}>
        <Flex direction="column" gap="2">
          {(dsKenh.data?.ds_kenh ?? []).map((k) => (
            <Card key={k.id} variant="surface">
              <Flex align="center" gap="2" wrap="wrap">
                <Heading size="3">{k.nhan}</Heading>
                {k.nang_luc.map((n) => (
                  <Badge key={n} variant="outline">
                    {NHAN_NANG_LUC[n] ?? n}
                  </Badge>
                ))}
                {k.san_sang ? (
                  <Badge color="green">Sẵn sàng</Badge>
                ) : (
                  <Badge color="amber">Chưa cấu hình</Badge>
                )}
                {k.dong_bo && <Badge variant="soft">chạy ngay</Badge>}
              </Flex>
              <Text size="1" color="gray" as="p" mt="1">
                {k.mo_ta}
              </Text>
              {!k.san_sang && (
                <Text size="1" color="amber" as="p" mt="1">
                  Cấu hình trong mai.config.json: kenh.email.base_url + kenh.email.from +
                  biến môi trường tên trong kenh.email.api_key_env.
                </Text>
              )}
            </Card>
          ))}
        </Flex>
      </TrangThai>

      <Card>
        <Flex direction="column" gap="2">
          <Heading size="3">Người nhận opt-in</Heading>
          <Text size="1" color="gray">
            Danh bạ do chủ sở hữu khai báo — không tự tìm mailing list. Đã hủy đăng ký
            = suppression vĩnh viễn, kênh email không gửi tới nữa.
          </Text>
          <Flex gap="2" wrap="wrap" align="center">
            <TextField.Root
              size="1"
              placeholder="email@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={{ width: 240 }}
            />
            <TextField.Root
              size="1"
              placeholder="Tên (tùy chọn)"
              value={ten}
              onChange={(e) => setTen(e.target.value)}
              style={{ width: 160 }}
            />
            <Button size="1" onClick={() => void them()} disabled={!email.trim()}>
              Thêm
            </Button>
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
          <TrangThai loading={dsNguoiNhan.loading} error={dsNguoiNhan.error}>
            <Table.Root size="1">
              <Table.Body>
                {(dsNguoiNhan.data?.ds_nguoi_nhan ?? []).map((n) => (
                  <Table.Row key={n.id}>
                    <Table.Cell>
                      <Flex direction="column" gap="1">
                        <Text size="1">{n.email}</Text>
                        <Text size="1" color="gray">
                          {n.ten || "—"} · thêm {fmtLuc(n.tao_luc)}
                          {n.huy_luc ? ` · hủy ${fmtLuc(n.huy_luc)}` : ""}
                        </Text>
                      </Flex>
                    </Table.Cell>
                    <Table.Cell>
                      <Flex gap="2" align="center">
                        {n.trang_thai === "dang_ky" ? (
                          <>
                            <Badge color="green">Đăng ký</Badge>
                            <Button
                              size="1"
                              variant="soft"
                              color="red"
                              onClick={() => void huyDangKy(n.id)}
                            >
                              Hủy đăng ký
                            </Button>
                          </>
                        ) : (
                          <Badge color="gray">Đã hủy</Badge>
                        )}
                      </Flex>
                    </Table.Cell>
                  </Table.Row>
                ))}
                {(dsNguoiNhan.data?.ds_nguoi_nhan ?? []).length === 0 && (
                  <Table.Row>
                    <Table.Cell>
                      <Text size="1" color="gray">
                        Chưa có người nhận nào.
                      </Text>
                    </Table.Cell>
                  </Table.Row>
                )}
              </Table.Body>
            </Table.Root>
          </TrangThai>
        </Flex>
      </Card>

      <Card>
        <Flex direction="column" gap="2">
          <Heading size="3">Lần giao gần đây</Heading>
          <TrangThai loading={dsGiao.loading} error={dsGiao.error}>
            <Table.Root size="1">
              <Table.Body>
                {(dsGiao.data?.ds_giao ?? []).map((g) => (
                  <TheGiaoHang key={g.id} g={g} reload={dsGiao.reload} />
                ))}
                {(dsGiao.data?.ds_giao ?? []).length === 0 && (
                  <Table.Row>
                    <Table.Cell>
                      <Text size="1" color="gray">
                        Chưa có lần giao nào.
                      </Text>
                    </Table.Cell>
                  </Table.Row>
                )}
              </Table.Body>
            </Table.Root>
          </TrangThai>
        </Flex>
      </Card>
    </Flex>
  );
}
