import type { Database } from "bun:sqlite";
import { taiCauHinh } from "../config.ts";
import { log } from "../log.ts";
import { taoDoiTuong, taoThuongHieu, thayThuatNgu } from "../modules/context/index.ts";
import {
  chuyenTrangThai,
  ghiSuKien,
  layBanTheHien,
  taoBanTheHien,
  taoNguon,
  taoThongDiep,
  themRevision,
  xuatBanBanTheHien,
} from "../modules/content/index.ts";
import { deXuatDauRa, type DauRaDeXuat } from "../modules/luong/index.ts";
import { chayMigration, moDb } from "./db.ts";

// Seed demo tối thiểu: 3 hồ sơ thương hiệu, 3 hồ sơ đối tượng (fixture),
// 1 bài viết (nguồn + thông điệp + bản thể hiện 'bai-viet' revision 1).
// Dùng id cố định + kiểm tra tồn tại → chạy lại nhiều lần được (idempotent).
// la_fixture = 1 và nguon_du_lieu = 'he_thong' đánh dấu dữ liệu demo do hệ thống gợi ý.

type DauVaoThuongHieu = Parameters<typeof taoThuongHieu>[1];
type DauVaoDoiTuong = Parameters<typeof taoDoiTuong>[1];
const TUY_CHON_FIXTURE = { nguonDuLieu: "he_thong" as const, laFixture: true };

function themThuongHieu(db: Database, id: string, input: DauVaoThuongHieu, tacGia: string): void {
  if (db.query("SELECT id FROM ho_so_thuong_hieu WHERE id = ?").get(id)) return;
  taoThuongHieu(db, input, tacGia, { ...TUY_CHON_FIXTURE, id });
}

function themDoiTuong(db: Database, id: string, input: DauVaoDoiTuong, tacGia: string): void {
  if (db.query("SELECT id FROM ho_so_doi_tuong WHERE id = ?").get(id)) return;
  taoDoiTuong(db, input, tacGia, { ...TUY_CHON_FIXTURE, id });
}

