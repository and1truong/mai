// Module định dạng nội dung (#19): registry định dạng có phiên bản —
// schema field có kiểu, hỗ trợ ngôn ngữ, validation, render xem trước
// và render export. Tách định dạng khỏi đích đến: một caption vẫn xuất
// được khi chưa có tài khoản kết nối; script video không phải video đã
// render. Định dạng mới đăng ký ở đây, không sửa model lõi.
//
// Canonical: revision.noi_dung là JSON object { <ten trường>: chuỗi | chuỗi[] }.
// Nội dung thường (không phải JSON object, vd output provider markdown)
// được map vào trường 'noi_dung' nếu định dạng khai báo, còn không thì
// giữ ở '_tho' và render kèm cảnh báo field bắt buộc thiếu.

// --- Kiểu schema ---

export type LoaiTruong = "van_ban" | "markdown" | "danh_sach";

export type DinhNghiaTruong = {
  ten: string; // key trong JSON nội dung
  nhan: string; // nhãn hiển thị khi render
  loai: LoaiTruong;
  bat_buoc?: boolean;
  do_dai_toi_da?: number; // ký tự (van_ban/markdown) hoặc ký tự mỗi mục (danh_sach)
  so_muc_toi_da?: number; // chỉ danh_sach
};

export type DinhNghiaDinhDang = {
  id: string;
  phien_ban: number; // tăng khi đổi schema/renderer — ban_the_hien.phien_ban_dinh_dang ghim bản đã dùng
  nhan: string;
  mo_ta: string;
  ngon_ngu: string[];
  truong: DinhNghiaTruong[];
  // Gợi ý đính kèm asset (vd ảnh sản phẩm cho caption Instagram) — UI hiển
  // thị ô yêu cầu/upload khi đầu ra chưa có asset; không bắt buộc, không bịa.
  goi_y_asset?: string;
};

// Một vấn đề validation của nội dung theo schema — trả về phản hồi sửa
// cụ thể cho người viết, không phải lỗi cứng chặn lưu.
export type LoiDinhDang = { truong: string; loi: string };

// Giá trị trường sau khi đọc nội dung canonical.
export type TruongGiaTri = Record<string, string | string[]>;

// --- Registry ---

const NGON_NGU = ["vi", "en"];

const DANG_BAI_VIET: DinhNghiaDinhDang = {
  id: "bai-viet",
  phien_ban: 1,
  nhan: "Bài viết",
  mo_ta: "Bài viết/blog đầy đủ: tiêu đề tùy chọn + nội dung Markdown.",
  ngon_ngu: NGON_NGU,
  truong: [
    { ten: "tieu_de", nhan: "Tiêu đề", loai: "van_ban", do_dai_toi_da: 200 },
    { ten: "noi_dung", nhan: "Nội dung", loai: "markdown", bat_buoc: true },
  ],
};

const DANG_NEWSLETTER: DinhNghiaDinhDang = {
  id: "newsletter",
  phien_ban: 1,
  nhan: "Newsletter",
  mo_ta: "Email newsletter: dòng chủ đề, đoạn xem trước và thân email.",
  ngon_ngu: NGON_NGU,
  truong: [
    { ten: "tieu_de", nhan: "Chủ đề", loai: "van_ban", bat_buoc: true, do_dai_toi_da: 150 },
    { ten: "tom_tat", nhan: "Xem trước", loai: "van_ban", do_dai_toi_da: 200 },
    { ten: "noi_dung", nhan: "Nội dung", loai: "markdown", bat_buoc: true },
  ],
};

const DANG_CAPTION: DinhNghiaDinhDang = {
  id: "caption",
  phien_ban: 1,
  nhan: "Caption mạng xã hội",
  mo_ta: "Một bài/caption social đơn lẻ + hashtag; xuất được không cần tài khoản.",
  ngon_ngu: NGON_NGU,
  truong: [
    { ten: "noi_dung", nhan: "Nội dung", loai: "markdown", bat_buoc: true, do_dai_toi_da: 2200 },
    { ten: "hashtag", nhan: "Hashtag", loai: "van_ban", do_dai_toi_da: 500 },
  ],
  // Caption social thường đi kèm ảnh (Instagram bắt buộc có ảnh) — gợi ý
  // đính kèm khi chưa có; MAI không bịa ảnh sẵn có.
  goi_y_asset: "ảnh đính kèm bài đăng",
};

const DANG_THREAD: DinhNghiaDinhDang = {
  id: "thread",
  phien_ban: 1,
  nhan: "Thread",
  mo_ta: "Chuỗi bài social có thứ tự — mỗi mục là một bài đăng.",
  ngon_ngu: NGON_NGU,
  truong: [
    { ten: "tieu_de", nhan: "Tiêu đề", loai: "van_ban", do_dai_toi_da: 200 },
    {
      ten: "cac_muc",
      nhan: "Các bài",
      loai: "danh_sach",
      bat_buoc: true,
      so_muc_toi_da: 25,
      do_dai_toi_da: 500,
    },
  ],
};

const TRUONG_SCRIPT: DinhNghiaTruong[] = [
  { ten: "hook", nhan: "Hook", loai: "van_ban", bat_buoc: true, do_dai_toi_da: 300 },
  { ten: "loi_thoai", nhan: "Lời thoại", loai: "markdown", bat_buoc: true },
  { ten: "canh", nhan: "Cảnh gợi ý", loai: "danh_sach", so_muc_toi_da: 30, do_dai_toi_da: 300 },
  { ten: "cta", nhan: "CTA", loai: "van_ban", do_dai_toi_da: 200 },
];

const DANG_SCRIPT_NGAN: DinhNghiaDinhDang = {
  id: "script-ngan",
  phien_ban: 1,
  nhan: "Script video ngắn",
  mo_ta: "Script video ngắn (reels/shorts): hook, lời thoại, cảnh gợi ý, CTA.",
  ngon_ngu: NGON_NGU,
  truong: TRUONG_SCRIPT.map((t) =>
    t.ten === "loi_thoai" ? { ...t, do_dai_toi_da: 1500 } : t,
  ),
};

