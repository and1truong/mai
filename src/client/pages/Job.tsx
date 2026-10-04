import {
  Badge,
  Button,
  Callout,
  Card,
  Code,
  Flex,
  Heading,
  Select,
  Table,
  Text,
  TextField,
} from "@radix-ui/themes";
import { useEffect, useState } from "react";
import { api, fmtLuc, LoiApiClient, useApi } from "../api.ts";
import { TrangThai } from "../components/TrangThai.tsx";
import type { Nguon } from "../../modules/content/index.ts";
import type { HoSoDoiTuong, HoSoThuongHieu } from "../../modules/context/index.ts";
import type { Job, JobLog } from "../../modules/jobs/index.ts";

const MAU_JOB: Record<string, "gray" | "blue" | "green" | "red" | "orange"> = {
  cho: "gray",
  dang_chay: "blue",
  xong: "green",
  loi: "red",
  huy: "orange",
};

const NHAN_TRANG_THAI: Record<string, string> = {
  cho: "chờ",
  dang_chay: "đang chạy",
  xong: "xong",
  loi: "lỗi",
  huy: "hủy",
};

type JobChiTiet = Job & { nhat_ky: JobLog[] };

function lenLichSau(job: Job): boolean {
  return (
    job.trang_thai === "cho" && !!job.chay_som_nhat && Date.parse(job.chay_som_nhat) > Date.now()
  );
}

function moTaTienDo(job: Job): string {
  if (!job.tien_do || job.tien_do === "{}") return "—";
  try {
    const t = JSON.parse(job.tien_do) as Record<string, unknown>;
    return String(t.buoc ?? t.ghi_chu ?? JSON.stringify(t));
  } catch {
    return job.tien_do;
  }
}

