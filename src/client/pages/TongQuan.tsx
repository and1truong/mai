import { Badge, Callout, Card, Grid, Heading, Text } from "@radix-ui/themes";
import { useApi } from "../api.ts";
import { TrangThai } from "../components/TrangThai.tsx";

type TongQuan = {
  nguon: number;
  campaign: number;
  thong_diep: number;
  ban_the_hien: number;
  revision: number;
  job_cho: number;
  ho_so_thuong_hieu: number;
  ho_so_doi_tuong: number;
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

export default function TongQuanPage() {
  const { data, loading, error } = useApi<TongQuan>("/api/tong-quan");
  const health = useApi<Health>("/api/health");
  const provider = health.data?.provider;
  return (
    <>
      <Heading mb="3">Tổng quan</Heading>
      <TrangThai loading={loading} error={error}>
        <Grid columns={{ initial: "2", sm: "4" }} gap="3">
          {O.map((o) => (
            <Card key={o.key}>
              <Text size="2" color="gray">
                {o.nhan}
              </Text>
              <Heading size="6">{data?.[o.key] ?? 0}</Heading>
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
      </TrangThai>
    </>
  );
}