const DANG_SCRIPT_DAI: DinhNghiaDinhDang = {
  id: "script-dai",
  phien_ban: 1,
  nhan: "Script video dài",
  mo_ta: "Script video dài: hook, lời thoại, cảnh gợi ý, CTA — lời thoại không giới hạn.",
  ngon_ngu: NGON_NGU,
  truong: TRUONG_SCRIPT,
};

const DANG_GOOGLE_BUSINESS: DinhNghiaDinhDang = {
  id: "google-business",
  phien_ban: 1,
  nhan: "Bài đăng Google Business",
  mo_ta: "Bài đăng hồ sơ Google Business: nội dung ngắn + CTA + link. Đăng tay, không tích hợp.",
  ngon_ngu: NGON_NGU,
  truong: [
    { ten: "noi_dung", nhan: "Nội dung", loai: "markdown", bat_buoc: true, do_dai_toi_da: 1500 },
    { ten: "cta", nhan: "CTA", loai: "van_ban", do_dai_toi_da: 100 },
    { ten: "lien_ket", nhan: "Link", loai: "van_ban", do_dai_toi_da: 500 },
  ],
  goi_y_asset: "ảnh đính kèm bài đăng",
};

const DANG_EMAIL_KHACH: DinhNghiaDinhDang = {
  id: "email-khach",
  phien_ban: 1,
  nhan: "Email khách hàng",
  mo_ta: "Nháp email gửi khách: chủ đề, xem trước, thân email, lịch gửi dự kiến kèm múi giờ. Gửi thật là bước đăng tay ngoài MAI.",
  ngon_ngu: NGON_NGU,
  truong: [
    { ten: "tieu_de", nhan: "Chủ đề", loai: "van_ban", bat_buoc: true, do_dai_toi_da: 150 },
    { ten: "tom_tat", nhan: "Xem trước", loai: "van_ban", do_dai_toi_da: 200 },
    { ten: "lich_gui", nhan: "Lịch gửi dự kiến", loai: "van_ban", do_dai_toi_da: 200 },
    { ten: "noi_dung", nhan: "Nội dung", loai: "markdown", bat_buoc: true },
  ],
};

const DANG_FAQ: DinhNghiaDinhDang = {
  id: "faq",
  phien_ban: 1,
  nhan: "FAQ",
  mo_ta: "Hỏi-đáp: mỗi mục là một câu hỏi + trả lời (Markdown).",
  ngon_ngu: NGON_NGU,
  truong: [
    { ten: "gioi_thieu", nhan: "Giới thiệu", loai: "markdown" },
    {
      ten: "hoi_dap",
      nhan: "Hỏi đáp",
      loai: "danh_sach",
      bat_buoc: true,
      so_muc_toi_da: 50,
      do_dai_toi_da: 2000,
    },
  ],
};

// --- Định dạng số báo (#8) ---
// Các định dạng cho luồng số tạp chí: bài học tài liệu nền, giải thích cho
// thiếu niên, hỏi-đáp độc giả, chuỗi social theo số, script thảo luận.
// Tên field giữ trung lập — định dạng dùng được ngoài ngữ cảnh tạp chí.

const DANG_HOC_TAI_LIEU: DinhNghiaDinhDang = {
  id: "hoc-tai-lieu",
  phien_ban: 1,
  nhan: "Học tài liệu nền",
  mo_ta: "Bài học theo đoạn tài liệu nền: tham chiếu đoạn, nội dung học, câu hỏi thảo luận, áp dụng.",
  ngon_ngu: NGON_NGU,
  truong: [
    { ten: "tieu_de", nhan: "Tiêu đề", loai: "van_ban", bat_buoc: true, do_dai_toi_da: 200 },
    {
      ten: "tham_chieu",
      nhan: "Tham chiếu",
      loai: "danh_sach",
      bat_buoc: true,
      so_muc_toi_da: 30,
      do_dai_toi_da: 300,
    },
    { ten: "noi_dung", nhan: "Nội dung", loai: "markdown", bat_buoc: true },
    {
      ten: "cau_hoi_thao_luan",
      nhan: "Câu hỏi thảo luận",
      loai: "danh_sach",
      so_muc_toi_da: 20,
      do_dai_toi_da: 500,
    },
    { ten: "ung_dung", nhan: "Áp dụng", loai: "markdown" },
  ],
};

// Giải thích cho thiếu niên (#8): nội dung viết lại theo từ vựng/ví dụ của
// đối tượng, còn diễn giải và bằng chứng đã duyệt là TRƯỜNG RIÊNG giữ
// nguyên — schema tách bạch để kiểm được "đổi từ vựng, giữ diễn giải".
const DANG_GIAI_THICH_THIEU_NIEN: DinhNghiaDinhDang = {
  id: "giai-thich-thieu-nien",
  phien_ban: 1,
  nhan: "Giải thích cho thiếu niên",
  mo_ta: "Bài giải thích đơn giản cho độc giả trẻ: viết lại từ vựng/ví dụ, giữ nguyên diễn giải và bằng chứng đã duyệt.",
  ngon_ngu: NGON_NGU,
  truong: [
    { ten: "tieu_de", nhan: "Tiêu đề", loai: "van_ban", bat_buoc: true, do_dai_toi_da: 200 },
    { ten: "noi_dung", nhan: "Nội dung", loai: "markdown", bat_buoc: true },
    {
      ten: "dien_giai",
      nhan: "Diễn giải đã duyệt",
      loai: "markdown",
      bat_buoc: true,
    },
    {
      ten: "bang_chung",
      nhan: "Bằng chứng đã duyệt",
      loai: "danh_sach",
      bat_buoc: true,
      so_muc_toi_da: 30,
      do_dai_toi_da: 500,
    },
    {
      ten: "vi_du",
      nhan: "Ví dụ",
      loai: "danh_sach",
      so_muc_toi_da: 20,
      do_dai_toi_da: 500,
    },
  ],
};