function moTaLenLich(job: Job): string {
  if (!job.chay_som_nhat) return "—";
  return job.mui_gio ? `${fmtLuc(job.chay_som_nhat)} (${job.mui_gio})` : fmtLuc(job.chay_som_nhat);
}

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
  const [lenLich, setLenLich] = useState("");
  const [chonId, setChonId] = useState<string | null>(null);
  const chiTiet = useApi<JobChiTiet>(chonId ? `/api/job/${chonId}` : null, [jobs.data]);
  const [loi, setLoi] = useState<string | null>(null);

  useEffect(() => {
    if (!dinhDang && dinhDangs.data?.[0]) setDinhDang(dinhDangs.data[0]);
  }, [dinhDangs.data, dinhDang]);

  // Tự reload khi còn job đang chờ/chạy (kể cả job lên lịch sắp tới hạn).
  useEffect(() => {
    const conJob = jobs.data?.some((j) => j.trang_thai === "cho" || j.trang_thai === "dang_chay");
    if (!conJob) return;
    const t = setInterval(jobs.reload, 1500);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobs.data]);

  function hienLoi(e: unknown) {
    setLoi(e instanceof LoiApiClient ? `${e.ma}: ${e.message}` : String(e));
  }

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
          chay_som_nhat: lenLich ? new Date(lenLich).toISOString() : undefined,
          mui_gio: lenLich ? Intl.DateTimeFormat().resolvedOptions().timeZone : undefined,
        }),
      });
      jobs.reload();
    } catch (e) {
      hienLoi(e);
    }
  }

  async function huy(id: string) {
    setLoi(null);
    try {
      await api(`/api/job/${id}/huy`, { method: "POST" });
      jobs.reload();
    } catch (e) {
      hienLoi(e);
    }
  }

  async function thuLai(id: string) {
    setLoi(null);
    try {
      await api(`/api/job/${id}/thu-lai`, { method: "POST" });
      jobs.reload();
    } catch (e) {
      hienLoi(e);
    }
  }

  const j = chiTiet.data;

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
          <TextField.Root
            type="datetime-local"
            aria-label="Lên lịch chạy (tùy chọn)"
            value={lenLich}
            onChange={(e) => setLenLich(e.target.value)}
          />
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
          Job chạy trong cùng process: attempt ít-nhất-một-lần, retry có backoff, hủy/lên lịch được.
          Cùng một bản thể hiện chỉ tạo một job logic (idempotency key).
        </Text>
      </Card>
      <TrangThai loading={jobs.loading} error={jobs.error} empty={jobs.data?.length === 0}>
        <Table.Root>
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeaderCell>Loại</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>Trạng thái</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>Thử</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>Tiến độ</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>Lên lịch</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>Lỗi</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell />
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {jobs.data?.map((job) => (
              <Table.Row
                key={job.id}
                onClick={() => setChonId(job.id === chonId ? null : job.id)}
                style={{ cursor: "pointer" }}
              >
                <Table.Cell>{job.loai}</Table.Cell>
                <Table.Cell>
                  <Flex gap="2" align="center">
                    <Badge color={MAU_JOB[job.trang_thai] ?? "gray"}>
                      {NHAN_TRANG_THAI[job.trang_thai] ?? job.trang_thai}
                    </Badge>
                    {lenLichSau(job) && <Badge color="purple">lên lịch</Badge>}
                  </Flex>
                </Table.Cell>
                <Table.Cell>
                  {job.so_lan_thu}/{job.so_lan_thu_toi_da}
                </Table.Cell>
                <Table.Cell>{moTaTienDo(job)}</Table.Cell>
                <Table.Cell>{moTaLenLich(job)}</Table.Cell>
                <Table.Cell>{job.loi ?? "—"}</Table.Cell>
                <Table.Cell>
                  <Flex gap="2" onClick={(e) => e.stopPropagation()}>
                    {(job.trang_thai === "cho" || job.trang_thai === "dang_chay") && (
                      <Button size="1" variant="soft" color="orange" onClick={() => huy(job.id)}>
                        Hủy
                      </Button>
                    )}
                    {job.trang_thai === "loi" && (
                      <Button size="1" variant="soft" onClick={() => thuLai(job.id)}>
                        Thử lại
                      </Button>
                    )}
                  </Flex>
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Root>
      </TrangThai>

      {chonId && j && (
        <Card mt="4">
          <Flex justify="between" align="center" mb="2">
            <Heading size="3">Chi tiết job</Heading>
            <Button size="1" variant="ghost" onClick={() => setChonId(null)}>
              Đóng
            </Button>
          </Flex>
          <Flex gap="4" wrap="wrap" mb="3">
            <Text size="2">
              ID: <Code>{j.id}</Code>
            </Text>
            <Text size="2">
              Khóa: <Code>{j.khoa_idem}</Code>
            </Text>
            <Text size="2">
              Entity:{" "}
              <Code>
                {j.entity_loai}:{j.entity_id}
              </Code>
            </Text>
            <Text size="2">
              Revision ghim: <Code>{j.revision_id ?? "—"}</Code>
            </Text>
            <Text size="2">
              Timeout: <Code>{j.timeout_ms}ms</Code>
            </Text>
            <Text size="2">
              Tạo lúc: <Code>{fmtLuc(j.tao_luc)}</Code>
            </Text>
            <Text size="2">
              Xong lúc: <Code>{fmtLuc(j.xong_luc)}</Code>
            </Text>
          </Flex>
          {j.ket_qua && (
            <Text size="2" as="p" mb="2">
              Kết quả: <Code>{j.ket_qua}</Code>
            </Text>
          )}
          <Heading size="2" mb="2">
            Nhật ký thực thi
          </Heading>
          <Table.Root>
            <Table.Header>
              <Table.Row>
                <Table.ColumnHeaderCell>Thời điểm</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>Sự kiện</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>Dữ liệu</Table.ColumnHeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {j.nhat_ky.map((d) => (
                <Table.Row key={d.id}>
                  <Table.Cell>{fmtLuc(d.ts)}</Table.Cell>
                  <Table.Cell>
                    <Code>{d.su_kien}</Code>
                  </Table.Cell>
                  <Table.Cell>
                    <Code>{d.du_lieu}</Code>
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table.Root>
        </Card>
      )}
    </>
  );
}
