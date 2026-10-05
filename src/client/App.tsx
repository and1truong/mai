import { Badge, Box, Button, Flex, Heading, TabNav, Text } from "@radix-ui/themes";
import { api, useApi, useHashRoute, type TrangThaiMe } from "./api.ts";
import AssetsPage from "./pages/Assets.tsx";
import BanTheHienPage from "./pages/BanTheHien.tsx";
import CongQuyenPage from "./pages/CongQuyen.tsx";
import DangNhapPage from "./pages/DangNhap.tsx";
import GayQuyPage from "./pages/GayQuy.tsx";
import { HoSoPage } from "./pages/HoSo.tsx";
import KeHoachPage from "./pages/KeHoach.tsx";
import JobPage from "./pages/Job.tsx";
import KenhPage from "./pages/Kenh.tsx";
import KetQuaPage from "./pages/KetQua.tsx";
import KhachPage from "./pages/Khach.tsx";
import NguonPage from "./pages/Nguon.tsx";
import PhatHanhPage from "./pages/PhatHanh.tsx";
import SoBaoPage from "./pages/SoBao.tsx";
import TaiKhoanPage from "./pages/TaiKhoan.tsx";
import ThayDoiPage from "./pages/ThayDoi.tsx";
import ThongDiepPage from "./pages/ThongDiep.tsx";
import ThuongHieuPage from "./pages/ThuongHieu.tsx";
import TongQuanPage from "./pages/TongQuan.tsx";

const NAV = [
  { path: "/", nhan: "Tổng quan" },
  { path: "/nguon", nhan: "Nguồn" },
  { path: "/asset", nhan: "Asset" },
  { path: "/ban-the-hien", nhan: "Bản thể hiện" },
  { path: "/thay-doi", nhan: "Thay đổi" },
  { path: "/so-bao", nhan: "Số báo" },
  { path: "/phat-hanh", nhan: "Phát hành" },
  { path: "/gay-quy", nhan: "Gây quỹ" },
  { path: "/cong-quyen", nhan: "Công quyền" },
  { path: "/thuong-hieu", nhan: "Thương hiệu" },
  { path: "/job", nhan: "Job" },
  { path: "/kenh", nhan: "Kênh" },
  { path: "/ket-qua", nhan: "Kết quả" },
  { path: "/khach", nhan: "Khách" },
  { path: "/ho-so", nhan: "Hồ sơ" },
];

export default function App() {
  const path = useHashRoute();
  // #16: bootstrap phiên — chế độ bảo vệ mà chưa đăng nhập thì chỉ render
  // màn đăng nhập, không render nav/app (route /me luôn public).
  const { data: me, loading: meLoading, reload: reloadMe } = useApi<TrangThaiMe>(
    "/api/tai-khoan/me",
  );
  const baoVe = me?.che_do === "bao_ve";
  const laQuanTri = !baoVe || me?.tai_khoan?.vai_tro === "quan_tri";

  // Cắt phần query (?id=...) để so route — các trang tự đọc query trong hash.
  const goc = path.split("?")[0] ?? "/";
  const hopLe = [...NAV.map((n) => n.path), "/ke-hoach", "/thong-diep", "/tai-khoan"].includes(
    goc,
  );

  if (meLoading) {
    return (
      <Flex justify="center" py="9">
        <Text color="gray">Đang tải...</Text>
      </Flex>
    );
  }
  if (baoVe && !me?.tai_khoan) {
    return <DangNhapPage onXong={reloadMe} />;
  }

  const dangXuat = async () => {
    try {
      await api("/api/dang-xuat", { method: "POST" });
    } finally {
      window.location.reload();
    }
  };

  return (
    <Box>
      <Box px="4" py="3" style={{ borderBottom: "1px solid var(--gray-5)" }}>
        <Flex align="center" justify="between" wrap="wrap" gap="3">
          <Flex align="baseline" gap="2">
            <Heading size="5">MAI</Heading>
            <Text size="2" color="gray">
              nền tảng nội dung POC
            </Text>
            {baoVe && me?.tai_khoan && (
              <Badge color="orange" variant="soft">
                bảo vệ
              </Badge>
            )}
          </Flex>
          <Flex align="center" gap="3" wrap="wrap">
            <TabNav.Root>
              {NAV.map((n) => (
                <TabNav.Link key={n.path} href={`#${n.path}`} active={goc === n.path}>
                  {n.nhan}
                </TabNav.Link>
              ))}
              <TabNav.Link href="#/tai-khoan" active={goc === "/tai-khoan"}>
                Tài khoản
              </TabNav.Link>
            </TabNav.Root>
            {baoVe && me?.tai_khoan && (
              <Flex align="center" gap="2">
                <Text size="2">
                  {me.tai_khoan.ten_hien_thi}
                </Text>
                <Badge color={me.tai_khoan.vai_tro === "quan_tri" ? "orange" : "blue"}>
                  {me.tai_khoan.vai_tro === "quan_tri" ? "Quản trị" : "Biên tập"}
                </Badge>
                <Button size="1" variant="soft" color="gray" onClick={() => void dangXuat()}>
                  Đăng xuất
                </Button>
              </Flex>
            )}
          </Flex>
        </Flex>
      </Box>
      <Box px="4" py="4" style={{ maxWidth: 1100, margin: "0 auto" }}>
        {goc === "/" && <TongQuanPage />}
        {goc === "/nguon" && <NguonPage />}
        {goc === "/asset" && <AssetsPage />}
        {goc === "/ban-the-hien" && <BanTheHienPage />}
        {goc === "/thay-doi" && <ThayDoiPage />}
        {goc === "/ke-hoach" && <KeHoachPage />}
        {goc === "/so-bao" && <SoBaoPage />}
        {goc === "/phat-hanh" && <PhatHanhPage />}
        {goc === "/gay-quy" && <GayQuyPage />}
        {goc === "/cong-quyen" && <CongQuyenPage />}
        {goc === "/thuong-hieu" && <ThuongHieuPage />}
        {goc === "/thong-diep" && <ThongDiepPage />}
        {goc === "/job" && <JobPage />}
        {goc === "/kenh" && <KenhPage />}
        {goc === "/ket-qua" && <KetQuaPage />}
        {goc === "/khach" && <KhachPage />}
        {goc === "/ho-so" && <HoSoPage />}
        {goc === "/tai-khoan" && <TaiKhoanPage me={me?.tai_khoan ?? null} laQuanTri={laQuanTri} />}
        {!hopLe && (
          <Flex justify="center" py="8">
            <Text color="gray">Không tìm thấy trang.</Text>
          </Flex>
        )}
      </Box>
    </Box>
  );
}
