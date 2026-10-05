import {
  Badge,
  Button,
  Callout,
  Card,
  Flex,
  Heading,
  Table,
  Text,
  TextArea,
  TextField,
} from "@radix-ui/themes";
import { useEffect, useRef, useState } from "react";
import { api, fmtLuc, LoiApiClient, useApi } from "../api.ts";
import { TrangThai } from "../components/TrangThai.tsx";
import type { Nguon, NguonRevision } from "../../modules/content/index.ts";
import type { Asset } from "../../modules/nap/index.ts";

type KetQuaNap = { nguon: Nguon; revision: { id: string; so_thu_tu: number } };
type KetQuaUpload = Asset & { nguon: Nguon | null };

// GET /api/nguon/:id trả kèm revision + detection (#14) + số task mở.
type ThayDoiToc = {
  id: string;
  loai: string;
  tao_luc: string;
  ds_thay_doi: { tieu_de: string; loai_thay_doi: string }[];
};
type NguonChiTiet = Nguon & {
  revisions: NguonRevision[];
  ds_thay_doi: ThayDoiToc[];
  so_task_mo: number;
};

// Chi tiết một nguồn (#/nguon?id=): mục fact/section, form sửa tạo revision
// mới (server chạy phát hiện phụ thuộc ngay), lịch sử revision + detection.
function ChiTietNguon({ id, quayLai }: { id: string; quayLai: () => void }) {
  const chiTiet = useApi<NguonChiTiet>(`/api/nguon/${id}`, [id]);
  const [tieuDe, setTieuDe] = useState("");
  const [noiDung, setNoiDung] = useState("");
  const [cacMucJson, setCacMucJson] = useState("");
  const [dsLoi, setDsLoi] = useState<string[]>([]);
  const [thongBao, setThongBao] = useState("");
  const [dangGui, setDangGui] = useState(false);
  const daNap = useRef<string | null>(null);

  // Nạp form từ head một lần cho mỗi nguồn — sửa tay không bị reload đè.
  useEffect(() => {
    const n = chiTiet.data;
    if (n && daNap.current !== n.id) {
      daNap.current = n.id;
      setTieuDe(n.tieu_de);
      setNoiDung(n.noi_dung);
      setCacMucJson(n.cac_muc.length > 0 ? JSON.stringify(n.cac_muc, null, 2) : "");
    }
  }, [chiTiet.data]);

  async function sua() {
    const n = chiTiet.data;
    if (!n?.head_revision_id) return;
    setDangGui(true);
    setDsLoi([]);
    setThongBao("");
    let cacMuc: unknown;
    if (cacMucJson.trim()) {
      try {
        cacMuc = JSON.parse(cacMucJson);
      } catch {
        setDsLoi(["cac_muc không phải JSON hợp lệ."]);
        setDangGui(false);
        return;
      }
    }
    try {
      const kq = await api<Nguon & { phat_hien: { thay_doi: { id: string } | null; ds_task: unknown[] } | null }>(
        `/api/nguon/${n.id}`,
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            tieu_de: tieuDe,
            noi_dung: noiDung,
            loai: n.loai,
            cac_muc: cacMuc,
            dua_tren_revision_id: n.head_revision_id,
          }),
        },
      );
      const ph = kq.phat_hien;
      setThongBao(
        ph?.thay_doi
          ? `Đã ghi revision mới — phát hiện ${ph.ds_task.length} đầu ra bị ảnh hưởng.`
          : "Đã ghi revision mới — không có thay đổi phụ thuộc nào.",
      );
      chiTiet.reload();
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
      <Flex align="center" gap="2" mb="3">
        <Button variant="soft" size="1" onClick={quayLai}>
          ← Danh sách nguồn
        </Button>
        <Heading size="5">{chiTiet.data?.tieu_de ?? "…"}</Heading>
        <Badge variant="outline">{chiTiet.data?.loai}</Badge>
        {(chiTiet.data?.so_task_mo ?? 0) > 0 && (
          <Badge color="orange">{chiTiet.data!.so_task_mo} task sửa mở</Badge>
        )}
      </Flex>
      <TrangThai loading={chiTiet.loading} error={chiTiet.error}>
        {chiTiet.data && (
          <Flex direction="column" gap="4">
            <Card>
              <Heading size="3" mb="2">
                Sửa nguồn — tạo revision mới
              </Heading>
              <Flex direction="column" gap="2">
                <TextField.Root
                  value={tieuDe}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTieuDe(e.target.value)}
                />
                <TextArea
                  rows={4}
                  value={noiDung}
                  onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
                    setNoiDung(e.target.value)
                  }
                />
                <Text size="1" color="gray">
                  cac_muc (JSON) — sửa giá trị fact ở đây để phát hiện phụ thuộc theo mục:
                </Text>
                <TextArea
                  rows={6}
                  value={cacMucJson}
                  onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
                    setCacMucJson(e.target.value)
                  }
                  style={{ fontFamily: "var(--code-font-family, monospace)" }}
                />
                {thongBao && (
                  <Callout.Root color="green">
                    <Callout.Text>{thongBao}</Callout.Text>
                  </Callout.Root>
                )}
                {dsLoi.length > 0 && (
                  <Callout.Root color="red">
                    {dsLoi.map((l, i) => (
                      <Callout.Text key={i}>{l}</Callout.Text>
                    ))}
                  </Callout.Root>
                )}
                <Flex justify="end">
                  <Button onClick={() => void sua()} disabled={dangGui}>
                    {dangGui ? "Đang lưu…" : "Lưu revision mới"}
                  </Button>
                </Flex>
              </Flex>
            </Card>

            <Card>
              <Heading size="3" mb="2">
                Thay đổi đã phát hiện ({chiTiet.data.ds_thay_doi.length})
              </Heading>
              {chiTiet.data.ds_thay_doi.length === 0 ? (
                <Text size="2" color="gray">
                  Chưa có detection nào — chỉ ghi sau khi có revision thứ hai trở lên.
                </Text>
              ) : (
                <Table.Root>
                  <Table.Header>
                    <Table.Row>
                      <Table.ColumnHeaderCell>Phát hiện lúc</Table.ColumnHeaderCell>
                      <Table.ColumnHeaderCell>Số mục đổi</Table.ColumnHeaderCell>
                      <Table.ColumnHeaderCell />
                    </Table.Row>
                  </Table.Header>
                  <Table.Body>
                    {chiTiet.data.ds_thay_doi.map((d) => (
                      <Table.Row key={d.id}>
                        <Table.Cell>{fmtLuc(d.tao_luc)}</Table.Cell>
                        <Table.Cell>{d.ds_thay_doi.length}</Table.Cell>
                        <Table.Cell>
                          <a href={`#/thay-doi?id=${d.id}`}>Xem đầu ra bị ảnh hưởng</a>
                        </Table.Cell>
                      </Table.Row>
                    ))}
                  </Table.Body>
                </Table.Root>
              )}
            </Card>

            <Card>
              <Heading size="3" mb="2">
                Revision ({chiTiet.data.revisions.length})
              </Heading>
              <Table.Root>
                <Table.Header>
                  <Table.Row>
                    <Table.ColumnHeaderCell>#</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>Tạo bởi</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>Tạo lúc</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>Head</Table.ColumnHeaderCell>
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {chiTiet.data.revisions.map((r) => (
                    <Table.Row key={r.id}>
                      <Table.Cell>{r.so_thu_tu}</Table.Cell>
                      <Table.Cell>{r.tao_boi}</Table.Cell>
                      <Table.Cell>{fmtLuc(r.tao_luc)}</Table.Cell>
                      <Table.Cell>
                        {r.id === chiTiet.data!.head_revision_id && (
                          <Badge color="green">head</Badge>
                        )}
                      </Table.Cell>
                    </Table.Row>
                  ))}
                </Table.Body>
              </Table.Root>
            </Card>
          </Flex>
        )}
      </TrangThai>
    </>
  );
}

