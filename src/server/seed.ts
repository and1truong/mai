import type { Database } from "bun:sqlite";
import { taiCauHinh } from "../config.ts";
import { log } from "../log.ts";
import { taoDoiTuong, taoThuongHieu, thayThuatNgu } from "../modules/context/index.ts";
import {
  taoBanTheHien,
  taoNguon,
  taoThongDiep,
  themRevision,
} from "../modules/content/index.ts";
import { chayMigration, moDb } from "./db.ts";

// Seed demo tối thiểu: 3 hồ sơ thương hiệu, 3 hồ sơ đối tượng (fixture),
// 1 bài viết (nguồn + thông điệp + bản thể hiện 'web' revision 1).
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

  const sauDt = db.query("SELECT COUNT(*) AS c FROM ho_so_doi_tuong").get() as { c: number };
  if (sauDt.c > truocDt.c) daSeed.push("ho_so_doi_tuong");

  // --- Bài viết demo qua service dùng chung: nguồn + thông điệp + bản
  // thể hiện 'web' + revision 1. Đi qua service (không SQL thô) để seed tự
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
      { thong_diep_id: thongDiep.id, dinh_dang: "web", doi_tuong: "chung" },
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

  return { da_seed: daSeed };
}

if (import.meta.main) {
  const cauHinh = await taiCauHinh();
  const db = moDb(cauHinh.dataDir);
  chayMigration(db);
  const ketQua = seed(db);
  log.info("seed.xong", { dataDir: cauHinh.dataDir, ...ketQua });
  db.close();
}
