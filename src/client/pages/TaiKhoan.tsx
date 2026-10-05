import {
  Badge,
  Box,
  Button,
  Callout,
  Card,
  Code,
  Flex,
  Heading,
  Select,
  Separator,
  Table,
  Text,
  TextField,
} from "@radix-ui/themes";
import { useState } from "react";
import { api, fmtLuc, LoiApiClient, useApi, type TaiKhoanView } from "../api.ts";

// Quản lý tài khoản instance (#16): danh sách, tạo mới, đổi vai trò /
// trạng thái, đặt lại mật khẩu (quản trị), và đổi mật khẩu của chính
// mình (mọi vai trò). Route server đã kiểm quyền — trang này chỉ hiển thị.
// URL: #/tai-khoan.

const NHAN_VAI_TRO: Record<string, string> = {
  quan_tri: "Quản trị",
  bien_tap: "Biên tập",
};

function TaoTaiKhoanCard({ onXong }: { onXong: () => void }) {
  const [tenDangNhap, setTenDangNhap] = useState("");
  const [tenHienThi, setTenHienThi] = useState("");
  const [vaiTro, setVaiTro] = useState("bien_tap");
  const [matKhau, setMatKhau] = useState("");
  const [loi, setLoi] = useState("");
  const [dangGui, setDangGui] = useState(false);

  const submit = async () => {
    setLoi("");
    setDangGui(true);
    try {
      await api("/api/tai-khoan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ten_dang_nhap: tenDangNhap,
          ten_hien_thi: tenHienThi || tenDangNhap,
          vai_tro: vaiTro,
          mat_khau: matKhau,
        }),
      });
      setTenDangNhap("");
      setTenHienThi("");
      setMatKhau("");
      onXong();
    } catch (e) {
      setLoi(e instanceof LoiApiClient ? e.message : String(e));
    } finally {
      setDangGui(false);
    }
  };

  return (
    <Card size="2">
      <Flex direction="column" gap="3">
        <Heading size="3">Tạo tài khoản</Heading>
        {loi && (
          <Callout.Root color="red" size="1">
            <Callout.Text>{loi}</Callout.Text>
          </Callout.Root>
        )}
        <Flex gap="3" wrap="wrap">
          <Box style={{ minWidth: 160 }}>
            <Text size="2" weight="medium" as="p" mb="1">
              Tên đăng nhập
            </Text>
            <TextField.Root
              value={tenDangNhap}
              onChange={(e) => setTenDangNhap(e.target.value)}
              placeholder="vd: lan.nguyen"
            />
          </Box>
          <Box style={{ minWidth: 160 }}>
            <Text size="2" weight="medium" as="p" mb="1">
              Tên hiển thị
            </Text>
            <TextField.Root
              value={tenHienThi}
              onChange={(e) => setTenHienThi(e.target.value)}
              placeholder="vd: Lan Nguyễn"
            />
          </Box>
          <Box style={{ minWidth: 140 }}>
            <Text size="2" weight="medium" as="p" mb="1">
              Vai trò
            </Text>
            <Select.Root value={vaiTro} onValueChange={setVaiTro}>
              <Select.Trigger />
              <Select.Content>
                <Select.Item value="bien_tap">Biên tập</Select.Item>
                <Select.Item value="quan_tri">Quản trị</Select.Item>
              </Select.Content>
            </Select.Root>
          </Box>
          <Box style={{ minWidth: 160 }}>
            <Text size="2" weight="medium" as="p" mb="1">
              Mật khẩu
            </Text>
            <TextField.Root
              type="password"
              value={matKhau}
              onChange={(e) => setMatKhau(e.target.value)}
              placeholder="tối thiểu 8 ký tự"
            />
          </Box>
        </Flex>
        <Box>
          <Button onClick={() => void submit()} disabled={dangGui || !tenDangNhap || !matKhau}>
            Tạo tài khoản
          </Button>
        </Box>
      </Flex>
    </Card>
  );
}

function DoiMatKhauToiCard({ me }: { me: TaiKhoanView | null }) {
  const [cu, setCu] = useState("");
  const [moi, setMoi] = useState("");
  const [loi, setLoi] = useState("");
  const [xong, setXong] = useState(false);

  if (!me) return null;
  const submit = async () => {
    setLoi("");
    setXong(false);
    try {
      await api(`/api/tai-khoan/${me.id}/mat-khau`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mat_khau_cu: cu, mat_khau_moi: moi }),
      });
      setXong(true);
    } catch (e) {
      setLoi(e instanceof LoiApiClient ? e.message : String(e));
    }
  };

  return (
    <Card size="2">
      <Flex direction="column" gap="3">
        <Box>
          <Heading size="3">Đổi mật khẩu của tôi</Heading>
          <Text size="2" color="gray" as="p">
            Đổi xong mọi phiên đăng nhập của tài khoản này đều kết thúc — phải đăng nhập lại.
          </Text>
        </Box>
        {loi && (
          <Callout.Root color="red" size="1">
            <Callout.Text>{loi}</Callout.Text>
          </Callout.Root>
        )}
        {xong && (
          <Callout.Root color="green" size="1">
            <Callout.Text>Đã đổi mật khẩu — hãy đăng nhập lại.</Callout.Text>
          </Callout.Root>
        )}
        <Flex gap="3" wrap="wrap" align="end">
          <Box style={{ minWidth: 160 }}>
            <Text size="2" weight="medium" as="p" mb="1">
              Mật khẩu hiện tại
            </Text>
            <TextField.Root type="password" value={cu} onChange={(e) => setCu(e.target.value)} />
          </Box>
          <Box style={{ minWidth: 160 }}>
            <Text size="2" weight="medium" as="p" mb="1">
              Mật khẩu mới
            </Text>
            <TextField.Root type="password" value={moi} onChange={(e) => setMoi(e.target.value)} />
          </Box>
          <Button onClick={() => void submit()} disabled={!cu || !moi}>
            Đổi mật khẩu
          </Button>
        </Flex>
      </Flex>
    </Card>
  );
}

