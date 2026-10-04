import { Badge, Button, Callout, Card, Checkbox, Flex, Grid, Heading, Table, Text, TextArea } from "@radix-ui/themes";
import { useEffect, useState } from "react";
import { api, fmtLuc, LoiApiClient, useApi } from "../api.ts";
import { TrangThai } from "../components/TrangThai.tsx";
import type { BanTheHien, Revision, XuatBan } from "../../modules/content/index.ts";
import type { ContextSinhSnapshot } from "../../modules/context/index.ts";
import type { Asset } from "../../modules/nap/index.ts";

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
type ChiTiet = BanTheHien & {
  revisions: RevisionKemContext[];
  assets: Asset[];
  ds_xuat_ban: XuatBan[];
};

// Kết quả GET /api/ban-the-hien/:id/xem-truoc (#19): nội dung đã render
// sang markdown/text/HTML an toàn + lỗi field theo schema định dạng.
type KetQuaXemTruoc = {
  revision_id: string | null;
  dinh_dang: string;
  phien_ban_dinh_dang: number;
  html: string;
  markdown: string;
  text: string;
  ds_loi: { truong: string; loi: string }[];
};

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
  const dsAsset = useApi<Asset[]>("/api/assets");
  const [dsAssetChon, setDsAssetChon] = useState<string[]>([]);
  const [xemTruoc, setXemTruoc] = useState<{ revId: string; kq: KetQuaXemTruoc } | null>(null);
  const [dsCanhBao, setDsCanhBao] = useState<string[]>([]);

  async function taiXemTruoc(revisionId: string) {
    if (!chiTiet.data) return;
    setDsLoi([]);
    try {
      const kq = await api<KetQuaXemTruoc>(
        `/api/ban-the-hien/${chiTiet.data.id}/xem-truoc?revision_id=${revisionId}`,
      );
      setXemTruoc({ revId: revisionId, kq });
    } catch (e) {
      setDsLoi([e instanceof LoiApiClient ? `${e.ma}: ${e.message}` : String(e)]);
    }
  }

  // Đồng bộ checkbox với danh sách asset đang đính kèm mỗi khi đổi bản thể
  // hiện hoặc khi server trả tập asset khác (reload, client khác sửa).
  const khoaAssetServer = chiTiet.data?.assets.map((a) => a.id).join(",") ?? "";
  useEffect(() => {
    setDsAssetChon(khoaAssetServer ? khoaAssetServer.split(",") : []);
  }, [khoaAssetServer]);

  async function themRev() {
    if (!chiTiet.data) return;
    setDangGui(true);
    setDsLoi([]);
    try {
      const rev = await api<Revision & { ds_loi_dinh_dang?: { truong: string; loi: string }[] }>(
        `/api/ban-the-hien/${chiTiet.data.id}/revision`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            noi_dung: noiDung,
            dua_tren_revision_id: chiTiet.data.head_revision_id,
          }),
        },
      );
      // Lỗi field định dạng từ server → cảnh báo để sửa, không chặn lưu (#19).
      setDsCanhBao(rev.ds_loi_dinh_dang?.map((l) => `${l.truong}: ${l.loi}`) ?? []);
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
                    setDsCanhBao([]);
                    setXemTruoc(null);
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
                      <Flex justify="end" mt="2">
                        <Button
                          variant="soft"
                          size="1"
                          onClick={() =>
                            xemTruoc?.revId === r.id ? setXemTruoc(null) : taiXemTruoc(r.id)
                          }
                        >
                          {xemTruoc?.revId === r.id ? "Đóng xem trước" : "Xem trước"}
                        </Button>
                      </Flex>
                      {xemTruoc?.revId === r.id && (
                        <Flex direction="column" gap="2" mt="2">
                          {xemTruoc.kq.ds_loi.length > 0 && (
                            <Callout.Root color="amber" size="1">
                              {xemTruoc.kq.ds_loi.map((l, i) => (
                                <Callout.Text key={i}>
                                  {l.truong}: {l.loi}
                                </Callout.Text>
                              ))}
                            </Callout.Root>
                          )}
                          <div
                            style={{
                              border: "1px solid var(--gray-5)",
                              borderRadius: 8,
                              padding: "8px 12px",
                            }}
                            // HTML đã escape + whitelist từ renderer server (#19).
                            dangerouslySetInnerHTML={{ __html: xemTruoc.kq.html }}
                          />
                          <details>
                            <summary>Markdown / text</summary>
                            <pre style={{ whiteSpace: "pre-wrap", fontSize: 12 }}>
                              {xemTruoc.kq.markdown}
                            </pre>
                            <pre style={{ whiteSpace: "pre-wrap", fontSize: 12 }}>
                              {xemTruoc.kq.text}
                            </pre>
                          </details>
                        </Flex>
                      )}
                    </Card>
                  ))}
                  <Text size="2" weight="bold">
                    Asset đính kèm
                  </Text>
                  {(dsAsset.data ?? []).length === 0 && (
                    <Text size="1" color="gray">
                      Chưa có asset — tải lên ở trang Asset.
                    </Text>
                  )}
                  {dsAsset.data?.map((a) => (
                    <Flex key={a.id} align="center" gap="2">
                      <Checkbox
                        checked={dsAssetChon.includes(a.id)}
                        onCheckedChange={(v) =>
                          setDsAssetChon((ds) =>
                            v === true ? [...ds, a.id] : ds.filter((id) => id !== a.id),
                          )
                        }
                      />
                      {a.loai === "hinh_anh" && (
                        <img
                          src={`/api/assets/${a.id}/noi-dung`}
                          alt={a.ten_file}
                          style={{ width: 32, height: 32, objectFit: "cover", borderRadius: 4 }}
                        />
                      )}
                      <Text size="2">
                        {a.ten_file} ({a.loai === "hinh_anh" ? "ảnh" : "văn bản"})
                      </Text>
                    </Flex>
                  ))}
                  <Flex justify="end">
                    <Button
                      variant="soft"
                      size="1"
                      onClick={async () => {
                        if (!chiTiet.data) return;
                        setDsLoi([]);
                        try {
                          await api(`/api/ban-the-hien/${chiTiet.data.id}/assets`, {
                            method: "PUT",
                            headers: { "content-type": "application/json" },
                            body: JSON.stringify({ asset_ids: dsAssetChon }),
                          });
                          chiTiet.reload();
                        } catch (e) {
                          if (e instanceof LoiApiClient) {
                            setDsLoi([e.message]);
                          } else {
                            setDsLoi([String(e)]);
                          }
                        }
                      }}
                    >
                      Lưu đính kèm
                    </Button>
                  </Flex>
                  {(chiTiet.data.ds_xuat_ban ?? []).length > 0 && (
                    <>
                      <Text size="2" weight="bold">
                        Bản đã xuất bản
                      </Text>
                      {chiTiet.data.ds_xuat_ban.map((x) => (
                        <Flex key={x.id} align="center" gap="2">
                          <Text size="2" style={{ flex: 1 }}>
                            {x.dich_den || "—"} — {fmtLuc(x.tao_luc)}
                          </Text>
                          <Button
                            variant="soft"
                            size="1"
                            onClick={() =>
                              window.open(
                                `/api/ban-the-hien/${chiTiet.data!.id}/xuat-ban/${x.id}/tai-ve`,
                                "_blank",
                              )
                            }
                          >
                            Tải bundle
                          </Button>
                        </Flex>
                      ))}
                    </>
                  )}
                  {dsCanhBao.length > 0 && (
                    <Callout.Root color="amber">
                      {dsCanhBao.map((l, i) => (
                        <Callout.Text key={i}>{l}</Callout.Text>
                      ))}
                    </Callout.Root>
                  )}
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
