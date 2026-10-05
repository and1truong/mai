import type { Database } from "bun:sqlite";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { taiCauHinh } from "../config.ts";
import { log } from "../log.ts";
import {
  layDoiTuong,
  taoDoiTuong,
  taoThuongHieu,
  thayThuatNgu,
} from "../modules/context/index.ts";
import {
  capNhatCampaign,
  chuyenTrangThai,
  ghiSuKien,
  layBanTheHien,
  layCampaign,
  layThongDiep,
  taoBanTheHien,
  taoCampaign,
  taoNguon,
  taoThongDiep,
  themRevision,
  xuatBanBanTheHien,
} from "../modules/content/index.ts";
import { deXuatMucLuc } from "../modules/so_bao/index.ts";
import {
  damBaoThongDiepPhatHanh,
  deXuatDauRaPhatHanh,
  dongBoNguonPhatHanh,
} from "../modules/phat_hanh/index.ts";
import {
  damBaoThongDiepGayQuy,
  deXuatDauRaGayQuy,
  dongBoNguonGayQuy,
} from "../modules/gay_quy/index.ts";
import {
  damBaoThongDiepCongQuyen,
  deXuatDauRaCongQuyen,
  dongBoNguonCongQuyen,
} from "../modules/cong_quyen/index.ts";
import {
  dongBoNguonThuongHieu,
  dongBoThiTruong,
} from "../modules/thuong_hieu/index.ts";
import { enqueueJob } from "../modules/jobs/index.ts";
import { huyDangKyNguoiNhan, layGiaoHang, themNguoiNhan } from "../modules/kenh/index.ts";
import { napDonHangMau } from "../modules/khach/nap_fixture.ts";
import {
  datDongY,
  ghiTuongTac,
  resolveKhach,
} from "../modules/khach/index.ts";
import {
  datMucTieu,
  ghiSnapshotProvider,
  nhapKetQua,
  taoLinkDich,
} from "../modules/ket_qua/index.ts";
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
  tuyChon: { dataDir?: string; urlGoc?: string } = {},
): { da_seed: string[] } {
  const urlGoc = tuyChon.urlGoc ?? "";
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

  // --- Story #9: MaiSuite — bản phát hành B2B 4.0 ---
  // Campaign loại 'phat_hanh' gắn phiên bản, ngày, định vị đã duyệt, giới
  // hạn gói/vùng/khả dụng, CTA và fact tính năng có con trỏ bằng chứng
  // vào nguồn đã nạp. Nguồn fact tự động chiếu field release thành mục
  // nguồn → đầu ra pin fact trong provenance; sửa field đánh dấu đầu ra
  // phụ thuộc (#14). Fact 'Hiệu năng' cố ý không nguồn → chưa xác nhận,
  // chỉ được để dạng câu hỏi, không được trình bày như sự thật.
  if (!db.query("SELECT id FROM campaign WHERE id = 'seed-cp-phat-hanh-40'").get()) {
    // 6 hồ sơ đối tượng cho đầu ra theo persona của story.
    themDoiTuong(
      db,
      "seed-dt-dev-40",
      {
        ten: "Lập trình viên tích hợp (fixture)",
        ngon_ngu: "vi",
        dia_diem: "Developer tích hợp MaiSuite vào hệ thống của khách hàng.",
        kien_thuc_nen: "Biết REST API, OAuth 2.0, WebAuthn ở mức dùng được.",
        moi_quan_tam: "Bước tích hợp cụ thể, yêu cầu trước, giới hạn API.",
        do_sau: "chuyen_sau",
        tu_vung: "Thuật ngữ kỹ thuật; không giải thích khái niệm nền.",
        quan_he_to_chuc: "Đội platform/integration của khách hàng.",
        nhu_cau_giao_tiep: "Hướng dẫn từng bước, liệt kê điều kiện trước, link tài liệu.",
        nhan_khau_hoc: "Backend engineer 3+ năm.",
      },
      tacGia,
    );
    themDoiTuong(
      db,
      "seed-dt-khach-hang-40",
      {
        ten: "Khách hàng doanh nghiệp (fixture)",
        ngon_ngu: "vi",
        dia_diem: "Quản trị viên và người dùng cuối của khách hàng hiện tại.",
        kien_thuc_nen: "Dùng MaiSuite hàng ngày; không cần biết chi tiết bên trong.",
        moi_quan_tam: "Thay đổi ảnh hưởng công việc hàng ngày, việc cần làm khi nâng cấp.",
        do_sau: "vua_phai",
        tu_vung: "Đơn giản; tránh thuật ngữ kỹ thuật khi có thể.",
        quan_he_to_chuc: "Admin IT và end user của tenant hiện tại.",
        nhu_cau_giao_tiep: "Danh sách thay đổi rõ ràng, bước cần làm, giới hạn gói.",
        nhan_khau_hoc: "Nhân viên văn phòng và admin IT của khách hàng.",
      },
      tacGia,
    );
    themDoiTuong(
      db,
      "seed-dt-tiem-nang-40",
      {
        ten: "Khách hàng tiềm năng (fixture)",
        ngon_ngu: "vi",
        dia_diem: "Doanh nghiệp đang đánh giá MaiSuite so với đối thủ.",
        kien_thuc_nen: "Biết bài toán IAM/SSO phổ thông; chưa dùng sản phẩm.",
        moi_quan_tam: "Lợi ích nghiệp vụ, khác biệt so với giải pháp cũ.",
        do_sau: "so_luoc",
        tu_vung: "Ngôn ngữ kinh doanh; ít chi tiết API.",
        quan_he_to_chuc: "Ban lãnh đạo IT và procurement của prospect.",
        nhu_cau_giao_tiep: "Ngắn gọn, nhấn giá trị; link tài liệu chi tiết khi cần.",
        nhan_khau_hoc: "Quyết định mua ở doanh nghiệp 200–2000 người.",
      },
      tacGia,
    );
    themDoiTuong(
      db,
      "seed-dt-bao-mat-40",
      {
        ten: "Người mua bảo mật — CISO (fixture)",
        ngon_ngu: "vi",
        dia_diem: "CISO/đội security đánh giá kiểm soát trước khi duyệt mua.",
        kien_thuc_nen: "Hiểu kiểm soát xác thực, logging, phân quyền ở mức audit.",
        moi_quan_tam: "Kiểm soát thật sự có và giới hạn của nó; không chấp nhận claim chung chung.",
        do_sau: "chuyen_sau",
        tu_vung: "Thuật ngữ bảo mật; yêu cầu bằng chứng cho mọi claim.",
        quan_he_to_chuc: "CISO, security architect, compliance.",
        nhu_cau_giao_tiep: "Bảng kiểm soát + giới hạn song song; nêu thẳng chỗ chưa có chứng nhận.",
        nhan_khau_hoc: "CISO / security lead doanh nghiệp.",
      },
      tacGia,
    );
    themDoiTuong(
      db,
      "seed-dt-sales-40",
      {
        ten: "Đội bán hàng nội bộ (fixture)",
        ngon_ngu: "vi",
        dia_diem: "Sales và account executive của MaiSuite.",
        kien_thuc_nen: "Biết sản phẩm ở mức bán hàng; cần điểm nói và câu trả lời cho phản đối.",
        moi_quan_tam: "Thông điệp chính, điểm bán, câu hỏi khách hay hỏi, giới hạn gói.",
        do_sau: "vua_phai",
        tu_vung: "Ngôn ngữ bán hàng; có thể kèm thuật ngữ sản phẩm cần thiết.",
        quan_he_to_chuc: "Đội sales/AM nội bộ.",
        nhu_cau_giao_tiep: "Brief một trang: điểm bán, xử lý phản đối, bước tiếp theo.",
        nhan_khau_hoc: "Nhân viên sales/AM.",
      },
      tacGia,
    );
    themDoiTuong(
      db,
      "seed-dt-support-40",
      {
        ten: "Đội hỗ trợ khách hàng (fixture)",
        ngon_ngu: "vi",
        dia_diem: "Support trả lời ticket sau ngày phát hành.",
        kien_thuc_nen: "Biết quy trình hỗ trợ; cần câu trả lời sẵn cho câu hỏi phổ biến.",
        moi_quan_tam: "Khách sẽ hỏi gì, trả lời ra sao, giới hạn nào cần nói trước.",
        do_sau: "vua_phai",
        tu_vung: "Đơn giản, lịch sự; tránh thuật ngữ nội bộ.",
        quan_he_to_chuc: "Đội support/CS nội bộ.",
        nhu_cau_giao_tiep: "Hỏi-đáp ngắn, dùng trực tiếp cho ticket.",
        nhan_khau_hoc: "Nhân viên support.",
      },
      tacGia,
    );

    themThuongHieu(
      db,
      "seed-th-saas-40",
      {
        ten: "SaaS B2B doanh nghiệp (fixture)",
        nhan_dien: "Nền tảng quản lý định danh và truy cập cho doanh nghiệp. Viết kỹ thuật, có bằng chứng, không hype.",
        ngon_ngu_uu_tien: ["vi", "en"],
        vi_du_giong_van: "Phiên bản 4.0 thêm passkeys và audit log. Đây là phạm vi áp dụng từng tính năng.",
        nguyen_tac: "Chính xác. Luôn nêu giới hạn gói/vùng khi nhắc tính năng bị giới hạn.",
        claim_duyet: [
          "Tính năng nói đúng phạm vi tài liệu đã nạp.",
          "Giới hạn gói/vùng hiển thị khi tính năng bị giới hạn được nhắc.",
        ],
        claim_cam: [
          "An toàn tuyệt đối",
          "Tuân thủ mọi tiêu chuẩn",
          "Nhanh nhất thị trường",
        ],
        assets: [],
      },
      tacGia,
    );

    // Nguồn đã nạp: changelog + tài liệu tích hợp + tài liệu kiểm soát
    // bảo mật. Mỗi tính năng một mục loại 'fact' để fact của release trỏ
    // bằng chứng đến đúng mục, không phải cả tài liệu chung.
    const nguonChangelog = taoNguon(
      db,
      {
        tieu_de: "Changelog MaiSuite 4.0",
        noi_dung:
          "MaiSuite 4.0 (phát hành 2026-11-01) thêm ba thay đổi chính: passkeys, audit log và cải tiến SSO SAML.",
        loai: "van_ban",
        cac_muc: [
          {
            id: "cl-passkeys",
            loai: "fact",
            tieu_de: "Passkeys",
            noi_dung:
              "Phiên bản 4.0 hỗ trợ đăng nhập bằng passkeys (WebAuthn) thay mật khẩu cho tất cả tài khoản.",
            assets: [],
          },
          {
            id: "cl-audit-log",
            loai: "fact",
            tieu_de: "Audit log",
            noi_dung:
              "Phiên bản 4.0 ghi audit log toàn bộ sự kiện đăng nhập và thay đổi quyền; dữ liệu giữ 365 ngày.",
            assets: [],
          },
          {
            id: "cl-sso",
            loai: "fact",
            tieu_de: "SSO SAML",
            noi_dung:
              "Phiên bản 4.0 cho phép đăng ký nhiều IdP đồng thời và bật JIT provisioning.",
            assets: [],
          },
        ],
      },
      tacGia,
      { id: "seed-nguon-changelog-40" },
    );
    const nguonTichHop = taoNguon(
      db,
      {
        tieu_de: "Tài liệu tích hợp API 4.0",
        noi_dung: "Tài liệu cho developer tích hợp MaiSuite 4.0: xác thực và webhook.",
        loai: "van_ban",
        cac_muc: [
          {
            id: "tl-xac-thuc",
            loai: "section",
            tieu_de: "Xác thực",
            noi_dung:
              "API xác thực bằng OAuth 2.0 client credentials; token lấy từ POST /oauth/token.",
            assets: [],
          },
          {
            id: "tl-webhook",
            loai: "section",
            tieu_de: "Webhook",
            noi_dung:
              "Webhook đăng ký qua POST /api/webhooks; payload JSON ký bằng HMAC-SHA256.",
            assets: [],
          },
        ],
      },
      tacGia,
      { id: "seed-nguon-tl-tich-hop-40" },
    );
    const nguonBaoMat = taoNguon(
      db,
      {
        tieu_de: "Tài liệu kiểm soát bảo mật 4.0",
        noi_dung: "Kiểm soát xác thực và ghi log của MaiSuite cho đánh giá bảo mật.",
        loai: "van_ban",
        cac_muc: [
          {
            id: "bm-dang-nhap",
            loai: "fact",
            tieu_de: "Kiểm soát đăng nhập",
            noi_dung:
              "MaiSuite hỗ trợ passkeys, TOTP và SSO SAML; quản trị bắt buộc được theo tài khoản.",
            assets: [],
          },
          {
            id: "bm-ghi-log",
            loai: "fact",
            tieu_de: "Ghi log kiểm toán",
            noi_dung: "Audit log export CSV/JSON qua API; dữ liệu giữ 365 ngày.",
            assets: [],
          },
        ],
      },
      tacGia,
      { id: "seed-nguon-bao-mat-40" },
    );

    const cpPh = taoCampaign(
      db,
      {
        loai: "phat_hanh",
        ten: "MaiSuite 4.0",
        mo_ta: "Bản phát hành 4.0: passkeys, audit log và cải tiến SSO.",
        phien_ban: "4.0",
        ngay_phat_hanh: "2026-11-01",
        dinh_vi:
          "4.0 đưa xác thực không mật khẩu và kiểm soát truy cập lên chuẩn doanh nghiệp — nhấn bảo mật và kiểm toán, không nhấn tốc độ.",
        thuong_hieu_id: "seed-th-saas-40",
        doi_tuong_id: "seed-dt-khach-hang-40",
        gioi_han: [
          {
            id: "gh-sso-goi",
            tinh_nang: "SSO SAML",
            loai: "goi",
            mo_ta: "chỉ có ở gói Enterprise",
          },
          {
            id: "gh-audit-log",
            tinh_nang: "audit log",
            loai: "goi",
            mo_ta: "gói Starter chỉ giữ 90 ngày — gói Enterprise giữ 365 ngày",
          },
          {
            id: "gh-passkeys-vung",
            tinh_nang: "passkeys",
            loai: "vung",
            mo_ta: "chưa mở cho tenant region EU cũ — lộ trình nâng hạ tầng trước 2027-Q1",
          },
        ],
        cta: [
          {
            id: "cta-docs",
            nhan: "Tài liệu tích hợp 4.0",
            loai: "tai_lieu",
            url: "https://docs.maisuite.example.com/v4",
          },
          {
            id: "cta-nang-cap",
            nhan: "Nâng cấp lên 4.0",
            loai: "nang_cap",
            url: "https://app.maisuite.example.com/nang-cap",
          },
          {
            id: "cta-ho-tro",
            nhan: "Liên hệ hỗ trợ",
            loai: "ho_tro",
            url: "https://support.maisuite.example.com",
          },
        ],
        ds_fact: [
          {
            id: "fact-passkeys",
            tinh_nang: "Passkeys",
            noi_dung:
              "Đăng nhập bằng passkeys (WebAuthn) thay mật khẩu cho tất cả tài khoản.",
            nguon_id: nguonChangelog.id,
            muc_id: "cl-passkeys",
          },
          {
            id: "fact-audit-log",
            tinh_nang: "Audit log",
            noi_dung:
              "Ghi toàn bộ sự kiện đăng nhập và đổi quyền; dữ liệu giữ 365 ngày.",
            nguon_id: nguonChangelog.id,
            muc_id: "cl-audit-log",
          },
          {
            id: "fact-sso",
            tinh_nang: "SSO SAML",
            noi_dung: "Đăng ký nhiều IdP đồng thời và JIT provisioning.",
            nguon_id: nguonChangelog.id,
            muc_id: "cl-sso",
          },
          {
            id: "fact-webhook",
            tinh_nang: "Webhook",
            noi_dung: "Webhook đăng ký qua POST /api/webhooks; payload JSON ký HMAC-SHA256.",
            nguon_id: nguonTichHop.id,
            muc_id: "tl-webhook",
          },
          {
            // Cố ý không trỏ nguồn: claim benchmark chưa xác nhận — đầu ra
            // chỉ được để [CÂU HỎI], không được viết như sự thật.
            id: "fact-hieu-nang",
            tinh_nang: "Hiệu năng",
            noi_dung: "Xử lý nhanh hơn 10 lần so với 3.x.",
            nguon_id: null,
            muc_id: null,
          },
        ],
        tham_chieu: [
          {
            id: "tc-changelog",
            tham_chieu: "Changelog 4.0",
            ban_dich: "",
            nguon_id: nguonChangelog.id,
            ghi_chu: "Danh sách thay đổi chính thức của bản 4.0.",
          },
          {
            id: "tc-tich-hop",
            tham_chieu: "Tài liệu tích hợp API 4.0",
            ban_dich: "",
            nguon_id: nguonTichHop.id,
            ghi_chu: "Xác thực + webhook cho hướng dẫn developer.",
          },
          {
            id: "tc-bao-mat",
            tham_chieu: "Tài liệu kiểm soát bảo mật",
            ban_dich: "",
            nguon_id: nguonBaoMat.id,
            ghi_chu: "Kiểm soát cho đầu ra bên mua bảo mật.",
          },
        ],
      },
      tacGia,
      { id: "seed-cp-phat-hanh-40" },
    );
    capNhatCampaign(
      db,
      cpPh.id,
      { ten: cpPh.ten, muc_luc: deXuatDauRaPhatHanh(db, cpPh) },
      tacGia,
    );
    // Nguồn fact tự động + thông điệp chủ đề pin nguồn — đầu ra demo dưới
    // đây pin đúng chuỗi provenance.
    dongBoNguonPhatHanh(db, cpPh, tacGia);
    const tdPh = damBaoThongDiepPhatHanh(db, layCampaign(db, cpPh.id)!, tacGia);
    const tdRevPh = tdPh.head_revision_id;

    // Đầu ra demo lưu bền: developer (đã duyệt + đã xuất → trang /p/<id>
    // phục vụ), khách hàng (chờ duyệt — vào hàng chờ review), sales (đã
    // duyệt). Nội dung theo contract [F:<fact_id>]/[GH:<gioi_han_id>];
    // claim hiệu năng chưa xác nhận chỉ để [CÂU HỎI].
    // Định danh đầu ra gồm chuỗi doi_tuong = tên hồ sơ của mục — derive
    // từ mục lục để đầu ra seed luôn khớp khoaDauRaMuc (tiến độ mục).
    const mucTheoDauRa = new Map(
      layCampaign(db, cpPh.id)!.muc_luc.map((m) => [`${m.dinh_dang}|${m.dich_den}`, m]),
    );
    for (const o of NOI_DUNG_DAU_RA_PHAT_HANH) {
      const muc = mucTheoDauRa.get(`${o.dinh_dang}|${o.dich_den}`);
      const doiTuongTen =
        (muc?.doi_tuong_id ? layDoiTuong(db, muc.doi_tuong_id)?.ten : null) ?? o.doi_tuong;
      taoBanTheHien(
        db,
        {
          thong_diep_id: tdPh.id,
          dinh_dang: o.dinh_dang,
          ngon_ngu: "vi",
          doi_tuong: doiTuongTen,
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
          thong_diep_revision_id: tdRevPh,
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
    daSeed.push("story_phat_hanh_40");
  }

  // --- Story #10: Giọt Nước Chung — chiến dịch gây quỹ theo mục tiêu ---
  // Campaign loại 'gay_quy': mục tiêu + số tiền kèm tiền tệ, thông điệp
  // lõi, tác động đã đạt/ước tính với con trỏ bằng chứng nguồn, trích
  // dẫn được phép dùng, ghi chú quyền cho asset tổ chức cung cấp.
  // Toàn bộ dữ liệu hiện trường là HƯ CẤU (ghi trong tiêu đề nguồn).
  // Tác động/trích dẫn cố ý không nguồn → chưa xác nhận, chỉ được để
  // dạng câu hỏi [CÂU HỎI], không trình bày như sự thật.
  if (!db.query("SELECT id FROM campaign WHERE id = 'seed-cp-gay-quy-khe-tre'").get()) {
    // 4 hồ sơ đối tượng cho đầu ra của story.
    themDoiTuong(
      db,
      "seed-dt-nha-tai-tro-gq",
      {
        ten: "Nhà tài trợ hiện hữu (fixture)",
        ngon_ngu: "vi",
        dia_diem: "Người và tổ chức đã quyên góp cho các công trình trước.",
        kien_thuc_nen: "Quan tâm tác động đo được; muốn biết tiền đi đâu.",
        moi_quan_tam: "Báo cáo tác động rõ ràng, minh bạch số liệu và chi phí.",
        do_sau: "vua_phai",
        tu_vung: "Đơn giản, tôn trọng; tránh ngôn ngữ cảm xúc quá mức.",
        quan_he_to_chuc: "Nhà tài trợ định kỳ của tổ chức.",
        nhu_cau_giao_tiep: "Báo cáo có số liệu nguồn; tách rõ đã đạt và ước tính.",
        nhan_khau_hoc: "",
      },
      tacGia,
    );
    themDoiTuong(
      db,
      "seed-dt-ntt-lon-gq",
      {
        ten: "Nhà tài trợ lớn (fixture)",
        ngon_ngu: "vi",
        dia_diem: "Nhà tài trợ cá nhân/quỹ có khả năng góp khoản lớn.",
        kien_thuc_nen: "Đọc kỹ dự toán và quy trình giám sát trước khi quyết định.",
        moi_quan_tam: "Chi tiết dự toán, tiến độ, cách tổ chức đảm bảo tiền đúng mục đích.",
        do_sau: "chuyen_sau",
        tu_vung: "Ngôn ngữ chuyên nghiệp; có thể kèm số liệu chi phí chi tiết.",
        quan_he_to_chuc: "Nhà tài trợ chiến lược tiềm năng.",
        nhu_cau_giao_tiep: "Email riêng, chi tiết hơn câu chuyện công khai nhưng cùng fact.",
        nhan_khau_hoc: "",
      },
      tacGia,
    );
    themDoiTuong(
      db,
      "seed-dt-tinh-nguyen-gq",
      {
        ten: "Tình nguyện viên (fixture)",
        ngon_ngu: "vi",
        dia_diem: "Tình nguyện viên đi hiện trường và hỗ trợ truyền thông.",
        kien_thuc_nen: "Biết dự án qua các chuyến đi; cần nội dung dùng lại được.",
        moi_quan_tam: "Tiến độ làng tiếp theo, việc cần làm, câu chuyện để chia sẻ.",
        do_sau: "so_luoc",
        tu_vung: "Thân thiện, động viên; câu ngắn.",
        quan_he_to_chuc: "Tình nguyện viên nội bộ của tổ chức.",
        nhu_cau_giao_tiep: "Cập nhật ngắn: tiến độ, việc cần làm, link chia sẻ.",
        nhan_khau_hoc: "",
      },
      tacGia,
    );
    themDoiTuong(
      db,
      "seed-dt-cong-chung-gq",
      {
        ten: "Công chúng quan tâm (fixture)",
        ngon_ngu: "vi",
        dia_diem: "Người quan tâm công trình cộng đồng qua website và mạng xã hội.",
        kien_thuc_nen: "Chưa biết nhiều về tổ chức; đọc câu chuyện trước số liệu.",
        moi_quan_tam: "Câu chuyện con người, minh bạch, cách đóng góp cụ thể.",
        do_sau: "so_luoc",
        tu_vung: "Tránh thuật ngữ; ảnh và trích dẫn dẫn chuyện.",
        quan_he_to_chuc: "Người ủng hộ tiềm năng chưa từng quyên góp.",
        nhu_cau_giao_tiep: "Câu chuyện ngắn có mặt người; CTA quyên góp rõ ràng.",
        nhan_khau_hoc: "",
      },
      tacGia,
    );

    themThuongHieu(
      db,
      "seed-th-nuoc-sach",
      {
        ten: "Giọt Nước Chung (fixture)",
        nhan_dien:
          "Tổ chức phi lợi nhuận xây công trình nước sạch cho làng vùng cao. Viết minh bạch, có bằng chứng, không phóng đại.",
        ngon_ngu_uu_tien: ["vi", "en"],
        vi_du_giong_van:
          "Ba ngôi làng đã có nước sạch. Đây là bằng chứng và đây là việc còn lại.",
        nguyen_tac:
          "Không bịa tên người, trích dẫn hay số đo. Tác động ước tính luôn ghi rõ là ước tính. Số tiền luôn kèm đơn vị tiền tệ.",
        claim_duyet: [
          "Tác động chỉ dùng số liệu từ tài liệu hiện trường đã nạp.",
          "Trích dẫn chỉ dùng lời đã ghi trong tư liệu được cung cấp.",
          "Mục tiêu gây quỹ nêu riêng, không viết như tác động đã đạt.",
        ],
        claim_cam: [
          "Khẳng định tác động chưa có bằng chứng",
          "Hứa kết quả gây quỹ cụ thể",
        ],
        assets: [],
      },
      tacGia,
    );

    // Tư liệu hiện trường Maria cung cấp: ghi chú + số liệu + trích dẫn
    // đã kiểm chứng cho 3 làng hoàn thành và khảo sát làng tiếp theo.
    const nguonHienTruong = taoNguon(
      db,
      {
        tieu_de: "Ghi chú hiện trường — 3 làng nước sạch (dữ liệu hư cấu)",
        noi_dung:
          "Ghi chú và số liệu Maria thu thập tại 3 công trình đã hoàn thành. Dữ liệu demo, hư cấu.",
        loai: "van_ban",
        cac_muc: [
          {
            id: "ht-lang-rom",
            loai: "fact",
            tieu_de: "Làng Bản Rọm",
            noi_dung:
              "Giếng khoan Làng Bản Rọm hoàn thành 2026-03. 1.240 người ở 312 hộ dùng nước sạch hằng ngày. Bà Hòa, giảng viên hưu trí: 'Trước kia cả nhà tôi phải đi 2 tiếng mỗi ngày để lấy nước. Bây giờ cháu tôi có thời gian học bài buổi tối.'",
            assets: [],
          },
          {
            id: "ht-lang-suoi",
            loai: "fact",
            tieu_de: "Làng Suối Lớn",
            noi_dung:
              "Hệ thống lọc và bể chứa Làng Suối Lớn vận hành từ 2026-05. 860 người được cấp nước sạch.",
            assets: [],
          },
          {
            id: "ht-lang-dong",
            loai: "fact",
            tieu_de: "Làng Đồng Kẻ",
            noi_dung:
              "3 điểm lấy nước cộng đồng tại Làng Đồng Kẻ phục vụ 470 người.",
            assets: [],
          },
          {
            id: "ht-tnv",
            loai: "fact",
            tieu_de: "Ghi chú tình nguyện viên",
            noi_dung:
              "Anh Tuấn, trưởng nhóm tình nguyện viên: 'Tôi đã chứng kiến giếng đầu tiên có nước. Ngày đó cả làng đứng xem tới tận tối.'",
            assets: [],
          },
        ],
      },
      tacGia,
      { id: "seed-nguon-hien-truong-gq" },
    );
    const nguonKeHoach = taoNguon(
      db,
      {
        tieu_de: "Kế hoạch Làng Khe Tre — khảo sát đầu vào (dữ liệu hư cấu)",
        noi_dung:
          "Khảo sát ban đầu và tổng kết năm của chương trình nước sạch. Dữ liệu demo, hư cấu.",
        loai: "van_ban",
        cac_muc: [
          {
            id: "kh-khao-sat",
            loai: "fact",
            tieu_de: "Khảo sát Làng Khe Tre",
            noi_dung:
              "Khảo sát 2026-08: Làng Khe Tre có khoảng 600 người chưa có nguồn nước sạch gần nhà. Dự toán công trình giếng khoan và bể lọc khoảng 1.200.000.000 VND.",
            assets: [],
          },
          {
            id: "kh-tong-hop",
            loai: "fact",
            tieu_de: "Tổng kết năm",
            noi_dung:
              "Tổng cộng 2.570 người ở 3 làng đã có nước sạch. Chi phí trung bình một công trình khoảng 380 triệu đồng.",
            assets: [],
          },
        ],
      },
      tacGia,
      { id: "seed-nguon-ke-hoach-gq" },
    );

    // Ảnh hiện trường do tổ chức cung cấp — ghi chú quyền đính kèm
    // campaign và hiển thị khi review đầu ra dùng ảnh.
    const assetAnh = tuyChon.dataDir
      ? ghiAssetFixture(
          db,
          tuyChon.dataDir,
          nguonHienTruong.id,
          tacGia,
          GQ_FILE_ANH,
          "Ảnh hiện trường do tổ chức cung cấp (ảnh mô phỏng, dữ liệu hư cấu).",
        )
      : null;

    const cpGq = taoCampaign(
      db,
      {
        loai: "gay_quy",
        ten: "Nước sạch cho Làng Khe Tre",
        mo_ta:
          "Chiến dịch gây quỹ cho công trình nước sạch Làng Khe Tre. Persona demo: Maria, nhân viên truyền thông (hư cấu).",
        muc_tieu:
          "Gây quỹ công trình nước sạch cho Làng Khe Tre — khoảng 600 người đang chờ nguồn nước sạch gần nhà.",
        so_tien_muc_tieu: 1200000000,
        tien_te: "VND",
        thong_diep_loi:
          "Ba ngôi làng đã có nước sạch. Làng Khe Tre là làng tiếp theo — chỉ còn thiếu nguồn lực.",
        ngon_ngu_phu: "en",
        thuong_hieu_id: "seed-th-nuoc-sach",
        doi_tuong_id: "seed-dt-cong-chung-gq",
        ds_tac_dong: [
          {
            id: "td-gieng-rom",
            tieu_de: "Giếng khoan Làng Bản Rọm",
            noi_dung:
              "Công trình hoàn thành 2026-03; 1.240 người ở 312 hộ dùng nước sạch hằng ngày.",
            trang_thai: "da_dat",
            so_lieu: "1.240",
            don_vi: "người",
            nguon_id: nguonHienTruong.id,
            muc_id: "ht-lang-rom",
          },
          {
            id: "td-loc-suoi",
            tieu_de: "Hệ thống lọc Làng Suối Lớn",
            noi_dung: "860 người được cấp nước sạch từ 2026-05.",
            trang_thai: "da_dat",
            so_lieu: "860",
            don_vi: "người",
            nguon_id: nguonHienTruong.id,
            muc_id: "ht-lang-suoi",
          },
          {
            id: "td-diem-dong",
            tieu_de: "Điểm lấy nước Làng Đồng Kẻ",
            noi_dung: "3 điểm cộng đồng phục vụ 470 người.",
            trang_thai: "da_dat",
            so_lieu: "470",
            don_vi: "người",
            nguon_id: nguonHienTruong.id,
            muc_id: "ht-lang-dong",
          },
          {
            id: "td-nguoi-khe-tre",
            tieu_de: "Người hưởng lợi Làng Khe Tre",
            noi_dung:
              "Ước tính 600 người sẽ có nước sạch khi công trình hoàn thành.",
            trang_thai: "uoc_tinh",
            so_lieu: "600",
            don_vi: "người",
            nguon_id: nguonKeHoach.id,
            muc_id: "kh-khao-sat",
          },
          {
            // Cố ý không trỏ nguồn: quan sát chưa đo được — đầu ra chỉ
            // được để [CÂU HỎI], không viết như sự thật.
            id: "td-hoc-sinh",
            tieu_de: "Tỉ lệ học sinh đi học đều hơn sau khi có nước",
            noi_dung: "Chưa đo được; ghi chú hiện trường mới chỉ là quan sát.",
            trang_thai: "uoc_tinh",
            so_lieu: "",
            don_vi: "",
            nguon_id: null,
            muc_id: null,
          },
        ],
        ds_trich_dan: [
          {
            id: "tq-ba-hoa",
            ten_nguoi: "Bà Hòa (giảng viên hưu trí, Làng Bản Rọm)",
            loi: "Trước kia cả nhà tôi phải đi 2 tiếng mỗi ngày để lấy nước. Bây giờ cháu tôi có thời gian học bài buổi tối.",
            nguon_id: nguonHienTruong.id,
            muc_id: "ht-lang-rom",
          },
          {
            id: "tq-anh-tuan",
            ten_nguoi: "Anh Tuấn (trưởng nhóm tình nguyện viên)",
            loi: "Tôi đã chứng kiến giếng đầu tiên có nước. Ngày đó cả làng đứng xem tới tận tối.",
            nguon_id: nguonHienTruong.id,
            muc_id: "ht-tnv",
          },
          {
            // Cố ý không trỏ nguồn: trích dẫn chưa đối chứng tư liệu —
            // chỉ được để [CÂU HỎI].
            id: "tq-khe-tre",
            ten_nguoi: "Người dân Làng Khe Tre",
            loi: "Chúng tôi mong có nước sạch gần nhà.",
            nguon_id: null,
            muc_id: null,
          },
        ],
        cta: [
          {
            id: "cta-quyen-gop",
            nhan: "Quyên góp cho Làng Khe Tre",
            loai: "quyen_gop",
            url: "https://quyengop.giotnuocchung.example.com/lang-khe-tre",
          },
          {
            id: "cta-tac-dong",
            nhan: "Xem báo cáo tác động",
            loai: "tai_lieu",
            url: "https://giotnuocchung.example.com/tac-dong",
          },
        ],
        ghi_chu_quyen: assetAnh
          ? [
              {
                id: "q-anh-hien-truong",
                asset_id: assetAnh,
                ghi_chu:
                  "Tổ chức sở hữu ảnh. Người trong ảnh đã đồng ý bằng văn bản; phạm vi: truyền thông gây quỹ của Giọt Nước Chung.",
              },
            ]
          : [],
        tham_chieu: [
          {
            id: "tc-hien-truong",
            tham_chieu: "Ghi chú hiện trường 3 làng",
            ban_dich: "",
            nguon_id: nguonHienTruong.id,
            ghi_chu: "Ghi chú, số liệu và trích dẫn đã kiểm chứng.",
          },
          {
            id: "tc-ke-hoach",
            tham_chieu: "Kế hoạch Làng Khe Tre",
            ban_dich: "",
            nguon_id: nguonKeHoach.id,
            ghi_chu: "Khảo sát đầu vào và tổng kết năm.",
          },
        ],
      },
      tacGia,
      { id: "seed-cp-gay-quy-khe-tre" },
    );
    capNhatCampaign(
      db,
      cpGq.id,
      { ten: cpGq.ten, muc_luc: deXuatDauRaGayQuy(db, cpGq) },
      tacGia,
    );
    // Nguồn fact tự động + thông điệp chủ đề pin nguồn — đầu ra demo
    // dưới đây pin đúng chuỗi provenance.
    dongBoNguonGayQuy(db, cpGq, tacGia);
    const tdGq = damBaoThongDiepGayQuy(db, layCampaign(db, cpGq.id)!, tacGia);
    const tdRevGq = tdGq.head_revision_id;

    // Đầu ra demo lưu bền: báo cáo tác động (đã duyệt + đã xuất → trang
    // /p/<id> phục vụ), câu chuyện và email NTT lớn chờ duyệt, trang
    // campaign + cập nhật TNV + bản en đã duyệt, caption Instagram còn
    // nháp. Marker [TD:id]/[TQ:id] pin provenance; mục uoc_tinh đi kèm
    // tiền tố 'Ước tính:'; mục chưa xác nhận chỉ để [CÂU HỎI].
    const mucTheoDauRaGq = new Map(
      layCampaign(db, cpGq.id)!.muc_luc.map((m) => [
        `${m.dinh_dang}|${m.dich_den}|${m.ngon_ngu ?? "vi"}`,
        m,
      ]),
    );
    for (const o of NOI_DUNG_DAU_RA_GAY_QUY) {
      const muc = mucTheoDauRaGq.get(`${o.dinh_dang}|${o.dich_den}|${o.ngon_ngu}`);
      const doiTuongTen =
        (muc?.doi_tuong_id ? layDoiTuong(db, muc.doi_tuong_id)?.ten : null) ?? o.doi_tuong;
      taoBanTheHien(
        db,
        {
          thong_diep_id: tdGq.id,
          dinh_dang: o.dinh_dang,
          ngon_ngu: o.ngon_ngu,
          doi_tuong: doiTuongTen,
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
          thong_diep_revision_id: tdRevGq,
        },
        tacGia,
      );
      if (o.dinh_asset && assetAnh) {
        datAssetBanTheHien(db, o.id, [assetAnh], tacGia);
      }
      if (o.trang_thai === "nhap") continue;
      chuyenTrangThai(db, o.id, "cho_duyet", "seed: gửi duyệt", tacGia);
      if (o.trang_thai === "cho_duyet") continue;
      const head = layBanTheHien(db, o.id)?.head_revision_id ?? undefined;
      chuyenTrangThai(db, o.id, "da_duyet", "seed: duyệt", tacGia, head);
      if (o.xuat_ban) {
        xuatBanBanTheHien(db, o.id, { dich_den: o.dich_den || undefined }, tacGia);
      }
    }
    daSeed.push("story_nonprofit_gay_quy");
  }

  // --- Story #11: Sở Ban Quản lý Đô thị TP An Khang — giải thích luật
  // tái chế cho nhiều đối tượng ---
  // Campaign loại 'cong_quyen': văn bản chính sách chính thức đã nạp
  // (phiên bản + phạm vi quyền hạn + ngày hiệu lực), yêu cầu tách
  // 'bắt buộc' vs 'giải thích', ngoại lệ liên kết yêu cầu, fact vận
  // hành, danh sách reviewer thẩm quyền của POC và chế độ bảo vệ bật.
  // Một điều khoản xử phạt cố ý viết mơ hồ → câu hỏi review, không phải
  // luật bịa. Toàn bộ văn bản là HƯ CẤU (ghi trong tiêu đề nguồn).
  // Trạng thái sau seed: chính sách đang có hiệu lực 2027-01-01 và đầu
  // ra rải đủ vòng đời — FAQ đã xuất (trang /p/), checklist đã xuất +
  // đã đăng kênh ngoài, bài trường học chờ duyệt với job đã lên lịch,
  // tóm tắt nhà thầu còn nháp. Walkthrough: sửa ngày hiệu lực thành
  // 2027-03-01 → mọi đầu ra đánh dấu cũ và liệt kê theo đích.
  if (!db.query("SELECT id FROM campaign WHERE id = 'seed-cp-cong-quyen-tai-che'").get()) {
    themDoiTuong(
      db,
      "seed-dt-ho-gia-dinh",
      {
        ten: "Hộ gia đình (fixture)",
        ngon_ngu: "vi",
        dia_diem: "Hộ dân trên địa bàn thành phố An Khang.",
        kien_thuc_nen: "Không đọc văn bản pháp quy.",
        moi_quan_tam: "Phải làm gì, từ ngày nào, đổ rác ở đâu.",
        do_sau: "so_luoc",
        tu_vung: "Đời thường; giải thích từng khái niệm một lần.",
        quan_he_to_chuc: "Cư dân đọc cổng thông tin của thành phố.",
        nhu_cau_giao_tiep: "Câu hỏi — trả lời ngắn; nêu ngày và địa điểm cụ thể.",
        nhan_khau_hoc: "",
      },
      tacGia,
    );
    themDoiTuong(
      db,
      "seed-dt-co-so-kinh-doanh",
      {
        ten: "Cơ sở kinh doanh (fixture)",
        ngon_ngu: "vi",
        dia_diem: "Cửa hàng, cơ sở sản xuất trên địa bàn An Khang.",
        kien_thuc_nen: "Biết quy trình đăng ký hành chính cơ bản.",
        moi_quan_tam: "Nghĩa vụ phải làm, hạn nộp, giấy tờ cần chuẩn bị.",
        do_sau: "vua_phai",
        tu_vung: "Thuật ngữ hành chính phổ biến.",
        quan_he_to_chuc: "Chủ cơ sở hoặc kế toán phụ trách tuân thủ.",
        nhu_cau_giao_tiep: "Checklist các bước; ngoại lệ nêu riêng.",
        nhan_khau_hoc: "",
      },
      tacGia,
    );
    themDoiTuong(
      db,
      "seed-dt-truong-hoc",
      {
        ten: "Trường học (fixture)",
        ngon_ngu: "vi",
        dia_diem: "Trường học trên địa bàn An Khang.",
        kien_thuc_nen: "Giáo viên cần văn bản dạy được cho học sinh.",
        moi_quan_tam: "Vì sao phải phân loại; hoạt động gợi ý trong lớp.",
        do_sau: "so_luoc",
        tu_vung: "Đơn giản, dạy được; tránh văn phong hành chính.",
        quan_he_to_chuc: "Nhà trường nhận văn bản từ cơ quan quản lý.",
        nhu_cau_giao_tiep: "Bài giải thích tách 'phải làm' và 'nên làm'.",
        nhan_khau_hoc: "",
      },
      tacGia,
    );
    themDoiTuong(
      db,
      "seed-dt-nha-thau",
      {
        ten: "Nhà thầu thu gom (fixture)",
        ngon_ngu: "vi",
        dia_diem: "Đơn vị thi công thu gom — vận chuyển ký hợp đồng với thành phố.",
        kien_thuc_nen: "Quen hợp đồng và điều kiện thi công.",
        moi_quan_tam: "Nghĩa vụ hợp đồng, lịch thu, điểm tiếp nhận.",
        do_sau: "vua_phai",
        tu_vung: "Thuật ngữ hợp đồng phổ biến.",
        quan_he_to_chuc: "Nhà thầu phụ của sở ban quản lý.",
        nhu_cau_giao_tiep: "Tóm tắt nghĩa vụ ngắn gọn qua email.",
        nhan_khau_hoc: "",
      },
      tacGia,
    );
    themDoiTuong(
      db,
      "seed-dt-nguoi-nhap-cu",
      {
        ten: "Người nhập cư mới (fixture)",
        ngon_ngu: "en",
        dia_diem: "Người nước ngoài mới chuyển đến An Khang.",
        kien_thuc_nen: "Chưa biết quy định địa phương; đọc tiếng Anh đơn giản.",
        moi_quan_tam: "Quy tắc bắt buộc, ngày bắt đầu, nơi hỏi thêm.",
        do_sau: "so_luoc",
        tu_vung: "Ngôn ngữ giản dị.",
        quan_he_to_chuc: "Cư dân mới trên địa bàn.",
        nhu_cau_giao_tiep: "Bản dịch ngôn ngữ giản dị, giữ nguyên nghĩa vụ và ngày tháng.",
        nhan_khau_hoc: "",
      },
      tacGia,
    );

    themThuongHieu(
      db,
      "seed-th-so-ban-an-khang",
      {
        ten: "Sở Ban Quản lý Đô thị TP An Khang (fixture)",
        nhan_dien:
          "Cơ quan quản lý đô thị của một thành phố hư cấu. Công bố chính sách bằng ngôn ngữ công dân đọc được.",
        ngon_ngu_uu_tien: ["vi", "en"],
        vi_du_giong_van: "Từ ngày 01/03/2027, hộ gia đình phân loại rác thành 3 nhóm.",
        nguyen_tac:
          "Yêu cầu bắt buộc trình bày nguyên văn nghĩa vụ; ngoại lệ luôn đi kèm yêu cầu; ngày hiệu lực và phạm vi quyền hạn không được bỏ hay đổi; điều khoản mơ hồ thành câu hỏi review, không diễn giải.",
        claim_duyet: [
          "Nghĩa vụ, ngoại lệ, ngày hiệu lực và phạm vi áp dụng trích từ văn bản đã nạp.",
          "Điều khoản chưa rõ trình bày là câu hỏi cho thẩm quyền, không phải quy định mới.",
        ],
        claim_cam: [
          "Khẳng định nghĩa vụ không có trong văn bản",
          "Tư vấn pháp lý hay hứa độ chính xác pháp lý của AI",
          "Số tiền xử phạt tự đặt",
        ],
        assets: [],
      },
      tacGia,
    );

    // Văn bản chính sách chính thức (hư cấu): 4 điều rõ + 1 điều mơ hồ
    // + phụ lục vận hành. Mục id cố định để con trỏ bằng chứng của
    // yêu cầu/ngoại lệ/fact resolve được.
    const nguonChinhSach = taoNguon(
      db,
      {
        tieu_de: "QĐ-2027-15/UBND — Phân loại chất thải sinh hoạt TP An Khang (văn bản hư cấu)",
        noi_dung:
          "Quyết định của UBND thành phố An Khang về phân loại chất thải sinh hoạt. Văn bản demo, hư cấu.",
        loai: "van_ban",
        cac_muc: [
          {
            id: "dieu-1-pham-vi",
            loai: "fact",
            tieu_de: "Điều 1 — Phạm vi áp dụng",
            noi_dung:
              "Quyết định này áp dụng trên địa bàn thành phố An Khang. Mọi hộ gia đình, cơ sở kinh doanh, trường học và đơn vị thi công trên địa bàn phải tuân thủ.",
            assets: [],
          },
          {
            id: "dieu-2-ho-gia-dinh",
            loai: "fact",
            tieu_de: "Điều 2 — Phân loại tại hộ gia đình",
            noi_dung:
              "Từ ngày hiệu lực, hộ gia đình phải phân loại chất thải sinh hoạt thành 3 nhóm: tái chế, hữu cơ và còn lại. Việc phân loại phải hoàn thành trước khi đổ tại điểm thu gom.",
            assets: [],
          },
          {
            id: "dieu-3-doanh-nghiep",
            loai: "fact",
            tieu_de: "Điều 3 — Nghĩa vụ cơ sở kinh doanh",
            noi_dung:
              "Cơ sở kinh doanh phải đăng ký điểm thu gom với Sở Ban trước ngày hiệu lực 30 ngày và nộp báo cáo khối lượng chất thải hằng quý.",
            assets: [],
          },
          {
            id: "dieu-4-ngoai-le",
            loai: "fact",
            tieu_de: "Điều 4 — Ngoại lệ và gia hạn",
            noi_dung:
              "Hộ gia đình có hộ khẩu tạm trú được gia hạn thực hiện Điều 2 thêm 6 tháng kể từ ngày hiệu lực. Cơ sở kinh doanh có dưới 5 lao động được miễn nộp báo cáo hằng quý nhưng vẫn phải đăng ký điểm thu gom.",
            assets: [],
          },
          {
            // Cố ý mơ hồ: 'phù hợp', 'theo quy định', 'tùy trường hợp',
            // 'xem xét', 'linh hoạt' → câu hỏi review, không phải luật bịa.
            id: "dieu-5-xu-phat",
            loai: "fact",
            tieu_de: "Điều 5 — Xử phạt và tổ chức thực hiện",
            noi_dung:
              "Mức xử phạt áp dụng phù hợp theo quy định hiện hành và tùy trường hợp cụ thể do Sở Ban xem xét. Việc phối hợp giữa các phường có thể linh hoạt theo tình hình thực tế.",
            assets: [],
          },
        ],
      },
      tacGia,
      { id: "seed-nguon-chinh-sach-tai-che" },
    );
    const nguonVanHanh = taoNguon(
      db,
      {
        tieu_de: "Thông báo vận hành của Sở Ban (dữ liệu hư cấu)",
        noi_dung:
          "Điểm thu gom tập trung và kênh hỗ trợ cho giai đoạn đầu thực hiện. Dữ liệu demo, hư cấu.",
        loai: "van_ban",
        cac_muc: [
          {
            id: "vh-diem-thu",
            loai: "fact",
            tieu_de: "Điểm thu gom tập trung",
            noi_dung:
              "Điểm thu gom tập trung: công viên trung tâm và chợ đầu mối, mở cửa 6h-18h hằng ngày. Thùng phân loại 3 màu phát miễn phí tại UBND phường.",
            assets: [],
          },
          {
            id: "vh-hotline",
            loai: "fact",
            tieu_de: "Kênh hỗ trợ",
            noi_dung: "Đường dây nóng hỗ trợ: 1900-6868 (giờ hành chính).",
            assets: [],
          },
        ],
      },
      tacGia,
      { id: "seed-nguon-van-hanh-tai-che" },
    );

    const cpCq = taoCampaign(
      db,
      {
        loai: "cong_quyen",
        ten: "Luật tái chế thành phố An Khang",
        mo_ta:
          "Sở Ban Quản lý Đô thị công bố quyết định phân loại chất thải sinh hoạt — giải thích cho hộ gia đình, cơ sở kinh doanh, trường học, nhà thầu và người nhập cư. Persona demo: cơ quan công quyền (hư cấu).",
        phien_ban: "QĐ-2027-15/UBND",
        pham_vi_quyen_han:
          "Địa bàn thành phố An Khang — mọi hộ gia đình, cơ sở kinh doanh, trường học và đơn vị thi công trên địa bàn.",
        ngay_hieu_luc: "2027-01-01",
        ngon_ngu_phu: "en",
        nguon_chinh_sach_id: nguonChinhSach.id,
        che_do_bao_ve: 1,
        thuong_hieu_id: "seed-th-so-ban-an-khang",
        doi_tuong_id: "seed-dt-ho-gia-dinh",
        ds_yeu_cau: [
          {
            id: "yc-phan-loai",
            noi_dung:
              "Hộ gia đình phải phân loại chất thải sinh hoạt thành 3 nhóm: tái chế, hữu cơ và còn lại, trước khi đổ tại điểm thu gom.",
            loai: "bat_buoc",
            doi_tuong_ap_dung: "ho_gia_dinh",
            nguon_id: nguonChinhSach.id,
            muc_id: "dieu-2-ho-gia-dinh",
          },
          {
            id: "yc-dang-ky-diem",
            noi_dung:
              "Cơ sở kinh doanh phải đăng ký điểm thu gom với Sở Ban trước ngày hiệu lực 30 ngày.",
            loai: "bat_buoc",
            doi_tuong_ap_dung: "doanh_nghiep",
            nguon_id: nguonChinhSach.id,
            muc_id: "dieu-3-doanh-nghiep",
          },
          {
            id: "yc-bao-cao",
            noi_dung: "Cơ sở kinh doanh phải nộp báo cáo khối lượng chất thải hằng quý.",
            loai: "bat_buoc",
            doi_tuong_ap_dung: "doanh_nghiep",
            nguon_id: nguonChinhSach.id,
            muc_id: "dieu-3-doanh-nghiep",
          },
          {
            id: "yc-truong-hoc",
            noi_dung:
              "Trường học trên địa bàn thuộc phạm vi áp dụng; nội dung giải thích giúp học sinh hiểu cách phân loại.",
            loai: "giai_thich",
            doi_tuong_ap_dung: "truong_hoc",
            nguon_id: nguonChinhSach.id,
            muc_id: "dieu-1-pham-vi",
          },
          {
            // Cố ý không trỏ nguồn: lịch thu từng tuyến phố chưa có văn
            // bản — đầu ra chỉ được để [CÂU HỎI], không viết như quy định.
            id: "yc-lich-thu",
            noi_dung: "Lịch thu gom từng tuyến phố theo công bố của phường.",
            loai: "giai_thich",
            doi_tuong_ap_dung: "",
            nguon_id: null,
            muc_id: null,
          },
        ],
        ds_ngoai_le: [
          {
            id: "nl-tam-tru",
            noi_dung:
              "Hộ gia đình có hộ khẩu tạm trú được gia hạn thực hiện thêm 6 tháng kể từ ngày hiệu lực.",
            yeu_cau_id: "yc-phan-loai",
            nguon_id: nguonChinhSach.id,
            muc_id: "dieu-4-ngoai-le",
          },
          {
            id: "nl-it-lao-dong",
            noi_dung:
              "Cơ sở kinh doanh dưới 5 lao động được miễn nộp báo cáo hằng quý nhưng vẫn phải đăng ký điểm thu gom.",
            yeu_cau_id: "yc-bao-cao",
            nguon_id: nguonChinhSach.id,
            muc_id: "dieu-4-ngoai-le",
          },
        ],
        ds_fact_van_hanh: [
          {
            id: "fv-diem-thu",
            tieu_de: "Điểm thu gom tập trung",
            noi_dung:
              "Điểm thu gom tập trung: công viên trung tâm và chợ đầu mối; mở 6h-18h hằng ngày; thùng phân loại phát miễn phí tại UBND phường.",
            nguon_id: nguonVanHanh.id,
            muc_id: "vh-diem-thu",
          },
          {
            id: "fv-hotline",
            tieu_de: "Đường dây nóng",
            noi_dung: "Đường dây nóng hỗ trợ: 1900-6868 (giờ hành chính).",
            nguon_id: nguonVanHanh.id,
            muc_id: "vh-hotline",
          },
        ],
        ds_nguoi_duyet: [
          { id: "nd-lan", ten: "Nguyễn Thị Lan", vai_tro: "Tham mưu pháp chế" },
          { id: "nd-hung", ten: "Trần Minh Hùng", vai_tro: "Lãnh đạo phòng truyền thông" },
        ],
        tham_chieu: [
          {
            id: "tc-van-ban",
            tham_chieu: "Văn bản QĐ-2027-15/UBND",
            ban_dich: "",
            nguon_id: nguonChinhSach.id,
            ghi_chu: "Văn bản chính sách chính thức — claim yêu cầu/ngày ghim vào đây.",
          },
          {
            id: "tc-van-hanh",
            tham_chieu: "Thông báo vận hành của Sở Ban",
            ban_dich: "",
            nguon_id: nguonVanHanh.id,
            ghi_chu: "Điểm thu gom và kênh hỗ trợ — nguồn của fact vận hành.",
          },
        ],
        cta: [
          {
            id: "cta-cong-thong-tin",
            nhan: "Cổng thông tin của thành phố",
            loai: "chung",
            url: "https://ankhang.example.com/tai-che",
          },
        ],
      },
      tacGia,
      { id: "seed-cp-cong-quyen-tai-che" },
    );
    capNhatCampaign(
      db,
      cpCq.id,
      { ten: cpCq.ten, muc_luc: deXuatDauRaCongQuyen(db, cpCq) },
      tacGia,
    );
    // Nguồn fact tự động 'cq-*' + thông điệp chủ đề pin nguồn — đầu ra
    // demo dưới đây pin đúng chuỗi provenance.
    dongBoNguonCongQuyen(db, cpCq, tacGia);
    const tdCq = damBaoThongDiepCongQuyen(db, layCampaign(db, cpCq.id)!, tacGia);
    const tdRevCq = tdCq.head_revision_id;

    const mucTheoDauRaCq = new Map(
      layCampaign(db, cpCq.id)!.muc_luc.map((m) => [
        `${m.dinh_dang}|${m.dich_den}|${m.ngon_ngu ?? "vi"}`,
        m,
      ]),
    );
    for (const o of NOI_DUNG_DAU_RA_CONG_QUYEN) {
      const muc = mucTheoDauRaCq.get(`${o.dinh_dang}|${o.dich_den}|${o.ngon_ngu}`);
      const doiTuongTen =
        (muc?.doi_tuong_id ? layDoiTuong(db, muc.doi_tuong_id)?.ten : null) ?? o.doi_tuong;
      taoBanTheHien(
        db,
        {
          thong_diep_id: tdCq.id,
          dinh_dang: o.dinh_dang,
          ngon_ngu: o.ngon_ngu,
          doi_tuong: doiTuongTen,
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
          thong_diep_revision_id: tdRevCq,
        },
        tacGia,
      );
      if (o.trang_thai === "nhap") continue;
      chuyenTrangThai(db, o.id, "cho_duyet", "seed: gửi duyệt", tacGia);
      if (o.trang_thai === "cho_duyet") continue;
      const head = layBanTheHien(db, o.id)?.head_revision_id ?? undefined;
      // Duyệt ghi reviewer thẩm quyền của POC vào record duyet (#11).
      chuyenTrangThai(db, o.id, "da_duyet", "seed: duyệt", tacGia, head, "nd-lan");
      if (o.xuat_ban) {
        // dich_den_xuat '': xuất lên trang nội bộ /p (nhóm 'đã xuất');
        // có giá trị: copy đã đăng tay ra kênh ngoài (nhóm 'đã đăng').
        // Chuỗi rỗng phải truyền nguyên — để undefined là service fallback
        // về dich_den của bản thể hiện.
        xuatBanBanTheHien(
          db,
          o.id,
          {
            dich_den:
              o.dich_den_xuat !== undefined ? o.dich_den_xuat : o.dich_den || undefined,
          },
          tacGia,
        );
      }
    }
    // Job sinh đã lên lịch cho bài trường học (tái sinh theo lịch): đổi
    // ngày hiệu lực → job này bị chặn cho tới khi review lại, liệt kê
    // riêng ở nhóm 'đã lên lịch'.
    const bthTruongHoc = layBanTheHien(db, "seed-bth-cq-truong-hoc");
    if (bthTruongHoc) {
      enqueueJob(db, {
        loai: "sinh_ban_the_hien",
        khoaIdem: "sinh_ban_the_hien:seed-bth-cq-truong-hoc",
        entityLoai: "ban_the_hien",
        entityId: bthTruongHoc.id,
        revisionId: bthTruongHoc.head_revision_id ?? null,
        payload: {
          ban_the_hien_id: bthTruongHoc.id,
          campaign_id: cpCq.id,
          doi_tuong: bthTruongHoc.doi_tuong,
        },
        chaySomNhat: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
      });
    }
    daSeed.push("story_cong_quyen_tai_che");
  }

  // --- Story #12: Thương hiệu giày chạy Velocity — chiến dịch đa
  // thị trường với claim chung và ghi đè theo thị trường ---
  // Campaign loai 'thuong_hieu': claim sản phẩm đã duyệt, giọng văn,
  // asset hình và CTA mặc định ở tầng chung; mỗi thị trường có nguồn
  // fact + thông điệp riêng → sửa claim chung đánh dấu cũ mọi biến
  // thể, sửa giá local chỉ đánh dấu cũ biến thể thị trường đó (#14).
  // Ba thị trường: US (en/USD, đủ fact), VN (vi/VND, bắt buộc
  // reviewer local), EU (en, chưa có giá/khả dụng → 'chưa đủ', tổ
  // hợp bị chặn). Một claim 'khí động học' cố ý chưa có bằng chứng
  // → đầu ra chỉ được để [CÂU HỎI]. Mọi số liệu và URL là hư cấu.
  // Trạng thái sau seed: US có bài viết đã duyệt bởi reviewer local;
  // VN có caption chờ duyệt. Walkthrough: chọn tổ hợp EU → bị chặn
  // 'chưa đủ'; thêm giá cho EU → tổ hợp mở; sửa giá VN → chỉ biến
  // thể VN đánh dấu cũ.
  if (!db.query("SELECT id FROM campaign WHERE id = 'seed-cp-thuong-hieu-velocity'").get()) {
    themThuongHieu(
      db,
      "seed-th-giay-chay-velocity",
      {
        ten: "Velocity Footwear (fixture)",
        nhan_dien:
          "Hãng giày chạy hư cấu. Bán giày chạy hằng ngày trên nhiều thị trường.",
        ngon_ngu_uu_tien: ["en", "vi"],
        vi_du_giong_van: "Velocity Run 2 carries your next run — verified specs, no hype.",
        nguyen_tac:
          "Mọi claim sản phẩm phải trỏ về spec đã duyệt. Không hứa hiệu năng hay lợi ích sức khỏe ngoài claim đã duyệt. Giá và khả dụng theo từng thị trường, không tự quy đổi tiền tệ.",
        claim_duyet: [
          "Số liệu kỹ thuật trích nguyên văn từ spec đã nạp.",
          "Giá, tiền tệ và khả dụng lấy nguyên văn từ fact thị trường.",
        ],
        claim_cam: [
          "Giày chạy nhanh nhất thế giới",
          "Giảm chấn thương hay cải thiện sức khỏe",
          "Tự quy đổi giá sang tiền tệ khác",
          "Bịa yêu cầu pháp lý địa phương",
        ],
        assets: [],
      },
      tacGia,
    );

    themDoiTuong(
      db,
      "seed-dt-runner-thi-dau",
      {
        ten: "Runner thi đấu (fixture)",
        ngon_ngu: "en",
        dia_diem: "Runner chạy giải, theo dõi pace và số liệu.",
        kien_thuc_nen: "Quen thuật ngữ giày chạy: đế đệm, trả năng lượng, drop.",
        moi_quan_tam: "Số liệu spec, so sánh trọng lượng, thông tin giải chạy.",
        do_sau: "chuyen_sau",
        tu_vung: "Thuật ngữ chạy bộ phổ biến.",
        quan_he_to_chuc: "Độc giả theo dõi thương hiệu trên blog và social.",
        nhu_cau_giao_tiep: "Dẫn số liệu trước; claim phải có bằng chứng.",
        nhan_khau_hoc: "",
      },
      tacGia,
    );
    themDoiTuong(
      db,
      "seed-dt-runner-phong-trao",
      {
        ten: "Runner phong trào (fixture)",
        ngon_ngu: "vi",
        dia_diem: "Người chạy vui khỏe cuối tuần, mới bắt đầu chạy.",
        kien_thuc_nen: "Ít biết thuật ngữ kỹ thuật.",
        moi_quan_tam: "Giày êm chân, giá, nơi mua, chính sách đổi trả.",
        do_sau: "so_luoc",
        tu_vung: "Đời thường; giải thích thuật ngữ một lần.",
        quan_he_to_chuc: "Người mua tiềm năng đọc quảng cáo và mạng xã hội.",
        nhu_cau_giao_tiep: "Ngắn gọn, thân thiện; giá và nơi mua rõ ràng.",
        nhan_khau_hoc: "",
      },
      tacGia,
    );

    // Spec sản phẩm đã duyệt (hư cấu) — bằng chứng cho claim chung.
    const nguonSpecTh = taoNguon(
      db,
      {
        tieu_de: "Spec sản phẩm Velocity Run 2 (dữ liệu hư cấu)",
        noi_dung:
          "Thông số kỹ thuật đã duyệt của giày chạy Velocity Run 2. Tài liệu demo, hư cấu.",
        loai: "van_ban",
        cac_muc: [
          {
            id: "cl-de-dem",
            loai: "fact",
            tieu_de: "Đế đệm",
            noi_dung:
              "Đế đệm foam X-Return trả lại khoảng 80% năng lượng mỗi sải chạy, theo phép đo trong phòng thí nghiệm.",
            assets: [],
          },
          {
            id: "cl-trong-luong",
            loai: "fact",
            tieu_de: "Trọng lượng",
            noi_dung: "Trọng lượng 210 g (size 42), đo trên mẫu sản xuất thử.",
            assets: [],
          },
          {
            id: "cl-upper",
            loai: "fact",
            tieu_de: "Upper",
            noi_dung: "Upper dệt một lớp, thoáng khí; dây giày phản quang.",
            assets: [],
          },
        ],
      },
      tacGia,
      { id: "seed-nguon-giay-chay-spec" },
    );

    const anhGiay = ghiAssetFixture(
      db,
      tuyChon.dataDir ?? "./data",
      nguonSpecTh.id,
      tacGia,
      "giay-chay-velocity.webp",
      "Ảnh sản phẩm Velocity Run 2 (fixture).",
    );

    const cpTh = taoCampaign(
      db,
      {
        loai: "thuong_hieu",
        ten: "Velocity Run 2 — ra mắt toàn cầu",
        mo_ta:
          "Chiến dịch ra mắt giày chạy Velocity Run 2 trên nhiều thị trường. Persona demo: thương hiệu toàn cầu (hư cấu).",
        thong_diep_loi:
          "Velocity Run 2: đế đệm trả năng lượng, upper thoáng, cho ngày chạy tiếp theo.",
        dinh_vi: "Giày chạy hằng ngày cho runner từ phong trào đến thi đấu.",
        giong_van: "Gọn, tự tin, kỹ thuật — không phóng đại.",
        thuong_hieu_id: "seed-th-giay-chay-velocity",
        doi_tuong_id: "seed-dt-runner-phong-trao",
        ds_claim: [
          {
            id: "cl-de-dem",
            noi_dung:
              "Đế đệm X-Return trả lại khoảng 80% năng lượng mỗi sải chạy (đo lab).",
            nguon_id: nguonSpecTh.id,
            muc_id: "cl-de-dem",
          },
          {
            id: "cl-trong-luong",
            noi_dung: "Trọng lượng 210 g (size 42).",
            nguon_id: nguonSpecTh.id,
            muc_id: "cl-trong-luong",
          },
          {
            // Cố ý không trỏ nguồn: claim khí động học chưa có bằng
            // chứng → đầu ra chỉ được để [CÂU HỎI], không viết như fact.
            id: "cl-khi-dong",
            noi_dung: "Thiết kế khí động học giảm lực cản 12%.",
            nguon_id: null,
            muc_id: null,
          },
        ],
        ds_asset_hinh: anhGiay
          ? [
              {
                id: "ah-giay-chinh",
                asset_id: anhGiay,
                ghi_chu: "Ảnh sản phẩm chính — dùng cho banner và thumbnail bài viết.",
              },
            ]
          : [],
        cta: [
          {
            id: "cta-chinh",
            nhan: "Khám phá Velocity Run 2",
            loai: "",
            url: "https://velocity-run.example.com/run-2",
          },
        ],
      },
      tacGia,
      { id: "seed-cp-thuong-hieu-velocity" },
    );
    // Nguồn fact chung 'th-*' tự động; mỗi thị trường tạo nguồn fact +
    // thông điệp riêng pin cả nguồn chung và nguồn thị trường.
    dongBoNguonThuongHieu(db, layCampaign(db, cpTh.id)!, tacGia);
    const cpThMoi = layCampaign(db, cpTh.id)!;

    const ttUs = dongBoThiTruong(
      db,
      cpThMoi,
      {
        ma: "us",
        ten: "Hoa Kỳ",
        ngon_ngu: "en",
        gia: "189",
        tien_te: "USD",
        kha_dung: "co_hang",
        landing_page: "https://velocity-run.example.com/us",
        cta_nhan: "Shop the US store",
        cta_url: "https://velocity-run.example.com/us/run-2",
        ds_chi_tiet: [
          {
            doi_tuong_id: "seed-dt-runner-thi-dau",
            chi_tiet: "Free gait analysis at partner labs through October.",
          },
          {
            doi_tuong_id: "seed-dt-runner-phong-trao",
            chi_tiet: "30-day trial runs — return in any condition.",
          },
        ],
        ds_nguoi_duyet: [
          { id: "rev-us-maya", ten: "Maya Chen", vai_tro: "Marketing lead US" },
        ],
        bat_buoc_duyet: 0,
      },
      tacGia,
    ).thi_truong;

    const ttVn = dongBoThiTruong(
      db,
      cpThMoi,
      {
        ma: "vn",
        ten: "Việt Nam",
        ngon_ngu: "vi",
        gia: "4.590.000",
        tien_te: "VND",
        kha_dung: "co_hang",
        landing_page: "/vn/giay-chay",
        cta_nhan: "Đặt mua tại cửa hàng",
        cta_url: "https://velocity-run.example.com/vn",
        ds_chi_tiet: [
          {
            doi_tuong_id: "seed-dt-runner-thi-dau",
            chi_tiet: "Nhóm chạy thử mỗi sáng thứ 7 tại công viên Tao Đàn.",
          },
          {
            doi_tuong_id: "seed-dt-runner-phong-trao",
            chi_tiet: "Đổi size miễn phí trong 30 ngày.",
          },
        ],
        ds_nguoi_duyet: [
          { id: "rev-vn-tam", ten: "Phạm Tâm", vai_tro: "Trưởng nhóm thị trường VN" },
        ],
        bat_buoc_duyet: 1,
      },
      tacGia,
    ).thi_truong;

    // Thị trường EU cố ý thiếu giá + khả dụng → 'chưa đủ', mọi tổ hợp
    // cần fact đó bị chặn; ghi đè pháp lý là yêu cầu thật của đội local.
    dongBoThiTruong(
      db,
      cpThMoi,
      {
        ma: "eu",
        ten: "Liên minh châu Âu",
        ngon_ngu: "en",
        gia: "",
        tien_te: "EUR",
        kha_dung: "",
        landing_page: "https://velocity-run.example.com/eu",
        ghi_de: { phap_ly: "Cần đội pháp lý EU rà soát trước khi đăng." },
        ds_nguoi_duyet: [
          { id: "rev-eu-lena", ten: "Lena Fischer", vai_tro: "Marketing lead EU" },
        ],
      },
      tacGia,
    );

    // Biến thể sẵn có: bài viết US đã duyệt bởi reviewer local + caption
    // VN đang chờ duyệt — ma trận có dữ liệu ngay sau seed.
    const tdUs = layThongDiep(db, ttUs.thong_diep_id!)!;
    const tdVn = layThongDiep(db, ttVn.thong_diep_id!)!;
    for (const o of NOI_DUNG_DAU_RA_THUONG_HIEU) {
      const td = o.thi_truong === "us" ? tdUs : tdVn;
      taoBanTheHien(
        db,
        {
          thong_diep_id: td.id,
          dinh_dang: o.dinh_dang,
          ngon_ngu: o.ngon_ngu,
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
          thong_diep_revision_id: td.head_revision_id,
        },
        tacGia,
      );
      if (o.trang_thai === "nhap") continue;
      chuyenTrangThai(db, o.id, "cho_duyet", "seed: gửi duyệt", tacGia);
      if (o.trang_thai === "cho_duyet") continue;
      const head = layBanTheHien(db, o.id)?.head_revision_id ?? undefined;
      chuyenTrangThai(db, o.id, "da_duyet", "seed: duyệt", tacGia, head, o.nguoi_duyet);
    }

    daSeed.push("story_thuong_hieu_toan_cau");
  }

  // --- Story #13: kênh sở hữu — dữ liệu demo luồng giao ---
  // Một newsletter đã duyệt (demo xem trước + giao email), danh bạ opt-in
  // gồm 2 người đang đăng ký và 1 đã hủy (demo suppression trong xem
  // trước). Trang nội bộ dùng seed-bth-tb-web, xuất tay dùng
  // seed-bth-tb-ig — hai đầu ra tiệm bánh đã duyệt sẵn.
  if (!db.query("SELECT id FROM ban_the_hien WHERE id = 'seed-bth-kenh-newsletter'").get()) {
    const tdTiemBanh = layThongDiep(db, "seed-td-tiem-banh");
    if (tdTiemBanh) {
      taoBanTheHien(
        db,
        {
          thong_diep_id: tdTiemBanh.id,
          dinh_dang: "newsletter",
          ngon_ngu: "vi",
          doi_tuong: "Khách quen khu phố (fixture)",
          dich_den: "",
        },
        tacGia,
        { id: "seed-bth-kenh-newsletter" },
      );
      themRevision(
        db,
        {
          ban_the_hien_id: "seed-bth-kenh-newsletter",
          noi_dung: JSON.stringify({
            tieu_de: "Bản tin tuần — croissant hạt dẻ ra mắt thứ Bảy",
            tom_tat: "Ra mắt 2026-10-10T08:00, giá 45.000đ, đặt trước cho khách quen.",
            noi_dung:
              "Chào khách quen,\n\nTiệm ra mắt bánh croissant hạt dẻ lúc 2026-10-10T08:00 (giờ Hà Nội) — vỏ giòn nhiều lớp, nhân hạt dẻ rang xay trong ngày, giá 45.000đ một ổ.\n\nĐặt trước qua link để giữ phần: https://tiembanh.example.com/dat-hang\n\nCảm ơn quý khách đã ủng hộ tiệm.",
          }),
          dua_tren_revision_id: null,
          thong_diep_revision_id: tdTiemBanh.head_revision_id,
        },
        tacGia,
      );
      chuyenTrangThai(db, "seed-bth-kenh-newsletter", "cho_duyet", "seed: gửi duyệt", tacGia);
      const head = layBanTheHien(db, "seed-bth-kenh-newsletter")?.head_revision_id ?? undefined;
      chuyenTrangThai(db, "seed-bth-kenh-newsletter", "da_duyet", "seed: duyệt", tacGia, head);
    }
  }
  if (!db.query("SELECT id FROM nguoi_nhan WHERE email = 'ngoc@example.com'").get()) {
    themNguoiNhan(db, { email: "ngoc@example.com", ten: "Ngọc" }, urlGoc, tacGia);
    themNguoiNhan(db, { email: "minh@example.com", ten: "Minh" }, urlGoc, tacGia);
    const nnHuy = themNguoiNhan(db, { email: "tam@example.com", ten: "Tâm" }, urlGoc, tacGia);
    huyDangKyNguoiNhan(db, nnHuy.nguoi_nhan.id, urlGoc);
    daSeed.push("story_kenh_so_huu");
  }

  // --- Story #15: đo kết quả kênh sở hữu — dữ liệu demo cho trang
  // Kết quả: mục tiêu trên thông điệp tiệm bánh, link đích theo dõi đặt
  // trước, lần giao fixture (trang nội bộ da_giao + email chap_nhan +
  // caption xuất tay), sự kiện first-party, snapshot provider, và một
  // kết quả nhập tay kèm bằng chứng. Đủ dữ liệu để dashboard + gợi ý
  // có nội dung ngay sau seed.
  if (
    !db
      .query("SELECT id FROM muc_tieu_ket_qua WHERE chu_loai = 'thong_diep' AND chu_id = 'seed-td-tiem-banh'")
      .get()
  ) {
    const tdTiemBanh = layThongDiep(db, "seed-td-tiem-banh");
    const bthWeb = layBanTheHien(db, "seed-bth-tb-web");
    const bthNews = layBanTheHien(db, "seed-bth-kenh-newsletter");
    const bthIg = layBanTheHien(db, "seed-bth-tb-ig");
    if (tdTiemBanh && bthWeb && bthNews && bthIg) {
      datMucTieu(
        db,
        {
          chu_loai: "thong_diep",
          chu_id: tdTiemBanh.id,
          mo_ta: "Bán hết 30 ổ croissant hạt dẻ trong ngày ra mắt 2026-10-10.",
          tieu_chi: [{ ten: "don_dat_truoc", don_vi: "đơn", nguong: 20 }],
        },
        tacGia,
      );
      const { link } = taoLinkDich(
        db,
        {
          url_dich: "https://tiembanh.example.com/dat-hang",
          thong_diep_id: tdTiemBanh.id,
          nhan: "Đặt trước croissant",
        },
        urlGoc,
        tacGia,
      );
      // Link thứ hai gắn đầu ra web, cố ý KHÔNG có sự kiện click — kích
      // hoạt gợi ý 'cau_hoi' (xem nhiều, click 0) trong demo.
      taoLinkDich(
        db,
        {
          url_dich: "https://tiembanh.example.com/menu",
          ban_the_hien_id: bthWeb.id,
          nhan: "Xem thực đơn",
        },
        urlGoc,
        tacGia,
      );

      // Lần giao fixture — insert trực tiếp vì seed chạy đồng bộ, không
      // qua được adapter async. Trạng thái khớp semantics adapter thật:
      // trang_noi_bo → da_giao, email → chap_nhan (provider mới nhận),
      // xuat_tay → chỉ là bundle đã xuất, không phải đã đăng.
      const tsCu = new Date(Date.now() - 26 * 60 * 60 * 1000).toISOString();
      const ts = new Date().toISOString();
      const giaoFixture = [
        {
          id: "seed-giao-web",
          bth: bthWeb,
          kenh: "trang_noi_bo",
          trang_thai: "da_giao",
          url: `${urlGoc}/p/${bthWeb.id}`,
          so_nhan: 0,
          chi_tiet: {},
        },
        {
          id: "seed-giao-email",
          bth: bthNews,
          kenh: "email",
          trang_thai: "chap_nhan",
          url: "",
          so_nhan: 2,
          chi_tiet: {
            da_gui: ["ngoc@example.com", "minh@example.com"],
            bien_nhan: { "ngoc@example.com": "re_seed_ngoc", "minh@example.com": "re_seed_minh" },
          },
        },
        {
          id: "seed-giao-ig",
          bth: bthIg,
          kenh: "xuat_tay",
          trang_thai: "xuat_tay",
          url: "",
          so_nhan: 0,
          chi_tiet: {},
        },
      ];
      for (const g of giaoFixture) {
        db.query(
          `INSERT INTO giao_hang
             (id, ban_the_hien_id, revision_id, kenh, dich_den, trang_thai, job_id, khoa_idem,
              ma_bien_nhan, url, len_lich_luc, mui_gio, so_nguoi_nhan, so_bo_qua, lan_thu, loi,
              chi_tiet, revision_thanh_cong, la_test, tao_luc, tao_boi, xong_luc)
           VALUES (?, ?, ?, ?, '', ?, '', ?, ?, ?, NULL, 'Asia/Ho_Chi_Minh', ?, ?, 1, '', ?, ?, 0, ?, ?, ?)`,
        ).run(
          g.id,
          g.bth.id,
          g.bth.head_revision_id ?? "",
          g.kenh,
          g.trang_thai,
          `seed:${g.id}`,
          g.kenh === "email" ? "re_seed_demo_001" : "",
          g.url,
          g.so_nhan,
          g.kenh === "email" ? 1 : 0,
          JSON.stringify(g.chi_tiet),
          g.bth.head_revision_id ?? "",
          tsCu,
          tacGia,
          tsCu,
        );
      }

      // Sự kiện first-party fixture: xem trang trên đầu ra web, click link
      // đặt trước, và 1 sự kiện bot (đếm riêng, không gộp vào số chính).
      const suKien = [
        ...Array.from({ length: 12 }, (_, i) => ({
          loai: "xem_trang",
          dtLoai: "ban_the_hien",
          dtId: bthWeb.id,
          khoa: `xem_trang:${bthWeb.id}:seed-vt${String(i).padStart(2, "0")}:k0`,
          bot: 0,
        })),
        { loai: "xem_trang", dtLoai: "ban_the_hien", dtId: bthWeb.id, khoa: `xem_trang:${bthWeb.id}:seed-bot:k0`, bot: 1 },
        ...Array.from({ length: 4 }, (_, i) => ({
          loai: "click_link",
          dtLoai: "link_dich",
          dtId: link.id,
          khoa: `click_link:${link.id}:seed-vt${String(i).padStart(2, "0")}:k0`,
          bot: 0,
        })),
        { loai: "click_link", dtLoai: "link_dich", dtId: link.id, khoa: `click_link:${link.id}:seed-bot:k0`, bot: 1 },
      ];
      for (const [i, s] of suKien.entries()) {
        db.query(
          `INSERT INTO su_kien_do (id, loai, doi_tuong_loai, doi_tuong_id, khoa_dedupe, la_bot, chi_tiet, tao_luc)
           VALUES (?, ?, ?, ?, ?, ?, '{}', ?)`,
        ).run(
          `seed-sk-${String(i).padStart(2, "0")}`,
          s.loai,
          s.dtLoai,
          s.dtId,
          s.khoa,
          s.bot,
          new Date(Date.now() - (suKien.length - i) * 47 * 60 * 1000).toISOString(),
        );
      }

      // Snapshot provider cho lần giao email — số đếm do provider báo,
      // giữ riêng khỏi sự kiện first-party.
      const giaoEmail = layGiaoHang(db, "seed-giao-email");
      if (giaoEmail) {
        ghiSnapshotProvider(db, giaoEmail, {
          "ngoc@example.com": { su_kien_cuoi: "opened" },
          "minh@example.com": { su_kien_cuoi: "delivered" },
        });
        // Đẩy thu_luc snapshot về >24h trước → gợi ý 'thu_metric' hiện ra
        // trong demo (metric cũ cần thu lại).
        db.query("UPDATE so_lieu SET thu_luc = ? WHERE chu_id = 'seed-giao-email'").run(tsCu);
      }

      // Kết quả tự nhập kèm bằng chứng — nhãn tu_bao.
      nhapKetQua(
        db,
        {
          chu_loai: "thong_diep",
          chu_id: tdTiemBanh.id,
          ten: "don_dat_truoc",
          gia_tri: 12,
          don_vi: "đơn",
          mo_ta: "Đơn đặt trước croissant tính tới sáng ra mắt.",
          bang_chung: "sổ ghi đơn đặt trước 2026-10-10",
          nhan_dinh: "tu_bao",
          cua_so_tu: tsCu,
          cua_so_den: ts,
          mui_gio: "Asia/Ho_Chi_Minh",
        },
        tacGia,
      );
      daSeed.push("story_do_ket_qua");
    }
  }

  // --- Story #64 + #70: đồ thị khách hàng — hành trình đầy đủ cho một
  // khách (KH-1042, lan.nguyen@example.com): visitor xem trang web →
  // đăng ký email → mở/click mail → đơn hàng import → conversion có
  // attribution. Touchpoint ghi TRƯỚC khi nạp đơn vì quy_ve tính tại
  // lúc ghi conversion; xay_ra_luc cố định để demo deterministic.
  // Idempotent: chạy lại seed không nhân person/event/conversion.
  if (
    !db.query(
      "SELECT id FROM chuyen_doi WHERE khoa_idem = 'nd:pos-tiem-banh:DH-5001'",
    ).get()
  ) {
    const kqKh = resolveKhach(
      db,
      [{ loai: "email", gia_tri: "lan.nguyen@example.com", nguon: "web" }],
      { ten: "Nguyễn Lan" },
      tacGia,
    );
    const khId = kqKh.khach.id;
    ghiTuongTac(db, {
      khach_id: khId,
      loai: "xem",
      nguon: "web",
      xay_ra_luc: "2026-10-08T10:00:00+07:00",
      ban_the_hien_id: "seed-bth-tb-web",
      khoa_idem: "sd:xem:tb-web:lan",
      chi_tiet: { duong_dan: "/p/seed-bth-tb-web" },
    });
    ghiTuongTac(db, {
      khach_id: khId,
      loai: "dang_ky",
      nguon: "web",
      xay_ra_luc: "2026-10-09T20:00:00+07:00",
      campaign_id: "seed-cp-so-002",
      khoa_idem: "sd:dk:lan:cp-so-002",
      chi_tiet: { kenh: "email" },
    });
    datDongY(db, khId, {
      kenh: "email",
      muc_dich: "marketing",
      trang_thai: "cho",
      nguon: "web",
    });
    ghiTuongTac(db, {
      khach_id: khId,
      loai: "mo",
      nguon: "email",
      xay_ra_luc: "2026-10-10T08:00:00+07:00",
      campaign_id: "seed-cp-so-002",
      khoa_idem: "sd:mo:lan:cp-so-002",
    });
    ghiTuongTac(db, {
      khach_id: khId,
      loai: "click_mail",
      nguon: "email",
      xay_ra_luc: "2026-10-10T08:30:00+07:00",
      campaign_id: "seed-cp-so-002",
      khoa_idem: "sd:click:lan:cp-so-002",
    });
    const kqNap = napDonHangMau(db, tacGia);
    if (kqNap.so_don_moi > 0) daSeed.push("story_khach_hang");
  }

  return { da_seed: daSeed };
}

// Nội dung story #12 (viết tay, canonical JSON theo schema định dạng):
// bài viết US (en) đã duyệt + caption VN (vi) chờ duyệt. Giá, tiền tệ,
// khả dụng và chi tiết đối tượng lấy nguyên văn từ fact thị trường;
// claim 'khí động học' chưa có bằng chứng → [CÂU HỎI], không khẳng định.
const NOI_DUNG_DAU_RA_THUONG_HIEU: {
  id: string;
  thi_truong: "us" | "vn";
  dinh_dang: string;
  doi_tuong: string;
  dich_den: string;
  ngon_ngu: string;
  trang_thai: "nhap" | "cho_duyet" | "da_duyet";
  nguoi_duyet?: string;
  noi_dung: string;
}[] = [
  {
    id: "seed-bth-th-us-bai-viet",
    thi_truong: "us",
    dinh_dang: "bai-viet",
    doi_tuong: "Runner thi đấu (fixture)",
    dich_den: "website-us",
    ngon_ngu: "en",
    trang_thai: "da_duyet",
    nguoi_duyet: "rev-us-maya",
    noi_dung: JSON.stringify({
      tieu_de: "Velocity Run 2: energy-return cushioning for race day",
      noi_dung: [
        "Velocity Run 2 carries your next run.",
        "",
        "**United States:** Giá 189 USD — Còn hàng.",
        "",
        "The X-Return foam midsole returns about 80% of energy on each stride (lab measured). [CL:cl-de-dem]",
        "Weight: 210 g (size 42). [CL:cl-trong-luong]",
        "One-layer breathable knit upper with reflective laces.",
        "",
        "[CÂU HỎI] Claim 'thiết kế khí động học giảm lực cản 12%' chưa có bằng chứng nguồn (cl-khi-dong) — cần đội sản phẩm xác nhận.",
        "",
        "Free gait analysis at partner labs through October.",
        "",
        "Positioning: Giày chạy hằng ngày cho runner từ phong trào đến thi đấu.",
        "",
        "Shop the US store: https://velocity-run.example.com/us/run-2",
      ].join("\n"),
    }),
  },
  {
    id: "seed-bth-th-vn-caption",
    thi_truong: "vn",
    dinh_dang: "caption",
    doi_tuong: "Runner phong trào (fixture)",
    dich_den: "facebook-vn",
    ngon_ngu: "vi",
    trang_thai: "cho_duyet",
    noi_dung: JSON.stringify({
      noi_dung: [
        "Velocity Run 2 — giày chạy hằng ngày cho ngày chạy tiếp theo của bạn.",
        "",
        "**Việt Nam:** Giá 4.590.000 VND — Còn hàng.",
        "",
        "Đế đệm X-Return trả lại khoảng 80% năng lượng mỗi sải chạy (đo lab). [CL:cl-de-dem]",
        "Trọng lượng 210 g (size 42). [CL:cl-trong-luong]",
        "",
        "[CÂU HỎI] Claim 'thiết kế khí động học giảm lực cản 12%' chưa có bằng chứng nguồn (cl-khi-dong).",
        "",
        "Đổi size miễn phí trong 30 ngày.",
        "",
        "Đặt mua tại cửa hàng: https://velocity-run.example.com/vn",
      ].join("\n"),
      hashtag: "#VelocityRun2 #ChayBo #GiayChay",
    }),
  },
];

// Ghi file fixture ảnh vào kho byte local + một dòng asset (đường
// service luuAsset là async; seed chạy đồng bộ nên ghi file đồng bộ —
// cùng bước validate/dedupe và cùng layout qua duongDanTepAsset, chỉ
// khác lớp ghi async). Thiếu file fixture → bỏ qua. tenFileAnh/ghiChu
// tùy chọn để các story dùng ảnh riêng.
function ghiAssetFixture(
  db: Database,
  dataDir: string,
  nguonId: string,
  tacGia: string,
  tenFileAnh: string = TB_FILE_ANH,
  ghiChu: string = "Ảnh sản phẩm do tiệm cung cấp (fixture).",
): string | null {
  const tep = join(import.meta.dir, "seed-assets", tenFileAnh);
  if (!existsSync(tep)) return null;
  const byte = new Uint8Array(readFileSync(tep));
  const tenFile = sachTenFile(tenFileAnh);
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
    ghiChu,
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

// Đầu ra demo bản phát hành 4.0 (#9) — nội dung viết theo contract của
// bộ sinh: claim kèm marker [F:<fact_id>], giới hạn kèm [GH:<id>], fact
// chưa xác nhận chỉ xuất hiện dạng [CÂU HỎI]. Ba trạng thái rải đủ vòng
// đời: dev đã duyệt + đã xuất (trang /p/<id> phục vụ), khách hàng chờ
// duyệt, sales đã duyệt.
const NOI_DUNG_DAU_RA_PHAT_HANH: {
  id: string;
  dinh_dang: string;
  doi_tuong: string;
  dich_den: string;
  trang_thai: "nhap" | "cho_duyet" | "da_duyet" | "tu_choi";
  xuat_ban: boolean;
  noi_dung: string;
}[] = [
  {
    id: "seed-bth-ph-dev",
    dinh_dang: "huong-dan-tich-hop",
    doi_tuong: "Lập trình viên tích hợp (fixture)",
    dich_den: "",
    trang_thai: "da_duyet",
    xuat_ban: true,
    noi_dung: JSON.stringify({
      tieu_de: "Hướng dẫn tích hợp MaiSuite 4.0",
      gioi_thieu:
        "## Giới thiệu\n\nMaiSuite 4.0 (phát hành 2026-11-01) thêm passkeys, audit log và SSO nhiều IdP.\n\nTài liệu này liệt kê các bước tích hợp cho developer.\n\nNguồn: [src1]",
      yeu_cau_truoc: [
        "Tài khoản có OAuth 2.0 client credentials — token lấy từ POST /oauth/token [src2]",
        "Tenant đã nâng gói phù hợp cho tính năng bị giới hạn (xem mục Giới hạn).",
      ],
      cac_buoc: [
        "Bật passkeys cho tài khoản: chạy luồng đăng ký WebAuthn trong console quản trị — 4.0 hỗ trợ đăng nhập bằng passkeys thay mật khẩu cho tất cả tài khoản [F:fact-passkeys]",
        "Đọc audit log qua API: sự kiện đăng nhập và đổi quyền được ghi; dữ liệu giữ 365 ngày [F:fact-audit-log]",
        "Cấu hình SSO SAML: đăng ký nhiều IdP đồng thời và bật JIT provisioning [F:fact-sso]",
        "Đăng ký webhook: POST /api/webhooks; payload JSON ký HMAC-SHA256 [F:fact-webhook]",
        "[CÂU HỎI: 'Hiệu năng' chưa có bằng chứng nguồn — cần xác nhận trước khi công bố.]",
      ],
      gioi_han: [
        "SSO SAML: chỉ có ở gói Enterprise [GH:gh-sso-goi]",
        "audit log: gói Starter chỉ giữ 90 ngày — gói Enterprise giữ 365 ngày [GH:gh-audit-log]",
        "passkeys: chưa mở cho tenant region EU cũ — lộ trình nâng hạ tầng trước 2027-Q1 [GH:gh-passkeys-vung]",
      ],
      lien_ket: "https://docs.maisuite.example.com/v4",
    }),
  },
  {
    id: "seed-bth-ph-khach",
    dinh_dang: "thay-doi-khach-hang",
    doi_tuong: "Khách hàng doanh nghiệp (fixture)",
    dich_den: "",
    trang_thai: "cho_duyet",
    xuat_ban: false,
    noi_dung: JSON.stringify({
      tieu_de: "MaiSuite 4.0 — những thay đổi cho khách hàng",
      gioi_thieu:
        "## Tổng quan\n\nMaiSuite 4.0 phát hành 2026-11-01.\n\nBản này đưa xác thực không mật khẩu và kiểm soát truy cập lên chuẩn doanh nghiệp.\n\nNguồn: [src1]",
      cac_thay_doi: [
        "Đăng nhập bằng passkeys thay mật khẩu cho tất cả tài khoản [F:fact-passkeys]",
        "Audit log ghi toàn bộ sự kiện đăng nhập và đổi quyền; giữ 365 ngày [F:fact-audit-log]",
        "SSO SAML đăng ký nhiều IdP đồng thời và JIT provisioning [F:fact-sso]",
        "[CÂU HỎI: 'Hiệu năng' chưa có bằng chứng nguồn — cần xác nhận trước khi công bố.]",
      ],
      gioi_han: [
        "SSO SAML: chỉ có ở gói Enterprise [GH:gh-sso-goi]",
        "audit log: gói Starter chỉ giữ 90 ngày [GH:gh-audit-log]",
        "passkeys: chưa mở cho tenant region EU cũ [GH:gh-passkeys-vung]",
      ],
      hanh_dong: "Nâng cấp lên 4.0 — https://app.maisuite.example.com/nang-cap",
      lien_ket: "https://app.maisuite.example.com/nang-cap",
    }),
  },
  {
    id: "seed-bth-ph-sales",
    dinh_dang: "brief-ban-hang",
    doi_tuong: "Đội bán hàng nội bộ (fixture)",
    dich_den: "",
    trang_thai: "da_duyet",
    xuat_ban: false,
    noi_dung: JSON.stringify({
      tieu_de: "Brief sales — MaiSuite 4.0",
      thong_diep_chinh:
        "4.0 đưa xác thực không mật khẩu và kiểm soát truy cập lên chuẩn doanh nghiệp.",
      diem_ban: [
        "Passkeys thay mật khẩu cho tất cả tài khoản — giảm rủi ro lộ credential [F:fact-passkeys]",
        "Audit log 365 ngày cho yêu cầu kiểm toán của doanh nghiệp [F:fact-audit-log]",
        "SSO nhiều IdP + JIT provisioning cho org phức tạp [F:fact-sso]",
      ],
      doi_pho: [
        "'Tôi đang dùng gói Starter' → SSO SAML chỉ ở Enterprise; audit log Starter giữ 90 ngày [GH:gh-sso-goi]",
        "'Tenant EU của tôi chưa có passkeys' → đúng, region EU cũ mở sau 2027-Q1 [GH:gh-passkeys-vung]",
        "[CÂU HỎI: 'Hiệu năng' chưa có bằng chứng nguồn — không claim benchmark khi nói chuyện khách.]",
      ],
      gioi_han: [
        "SSO SAML: chỉ có ở gói Enterprise [GH:gh-sso-goi]",
        "audit log: gói Starter chỉ giữ 90 ngày [GH:gh-audit-log]",
        "passkeys: chưa mở cho tenant region EU cũ [GH:gh-passkeys-vung]",
      ],
      tiep_theo: "Gửi khách link nâng cấp — https://app.maisuite.example.com/nang-cap",
    }),
  },
];

// --- Nội dung story #10: chiến dịch gây quỹ Giọt Nước Chung ---
// Dữ liệu hiện trường hư cấu. Marker [TD:id]/[TQ:id] pin fact vào
// con trỏ bằng chứng của campaign; mục trang_thai 'uoc_tinh' đi kèm
// tiền tố 'Ước tính:'; mục chưa có nguồn chỉ xuất hiện dạng [CÂU HỎI].

const GQ_FILE_ANH = "gieng-nuoc-hien-truong.webp";
const GQ_CTA = "Quyên góp cho Làng Khe Tre: https://quyengop.giotnuocchung.example.com/lang-khe-tre";
const GQ_LIEN_KET = "https://quyengop.giotnuocchung.example.com/lang-khe-tre";
const GQ_MUC_TIEU_TIEN =
  "Mục tiêu gây quỹ (chưa đạt): 1.200.000.000 VND cho công trình nước sạch Làng Khe Tre — khoảng 600 người đang chờ.";

const NOI_DUNG_DAU_RA_GAY_QUY: {
  id: string;
  dinh_dang: string;
  doi_tuong: string;
  dich_den: string;
  ngon_ngu: string;
  trang_thai: "nhap" | "cho_duyet" | "da_duyet" | "tu_choi";
  xuat_ban: boolean;
  dinh_asset?: boolean;
  noi_dung: string;
}[] = [
  {
    // Báo cáo tác động cho nhà tài trợ — đã duyệt + đã xuất.
    id: "seed-bth-gq-bao-cao",
    dinh_dang: "bao-cao-tac-dong",
    doi_tuong: "Nhà tài trợ hiện hữu (fixture)",
    dich_den: "email",
    ngon_ngu: "vi",
    trang_thai: "da_duyet",
    xuat_ban: true,
    noi_dung: JSON.stringify({
      tieu_de: "Báo cáo tác động — chương trình nước sạch",
      tom_tat:
        "Ba công trình đã hoàn thành cho 2.570 người. Chiến dịch tiếp theo: Làng Khe Tre.",
      tac_dong_da_dat: [
        "Giếng khoan Làng Bản Rọm — 1.240 người: Công trình hoàn thành 2026-03; 1.240 người ở 312 hộ dùng nước sạch hằng ngày. [TD:td-gieng-rom]",
        "Hệ thống lọc Làng Suối Lớn — 860 người: 860 người được cấp nước sạch từ 2026-05. [TD:td-loc-suoi]",
        "Điểm lấy nước Làng Đồng Kẻ — 470 người: 3 điểm cộng đồng phục vụ 470 người. [TD:td-diem-dong]",
      ],
      tac_dong_uoc_tinh: [
        "Ước tính: Người hưởng lợi Làng Khe Tre — 600 người: Ước tính 600 người sẽ có nước sạch khi công trình hoàn thành. [TD:td-nguoi-khe-tre]",
        "[CÂU HỎI: tác động 'Tỉ lệ học sinh đi học đều hơn sau khi có nước' chưa có bằng chứng nguồn — cần xác nhận trước khi công bố.]",
      ],
      muc_tieu: GQ_MUC_TIEU_TIEN,
      noi_dung: `Kính gửi nhà tài trợ,

Ba công trình nước sạch đã hoàn thành trong năm nay. Tổng cộng 2.570 người ở 3 làng đã có nước sạch; chi phí trung bình một công trình khoảng 380 triệu đồng.

**Đã đạt được:**
- Giếng khoan Làng Bản Rọm — 1.240 người ở 312 hộ dùng nước sạch hằng ngày. [TD:td-gieng-rom]
- Hệ thống lọc Làng Suối Lớn — 860 người được cấp nước sạch từ 2026-05. [TD:td-loc-suoi]
- Điểm lấy nước Làng Đồng Kẻ — 3 điểm cộng đồng phục vụ 470 người. [TD:td-diem-dong]

**Ước tính (chưa đạt):**
- Người hưởng lợi Làng Khe Tre — ước tính 600 người sẽ có nước sạch khi công trình hoàn thành. [TD:td-nguoi-khe-tre]
- [CÂU HỎI: 'Tỉ lệ học sinh đi học đều hơn sau khi có nước' chưa có bằng chứng nguồn.]

**Mục tiêu gây quỹ (chưa đạt):** ${GQ_MUC_TIEU_TIEN}

${GQ_CTA}`,
      trich_dan: [
        '"Trước kia cả nhà tôi phải đi 2 tiếng mỗi ngày để lấy nước. Bây giờ cháu tôi có thời gian học bài buổi tối." — Bà Hòa (giảng viên hưu trí, Làng Bản Rọm) [TQ:tq-ba-hoa]',
        '"Tôi đã chứng kiến giếng đầu tiên có nước. Ngày đó cả làng đứng xem tới tận tối." — Anh Tuấn (trưởng nhóm tình nguyện viên) [TQ:tq-anh-tuan]',
      ],
      cta: GQ_CTA,
      lien_ket: GQ_LIEN_KET,
    }),
  },
  {
    // Câu chuyện nhân văn công khai — chờ duyệt; kèm ảnh hiện trường
    // đã có ghi chú quyền để kiểm hiển thị khi review.
    id: "seed-bth-gq-cau-chuyen",
    dinh_dang: "cau-chuyen-nhan-van",
    doi_tuong: "Công chúng quan tâm (fixture)",
    dich_den: "website",
    ngon_ngu: "vi",
    trang_thai: "cho_duyet",
    xuat_ban: false,
    dinh_asset: true,
    noi_dung: JSON.stringify({
      tieu_de: "Ngày giếng đầu tiên có nước",
      noi_dung: `"Tôi đã chứng kiến giếng đầu tiên có nước. Ngày đó cả làng đứng xem tới tận tối." — Anh Tuấn, trưởng nhóm tình nguyện viên, nhớ lại ngày giếng khoan Làng Bản Rọm hoàn thành.

Trước giếng, Bà Hòa — giảng viên hưu trí ở làng — tả ngày ngày vất vả: "Trước kia cả nhà tôi phải đi 2 tiếng mỗi ngày để lấy nước. Bây giờ cháu tôi có thời gian học bài buổi tối."

Giếng khoan Làng Bản Rọm hoàn thành 2026-03: 1.240 người ở 312 hộ dùng nước sạch hằng ngày. [TD:td-gieng-rom] Sau đó là hệ thống lọc Làng Suối Lớn cho 860 người [TD:td-loc-suoi] và 3 điểm lấy nước Làng Đồng Kẻ cho 470 người. [TD:td-diem-dong]

Làng tiếp theo là Khe Tre — ước tính 600 người đang chờ nguồn nước sạch gần nhà. [TD:td-nguoi-khe-tre] ${GQ_MUC_TIEU_TIEN}

[CÂU HỎI: trích dẫn của người dân Làng Khe Tre chưa đối chứng tư liệu — cần xác nhận trước khi công bố.]

${GQ_CTA}`,
      trich_dan: [
        '"Trước kia cả nhà tôi phải đi 2 tiếng mỗi ngày để lấy nước. Bây giờ cháu tôi có thời gian học bài buổi tối." — Bà Hòa (giảng viên hưu trí, Làng Bản Rọm) [TQ:tq-ba-hoa]',
        '"Tôi đã chứng kiến giếng đầu tiên có nước. Ngày đó cả làng đứng xem tới tận tối." — Anh Tuấn (trưởng nhóm tình nguyện viên) [TQ:tq-anh-tuan]',
      ],
      con_thieu: [
        "[CÂU HỎI: tác động 'Tỉ lệ học sinh đi học đều hơn sau khi có nước' chưa có bằng chứng nguồn — cần xác nhận.]",
        "[CÂU HỎI: trích dẫn 'Người dân Làng Khe Tre' chưa đối chứng tư liệu — cần xác nhận.]",
      ],
      cta: GQ_CTA,
      lien_ket: GQ_LIEN_KET,
    }),
  },
  {
    // Email nhà tài trợ lớn — chi tiết hơn câu chuyện công khai (dự
    // toán, chi phí trung bình) nhưng giữ nguyên fact tác động.
    id: "seed-bth-gq-email-ntt",
    dinh_dang: "email-tai-tro",
    doi_tuong: "Nhà tài trợ lớn (fixture)",
    dich_den: "email",
    ngon_ngu: "vi",
    trang_thai: "cho_duyet",
    xuat_ban: false,
    noi_dung: JSON.stringify({
      tieu_de: "Làng Khe Tre — công trình nước sạch tiếp theo",
      tom_tat:
        "Ba công trình đã xong cho 2.570 người; công trình thứ tư cần 1.200.000.000 VND.",
      phan_doan: "Nhà tài trợ chiến lược",
      tac_dong_da_dat: [
        "Giếng khoan Làng Bản Rọm — 1.240 người ở 312 hộ. [TD:td-gieng-rom]",
        "Hệ thống lọc Làng Suối Lớn — 860 người. [TD:td-loc-suoi]",
        "Điểm lấy nước Làng Đồng Kẻ — 470 người. [TD:td-diem-dong]",
      ],
      tac_dong_uoc_tinh: [
        "Ước tính: Người hưởng lợi Làng Khe Tre — 600 người. [TD:td-nguoi-khe-tre]",
        "[CÂU HỎI: 'Tỉ lệ học sinh đi học đều hơn sau khi có nước' chưa có bằng chứng nguồn.]",
      ],
      muc_tieu: GQ_MUC_TIEU_TIEN,
      noi_dung: `Kính gửi quý nhà tài trợ,

Chương trình nước sạch của Giọt Nước Chung đã hoàn thành 3 công trình: 2.570 người ở Bản Rọm, Suối Lớn và Đồng Kẻ đã có nước sạch. Chi phí trung bình một công trình khoảng 380 triệu đồng.

Khảo sát 2026-08 cho thấy Làng Khe Tre có khoảng 600 người chưa có nguồn nước sạch gần nhà. Dự toán công trình giếng khoan và bể lọc khoảng 1.200.000.000 VND — đây là mục tiêu gây quỹ của chiến dịch, chưa phải kết quả đạt được.

Tác động đã đạt (có bằng chứng hiện trường):
- Làng Bản Rọm: 1.240 người ở 312 hộ. [TD:td-gieng-rom]
- Làng Suối Lớn: 860 người. [TD:td-loc-suoi]
- Làng Đồng Kẻ: 470 người. [TD:td-diem-dong]

[CÂU HỎI: tác động 'Tỉ lệ học sinh đi học đều hơn sau khi có nước' chưa có bằng chứng nguồn.]

${GQ_CTA}`,
      cta: GQ_CTA,
      lien_ket: GQ_LIEN_KET,
    }),
  },
  {
    // Trang campaign trên website — đã duyệt.
    id: "seed-bth-gq-trang-web",
    dinh_dang: "trang-campaign",
    doi_tuong: "Công chúng quan tâm (fixture)",
    dich_den: "website",
    ngon_ngu: "vi",
    trang_thai: "da_duyet",
    xuat_ban: true,
    noi_dung: JSON.stringify({
      tieu_de: "Nước sạch cho Làng Khe Tre",
      tac_dong_da_dat: [
        "Giếng khoan Làng Bản Rọm — 1.240 người. [TD:td-gieng-rom]",
        "Hệ thống lọc Làng Suối Lớn — 860 người. [TD:td-loc-suoi]",
        "Điểm lấy nước Làng Đồng Kẻ — 470 người. [TD:td-diem-dong]",
      ],
      tac_dong_uoc_tinh: [
        "Ước tính: Người hưởng lợi Làng Khe Tre — 600 người. [TD:td-nguoi-khe-tre]",
        "[CÂU HỎI: 'Tỉ lệ học sinh đi học đều hơn sau khi có nước' chưa có bằng chứng nguồn.]",
      ],
      muc_tieu: GQ_MUC_TIEU_TIEN,
      noi_dung: `Ba ngôi làng đã có nước sạch. Làng Khe Tre là làng tiếp theo — chỉ còn thiếu nguồn lực.

**Đã đạt được:**
- Giếng khoan Làng Bản Rọm — 1.240 người ở 312 hộ. [TD:td-gieng-rom]
- Hệ thống lọc Làng Suối Lớn — 860 người. [TD:td-loc-suoi]
- Điểm lấy nước Làng Đồng Kẻ — 470 người. [TD:td-diem-dong]

**Ước tính (chưa đạt):**
- Người hưởng lợi Làng Khe Tre — ước tính 600 người. [TD:td-nguoi-khe-tre]

${GQ_MUC_TIEU_TIEN}

${GQ_CTA}`,
      trich_dan: [
        '"Trước kia cả nhà tôi phải đi 2 tiếng mỗi ngày để lấy nước. Bây giờ cháu tôi có thời gian học bài buổi tối." — Bà Hòa (giảng viên hưu trí, Làng Bản Rọm) [TQ:tq-ba-hoa]',
      ],
      cta: GQ_CTA,
      lien_ket: GQ_LIEN_KET,
    }),
  },
  {
    // Caption ảnh Instagram — còn nháp; kèm ảnh hiện trường.
    id: "seed-bth-gq-ig",
    dinh_dang: "caption",
    doi_tuong: "",
    dich_den: "instagram",
    ngon_ngu: "vi",
    trang_thai: "nhap",
    xuat_ban: false,
    dinh_asset: true,
    noi_dung: JSON.stringify({
      noi_dung: `Ba ngôi làng đã có nước sạch — Làng Khe Tre là làng tiếp theo.

Giếng khoan Bản Rọm: 1.240 người dùng nước sạch hằng ngày. Hệ thống lọc Suối Lớn: 860 người. Điểm lấy nước Đồng Kẻ: 470 người.

Mục tiêu gây quỹ (chưa đạt): 1.200.000.000 VND — khoảng 600 người đang chờ.

${GQ_CTA}`,
      hashtag: "#nuocsach #giotnuocchung #langkhetre",
    }),
  },
  {
    // Cập nhật tình nguyện viên — đã duyệt.
    id: "seed-bth-gq-tnv",
    dinh_dang: "cap-nhat-tinh-nguyen",
    doi_tuong: "Tình nguyện viên (fixture)",
    dich_den: "",
    ngon_ngu: "vi",
    trang_thai: "da_duyet",
    xuat_ban: false,
    noi_dung: JSON.stringify({
      tieu_de: "Cập nhật chiến dịch Làng Khe Tre",
      noi_dung: `Cảm ơn các bạn đã đồng hành. Ba công trình nước sạch đã hoàn thành cho 2.570 người ở 3 làng.

Chiến dịch tiếp theo: công trình nước sạch Làng Khe Tre — ước tính 600 người đang chờ. [TD:td-nguoi-khe-tre] Mục tiêu gây quỹ: 1.200.000.000 VND.

"Tôi đã chứng kiến giếng đầu tiên có nước. Ngày đó cả làng đứng xem tới tận tối." — Anh Tuấn, trưởng nhóm tình nguyện viên. [TQ:tq-anh-tuan]`,
      cac_buoc: [
        "Chia sẻ link chiến dịch: https://quyengop.giotnuocchung.example.com/lang-khe-tre",
        "Đăng ký chuyến hiện trường Làng Khe Tre đợt tới.",
        "Khi chia sẻ: chỉ dùng số liệu và trích dẫn trong tài liệu đã phát hành.",
      ],
      cta: GQ_CTA,
      lien_ket: GQ_LIEN_KET,
    }),
  },
  {
    // Bản tiếng Anh của câu chuyện công khai — giữ nguyên số liệu,
    // tiền tệ và CTA; trích dẫn giữ nguyên văn tiếng Việt.
    id: "seed-bth-gq-en",
    dinh_dang: "cau-chuyen-nhan-van",
    doi_tuong: "Công chúng quan tâm (fixture)",
    dich_den: "website",
    ngon_ngu: "en",
    trang_thai: "da_duyet",
    xuat_ban: false,
    noi_dung: JSON.stringify({
      tieu_de: "The day the first well had water",
      noi_dung: `Three villages now have clean water. Khe Tre is next — only funding is missing.

The Bản Rọm borehole was completed in 2026-03: 1,240 people in 312 households use clean water every day. [TD:td-gieng-rom] The Suối Lớn filtration system serves 860 people [TD:td-loc-suoi], and 3 community water points in Đồng Kẻ serve 470 people. [TD:td-diem-dong]

Estimated (not yet achieved): about 600 people in Khe Tre are waiting for a clean water source near home. [TD:td-nguoi-khe-tre]

Fundraising goal (not yet achieved): 1,200,000,000 VND for the Khe Tre water project.

[CÂU HỎI: impact item 'Tỉ lệ học sinh đi học đều hơn sau khi có nước' has no source evidence — verify before publishing.]

${GQ_CTA}`,
      trich_dan: [
        '"Trước kia cả nhà tôi phải đi 2 tiếng mỗi ngày để lấy nước. Bây giờ cháu tôi có thời gian học bài buổi tối." — Bà Hòa (giảng viên hưu trí, Làng Bản Rọm) [TQ:tq-ba-hoa]',
      ],
      con_thieu: [
        "[CÂU HỎI: quote from 'Người dân Làng Khe Tre' is not verified against source material — confirm before publishing.]",
      ],
      cta: GQ_CTA,
      lien_ket: GQ_LIEN_KET,
    }),
  },
];

// Nội dung đầu ra của chiến dịch công quyền — viết tay đúng canonical
// JSON, giữ marker [YC]/[NL]/[FV] pin provenance, giữ nguyên văn ngày
// hiệu lực '2027-01-01' và phạm vi quyền hạn; mục chưa xác nhận và
// điều khoản mơ hồ chỉ để [CÂU HỎI] — không bịa luật.
const CQ_PHAM_VI =
  "Địa bàn thành phố An Khang — mọi hộ gia đình, cơ sở kinh doanh, trường học và đơn vị thi công trên địa bàn.";
const CQ_CAU_HOI_LICH_THU =
  "[CÂU HỎI: yêu cầu 'Lịch thu gom từng tuyến phố theo công bố của phường' chưa có bằng chứng nguồn — cần thẩm quyền xác nhận.]";
const CQ_CAU_HOI_XU_PHAT =
  "[CÂU HỎI: điều khoản nguồn mơ hồ — 'Mức xử phạt áp dụng phù hợp theo quy định hiện hành và tùy trường hợp cụ thể do Sở Ban xem xét.' cần thẩm quyền diễn giải, đầu ra không được bịa luật.]";

const NOI_DUNG_DAU_RA_CONG_QUYEN: {
  id: string;
  dinh_dang: string;
  doi_tuong: string;
  dich_den: string;
  // Đích ghi trên record xuất bản — khác dich_den của bản thể hiện:
  // '' = chỉ đăng trang nội bộ /p (nhóm 'đã xuất'); bỏ qua = dùng
  // dich_den của bản (nhóm 'đã đăng' — copy tay ở kênh ngoài).
  dich_den_xuat?: string;
  ngon_ngu: string;
  trang_thai: "nhap" | "cho_duyet" | "da_duyet" | "tu_choi";
  xuat_ban: boolean;
  noi_dung: string;
}[] = [
  {
    // FAQ hộ gia đình — đã duyệt bởi reviewer + đã xuất trên trang /p/
    // (xuất bản không dich_den → chỉ thuộc nhóm 'đã xuất').
    id: "seed-bth-cq-faq",
    dinh_dang: "faq-cong-dan",
    doi_tuong: "Hộ gia đình (fixture)",
    dich_den: "cong-thong-tin",
    dich_den_xuat: "",
    ngon_ngu: "vi",
    trang_thai: "da_duyet",
    xuat_ban: true,
    noi_dung: JSON.stringify({
      tieu_de: "Hỏi đáp: phân loại rác tại hộ gia đình",
      gioi_thieu: `Luật tái chế thành phố An Khang (QĐ-2027-15/UBND) áp dụng cho mọi hộ gia đình trên địa bàn.\n\n${CQ_CAU_HOI_XU_PHAT}`,
      hoi_dap: [
        "Hỏi: Tôi phải phân loại rác thế nào? Đáp: Phân thành 3 nhóm — tái chế, hữu cơ và còn lại — trước khi đổ tại điểm thu gom. [YC:yc-phan-loai]",
        "Hỏi: Tôi là hộ khẩu tạm trú thì sao? Đáp: Hộ có hộ khẩu tạm trú được gia hạn thực hiện thêm 6 tháng kể từ ngày hiệu lực. [NL:nl-tam-tru]",
        "Hỏi: Đổ rác ở đâu? Đáp: Điểm thu gom tập trung tại công viên trung tâm và chợ đầu mối, mở 6h-18h hằng ngày. [FV:fv-diem-thu]",
      ],
      yeu_cau: [
        "Hộ gia đình phải phân loại chất thải sinh hoạt thành 3 nhóm: tái chế, hữu cơ và còn lại, trước khi đổ tại điểm thu gom. [BẮT BUỘC] (ho_gia_dinh) [YC:yc-phan-loai]",
        CQ_CAU_HOI_LICH_THU,
      ],
      ngoai_le: [
        "Hộ gia đình có hộ khẩu tạm trú được gia hạn thực hiện thêm 6 tháng kể từ ngày hiệu lực. (ngoại lệ của yêu cầu yc-phan-loai) [NL:nl-tam-tru]",
      ],
      pham_vi: CQ_PHAM_VI,
      ngay_hieu_luc: "2027-01-01",
      hoi_them: "Cổng thông tin của thành phố: https://ankhang.example.com/tai-che",
    }),
  },
  {
    // Checklist doanh nghiệp — đã duyệt + đã xuất và đã đăng kênh ngoài
    // (dich_den trên record xuất bản) → sau đổi ngày hiệu lực cần sửa
    // copy tay ở đích ngoài, không khẳng định cập nhật từ xa.
    id: "seed-bth-cq-checklist",
    dinh_dang: "checklist-doanh-nghiep",
    doi_tuong: "Cơ sở kinh doanh (fixture)",
    dich_den: "cong-thong-tin",
    ngon_ngu: "vi",
    trang_thai: "da_duyet",
    xuat_ban: true,
    noi_dung: JSON.stringify({
      tieu_de: "Checklist tuân thủ cho cơ sở kinh doanh",
      gioi_thieu: `Quyết định phân loại chất thải sinh hoạt có hiệu lực từ 2027-01-01.\n\n${CQ_CAU_HOI_XU_PHAT}`,
      cac_buoc: [
        "Đăng ký điểm thu gom với Sở Ban trước ngày hiệu lực 30 ngày. [BẮT BUỘC] (doanh_nghiep) [YC:yc-dang-ky-diem]",
        "Nộp báo cáo khối lượng chất thải hằng quý. [BẮT BUỘC] (doanh_nghiep) [YC:yc-bao-cao]",
      ],
      yeu_cau: [
        "Cơ sở kinh doanh phải đăng ký điểm thu gom với Sở Ban trước ngày hiệu lực 30 ngày. [BẮT BUỘC] (doanh_nghiep) [YC:yc-dang-ky-diem]",
        "Cơ sở kinh doanh phải nộp báo cáo khối lượng chất thải hằng quý. [BẮT BUỘC] (doanh_nghiep) [YC:yc-bao-cao]",
        "Hộ gia đình phải phân loại chất thải sinh hoạt thành 3 nhóm: tái chế, hữu cơ và còn lại, trước khi đổ tại điểm thu gom. [BẮT BUỘC] (ho_gia_dinh) [YC:yc-phan-loai]",
        "Trường học trên địa bàn thuộc phạm vi áp dụng; nội dung giải thích giúp học sinh hiểu cách phân loại. [GIẢI THÍCH] (truong_hoc) [YC:yc-truong-hoc]",
        CQ_CAU_HOI_LICH_THU,
      ],
      ngoai_le: [
        "Hộ gia đình có hộ khẩu tạm trú được gia hạn thực hiện thêm 6 tháng kể từ ngày hiệu lực. (ngoại lệ của yêu cầu yc-phan-loai) [NL:nl-tam-tru]",
        "Cơ sở kinh doanh dưới 5 lao động được miễn nộp báo cáo hằng quý nhưng vẫn phải đăng ký điểm thu gom. (ngoại lệ của yêu cầu yc-bao-cao) [NL:nl-it-lao-dong]",
      ],
      pham_vi: CQ_PHAM_VI,
      ngay_hieu_luc: "2027-01-01",
      lien_ket: "https://ankhang.example.com/tai-che",
    }),
  },
  {
    // Bài giải thích trường học — chờ duyệt; kèm job sinh đã lên lịch
    // (enqueue ở block seed trên) → sau đổi ngày hiệu lực job bị chặn
    // và đầu ra không được duyệt cho tới khi sinh lại.
    id: "seed-bth-cq-truong-hoc",
    dinh_dang: "giai-thich-truong-hoc",
    doi_tuong: "Trường học (fixture)",
    dich_den: "website",
    ngon_ngu: "vi",
    trang_thai: "cho_duyet",
    xuat_ban: false,
    noi_dung: JSON.stringify({
      tieu_de: "Vì sao thành phố bắt đầu phân loại rác",
      noi_dung: `Chính sách Luật tái chế thành phố An Khang (phiên bản QĐ-2027-15/UBND).
Có hiệu lực từ 2027-01-01.
Áp dụng: ${CQ_PHAM_VI}.

**Bắt buộc:**
- Hộ gia đình phải phân loại chất thải sinh hoạt thành 3 nhóm: tái chế, hữu cơ và còn lại, trước khi đổ tại điểm thu gom. [BẮT BUỘC] (ho_gia_dinh) [YC:yc-phan-loai]
- Cơ sở kinh doanh phải đăng ký điểm thu gom với Sở Ban trước ngày hiệu lực 30 ngày. [BẮT BUỘC] (doanh_nghiep) [YC:yc-dang-ky-diem]
- Cơ sở kinh doanh phải nộp báo cáo khối lượng chất thải hằng quý. [BẮT BUỘC] (doanh_nghiep) [YC:yc-bao-cao]

**Ngoại lệ:**
- Hộ gia đình có hộ khẩu tạm trú được gia hạn thực hiện thêm 6 tháng kể từ ngày hiệu lực. (ngoại lệ của yêu cầu yc-phan-loai) [NL:nl-tam-tru]
- Cơ sở kinh doanh dưới 5 lao động được miễn nộp báo cáo hằng quý nhưng vẫn phải đăng ký điểm thu gom. (ngoại lệ của yêu cầu yc-bao-cao) [NL:nl-it-lao-dong]

**Giải thích:**
- Trường học trên địa bàn thuộc phạm vi áp dụng; nội dung giải thích giúp học sinh hiểu cách phân loại. [GIẢI THÍCH] (truong_hoc) [YC:yc-truong-hoc]
- ${CQ_CAU_HOI_LICH_THU}

**Thông tin vận hành:**
- Điểm thu gom tập trung: Điểm thu gom tập trung: công viên trung tâm và chợ đầu mối; mở 6h-18h hằng ngày; thùng phân loại phát miễn phí tại UBND phường. [FV:fv-diem-thu]
- Đường dây nóng: Đường dây nóng hỗ trợ: 1900-6868 (giờ hành chính). [FV:fv-hotline]

${CQ_CAU_HOI_XU_PHAT}`,
      yeu_cau: [
        "Hộ gia đình phải phân loại chất thải sinh hoạt thành 3 nhóm: tái chế, hữu cơ và còn lại, trước khi đổ tại điểm thu gom. [BẮT BUỘC] (ho_gia_dinh) [YC:yc-phan-loai]",
        "Cơ sở kinh doanh phải đăng ký điểm thu gom với Sở Ban trước ngày hiệu lực 30 ngày. [BẮT BUỘC] (doanh_nghiep) [YC:yc-dang-ky-diem]",
        "Cơ sở kinh doanh phải nộp báo cáo khối lượng chất thải hằng quý. [BẮT BUỘC] (doanh_nghiep) [YC:yc-bao-cao]",
        "Trường học trên địa bàn thuộc phạm vi áp dụng; nội dung giải thích giúp học sinh hiểu cách phân loại. [GIẢI THÍCH] (truong_hoc) [YC:yc-truong-hoc]",
        CQ_CAU_HOI_LICH_THU,
      ],
      ngoai_le: [
        "Hộ gia đình có hộ khẩu tạm trú được gia hạn thực hiện thêm 6 tháng kể từ ngày hiệu lực. (ngoại lệ của yêu cầu yc-phan-loai) [NL:nl-tam-tru]",
        "Cơ sở kinh doanh dưới 5 lao động được miễn nộp báo cáo hằng quý nhưng vẫn phải đăng ký điểm thu gom. (ngoại lệ của yêu cầu yc-bao-cao) [NL:nl-it-lao-dong]",
      ],
      goi_y_hoat_dong: [
        "Trường học trên địa bàn thuộc phạm vi áp dụng; nội dung giải thích giúp học sinh hiểu cách phân loại. [GIẢI THÍCH] (truong_hoc) [YC:yc-truong-hoc]",
        CQ_CAU_HOI_LICH_THU,
      ],
      pham_vi: CQ_PHAM_VI,
      ngay_hieu_luc: "2027-01-01",
    }),
  },
  {
    // Tóm tắt cho nhà thầu — còn nháp.
    id: "seed-bth-cq-nha-thau",
    dinh_dang: "tom-tat-nha-thau",
    doi_tuong: "Nhà thầu thu gom (fixture)",
    dich_den: "email",
    ngon_ngu: "vi",
    trang_thai: "nhap",
    xuat_ban: false,
    noi_dung: JSON.stringify({
      tieu_de: "Tóm tắt cho nhà thầu — luật tái chế An Khang",
      tom_tat: `Chính sách Luật tái chế thành phố An Khang có hiệu lực từ 2027-01-01, áp dụng: ${CQ_PHAM_VI}.`,
      nghia_vu: [
        "Hộ gia đình phải phân loại chất thải sinh hoạt thành 3 nhóm: tái chế, hữu cơ và còn lại, trước khi đổ tại điểm thu gom. [BẮT BUỘC] (ho_gia_dinh) [YC:yc-phan-loai]",
        "Cơ sở kinh doanh phải đăng ký điểm thu gom với Sở Ban trước ngày hiệu lực 30 ngày. [BẮT BUỘC] (doanh_nghiep) [YC:yc-dang-ky-diem]",
        "Cơ sở kinh doanh phải nộp báo cáo khối lượng chất thải hằng quý. [BẮT BUỘC] (doanh_nghiep) [YC:yc-bao-cao]",
      ],
      yeu_cau: [
        "Hộ gia đình phải phân loại chất thải sinh hoạt thành 3 nhóm: tái chế, hữu cơ và còn lại, trước khi đổ tại điểm thu gom. [BẮT BUỘC] (ho_gia_dinh) [YC:yc-phan-loai]",
        "Cơ sở kinh doanh phải đăng ký điểm thu gom với Sở Ban trước ngày hiệu lực 30 ngày. [BẮT BUỘC] (doanh_nghiep) [YC:yc-dang-ky-diem]",
        "Cơ sở kinh doanh phải nộp báo cáo khối lượng chất thải hằng quý. [BẮT BUỘC] (doanh_nghiep) [YC:yc-bao-cao]",
        "Trường học trên địa bàn thuộc phạm vi áp dụng; nội dung giải thích giúp học sinh hiểu cách phân loại. [GIẢI THÍCH] (truong_hoc) [YC:yc-truong-hoc]",
        CQ_CAU_HOI_LICH_THU,
      ],
      ngoai_le: [
        "Hộ gia đình có hộ khẩu tạm trú được gia hạn thực hiện thêm 6 tháng kể từ ngày hiệu lực. (ngoại lệ của yêu cầu yc-phan-loai) [NL:nl-tam-tru]",
        "Cơ sở kinh doanh dưới 5 lao động được miễn nộp báo cáo hằng quý nhưng vẫn phải đăng ký điểm thu gom. (ngoại lệ của yêu cầu yc-bao-cao) [NL:nl-it-lao-dong]",
      ],
      pham_vi: CQ_PHAM_VI,
      ngay_hieu_luc: "2027-01-01",
    }),
  },
  {
    // Bản dịch ngôn ngữ giản dị (en) cho người nhập cư — còn nháp;
    // giữ nguyên nghĩa vụ, ngoại lệ, phạm vi và ngày hiệu lực.
    id: "seed-bth-cq-ban-dich",
    dinh_dang: "ban-dich-gian-di",
    doi_tuong: "Người nhập cư mới (fixture)",
    dich_den: "cong-thong-tin",
    ngon_ngu: "en",
    trang_thai: "nhap",
    xuat_ban: false,
    noi_dung: JSON.stringify({
      tieu_de: "New recycling law in An Khang — simple English",
      noi_dung: `The policy Luật tái chế thành phố An Khang (version QĐ-2027-15/UBND).
It takes effect on 2027-01-01.
It applies to: ${CQ_PHAM_VI}.

**You must:**
- Households must sort household waste into 3 groups: recyclable, organic, and the rest, before dropping at collection points. [YC:yc-phan-loai]
- Businesses must register a collection point with the So Ban 30 days before the effective date. [YC:yc-dang-ky-diem]
- Businesses must submit a quarterly waste-quantity report. [YC:yc-bao-cao]

**Exceptions:**
- Households with temporary-residence registration get a 6-month extension from the effective date. [NL:nl-tam-tru]
- Businesses with under 5 workers are exempt from the quarterly report but must still register a collection point. [NL:nl-it-lao-dong]

**Operational info:**
- Collection points: central park and the wholesale market, open 6h-18h daily. [FV:fv-diem-thu]
- Support hotline: 1900-6868 (office hours). [FV:fv-hotline]

${CQ_CAU_HOI_XU_PHAT}`,
      yeu_cau: [
        "Hộ gia đình phải phân loại chất thải sinh hoạt thành 3 nhóm: tái chế, hữu cơ và còn lại, trước khi đổ tại điểm thu gom. [BẮT BUỘC] (ho_gia_dinh) [YC:yc-phan-loai]",
        CQ_CAU_HOI_LICH_THU,
      ],
      ngoai_le: [
        "Hộ gia đình có hộ khẩu tạm trú được gia hạn thực hiện thêm 6 tháng kể từ ngày hiệu lực. (ngoại lệ của yêu cầu yc-phan-loai) [NL:nl-tam-tru]",
        "Cơ sở kinh doanh dưới 5 lao động được miễn nộp báo cáo hằng quý nhưng vẫn phải đăng ký điểm thu gom. (ngoại lệ của yêu cầu yc-bao-cao) [NL:nl-it-lao-dong]",
      ],
      pham_vi: CQ_PHAM_VI,
      ngay_hieu_luc: "2027-01-01",
      ghi_chu: [CQ_CAU_HOI_XU_PHAT],
    }),
  },
];

if (import.meta.main) {
  const cauHinh = await taiCauHinh();
  const db = moDb(cauHinh.dataDir);
  chayMigration(db);
  const ketQua = seed(db, "demo", {
    dataDir: cauHinh.dataDir,
    urlGoc: cauHinh.kenh.url_goc ?? "",
  });
  log.info("seed.xong", { dataDir: cauHinh.dataDir, ...ketQua });
  db.close();
}
