import { Box, Flex, Heading, Separator, Text } from "@radix-ui/themes";
import { HoSoDoiTuongSection } from "../components/HoSoDoiTuong.tsx";
import { HoSoThuongHieuSection } from "../components/HoSoThuongHieu.tsx";
import { XemTruocContextSinh } from "../components/XemTruocContextSinh.tsx";

export function HoSoPage() {
  return (
    <Box>
      <Flex align="baseline" gap="3" mb="1">
        <Heading size="5">Hồ sơ</Heading>
        <Text size="2" color="gray">
          Thương hiệu của instance + đối tượng mà nội dung nói tới. Thông tin đi vào context
          sinh nội dung ở job.
        </Text>
      </Flex>
      <Separator size="4" my="4" />
      <HoSoThuongHieuSection />
      <Separator size="4" my="4" />
      <HoSoDoiTuongSection />
      <Separator size="4" my="4" />
      <XemTruocContextSinh />
    </Box>
  );
}