export default function NguonPage() {
  const { data, loading, error, reload } = useApi<Nguon[]>("/api/nguon");
  const [chon, setChon] = useState<string | null>(
    () => window.location.hash.match(/[?&]id=([^&]+)/)?.[1] ?? null,
  );
  const [tieuDe, setTieuDe] = useState("");
  const [noiDung, setNoiDung] = useState("");
  const [dsLoi, setDsLoi] = useState<string[]>([]);
  const [dangGui, setDangGui] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [dsLoiFile, setDsLoiFile] = useState<string[]>([]);
  const [dangTai, setDangTai] = useState(false);
  // Khóa idem giữ nguyên suốt một lần điền form — retry/double-click không
  // tạo nguồn trùng; reset sau khi gửi thành công.
  const khoaRef = useRef<string>(`ui-${crypto.randomUUID()}`);

  useEffect(() => {
    const doc = () => {
      const m = window.location.hash.match(/[?&]id=([^&]+)/);
      setChon(m?.[1] ?? null);
    };
    window.addEventListener("hashchange", doc);
    return () => window.removeEventListener("hashchange", doc);
  }, []);

  // Dán text → endpoint nạp (#17): tự chuẩn hóa cac_muc, khoa_idem chặn
  // retry tạo nguồn trùng.
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
          khoa_idem: khoaRef.current,
        }),
      });
      setTieuDe("");
      setNoiDung("");
      khoaRef.current = `ui-${crypto.randomUUID()}`;
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
        `/api/assets?ten=${encodeURIComponent(tep.name)}&tieu_de=${encodeURIComponent(tieuDe || tep.name)}&khoa_idem=${encodeURIComponent(`file:${tep.name}:${tep.size}:${tep.lastModified}`)}`,
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

  if (chon) {
    return (
      <ChiTietNguon
        id={chon}
        quayLai={() => {
          window.location.hash = "/nguon";
          setChon(null);
          reload();
        }}
      />
    );
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
              <Table.Row
                key={n.id}
                onClick={() => {
                  window.location.hash = `/nguon?id=${n.id}`;
                  setChon(n.id);
                }}
                style={{ cursor: "pointer" }}
              >
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
