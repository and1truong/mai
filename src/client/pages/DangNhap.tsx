import { Box, Button, Callout, Card, Flex, Heading, Text, TextField } from "@radix-ui/themes";
import { useState } from "react";
import { api, LoiApiClient } from "../api.ts";

// Màn đăng nhập của chế độ bảo vệ (#16): chỉ hiện khi instance bật
// bao_mat.che_do = 'bao_ve' và chưa có phiên. Cookie HttpOnly được server
// set trực tiếp — client không đọc/ghi token.

export default function DangNhapPage({ onXong }: { onXong: () => void }) {
  const [tenDangNhap, setTenDangNhap] = useState("");
  const [matKhau, setMatKhau] = useState("");
  const [loi, setLoi] = useState("");
  const [dangGui, setDangGui] = useState(false);

  const submit = async () => {
    setLoi("");
    setDangGui(true);
    try {
      await api("/api/dang-nhap", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ten_dang_nhap: tenDangNhap, mat_khau: matKhau }),
      });
      onXong();
    } catch (e) {
      setLoi(e instanceof LoiApiClient ? e.message : String(e));
    } finally {
      setDangGui(false);
    }
  };

  return (
    <Flex align="center" justify="center" style={{ minHeight: "70vh" }}>
      <Card size="3" style={{ width: 360 }}>
        <Flex direction="column" gap="4" p="2">
          <Box>
            <Heading size="5">Đăng nhập MAI</Heading>
            <Text size="2" color="gray" as="p" mt="1">
              Instance này đang bật chế độ bảo vệ — cần tài khoản để tiếp tục.
            </Text>
          </Box>
          {loi && (
            <Callout.Root color="red" size="1">
              <Callout.Text>{loi}</Callout.Text>
            </Callout.Root>
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <Flex direction="column" gap="3">
              <label>
                <Text size="2" weight="medium" as="p" mb="1">
                  Tên đăng nhập
                </Text>
                <TextField.Root
                  value={tenDangNhap}
                  onChange={(e) => setTenDangNhap(e.target.value)}
                  placeholder="ten_dang_nhap"
                  autoFocus
                />
              </label>
              <label>
                <Text size="2" weight="medium" as="p" mb="1">
                  Mật khẩu
                </Text>
                <TextField.Root
                  type="password"
                  value={matKhau}
                  onChange={(e) => setMatKhau(e.target.value)}
                  placeholder="••••••••"
                />
              </label>
              <Button type="submit" disabled={dangGui || !tenDangNhap || !matKhau}>
                {dangGui ? "Đang đăng nhập..." : "Đăng nhập"}
              </Button>
            </Flex>
          </form>
        </Flex>
      </Card>
    </Flex>
  );
}