export function seed(db: Database, tacGia = "demo"): { da_seed: string[] } {
  const daSeed: string[] = [];

  // --- Hồ sơ thương hiệu fixture: creator solo, tiệm bánh, nhà xuất bản Phúc Âm ---
  const truoc = db.query("SELECT COUNT(*) AS c FROM ho_so_thuong_hieu").get() as { c: number };

  themThuongHieu(
    db,
    "seed-th-creator",
    {
      ten: "Creator solo — kênh kỹ thuật (fixture)",
      nhan_dien: "Một người làm kênh kỹ thuật độc lập. Viết từ kinh nghiệm thật, không quảng cáo.",
      ngon_ngu_uu_tien: ["vi", "en"],
      vi_du_giong_van: "Tôi vừa migrate 30k dòng sang Bun. Đây là 3 bài học rút ra.",
      nguyen_tac: "Ngắn gọn. Có số liệu khi nói về hiệu năng. Không hype.",
      claim_duyet: [
        "Nội dung do một người viết, không qua agency.",
        "Code ví dụ đều chạy được, kèm repo mẫu.",
      ],
      claim_cam: ["Công cụ tốt nhất thị trường", "Cam kết tuyệt đối về hiệu năng"],
      assets: ["logo-creator.png"],
    },
    tacGia,
  );

  themThuongHieu(
    db,
    "seed-th-tiem-banh",
    {
      ten: "Tiệm bánh địa phương (fixture)",
      nhan_dien: "Tiệm bánh gia đình khu phố. Bánh làm trong ngày, nguyên liệu quen thuộc.",
      ngon_ngu_uu_tien: ["vi"],
      vi_du_giong_van: "Bánh mì ra lò 6h sáng mỗi ngày.",
      nguyen_tac: "Thân mật như nói chuyện với khách quen. Không dùng từ marketing sáo rỗng.",
      claim_duyet: ["Bánh nướng trong ngày, không để qua đêm.", "Địa chỉ và giờ mở cửa ghi đúng."],
      claim_cam: ["Bánh ngon nhất thành phố", "Nguyên liệu nhập khẩu 100%"],
      assets: [],
    },
    tacGia,
  );

  themThuongHieu(
    db,
    "seed-th-nxb-phuc-am",
    {
      ten: "Nhà xuất bản Phúc Âm (fixture)",
      nhan_dien: "Nhà xuất bản sách thần học tiếng Việt. Biên tập cẩn trọng, giữ đúng thuật ngữ.",
      ngon_ngu_uu_tien: ["vi", "en"],
      vi_du_giong_van: "Bản dịch trung thành, chú thích rõ nguồn.",
      nguyen_tac:
        "Giữ nguyên thuật ngữ thần học đã duyệt ở mọi ngôn ngữ. Không viết lại giáo lý. Trích dẫn Kinh Thánh kèm tham chiếu.",
      claim_duyet: [
        "Thuật ngữ thần học theo bảng thuật ngữ đã duyệt.",
        "Mọi trích dẫn có tham chiếu sách/chương/câu.",
      ],
      claim_cam: ["Giải thích giáo lý bằng ngôn ngữ đời thường", "Gán tên thánh/khải huyền tùy tiện"],
      assets: ["mau-bia.png"],
    },
    tacGia,
  );

  // Bảng dịch thuật ngữ của nhà xuất bản: thuật ngữ thần học đã duyệt,
  // giữ nguyên ở mọi ngôn ngữ được yêu cầu.
  if (
    db.query("SELECT id FROM ho_so_thuong_hieu WHERE id = 'seed-th-nxb-phuc-am'").get() &&
    !db.query("SELECT id FROM thuat_ngu WHERE thuong_hieu_id = 'seed-th-nxb-phuc-am'").get()
  ) {
    thayThuatNgu(
      db,
      "seed-th-nxb-phuc-am",
      [
        { thuat_ngu: "Phúc Âm", giu_nguyen: true, ban_dich: { en: "the Gospel" } },
        { thuat_ngu: "Đức Chúa Trời", giu_nguyen: true, ban_dich: { en: "God" } },
        { thuat_ngu: "Sự cứu rỗi", giu_nguyen: true, ban_dich: { en: "salvation" } },
        { thuat_ngu: "Phép báp-têm", giu_nguyen: true, ban_dich: { en: "baptism" } },
        { thuat_ngu: "nhà thờ", giu_nguyen: false, ban_dich: { en: "church" } },
      ],
      tacGia,
      "he_thong",
    );
  }

  const sau = db.query("SELECT COUNT(*) AS c FROM ho_so_thuong_hieu").get() as { c: number };
  if (sau.c > truoc.c) daSeed.push("ho_so_thuong_hieu");

  // --- Hồ sơ đối tượng fixture ---
  const truocDt = db.query("SELECT COUNT(*) AS c FROM ho_so_doi_tuong").get() as { c: number };

  themDoiTuong(
    db,
    "seed-dt-ky-su",
    {
      ten: "Kỹ sư (fixture)",
      ngon_ngu: "vi",
      dia_diem: "",
      kien_thuc_nen: "Lập trình viên, đọc được code và sơ đồ kiến trúc.",
      moi_quan_tam: "Chi tiết hiện thực, trade-off, benchmark.",
      do_sau: "chuyen_sau",
      tu_vung: "Thuật ngữ kỹ thuật nguyên bản; giải thích ngắn khi cần.",
      quan_he_to_chuc: "Người theo dõi kênh kỹ thuật.",
      nhu_cau_giao_tiep: "Đi thẳng vào chi tiết kỹ thuật, có ví dụ code.",
      nhan_khau_hoc: "",
    },
    tacGia,
  );

  themDoiTuong(
    db,
    "seed-dt-khong-chuyen",
    {
      ten: "Người đọc không chuyên (fixture)",
      ngon_ngu: "vi",
      dia_diem: "",
      kien_thuc_nen: "Không có nền kỹ thuật.",
      moi_quan_tam: "Lợi ích thực tế, câu chuyện dễ nhớ.",
      do_sau: "so_luoc",
      tu_vung: "Tránh thuật ngữ. Dùng ví dụ đời thường.",
      quan_he_to_chuc: "Độc giả phổ thông.",
      nhu_cau_giao_tiep: "Câu ngắn, giải thích từng khái niệm một lần.",
      nhan_khau_hoc: "",
    },
    tacGia,
  );

  themDoiTuong(
    db,
    "seed-dt-moi",
    {
      ten: "Độc giả mới (fixture)",
      ngon_ngu: "vi",
      // Cố ý để trống phần còn lại: demo hiển thị "chưa biết", không bịa dữ liệu.
    },
    tacGia,
  );

  // Đối tượng "lãnh đạo kỹ thuật" của story #6: cùng một ý tưởng kỹ thuật
  // nhưng quan tâm tác động vận hành hơn cơ chế — bản viết cho nhóm này
  // phải đổi trọng tâm, không chỉ đổi nhãn.
  themDoiTuong(
    db,
    "seed-dt-lanh-dao",
    {
      ten: "Lãnh đạo kỹ thuật (fixture)",
      ngon_ngu: "vi",
      dia_diem: "",
      kien_thuc_nen: "Quản lý kỹ thuật; nắm được hệ thống phân tán ở mức khái niệm, không cần chi tiết code.",
      moi_quan_tam: "Tác động vận hành, độ tin cậy dịch vụ, chi phí sự cố và rủi ro lan truyền.",
      do_sau: "vua_phai",
      tu_vung: "Thuật ngữ vận hành phổ biến; giải thích khái niệm kỹ thuật qua hệ quả.",
      quan_he_to_chuc: "Quản lý và đồng nghiệp kết nối qua LinkedIn.",
      nhu_cau_giao_tiep: "Bài ngắn trên mạng xã hội/LinkedIn; kết luận trước, bằng chứng sau.",
      nhan_khau_hoc: "",
    },
    tacGia,
  );

  const sauDt = db.query("SELECT COUNT(*) AS c FROM ho_so_doi_tuong").get() as { c: number };
  if (sauDt.c > truocDt.c) daSeed.push("ho_so_doi_tuong");

  // --- Bài viết demo qua service dùng chung: nguồn + thông điệp + bản
  // thể hiện 'bai-viet' + revision 1. Đi qua service (không SQL thô) để seed tự
  // ghi revision/su_kien đúng contract.
  if (!db.query("SELECT id FROM nguon WHERE id = 'seed-nguon-1'").get()) {
    const nguon = taoNguon(
      db,
      {
        tieu_de: "Nguồn demo: giới thiệu MAI",
        noi_dung: [
          "MAI là nền tảng nội dung độc lập, deploy một gói duy nhất.",
          "Một instance sở hữu một thư viện nội dung.",
          "Chạy local với fixture AI, không cần credential.",
        ].join("\n"),
        loai: "van_ban",
      },
      tacGia,
      { id: "seed-nguon-1" },
    );
    const thongDiep = taoThongDiep(
      db,
      { tieu_de: nguon.tieu_de, noi_dung: nguon.noi_dung, nguon_ids: [nguon.id] },
      tacGia,
      { id: "seed-td-1" },
    );
    taoBanTheHien(
      db,
      { thong_diep_id: thongDiep.id, dinh_dang: "bai-viet", doi_tuong: "chung" },
      tacGia,
      { id: "seed-bth-1" },
    );
    themRevision(
      db,
      {
        ban_the_hien_id: "seed-bth-1",
        noi_dung: [
          "# Nguồn demo: giới thiệu MAI",
          "",
          "- Kênh: web",
          "- Đối tượng: chung",
          "",
          "MAI là nền tảng nội dung độc lập, deploy một gói duy nhất. Một instance sở hữu một thư viện nội dung. Chạy local với fixture AI, không cần credential.",
        ].join("\n"),
        dua_tren_revision_id: null,
      },
      tacGia,
    );
    daSeed.push("bai_viet");
  }

  // --- Story #6: creator solo phân phối bài "retry amplification" ---
  // Một nguồn nội dung thật → một thông điệp → một kế hoạch 'da_chon' + 8
  // đầu ra có nội dung viết tay đúng canonical JSON (demo data, không qua
  // provider): bản kỹ sư giải thích cơ chế, bản lãnh đạo giải thích tác
  // động vận hành, newsletter có lời mở cá nhân để sửa — không bịa số
  // liệu sự cố hay trải nghiệm cá nhân. Trạng thái rải đủ vòng đời để
  // walkthrough chạy ngay: bài viết + bài LinkedIn đã duyệt và đã xuất
  // (bài viết → trang /p/<id>; LinkedIn gắn nhãn "đã xuất"), thread +
  // script dài chờ duyệt, ba script ngắn còn là nháp.
  if (!db.query("SELECT id FROM ke_hoach WHERE id = 'seed-kh-retry'").get()) {
    const nguon = taoNguon(
      db,
      {
        tieu_de: "Retry amplification: khi retry làm sự cố tệ hơn",
        noi_dung: NOI_DUNG_NGUON_RETRY,
        loai: "van_ban",
      },
      tacGia,
      { id: "seed-nguon-retry" },
    );
    const td = taoThongDiep(
      db,
      {
        tieu_de: nguon.tieu_de,
        noi_dung:
          "Retry là cơ chế phục hồi quen thuộc nhưng dễ khuếch đại sự cố: mỗi tầng retry nhân thêm hệ số tải (hai tầng cho phép 3 lần thử biến một request thành 9 lượt gọi vào tầng cuối). Kiểm soát bằng backoff + jitter, retry budget, circuit breaker; chỉ retry request idempotent; hedged request tính vào budget.",
        nguon_ids: [nguon.id],
      },
      tacGia,
      { id: "seed-td-retry" },
    );
    const tdRevId = td.head_revision_id;

    const dsChon: DauRaDeXuat[] = [
      { doi_tuong_id: "seed-dt-ky-su", dinh_dang: "bai-viet", ngon_ngu: "vi" },
      { doi_tuong_id: null, dinh_dang: "newsletter", ngon_ngu: "vi" },
      {
        doi_tuong_id: "seed-dt-lanh-dao",
        dinh_dang: "caption",
        ngon_ngu: "vi",
        dich_den: "linkedin",
      },
      {
        doi_tuong_id: "seed-dt-ky-su",
        dinh_dang: "thread",
        ngon_ngu: "vi",
        dich_den: "x",
      },
      { doi_tuong_id: null, dinh_dang: "script-dai", ngon_ngu: "vi", dich_den: "youtube" },
      { doi_tuong_id: null, dinh_dang: "script-ngan", ngon_ngu: "vi", dich_den: "video-ngan-1" },
      { doi_tuong_id: null, dinh_dang: "script-ngan", ngon_ngu: "vi", dich_den: "video-ngan-2" },
      { doi_tuong_id: null, dinh_dang: "script-ngan", ngon_ngu: "vi", dich_den: "video-ngan-3" },
    ];
    const ts = new Date().toISOString();
    db.query(
      `INSERT INTO ke_hoach (id, thong_diep_id, nguon_id, intake, cta, de_xuat_dau_ra, ds_chon, trang_thai, tao_luc, tao_boi, cap_nhat_luc, cap_nhat_boi)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'da_chon', ?, ?, ?, ?)`,
    ).run(
      "seed-kh-retry",
      td.id,
      nguon.id,
      "Tôi vừa viết về retry amplification. Giúp tôi truyền đạt nó tới các đối tượng của tôi.",
      "",
      JSON.stringify(deXuatDauRa(db, "vi")),
      JSON.stringify(dsChon),
      ts,
      tacGia,
      ts,
      tacGia,
    );
    ghiSuKien(db, "ke_hoach", "seed-kh-retry", "tao", { thong_diep_id: td.id }, tacGia);
    ghiSuKien(db, "ke_hoach", "seed-kh-retry", "chon_dau_ra", { so: dsChon.length }, tacGia);

    for (const o of NOI_DUNG_DAU_RA_RETRY) {
      taoBanTheHien(
        db,
        {
          thong_diep_id: td.id,
          dinh_dang: o.dinh_dang,
          ngon_ngu: "vi",
          doi_tuong: o.doi_tuong,
          dich_den: o.dich_den,
        },
        tacGia,
        { id: o.id },
      );
      themRevision(
        db,
        {
          ban_the_hien_id: o.id,
          noi_dung: o.noi_dung,
          dua_tren_revision_id: null,
          thong_diep_revision_id: tdRevId,
        },
        tacGia,
      );
      if (o.trang_thai === "nhap") continue;
      chuyenTrangThai(db, o.id, "cho_duyet", "seed: gửi duyệt", tacGia);
      if (o.trang_thai === "cho_duyet") continue;
      const head = layBanTheHien(db, o.id)?.head_revision_id ?? undefined;
      chuyenTrangThai(db, o.id, "da_duyet", "seed: duyệt", tacGia, head);
      if (o.xuat_ban) {
        xuatBanBanTheHien(db, o.id, { dich_den: o.dich_den || undefined }, tacGia);
      }
    }
    daSeed.push("story_creator");
  }

  return { da_seed: daSeed };
}

