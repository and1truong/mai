import { Badge, Button, Callout, Card, Flex, Heading, Table, Text } from "@radix-ui/themes";
import { useEffect, useState } from "react";
import { api, fmtLuc, LoiApiClient, useApi } from "../api.ts";
import { TrangThai } from "../components/TrangThai.tsx";

// Trang review thay đổi nguồn (#14): một detection = một revision nguồn/hồ
// sơ mới + các task sửa cho đầu ra phụ thuộc. Nút action gọi endpoint task
// — đề xuất sửa enqueue job sinh lại; task thủ công người dùng đóng tay.

type MucThayDoi = {
  muc_id: string | null;
  loai_muc: string;
  loai_thay_doi: "sua" | "xoa" | "them";
  tieu_de: string;
  cu: string;
  moi: string;
};

type ThayDoi = {
  id: string;
  loai: "nguon" | "thuong_hieu" | "doi_tuong";
  entity_id: string;
  tu_revision_id: string;
  den_revision_id: string;
  ds_thay_doi: MucThayDoi[];
  tao_luc: string;
  tao_boi: string;
  so_task_mo?: number;
  ten_entity?: string;
};

type BthToc = {
  id: string;
  dinh_dang: string;
  doi_tuong: string;
  trang_thai: string;
  thong_diep_id: string;
  thong_diep_tieu_de?: string;
  url_trang?: string;
  so_xuat_ban?: number;
};

type TaskSua = {
  id: string;
  thay_doi_nguon_id: string;
  ban_the_hien_id: string;
  loai: "sinh_lai" | "thu_cong";
  do_tin: "chinh_xac" | "khong_chac";
  ly_do: string;
  ds_muc: MucThayDoi[];
  trang_thai: string;
  job_id: string | null;
  tao_luc: string;
  cap_nhat_luc: string;
  ban_the_hien: BthToc | null;
  thay_doi_nguon: { id: string; loai: string; entity_id: string; tao_luc: string } | null;
};

const NHAN_LOAI: Record<string, string> = {
  nguon: "Nguồn",
  thuong_hieu: "Thương hiệu",
  doi_tuong: "Đối tượng",
};

const NHAN_TASK: Record<string, string> = {
  sinh_lai: "Sinh lại",
  thu_cong: "Sửa tay",
};

const NHAN_TT_TASK: Record<string, string> = {
  mo: "Mở",
  dang_lam: "Đang xử lý",
  xong: "Xong",
  bo_qua: "Bỏ qua",
};

const MAU_TT_TASK: Record<string, "blue" | "green" | "gray" | "orange"> = {
  mo: "orange",
  dang_lam: "blue",
  xong: "green",
  bo_qua: "gray",
};

const NHAN_DIFF: Record<string, string> = { sua: "Sửa", them: "Thêm", xoa: "Xóa" };
const MAU_DIFF: Record<string, "amber" | "green" | "red"> = {
  sua: "amber",
  them: "green",
  xoa: "red",
};

function MoTaBth(b: BthToc | null): string {
  if (!b) return "—";
  const dt = b.doi_tuong || "chung";
  return `${b.dinh_dang} · ${dt}`;
}

// Hàng action theo loại + trạng thái task. sauLam() reload lại list.
function NutTask({ task, sauLam }: { task: TaskSua; sauLam: () => void }) {
  const [dangGui, setDangGui] = useState(false);
  const [loi, setLoi] = useState("");
  async function goi(path: string, body?: unknown) {
    setDangGui(true);
    setLoi("");
    try {
      await api(`/api/task-sua/${task.id}/${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body ?? {}),
      });
      sauLam();
    } catch (e) {
      setLoi(e instanceof LoiApiClient ? `${e.ma}: ${e.message}` : String(e));
    } finally {
      setDangGui(false);
    }
  }
  return (
    <Flex gap="2" align="center" wrap="wrap">
      {task.loai === "sinh_lai" && task.trang_thai === "mo" && (
        <Button size="1" onClick={() => void goi("de-xuat")} disabled={dangGui}>
          Đề xuất sửa
        </Button>
      )}
      {task.loai === "thu_cong" && (task.trang_thai === "mo" || task.trang_thai === "dang_lam") && (
        <Button
          size="1"
          color="green"
          variant="soft"
          onClick={() => void goi("trang-thai", { trang_thai: "xong" })}
          disabled={dangGui}
        >
          Đã sửa tay
        </Button>
      )}
      {task.trang_thai === "mo" && (
        <Button
          size="1"
          variant="soft"
          color="gray"
          onClick={() => void goi("trang-thai", { trang_thai: "bo_qua" })}
          disabled={dangGui}
        >
          Bỏ qua
        </Button>
      )}
      {task.ban_the_hien && (
        <a href={`#/ban-the-hien?id=${task.ban_the_hien.id}`}>
          <Button size="1" variant="outline">
            Mở editor
          </Button>
        </a>
      )}
      {loi && (
        <Text size="1" color="red">
          {loi}
        </Text>
      )}
    </Flex>
  );
}

