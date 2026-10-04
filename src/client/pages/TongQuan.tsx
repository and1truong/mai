import {
  Badge,
  Box,
  Button,
  Callout,
  Card,
  Flex,
  Grid,
  Heading,
  Select,
  Text,
  TextArea,
  TextField,
} from "@radix-ui/themes";
import { useState } from "react";
import { api, fmtLuc, LoiApiClient, useApi } from "../api.ts";
import { TrangThai } from "../components/TrangThai.tsx";
import type { BanTheHien } from "../../modules/content/index.ts";

type KeHoachGanDay = {
  id: string;
  trang_thai: string;
  cap_nhat_luc: string;
  tieu_de?: string;
};

type TongQuan = {
  nguon: number;
  campaign: number;
  thong_diep: number;
  ban_the_hien: number;
  revision: number;
  job_cho: number;
  ho_so_thuong_hieu: number;
  ho_so_doi_tuong: number;
  viec_gan_day: { ke_hoach: KeHoachGanDay[]; ban_the_hien: BanTheHien[] };
  bth_cho_duyet: BanTheHien[];
  bth_cu: BanTheHien[];
};

const O: { key: keyof TongQuan; nhan: string }[] = [
  { key: "nguon", nhan: "Nguồn" },
  { key: "campaign", nhan: "Campaign" },
  { key: "thong_diep", nhan: "Thông điệp" },
  { key: "ban_the_hien", nhan: "Bản thể hiện" },
  { key: "revision", nhan: "Revision" },
  { key: "job_cho", nhan: "Job đang chờ" },
  { key: "ho_so_thuong_hieu", nhan: "Hồ sơ thương hiệu" },
  { key: "ho_so_doi_tuong", nhan: "Hồ sơ đối tượng" },
];

type Health = {
  trang_thai: string;
  provider: { ten: string; la_fixture: boolean; model?: string };
};

function FormIntake() {
  const dsNguon = useApi<{ id: string; tieu_de: string }[]>("/api/nguon");
  const [tieuDe, setTieuDe] = useState("");
  const [vanBan, setVanBan] = useState("");
  const [cta, setCta] = useState("");
  const [nguonId, setNguonId] = useState("");
  const [loi, setLoi] = useState("");
  const [dangGui, setDangGui] = useState(false);

  async function tao() {
    if (!vanBan.trim()) {
      setLoi("Nhập mô tả ý tưởng, sự kiện hay mục tiêu trước.");
      return;
    }
    setLoi("");
    setDangGui(true);
    try {
      const kq = await api<{ ke_hoach: { id: string } }>("/api/ke-hoach", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          van_ban: vanBan,
          tieu_de: tieuDe || undefined,
          cta: cta || undefined,
          nguon_id: nguonId || null,
        }),
      });
      window.location.hash = `/ke-hoach?id=${kq.ke_hoach.id}`;
    } catch (e) {
      setLoi(e instanceof LoiApiClient ? `${e.ma}: ${e.message}` : String(e));
    } finally {
      setDangGui(false);
    }
  }

  return (
    <Card mb="4">
      <Heading size="3" mb="2">
        Bắt đầu từ ý định
      </Heading>
      <Flex direction="column" gap="2">
        <TextArea
          value={vanBan}
          onChange={(e) => setVanBan(e.target.value)}
          rows={4}
          placeholder="Mô tả ý tưởng, sự kiện hay mục tiêu — ví dụ: ra mắt Mai v1 vào 15/10, giá 120.000đ…"
        />
        <Flex gap="2" wrap="wrap">
          <TextField.Root
            value={tieuDe}
            onChange={(e) => setTieuDe(e.target.value)}
            placeholder="Tiêu đề (tùy chọn)"
            style={{ flex: 1, minWidth: 200 }}
          />
          <TextField.Root
            value={cta}
            onChange={(e) => setCta(e.target.value)}
            placeholder="CTA (tùy chọn)"
            style={{ flex: 1, minWidth: 200 }}
          />
          <Select.Root value={nguonId} onValueChange={(v) => setNguonId(v === "-" ? "" : v)}>
            <Select.Trigger placeholder="Nguồn kèm (tùy chọn)" />
            <Select.Content>
              <Select.Item value="-">(không kèm nguồn)</Select.Item>
              {(dsNguon.data ?? []).map((n) => (
                <Select.Item key={n.id} value={n.id}>
                  {n.tieu_de}
                </Select.Item>
              ))}
            </Select.Content>
          </Select.Root>
          <Button size="2" disabled={dangGui} onClick={() => void tao()}>
            {dangGui ? "Đang tạo…" : "Tạo kế hoạch"}
          </Button>
        </Flex>
        {loi && (
          <Text size="2" color="red">
            {loi}
          </Text>
        )}
      </Flex>
    </Card>
  );
}

