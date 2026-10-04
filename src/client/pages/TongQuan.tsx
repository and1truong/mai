import { Callout, Card, Grid, Heading, Text } from "@radix-ui/themes";
import { useApi } from "../api.ts";
import { TrangThai } from "../components/TrangThai.tsx";

type TongQuan = {
  nguon: number;
  ban_the_hien: number;
  revision: number;
  job_cho: number;
};

const O: { key: keyof TongQuan; nhan: string }[] = [
  { key: "nguon", nhan: "Nguồn" },
  { key: "ban_the_hien", nhan: "Bản thể hiện" },
  { key: "revision", nhan: "Revision" },
  { key: "job_cho", nhan: "Job đang chờ" },
];

export default function TongQuanPage() {
  const { data, loading, error } = useApi<TongQuan>("/api/tong-quan");
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
        <Callout.Root mt="4" color="blue">
          <Callout.Text>
            MAI đang chạy chế độ demo: actor <Text weight="bold">demo</Text>, provider AI{" "}
            <Text weight="bold">fixture</Text> (offline, deterministic).
          </Callout.Text>
        </Callout.Root>
      </TrangThai>
    </>
  );
}
