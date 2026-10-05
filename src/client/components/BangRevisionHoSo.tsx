import { Badge, Table, Text } from "@radix-ui/themes";
import { fmtLuc, useApi } from "../api.ts";
import { TrangThai } from "./TrangThai.tsx";
import { NHAN_NGUON_DU_LIEU } from "./hoSo.ts";
import type { HoSoRevision } from "../../modules/context/index.ts";

// Bảng revision của một hồ sơ (thương hiệu hoặc đối tượng). Snapshot mở bằng <details>.
export function BangRevisionHoSo({ duongDan }: { duongDan: string | null }) {
  const { data, loading, error } = useApi<HoSoRevision[]>(duongDan, [duongDan]);
  if (!duongDan) return null;
  return (
    <TrangThai loading={loading} error={error} empty={data?.length === 0}>
      <Table.Root size="1">
        <Table.Header>
          <Table.Row>
            <Table.ColumnHeaderCell>#</Table.ColumnHeaderCell>
            <Table.ColumnHeaderCell>Nguồn dữ liệu</Table.ColumnHeaderCell>
            <Table.ColumnHeaderCell>Lúc</Table.ColumnHeaderCell>
            <Table.ColumnHeaderCell>Bởi</Table.ColumnHeaderCell>
            <Table.ColumnHeaderCell>Snapshot</Table.ColumnHeaderCell>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {data?.map((r) => (
            <Table.Row key={r.id}>
              <Table.Cell>{r.so_thu_tu}</Table.Cell>
              <Table.Cell>
                <Badge color={r.nguon_du_lieu === "he_thong" ? "blue" : "gray"}>
                  {NHAN_NGUON_DU_LIEU[r.nguon_du_lieu] ?? r.nguon_du_lieu}
                </Badge>
              </Table.Cell>
              <Table.Cell>{fmtLuc(r.tao_luc)}</Table.Cell>
              <Table.Cell>{r.tao_boi}</Table.Cell>
              <Table.Cell>
                <details>
                  <summary>
                    <Text size="1">xem</Text>
                  </summary>
                  <pre style={{ whiteSpace: "pre-wrap", fontSize: 11, maxWidth: 420 }}>
                    {JSON.stringify(JSON.parse(r.snapshot), null, 2)}
                  </pre>
                </details>
              </Table.Cell>
            </Table.Row>
          ))}
        </Table.Body>
      </Table.Root>
    </TrangThai>
  );
}