function LienKetBth({ b }: { b: BanTheHien }) {
  return (
    <Flex align="center" gap="2">
      <a href={`#/ban-the-hien?id=${b.id}`}>
        {b.dinh_dang} — {b.doi_tuong || "chung"}
      </a>
      <Badge color="gray" size="1">
        {b.trang_thai}
      </Badge>
    </Flex>
  );
}

export default function TongQuanPage() {
  const { data, loading, error } = useApi<TongQuan>("/api/tong-quan");
  const health = useApi<Health>("/api/health");
  const provider = health.data?.provider;
  return (
    <>
      <Heading mb="3">Tổng quan</Heading>
      <FormIntake />
      <TrangThai loading={loading} error={error}>
        <Grid columns={{ initial: "2", sm: "4" }} gap="3">
          {O.map((o) => (
            <Card key={o.key}>
              <Text size="2" color="gray">
                {o.nhan}
              </Text>
              <Heading size="6">{typeof data?.[o.key] === "number" ? (data[o.key] as number) : 0}</Heading>
            </Card>
          ))}
        </Grid>
        {/* Chế độ fixture hiển thị rõ để không nhầm đầu ra giả với provider live. */}
        <Callout.Root mt="4" color={provider?.la_fixture === false ? "green" : "blue"}>
          <Callout.Text>
            MAI đang chạy chế độ demo: actor <Text weight="bold">demo</Text>, provider AI{" "}
            <Text weight="bold">{provider?.ten ?? "…"}</Text>
            {provider?.model ? ` (${provider.model})` : ""}{" "}
            {provider?.la_fixture ? (
              <Badge color="amber">fixture</Badge>
            ) : provider ? (
              <Badge color="green">live</Badge>
            ) : null}
          </Callout.Text>
        </Callout.Root>

        {data && (
          <Grid columns="3" gap="3" mt="4">
            <Card>
              <Heading size="3" mb="2">
                Việc gần đây
              </Heading>
              <Flex direction="column" gap="1">
                {data.viec_gan_day.ke_hoach.slice(0, 5).map((k) => (
                  <Flex key={k.id} align="center" gap="2">
                    <a href={`#/ke-hoach?id=${k.id}`}>{k.tieu_de ?? "Kế hoạch"}</a>
                    <Badge color={k.trang_thai === "da_chon" ? "green" : "gray"} size="1">
                      {k.trang_thai === "da_chon" ? "đã chọn" : "nháp"}
                    </Badge>
                  </Flex>
                ))}
                {data.viec_gan_day.ban_the_hien.slice(0, 5).map((b) => (
                  <LienKetBth key={b.id} b={b} />
                ))}
                {data.viec_gan_day.ke_hoach.length === 0 &&
                  data.viec_gan_day.ban_the_hien.length === 0 && (
                    <Text size="2" color="gray">
                      Chưa có việc nào.
                    </Text>
                  )}
              </Flex>
            </Card>
            <Card>
              <Heading size="3" mb="2">
                Nháp chờ review
              </Heading>
              <Flex direction="column" gap="1">
                {data.bth_cho_duyet.slice(0, 10).map((b) => (
                  <LienKetBth key={b.id} b={b} />
                ))}
                {data.bth_cho_duyet.length === 0 && (
                  <Text size="2" color="gray">
                    Không có nháp nào chờ review.
                  </Text>
                )}
              </Flex>
            </Card>
            <Card>
              <Heading size="3" mb="2">
                Bản thể hiện đã cũ
              </Heading>
              <Text size="1" color="gray" as="p" mb="2">
                Thông điệp đã đổi sau khi bản sinh — cân nhắc sinh lại.
              </Text>
              <Flex direction="column" gap="1">
                {data.bth_cu.slice(0, 10).map((b) => (
                  <LienKetBth key={b.id} b={b} />
                ))}
                {data.bth_cu.length === 0 && (
                  <Text size="2" color="gray">
                    Tất cả bản đều mới.
                  </Text>
                )}
              </Flex>
            </Card>
          </Grid>
        )}
      </TrangThai>
    </>
  );
}