// --- Nội dung story #6 (viết tay, canonical JSON theo schema định dạng) ---

const NOI_DUNG_NGUON_RETRY = `## Bối cảnh

Retry là cơ chế phục hồi quen thuộc: request lỗi thì gọi lại. Vấn đề là retry không kiểm soát biến một lỗi nhỏ thành tải gấp nhiều lần — đúng lúc hệ thống đang yếu nhất.

## Cơ chế khuếch đại

Service A gọi service B, cho phép tối đa 3 lần thử. Service B gọi service C, cũng 3 lần thử. Một request vào A sinh tối đa 3 request vào B, và mỗi request vào B sinh tối đa 3 request vào C — một lỗi ở C chịu tới 9 lượt gọi.

Mỗi tầng retry nhân thêm một hệ số. Chiều sâu chuỗi gọi quyết định mức khuếch đại: thêm một tầng nữa với 3 lần thử là 27 lượt gọi vào tầng cuối. Khi tầng cuối quá tải và trả lỗi chậm, retry ở các tầng trên giữ tải không giảm — quá tải trở thành sập. Đây là retry storm.

## Dấu hiệu

- Độ trễ đuôi (p99) của tầng cuối tăng trước khi lỗi xuất hiện rõ.
- Số lượt gọi vào tầng cuối vượt hẳn số request vào tầng đầu — tỉ lệ này là hệ số khuếch đại thực tế.
- Client thấy timeout dù từng endpoint gọi trực tiếp vẫn "xanh".

## Cách giảm

- Backoff + jitter: tăng dần thời gian chờ (ví dụ 100ms, 200ms, 400ms) và cộng nhiễu ngẫu nhiên để các client không retry cùng một lúc.
- Retry budget: chỉ một tỉ lệ nhỏ request được phép là retry (ví dụ 10% trong mỗi cửa sổ thời gian). Hết budget thì fail fast.
- Circuit breaker: tỉ lệ lỗi vượt ngưỡng thì mở mạch, trả lỗi ngay không gọi xuống; sau một khoảng chờ, thử lại từng request (half-open).
- Idempotency: chỉ retry request an toàn để lặp. Với request thay đổi dữ liệu, client gửi request-id để server dedupe.
- Hedged request: gửi bản sao song song sau độ trễ p95 — vẫn là một dạng retry sớm, phải tính vào budget.

## Kết

Retry là chi phí trả trước để đổi availability. Không có budget thì chi phí đó nhân lên theo chiều sâu chuỗi gọi, và hóa đơn đến đúng lúc hệ thống yếu nhất. Mỗi năm vẫn có những postmortem viết lại đúng một nguyên nhân này.`;

