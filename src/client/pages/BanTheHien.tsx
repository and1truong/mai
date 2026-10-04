import {
  Badge,
  Button,
  Callout,
  Card,
  Checkbox,
  Flex,
  Grid,
  Heading,
  Select,
  Table,
  Text,
  TextArea,
  TextField,
} from "@radix-ui/themes";
import { useEffect, useRef, useState } from "react";
import { api, fmtLuc, LoiApiClient, useApi } from "../api.ts";
import { TrangThai } from "../components/TrangThai.tsx";
import type { BanTheHien, Duyet, Revision, XuatBan } from "../../modules/content/index.ts";
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

// Task sửa mở trên bản này (#14) — banner cảnh báo đầu ra bị nguồn đổi.
type TaskSuaMo = {
  id: string;
  loai: "sinh_lai" | "thu_cong";
  do_tin: "chinh_xac" | "khong_chac";
  ly_do: string;
  trang_thai: string;
  thay_doi_nguon_id: string;
  thay_doi_nguon: { id: string; loai: string } | null;
};
type ChiTiet = BanTheHien & {
  revisions: RevisionKemContext[];
  assets: Asset[];
  ds_xuat_ban: XuatBan[];
  ds_task_mo: TaskSuaMo[];
  thong_diep: { tieu_de: string } | null;
  // #10: ghi chú quyền/đồng ý của asset đính kèm (campaign gây quỹ) —
  // hiển thị khi review trước khi duyệt.
  ghi_chu_quyen?: {
    id: string;
    asset_id: string;
    ghi_chu: string;
    asset: { id: string; ten_file: string; mime: string } | null;
  }[];
};

type NhapSoan = {
  id: string;
  ban_the_hien_id: string;
  actor: string;
  noi_dung: string;
  dua_tren_revision_id: string | null;
  cap_nhat_luc: string;
};

// Kết quả GET /api/ban-the-hien/:id/xem-truoc (#19).
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

const MAU_TRANG_THAI: Record<string, "gray" | "blue" | "green" | "red" | "orange"> = {
  nhap: "gray",
  cho_duyet: "blue",
  da_duyet: "green",
  tu_choi: "red",
  thay_the: "orange",
};

const NHAN_TRANG_THAI: Record<string, string> = {
  nhap: "Nháp",
  cho_duyet: "Chờ duyệt",
  da_duyet: "Đã duyệt",
  tu_choi: "Từ chối",
  thay_the: "Đã thay thế",
};

// Diff theo dòng, LCS tối thiểu — đủ cho nội dung POC, không cần dependency.
type DongDiff = { loai: "giu" | "them" | "bot"; text: string };
function diffDong(cu: string, moi: string): DongDiff[] {
  const a = cu.split("\n");
  const b = moi.split("\n");
  const dp: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  );
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }
  const kq: DongDiff[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      kq.push({ loai: "giu", text: a[i]! });
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      kq.push({ loai: "bot", text: a[i]! });
      i++;
    } else {
      kq.push({ loai: "them", text: b[j]! });
      j++;
    }
  }
  while (i < a.length) kq.push({ loai: "bot", text: a[i++]! });
  while (j < b.length) kq.push({ loai: "them", text: b[j++]! });
  return kq;
}

function KhungDiff({ cu, moi }: { cu: string; moi: string }) {
  const ds = diffDong(cu, moi);
  return (
    <pre
      style={{
        whiteSpace: "pre-wrap",
        fontSize: 12,
        border: "1px solid var(--gray-5)",
        borderRadius: 8,
        padding: "8px 10px",
        margin: 0,
        maxHeight: 320,
        overflow: "auto",
      }}
    >
      {ds.map((d, i) => (
        <div
          key={i}
          style={{
            color:
              d.loai === "them"
                ? "var(--green-11)"
                : d.loai === "bot"
                  ? "var(--red-11)"
                  : undefined,
            background:
              d.loai === "them"
                ? "var(--green-3)"
                : d.loai === "bot"
                  ? "var(--red-3)"
                  : undefined,
          }}
        >
          {d.loai === "them" ? "+ " : d.loai === "bot" ? "- " : "  "}
          {d.text}
        </div>
      ))}
    </pre>
  );
}

