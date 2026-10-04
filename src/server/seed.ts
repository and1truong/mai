import type { Database } from "bun:sqlite";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { taiCauHinh } from "../config.ts";
import { log } from "../log.ts";
import { taoDoiTuong, taoThuongHieu, thayThuatNgu } from "../modules/context/index.ts";
import {
  capNhatCampaign,
  chuyenTrangThai,
  ghiSuKien,
  layBanTheHien,
  taoBanTheHien,
  taoCampaign,
  taoNguon,
  taoThongDiep,
  themRevision,
  xuatBanBanTheHien,
} from "../modules/content/index.ts";
import { deXuatMucLuc } from "../modules/so_bao/index.ts";
import {
  datAssetBanTheHien,
  duongDanTepAsset,
  kiemTraByteAsset,
  layAsset,
  sachTenFile,
  timAssetTheoChecksum,
} from "../modules/nap/index.ts";
import {
  deXuatDauRa,
  ghepNoiDungThongBao,
  type DauRaDeXuat,
  type FactSuKien,
} from "../modules/luong/index.ts";
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

export function seed(
  db: Database,
  tacGia = "demo",
  tuyChon: { dataDir?: string } = {},
): { da_seed: string[] } {
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

  // --- Story #7: tiệm bánh — ra mắt sản phẩm từ một thông báo đơn giản ---
  // Intake một câu của chủ tiệm → kế hoạch đã chọn bundle đa kênh (thông báo
  // web → trang /p/, caption Instagram kèm ảnh, script TikTok, bài đăng Google
  // Business, nháp email khách) với fact đã xác nhận ghép vào thông điệp: cùng
  // ngày ra mắt, tên sản phẩm, giá và CTA nhất quán trên mọi bản. Đăng tay trên
  // mọi kênh ngoài — MAI không tự đăng.
  if (!db.query("SELECT id FROM ke_hoach WHERE id = 'seed-kh-tiem-banh'").get()) {
    themDoiTuong(
      db,
      "seed-dt-khach-quen",
      {
        ten: "Khách quen khu phố (fixture)",
        ngon_ngu: "vi",
        dia_diem: "Khu phố quanh tiệm bánh.",
        kien_thuc_nen: "Không cần biết thuật ngữ ngành bánh.",
        moi_quan_tam: "Bánh mới, giờ mở cửa, cách đặt trước.",
        do_sau: "so_luoc",
        tu_vung: "Đời thường, thân mật.",
        quan_he_to_chuc: "Khách quen theo tiệm trên mạng xã hội.",
        nhu_cau_giao_tiep: "Tin ngắn trên mạng xã hội và email; rõ ngày giờ, giá, cách đặt.",
        nhan_khau_hoc: "",
      },
      tacGia,
    );

    // Fact doanh nghiệp: địa chỉ, giờ mở cửa, sản phẩm, asset, giọng văn.
    const nguonFact = taoNguon(
      db,
      {
        tieu_de: "Fact tiệm bánh: địa chỉ, giờ mở cửa, sản phẩm",
        noi_dung: [
          "Tiệm bánh địa phương — fact doanh nghiệp.",
          "Địa chỉ: 123 Đường Láng, Hà Nội.",
          "Giờ mở cửa: 6h30–20h00 hằng ngày.",
          "Sản phẩm mới: bánh croissant hạt dẻ — vỏ giòn nhiều lớp, nhân hạt dẻ rang xay.",
          "Link đặt hàng: https://tiembanh.example.com/dat-hang",
          "Giọng văn: thân mật như nói chuyện với khách quen.",
        ].join("\n"),
        loai: "van_ban",
      },
      tacGia,
      { id: "seed-nguon-fact-tiem-banh" },
    );

    const intake = TB_INTAKE;
    const td = taoThongDiep(
      db,
      {
        tieu_de: "Ra mắt bánh croissant hạt dẻ",
        noi_dung: ghepNoiDungThongBao(intake, TB_FACT, TB_CTA),
        nguon_ids: [nguonFact.id],
      },
      tacGia,
      { id: "seed-td-tiem-banh" },
    );
    const tdRevId = td.head_revision_id;

    // Ảnh sản phẩm thật do tiệm cung cấp (fixture trong repo) — đính kèm caption
    // Instagram. Bản Google Business cố ý không có ảnh để demo ô yêu cầu/upload.
    let dsAssetIg: string[] = [];
    if (tuyChon.dataDir) {
      const assetId = ghiAssetFixture(db, tuyChon.dataDir, nguonFact.id, tacGia);
      if (assetId) dsAssetIg = [assetId];
    }

    const dsChon: DauRaDeXuat[] = [
      { doi_tuong_id: null, dinh_dang: "bai-viet", ngon_ngu: "vi" },
      { doi_tuong_id: null, dinh_dang: "caption", ngon_ngu: "vi", dich_den: "instagram" },
      { doi_tuong_id: null, dinh_dang: "script-ngan", ngon_ngu: "vi", dich_den: "tiktok" },
      {
        doi_tuong_id: null,
        dinh_dang: "google-business",
        ngon_ngu: "vi",
        dich_den: "google-business",
      },
      { doi_tuong_id: null, dinh_dang: "email-khach", ngon_ngu: "vi", dich_den: "email" },
    ];
    const ts = new Date().toISOString();
    db.query(
      `INSERT INTO ke_hoach (id, thong_diep_id, nguon_id, intake, cta, fact, de_xuat_dau_ra, ds_chon, trang_thai, tao_luc, tao_boi, cap_nhat_luc, cap_nhat_boi)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'da_chon', ?, ?, ?, ?)`,
    ).run(
      "seed-kh-tiem-banh",
      td.id,
      nguonFact.id,
      intake,
      TB_CTA,
      JSON.stringify(TB_FACT),
      JSON.stringify(deXuatDauRa(db, "vi", intake)),
      JSON.stringify(dsChon),
      ts,
      tacGia,
      ts,
      tacGia,
    );
    ghiSuKien(db, "ke_hoach", "seed-kh-tiem-banh", "tao", { thong_diep_id: td.id }, tacGia);
    ghiSuKien(db, "ke_hoach", "seed-kh-tiem-banh", "chon_dau_ra", { so: dsChon.length }, tacGia);

    for (const o of NOI_DUNG_DAU_RA_TIEM_BANH) {
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
      // Ảnh đính kèm trước xuất bản → manifest bundle snapshot đúng asset.
      if (o.id === "seed-bth-tb-ig" && dsAssetIg.length > 0) {
        datAssetBanTheHien(db, o.id, dsAssetIg, tacGia);
      }
      if (o.trang_thai === "nhap") continue;
      chuyenTrangThai(db, o.id, "cho_duyet", "seed: gửi duyệt", tacGia);
      if (o.trang_thai === "cho_duyet") continue;
      const head = layBanTheHien(db, o.id)?.head_revision_id ?? undefined;
      chuyenTrangThai(db, o.id, "da_duyet", "seed: duyệt", tacGia, head);
      if (o.xuat_ban) {
        xuatBanBanTheHien(db, o.id, {
          dich_den: o.dich_den || undefined,
          asset_ids: o.id === "seed-bth-tb-ig" ? dsAssetIg : [],
        }, tacGia);
      }
    }
    daSeed.push("story_tiem_banh");
  }

  // --- Story #8: nhà xuất bản Phúc Âm — lên kế hoạch số 002 ---
  // Campaign số báo đầy đủ field (số thứ tự, ngày phát hành, chủ đề, lập
  // trường biên tập, chủ biên, hồ sơ dùng lại); mục lục 8 khay từ mẫu đề
  // xuất; tham chiếu Khải Huyền 7 và 14 có văn bản nguồn thật (Bản dịch
  // truyền thống) + ghi chú biên tập đã duyệt, tham chiếu Khải Huyền 5 cố ý
  // chưa nạp văn bản → cờ + gợi ý khoảng trống. Đầu ra rải đủ vòng đời:
  // bài chính đã duyệt + đã xuất (phục vụ /p/…), bài học chờ duyệt, bài
  // giải thích thiếu niên bị từ chối nhưng giữ nguyên diễn giải/bằng chứng
  // đã duyệt, hỏi-đáp + bản website còn nháp.
  if (!db.query("SELECT id FROM campaign WHERE id = 'seed-cp-so-002'").get()) {
    themDoiTuong(
      db,
      "seed-dt-doc-gia-phuc-am",
      {
        ten: "Độc giả Phúc Âm (fixture)",
        ngon_ngu: "vi",
        dia_diem: "Bạn đọc báo Phúc Âm ở Việt Nam và hải ngoại.",
        kien_thuc_nen: "Đọc Kinh Thánh thường kỳ; quen thuật ngữ thần học cơ bản.",
        moi_quan_tam: "Hiểu đoạn kinh văn theo bối cảnh; áp dụng vào đời sống.",
        do_sau: "vua_phai",
        tu_vung: "Thuật ngữ thần học đã duyệt; giải thích từ hiếm khi cần.",
        quan_he_to_chuc: "Hội thánh, nhóm học tài liệu nền, độc giả báo.",
        nhu_cau_giao_tiep: "Bài dài có dẫn chứng; tham chiếu sách/chương/câu rõ.",
        nhan_khau_hoc: "Người lớn, đa số trong hội thánh.",
      },
      tacGia,
    );
    themDoiTuong(
      db,
      "seed-dt-thieu-nien",
      {
        ten: "Thiếu niên (fixture)",
        ngon_ngu: "vi",
        dia_diem: "Thiếu niên trong hội thánh và gia đình độc giả.",
        kien_thuc_nen: "Chưa đọc nhiều kinh văn; cần giải thích bối cảnh từ đầu.",
        moi_quan_tam: "Câu hỏi thẳng, ví dụ đời thường, hình ảnh dễ nhớ.",
        do_sau: "so_luoc",
        tu_vung: "Đời thường; hạn chế thuật ngữ thần học, giải thích khi bắt buộc.",
        quan_he_to_chuc: "Nhóm thanh thiếu niên, lớp tân tín, cha mẹ đọc báo.",
        nhu_cau_giao_tiep: "Bài ngắn, câu ngắn, ví dụ gần; có chỗ hỏi-thảo luận.",
        nhan_khau_hoc: "13–17 tuổi, học sinh.",
      },
      tacGia,
    );

    // Số 001 tối thiểu: chứng minh số 002 không tái dùng tiêu đề/chủ đề
    // số trước — mỗi số là một campaign độc lập.
    taoCampaign(
      db,
      {
        ten: "Phúc Âm — Số 001",
        mo_ta: "Số báo đầu tiên của quý.",
        so_thu_tu: 1,
        ngay_phat_hanh: "2026-10-01",
        chu_de: "Đức tin trong đời sống thường ngày",
        lap_truong: "Trình bày đức tin gần gũi, tránh tranh luận học thuật.",
        chu_bien: "Bt. Ngọc Lan",
        thuong_hieu_id: "seed-th-nxb-phuc-am",
        doi_tuong_id: "seed-dt-doc-gia-phuc-am",
      },
      tacGia,
      { id: "seed-cp-so-001" },
    );

    // Nguồn kinh văn thật (Bản dịch truyền thống) cho các tham chiếu số 002
    // — trích dẫn và tham chiếu câu đối chiếu được với nguồn này.
    const nguonKh7 = taoNguon(
      db,
      {
        tieu_de: "Khải Huyền 7:9-17 (Bản dịch truyền thống)",
        noi_dung: NOI_DUNG_KH7,
        loai: "van_ban",
      },
      tacGia,
      { id: "seed-nguon-kh7-002" },
    );
    const nguonKh14 = taoNguon(
      db,
      {
        tieu_de: "Khải Huyền 14:1-5 (Bản dịch truyền thống)",
        noi_dung: NOI_DUNG_KH14,
        loai: "van_ban",
      },
      tacGia,
      { id: "seed-nguon-kh14-002" },
    );
    // Ghi chú biên tập đã duyệt: diễn giải + bằng chứng của số — mọi đầu ra
    // phái sinh phải giữ đúng phần này, chỉ đổi từ vựng/ví dụ.
    const nguonGhiChu = taoNguon(
      db,
      {
        tieu_de: "Ghi chú biên tập số 002: diễn giải và bằng chứng đã duyệt",
        noi_dung: NOI_DUNG_GHI_CHU_002,
        loai: "van_ban",
      },
      tacGia,
      { id: "seed-nguon-ghichu-002" },
    );

    // Campaign số 002: mục lục từ mẫu đề xuất của module số báo — biên tập
    // sửa tự do sau, không tự động sinh mọi tổ hợp.
    const cp002 = taoCampaign(
      db,
      {
        ten: "Phúc Âm — Số 002",
        mo_ta:
          "Số này tập trung vào Khải Huyền 7 và 14, Chiên Con và 144.000 người.",
        so_thu_tu: 2,
        ngay_phat_hanh: "2026-11-15",
        chu_de: "Chiên Con và 144.000 người",
        lap_truong:
          "Diễn giải biểu tượng: 144.000 là hình ảnh đầy đủ của dân Chúa trong mọi thời đại. Trình bày theo lập trường này, không đọc con số theo nghĩa đen. Trích dẫn kinh văn dùng Bản dịch truyền thống, kèm tham chiếu.",
        chu_bien: "Bt. Ngọc Lan",
        thuong_hieu_id: "seed-th-nxb-phuc-am",
        doi_tuong_id: "seed-dt-doc-gia-phuc-am",
        tham_chieu: [
          {
            id: "tc-kh7",
            tham_chieu: "Khải Huyền 7:9-17",
            ban_dich: "Bản dịch truyền thống",
            nguon_id: "seed-nguon-kh7-002",
            ghi_chu: "Đám đông vô số trước ngai và Chiên Con.",
          },
          {
            id: "tc-kh14",
            tham_chieu: "Khải Huyền 14:1-5",
            ban_dich: "Bản dịch truyền thống",
            nguon_id: "seed-nguon-kh14-002",
            ghi_chu: "144.000 người cùng Chiên Con trên núi Si-ôn.",
          },
          {
            id: "tc-kh5",
            tham_chieu: "Khải Huyền 5:5-12",
            ban_dich: "Bản dịch truyền thống",
            nguon_id: null, // cố ý chưa nạp văn bản → cờ thiếu + gợi ý nạp nguồn
            ghi_chu: "Chiên Con bị sát tế đứng giữa ngai — chưa có văn bản nguồn.",
          },
        ],
      },
      tacGia,
      { id: "seed-cp-so-002" },
    );
    capNhatCampaign(
      db,
      cp002.id,
      { ten: cp002.ten, muc_luc: deXuatMucLuc(db, cp002) },
      tacGia,
    );

    // Thông điệp chủ đề của số gắn các nguồn đã nạp — mọi đầu ra của số
    // sinh dưới thông điệp này, nên provenance/trích dẫn resolve về đúng
    // văn bản nguồn thật và diễn giải đã duyệt.
    const td002 = taoThongDiep(
      db,
      {
        tieu_de: "Số 002 — Chiên Con và 144.000 người",
        noi_dung:
          "Số này tập trung vào Khải Huyền 7 và 14, Chiên Con và 144.000 người. Trình bày theo lập trường biên tập diễn giải biểu tượng của tòa soạn.",
        campaign_id: cp002.id,
        nguon_ids: [nguonKh7.id, nguonKh14.id, nguonGhiChu.id],
      },
      tacGia,
      { id: "seed-td-so-002" },
    );
    const tdRevId002 = td002.head_revision_id;

    for (const o of NOI_DUNG_DAU_RA_SO_002) {
      taoBanTheHien(
        db,
        {
          thong_diep_id: td002.id,
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
          thong_diep_revision_id: tdRevId002,
        },
        tacGia,
      );
      if (o.trang_thai === "nhap") continue;
      chuyenTrangThai(db, o.id, "cho_duyet", "seed: gửi duyệt", tacGia);
      if (o.trang_thai === "cho_duyet") continue;
      const head = layBanTheHien(db, o.id)?.head_revision_id ?? undefined;
      if (o.trang_thai === "tu_choi") {
        chuyenTrangThai(db, o.id, "tu_choi", o.ghi_chu ?? "seed: từ chối", tacGia, head);
        continue;
      }
      chuyenTrangThai(db, o.id, "da_duyet", "seed: duyệt", tacGia, head);
      if (o.xuat_ban) {
        xuatBanBanTheHien(db, o.id, { dich_den: o.dich_den || undefined }, tacGia);
      }
    }
    daSeed.push("story_so_bao_002");
  }

  return { da_seed: daSeed };
}