function BangTask({ ds, sauLam }: { ds: TaskSua[]; sauLam: () => void }) {
  return (
    <Table.Root>
      <Table.Header>
        <Table.Row>
          <Table.ColumnHeaderCell>Đầu ra</Table.ColumnHeaderCell>
          <Table.ColumnHeaderCell>Lý do</Table.ColumnHeaderCell>
          <Table.ColumnHeaderCell>Loại</Table.ColumnHeaderCell>
          <Table.ColumnHeaderCell>Độ tin</Table.ColumnHeaderCell>
          <Table.ColumnHeaderCell>Trạng thái</Table.ColumnHeaderCell>
          <Table.ColumnHeaderCell>Việc</Table.ColumnHeaderCell>
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {ds.map((t) => (
          <Table.Row key={t.id}>
            <Table.Cell>
              <Flex direction="column" gap="1">
                <Text size="2" weight="bold">
                  {MoTaBth(t.ban_the_hien)}
                </Text>
                <Text size="1" color="gray">
                  {t.ban_the_hien?.thong_diep_tieu_de ?? ""}
                  {t.ban_the_hien?.url_trang ? ` · ${t.ban_the_hien.url_trang}` : ""}
                  {(t.ban_the_hien?.so_xuat_ban ?? 0) > 0
                    ? ` · ${t.ban_the_hien!.so_xuat_ban} bản xuất`
                    : ""}
                </Text>
              </Flex>
            </Table.Cell>
            <Table.Cell>
              <Text size="1">{t.ly_do}</Text>
            </Table.Cell>
            <Table.Cell>
              <Badge color={t.loai === "thu_cong" ? "red" : "blue"} variant="soft">
                {NHAN_TASK[t.loai] ?? t.loai}
              </Badge>
            </Table.Cell>
            <Table.Cell>
              <Badge color={t.do_tin === "khong_chac" ? "orange" : "green"} variant="outline">
                {t.do_tin === "khong_chac" ? "Không chắc" : "Chính xác"}
              </Badge>
            </Table.Cell>
            <Table.Cell>
              <Badge color={MAU_TT_TASK[t.trang_thai] ?? "gray"}>
                {NHAN_TT_TASK[t.trang_thai] ?? t.trang_thai}
              </Badge>
            </Table.Cell>
            <Table.Cell>
              <NutTask task={t} sauLam={sauLam} />
            </Table.Cell>
          </Table.Row>
        ))}
      </Table.Body>
    </Table.Root>
  );
}

function ChiTietThayDoi({ id, quayLai }: { id: string; quayLai: () => void }) {
  const chiTiet = useApi<ThayDoi & { ds_task: TaskSua[] }>(`/api/thay-doi/${id}`, [id]);
  const [dangChay, setDangChay] = useState(false);
  const [loi, setLoi] = useState("");

  async function chayLai() {
    const d = chiTiet.data;
    if (!d) return;
    setDangChay(true);
    setLoi("");
    try {
      await api("/api/phat-hien", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ loai: d.loai, entity_id: d.entity_id }),
      });
      chiTiet.reload();
    } catch (e) {
      setLoi(e instanceof LoiApiClient ? `${e.ma}: ${e.message}` : String(e));
    } finally {
      setDangChay(false);
    }
  }

  return (
    <>
      <Flex align="center" gap="2" mb="3" wrap="wrap">
        <Button variant="soft" size="1" onClick={quayLai}>
          ← Danh sách
        </Button>
        <Heading size="5">
          Thay đổi {NHAN_LOAI[chiTiet.data?.loai ?? "nguon"]?.toLowerCase()}:{" "}
          {chiTiet.data?.ten_entity ?? "…"}
        </Heading>
        <Badge color="blue" variant="outline">
          {NHAN_LOAI[chiTiet.data?.loai ?? ""] ?? chiTiet.data?.loai}
        </Badge>
        <Button size="1" variant="soft" onClick={() => void chayLai()} disabled={dangChay}>
          {dangChay ? "Đang quét…" : "Quét lại"}
        </Button>
      </Flex>
      {loi && (
        <Callout.Root color="red" mb="3">
          <Callout.Text>{loi}</Callout.Text>
        </Callout.Root>
      )}
      <TrangThai loading={chiTiet.loading} error={chiTiet.error}>
        {chiTiet.data && (
          <>
            <Text size="1" color="gray" as="p" mb="3">
              Phát hiện lúc {fmtLuc(chiTiet.data.tao_luc)} bởi {chiTiet.data.tao_boi} · revision{" "}
              {chiTiet.data.tu_revision_id.slice(0, 8)} → {chiTiet.data.den_revision_id.slice(0, 8)}
            </Text>
            <Card mb="4">
              <Heading size="3" mb="2">
                Mục/fact đã đổi
              </Heading>
              <Table.Root>
                <Table.Header>
                  <Table.Row>
                    <Table.ColumnHeaderCell>Mục</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>Loại</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>Cũ</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>Mới</Table.ColumnHeaderCell>
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {chiTiet.data.ds_thay_doi.map((m, i) => (
                    <Table.Row key={i}>
                      <Table.Cell>
                        <Text size="2" weight="bold">
                          {m.tieu_de || m.muc_id || "(toàn văn)"}
                        </Text>
                        <Text size="1" color="gray" as="p">
                          {m.muc_id ? `${m.loai_muc} · ${m.muc_id}` : m.loai_muc}
                        </Text>
                      </Table.Cell>
                      <Table.Cell>
                        <Badge color={MAU_DIFF[m.loai_thay_doi] ?? "gray"}>
                          {NHAN_DIFF[m.loai_thay_doi] ?? m.loai_thay_doi}
                        </Badge>
                      </Table.Cell>
                      <Table.Cell>
                        <Text
                          size="1"
                          style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}
                        >
                          {m.loai_thay_doi === "them" ? "—" : m.cu}
                        </Text>
                      </Table.Cell>
                      <Table.Cell>
                        <Text
                          size="1"
                          style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}
                        >
                          {m.loai_thay_doi === "xoa" ? "—" : m.moi}
                        </Text>
                      </Table.Cell>
                    </Table.Row>
                  ))}
                </Table.Body>
              </Table.Root>
            </Card>
            <Card>
              <Heading size="3" mb="2">
                Đầu ra bị ảnh hưởng ({chiTiet.data.ds_task.length})
              </Heading>
              {chiTiet.data.ds_task.length === 0 ? (
                <Text size="2" color="gray">
                  Không có đầu ra nào phụ thuộc.
                </Text>
              ) : (
                <BangTask ds={chiTiet.data.ds_task} sauLam={chiTiet.reload} />
              )}
            </Card>
          </>
        )}
      </TrangThai>
    </>
  );
}

