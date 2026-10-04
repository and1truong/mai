import { Button, Callout, Card, Flex, Heading, Table, TextArea, TextField } from "@radix-ui/themes";
import { useState } from "react";
import { api, fmtLuc, LoiApiClient, useApi } from "../api.ts";
import { TrangThai } from "../components/TrangThai.tsx";
import type { Nguon } from "../../modules/content/index.ts";

export default function NguonPage() {
  const { data, loading, error, reload } = useApi<Nguon[]>("/api/nguon");
  const [tieuDe, setTieuDe] = useState("");
  const [noiDung, setNoiDung] = useState("");
  const [dsLoi, setDsLoi] = useState<string[]>([]);
  const [dangGui, setDangGui] = useState(false);

  async function gui() {
    setDangGui(true);
    setDsLoi([]);
    try {
      await api("/api/nguon", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tieu_de: tieuDe, noi_dung: noiDung }),
      });
      setTieuDe("");
      setNoiDung("");
      reload();
    } catch (e) {
      if (e instanceof LoiApiClient) {
        setDsLoi([e.message, ...(Array.isArray(e.chiTiet) ? e.chiTiet.map(String) : [])]);
      } else {
        setDsLoi([String(e)]);
      }
    } finally {
      setDangGui(false);
    }
  }

  return (
    <>
      <Heading mb="3">Nguồn</Heading>
      <Card mb="4">
        <Flex direction="column" gap="3">
          <TextField.Root
            placeholder="Tiêu đề (bắt buộc)"
            value={tieuDe}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTieuDe(e.target.value)}
          />
          <TextArea
            placeholder="Nội dung nguồn (bắt buộc)"
            rows={4}
            value={noiDung}
            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setNoiDung(e.target.value)}
          />
          {dsLoi.length > 0 && (
            <Callout.Root color="red">
              {dsLoi.map((l, i) => (
                <Callout.Text key={i}>{l}</Callout.Text>
              ))}
            </Callout.Root>
          )}
          <Flex justify="end">
            <Button onClick={gui} disabled={dangGui}>
              Tạo nguồn
            </Button>
          </Flex>
        </Flex>
      </Card>
      <TrangThai loading={loading} error={error} empty={data?.length === 0}>
        <Table.Root>
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeaderCell>Tiêu đề</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>Loại</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>Tạo lúc</Table.ColumnHeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {data?.map((n) => (
              <Table.Row key={n.id}>
                <Table.Cell>{n.tieu_de}</Table.Cell>
                <Table.Cell>{n.loai}</Table.Cell>
                <Table.Cell>{fmtLuc(n.tao_luc)}</Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Root>
      </TrangThai>
    </>
  );
}
