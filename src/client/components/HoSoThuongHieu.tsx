import {
  Badge,
  Button,
  Callout,
  Card,
  Checkbox,
  Flex,
  Grid,
  Heading,
  Table,
  Text,
  TextArea,
  TextField,
} from "@radix-ui/themes";
import { useEffect, useState } from "react";
import { api, fmtLuc, LoiApiClient, useApi } from "../api.ts";
import { BangRevisionHoSo } from "./BangRevisionHoSo.tsx";
import { TrangThai } from "./TrangThai.tsx";
import { docBanDich, NHAN_NGUON_DU_LIEU, tachDong, tachPhay, vietBanDich } from "./hoSo.ts";
import type { HoSoThuongHieu, ThuatNgu } from "../../modules/context/index.ts";

type ChiTiet = HoSoThuongHieu & { thuat_ngu: ThuatNgu[] };

type DongThuatNgu = { thuat_ngu: string; giu_nguyen: boolean; ban_dich: string };

const FORM_RONG = {
  ten: "",
  nhan_dien: "",
  ngon_ngu_uu_tien: "",
  vi_du_giong_van: "",
  nguyen_tac: "",
  claim_duyet: "",
  claim_cam: "",
  assets: "",
};

// Section hồ sơ thương hiệu: list preset + form + bảng thuật ngữ + revision.
export function HoSoThuongHieuSection() {
  const ds = useApi<HoSoThuongHieu[]>("/api/ho-so-thuong-hieu");
  const [chon, setChon] = useState<string | null>(null); // id hồ sơ, "moi" = form tạo
  const chiTiet = useApi<ChiTiet>(
    chon && chon !== "moi" ? `/api/ho-so-thuong-hieu/${chon}` : null,
    [chon],
  );
  const [form, setForm] = useState({ ...FORM_RONG });
  const [dsTn, setDsTn] = useState<DongThuatNgu[]>([]);
  const [dsLoi, setDsLoi] = useState<string[]>([]);
  const [thongBao, setThongBao] = useState("");
  const [dangGui, setDangGui] = useState(false);
  const [tickRev, setTickRev] = useState(0);

  useEffect(() => {
    if (chon !== "moi" && chiTiet.data) {
      const h = chiTiet.data;
      setForm({
        ten: h.ten,
        nhan_dien: h.nhan_dien,
        ngon_ngu_uu_tien: h.ngon_ngu_uu_tien.join(", "),
        vi_du_giong_van: h.vi_du_giong_van,
        nguyen_tac: h.nguyen_tac,
        claim_duyet: h.claim_duyet.join("\n"),
        claim_cam: h.claim_cam.join("\n"),
        assets: h.assets.join(", "),
      });
      setDsTn(
        h.thuat_ngu.map((t) => ({
          thuat_ngu: t.thuat_ngu,
          giu_nguyen: t.giu_nguyen,
          ban_dich: vietBanDich(t.ban_dich),
        })),
      );
    }
  }, [chiTiet.data, chon]);

  function loiCua(e: unknown) {
    if (e instanceof LoiApiClient) {
      setDsLoi([e.message, ...(Array.isArray(e.chiTiet) ? e.chiTiet.map(String) : [])]);
    } else {
      setDsLoi([String(e)]);
    }
  }

  async function gui<T>(p: Promise<T>): Promise<T | null> {
    setDangGui(true);
    setDsLoi([]);
    setThongBao("");
    try {
      return await p;
    } catch (e) {
      loiCua(e);
      return null;
    } finally {
      setDangGui(false);
    }
  }

  async function luu() {
    const body = {
      ten: form.ten,
      nhan_dien: form.nhan_dien,
      ngon_ngu_uu_tien: tachPhay(form.ngon_ngu_uu_tien),
      vi_du_giong_van: form.vi_du_giong_van,
      nguyen_tac: form.nguyen_tac,
      claim_duyet: tachDong(form.claim_duyet),
      claim_cam: tachDong(form.claim_cam),
      assets: tachPhay(form.assets),
    };
    const res = await gui(
      api<HoSoThuongHieu>(
        chon && chon !== "moi" ? `/api/ho-so-thuong-hieu/${chon}` : "/api/ho-so-thuong-hieu",
        {
          method: chon && chon !== "moi" ? "PUT" : "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
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

  async function luuThuatNgu() {
    if (!chon || chon === "moi") return;
    const res = await gui(
      api(`/api/ho-so-thuong-hieu/${chon}/thuat-ngu`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          thuat_ngu: dsTn
            .filter((t) => t.thuat_ngu.trim())
            .map((t) => ({
              thuat_ngu: t.thuat_ngu.trim(),
              giu_nguyen: t.giu_nguyen,
              ban_dich: docBanDich(t.ban_dich),
            })),
        }),
      }),
    );
    if (!res) return;
    setThongBao("Đã lưu bảng thuật ngữ.");
    setTickRev((t) => t + 1);
  }

  async function xoa() {
    if (!chon || chon === "moi") return;
    if (!window.confirm(`Xóa hồ sơ "${form.ten}"?`)) return;
    const res = await gui(api(`/api/ho-so-thuong-hieu/${chon}`, { method: "DELETE" }));
    if (!res) return;
    setChon(null);
    setForm({ ...FORM_RONG });
    setDsTn([]);
    setThongBao("Đã xóa hồ sơ.");
    ds.reload();
  }

  const TRUONG_NGAN: { key: keyof typeof FORM_RONG; nhan: string }[] = [
    { key: "ten", nhan: "Tên hồ sơ (bắt buộc)" },
    { key: "ngon_ngu_uu_tien", nhan: "Ngôn ngữ ưu tiên (phẩy: vi, en)" },
    { key: "assets", nhan: "Asset tham chiếu (phẩy; byte do #17)" },
  ];
  const TRUONG_DAI: { key: keyof typeof FORM_RONG; nhan: string }[] = [
    { key: "nhan_dien", nhan: "Nhận diện thương hiệu" },
    { key: "vi_du_giong_van", nhan: "Ví dụ giọng văn" },
    { key: "nguyen_tac", nhan: "Nguyên tắc biên tập" },
    { key: "claim_duyet", nhan: "Claim được duyệt (mỗi dòng một claim)" },
    { key: "claim_cam", nhan: "Claim bị cấm (mỗi dòng một claim)" },
  ];

  return (
    <>
      <Heading size="4" mb="3">
        Hồ sơ thương hiệu
      </Heading>
      <Grid columns={{ initial: "1", md: "5" }} gap="4" mb="5">
        <Card style={{ gridColumn: "span 2" }}>
          <Flex direction="column" gap="2">
            <Flex justify="between" align="center">
              <Text size="2" color="gray">
                Preset dùng lại được. Bấm một dòng để sửa.
              </Text>
              <Button
                size="1"
                variant="soft"
                onClick={() => {
                  setChon("moi");
                  setForm({ ...FORM_RONG });
                  setDsTn([]);
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
                  {ds.data?.map((h) => (
                    <Table.Row
                      key={h.id}
                      onClick={() => {
                        setChon(h.id);
                        setDsLoi([]);
                        setThongBao("");
                      }}
                      style={{
                        cursor: "pointer",
                        background: chon === h.id ? "var(--accent-3)" : undefined,
                      }}
                    >
                      <Table.Cell>
                        {h.ten} {h.la_fixture && <Badge color="amber">fixture</Badge>}
                      </Table.Cell>
                      <Table.Cell>{h.ngon_ngu_uu_tien.join(", ") || "—"}</Table.Cell>
                      <Table.Cell>
                        <Badge color={h.nguon_du_lieu === "he_thong" ? "blue" : "gray"}>
                          {NHAN_NGUON_DU_LIEU[h.nguon_du_lieu] ?? h.nguon_du_lieu}
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
                {TRUONG_DAI.map((t) => (
                  <label key={t.key}>
                    <Text size="2" color="gray">
                      {t.nhan}
                    </Text>
                    <TextArea
                      rows={t.key === "nhan_dien" ? 2 : 3}
                      value={form[t.key]}
                      onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
                        setForm({ ...form, [t.key]: e.target.value })
                      }
                    />
                  </label>
                ))}

                {chon !== "moi" && (
                  <Card variant="surface">
                    <Flex direction="column" gap="2">
                      <Text size="2" weight="bold">
                        Bảng dịch thuật ngữ
                      </Text>
                      <Text size="1" color="gray">
                        “Giữ nguyên” = không dịch thuật ngữ ở mọi ngôn ngữ được yêu cầu. Bản
                        dịch tham chiếu: mỗi dòng “ma_ngu: bản dịch”.
                      </Text>
                      {dsTn.map((t, i) => (
                        <Flex key={i} gap="2" align="start">
                          <TextField.Root
                            placeholder="Thuật ngữ"
                            value={t.thuat_ngu}
                            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                              setDsTn(
                                dsTn.map((x, j) =>
                                  j === i ? { ...x, thuat_ngu: e.target.value } : x,
                                ),
                              )
                            }
                            style={{ flex: 1 }}
                          />
                          <Text as="label" size="2">
                            <Checkbox
                              checked={t.giu_nguyen}
                              onCheckedChange={(v: boolean | "indeterminate") =>
                                setDsTn(
                                  dsTn.map((x, j) =>
                                    j === i ? { ...x, giu_nguyen: v === true } : x,
                                  ),
                                )
                              }
                            />{" "}
                            Giữ nguyên
                          </Text>
                          <TextField.Root
                            placeholder={"en: the Gospel"}
                            value={t.ban_dich}
                            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                              setDsTn(
                                dsTn.map((x, j) =>
                                  j === i ? { ...x, ban_dich: e.target.value } : x,
                                ),
                              )
                            }
                            style={{ flex: 1 }}
                          />
                          <Button
                            size="1"
                            variant="ghost"
                            color="red"
                            onClick={() => setDsTn(dsTn.filter((_, j) => j !== i))}
                          >
                            Xóa
                          </Button>
                        </Flex>
                      ))}
                      <Flex gap="2">
                        <Button
                          size="1"
                          variant="soft"
                          onClick={() =>
                            setDsTn([...dsTn, { thuat_ngu: "", giu_nguyen: true, ban_dich: "" }])
                          }
                        >
                          + Thêm thuật ngữ
                        </Button>
                        <Button size="1" onClick={luuThuatNgu} disabled={dangGui}>
                          Lưu bảng thuật ngữ
                        </Button>
                      </Flex>
                    </Flex>
                  </Card>
                )}

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
            duongDan={`/api/ho-so-thuong-hieu/${chon}/revision`}
            key={`${chon}-${tickRev}`}
          />
        </Card>
      )}
    </>
  );
}
