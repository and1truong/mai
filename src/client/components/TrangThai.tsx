import { Callout, Flex, Spinner, Text } from "@radix-ui/themes";
import type { ReactNode } from "react";

// Trạng thái dùng chung cho mọi trang: loading / error / empty.
export function TrangThai({
  loading,
  error,
  empty,
  children,
}: {
  loading: boolean;
  error: Error | null;
  empty?: boolean;
  children: ReactNode;
}) {
  if (loading) {
    return (
      <Flex justify="center" py="8">
        <Spinner size="3" />
      </Flex>
    );
  }
  if (error) {
    return (
      <Callout.Root color="red" my="4">
        <Callout.Text>{error.message}</Callout.Text>
      </Callout.Root>
    );
  }
  if (empty) {
    return (
      <Flex justify="center" py="8" direction="column" align="center" gap="2">
        <Text color="gray">Chưa có dữ liệu.</Text>
      </Flex>
    );
  }
  return <>{children}</>;
}