const DANG_HOI_DAP_DOC_GIA: DinhNghiaDinhDang = {
  id: "hoi-dap-doc-gia",
  phien_ban: 1,
  nhan: "Hỏi-đáp độc giả",
  mo_ta: "Chuyên mục hỏi-đáp với độc giả: giới thiệu nhẹ + các cặp hỏi/đáp.",
  ngon_ngu: NGON_NGU,
  truong: [
    { ten: "tieu_de", nhan: "Tiêu đề", loai: "van_ban", do_dai_toi_da: 200 },
    { ten: "gioi_thieu", nhan: "Giới thiệu", loai: "markdown" },
    {
      ten: "hoi_dap",
      nhan: "Hỏi đáp",
      loai: "danh_sach",
      bat_buoc: true,
      so_muc_toi_da: 50,
      do_dai_toi_da: 2000,
    },
  ],
};

const DANG_CHUOI_SOCIAL: DinhNghiaDinhDang = {
  id: "chuoi-social",
  phien_ban: 1,
  nhan: "Chuỗi social",
  mo_ta: "Chuỗi bài social theo một số/chủ đề: các bài có thứ tự + gợi ý lịch đăng.",
  ngon_ngu: NGON_NGU,
  truong: [
    { ten: "tieu_de", nhan: "Tiêu đề chuỗi", loai: "van_ban", do_dai_toi_da: 200 },
    {
      ten: "cac_bai",
      nhan: "Các bài",
      loai: "danh_sach",
      bat_buoc: true,
      so_muc_toi_da: 30,
      do_dai_toi_da: 500,
    },
    { ten: "lich_dang", nhan: "Lịch đăng gợi ý", loai: "markdown" },
  ],
};

const DANG_SCRIPT_THAO_LUAN: DinhNghiaDinhDang = {
  id: "script-thao-luan",
  phien_ban: 1,
  nhan: "Script thảo luận",
  mo_ta: "Script video/nhóm thảo luận: mục tiêu, lời thoại dẫn, câu hỏi thảo luận, tài liệu kèm.",
  ngon_ngu: NGON_NGU,
  truong: [
    { ten: "tieu_de", nhan: "Tiêu đề", loai: "van_ban", bat_buoc: true, do_dai_toi_da: 200 },
    { ten: "muc_tieu", nhan: "Mục tiêu", loai: "van_ban", do_dai_toi_da: 300 },
    { ten: "loi_thoai", nhan: "Lời thoại", loai: "markdown", bat_buoc: true },
    {
      ten: "cau_hoi_thao_luan",
      nhan: "Câu hỏi thảo luận",
      loai: "danh_sach",
      so_muc_toi_da: 20,
      do_dai_toi_da: 500,
    },
    {
      ten: "tai_lieu",
      nhan: "Tài liệu kèm",
      loai: "danh_sach",
      so_muc_toi_da: 20,
      do_dai_toi_da: 300,
    },
  ],
};

// --- Định dạng phát hành B2B (#9) ---
// Đầu ra theo đối tượng của một bản phát hành phần mềm. Mỗi định dạng có
// trường `gioi_han` (danh sách) để giới hạn gói/vùng/khả dụng còn hiển
// thị trên đầu ra bị ảnh hưởng, và `lien_ket` để link CTA trỏ đúng trang.
// Fact tính năng đổ vào các trường danh sách kèm marker [F:<id>] — fact
// chưa xác nhận thành dòng [CÂU HỎI] thay vì sự thật.

const DANG_HUONG_DAN_TICH_HOP: DinhNghiaDinhDang = {
  id: "huong-dan-tich-hop",
  phien_ban: 1,
  nhan: "Hướng dẫn tích hợp",
  mo_ta: "Tài liệu tích hợp cho developer: giới thiệu, yêu cầu trước, các bước, giới hạn, link tài liệu.",
  ngon_ngu: NGON_NGU,
  truong: [
    { ten: "tieu_de", nhan: "Tiêu đề", loai: "van_ban", bat_buoc: true, do_dai_toi_da: 200 },
    { ten: "gioi_thieu", nhan: "Giới thiệu", loai: "markdown" },
    {
      ten: "yeu_cau_truoc",
      nhan: "Yêu cầu trước",
      loai: "danh_sach",
      so_muc_toi_da: 20,
      do_dai_toi_da: 500,
    },
    {
      ten: "cac_buoc",
      nhan: "Các bước tích hợp",
      loai: "danh_sach",
      bat_buoc: true,
      so_muc_toi_da: 40,
      do_dai_toi_da: 800,
    },
    {
      ten: "gioi_han",
      nhan: "Giới hạn áp dụng",
      loai: "danh_sach",
      so_muc_toi_da: 20,
      do_dai_toi_da: 500,
    },
    { ten: "lien_ket", nhan: "Link tài liệu", loai: "van_ban", do_dai_toi_da: 500 },
  ],
};

const DANG_THAY_DOI_KHACH_HANG: DinhNghiaDinhDang = {
  id: "thay-doi-khach-hang",
  phien_ban: 1,
  nhan: "Thay đổi cho khách hàng",
  mo_ta: "Giải thích bản phát hành thay đổi gì cho khách hàng hiện tại + việc cần làm.",
  ngon_ngu: NGON_NGU,
  truong: [
    { ten: "tieu_de", nhan: "Tiêu đề", loai: "van_ban", bat_buoc: true, do_dai_toi_da: 200 },
    { ten: "gioi_thieu", nhan: "Giới thiệu", loai: "markdown" },
    {
      ten: "cac_thay_doi",
      nhan: "Các thay đổi",
      loai: "danh_sach",
      bat_buoc: true,
      so_muc_toi_da: 30,
      do_dai_toi_da: 500,
    },
    {
      ten: "gioi_han",
      nhan: "Giới hạn áp dụng",
      loai: "danh_sach",
      so_muc_toi_da: 20,
      do_dai_toi_da: 500,
    },
    { ten: "hanh_dong", nhan: "Việc cần làm", loai: "van_ban", do_dai_toi_da: 300 },
    { ten: "lien_ket", nhan: "Link nâng cấp", loai: "van_ban", do_dai_toi_da: 500 },
  ],
};

