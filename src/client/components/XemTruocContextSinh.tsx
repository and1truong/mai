import {
  Badge,
  Button,
  Callout,
  Card,
  Flex,
  Grid,
  Heading,
  Select,
  Text,
  TextArea,
} from "@radix-ui/themes";
import { useState } from "react";
import { api, LoiApiClient, useApi } from "../api.ts";
import { TrangThai } from "./TrangThai.tsx";
import type {
  ContextDoiTuong,
  ContextSinhSnapshot,
  ContextThuongHieu,
  HoSoDoiTuong,
  HoSoThuongHieu,
} from "../../modules/context/index.ts";

const KHONG = "khong-chon";

// Một dòng nhãn + giá trị. Trống → "chưa biết" (không bịa dữ liệu).
function Dong({ nhan, giaTri }: { nhan: string; giaTri?: string | null }) {
  return (
    <Flex gap="2" align="baseline">
      <Text size="2" color="gray" style={{ minWidth: 150 }}>
        {nhan}
      </Text>
      {giaTri ? (
        <Text size="2" style={{ whiteSpace: "pre-wrap" }}>
          {giaTri}
        </Text>
      ) : (
        <Text size="2" color="gray" style={{ fontStyle: "italic" }}>
          chưa biết
        </Text>
      )}
    </Flex>
  );
}

function DanhSach({ ds, mau }: { ds: string[]; mau?: "green" | "red" | "gray" }) {
  if (!ds.length) {
    return (
      <Text size="2" color="gray" style={{ fontStyle: "italic" }}>
        chưa biết
      </Text>
    );
  }
  return (
    <Flex direction="column" gap="1">
      {ds.map((c, i) => (
        <Text key={i} size="2" color={mau} style={{ whiteSpace: "pre-wrap" }}>
          • {c}
        </Text>
      ))}
    </Flex>
  );
}

function TheThuongHieu({ th }: { th: ContextThuongHieu | null }) {
  if (!th) return <Text color="gray">Không chọn thương hiệu.</Text>;
  const giuNguyen = th.thuat_ngu.filter((t) => t.giu_nguyen).map((t) => t.thuat_ngu);
  return (
    <Flex direction="column" gap="2">
      <Dong nhan="Hồ sơ" giaTri={`${th.ten} (revision #${th.revision_so ?? "?"})`} />
      <Dong nhan="Ngôn ngữ ưu tiên" giaTri={th.ngon_ngu_uu_tien.join(", ") || null} />
      <Dong nhan="Nguyên tắc biên tập" giaTri={th.nguyen_tac || null} />
      <Dong nhan="Thuật ngữ giữ nguyên" giaTri={giuNguyen.join(", ") || null} />
      <Flex gap="2" align="baseline">
        <Text size="2" color="gray" style={{ minWidth: 150 }}>
          Claim được duyệt
        </Text>
        <DanhSach ds={th.claim_duyet} mau="green" />
      </Flex>
      <Flex gap="2" align="baseline">
        <Text size="2" color="gray" style={{ minWidth: 150 }}>
          Claim bị cấm
        </Text>
        <DanhSach ds={th.claim_cam} mau="red" />
      </Flex>
      <Dong nhan="Asset tham chiếu" giaTri={th.assets.join(", ") || null} />
    </Flex>
  );
}

function TheDoiTuong({ dt }: { dt: ContextDoiTuong | null }) {
  if (!dt) return <Text color="gray">Không chọn đối tượng.</Text>;
  return (
    <Flex direction="column" gap="2">
      <Dong nhan="Hồ sơ" giaTri={`${dt.ten} (revision #${dt.revision_so ?? "?"})`} />
      <Dong nhan="Ngôn ngữ" giaTri={dt.ngon_ngu || null} />
      <Dong nhan="Địa điểm" giaTri={dt.dia_diem || null} />
      <Dong nhan="Kiến thức nền" giaTri={dt.kien_thuc_nen || null} />
      <Dong nhan="Mối quan tâm" giaTri={dt.moi_quan_tam || null} />
      <Dong nhan="Độ sâu" giaTri={dt.do_sau || null} />
      <Dong nhan="Từ vựng" giaTri={dt.tu_vung || null} />
      <Dong nhan="Quan hệ với tổ chức" giaTri={dt.quan_he_to_chuc || null} />
      <Dong nhan="Nhu cầu giao tiếp" giaTri={dt.nhu_cau_giao_tiep || null} />
      <Dong nhan="Nhân khẩu học" giaTri={dt.nhan_khau_hoc || null} />
    </Flex>
  );
}

