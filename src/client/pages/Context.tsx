import { Button, Callout, Card, Flex, Heading, Text, TextArea, TextField } from "@radix-ui/themes";
import { useEffect, useState } from "react";
import { api, fmtLuc, LoiApiClient, useApi } from "../api.ts";
import { TrangThai } from "../components/TrangThai.tsx";
import type { Context } from "../../modules/context/index.ts";

export default function ContextPage() {
  const { data, loading, error, reload } = useApi<Context | null>("/api/context");
  const [form, setForm] = useState({ ten: "", doi_tuong: "", giong_noi: "", gia_tri: "" });
  const [dsLoi, setDsLoi] = useState<string[]>([]);
  const [daLuu, setDaLuu] = useState(false);
  const [dangGui, setDangGui] = useState(false);

  useEffect(() => {
    if (data) {
      setForm({
        ten: data.ten,
        doi_tuong: data.doi_tuong,
        giong_noi: data.giong_noi,
        gia_tri: data.gia_tri,
      });
    }
  }, [data]);

  async function luu() {
    setDangGui(true);
    setDsLoi([]);
    setDaLuu(false);
    try {
      await api("/api/context", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(form),
      });
      setDaLuu(true);
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

  const truong = [
    { key: "ten", nhan: "Tên (bắt buộc)" },
    { key: "doi_tuong", nhan: "Đối tượng" },
    { key: "giong_noi", nhan: "Giọng nói" },
  ] as const;

  return (
    <>
      <Heading mb="3">Context</Heading>
      <TrangThai loading={loading} error={error}>
        <Card>
          <Flex direction="column" gap="3">
            {truong.map((t) => (
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
                Giá trị
              </Text>
              <TextArea
                rows={3}
                value={form.gia_tri}
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
                  setForm({ ...form, gia_tri: e.target.value })
                }
              />
            </label>
            {dsLoi.length > 0 && (
              <Callout.Root color="red">
                {dsLoi.map((l, i) => (
                  <Callout.Text key={i}>{l}</Callout.Text>
                ))}
              </Callout.Root>
            )}
            {daLuu && (
              <Callout.Root color="green">
                <Callout.Text>Đã lưu context.</Callout.Text>
              </Callout.Root>
            )}
            <Flex justify="between" align="center">
              <Text size="1" color="gray">
                {data ? `Cập nhật lúc: ${fmtLuc(data.cap_nhat_luc)} — bởi ${data.cap_nhat_boi}` : "Chưa có context."}
              </Text>
              <Button onClick={luu} disabled={dangGui}>
                Lưu context
              </Button>
            </Flex>
          </Flex>
        </Card>
      </TrangThai>
    </>
  );
}
