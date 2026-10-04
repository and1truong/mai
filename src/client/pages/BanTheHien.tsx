import { Badge, Button, Callout, Card, Flex, Grid, Heading, Table, Text, TextArea } from "@radix-ui/themes";
import { useState } from "react";
import { api, fmtLuc, LoiApiClient, useApi } from "../api.ts";
import { TrangThai } from "../components/TrangThai.tsx";
import type { BanTheHien, Revision } from "../../modules/content/index.ts";
import type { ContextSinhSnapshot } from "../../modules/context/index.ts";

// API trả context_sinh đã parse: ghi_de/snapshot là object, không phải chuỗi.
type ContextSinhDaDoc = {
  id: string;
  thuong_hieu_id: string | null;
  doi_tuong_id: string | null;
  ghi_de: unknown;
  snapshot: ContextSinhSnapshot;
  tao_luc: string;
};

type RevisionKemContext = Revision & { context_sinh: ContextSinhDaDoc | null };
type ChiTiet = BanTheHien & { revisions: RevisionKemContext[] };

function moTaContextSinh(cs: ContextSinhDaDoc): string {
  const th = cs.snapshot.thuong_hieu?.ten ?? "—";
  const dt = cs.snapshot.doi_tuong?.ten ?? "—";
  return `thương hiệu: ${th} · đối tượng: ${dt}`;
}

const MAU_TRANG_THAI: Record<string, "gray" | "blue" | "green" | "red"> = {
  nhap: "gray",
  cho_duyet: "blue",
  da_duyet: "green",
  tu_choi: "red",
};

export default function BanTheHienPage() {
  const ds = useApi<BanTheHien[]>("/api/ban-the-hien");
  const [chon, setChon] = useState<string | null>(null);
  const chiTiet = useApi<ChiTiet>(chon ? `/api/ban-the-hien/${chon}` : null, [chon]);
  const [noiDung, setNoiDung] = useState("");
  const [dsLoi, setDsLoi] = useState<string[]>([]);
  const [dangGui, setDangGui] = useState(false);

  async function themRev() {
    if (!chiTiet.data) return;
    setDangGui(true);
    setDsLoi([]);
    try {
      await api(`/api/ban-the-hien/${chiTiet.data.id}/revision`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          noi_dung: noiDung,
          dua_tren_revision_id: chiTiet.data.head_revision_id,
        }),
      });
      setNoiDung("");
      chiTiet.reload();
      ds.reload();
    } catch (e) {
      if (e instanceof LoiApiClient) {
        setDsLoi([`${e.ma}: ${e.message}`]);
      } else {
        setDsLoi([String(e)]);
      }
    } finally {
      setDangGui(false);
    }
  }

  return (
    <>
      <Heading mb="3">Bản thể hiện</Heading>
      <Grid columns={{ initial: "1", md: "2" }} gap="4">
        <TrangThai loading={ds.loading} error={ds.error} empty={ds.data?.length === 0}>
          <Table.Root>
            <Table.Header>
              <Table.Row>
                <Table.ColumnHeaderCell>Định dạng</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>Đối tượng</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>Trạng thái</Table.ColumnHeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {ds.data?.map((b) => (
                <Table.Row
                  key={b.id}
                  onClick={() => {
                    setChon(b.id);
                    setDsLoi([]);
                  }}
                  style={{ cursor: "pointer", background: chon === b.id ? "var(--accent-3)" : undefined }}
                >
                  <Table.Cell>{b.dinh_dang}</Table.Cell>
                  <Table.Cell>{b.doi_tuong || "—"}</Table.Cell>
                  <Table.Cell>
                    <Badge color={MAU_TRANG_THAI[b.trang_thai] ?? "gray"}>{b.trang_thai}</Badge>
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table.Root>
        </TrangThai>

        <Card>
          {!chon && <Text color="gray">Chọn một bản thể hiện để xem revision.</Text>}
          {chon && (
            <TrangThai loading={chiTiet.loading} error={chiTiet.error}>
              {chiTiet.data && (
                <Flex direction="column" gap="3">
                  <Flex align="center" gap="2">
                    <Heading size="4">{chiTiet.data.dinh_dang}</Heading>
                    <Badge color={MAU_TRANG_THAI[chiTiet.data.trang_thai] ?? "gray"}>
                      {chiTiet.data.trang_thai}
                    </Badge>
                  </Flex>
                  {chiTiet.data.revisions.map((r) => (
                    <Card key={r.id} variant="surface">
                      <Text size="1" color="gray">
                        Revision {r.so_thu_tu} — {fmtLuc(r.tao_luc)} — {r.tao_boi}
                      </Text>
                      {r.context_sinh && (
                        <Text size="1" color="gray" as="p">
                          Context sinh: {moTaContextSinh(r.context_sinh)}{" "}
                          <details style={{ display: "inline" }}>
                            <summary>xem snapshot</summary>
                            <pre style={{ whiteSpace: "pre-wrap", fontSize: 11 }}>
                              {JSON.stringify(r.context_sinh.snapshot, null, 2)}
                            </pre>
                          </details>
                        </Text>
                      )}
                      <pre style={{ whiteSpace: "pre-wrap", margin: "8px 0 0", fontSize: 13 }}>
                        {r.noi_dung}
                      </pre>
                    </Card>
                  ))}
                  <Text size="2" weight="bold">
                    Thêm revision
                  </Text>
                  <TextArea
                    placeholder="Nội dung revision mới (dựa trên head hiện tại)"
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
                    <Button onClick={themRev} disabled={dangGui}>
                      Lưu revision
                    </Button>
                  </Flex>
                </Flex>
              )}
            </TrangThai>
          )}
        </Card>
      </Grid>
    </>
  );
}