const DANG_LOI_ICH_TIEM_NANG: DinhNghiaDinhDang = {
  id: "loi-ich-tiem-nang",
  phien_ban: 1,
  nhan: "Lợi ích cho khách hàng tiềm năng",
  mo_ta: "Lợi ích của bản phát hành cho prospect: điểm lợi ích, bằng chứng, CTA.",
  ngon_ngu: NGON_NGU,
  truong: [
    { ten: "tieu_de", nhan: "Tiêu đề", loai: "van_ban", bat_buoc: true, do_dai_toi_da: 200 },
    { ten: "gioi_thieu", nhan: "Giới thiệu", loai: "markdown" },
    {
      ten: "cac_loi_ich",
      nhan: "Các lợi ích",
      loai: "danh_sach",
      bat_buoc: true,
      so_muc_toi_da: 20,
      do_dai_toi_da: 500,
    },
    {
      ten: "bang_chung",
      nhan: "Bằng chứng",
      loai: "danh_sach",
      so_muc_toi_da: 20,
      do_dai_toi_da: 500,
    },
    {
      ten: "gioi_han",
      nhan: "Giới hạn áp dụng",
      loai: "danh_sach",
      so_muc_toi_da: 20,
      do_dai_toi_da: 500,
    },
    { ten: "cta", nhan: "CTA", loai: "van_ban", do_dai_toi_da: 200 },
    { ten: "lien_ket", nhan: "Link tài liệu", loai: "van_ban", do_dai_toi_da: 500 },
  ],
};

const DANG_KIEM_SOAT_BAO_MAT: DinhNghiaDinhDang = {
  id: "kiem-soat-bao-mat",
  phien_ban: 1,
  nhan: "Kiểm soát cho bên mua bảo mật",
  mo_ta: "Kiểm soát + giới hạn cho người mua bảo mật — chỉ claim có bằng chứng, phần thiếu liệt kê riêng.",
  ngon_ngu: NGON_NGU,
  truong: [
    { ten: "tieu_de", nhan: "Tiêu đề", loai: "van_ban", bat_buoc: true, do_dai_toi_da: 200 },
    { ten: "gioi_thieu", nhan: "Giới thiệu", loai: "markdown" },
    {
      ten: "kiem_soat",
      nhan: "Các kiểm soát",
      loai: "danh_sach",
      bat_buoc: true,
      so_muc_toi_da: 30,
      do_dai_toi_da: 500,
    },
    {
      ten: "gioi_han",
      nhan: "Giới hạn áp dụng",
      loai: "danh_sach",
      bat_buoc: true,
      so_muc_toi_da: 20,
      do_dai_toi_da: 500,
    },
    {
      ten: "con_thieu",
      nhan: "Còn thiếu bằng chứng",
      loai: "danh_sach",
      so_muc_toi_da: 20,
      do_dai_toi_da: 500,
    },
    { ten: "lien_ket", nhan: "Link tài liệu", loai: "van_ban", do_dai_toi_da: 500 },
  ],
};

const DANG_BRIEF_BAN_HANG: DinhNghiaDinhDang = {
  id: "brief-ban-hang",
  phien_ban: 1,
  nhan: "Brief sales",
  mo_ta: "Brief nội bộ cho đội sales: thông điệp chính, điểm bán, xử lý phản đối, bước tiếp.",
  ngon_ngu: NGON_NGU,
  truong: [
    { ten: "tieu_de", nhan: "Tiêu đề", loai: "van_ban", bat_buoc: true, do_dai_toi_da: 200 },
    {
      ten: "thong_diep_chinh",
      nhan: "Thông điệp chính",
      loai: "van_ban",
      bat_buoc: true,
      do_dai_toi_da: 300,
    },
    {
      ten: "diem_ban",
      nhan: "Điểm bán",
      loai: "danh_sach",
      bat_buoc: true,
      so_muc_toi_da: 20,
      do_dai_toi_da: 500,
    },
    {
      ten: "doi_pho",
      nhan: "Xử lý phản đối",
      loai: "danh_sach",
      so_muc_toi_da: 20,
      do_dai_toi_da: 500,
    },
    {
      ten: "gioi_han",
      nhan: "Giới hạn áp dụng",
      loai: "danh_sach",
      so_muc_toi_da: 20,
      do_dai_toi_da: 500,
    },
    { ten: "tiep_theo", nhan: "Bước tiếp theo", loai: "van_ban", do_dai_toi_da: 300 },
  ],
};

const DANG_EMAIL_PHAN_DOAN: DinhNghiaDinhDang = {
  id: "email-phan-doan",
  phien_ban: 1,
  nhan: "Email phân đoạn",
  mo_ta: "Nháp email gửi một phân đoạn khách hàng — giao qua dịch vụ gửi sở hữu khi đã tích hợp.",
  ngon_ngu: NGON_NGU,
  truong: [
    { ten: "tieu_de", nhan: "Tiêu đề email", loai: "van_ban", bat_buoc: true, do_dai_toi_da: 150 },
    { ten: "tom_tat", nhan: "Tóm tắt", loai: "van_ban", do_dai_toi_da: 200 },
    { ten: "phan_doan", nhan: "Phân đoạn", loai: "van_ban", do_dai_toi_da: 200 },
    { ten: "noi_dung", nhan: "Nội dung", loai: "markdown", bat_buoc: true },
    {
      ten: "gioi_han",
      nhan: "Giới hạn áp dụng",
      loai: "danh_sach",
      so_muc_toi_da: 20,
      do_dai_toi_da: 500,
    },
    { ten: "lien_ket", nhan: "Link CTA", loai: "van_ban", do_dai_toi_da: 500 },
  ],
};

