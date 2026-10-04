import {
  Badge,
  Button,
  Callout,
  Card,
  Flex,
  Grid,
  Heading,
  Select,
  Table,
  Text,
  TextArea,
  TextField,
} from "@radix-ui/themes";
import { useEffect, useState } from "react";
import { api, fmtLuc, LoiApiClient, useApi } from "../api.ts";
import { BangRevisionHoSo } from "./BangRevisionHoSo.tsx";
import { TrangThai } from "./TrangThai.tsx";
import { NHAN_NGUON_DU_LIEU } from "./hoSo.ts";
import { DANH_SACH_DO_SAU, type HoSoDoiTuong } from "../../modules/context/index.ts";

const FORM_RONG = {
  ten: "",
  ngon_ngu: "",
  dia_diem: "",
  kien_thuc_nen: "",
  moi_quan_tam: "",
  do_sau: "",
  tu_vung: "",
  quan_he_to_chuc: "",
  nhu_cau_giao_tiep: "",
  nhan_khau_hoc: "",
};

const NHAN_DO_SAU: Record<string, string> = {
  so_luoc: "Sơ lược",
  vua_phai: "Vừa phải",
  chuyen_sau: "Chuyên sâu",
};

// Section hồ sơ đối tượng: list preset + form + revision.
// Trường để trống nghĩa là "chưa biết" — không điền hộ người dùng.
export function HoSoDoiTuongSection() {
  const ds = useApi<HoSoDoiTuong[]>("/api/ho-so-doi-tuong");
  const [chon, setChon] = useState<string | null>(null);
  const chiTiet = useApi<HoSoDoiTuong>(
    chon && chon !== "moi" ? `/api/ho-so-doi-tuong/${chon}` : null,
    [chon],
  );
  const [form, setForm] = useState({ ...FORM_RONG });
  const [dsLoi, setDsLoi] = useState<string[]>([]);
  const [thongBao, setThongBao] = useState("");
  const [dangGui, setDangGui] = useState(false);
  const [tickRev, setTickRev] = useState(0);

  useEffect(() => {
    if (chon !== "moi" && chiTiet.data) {
      const d = chiTiet.data;
      setForm({
        ten: d.ten,
        ngon_ngu: d.ngon_ngu,
        dia_diem: d.dia_diem,
        kien_thuc_nen: d.kien_thuc_nen,
        moi_quan_tam: d.moi_quan_tam,
        do_sau: d.do_sau,
        tu_vung: d.tu_vung,
        quan_he_to_chuc: d.quan_he_to_chuc,
        nhu_cau_giao_tiep: d.nhu_cau_giao_tiep,
        nhan_khau_hoc: d.nhan_khau_hoc,
      });
    }
  }, [chiTiet.data, chon]);

  async function gui<T>(p: Promise<T>): Promise<T | null> {
    setDangGui(true);
    setDsLoi([]);
    setThongBao("");
    try {
      return await p;
    } catch (e) {
      if (e instanceof LoiApiClient) {
        setDsLoi([e.message, ...(Array.isArray(e.chiTiet) ? e.chiTiet.map(String) : [])]);
      } else {
        setDsLoi([String(e)]);
      }
      return null;
    } finally {
      setDangGui(false);
    }
  }

  async function luu() {
    const res = await gui(
      api<HoSoDoiTuong>(
        chon && chon !== "moi" ? `/api/ho-so-doi-tuong/${chon}` : "/api/ho-so-doi-tuong",
        {
          method: chon && chon !== "moi" ? "PUT" : "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(form),
        },
      ),
    );
    if (!res) return;
    setThongBao(chon && chon !== "moi" ? "Đã cập nhật hồ sơ." : "Đã tạo hồ sơ mới.");
    setChon(res.id);
    ds.reload();
    chiTiet.reload();
    setTickRev((t) => t + 1);
  }

  async function xoa() {
    if (!chon || chon === "moi") return;
    if (!window.confirm(`Xóa hồ sơ "${form.ten}"?`)) return;
    const res = await gui(api(`/api/ho-so-doi-tuong/${chon}`, { method: "DELETE" }));
    if (!res) return;
    setChon(null);
    setForm({ ...FORM_RONG });
    setThongBao("Đã xóa hồ sơ.");
    ds.reload();
  }

  const TRUONG_NGAN: { key: keyof typeof FORM_RONG; nhan: string }[] = [
    { key: "ten", nhan: "Tên hồ sơ (bắt buộc)" },
    { key: "ngon_ngu", nhan: "Ngôn ngữ" },
    { key: "dia_diem", nhan: "Địa điểm (khi liên quan)" },
    { key: "tu_vung", nhan: "Từ vựng ưa thích" },
    { key: "quan_he_to_chuc", nhan: "Quan hệ với tổ chức" },
  ];
  const TRUONG_DAI: { key: keyof typeof FORM_RONG; nhan: string }[] = [
    { key: "kien_thuc_nen", nhan: "Kiến thức nền" },
    { key: "moi_quan_tam", nhan: "Mối quan tâm" },
    { key: "nhu_cau_giao_tiep", nhan: "Nhu cầu giao tiếp" },
    { key: "nhan_khau_hoc", nhan: "Nhân khẩu học (tùy chọn, chỉ khi người dùng nhập)" },
  ];

  return (
    <>
      <Heading size="4" mb="3">
        Hồ sơ đối tượng
      </Heading>
      <Grid columns={{ initial: "1", md: "5" }} gap="4" mb="5">
        <Card style={{ gridColumn: "span 2" }}>
          <Flex direction="column" gap="2">
            <Flex justify="between" align="center">
              <Text size="2" color="gray">
                Preset đối tượng. Trường để trống = chưa biết.
              </Text>
              <Button
                size="1"
                variant="soft"
                onClick={() => {
                  setChon("moi");
                  setForm({ ...FORM_RONG });
                  setDsLoi([]);
                }}
              >
                + Tạo mới
              </Button>
            </Flex>
            <TrangThai loading={ds.loading} error={ds.error} empty={ds.data?.length === 0}>
              <Table.Root size="1">
                <Table.Header>
                  <Table.Row>
                    <Table.ColumnHeaderCell>Tên</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>Ngôn ngữ</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>Nguồn</Table.ColumnHeaderCell>
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {ds.data?.map((d) => (
                    <Table.Row
                      key={d.id}
                      onClick={() => {
                        setChon(d.id);
                        setDsLoi([]);
                        setThongBao("");
                      }}
                      style={{
                        cursor: "pointer",
                        background: chon === d.id ? "var(--accent-3)" : undefined,
                      }}
                    >
                      <Table.Cell>
                        {d.ten} {d.la_fixture && <Badge color="amber">fixture</Badge>}
                      </Table.Cell>
                      <Table.Cell>{d.ngon_ngu || "—"}</Table.Cell>
                      <Table.Cell>
                        <Badge color={d.nguon_du_lieu === "he_thong" ? "blue" : "gray"}>
                          {NHAN_NGUON_DU_LIEU[d.nguon_du_lieu] ?? d.nguon_du_lieu}
                        </Badge>
                      </Table.Cell>
                    </Table.Row>
                  ))}
                </Table.Body>
              </Table.Root>
            </TrangThai>
          </Flex>
        </Card>

        <Card style={{ gridColumn: "span 3" }}>
          {!chon && <Text color="gray">Chọn một hồ sơ để sửa, hoặc bấm “+ Tạo mới”.</Text>}
          {chon && (
            <TrangThai loading={chon !== "moi" && chiTiet.loading} error={chiTiet.error}>
              <Flex direction="column" gap="3">
                {TRUONG_NGAN.map((t) => (
                  <label key={t.key}>
                    <Text size="2" color="gray">
                      {t.nhan}
                    </Text>
                    <TextField.Root
                      value={form[t.key]}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                        setForm({ ...form, [t.key]: e.target.value })
                      }
                    />
                  </label>
                ))}
                <label>
                  <Text size="2" color="gray">
                    Độ sâu mong muốn
                  </Text>
                  <Select.Root
                    value={form.do_sau || "khong-chon"}
                    onValueChange={(v: string) =>
                      setForm({ ...form, do_sau: v === "khong-chon" ? "" : v })
                    }
                  >
                    <Select.Trigger />
                    <Select.Content>
                      <Select.Item value="khong-chon">Chưa biết</Select.Item>
                      {DANH_SACH_DO_SAU.map((d) => (
                        <Select.Item key={d} value={d}>
                          {NHAN_DO_SAU[d] ?? d}
                        </Select.Item>
                      ))}
                    </Select.Content>
                  </Select.Root>
                </label>
                {TRUONG_DAI.map((t) => (
                  <label key={t.key}>
                    <Text size="2" color="gray">
                      {t.nhan}
                    </Text>
                    <TextArea
                      rows={2}
                      value={form[t.key]}
                      onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
                        setForm({ ...form, [t.key]: e.target.value })
                      }
                    />
                  </label>
                ))}

                {dsLoi.length > 0 && (
                  <Callout.Root color="red">
                    {dsLoi.map((l, i) => (
                      <Callout.Text key={i}>{l}</Callout.Text>
                    ))}
                  </Callout.Root>
                )}
                {thongBao && (
                  <Callout.Root color="green">
                    <Callout.Text>{thongBao}</Callout.Text>
                  </Callout.Root>
                )}
                <Flex justify="between" align="center">
                  <Text size="1" color="gray">
                    {chiTiet.data && chon !== "moi"
                      ? `Cập nhật: ${fmtLuc(chiTiet.data.cap_nhat_luc)} — ${chiTiet.data.cap_nhat_boi}`
                      : " "}
                  </Text>
                  <Flex gap="2">
                    {chon !== "moi" && (
                      <Button variant="soft" color="red" onClick={xoa} disabled={dangGui}>
                        Xóa hồ sơ
                      </Button>
                    )}
                    <Button onClick={luu} disabled={dangGui}>
                      {chon === "moi" ? "Tạo hồ sơ" : "Lưu hồ sơ"}
                    </Button>
                  </Flex>
                </Flex>
              </Flex>
            </TrangThai>
          )}
        </Card>
      </Grid>

      {chon && chon !== "moi" && (
        <Card mb="5">
          <Text size="2" weight="bold" as="p" mb="2">
            Revision hồ sơ
          </Text>
          <BangRevisionHoSo
            duongDan={`/api/ho-so-doi-tuong/${chon}/revision`}
            key={`${chon}-${tickRev}`}
          />
        </Card>
      )}
    </>
  );
}
