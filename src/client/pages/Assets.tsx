import { Badge, Button, Callout, Card, Checkbox, Flex, Heading, Link, Table, Text } from "@radix-ui/themes";
import { useRef, useState } from "react";
import { api, fmtLuc, LoiApiClient, useApi } from "../api.ts";
import { TrangThai } from "../components/TrangThai.tsx";
import type { Asset } from "../../modules/nap/index.ts";

// Trang Asset (#17): xem trước/tải, lưu trữ, xóa. Upload text cũng nằm
// ở đây — file .txt/.md đi thẳng thành nguồn qua cùng endpoint.
export default function AssetsPage() {
  const [hienLuuTru, setHienLuuTru] = useState(false);
  const { data, loading, error, reload } = useApi<Asset[]>(
    `/api/assets?trang_thai=${hienLuuTru ? "tat_ca" : "hoat_dong"}`,
  );
  const fileRef = useRef<HTMLInputElement>(null);
  const [ghiChu, setGhiChu] = useState("");
  const [dsLoi, setDsLoi] = useState<string[]>([]);
  const [dangTai, setDangTai] = useState(false);

  async function taiLen() {
    const tep = fileRef.current?.files?.[0];
    if (!tep) {
      setDsLoi(["Chọn một file trước."]);
      return;
    }
    setDangTai(true);
    setDsLoi([]);
    try {
      let q = `ten=${encodeURIComponent(tep.name)}`;
      if (ghiChu) q += `&ghi_chu=${encodeURIComponent(ghiChu)}`;
      await api(`/api/assets?${q}`, { method: "POST", body: tep });
      if (fileRef.current) fileRef.current.value = "";
      setGhiChu("");
      reload();
    } catch (e) {
      if (e instanceof LoiApiClient) {
        setDsLoi([e.message, ...(Array.isArray(e.chiTiet) ? e.chiTiet.map(String) : [])]);
      } else {
        setDsLoi([String(e)]);
      }
    } finally {
      setDangTai(false);
    }
  }

  async function hanhDong(id: string, f: () => Promise<unknown>) {
    setDsLoi([]);
    try {
      await f();
      reload();
    } catch (e) {
      // 409 = asset đang được tham chiếu → hướng dẫn lưu trữ thay vì xóa.
      if (e instanceof LoiApiClient) {
        setDsLoi([e.message]);
      } else {
        setDsLoi([String(e)]);
      }
    }
  }

  return (
    <>
      <Heading mb="3">Asset</Heading>
      <Card mb="4">
        <Flex direction="column" gap="3">
          <input ref={fileRef} type="file" accept=".txt,.md,.png,.jpg,.jpeg,.webp,.gif" />
          <input
            placeholder="Ghi chú attribution/quyền (tùy chọn)"
            value={ghiChu}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setGhiChu(e.target.value)}
          />
          {dsLoi.length > 0 && (
            <Callout.Root color="red">
              {dsLoi.map((l, i) => (
                <Callout.Text key={i}>{l}</Callout.Text>
              ))}
            </Callout.Root>
          )}
          <Flex justify="end">
            <Button onClick={taiLen} disabled={dangTai}>
              Tải lên
            </Button>
          </Flex>
        </Flex>
      </Card>
      <Flex align="center" gap="2" mb="2">
        <Checkbox checked={hienLuuTru} onCheckedChange={(v) => setHienLuuTru(v === true)} />
        <Text size="2">Hiện cả asset đã lưu trữ</Text>
      </Flex>
      <TrangThai loading={loading} error={error} empty={data?.length === 0}>
        <Table.Root>
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeaderCell>Tên file</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>Loại</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>Kích thước</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>Trạng thái</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>Ghi chú</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>Tạo lúc</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell></Table.ColumnHeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {data?.map((a) => (
              <Table.Row key={a.id}>
                <Table.Cell>
                  <Link href={`/api/assets/${a.id}/noi-dung`} target="_blank">
                    {a.ten_file}
                  </Link>
                </Table.Cell>
                <Table.Cell>{a.loai === "hinh_anh" ? "hình ảnh" : "văn bản"}</Table.Cell>
                <Table.Cell>{fmtKichThuoc(a.kich_thuoc)}</Table.Cell>
                <Table.Cell>
                  <Badge color={a.trang_thai === "hoat_dong" ? "green" : "gray"}>
                    {a.trang_thai === "hoat_dong" ? "hoạt động" : "lưu trữ"}
                  </Badge>
                </Table.Cell>
                <Table.Cell>{a.ghi_chu ?? ""}</Table.Cell>
                <Table.Cell>{fmtLuc(a.tao_luc)}</Table.Cell>
                <Table.Cell>
                  <Flex gap="2">
                    {a.trang_thai === "hoat_dong" && (
                      <Button
                        size="1"
                        variant="soft"
                        onClick={() =>
                          hanhDong(a.id, () => api(`/api/assets/${a.id}/luu-tru`, { method: "POST" }))
                        }
                      >
                        Lưu trữ
                      </Button>
                    )}
                    <Button
                      size="1"
                      variant="soft"
                      color="red"
                      onClick={() => hanhDong(a.id, () => api(`/api/assets/${a.id}`, { method: "DELETE" }))}
                    >
                      Xóa
                    </Button>
                  </Flex>
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Root>
      </TrangThai>
    </>
  );
}

function fmtKichThuoc(n: number): string {
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${n} B`;
}