export default function TaiKhoanPage({
  me,
  laQuanTri,
}: {
  me: TaiKhoanView | null;
  laQuanTri: boolean;
}) {
  const { data, loading, error, reload } = useApi<TaiKhoanView[]>(
    laQuanTri ? "/api/tai-khoan" : null,
  );
  const [loiHang, setLoiHang] = useState("");
  const [mkReset, setMkReset] = useState<Record<string, string>>({});

  const sua = async (id: string, body: unknown) => {
    setLoiHang("");
    try {
      await api(`/api/tai-khoan/${id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      reload();
    } catch (e) {
      setLoiHang(e instanceof LoiApiClient ? e.message : String(e));
    }
  };

  const resetMatKhau = async (id: string) => {
    setLoiHang("");
    const mk = mkReset[id] ?? "";
    if (!mk) return;
    try {
      await api(`/api/tai-khoan/${id}/mat-khau`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mat_khau_moi: mk }),
      });
      setMkReset((m) => ({ ...m, [id]: "" }));
    } catch (e) {
      setLoiHang(e instanceof LoiApiClient ? e.message : String(e));
    }
  };

  return (
    <Box>
      <Flex align="baseline" gap="3" mb="1">
        <Heading size="5">Tài khoản</Heading>
        <Text size="2" color="gray">
          Tài khoản local của instance — chia sẻ chung một thư viện nội dung.
        </Text>
      </Flex>
      <Separator size="4" my="4" />
      {laQuanTri && (
        <>
          <TaoTaiKhoanCard onXong={reload} />
          <Separator size="4" my="4" />
          {error && (
            <Callout.Root color="red" size="1" mb="3">
              <Callout.Text>{error.message}</Callout.Text>
            </Callout.Root>
          )}
          {loiHang && (
            <Callout.Root color="red" size="1" mb="3">
              <Callout.Text>{loiHang}</Callout.Text>
            </Callout.Root>
          )}
          <Table.Root>
            <Table.Header>
              <Table.Row>
                <Table.ColumnHeaderCell>Đăng nhập</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>Hiển thị</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>Vai trò</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>Trạng thái</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>Tạo lúc</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>Thao tác</Table.ColumnHeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {(data ?? []).map((tk) => (
                <Table.Row key={tk.id}>
                  <Table.Cell>
                    <Code>{tk.ten_dang_nhap}</Code>
                  </Table.Cell>
                  <Table.Cell>{tk.ten_hien_thi}</Table.Cell>
                  <Table.Cell>
                    <Badge color={tk.vai_tro === "quan_tri" ? "orange" : "blue"}>
                      {NHAN_VAI_TRO[tk.vai_tro] ?? tk.vai_tro}
                    </Badge>
                  </Table.Cell>
                  <Table.Cell>
                    <Badge color={tk.trang_thai === "hoat_dong" ? "green" : "gray"}>
                      {tk.trang_thai === "hoat_dong" ? "Hoạt động" : "Vô hiệu"}
                    </Badge>
                  </Table.Cell>
                  <Table.Cell>{fmtLuc(tk.tao_luc)}</Table.Cell>
                  <Table.Cell>
                    <Flex gap="2" wrap="wrap" align="center">
                      <Select.Root
                        value={tk.vai_tro}
                        onValueChange={(v) => void sua(tk.id, { vai_tro: v })}
                      >
                        <Select.Trigger />
                        <Select.Content>
                          <Select.Item value="bien_tap">Biên tập</Select.Item>
                          <Select.Item value="quan_tri">Quản trị</Select.Item>
                        </Select.Content>
                      </Select.Root>
                      <Button
                        size="1"
                        variant="soft"
                        color={tk.trang_thai === "hoat_dong" ? "red" : "green"}
                        onClick={() =>
                          void sua(tk.id, {
                            trang_thai: tk.trang_thai === "hoat_dong" ? "vo_hieu" : "hoat_dong",
                          })
                        }
                      >
                        {tk.trang_thai === "hoat_dong" ? "Vô hiệu" : "Kích hoạt"}
                      </Button>
                      <TextField.Root
                        size="1"
                        type="password"
                        placeholder="mk mới"
                        value={mkReset[tk.id] ?? ""}
                        onChange={(e) =>
                          setMkReset((m) => ({ ...m, [tk.id]: e.target.value }))
                        }
                        style={{ width: 90 }}
                      />
                      <Button
                        size="1"
                        variant="soft"
                        disabled={!(mkReset[tk.id] ?? "")}
                        onClick={() => void resetMatKhau(tk.id)}
                      >
                        Đặt lại MK
                      </Button>
                    </Flex>
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table.Root>
          {loading && (
            <Text size="2" color="gray">
              Đang tải...
            </Text>
          )}
          <Separator size="4" my="4" />
        </>
      )}
      <DoiMatKhauToiCard me={me} />
    </Box>
  );
}