// Xem trước context sinh nội dung: thương hiệu và đối tượng tách riêng,
// ghi đè theo campaign là tùy chọn. Không ghi DB.
export function XemTruocContextSinh() {
  const th = useApi<HoSoThuongHieu[]>("/api/ho-so-thuong-hieu");
  const dt = useApi<HoSoDoiTuong[]>("/api/ho-so-doi-tuong");
  const [thId, setThId] = useState(KHONG);
  const [dtId, setDtId] = useState(KHONG);
  const [ghiDe, setGhiDe] = useState("");
  const [ketQua, setKetQua] = useState<ContextSinhSnapshot | null>(null);
  const [loi, setLoi] = useState<string[]>([]);
  const [dangTai, setDangTai] = useState(false);

  async function xemTruoc() {
    setDangTai(true);
    setLoi([]);
    try {
      let ghiDeObj: Record<string, unknown> | undefined;
      if (ghiDe.trim()) {
        ghiDeObj = JSON.parse(ghiDe) as Record<string, unknown>;
      }
      const r = await api<ContextSinhSnapshot>("/api/context-sinh/xem-truoc", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          thuong_hieu_id: thId === KHONG ? undefined : thId,
          doi_tuong_id: dtId === KHONG ? undefined : dtId,
          ghi_de: ghiDeObj,
        }),
      });
      setKetQua(r);
    } catch (e) {
      setKetQua(null);
      if (e instanceof SyntaxError) {
        setLoi(["Ghi đè campaign phải là JSON hợp lệ."]);
      } else if (e instanceof LoiApiClient) {
        setLoi([e.message, ...(Array.isArray(e.chiTiet) ? e.chiTiet.map(String) : [])]);
      } else {
        setLoi([String(e)]);
      }
    } finally {
      setDangTai(false);
    }
  }

  return (
    <>
      <Heading size="4" mb="3">
        Xem trước context sinh nội dung
      </Heading>
      <Card mb="4">
        <Flex gap="3" align="end" wrap="wrap">
          <label>
            <Text size="2" color="gray">
              Thương hiệu
            </Text>
            <Select.Root value={thId} onValueChange={setThId}>
              <Select.Trigger />
              <Select.Content>
                <Select.Item value={KHONG}>Không dùng</Select.Item>
                {th.data?.map((h) => (
                  <Select.Item key={h.id} value={h.id}>
                    {h.ten}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select.Root>
          </label>
          <label>
            <Text size="2" color="gray">
              Đối tượng
            </Text>
            <Select.Root value={dtId} onValueChange={setDtId}>
              <Select.Trigger />
              <Select.Content>
                <Select.Item value={KHONG}>Không dùng</Select.Item>
                {dt.data?.map((d) => (
                  <Select.Item key={d.id} value={d.id}>
                    {d.ten}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select.Root>
          </label>
          <Button onClick={xemTruoc} disabled={dangTai}>
            Xem trước
          </Button>
        </Flex>
        <label style={{ display: "block", marginTop: 12 }}>
          <Text size="2" color="gray">
            Ghi đè campaign (JSON, tùy chọn). Ví dụ:{" "}
            {`{"doi_tuong":{"do_sau":"so_luoc","tu_vung":"đơn giản, ít thuật ngữ"}}`}
          </Text>
          <TextArea rows={2} value={ghiDe} onChange={(e) => setGhiDe(e.target.value)} />
        </label>
        {loi.length > 0 && (
          <Callout.Root color="red" mt="3">
            {loi.map((l, i) => (
              <Callout.Text key={i}>{l}</Callout.Text>
            ))}
          </Callout.Root>
        )}
      </Card>

      {ketQua && (
        <Grid columns="2" gap="4" mb="5">
          <Card>
            <Text size="2" weight="bold" as="p" mb="2">
              Ràng buộc thương hiệu <Badge>riêng</Badge>
            </Text>
            <TheThuongHieu th={ketQua.thuong_hieu} />
          </Card>
          <Card>
            <Text size="2" weight="bold" as="p" mb="2">
              Sở thích đối tượng <Badge>riêng</Badge>
            </Text>
            <TheDoiTuong dt={ketQua.doi_tuong} />
          </Card>
          {(ketQua.ghi_de.thuong_hieu || ketQua.ghi_de.doi_tuong) && (
            <Card style={{ gridColumn: "1 / -1" }}>
              <Text size="2" weight="bold" as="p" mb="2">
                Ghi đè campaign đã áp
              </Text>
              <pre style={{ whiteSpace: "pre-wrap", fontSize: 12 }}>
                {JSON.stringify(ketQua.ghi_de, null, 2)}
              </pre>
            </Card>
          )}
        </Grid>
      )}
    </>
  );
}