// --- Định dạng gây quỹ nonprofit (#10) ---
// Đầu ra của một chiến dịch truyền thông gây quỹ. Tác động đã đạt và
// ước tính là HAI trường danh sách riêng (tac_dong_da_dat /
// tac_dong_uoc_tinh) để tiêu chí "phân biệt đã đạt vs ước tính" thành
// cấu trúc schema, không phụ thuộc cách viết. `muc_tieu` là mục tiêu
// gây quỹ tương lai; `lien_ket` là đích CTA quyên góp do tổ chức cung
// cấp — xem trước hiện link cuối trước khi duyệt. Tác động/trích dẫn
// chưa xác nhận đổ thành dòng [CÂU HỎI], không trình bày như sự thật.

const TRUONG_TAC_DONG_DA_DAT: DinhNghiaTruong = {
  ten: "tac_dong_da_dat",
  nhan: "Tác động đã đạt",
  loai: "danh_sach",
  bat_buoc: true,
  so_muc_toi_da: 30,
  do_dai_toi_da: 500,
};
const TRUONG_TAC_DONG_UOC_TINH: DinhNghiaTruong = {
  ten: "tac_dong_uoc_tinh",
  nhan: "Tác động ước tính",
  loai: "danh_sach",
  so_muc_toi_da: 30,
  do_dai_toi_da: 500,
};
const TRUONG_MUC_TIEU_GQ: DinhNghiaTruong = {
  ten: "muc_tieu",
  nhan: "Mục tiêu gây quỹ",
  loai: "van_ban",
  do_dai_toi_da: 500,
};
const TRUONG_CTA_GQ: DinhNghiaTruong = {
  ten: "cta",
  nhan: "CTA quyên góp",
  loai: "van_ban",
  do_dai_toi_da: 200,
};
const TRUONG_LIEN_KET_GQ: DinhNghiaTruong = {
  ten: "lien_ket",
  nhan: "Link quyên góp",
  loai: "van_ban",
  do_dai_toi_da: 500,
};

const DANG_BAO_CAO_TAC_DONG: DinhNghiaDinhDang = {
  id: "bao-cao-tac-dong",
  phien_ban: 1,
  nhan: "Báo cáo tác động",
  mo_ta: "Báo cáo cho nhà tài trợ: tác động đã đạt tách khỏi ước tính, mục tiêu gây quỹ tương lai nêu riêng, link quyên góp cuối.",
  ngon_ngu: NGON_NGU,
  truong: [
    { ten: "tieu_de", nhan: "Tiêu đề", loai: "van_ban", bat_buoc: true, do_dai_toi_da: 200 },
    { ten: "tom_tat", nhan: "Tóm tắt", loai: "van_ban", do_dai_toi_da: 300 },
    TRUONG_TAC_DONG_DA_DAT,
    TRUONG_TAC_DONG_UOC_TINH,
    TRUONG_MUC_TIEU_GQ,
    { ten: "noi_dung", nhan: "Nội dung", loai: "markdown", bat_buoc: true },
    {
      ten: "trich_dan",
      nhan: "Trích dẫn",
      loai: "danh_sach",
      so_muc_toi_da: 20,
      do_dai_toi_da: 500,
    },
    TRUONG_CTA_GQ,
    TRUONG_LIEN_KET_GQ,
  ],
};

const DANG_CAU_CHUYEN_NHAN_VAN: DinhNghiaDinhDang = {
  id: "cau-chuyen-nhan-van",
  phien_ban: 1,
  nhan: "Câu chuyện nhân văn",
  mo_ta: "Câu chuyện công khai chỉ dùng tư liệu đã cung cấp — khoảng trống hiển thị là câu hỏi biên tập, không bịa tên/lời/ảnh/số đo.",
  ngon_ngu: NGON_NGU,
  truong: [
    { ten: "tieu_de", nhan: "Tiêu đề", loai: "van_ban", bat_buoc: true, do_dai_toi_da: 200 },
    { ten: "noi_dung", nhan: "Nội dung", loai: "markdown", bat_buoc: true },
    {
      ten: "trich_dan",
      nhan: "Trích dẫn được phép dùng",
      loai: "danh_sach",
      so_muc_toi_da: 10,
      do_dai_toi_da: 500,
    },
    {
      ten: "con_thieu",
      nhan: "Câu hỏi biên tập còn thiếu",
      loai: "danh_sach",
      so_muc_toi_da: 20,
      do_dai_toi_da: 500,
    },
    TRUONG_CTA_GQ,
    TRUONG_LIEN_KET_GQ,
  ],
  goi_y_asset: "ảnh hiện trường đã có quyền sử dụng",
};

const DANG_EMAIL_TAI_TRO: DinhNghiaDinhDang = {
  id: "email-tai-tro",
  phien_ban: 1,
  nhan: "Email nhà tài trợ lớn",
  mo_ta: "Nháp email cho nhà tài trợ lớn: chi tiết hơn câu chuyện công khai nhưng giữ nguyên fact tác động và CTA quyên góp.",
  ngon_ngu: NGON_NGU,
  truong: [
    { ten: "tieu_de", nhan: "Chủ đề email", loai: "van_ban", bat_buoc: true, do_dai_toi_da: 150 },
    { ten: "tom_tat", nhan: "Xem trước", loai: "van_ban", do_dai_toi_da: 200 },
    { ten: "phan_doan", nhan: "Phân đoạn", loai: "van_ban", do_dai_toi_da: 200 },
    { ten: "noi_dung", nhan: "Nội dung", loai: "markdown", bat_buoc: true },
    TRUONG_TAC_DONG_DA_DAT,
    TRUONG_TAC_DONG_UOC_TINH,
    TRUONG_MUC_TIEU_GQ,
    TRUONG_CTA_GQ,
    TRUONG_LIEN_KET_GQ,
  ],
};