export default function ThayDoiPage() {
  const [chon, setChon] = useState<string | null>(
    () => window.location.hash.match(/[?&]id=([^&]+)/)?.[1] ?? null,
  );
  const dsThayDoi = useApi<ThayDoi[]>("/api/thay-doi");
  const dsTask = useApi<TaskSua[]>("/api/task-sua");

  useEffect(() => {
    const doc = () => {
      const m = window.location.hash.match(/[?&]id=([^&]+)/);
      setChon(m?.[1] ?? null);
    };
    window.addEventListener("hashchange", doc);
    return () => window.removeEventListener("hashchange", doc);
  }, []);

  function moThayDoi(id: string) {
    window.location.hash = `/thay-doi?id=${id}`;
    setChon(id);
  }

  function quayLai() {
    window.location.hash = "/thay-doi";
    setChon(null);
    dsThayDoi.reload();
    dsTask.reload();
  }

  if (chon) return <ChiTietThayDoi id={chon} quayLai={quayLai} />;

  return (
    <>
      <Heading mb="3">Thay đổi nguồn</Heading>
      <Card mb="4">
        <Heading size="3" mb="2">
          Task sửa đang mở
        </Heading>
        <TrangThai loading={dsTask.loading} error={dsTask.error}>
          {(dsTask.data?.length ?? 0) === 0 ? (
            <Text size="2" color="gray">
              Không có task nào còn mở.
            </Text>
          ) : (
            <BangTask
              ds={dsTask.data ?? []}
              sauLam={() => {
                dsTask.reload();
                dsThayDoi.reload();
              }}
            />
          )}
        </TrangThai>
      </Card>
      <Card>
        <Heading size="3" mb="2">
          Phát hiện gần đây
        </Heading>
        <TrangThai loading={dsThayDoi.loading} error={dsThayDoi.error}>
          {(dsThayDoi.data?.length ?? 0) === 0 ? (
            <Text size="2" color="gray">
              Chưa phát hiện thay đổi nào. Sửa nguồn hoặc hồ sơ để hệ thống quét.
            </Text>
          ) : (
            <Table.Root>
              <Table.Header>
                <Table.Row>
                  <Table.ColumnHeaderCell>Entity</Table.ColumnHeaderCell>
                  <Table.ColumnHeaderCell>Loại</Table.ColumnHeaderCell>
                  <Table.ColumnHeaderCell>Mục đổi</Table.ColumnHeaderCell>
                  <Table.ColumnHeaderCell>Task mở</Table.ColumnHeaderCell>
                  <Table.ColumnHeaderCell>Phát hiện lúc</Table.ColumnHeaderCell>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {dsThayDoi.data!.map((d) => (
                  <Table.Row
                    key={d.id}
                    onClick={() => moThayDoi(d.id)}
                    style={{ cursor: "pointer" }}
                  >
                    <Table.Cell>
                      <Text weight="bold">{d.ten_entity ?? d.entity_id}</Text>
                    </Table.Cell>
                    <Table.Cell>
                      <Badge variant="outline">{NHAN_LOAI[d.loai] ?? d.loai}</Badge>
                    </Table.Cell>
                    <Table.Cell>{d.ds_thay_doi.length}</Table.Cell>
                    <Table.Cell>
                      {(d.so_task_mo ?? 0) > 0 ? (
                        <Badge color="orange">{d.so_task_mo}</Badge>
                      ) : (
                        <Badge color="green">0</Badge>
                      )}
                    </Table.Cell>
                    <Table.Cell>{fmtLuc(d.tao_luc)}</Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table.Root>
          )}
        </TrangThai>
      </Card>
    </>
  );
}