export default function BanTheHienPage() {
  const [locTrangThai, setLocTrangThai] = useState("");
  const ds = useApi<BanTheHien[]>(
    locTrangThai ? `/api/ban-the-hien?trang_thai=${locTrangThai}` : "/api/ban-the-hien",
    [locTrangThai],
  );
  const [chon, setChon] = useState<string | null>(null);
  const chiTiet = useApi<ChiTiet>(chon ? `/api/ban-the-hien/${chon}` : null, [chon]);
  const dsDuyet = useApi<Duyet[]>(chon ? `/api/ban-the-hien/${chon}/duyet` : null, [chon]);
  const nhapServer = useApi<NhapSoan | null>(chon ? `/api/ban-the-hien/${chon}/nhap` : null, [
    chon,
  ]);

  const [noiDung, setNoiDung] = useState("");
  const [duaTren, setDuaTren] = useState<string | null>(null);
  const [trangThaiNhap, setTrangThaiNhap] = useState("");
  const [dsLoi, setDsLoi] = useState<string[]>([]);
  const [dsCanhBao, setDsCanhBao] = useState<string[]>([]);
  const [dangGui, setDangGui] = useState(false);
  const [xungDot, setXungDot] = useState<{ head: string } | null>(null);
  const [ghiChuDuyet, setGhiChuDuyet] = useState("");
  const dsAsset = useApi<Asset[]>("/api/assets");
  const [dsAssetChon, setDsAssetChon] = useState<string[]>([]);
  const [xemTruoc, setXemTruoc] = useState<{ revId: string; kq: KetQuaXemTruoc } | null>(null);
  const [soSanh, setSoSanh] = useState<{ a: string; b: string } | null>(null);

  // head revision lúc mở bản thể hiện / sau mỗi reload — mốc optimistic.
  const headId = chiTiet.data?.head_revision_id ?? null;
  const revHead = chiTiet.data?.revisions.find((r) => r.id === headId) ?? null;
  const daNapNhap = useRef(false);

  // Nạp text vào editor: nháp server còn nguyên thì phục hồi (sửa/reload
  // không mất text); không thì soạn từ nội dung head.
  useEffect(() => {
    if (!chiTiet.data || nhapServer.loading || daNapNhap.current) return;
    daNapNhap.current = true;
    const n = nhapServer.data;
    if (n && n.noi_dung) {
      setNoiDung(n.noi_dung);
      setDuaTren(n.dua_tren_revision_id ?? chiTiet.data.head_revision_id);
      setTrangThaiNhap(`Nháp phục hồi — lưu ${fmtLuc(n.cap_nhat_luc)}`);
    } else {
      setNoiDung(revHead?.noi_dung ?? "");
      setDuaTren(chiTiet.data.head_revision_id);
      setTrangThaiNhap("");
    }
  }, [chiTiet.data, nhapServer.data, nhapServer.loading, revHead?.noi_dung]);

  // Autosave debounce: đổi text → 1.2s sau PUT /nhap. Lỗi chỉ báo trạng
  // thái, text trong ô vẫn giữ nguyên.
  const timerNhap = useRef<ReturnType<typeof setTimeout> | null>(null);
  const noiDungMoiNhat = useRef(noiDung);
  noiDungMoiNhat.current = noiDung;
  const duaTrenMoiNhat = useRef(duaTren);
  duaTrenMoiNhat.current = duaTren;
  const chonMoiNhat = useRef(chon);
  chonMoiNhat.current = chon;
  async function luuNhap(nd: string, bthId?: string | null) {
    const id = bthId ?? chonMoiNhat.current;
    if (!id) return;
    try {
      await api<NhapSoan>(`/api/ban-the-hien/${id}/nhap`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ noi_dung: nd, dua_tren_revision_id: duaTrenMoiNhat.current }),
      });
      if (chonMoiNhat.current === id) {
        setTrangThaiNhap(`Đã lưu nháp ${new Date().toLocaleTimeString("vi")}`);
      }
    } catch {
      if (chonMoiNhat.current === id) {
        setTrangThaiNhap("Lỗi lưu nháp — text vẫn giữ trong ô.");
      }
    }
  }
  function thayNoiDung(nd: string) {
    setNoiDung(nd);
    if (timerNhap.current) clearTimeout(timerNhap.current);
    // Ghim bản thể hiện tại thời điểm hẹn — đổi bản khác thì timer cũ
    // không được PUT lên nháp mới hay ghi đè nháp bản cũ.
    const id = chonMoiNhat.current;
    timerNhap.current = setTimeout(() => {
      if (chonMoiNhat.current === id) void luuNhap(noiDungMoiNhat.current, id);
    }, 1200);
    setTrangThaiNhap("Đang soạn…");
  }
  useEffect(() => () => {
    if (timerNhap.current) clearTimeout(timerNhap.current);
  }, []);

  // Bàn phím: Ctrl/Cmd+S lưu nháp ngay, Ctrl/Cmd+Enter lưu revision.
  function onKeyDown(e: React.KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && e.key === "s") {
      e.preventDefault();
      void luuNhap(noiDungMoiNhat.current);
    }
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      void luuRevision();
    }
  }

  const khoaAssetServer = chiTiet.data?.assets.map((a) => a.id).join(",") ?? "";
  useEffect(() => {
    setDsAssetChon(khoaAssetServer ? khoaAssetServer.split(",") : []);
  }, [khoaAssetServer]);

  function moBth(id: string, ghiHash = true) {
    // Autosave còn hẹn của bản cũ → flush ngay lên nháp của bản cũ trước
    // khi đổi, không thì text soạn dở bị xóa khi chuyển.
    if (timerNhap.current) {
      clearTimeout(timerNhap.current);
      timerNhap.current = null;
      void luuNhap(noiDungMoiNhat.current, chonMoiNhat.current);
    }
    // Deep-link #/ban-the-hien?id=<id>: refresh/back phục hồi đúng bản.
    if (ghiHash && window.location.hash !== `#/ban-the-hien?id=${id}`) {
      window.location.hash = `/ban-the-hien?id=${id}`;
    }
    setChon(id);
    daNapNhap.current = false;
    setNoiDung("");
    setDuaTren(null);
    setTrangThaiNhap("");
    setDsLoi([]);
    setDsCanhBao([]);
    setXemTruoc(null);
    setSoSanh(null);
    setXungDot(null);
    setGhiChuDuyet("");
  }

  // Đọc id từ hash (#/ban-the-hien?id=<uuid>) lúc mount và mỗi hashchange:
  // link từ trang khác (kế hoạch, tổng quan) mở thẳng vào bản thể hiện.
  useEffect(() => {
    const doc = () => {
      const m = window.location.hash.match(/[?&]id=([^&]+)/);
      const id = m?.[1];
      if (id && id !== chonMoiNhat.current) moBth(id, false);
    };
    doc();
    window.addEventListener("hashchange", doc);
    return () => window.removeEventListener("hashchange", doc);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  // Lưu revision với dua_tren tường minh — head đổi → 409 → panel xung đột:
  // nháp vẫn giữ, user xem diff rồi tường minh lưu lên head mới hay không.
  async function luuRevision(duaTrenId?: string | null) {
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
            noi_dung: noiDungMoiNhat.current,
            dua_tren_revision_id: duaTrenId !== undefined ? duaTrenId : duaTrenMoiNhat.current,
          }),
        },
      );
      setDsCanhBao(rev.ds_loi_dinh_dang?.map((l) => `${l.truong}: ${l.loi}`) ?? []);
      setXungDot(null);
      setTrangThaiNhap("");
      daNapNhap.current = false;
      chiTiet.reload();
      ds.reload();
      dsDuyet.reload();
      nhapServer.reload(); // nháp đã bị server xóa — tránh phục hồi text cũ
    } catch (e) {
      if (e instanceof LoiApiClient && e.ma === "XUNG_DOT_REVISION") {
        chiTiet.reload();
        setXungDot({ head: "" }); // head mới lấy sau reload
      } else {
        setDsLoi([e instanceof LoiApiClient ? `${e.ma}: ${e.message}` : String(e)]);
      }
    } finally {
      setDangGui(false);
    }
  }

  async function chuyenTt(den: string) {
    if (!chiTiet.data) return;
    setDsLoi([]);
    try {
      await api(`/api/ban-the-hien/${chiTiet.data.id}/trang-thai`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          trang_thai: den,
          ghi_chu: ghiChuDuyet,
          // Duyệt luôn ghim revision mà người chấm đang nhìn — request cũ
          // (head đã đổi) bị server từ chối sạch 409.
          mong_doi_revision_id: chiTiet.data.head_revision_id,
        }),
      });
      setGhiChuDuyet("");
      chiTiet.reload();
      ds.reload();
      dsDuyet.reload();
    } catch (e) {
      setDsLoi([e instanceof LoiApiClient ? `${e.ma}: ${e.message}` : String(e)]);
    }
  }

  // Khôi phục revision cũ = revision mới mang nội dung cũ — lịch sử giữ nguyên.
  async function khoiPhuc(r: RevisionKemContext) {
    if (!chiTiet.data) return;
    setDsLoi([]);
    try {
      await api(`/api/ban-the-hien/${chiTiet.data.id}/revision`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          noi_dung: r.noi_dung,
          dua_tren_revision_id: chiTiet.data.head_revision_id,
        }),
      });
      daNapNhap.current = false;
      chiTiet.reload();
      ds.reload();
      nhapServer.reload();
    } catch (e) {
      setDsLoi([e instanceof LoiApiClient ? `${e.ma}: ${e.message}` : String(e)]);
    }
  }

  // Lệnh trên task sửa (#14) — bắt lỗi API như các handler khác thay vì
  // để unhandled rejection làm UI câm.
  async function chayLenhTask(fn: () => Promise<unknown>) {
    setDsLoi([]);
    try {
      await fn();
      chiTiet.reload();
    } catch (e) {
      setDsLoi([e instanceof LoiApiClient ? `${e.ma}: ${e.message}` : String(e)]);
      chiTiet.reload();
    }
  }

  // Đề xuất AI đang chờ: revision do 'job' tạo làm head hiện tại mà chưa
  // có record duyet ghim. Sau từ chối (revision mới của con người lên head)
  // đề xuất không còn là head → panel không hiện lại — từ chối bền.
  const revDeXuat =
    revHead &&
    revHead.tao_boi === "job" &&
    !(dsDuyet.data ?? []).some((d) => d.revision_id === revHead.id)
      ? revHead
      : null;
  const revTruocDeXuat =
    revDeXuat && chiTiet.data
      ? chiTiet.data.revisions.find((r) => r.so_thu_tu === revDeXuat.so_thu_tu - 1)
      : null;

  const headMoi = xungDot
    ? (chiTiet.data?.revisions.find((r) => r.id === chiTiet.data!.head_revision_id) ?? null)
    : null;

  return (
    <>
      <Heading mb="3">Bản thể hiện</Heading>
      <Grid columns={{ initial: "1", md: "2" }} gap="4">
        <div>
          <Flex gap="2" mb="2" align="center">
            <Text size="1" color="gray">
              Trạng thái:
            </Text>
            <Select.Root
              size="1"
              value={locTrangThai || "tat_ca"}
              onValueChange={(v) => setLocTrangThai(v === "tat_ca" ? "" : v)}
            >
              <Select.Trigger />
              <Select.Content>
                <Select.Item value="tat_ca">Tất cả</Select.Item>
                {Object.entries(NHAN_TRANG_THAI).map(([k, n]) => (
                  <Select.Item key={k} value={k}>
                    {n}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select.Root>
          </Flex>
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
                    onClick={() => moBth(b.id)}
                    style={{ cursor: "pointer", background: chon === b.id ? "var(--accent-3)" : undefined }}
                  >
                    <Table.Cell>{b.dinh_dang}</Table.Cell>
                    <Table.Cell>{b.doi_tuong || "—"}</Table.Cell>
                    <Table.Cell>
                      <Badge color={MAU_TRANG_THAI[b.trang_thai] ?? "gray"}>
                        {NHAN_TRANG_THAI[b.trang_thai] ?? b.trang_thai}
                      </Badge>
                    </Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table.Root>
          </TrangThai>
        </div>

        <Card>
          {!chon && <Text color="gray">Chọn một bản thể hiện để mở editor.</Text>}
          {chon && (
            <TrangThai loading={chiTiet.loading} error={chiTiet.error}>
              {chiTiet.data && (
                <Flex direction="column" gap="3">
                  <Flex align="center" gap="2" wrap="wrap">
                    <Heading size="4">{chiTiet.data.dinh_dang}</Heading>
                    <Badge>{chiTiet.data.ngon_ngu}</Badge>
                    <Badge variant="outline">{chiTiet.data.doi_tuong || "chung"}</Badge>
                    <Badge color={MAU_TRANG_THAI[chiTiet.data.trang_thai] ?? "gray"}>
                      {NHAN_TRANG_THAI[chiTiet.data.trang_thai] ?? chiTiet.data.trang_thai}
                    </Badge>
                  </Flex>
                  <Text size="1" color="gray">
                    {chiTiet.data.thong_diep?.tieu_de ?? ""} · head{" "}
                    {revHead ? `#${revHead.so_thu_tu}` : "—"}
                  </Text>

                  {/* Nguồn/hồ sơ đã đổi sau khi bản này sinh (#14) — đề
                      xuất sinh lại qua job, hoặc bỏ qua. */}
                  {(chiTiet.data.ds_task_mo ?? []).map((t) => (
                    <Callout.Root
                      key={t.id}
                      color={t.do_tin === "khong_chac" ? "orange" : "red"}
                    >
                      <Callout.Text>
                        {t.do_tin === "khong_chac"
                          ? "Nguồn có thể đã đổi — phụ thuộc không chứng minh được. "
                          : "Nguồn đã đổi — bản này có thể đã cũ. "}
                        {t.ly_do}
                      </Callout.Text>
                      <Flex gap="2" mt="2" align="center">
                        {t.loai === "sinh_lai" && t.trang_thai === "mo" && (
                          <Button
                            size="1"
                            onClick={() =>
                              chayLenhTask(() =>
                                api(`/api/task-sua/${t.id}/de-xuat`, {
                                  method: "POST",
                                  headers: { "content-type": "application/json" },
                                  body: "{}",
                                }),
                              )
                            }
                          >
                            Đề xuất sinh lại
                          </Button>
                        )}
                        {t.loai === "thu_cong" && (
                          <Button
                            size="1"
                            color="green"
                            variant="soft"
                            onClick={() =>
                              chayLenhTask(() =>
                                api(`/api/task-sua/${t.id}/trang-thai`, {
                                  method: "POST",
                                  headers: { "content-type": "application/json" },
                                  body: JSON.stringify({ trang_thai: "xong" }),
                                }),
                              )
                            }
                          >
                            Đã sửa tay
                          </Button>
                        )}
                        {t.trang_thai === "mo" && (
                          <Button
                            size="1"
                            variant="soft"
                            color="gray"
                            onClick={() =>
                              chayLenhTask(() =>
                                api(`/api/task-sua/${t.id}/trang-thai`, {
                                  method: "POST",
                                  headers: { "content-type": "application/json" },
                                  body: JSON.stringify({ trang_thai: "bo_qua" }),
                                }),
                              )
                            }
                          >
                            Bỏ qua
                          </Button>
                        )}
                        <a href={`#/thay-doi?id=${t.thay_doi_nguon_id}`}>
                          <Text size="1">Xem thay đổi</Text>
                        </a>
                      </Flex>
                    </Callout.Root>
                  ))}

                  {/* Lệnh vòng đời — server ép chuỗi chuyển + ghim revision. */}
                  <Flex gap="2" wrap="wrap" align="center">
                    {chiTiet.data.trang_thai === "nhap" && (
                      <Button size="1" onClick={() => chuyenTt("cho_duyet")}>
                        Gửi duyệt
                      </Button>
                    )}
                    {chiTiet.data.trang_thai === "cho_duyet" && (
                      <>
                        <Button size="1" color="green" onClick={() => chuyenTt("da_duyet")}>
                          Duyệt
                        </Button>
                        <Button size="1" color="red" variant="soft" onClick={() => chuyenTt("tu_choi")}>
                          Từ chối
                        </Button>
                        <Button size="1" variant="soft" onClick={() => chuyenTt("nhap")}>
                          Về nháp
                        </Button>
                      </>
                    )}
                    {(chiTiet.data.trang_thai === "da_duyet" ||
                      chiTiet.data.trang_thai === "tu_choi" ||
                      chiTiet.data.trang_thai === "thay_the") && (
                      <Button size="1" variant="soft" onClick={() => chuyenTt("nhap")}>
                        Mở lại nháp
                      </Button>
                    )}
                    {chiTiet.data.trang_thai === "thay_the" && (
                      <Button size="1" onClick={() => chuyenTt("cho_duyet")}>
                        Gửi duyệt bản mới
                      </Button>
                    )}
                    {chiTiet.data.trang_thai === "da_duyet" && (
                      <Button
                        size="1"
                        variant="soft"
                        onClick={async () => {
                          try {
                            await api(`/api/ban-the-hien/${chiTiet.data!.id}/xuat-ban`, {
                              method: "POST",
                              headers: { "content-type": "application/json" },
                              body: JSON.stringify({}),
                            });
                            chiTiet.reload();
                          } catch (e) {
                            setDsLoi([
                              e instanceof LoiApiClient ? `${e.ma}: ${e.message}` : String(e),
                            ]);
                          }
                        }}
                      >
                        Xuất bản
                      </Button>
                    )}
                    <TextField.Root
                      size="1"
                      placeholder="Ghi chú duyệt (tùy chọn)"
                      value={ghiChuDuyet}
                      onChange={(e) => setGhiChuDuyet(e.target.value)}
                      style={{ flex: 1, minWidth: 160 }}
                    />
                  </Flex>

                  {/* Đề xuất AI: chỉ đổi head khi được chấp nhận tường minh —
                      từ chối = khôi phục nội dung trước đó thành revision mới. */}
                  {revDeXuat && (
                    <Card variant="surface">
                      <Flex align="center" gap="2" mb="2">
                        <Badge color="purple">Đề xuất AI</Badge>
                        <Text size="1" color="gray">
                          Revision #{revDeXuat.so_thu_tu} — {fmtLuc(revDeXuat.tao_luc)}
                        </Text>
                      </Flex>
                      {revTruocDeXuat && (
                        <KhungDiff cu={revTruocDeXuat.noi_dung} moi={revDeXuat.noi_dung} />
                      )}
                      <Flex gap="2" mt="2" justify="end">
                        <Button
                          size="1"
                          color="green"
                          variant="soft"
                          onClick={async () => {
                            // Chấp nhận = đưa đề xuất đi duyệt (nhap →
                            // cho_duyet); đã cho_duyet thì duyệt luôn.
                            await chuyenTt(
                              chiTiet.data!.trang_thai === "cho_duyet" ? "da_duyet" : "cho_duyet",
                            );
                          }}
                        >
                          Chấp nhận
                        </Button>
                        <Button
                          size="1"
                          color="red"
                          variant="soft"
                          onClick={async () => {
                            if (!revTruocDeXuat) return;
                            await api(`/api/ban-the-hien/${chiTiet.data!.id}/revision`, {
                              method: "POST",
                              headers: { "content-type": "application/json" },
                              body: JSON.stringify({
                                noi_dung: revTruocDeXuat.noi_dung,
                                dua_tren_revision_id: chiTiet.data!.head_revision_id,
                              }),
                            });
                            daNapNhap.current = false;
                            chiTiet.reload();
                            dsDuyet.reload();
                            nhapServer.reload();
                          }}
                        >
                          Từ chối đề xuất
                        </Button>
                      </Flex>
                    </Card>
                  )}

                  {/* Xung đột: head đổi trong lúc soạn — giữ nháp, hiện diff,
                      user chọn lưu lên head mới hay tiếp tục soạn. */}
                  {xungDot && headMoi && (
                    <Callout.Root color="amber">
                      <Callout.Text>
                        Head đã đổi sang revision #{headMoi.so_thu_tu} trong lúc bạn soạn. Text của
                        bạn vẫn giữ nguyên trong ô soạn.
                      </Callout.Text>
                      <KhungDiff cu={headMoi.noi_dung} moi={noiDungMoiNhat.current} />
                      <Flex gap="2" mt="2" justify="end">
                        <Button
                          size="1"
                          onClick={() => {
                            setDuaTren(headMoi.id);
                            void luuRevision(headMoi.id);
                          }}
                        >
                          Lưu lên head #{headMoi.so_thu_tu}
                        </Button>
                        <Button size="1" variant="soft" onClick={() => setXungDot(null)}>
                          Tiếp tục soạn
                        </Button>
                      </Flex>
                    </Callout.Root>
                  )}

                  {/* Editor autosave — không bỏ text chưa lưu dù lỗi mạng. */}
                  <Text size="2" weight="bold">
                    Editor
                  </Text>
                  <TextArea
                    placeholder="Soạn nội dung… (Ctrl+S lưu nháp, Ctrl+Enter lưu revision)"
                    rows={8}
                    value={noiDung}
                    onKeyDown={onKeyDown}
                    onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
                      thayNoiDung(e.target.value)
                    }
                  />
                  <Flex align="center" justify="between">
                    <Text size="1" color="gray">
                      {trangThaiNhap}
                    </Text>
                    <Flex gap="2">
                      <Button
                        variant="soft"
                        size="1"
                        onClick={() => {
                          setNoiDung(revHead?.noi_dung ?? "");
                          setDuaTren(headId);
                          setTrangThaiNhap("Đã nạp lại từ head.");
                        }}
                      >
                        Nạp lại head
                      </Button>
                      <Button size="1" onClick={() => luuRevision()} disabled={dangGui}>
                        Lưu revision
                      </Button>
                    </Flex>
                  </Flex>
                  {dsLoi.length > 0 && (
                    <Callout.Root color="red">
                      {dsLoi.map((l, i) => (
                        <Callout.Text key={i}>{l}</Callout.Text>
                      ))}
                    </Callout.Root>
                  )}
                  {dsCanhBao.length > 0 && (
                    <Callout.Root color="amber">
                      {dsCanhBao.map((l, i) => (
                        <Callout.Text key={i}>{l}</Callout.Text>
                      ))}
                    </Callout.Root>
                  )}

                  {/* Lịch sử revision + so sánh + khôi phục. */}
                  <Text size="2" weight="bold">
                    Revision
                  </Text>
                  {soSanh && (
                    <Card variant="surface">
                      <Flex align="center" gap="2" mb="1">
                        <Text size="1" weight="bold">
                          So sánh
                        </Text>
                        <Text size="1" color="gray">
                          #{chiTiet.data.revisions.find((r) => r.id === soSanh.a)?.so_thu_tu} → #
                          {chiTiet.data.revisions.find((r) => r.id === soSanh.b)?.so_thu_tu}
                        </Text>
                        <Button size="1" variant="ghost" onClick={() => setSoSanh(null)}>
                          Đóng
                        </Button>
                      </Flex>
                      <KhungDiff
                        cu={chiTiet.data.revisions.find((r) => r.id === soSanh.a)?.noi_dung ?? ""}
                        moi={chiTiet.data.revisions.find((r) => r.id === soSanh.b)?.noi_dung ?? ""}
                      />
                    </Card>
                  )}
                  {chiTiet.data.revisions.map((r) => (
                    <Card key={r.id} variant="surface">
                      <Flex align="center" gap="2">
                        <Text size="1" color="gray">
                          Revision {r.so_thu_tu} — {fmtLuc(r.tao_luc)} — {r.tao_boi}
                          {r.id === headId && " · head"}
                        </Text>
                        {r.tao_boi === "job" && <Badge color="purple" size="1">AI</Badge>}
                      </Flex>
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
                      <Flex justify="end" gap="2" mt="2">
                        <Button
                          variant="soft"
                          size="1"
                          onClick={() =>
                            setSoSanh((c) =>
                              c ? { a: c.b, b: r.id } : { a: headId ?? r.id, b: r.id },
                            )
                          }
                        >
                          So sánh
                        </Button>
                        {r.id !== headId && (
                          <Button variant="soft" size="1" onClick={() => khoiPhuc(r)}>
                            Khôi phục
                          </Button>
                        )}
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

                  {/* Lịch sử chấm: record duyet ghim revision + actor. */}
                  {(dsDuyet.data ?? []).length > 0 && (
                    <>
                      <Text size="2" weight="bold">
                        Lịch sử duyệt
                      </Text>
                      {dsDuyet.data!.map((d) => (
                        <Text key={d.id} size="1" color="gray">
                          {NHAN_TRANG_THAI[d.tu_trang_thai] ?? d.tu_trang_thai} →{" "}
                          {NHAN_TRANG_THAI[d.den_trang_thai] ?? d.den_trang_thai} · rev{" "}
                          {chiTiet.data!.revisions.find((r) => r.id === d.revision_id)
                            ?.so_thu_tu ?? "—"}{" "}
                          · {d.tao_boi} · {fmtLuc(d.tao_luc)}
                          {d.ghi_chu ? ` · ${d.ghi_chu}` : ""}
                        </Text>
                      ))}
                    </>
                  )}

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
                  {(chiTiet.data.ghi_chu_quyen ?? []).length > 0 && (
                    <Callout.Root color="blue" size="1">
                      <Callout.Text>
                        Quyền/đồng ý của asset đính kèm (do tổ chức cung cấp):
                      </Callout.Text>
                      {chiTiet.data.ghi_chu_quyen!.map((q) => (
                        <Callout.Text key={q.id}>
                          • {q.asset?.ten_file ?? q.asset_id}: {q.ghi_chu}
                        </Callout.Text>
                      ))}
                    </Callout.Root>
                  )}
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
                </Flex>
              )}
            </TrangThai>
          )}
        </Card>
      </Grid>
    </>
  );
}