// Ghi file fixture ảnh của story #7 vào kho byte local + một dòng asset
// (đường service luuAsset là async; seed chạy đồng bộ nên ghi file đồng bộ
// — cùng bước validate/dedupe và cùng layout qua duongDanTepAsset, chỉ khác
// lớp ghi async). Thiếu file fixture → bỏ qua.
function ghiAssetFixture(
  db: Database,
  dataDir: string,
  nguonId: string,
  tacGia: string,
): string | null {
  const tep = join(import.meta.dir, "seed-assets", TB_FILE_ANH);
  if (!existsSync(tep)) return null;
  const byte = new Uint8Array(readFileSync(tep));
  const tenFile = sachTenFile(TB_FILE_ANH);
  const dinhNghia = kiemTraByteAsset(tenFile, byte);
  const khoaIdem = `seed:asset:${tenFile}`;
  const cu =
    (db.query("SELECT * FROM asset WHERE khoa_idem = ?").get(khoaIdem) as {
      id: string;
    } | null) ?? timAssetTheoChecksum(db, byte);
  if (cu) return cu.id;
  const id = crypto.randomUUID();
  const duongDan = `${id}${extname(tenFile).toLowerCase()}`;
  const thuMuc = resolve(dataDir, "assets");
  mkdirSync(thuMuc, { recursive: true });
  writeFileSync(duongDanTepAsset(thuMuc, duongDan), byte);
  const checksum = new Bun.CryptoHasher("sha256").update(byte).digest("hex");
  const ts = new Date().toISOString();
  db.query(
    `INSERT INTO asset
       (id, ten_file, duong_dan, loai, mime, kich_thuoc, checksum, nguon_id, ghi_chu, khoa_idem, trang_thai, tao_luc, tao_boi)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'hoat_dong', ?, ?)`,
  ).run(
    id,
    tenFile,
    duongDan,
    dinhNghia.loai,
    dinhNghia.mime,
    byte.byteLength,
    checksum,
    nguonId,
    "Ảnh sản phẩm do tiệm cung cấp (fixture).",
    khoaIdem,
    ts,
    tacGia,
  );
  ghiSuKien(db, "asset", id, "tao", { ten_file: tenFile }, tacGia);
  return layAsset(db, id)?.id ?? null;
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

// --- Nội dung story #7 (viết tay, canonical JSON theo schema định dạng) ---

const TB_INTAKE = "Tuần sau thứ Bảy tiệm ra mắt bánh croissant hạt dẻ.";
const TB_CTA = "Ghé tiệm hoặc đặt trước qua link đặt hàng.";
const TB_FACT: FactSuKien = {
  ngay_gio: "2026-10-10T08:00",
  mui_gio: "Asia/Ho_Chi_Minh",
  gia: "45.000đ",
  tinh_trang: "còn hàng trong ngày",
  link_dat_hang: "https://tiembanh.example.com/dat-hang",
};
const TB_FILE_ANH = "croissant-hat-de.webp";

// Dòng thông báo chuẩn: cùng một câu fact xuất hiện trên mọi bản — ngày
// ra mắt, giá, tình trạng, link đặt, CTA không lệch giữa các kênh (#7).
const TB_DONG_CHUAN =
  "thời gian 2026-10-10T08:00 (Asia/Ho_Chi_Minh) — giá 45.000đ — còn hàng trong ngày — đặt hàng https://tiembanh.example.com/dat-hang — " +
  TB_CTA;

const NOI_DUNG_DAU_RA_TIEM_BANH: {
  id: string;
  dinh_dang: string;
  doi_tuong: string;
  dich_den: string;
  trang_thai: "nhap" | "cho_duyet" | "da_duyet";
  xuat_ban: boolean;
  noi_dung: string;
}[] = [
  {
    // Thông báo trên trang tiệm (trang local /p/<id>).
    id: "seed-bth-tb-web",
    dinh_dang: "bai-viet",
    doi_tuong: "",
    dich_den: "",
    trang_thai: "da_duyet",
    xuat_ban: true,
    noi_dung: JSON.stringify({
      tieu_de: "Ra mắt bánh croissant hạt dẻ",
      noi_dung: `## Ra mắt bánh mới

${TB_DONG_CHUAN}

Croissant hạt dẻ: vỏ giòn nhiều lớp, nhân hạt dẻ rang xay — bánh nướng trong ngày, không để qua đêm.

Tiệm mở cửa 6h30–20h00 hằng ngày tại 123 Đường Láng, Hà Nội. Mời bạn ghé thử bánh mới vào sáng ra mắt.`,
    }),
  },
  {
    // Caption Instagram — kèm ảnh croissant do tiệm cung cấp.
    id: "seed-bth-tb-ig",
    dinh_dang: "caption",
    doi_tuong: "",
    dich_den: "instagram",
    trang_thai: "da_duyet",
    xuat_ban: true,
    noi_dung: JSON.stringify({
      noi_dung: `Bánh mới ra lò — croissant hạt dẻ 🥐

${TB_DONG_CHUAN}

Vỏ giòn nhiều lớp, nhân hạt dẻ rang xay. Tiệm ở 123 Đường Láng, mở 6h30–20h00 mỗi ngày.`,
      hashtag: "#tiembanh #croissanthatede #banhmoi",
    }),
  },
  {
    // Script TikTok ngắn.
    id: "seed-bth-tb-tiktok",
    dinh_dang: "script-ngan",
    doi_tuong: "",
    dich_den: "tiktok",
    trang_thai: "cho_duyet",
    xuat_ban: false,
    noi_dung: JSON.stringify({
      hook: "Croissant hạt dẻ ra lò sáng thứ Bảy — chỉ có ở tiệm khu phố này.",
      loi_thoai: `Mở cảnh: mâm croissant vừa ra lò, hơi còn nóng.\n\n${TB_DONG_CHUAN}\n\nCận cảnh vỏ giòn nhiều lớp và nhân hạt dẻ rang xay. Bánh nướng trong ngày, không để qua đêm.`,
      canh: [
        "Mâm croissant hạt dẻ vừa ra lò, hơi nóng bốc lên",
        "Bẻ đôi một chiếc — vỏ giòn nhiều lớp, nhân hạt dẻ",
        "Mặt tiền tiệm 123 Đường Láng lúc sáng sớm",
      ],
      cta: TB_CTA,
    }),
  },
  {
    // Bài đăng Google Business — đăng tay, link đặt hàng thật.
    id: "seed-bth-tb-gbp",
    dinh_dang: "google-business",
    doi_tuong: "",
    dich_den: "google-business",
    trang_thai: "cho_duyet",
    xuat_ban: false,
    noi_dung: JSON.stringify({
      noi_dung: `Ra mắt bánh croissant hạt dẻ.\n\n${TB_DONG_CHUAN}\n\nTiệm mở cửa 6h30–20h00 hằng ngày tại 123 Đường Láng, Hà Nội.`,
      cta: TB_CTA,
      lien_ket: "https://tiembanh.example.com/dat-hang",
    }),
  },
  {
    // Nháp email khách: có chủ đề, xem trước, lịch gửi dự kiến kèm múi
    // giờ. Gửi thật là bước đăng tay ngoài MAI (P1 #13).
    id: "seed-bth-tb-email",
    dinh_dang: "email-khach",
    doi_tuong: "",
    dich_den: "email",
    trang_thai: "nhap",
    xuat_ban: false,
    noi_dung: JSON.stringify({
      tieu_de: "Thứ Bảy này có croissant hạt dẻ mới ra lò",
      tom_tat: "Ra mắt sáng thứ Bảy — đặt trước để giữ phần.",
      lich_gui: "Gửi trước ra mắt một ngày: 2026-10-09T18:00 (Asia/Ho_Chi_Minh)",
      noi_dung: `Chào bạn,\n\n${TB_DONG_CHUAN}\n\nCroissant hạt dẻ có vỏ giòn nhiều lớp và nhân hạt dẻ rang xay — nướng trong ngày, không để qua đêm.\n\nHẹn bạn sáng thứ Bảy tại 123 Đường Láng.`,
    }),
  },
];

// --- Nội dung story #8: nguồn kinh văn + ghi chú biên tập + đầu ra số 002 ---
// Văn bản Khải Huyền theo Bản dịch truyền thống — trích dẫn/tham chiếu câu
// của số báo đối chiếu được với nguồn này.

const NOI_DUNG_KH7 = `Khải Huyền 7:9-17 — Bản dịch truyền thống

9. Sau những việc ấy, tôi nhìn xem, thấy vô số người, đông đến nỗi không ai đếm được, bởi mọi nước, mọi chi phái, mọi dân tộc và mọi tiếng mà ra, đứng trước ngai và trước Chiên Con; mình mặc áo dài trắng, tay cầm nhành cọ,
10. và lớn tiếng kêu lên rằng: Sự cứu rỗi thuộc về Đức Chúa Trời chúng ta, Đấng ngự trên ngai, và thuộc về Chiên Con!
11. Hết thảy các thiên sứ đều đứng vây ngai, các trưởng lão và bốn con sinh vật, sấp mình trước ngai, thờ phượng Đức Chúa Trời,
12. mà rằng: A-men! Nguyện sự ngợi khen, vinh hiển, khôn ngoan, cảm tạ, tôn quý, quyền năng và sức mạnh thuộc về Đức Chúa Trời chúng ta đời đời vô cùng! A-men.
13. Một trong những trưởng lão lên tiếng hỏi tôi rằng: Những người mặc áo dài trắng này là ai, và từ đâu mà đến?
14. Tôi thưa rằng: Lạy ngài, ngài biết điều đó. Ngài nói với tôi rằng: Đó là những kẻ đến từ cảnh đại nạn, đã giặt áo mình và làm trắng áo ấy trong huyết Chiên Con.
15. Vì vậy họ ở trước ngai Đức Chúa Trời, và ngày đêm hầu việc Ngài trong đền Ngài. Đấng ngự trên ngai sẽ trải lều của Ngài trên họ.
16. Họ sẽ không đói khát nữa; mặt trời hay sức nóng nào cũng chẳng hại đến họ.
17. Vì Chiên Con ở giữa ngai sẽ chăn giữ họ, dẫn họ đến các suối nước sống; và Đức Chúa Trời sẽ lau mọi giọt lệ trên mắt họ.`;

const NOI_DUNG_KH14 = `Khải Huyền 14:1-5 — Bản dịch truyền thống

1. Tôi nhìn xem, thấy Chiên Con đứng trên núi Si-ôn, và với Ngài có mười bốn vạn bốn ngàn người, đều mang danh Ngài và danh Cha Ngài viết trên trán mình.
2. Tôi nghe có tiếng từ trời như tiếng nước lớn, như tiếng sấm vang dội; tiếng tôi nghe được còn như tiếng người đàn hát gảy đàn của mình.
3. Họ hát một bài hát mới trước ngai, trước bốn con sinh vật và các trưởng lão; ngoài mười bốn vạn bốn ngàn người đã được chuộc từ đất ra, chẳng ai có thể học được bài hát ấy.
4. Những người này chưa hề bị uế với đờn bà nào, vì họ là gái trinh. Họ theo Chiên Con bất cứ đi đâu. Những người ấy đã được chuộc từ giữa loài người để làm trái đầu mùa cho Đức Chúa Trời và Chiên Con.
5. Trong miệng họ không thấy điều dối; họ không tì vết.`;

// Diễn giải + bằng chứng đã duyệt của số — hằng số dùng lại ở ghi chú
// biên tập và nguyên văn trong bài giải thích thiếu niên (tiêu chí chấp
// nhận: đổi từ vựng/ví dụ nhưng giữ diễn giải và bằng chứng đã duyệt).
const DIEN_GIAI_DUYET_002 =
  "144.000 là con số biểu tượng chỉ sự đầy đủ của dân Chúa trong mọi thời đại. Chiên Con là hình ảnh Đấng Christ đã chịu sát tế và sống lại. Số báo trình bày theo diễn giải biểu tượng; không đọc con số theo nghĩa đen và không gán danh hiệu cho một nhóm riêng.";
const BANG_CHUNG_DUYET_002 = [
  "Khải Huyền 7:9 — đám đông vô số từ mọi dân tộc đứng trước ngai và Chiên Con.",
  "Khải Huyền 14:1 — 144.000 người đứng với Chiên Con trên núi Si-ôn, mang danh Ngài và danh Cha.",
  "Khải Huyền 14:4 — nhóm này theo Chiên Con và được chuộc làm trái đầu mùa.",
];

const NOI_DUNG_GHI_CHU_002 = `Ghi chú biên tập — Số 002 "Chiên Con và 144.000 người"

Diễn giải đã duyệt (giữ nguyên văn ở mọi đầu ra phái sinh):
${DIEN_GIAI_DUYET_002}

Bằng chứng đã duyệt:
${BANG_CHUNG_DUYET_002.map((b) => `- ${b}`).join("\n")}

Thuật ngữ giữ nguyên: Chiên Con, Si-ôn, trái đầu mùa, đại nạn.`;

const NOI_DUNG_DAU_RA_SO_002: {
  id: string;
  dinh_dang: string;
  doi_tuong: string;
  dich_den: string;
  trang_thai: "nhap" | "cho_duyet" | "da_duyet" | "tu_choi";
  xuat_ban: boolean;
  noi_dung: string;
  ghi_chu?: string;
}[] = [
  {
    // Bài chính: đã duyệt + đã xuất → trang nội bộ /p/<id> phục vụ được.
    id: "seed-bth-so002-bai-chinh",
    dinh_dang: "bai-viet",
    doi_tuong: "Độc giả Phúc Âm (fixture)",
    dich_den: "",
    trang_thai: "da_duyet",
    xuat_ban: true,
    noi_dung: JSON.stringify({
      tieu_de: "Chiên Con và 144.000 người — hình ảnh đầy đủ của dân Chúa",
      noi_dung: `Số này tập trung vào Khải Huyền 7 và 14: hình ảnh Chiên Con và đoàn người mang danh Ngài.

"Thấy vô số người, đông đến nỗi không ai đếm được... đứng trước ngai và trước Chiên Con" (Khải Huyền 7:9, Bản dịch truyền thống). Đám đông ấy "đến từ cảnh đại nạn, đã giặt áo mình và làm trắng áo ấy trong huyết Chiên Con" (7:14).

Tại Khải Huyền 14:1, Chiên Con đứng trên núi Si-ôn cùng "mười bốn vạn bốn ngàn người" mang danh Ngài và danh Cha Ngài trên trán. ${DIEN_GIAI_DUYET_002}

Bạn đọc được mời đọc hai đoạn kinh văn nguyên cảnh trước khi quay lại các bài trong số.`,
    }),
  },
  {
    // Bài học tài liệu nền đi sát đoạn tham chiếu — chờ duyệt, nằm trong
    // hàng chờ review cấp số.
    id: "seed-bth-so002-hoc-tl",
    dinh_dang: "hoc-tai-lieu",
    doi_tuong: "Độc giả Phúc Âm (fixture)",
    dich_den: "",
    trang_thai: "cho_duyet",
    xuat_ban: false,
    noi_dung: JSON.stringify({
      tieu_de: "Học Khải Huyền 7:9-17 và 14:1-5",
      tham_chieu: ["Khải Huyền 7:9-17", "Khải Huyền 14:1-5"],
      noi_dung:
        "Đọc hai đoạn nối tiếp nhau: 7:9-17 nhìn đám đông vô số từ phía người đứng trước ngai; 14:1-5 nhìn 144.000 người đứng với Chiên Con trên Si-ôn. Hai hình ảnh bổ sung cho nhau — sự đầy đủ của dân Chúa được cứu.",
      cau_hoi_thao_luan: [
        "Văn 7:14 nói áo trắng 'trong huyết Chiên Con' — hình ảnh đó nói gì về sự cứu rỗi?",
        "Vì sao số 144.000 ở 14:1 nên đọc là biểu tượng đầy đủ thay vì nghĩa đen?",
      ],
      ung_dung:
        "Nhờ Chiên Con, người tin được đếm vào đoàn dân đầy đủ của Chúa — niềm tin mang lại an ủi trong nạn khó.",
    }),
  },
  {
    // Bài giải thích cho thiếu niên: bản nháp đổi từ vựng/ví dụ cho độc giả
    // trẻ nhưng GIỮ NGUYÊN diễn giải và bằng chứng đã duyệt — biên tập đã
    // từ chối bản này vì văn phong, không phải vì nội dung đã duyệt.
    id: "seed-bth-so002-giai-thich-tn",
    dinh_dang: "giai-thich-thieu-nien",
    doi_tuong: "Thiếu niên (fixture)",
    dich_den: "",
    trang_thai: "tu_choi",
    xuat_ban: false,
    ghi_chu: "Từ vựng còn khó và ví dụ còn trừu tượng — viết lại cho gần thiếu niên, giữ nguyên diễn giải/bằng chứng đã duyệt.",
    noi_dung: JSON.stringify({
      tieu_de: "Chiên Con và 144.000 người — giải thích cho thiếu niên",
      noi_dung:
        "Kinh văn tả một đám đông khổng lồ đứng trước ngai Chúa và trước Chiên Con (Khải Huyền 7:9-10). Ở chương 14 có một nhóm 144.000 người đứng cùng Chiên Con trên núi Si-ôn (14:1). Con số này nghe lạ — nhưng nó là hình ảnh, không phải bảng điểm.",
      dien_giai: DIEN_GIAI_DUYET_002,
      bang_chung: BANG_CHUNG_DUYET_002,
      vi_du: [
        "Giống như nói 'cả triệu người đến xem concert' — nghĩa là rất đông, không ai ngồi đếm từng người.",
        "144.000 = 12 × 12 × 1000 — cách viết 'đủ cả đội, không thiếu một ai' trong văn kinh điển.",
      ],
    }),
  },
  {
    // Hỏi-đáp độc giả — còn nháp.
    id: "seed-bth-so002-hoi-dap",
    dinh_dang: "hoi-dap-doc-gia",
    doi_tuong: "Độc giả Phúc Âm (fixture)",
    dich_den: "",
    trang_thai: "nhap",
    xuat_ban: false,
    noi_dung: JSON.stringify({
      tieu_de: "Hỏi-đáp: Chiên Con và 144.000 người",
      gioi_thieu: "Câu hỏi độc giả gửi về sau số trước, trả lời theo lập trường biên tập của số này.",
      hoi_dap: [
        "H: 144.000 có phải là số người được cứu tối đa không? Đ: Không — con số là biểu tượng đầy đủ; 7:9 đã tả 'vô số người' trước ngai.",
        "H: 'Chiên Con' ở đây là ai? Đ: Hình ảnh Đấng Christ — 'như đã bị sát tế' mà đứng sống giữa ngai (xem Khải Huyền 5:6).",
      ],
    }),
  },
  {
    // Bản website của bài chính — còn nháp, chưa gửi duyệt.
    id: "seed-bth-so002-web",
    dinh_dang: "bai-viet",
    doi_tuong: "Độc giả Phúc Âm (fixture)",
    dich_den: "website",
    trang_thai: "nhap",
    xuat_ban: false,
    noi_dung: JSON.stringify({
      tieu_de: "Chiên Con và 144.000 người — bản website",
      noi_dung:
        "Bản web của bài chính số 002, định dạng lại cho đọc trên trang: đoạn mở, hai đoạn thân bài trích Khải Huyền 7:9-14 và 14:1-5, khối tham chiếu cuối bài.",
    }),
  },
];

if (import.meta.main) {
  const cauHinh = await taiCauHinh();
  const db = moDb(cauHinh.dataDir);
  chayMigration(db);
  const ketQua = seed(db, "demo", { dataDir: cauHinh.dataDir });
  log.info("seed.xong", { dataDir: cauHinh.dataDir, ...ketQua });
  db.close();
}