const DANG_TRANG_CAMPAIGN: DinhNghiaDinhDang = {
  id: "trang-campaign",
  phien_ban: 1,
  nhan: "Trang campaign",
  mo_ta: "Trang campaign trên website sở hữu: mục tiêu + số tiền kèm tiền tệ, tác động đã đạt/ước tính riêng, CTA quyên góp.",
  ngon_ngu: NGON_NGU,
  truong: [
    { ten: "tieu_de", nhan: "Tiêu đề", loai: "van_ban", bat_buoc: true, do_dai_toi_da: 200 },
    { ten: "noi_dung", nhan: "Nội dung", loai: "markdown", bat_buoc: true },
    TRUONG_TAC_DONG_DA_DAT,
    TRUONG_TAC_DONG_UOC_TINH,
    TRUONG_MUC_TIEU_GQ,
    {
      ten: "trich_dan",
      nhan: "Trích dẫn",
      loai: "danh_sach",
      so_muc_toi_da: 10,
      do_dai_toi_da: 500,
    },
    TRUONG_CTA_GQ,
    TRUONG_LIEN_KET_GQ,
  ],
};

const DANG_CAP_NHAT_TINH_NGUYEN: DinhNghiaDinhDang = {
  id: "cap-nhat-tinh-nguyen",
  phien_ban: 1,
  nhan: "Cập nhật tình nguyện viên",
  mo_ta: "Cập nhật nội bộ cho tình nguyện viên: tiến độ, việc cần làm, link quyên góp nếu có.",
  ngon_ngu: NGON_NGU,
  truong: [
    { ten: "tieu_de", nhan: "Tiêu đề", loai: "van_ban", bat_buoc: true, do_dai_toi_da: 200 },
    { ten: "noi_dung", nhan: "Nội dung", loai: "markdown", bat_buoc: true },
    {
      ten: "cac_buoc",
      nhan: "Việc cần làm",
      loai: "danh_sach",
      so_muc_toi_da: 20,
      do_dai_toi_da: 500,
    },
    TRUONG_CTA_GQ,
    TRUONG_LIEN_KET_GQ,
  ],
};

// --- Định dạng công quyền (#11) ---
// Đầu ra giải thích chính sách cho các nhóm đối tượng của một cơ quan.
// Bốn trường ràng buộc dùng chung trong mọi định dạng: `yeu_cau` (yêu
// cầu bắt buộc/giải thích đã xác nhận), `ngoai_le` (ngoại lệ liên kết
// yêu cầu), `pham_vi` (phạm vi quyền hạn), `ngay_hieu_luc` (ngày có
// hiệu lực) — đơn giản hóa/dịch phải giữ nguyên bốn phần đó. Điều
// khoản nguồn mơ hồ đổ thành dòng [CÂU HỎI], không phải luật bịa.

const TRUONG_YEU_CAU: DinhNghiaTruong = {
  ten: "yeu_cau",
  nhan: "Yêu cầu áp dụng",
  loai: "danh_sach",
  bat_buoc: true,
  so_muc_toi_da: 20,
  do_dai_toi_da: 500,
};
const TRUONG_NGOAI_LE: DinhNghiaTruong = {
  ten: "ngoai_le",
  nhan: "Ngoại lệ áp dụng",
  loai: "danh_sach",
  so_muc_toi_da: 20,
  do_dai_toi_da: 500,
};
const TRUONG_PHAM_VI: DinhNghiaTruong = {
  ten: "pham_vi",
  nhan: "Phạm vi áp dụng",
  loai: "van_ban",
  bat_buoc: true,
  do_dai_toi_da: 500,
};
const TRUONG_NGAY_HIEU_LUC: DinhNghiaTruong = {
  ten: "ngay_hieu_luc",
  nhan: "Ngày hiệu lực",
  loai: "van_ban",
  bat_buoc: true,
  do_dai_toi_da: 60,
};

const DANG_FAQ_CONG_DAN: DinhNghiaDinhDang = {
  id: "faq-cong-dan",
  phien_ban: 1,
  nhan: "FAQ công dân",
  mo_ta: "Hỏi đáp cho hộ gia đình/cư dân — câu trả lời ngắn, yêu cầu và ngoại lệ ràng buộc nêu riêng.",
  ngon_ngu: NGON_NGU,
  truong: [
    { ten: "tieu_de", nhan: "Tiêu đề", loai: "van_ban", bat_buoc: true, do_dai_toi_da: 200 },
    { ten: "gioi_thieu", nhan: "Giới thiệu", loai: "markdown" },
    {
      ten: "hoi_dap",
      nhan: "Hỏi đáp",
      loai: "danh_sach",
      bat_buoc: true,
      so_muc_toi_da: 15,
      do_dai_toi_da: 500,
    },
    TRUONG_YEU_CAU,
    TRUONG_NGOAI_LE,
    TRUONG_PHAM_VI,
    TRUONG_NGAY_HIEU_LUC,
    { ten: "hoi_them", nhan: "Hỏi thêm", loai: "van_ban", do_dai_toi_da: 300 },
  ],
};

const DANG_CHECKLIST_DOANH_NGHIEP: DinhNghiaDinhDang = {
  id: "checklist-doanh-nghiep",
  phien_ban: 1,
  nhan: "Checklist tuân thủ doanh nghiệp",
  mo_ta: "Các bước doanh nghiệp phải làm để tuân thủ — yêu cầu bắt buộc thành việc cụ thể, ngoại lệ nêu riêng.",
  ngon_ngu: NGON_NGU,
  truong: [
    { ten: "tieu_de", nhan: "Tiêu đề", loai: "van_ban", bat_buoc: true, do_dai_toi_da: 200 },
    { ten: "gioi_thieu", nhan: "Giới thiệu", loai: "markdown" },
    {
      ten: "cac_buoc",
      nhan: "Các bước phải làm",
      loai: "danh_sach",
      bat_buoc: true,
      so_muc_toi_da: 15,
      do_dai_toi_da: 500,
    },
    TRUONG_YEU_CAU,
    TRUONG_NGOAI_LE,
    TRUONG_PHAM_VI,
    TRUONG_NGAY_HIEU_LUC,
    { ten: "lien_ket", nhan: "Link tài liệu", loai: "van_ban", do_dai_toi_da: 500 },
  ],
};