const NOI_DUNG_DAU_RA_RETRY: {
  id: string;
  dinh_dang: string;
  doi_tuong: string;
  dich_den: string;
  trang_thai: "nhap" | "cho_duyet" | "da_duyet";
  xuat_ban: boolean;
  noi_dung: string;
}[] = [
  {
    id: "seed-bth-retry-bai-viet",
    dinh_dang: "bai-viet",
    doi_tuong: "Kỹ sư (fixture)",
    dich_den: "",
    trang_thai: "da_duyet",
    xuat_ban: true,
    noi_dung: JSON.stringify({
      tieu_de: "Retry amplification: khi retry làm sự cố tệ hơn",
      noi_dung: `## Cơ chế

A gọi B cho phép 3 lần thử; B gọi C cũng 3 lần thử. Một request vào A sinh tối đa 3 request vào B và 9 request vào C. Hệ số nhân theo chiều sâu chuỗi gọi — đây là retry amplification.

Khi C quá tải và trả lỗi chậm, retry ở các tầng trên giữ nguyên tải vào C. Quá tải trở thành sập — retry storm.

## Kiểm soát

- **Backoff + jitter**: chờ tăng dần (100ms → 200ms → 400ms), cộng nhiễu ngẫu nhiên để các client không đồng bộ lượt retry.
- **Retry budget**: chỉ ~10% request trong một cửa sổ thời gian được phép là retry; hết budget thì fail fast.
- **Circuit breaker**: lỗi vượt ngưỡng → mở mạch, trả lỗi ngay; sau khoảng chờ cho một request thử (half-open) rồi đóng lại khi ổn.
- **Idempotency**: chỉ retry request an toàn để lặp; với write, client gửi request-id để server dedupe.
- **Hedged request**: bản sao song song sau p95 — vẫn là retry sớm, tính vào budget.

## Kiểm chứng

Đo hệ số khuếch đại thực tế: số lượt gọi vào C chia số request vào A. Tỉ lệ > 1 và tăng khi C chậm nghĩa là retry đang khuếch đại chứ không phục hồi.`,
    }),
  },
  {
    id: "seed-bth-retry-newsletter",
    dinh_dang: "newsletter",
    doi_tuong: "",
    dich_den: "",
    trang_thai: "nhap",
    xuat_ban: false,
    noi_dung: JSON.stringify({
      tieu_de: "Retry amplification — khi 'gọi lại cho chắc' phản tác dụng",
      tom_tat: "Một lỗi nhỏ ở tầng cuối có thể thành 9 lượt gọi khi mỗi tầng đều retry.",
      noi_dung: `[Lời mở cá nhân — viết một câu về bối cảnh của bạn trước khi gửi.]

## Cơ chế

A gọi B cho phép 3 lần thử, B gọi C cũng 3 lần thử: một request lỗi sinh tới 9 lượt gọi vào C.

## Ba điểm chính

1. Backoff + jitter để các client không retry đồng bộ.
2. Retry budget — hết hạn mức thì fail fast.
3. Chỉ retry request idempotent; write cần request-id.

Bài phân tích đầy đủ trên blog.`,
    }),
  },
  {
    id: "seed-bth-retry-linkedin",
    dinh_dang: "caption",
    doi_tuong: "Lãnh đạo kỹ thuật (fixture)",
    dich_den: "linkedin",
    trang_thai: "da_duyet",
    xuat_ban: true,
    noi_dung: JSON.stringify({
      noi_dung: `Một sự cố nhỏ có thể tự khuếch đại thành sập vùng khi mọi service cùng retry.

Cơ chế: mỗi tầng retry nhân thêm hệ số tải — hai tầng với 3 lần thử biến một request thành 9 lượt gọi vào tầng cuối, đúng lúc tầng đó đang quá tải.

Tác động vận hành:
- Độ trễ đuôi (p99) tăng trước khi lỗi rõ.
- Sự cố lan ngang sang service không liên quan.
- Thời gian phục hồi kéo dài vì tải không giảm sau khi nguyên nhân gốc hết.

Ba kiểm soát nên nằm trong SLO review: retry budget, circuit breaker, và quy tắc chỉ retry request idempotent.

Phân tích chi tiết ở blog — link dưới comment.`,
      hashtag: "#sre #reliability #distributed-systems",
    }),
  },
  {
    id: "seed-bth-retry-thread",
    dinh_dang: "thread",
    doi_tuong: "Kỹ sư (fixture)",
    dich_den: "x",
    trang_thai: "cho_duyet",
    xuat_ban: false,
    noi_dung: JSON.stringify({
      tieu_de: "Retry amplification trong 5 bài",
      cac_muc: [
        "1/ Retry không kiểm soát làm sự cố tệ hơn. A→B (3 lần thử), B→C (3 lần thử): một request lỗi thành 9 lượt gọi vào C.",
        "2/ Retry storm: tải nhân theo chiều sâu chuỗi gọi đúng lúc tầng cuối quá tải. Backoff đều nhau còn nguy hiểm — mọi client retry cùng một nhịp.",
        "3/ Chống bằng exponential backoff + jitter: chờ 100→200→400ms cộng nhiễu ngẫu nhiên để phân tán lượt retry.",
        "4/ Chặt hơn: retry budget (≤10% request là retry) + circuit breaker khi lỗi vượt ngưỡng. Hết budget thì fail fast.",
        "5/ Cuối: chỉ retry request idempotent. Write cần request-id để dedupe. Hedged request cũng là retry — tính vào budget.",
      ],
    }),
  },
  {
    id: "seed-bth-retry-youtube",
    dinh_dang: "script-dai",
    doi_tuong: "",
    dich_den: "youtube",
    trang_thai: "cho_duyet",
    xuat_ban: false,
    noi_dung: JSON.stringify({
      hook: "Một hệ thống có thể sập không phải vì lỗi ban đầu — mà vì mọi service khác cố 'giúp' nó sống lại.",
      loi_thoai: `Xin chào. Video này nói về retry amplification — khi cơ chế phục hồi quen thuộc hóa ra là thứ làm sự cố lan rộng.

## Cơ chế

Hình dung chuỗi gọi A sang B sang C. A cho phép 3 lần thử, B cũng 3 lần thử. Một request vào A sinh tối đa 3 request vào B, và mỗi cái lại sinh 3 request vào C — tổng cộng 9. Thêm một tầng nữa là 27.

Vấn đề là thời điểm: retry bùng lên đúng lúc tầng cuối đang quá tải. Tải không giảm khi nguyên nhân gốc hết — vì các tầng trên cứ gọi lại. Đó là retry storm.

## Dấu hiệu nhận biết

Một, độ trễ đuôi p99 của tầng cuối tăng trước khi lỗi rõ. Hai, lượt gọi vào tầng cuối vượt hẳn request vào tầng đầu — đó là hệ số khuếch đại thực tế. Ba, client thấy timeout dù endpoint gọi trực tiếp vẫn xanh.

## Cách kiểm soát

Thứ nhất, exponential backoff cộng jitter: chờ tăng dần, thêm nhiễu để client không retry đồng bộ. Thứ hai, retry budget: chỉ khoảng 10% request được là retry, hết budget thì fail fast. Thứ ba, circuit breaker: lỗi vượt ngưỡng thì mở mạch, chờ rồi thử half-open.

Và một nguyên tắc nền: chỉ retry request idempotent. Với write, client gửi request-id để server dedupe. Hedged request — gửi bản sao sau p95 — cũng là retry, phải tính vào budget.

## Kết

Retry là chi phí trả trước cho availability. Không kiểm soát thì chi phí nhân theo chiều sâu chuỗi gọi — và hóa đơn đến đúng lúc hệ thống yếu nhất.`,
      canh: [
        "Sơ đồ chuỗi gọi A→B→C, hiện hệ số 3×3=9",
        "Đồ thị độ trễ p99 tăng dần khi retry bùng",
        "Đoạn code mẫu: vòng retry có backoff + jitter",
        "Timeline: mở circuit breaker → half-open → đóng",
      ],
      cta: "Đăng ký kênh để xem phần tiếp về circuit breaker; bài viết đầy đủ ở phần mô tả.",
    }),
  },
  {
    id: "seed-bth-retry-ngan-1",
    dinh_dang: "script-ngan",
    doi_tuong: "",
    dich_den: "video-ngan-1",
    trang_thai: "nhap",
    xuat_ban: false,
    noi_dung: JSON.stringify({
      hook: "9 request chỉ từ một request lỗi — đây là retry amplification.",
      loi_thoai:
        "Một request vào A, retry 3 lần sang B. Mỗi request vào B lại retry 3 lần sang C. Một lỗi nhỏ ở C chịu 9 lượt gọi — ngay khi nó đang quá tải.",
      canh: ["Sơ đồ A→B→C đếm 1→3→9", "Text overlay: retry amplification"],
      cta: "Xem bài đầy đủ trên blog.",
    }),
  },
  {
    id: "seed-bth-retry-ngan-2",
    dinh_dang: "script-ngan",
    doi_tuong: "",
    dich_den: "video-ngan-2",
    trang_thai: "nhap",
    xuat_ban: false,
    noi_dung: JSON.stringify({
      hook: "Vẽ một đường gọi lên bảng — rồi nhân nó lên 9 lần.",
      loi_thoai:
        "Retry có ích khi lỗi ngẫu nhiên. Nhưng khi tầng cuối quá tải, mọi tầng trên cùng retry một lúc — tải nhân theo cấp số, quá tải thành sập. Backoff + jitter và retry budget là hai thứ cần có trước.",
      canh: ["Vẽ sơ đồ trên giấy/tablet", "Đồ thị tải tăng vọt"],
      cta: "Đọc phân tích đầy đủ — link ở bio.",
    }),
  },
  {
    id: "seed-bth-retry-ngan-3",
    dinh_dang: "script-ngan",
    doi_tuong: "",
    dich_den: "video-ngan-3",
    trang_thai: "nhap",
    xuat_ban: false,
    noi_dung: JSON.stringify({
      hook: "Trước khi thêm retry, kiểm tra ba thứ này.",
      loi_thoai:
        "Một: request có idempotent không — write cần request-id. Hai: đã có backoff + jitter chưa. Ba: có retry budget không — hết budget phải fail fast. Thiếu một trong ba, retry sẵn sàng khuếch đại sự cố.",
      canh: ["Checklist ba mục hiện dần trên màn hình"],
      cta: "Lưu video lại cho lần review kiến trúc sau.",
    }),
  },
];

if (import.meta.main) {
  const cauHinh = await taiCauHinh();
  const db = moDb(cauHinh.dataDir);
  chayMigration(db);
  const ketQua = seed(db);
  log.info("seed.xong", { dataDir: cauHinh.dataDir, ...ketQua });
  db.close();
}
