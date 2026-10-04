import { Badge, Button, Callout, Card, Flex, Heading, Select, Table, Text } from "@radix-ui/themes";
import { useEffect, useState } from "react";
import { api, fmtLuc, LoiApiClient, useApi } from "../api.ts";
import { TrangThai } from "../components/TrangThai.tsx";
import type { Nguon } from "../../modules/content/index.ts";
import type { HoSoDoiTuong, HoSoThuongHieu } from "../../modules/context/index.ts";
import type { Job } from "../../modules/jobs/index.ts";

const MAU_JOB: Record<string, "gray" | "blue" | "green" | "red"> = {
  cho: "gray",
  dang_chay: "blue",
  xong: "green",
  loi: "red",
};

export default function JobPage() {
  const jobs = useApi<Job[]>("/api/job");
  const nguons = useApi<Nguon[]>("/api/nguon");
  const dinhDangs = useApi<string[]>("/api/dinh-dang");
  const thuongHieu = useApi<HoSoThuongHieu[]>("/api/ho-so-thuong-hieu");
  const doiTuong = useApi<HoSoDoiTuong[]>("/api/ho-so-doi-tuong");
  const [nguonId, setNguonId] = useState("");
  const [dinhDang, setDinhDang] = useState("");
  const [thId, setThId] = useState("khong");
  const [dtId, setDtId] = useState("khong");
  const [loi, setLoi] = useState<string | null>(null);

  useEffect(() => {
    if (!dinhDang && dinhDangs.data?.[0]) setDinhDang(dinhDangs.data[0]);
  }, [dinhDangs.data, dinhDang]);

  // Tự reload khi còn job đang chờ/chạy.
  useEffect(() => {
    const conJob = jobs.data?.some((j) => j.trang_thai === "cho" || j.trang_thai === "dang_chay");
    if (!conJob) return;
    const t = setInterval(jobs.reload, 1500);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobs.data]);

  async function taoJob() {
    setLoi(null);
    try {
      await api("/api/job", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          loai: "sinh_ban_the_hien",
          payload: {
            nguon_id: nguonId,
            dinh_dang: dinhDang,
            thuong_hieu_id: thId === "khong" ? undefined : thId,
            doi_tuong_id: dtId === "khong" ? undefined : dtId,
          },
        }),
      });
      jobs.reload();
    } catch (e) {
      setLoi(e instanceof LoiApiClient ? `${e.ma}: ${e.message}` : String(e));
    }
  }

  return (
    <>
      <Heading mb="3">Job nền</Heading>
      <Card mb="4">
        <Flex gap="3" wrap="wrap" align="center">
          <Select.Root value={nguonId} onValueChange={setNguonId}>
            <Select.Trigger placeholder="Chọn nguồn" />
            <Select.Content>
              {nguons.data?.map((n) => (
                <Select.Item key={n.id} value={n.id}>
                  {n.tieu_de}
                </Select.Item>
              ))}
            </Select.Content>
          </Select.Root>
          <Select.Root value={dinhDang} onValueChange={setDinhDang}>
            <Select.Trigger placeholder="Định dạng" />
            <Select.Content>
              {dinhDangs.data?.map((d) => (
                <Select.Item key={d} value={d}>
                  {d}
                </Select.Item>
              ))}
            </Select.Content>
          </Select.Root>
          <Select.Root value={thId} onValueChange={setThId}>
            <Select.Trigger placeholder="Thương hiệu" />
            <Select.Content>
              <Select.Item value="khong">Không chọn thương hiệu</Select.Item>
              {thuongHieu.data?.map((h) => (
                <Select.Item key={h.id} value={h.id}>
                  {h.ten}
                </Select.Item>
              ))}
            </Select.Content>
          </Select.Root>
          <Select.Root value={dtId} onValueChange={setDtId}>
            <Select.Trigger placeholder="Đối tượng" />
            <Select.Content>
              <Select.Item value="khong">Không chọn đối tượng</Select.Item>
              {doiTuong.data?.map((d) => (
                <Select.Item key={d.id} value={d.id}>
                  {d.ten}
                </Select.Item>
              ))}
            </Select.Content>
          </Select.Root>
          <Button onClick={taoJob} disabled={!nguonId || !dinhDang}>
            Tạo job sinh bản thể hiện
          </Button>
        </Flex>
        {loi && (
          <Callout.Root color="red" mt="3">
            <Callout.Text>{loi}</Callout.Text>
          </Callout.Root>
        )}
        <Text size="1" color="gray" as="p" mt="2">
          Job chạy trong cùng process, dùng provider fixture (deterministic, offline).
        </Text>
      </Card>
      <TrangThai loading={jobs.loading} error={jobs.error} empty={jobs.data?.length === 0}>
        <Table.Root>
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeaderCell>Loại</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>Trạng thái</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>Tạo lúc</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>Lỗi</Table.ColumnHeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {jobs.data?.map((j) => (
              <Table.Row key={j.id}>
                <Table.Cell>{j.loai}</Table.Cell>
                <Table.Cell>
                  <Badge color={MAU_JOB[j.trang_thai] ?? "gray"}>{j.trang_thai}</Badge>
                </Table.Cell>
                <Table.Cell>{fmtLuc(j.tao_luc)}</Table.Cell>
                <Table.Cell>{j.loi ?? "—"}</Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Root>
      </TrangThai>
    </>
  );
}