const DANG_GIAI_THICH_TRUONG_HOC: DinhNghiaDinhDang = {
  id: "giai-thich-truong-hoc",
  phien_ban: 1,
  nhan: "Bài giải thích cho trường học",
  mo_ta: "Bài giải thích dạy được cho trường học — văn đơn giản, phần phải làm tách phần nên làm.",
  ngon_ngu: NGON_NGU,
  truong: [
    { ten: "tieu_de", nhan: "Tiêu đề", loai: "van_ban", bat_buoc: true, do_dai_toi_da: 200 },
    { ten: "noi_dung", nhan: "Nội dung", loai: "markdown", bat_buoc: true },
    TRUONG_YEU_CAU,
    TRUONG_NGOAI_LE,
    {
      ten: "goi_y_hoat_dong",
      nhan: "Hoạt động gợi ý",
      loai: "danh_sach",
      so_muc_toi_da: 10,
      do_dai_toi_da: 500,
    },
    TRUONG_PHAM_VI,
    TRUONG_NGAY_HIEU_LUC,
  ],
};

const DANG_TOM_TAT_NHA_THAU: DinhNghiaDinhDang = {
  id: "tom-tat-nha-thau",
  phien_ban: 1,
  nhan: "Tóm tắt cho nhà thầu",
  mo_ta: "Nghĩa vụ hợp đồng ngắn gọn cho nhà thầu — tóm tắt + yêu cầu bắt buộc + ngoại lệ áp dụng.",
  ngon_ngu: NGON_NGU,
  truong: [
    { ten: "tieu_de", nhan: "Tiêu đề", loai: "van_ban", bat_buoc: true, do_dai_toi_da: 200 },
    { ten: "tom_tat", nhan: "Tóm tắt", loai: "van_ban", bat_buoc: true, do_dai_toi_da: 500 },
    {
      ten: "nghia_vu",
      nhan: "Nghĩa vụ hợp đồng",
      loai: "danh_sach",
      bat_buoc: true,
      so_muc_toi_da: 15,
      do_dai_toi_da: 500,
    },
    TRUONG_YEU_CAU,
    TRUONG_NGOAI_LE,
    TRUONG_PHAM_VI,
    TRUONG_NGAY_HIEU_LUC,
  ],
};

const DANG_BAN_DICH_GIAN_DI: DinhNghiaDinhDang = {
  id: "ban-dich-gian-di",
  phien_ban: 1,
  nhan: "Bản dịch ngôn ngữ giản dị",
  mo_ta: "Bản dịch cho người nhập cư/ngôn ngữ thứ hai — giữ nguyên nghĩa vụ, ngoại lệ, phạm vi và ngày hiệu lực.",
  ngon_ngu: NGON_NGU,
  truong: [
    { ten: "tieu_de", nhan: "Tiêu đề", loai: "van_ban", bat_buoc: true, do_dai_toi_da: 200 },
    { ten: "noi_dung", nhan: "Nội dung", loai: "markdown", bat_buoc: true },
    TRUONG_YEU_CAU,
    TRUONG_NGOAI_LE,
    TRUONG_PHAM_VI,
    TRUONG_NGAY_HIEU_LUC,
    {
      ten: "ghi_chu",
      nhan: "Ghi chú biên dịch",
      loai: "danh_sach",
      so_muc_toi_da: 10,
      do_dai_toi_da: 500,
    },
  ],
};

const REGISTRY: Record<string, DinhNghiaDinhDang> = Object.fromEntries(
  [
    DANG_BAI_VIET,
    DANG_NEWSLETTER,
    DANG_CAPTION,
    DANG_THREAD,
    DANG_SCRIPT_NGAN,
    DANG_SCRIPT_DAI,
    DANG_GOOGLE_BUSINESS,
    DANG_EMAIL_KHACH,
    DANG_FAQ,
    DANG_HOC_TAI_LIEU,
    DANG_GIAI_THICH_THIEU_NIEN,
    DANG_HOI_DAP_DOC_GIA,
    DANG_CHUOI_SOCIAL,
    DANG_SCRIPT_THAO_LUAN,
    DANG_HUONG_DAN_TICH_HOP,
    DANG_THAY_DOI_KHACH_HANG,
    DANG_LOI_ICH_TIEM_NANG,
    DANG_KIEM_SOAT_BAO_MAT,
    DANG_BRIEF_BAN_HANG,
    DANG_EMAIL_PHAN_DOAN,
    DANG_BAO_CAO_TAC_DONG,
    DANG_CAU_CHUYEN_NHAN_VAN,
    DANG_EMAIL_TAI_TRO,
    DANG_TRANG_CAMPAIGN,
    DANG_CAP_NHAT_TINH_NGUYEN,
    DANG_FAQ_CONG_DAN,
    DANG_CHECKLIST_DOANH_NGHIEP,
    DANG_GIAI_THICH_TRUONG_HOC,
    DANG_TOM_TAT_NHA_THAU,
    DANG_BAN_DICH_GIAN_DI,
  ].map((d) => [d.id, d]),
);

export const DANH_SACH_DINH_DANG = Object.keys(REGISTRY);

export function layDinhDang(id: string): DinhNghiaDinhDang | null {
  return REGISTRY[id] ?? null;
}

export function danhSachDinhDang(): DinhNghiaDinhDang[] {
  return Object.values(REGISTRY);
}

// --- Đọc nội dung canonical ---

// JSON object → giá trị từng trường (chuỗi hoặc mảng chuỗi; kiểu khác ép chuỗi).
// Không phải JSON object → map vào trường markdown 'noi_dung' nếu định dạng
// khai báo; còn không thì giữ nguyên văn ở '_tho'.
export function docNoiDung(def: DinhNghiaDinhDang, noiDung: string): TruongGiaTri {
  let j: unknown = null;
  try {
    j = JSON.parse(noiDung);
  } catch {
    // Không phải JSON → văn bản thường.
  }
  if (typeof j === "object" && j !== null && !Array.isArray(j)) {
    // Object null-prototype: key lạ như '__proto__' vẫn là own-key nên
    // validation thấy và báo 'trường không nằm trong schema' thay vì mất lặng.
    const ra: TruongGiaTri = Object.create(null);
    for (const [k, v] of Object.entries(j as Record<string, unknown>)) {
      if (typeof v === "string") ra[k] = v;
      else if (Array.isArray(v)) {
        ra[k] = v.map((m) => (typeof m === "string" ? m : JSON.stringify(m)));
      } else if (v === null || v === undefined) continue;
      // Object/number → JSON (đọc được, không '[object Object]'); validation
      // báo kiểu sai riêng.
      else ra[k] = JSON.stringify(v);
    }
    return ra;
  }
  const coNoiDung = def.truong.some((t) => t.ten === "noi_dung" && t.loai === "markdown");
  return coNoiDung ? { noi_dung: noiDung } : { _tho: noiDung };
}

