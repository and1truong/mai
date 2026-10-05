// Task sinh có phiên bản (#20): mỗi task khai báo id + phien_ban + mô tả
// contract đầu vào/đầu ra. Fixture và adapter live thỏa cùng contract này;
// bump phien_ban khi đổi prompt/schema — provenance ghi lại bản đã dùng.

export type TaskDinhNghia = {
  id: string;
  phien_ban: number;
  mo_ta: string;
};

const TASK_NHAP_BTH: TaskDinhNghia = {
  id: "nhap_ban_the_hien",
  phien_ban: 1,
  mo_ta:
    "Nháp một bản thể hiện theo định dạng từ thông điệp + nguồn + context. Đầu ra: canonical JSON theo schema định dạng + trích dẫn tới nguồn revision đã đưa vào.",
};

const TASK_LAP_KE_HOACH: TaskDinhNghia = {
  id: "lap_ke_hoach",
  phien_ban: 1,
  mo_ta:
    "Đề xuất danh sách đầu ra (định dạng/đối tượng/đích đến + lý do) cho một thông điệp. #5 dùng để fan-out một ý định thành nhiều bản thể hiện.",
};

const TASK_LOCALIZE: TaskDinhNghia = {
  id: "localize",
  phien_ban: 1,
  mo_ta:
    "Dịch các trường nội dung sang ngôn ngữ đích, giữ nguyên văn thuật ngữ giu_nguyen và sự thật đã duyệt.",
};

const TASK_DE_XUAT_REVISION: TaskDinhNghia = {
  id: "de_xuat_revision",
  phien_ban: 1,
  mo_ta:
    "Đề xuất revision thay thế khi nguồn/fact đổi — revision mới luôn đi qua review, không tự kích hoạt (#14 dùng).",
};

export type IdTask = "nhap_ban_the_hien" | "lap_ke_hoach" | "localize" | "de_xuat_revision";

export const TASK: Record<IdTask, TaskDinhNghia> = {
  nhap_ban_the_hien: TASK_NHAP_BTH,
  lap_ke_hoach: TASK_LAP_KE_HOACH,
  localize: TASK_LOCALIZE,
  de_xuat_revision: TASK_DE_XUAT_REVISION,
};

export const DANH_SACH_TASK = Object.keys(TASK) as IdTask[];

export function layTask(id: string): TaskDinhNghia | null {
  return (TASK as Record<string, TaskDinhNghia>)[id] ?? null;
}
