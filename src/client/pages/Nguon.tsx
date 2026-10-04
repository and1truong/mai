import { Button, Callout, Card, Flex, Heading, Table, Text, TextArea, TextField } from "@radix-ui/themes";
import { useRef, useState } from "react";
import { api, fmtLuc, LoiApiClient, useApi } from "../api.ts";
import { TrangThai } from "../components/TrangThai.tsx";
import type { Nguon } from "../../modules/content/index.ts";
import type { Asset } from "../../modules/nap/index.ts";

type KetQuaNap = { nguon: Nguon; revision: { id: string; so_thu_tu: number } };
type KetQuaUpload = Asset & { nguon: Nguon | null };

export default function NguonPage() {
  const { data, loading, error, reload } = useApi<Nguon[]>("/api/nguon");
  const [tieuDe, setTieuDe] = useState("");
  const [noiDung, setNoiDung] = useState("");
  const [dsLoi, setDsLoi] = useState<string[]>([]);
  const [dangGui, setDangGui] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [dsLoiFile, setDsLoiFile] = useState<string[]>([]);
  const [dangTai, setDangTai] = useState(false);

  // Dán text → endpoint nạp (#17): tự chuẩn hóa cac_muc, khoa_idem chặn
  // double-click tạo nguồn trùng.
  async function gui() {
    setDangGui(true);
    setDsLoi([]);
    try {
      await api<KetQuaNap>("/api/nguon/nhap", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tieu_de: tieuDe,
          noi_dung: noiDung,
          khoa_idem: `ui-${crypto.randomUUID()}`,
        }),
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

  // Upload .txt/.md → server tự tạo nguồn (và ghi asset liên kết);
  // ảnh → chỉ tạo asset, quản lý ở trang Asset.
  async function taiLen() {
    const tep = fileRef.current?.files?.[0];
    if (!tep) {
      setDsLoiFile(["Chọn một file .txt/.md/ảnh trước."]);
      return;
    }
    setDangTai(true);
    setDsLoiFile([]);
    try {
      await api<KetQuaUpload>(
        `/api/assets?ten=${encodeURIComponent(tep.name)}&tieu_de=${encodeURIComponent(tieuDe || tep.name)}`,
        { method: "POST", body: tep },
      );
      if (fileRef.current) fileRef.current.value = "";
      reload();
    } catch (e) {
      if (e instanceof LoiApiClient) {
        setDsLoiFile([e.message, ...(Array.isArray(e.chiTiet) ? e.chiTiet.map(String) : [])]);
      } else {
        setDsLoiFile([String(e)]);
      }
    } finally {
      setDangTai(false);
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
            placeholder="Nội dung nguồn — Markdown được tách thành mục theo heading"
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
              Nạp text
            </Button>
          </Flex>
        </Flex>
      </Card>
      <Card mb="4">
        <Flex direction="column" gap="3">
          <Text size="2" weight="bold">
            Tải file nguồn / asset
          </Text>
          <Text size="1" color="gray">
            .txt/.md → tạo nguồn mới và lưu file gốc làm asset; .png/.jpg/.webp/.gif → lưu asset.
          </Text>
          <input ref={fileRef} type="file" accept=".txt,.md,.png,.jpg,.jpeg,.webp,.gif" />
          {dsLoiFile.length > 0 && (
            <Callout.Root color="red">
              {dsLoiFile.map((l, i) => (
                <Callout.Text key={i}>{l}</Callout.Text>
              ))}
            </Callout.Root>
          )}
          <Flex justify="end">
            <Button variant="soft" onClick={taiLen} disabled={dangTai}>
              Tải lên
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
              <Table.ColumnHeaderCell>Số mục</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>Tạo lúc</Table.ColumnHeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {data?.map((n) => (
              <Table.Row key={n.id}>
                <Table.Cell>{n.tieu_de}</Table.Cell>
                <Table.Cell>{n.loai}</Table.Cell>
                <Table.Cell>{n.cac_muc.length}</Table.Cell>
                <Table.Cell>{fmtLuc(n.tao_luc)}</Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Root>
      </TrangThai>
    </>
  );
}