// --- Validation theo schema: trả phản hồi sửa cụ thể từng trường ---

export function kiemTraNoiDung(def: DinhNghiaDinhDang, noiDung: string): LoiDinhDang[] {
  const fields = docNoiDung(def, noiDung);
  const dsLoi: LoiDinhDang[] = [];
  const daKhaiBao = new Set(def.truong.map((t) => t.ten));

  // JSON gốc để phát hiện kiểu sai — docNoiDung ép chuỗi mất kiểu ban đầu.
  let raw: Record<string, unknown> | null = null;
  try {
    const j: unknown = JSON.parse(noiDung);
    if (j !== null && typeof j === "object" && !Array.isArray(j)) {
      raw = j as Record<string, unknown>;
    }
  } catch {
    // Không phải JSON → nhánh thô, không có kiểu để kiểm.
  }

  for (const ten of Object.keys(fields)) {
    if (ten !== "_tho" && !daKhaiBao.has(ten)) {
      dsLoi.push({ truong: ten, loi: `Trường '${ten}' không nằm trong schema định dạng '${def.id}'.` });
    }
  }

  for (const t of def.truong) {
    const v = fields[t.ten];
    if (v === undefined) {
      if (t.bat_buoc) dsLoi.push({ truong: t.ten, loi: `'${t.nhan}' (${t.ten}) là bắt buộc.` });
      continue;
    }
    // Kiểu dữ liệu sai → báo cụ thể và bỏ qua kiểm độ dài (giá trị đã bị
    // ép chuỗi trong docNoiDung, đếm ký tự trên JSON không có nghĩa).
    const rv = raw?.[t.ten];
    if (rv !== undefined && rv !== null) {
      if (t.loai === "danh_sach" && Array.isArray(rv)) {
        const iSai = rv.findIndex((m) => typeof m !== "string");
        if (iSai >= 0) {
          dsLoi.push({ truong: t.ten, loi: `'${t.ten}' mục ${iSai + 1} không phải chuỗi.` });
          continue;
        }
      } else if (t.loai !== "danh_sach" && typeof rv !== "string" && !Array.isArray(rv)) {
        dsLoi.push({ truong: t.ten, loi: `'${t.ten}' phải là chuỗi, nhận kiểu ${typeof rv}.` });
        continue;
      }
    }

    if (t.loai === "danh_sach") {
      if (!Array.isArray(v)) {
        dsLoi.push({ truong: t.ten, loi: `'${t.ten}' phải là mảng mục.` });
        continue;
      }
      const cacMucCoText = v.filter((m) => m.trim() !== "");
      if (t.bat_buoc && cacMucCoText.length === 0) {
        dsLoi.push({ truong: t.ten, loi: `'${t.nhan}' (${t.ten}) là bắt buộc, cần ít nhất một mục.` });
      }
      // Đếm như renderer: mục rỗng không chiếm suất.
      if (t.so_muc_toi_da !== undefined && cacMucCoText.length > t.so_muc_toi_da) {
        dsLoi.push({
          truong: t.ten,
          loi: `'${t.ten}' có ${cacMucCoText.length} mục, vượt giới hạn ${t.so_muc_toi_da}.`,
        });
      }
      if (t.do_dai_toi_da !== undefined) {
        for (const [i, m] of v.entries()) {
          if (m.length > t.do_dai_toi_da) {
            dsLoi.push({
              truong: t.ten,
              loi: `'${t.ten}[${i + 1}]' dài ${m.length} ký tự, vượt giới hạn ${t.do_dai_toi_da}.`,
            });
            break; // báo một lần đủ — người sửa tự kiểm lại các mục còn lại
          }
        }
      }
      continue;
    }
    // van_ban | markdown: giá trị chuỗi.
    const s = Array.isArray(v) ? v.join("\n") : v;
    if (t.bat_buoc && s.trim() === "") {
      dsLoi.push({ truong: t.ten, loi: `'${t.nhan}' (${t.ten}) là bắt buộc.` });
      continue;
    }
    if (t.loai === "van_ban" && Array.isArray(v)) {
      dsLoi.push({ truong: t.ten, loi: `'${t.ten}' phải là chuỗi, không phải mảng.` });
    }
    if (t.do_dai_toi_da !== undefined && s.length > t.do_dai_toi_da) {
      dsLoi.push({
        truong: t.ten,
        loi: `'${t.ten}' dài ${s.length} ký tự, vượt giới hạn ${t.do_dai_toi_da}.`,
      });
    }
  }

  if (typeof fields._tho === "string" && fields._tho.trim() !== "") {
    dsLoi.push({
      truong: "_tho",
      loi: "Nội dung không theo schema JSON của định dạng — hiển thị như văn bản thô.",
    });
  }
  return dsLoi;
}

// Kiểm ngôn ngữ đầu ra theo định dạng — gọi từ các endpoint tạo bản thể hiện.
// Bỏ qua khi field vắng (server áp default 'vi' sau).
export function kiemTraNgonNgu(def: DinhNghiaDinhDang, ngonNgu?: string | null): string | null {
  if (!ngonNgu) return null;
  if (!def.ngon_ngu.includes(ngonNgu)) {
    return `Định dạng '${def.id}' không hỗ trợ ngôn ngữ '${ngonNgu}'. Cho phép: ${def.ngon_ngu.join(", ")}.`;
  }
  return null;
}

// --- Render ---
export { markdownSangHtml, renderHtml, renderMarkdown, renderText } from "./render.ts";
