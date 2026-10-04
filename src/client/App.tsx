import { Box, Flex, Heading, TabNav, Text } from "@radix-ui/themes";
import { useHashRoute } from "./api.ts";
import AssetsPage from "./pages/Assets.tsx";
import BanTheHienPage from "./pages/BanTheHien.tsx";
import { HoSoPage } from "./pages/HoSo.tsx";
import JobPage from "./pages/Job.tsx";
import NguonPage from "./pages/Nguon.tsx";
import TongQuanPage from "./pages/TongQuan.tsx";

const NAV = [
  { path: "/", nhan: "Tổng quan" },
  { path: "/nguon", nhan: "Nguồn" },
  { path: "/asset", nhan: "Asset" },
  { path: "/ban-the-hien", nhan: "Bản thể hiện" },
  { path: "/job", nhan: "Job" },
  { path: "/ho-so", nhan: "Hồ sơ" },
];

export default function App() {
  const path = useHashRoute();
  const hopLe = NAV.some((n) => n.path === path);

  return (
    <Box>
      <Box px="4" py="3" style={{ borderBottom: "1px solid var(--gray-5)" }}>
        <Flex align="center" justify="between" wrap="wrap" gap="3">
          <Flex align="baseline" gap="2">
            <Heading size="5">MAI</Heading>
            <Text size="2" color="gray">
              nền tảng nội dung POC
            </Text>
          </Flex>
          <TabNav.Root>
            {NAV.map((n) => (
              <TabNav.Link key={n.path} href={`#${n.path}`} active={path === n.path}>
                {n.nhan}
              </TabNav.Link>
            ))}
          </TabNav.Root>
        </Flex>
      </Box>
      <Box px="4" py="4" style={{ maxWidth: 1100, margin: "0 auto" }}>
        {path === "/" && <TongQuanPage />}
        {path === "/nguon" && <NguonPage />}
        {path === "/asset" && <AssetsPage />}
        {path === "/ban-the-hien" && <BanTheHienPage />}
        {path === "/job" && <JobPage />}
        {path === "/ho-so" && <HoSoPage />}
        {!hopLe && (
          <Flex justify="center" py="8">
            <Text color="gray">Không tìm thấy trang.</Text>
          </Flex>
        )}
      </Box>
    </Box>
  );
}
