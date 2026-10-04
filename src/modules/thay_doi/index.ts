// #14: phát hiện thay đổi nguồn và quản lý task sửa đầu ra phụ thuộc.
//
// "Nguồn" gồm ba loại cùng một cơ chế: nguồn nội dung (`nguon`), hồ sơ
// thương hiệu (`thuong_hieu`), hồ sơ đối tượng (`doi_tuong`). Một revision
// nguồn mới → diff với revision trước → một record `thay_doi_nguon` +
// các `task_sua` cho bản thể hiện bị ảnh hưởng.
//
// Nguyên tắc phụ thuộc:
// - Chính xác (`chinh_xac`): head revision của bản thể hiện ghim một revision
//   cũ của nguồn đã đổi — qua `thong_diep_revision.nguon_revision_ids` với
//   nguồn nội dung, qua `context_sinh.*_revision_id` với hồ sơ.
// - Không chắc (`khong_chac`): có liên hệ yếu (thông điệp đang link nguồn
//   nhưng head revision thiếu provenance; đối tượng trùng tên nhưng không
//   có context sinh) → gắn cờ để người dùng kiểm tra, không đoán.
// - Không liên quan: head revision ghim đủ provenance mà không chứa nguồn
//   này → bằng chứng đã ghi ủng hộ bỏ qua, không tạo task.

import type { Database } from "bun:sqlite";
import {
  capNhatThongDiep,
  danhSachNguonCuaThongDiep,
  danhSachXuatBan,
  ghiSuKien,
  layBanTheHien,
  layNguon,
  layNguonRevision,
  layRevision,
  layThongDiep,
  layThongDiepRevision,
  type BanTheHien,
  type MucNguon,
  type NguonRevision,
} from "../content/index.ts";
import {
  danhSachHoSoRevision,
  layContextSinh,
  layDoiTuong,
  layThuongHieu,
} from "../context/index.ts";
import { enqueueJob, type Job } from "../jobs/index.ts";
import { LoiApi, loiRequest } from "../../loi.ts";
import { log } from "../../log.ts";

const bayGio = () => new Date().toISOString();

// Bọc một gói ghi trong transaction; gọi lồng nhau được — giống helper txn
// trong content (local theo convention module).
function txn<T>(db: Database, fn: () => T): T {
  if (db.inTransaction) return fn();
  db.exec("BEGIN IMMEDIATE");
  try {
    const r = fn();
    db.exec("COMMIT");
    return r;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

// --- Kiểu ---

export const DANH_SACH_LOAI_THAY_DOI = ["nguon", "thuong_hieu", "doi_tuong"] as const;
export type LoaiThayDoi = (typeof DANH_SACH_LOAI_THAY_DOI)[number];

// Một mục diff của thay_doi_nguon.ds_thay_doi / task_sua.ds_muc.
// Nguồn nội dung: mục trong cac_muc (muc_id ổn định). Hồ sơ: trường trong
// snapshot (muc_id = tên trường). `loai_thay_doi` = 'sua' | 'xoa' | 'them'.
export type MucThayDoi = {
  muc_id: string | null;
  loai_muc: string;
  loai_thay_doi: string;
  tieu_de: string;
  cu: string;
  moi: string;
};

export type ThayDoiNguon = {
  id: string;
  loai: string;
  entity_id: string;
  tu_revision_id: string;
  den_revision_id: string;
  ds_thay_doi: MucThayDoi[];
  tao_luc: string;
  tao_boi: string;
};

export type TaskSua = {
  id: string;
  thay_doi_nguon_id: string;
  ban_the_hien_id: string;
  loai: string;
  do_tin: string;
  ly_do: string;
  ds_muc: MucThayDoi[];
  trang_thai: string;
  job_id: string | null;
  tao_luc: string;
  tao_boi: string;
  cap_nhat_luc: string;
};

export const DANH_SACH_TRANG_THAI_TASK = ["mo", "dang_lam", "xong", "bo_qua"] as const;

// --- Đọc row ---

type DongThayDoi = Omit<ThayDoiNguon, "ds_thay_doi"> & { ds_thay_doi: string };
type DongTask = Omit<TaskSua, "ds_muc"> & { ds_muc: string };

function docDsMuc(v: string): MucThayDoi[] {
  try {
    const j = JSON.parse(v) as unknown;
    return Array.isArray(j) ? (j as MucThayDoi[]) : [];
  } catch {
    return [];
  }
}

function docThayDoi(row: DongThayDoi): ThayDoiNguon {
  return { ...row, ds_thay_doi: docDsMuc(row.ds_thay_doi) };
}

function docTask(row: DongTask): TaskSua {
  return { ...row, ds_muc: docDsMuc(row.ds_muc) };
}

export function layThayDoi(db: Database, id: string): ThayDoiNguon | null {
  const row = db.query("SELECT * FROM thay_doi_nguon WHERE id = ?").get(id) as
    | DongThayDoi
    | null;
  return row ? docThayDoi(row) : null;
}

export function layTaskSua(db: Database, id: string): TaskSua | null {
  const row = db.query("SELECT * FROM task_sua WHERE id = ?").get(id) as DongTask | null;
  return row ? docTask(row) : null;
}

// --- Diff ---

// Diff cac_muc theo id ổn định (s-<slug> do chuanHoaCacMuc sinh, hoặc id do
// người dùng truyền qua PUT). Cùng id đổi nội dung/tiêu đề → 'sua'; chỉ có
// ở cũ → 'xoa'; chỉ có ở mới → 'them'.
export function diffCacMuc(cu: MucNguon[], moi: MucNguon[]): MucThayDoi[] {
  const ds: MucThayDoi[] = [];
  const cuTheoId = new Map(cu.map((m) => [m.id, m]));
  const moiTheoId = new Map(moi.map((m) => [m.id, m]));
  for (const m of moi) {
    const c = cuTheoId.get(m.id);
    if (!c) {
      ds.push({
        muc_id: m.id,
        loai_muc: m.loai,
        loai_thay_doi: "them",
        tieu_de: m.tieu_de ?? m.id,
        cu: "",
        moi: m.noi_dung,
      });
    } else if (c.noi_dung !== m.noi_dung || (c.tieu_de ?? "") !== (m.tieu_de ?? "")) {
      ds.push({
        muc_id: m.id,
        loai_muc: m.loai,
        loai_thay_doi: "sua",
        tieu_de: m.tieu_de ?? c.tieu_de ?? m.id,
        cu: c.noi_dung,
        moi: m.noi_dung,
      });
    }
  }
  for (const c of cu) {
    if (!moiTheoId.has(c.id)) {
      ds.push({
        muc_id: c.id,
        loai_muc: c.loai,
        loai_thay_doi: "xoa",
        tieu_de: c.tieu_de ?? c.id,
        cu: c.noi_dung,
        moi: "",
      });
    }
  }
  return ds;
}

// Trường metadata của snapshot hồ sơ — luôn đổi hoặc không phải nội dung,
// bỏ qua khi diff để không gắn cờ giả.
const TRUONG_HO_SO_BO_QUA = new Set([
  "id",
  "tao_luc",
  "tao_boi",
  "cap_nhat_luc",
  "cap_nhat_boi",
  "la_fixture",
  "nguon_du_lieu",
]);

// Khóa thay đổi mỗi lần ghi (thayThuatNgu xóa + chèn lại toàn bộ với id và
// timestamp mới) — loại khỏi phần so sánh để PUT y hệt không tạo detection
// giả. Áp dụng sâu trong object/mảng.
const KHOA_NHANH_MAT = new Set(["id", "tao_luc", "tao_boi", "cap_nhat_luc", "cap_nhat_boi"]);
function chuanHoaSoSanh(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(chuanHoaSoSanh);
  if (typeof v === "object" && v !== null) {
    const o: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (!KHOA_NHANH_MAT.has(k)) o[k] = chuanHoaSoSanh(val);
    }
    return o;
  }
  return v;
}

// Diff snapshot hồ sơ theo trường. Giá trị không phải chuỗi (mảng/object)
// so bằng JSON.stringify sau khi bỏ khóa nhạy-thời-gian, và hiển thị dạng
// JSON đã chuẩn hóa.
export function diffSnapshotHoSo(cu: unknown, moi: unknown): MucThayDoi[] {
  const ds: MucThayDoi[] = [];
  const cuO =
    typeof cu === "object" && cu !== null && !Array.isArray(cu)
      ? (cu as Record<string, unknown>)
      : {};
  const moiO =
    typeof moi === "object" && moi !== null && !Array.isArray(moi)
      ? (moi as Record<string, unknown>)
      : {};
  const chuoi = (v: unknown) => (typeof v === "string" ? v : JSON.stringify(v) ?? "");
  const cacTruong = new Set([...Object.keys(cuO), ...Object.keys(moiO)]);
  for (const truong of cacTruong) {
    if (TRUONG_HO_SO_BO_QUA.has(truong)) continue;
    const c = cuO[truong];
    const m = moiO[truong];
    const cN = chuanHoaSoSanh(c);
    const mN = chuanHoaSoSanh(m);
    if (JSON.stringify(cN) === JSON.stringify(mN)) continue;
    ds.push({
      muc_id: truong,
      loai_muc: "truong",
      loai_thay_doi: c === undefined ? "them" : m === undefined ? "xoa" : "sua",
      tieu_de: truong,
      cu: chuoi(cN),
      moi: chuoi(mN),
    });
  }
  return ds;
}

// --- Quét bản thể hiện bị ảnh hưởng ---

type UngVien = {
  bth: BanTheHien;
  do_tin: "chinh_xac" | "khong_chac";
  ds_muc: MucThayDoi[];
  ly_do: string;
};

function nhanNguon(rev: { so_thu_tu: number } | null | undefined): string {
  return rev ? `#${rev.so_thu_tu}` : "?";
}

// Quét bản thể hiện phụ thuộc một nguồn nội dung đã đổi.
// Bằng chứng chính xác: head revision → thong_diep_revision.nguon_revision_ids
// chứa một revision của nguồn này khác revision mới. Không chắc: thông điệp
// đang link nguồn mà head revision thiếu thong_diep_revision_id.
function quetBthTheoNguon(db: Database, nguonId: string, den: NguonRevision): UngVien[] {
  const ra: UngVien[] = [];
  const daCo = new Set<string>();
  const dsChinhXac = db
    .query(
      `SELECT b.id AS bth_id, nr.id AS pinned_id
       FROM ban_the_hien b
       JOIN revision r ON r.id = b.head_revision_id
       JOIN thong_diep_revision td ON td.id = r.thong_diep_revision_id
       JOIN nguon_revision nr ON nr.nguon_id = ? AND nr.id != ?
       WHERE EXISTS (
         SELECT 1 FROM json_each(td.nguon_revision_ids) je WHERE je.value = nr.id
       )`,
    )
    .all(nguonId, den.id) as { bth_id: string; pinned_id: string }[];

  // Một bản chỉ ghim một revision của nguồn này trong tdRev — nhóm theo bản,
  // giữ pinned có số lớn nhất (an toàn nếu dữ liệu cũ có nhiều hơn một).
  const pinnedCaoNhat = new Map<string, string>();
  for (const r of dsChinhXac) {
    const cur = pinnedCaoNhat.get(r.bth_id);
    if (cur === undefined) {
      pinnedCaoNhat.set(r.bth_id, r.pinned_id);
      continue;
    }
    const curRev = layNguonRevision(db, cur);
    const rRev = layNguonRevision(db, r.pinned_id);
    if ((rRev?.so_thu_tu ?? 0) > (curRev?.so_thu_tu ?? 0)) {
      pinnedCaoNhat.set(r.bth_id, r.pinned_id);
    }
  }

  for (const [bthId, pinnedId] of pinnedCaoNhat) {
    const bth = layBanTheHien(db, bthId);
    const pinned = layNguonRevision(db, pinnedId);
    if (!bth || !pinned) continue;
    daCo.add(bthId);
    const dsMuc = diffCacMuc(pinned.cac_muc, den.cac_muc);
    ra.push({
      bth,
      do_tin: "chinh_xac",
      ds_muc: dsMuc,
      ly_do: `Bản ghim revision nguồn ${nhanNguon(pinned)} — đã có revision ${nhanNguon(den)}` +
        (dsMuc.length > 0 ? `; mục đổi: ${dsMuc.map((m) => m.tieu_de).join(", ")}` : ""),
    });
  }

  // Không chắc: thông điệp đang link nguồn nhưng head revision không có
  // provenance (thong_diep_revision_id NULL — dữ liệu trước #4).
  const dsKhongChac = db
    .query(
      `SELECT DISTINCT b.id AS bth_id
       FROM ban_the_hien b
       JOIN revision r ON r.id = b.head_revision_id
       JOIN thong_diep_nguon tn ON tn.thong_diep_id = b.thong_diep_id AND tn.nguon_id = ?
       WHERE r.thong_diep_revision_id IS NULL`,
    )
    .all(nguonId) as { bth_id: string }[];
  for (const r of dsKhongChac) {
    if (daCo.has(r.bth_id)) continue;
    const bth = layBanTheHien(db, r.bth_id);
    if (!bth) continue;
    daCo.add(r.bth_id);
    ra.push({
      bth,
      do_tin: "khong_chac",
      ds_muc: [],
      ly_do:
        "Thông điệp đang link nguồn này nhưng revision head không có provenance — " +
        "không chứng minh được bản đã dùng nguồn. Kiểm tra tay.",
    });
  }
  return ra;
}

// Quét bản thể hiện phụ thuộc một hồ sơ đã đổi.
// Bằng chứng chính xác: head revision → context_sinh ghim revision cũ của
// hồ sơ. Không chắc (chỉ đối tượng): head revision không có context_sinh mà
// danh tính bản ghi đúng tên hồ sơ đối tượng.
function quetBthTheoHoSo(
  db: Database,
  loai: "thuong_hieu" | "doi_tuong",
  hoSoId: string,
  denRevId: string,
  dsThayDoi: MucThayDoi[],
): UngVien[] {
  const ra: UngVien[] = [];
  const daCo = new Set<string>();
  const cotId = loai === "thuong_hieu" ? "thuong_hieu_id" : "doi_tuong_id";
  const cotRev = loai === "thuong_hieu" ? "thuong_hieu_revision_id" : "doi_tuong_revision_id";
  const laySnapshot = (id: string | null) => {
    if (!id) return null;
    const row = db.query("SELECT snapshot FROM ho_so_revision WHERE id = ?").get(id) as
      | { snapshot: string }
      | null;
    return row?.snapshot ?? null;
  };
  const denSnapshot = laySnapshot(denRevId);
  const dsChinhXac = db
    .query(
      `SELECT b.id AS bth_id, cs.${cotRev} AS pinned_id
       FROM ban_the_hien b
       JOIN revision r ON r.id = b.head_revision_id
       JOIN context_sinh cs ON cs.id = r.context_sinh_id
       WHERE cs.${cotId} = ? AND cs.${cotRev} != ?`,
    )
    .all(hoSoId, denRevId) as { bth_id: string; pinned_id: string | null }[];
  for (const r of dsChinhXac) {
    if (!r.pinned_id || daCo.has(r.bth_id)) continue;
    const bth = layBanTheHien(db, r.bth_id);
    if (!bth) continue;
    daCo.add(r.bth_id);
    // Diff theo đúng revision hồ sơ mà bản này đã ghim — bản ghim cũ hơn
    // revision 'tu' của detection thấy diff tích lũy; thiếu snapshot thì dùng
    // diff của detection.
    let dsMuc = dsThayDoi;
    const pinnedSnapshot = laySnapshot(r.pinned_id);
    if (pinnedSnapshot && denSnapshot && r.pinned_id !== denRevId) {
      const d = diffSnapshotHoSo(JSON.parse(pinnedSnapshot), JSON.parse(denSnapshot));
      if (d.length > 0) dsMuc = d;
    }
    ra.push({
      bth,
      do_tin: "chinh_xac",
      ds_muc: dsMuc,
      ly_do:
        `Context sinh ghim revision hồ sơ cũ — trường đổi: ` +
        `${dsMuc.map((m) => m.tieu_de).join(", ")}`,
    });
  }
  if (loai === "doi_tuong") {
    const hoSo = layDoiTuong(db, hoSoId);
    if (hoSo) {
      const dsKhongChac = db
        .query(
          `SELECT b.id AS bth_id FROM ban_the_hien b
           JOIN revision r ON r.id = b.head_revision_id
           WHERE r.context_sinh_id IS NULL AND b.doi_tuong = ?`,
        )
        .all(hoSo.ten) as { bth_id: string }[];
      for (const r of dsKhongChac) {
        if (daCo.has(r.bth_id)) continue;
        const bth = layBanTheHien(db, r.bth_id);
        if (!bth) continue;
        daCo.add(r.bth_id);
        ra.push({
          bth,
          do_tin: "khong_chac",
          ds_muc: [],
          ly_do:
            `Bản ghi đối tượng '${hoSo.ten}' nhưng revision head không có context sinh — ` +
            "không chứng minh được bản đã dùng hồ sơ. Kiểm tra tay.",
        });
      }
    }
  }
  return ra;
}

// --- Phát hiện ---

// Ghi detection + task trong một transaction. Idempotent theo UNIQUE
// (loai, den_revision_id) — gọi lại trên cùng revision mới trả về record đã
// có và chỉ bổ sung task cho bản thể hiện mới xuất hiện sau đó.
function ghiDetection(
  db: Database,
  loai: LoaiThayDoi,
  entityId: string,
  tu: string,
  den: string,
  dsThayDoi: MucThayDoi[],
  dsUngVien: UngVien[],
  tacGia: string,
): { thay_doi: ThayDoiNguon; ds_task: TaskSua[] } {
  return txn(db, () => {
    const ts = bayGio();
    const id = crypto.randomUUID();
    db.query(
      `INSERT OR IGNORE INTO thay_doi_nguon
         (id, loai, entity_id, tu_revision_id, den_revision_id, ds_thay_doi, tao_luc, tao_boi)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, loai, entityId, tu, den, JSON.stringify(dsThayDoi), ts, tacGia);
    const tdn = db
      .query("SELECT * FROM thay_doi_nguon WHERE loai = ? AND den_revision_id = ?")
      .get(loai, den) as DongThayDoi;
    const thayDoi = docThayDoi(tdn);
    const moiTao = thayDoi.id === id;
    if (moiTao) {
      ghiSuKien(db, "thay_doi_nguon", id, "phat_hien", { loai, entity_id: entityId }, tacGia);
      log.info("thay_doi.phat_hien", {
        loai,
        entity_id: entityId,
        so_muc: dsThayDoi.length,
        den_revision_id: den,
      });
    }

    const dsTask: TaskSua[] = [];
    for (const uv of dsUngVien) {
      // Bản đã xuất → task sửa tay: file/copy bên ngoài MAI không sửa được
      // và trang local đang phục vụ cần xuất bản lại. Chưa xuất → đề xuất
      // sinh lại trong MAI.
      const daXuatBan = danhSachXuatBan(db, uv.bth.id).length > 0;
      const loaiTask = daXuatBan ? "thu_cong" : "sinh_lai";
      const lyDo = daXuatBan
        ? `${uv.ly_do}. Đã có bản xuất bản — file/copy bên ngoài cần sửa và phát lại bằng tay.`
        : uv.ly_do;
      const taskId = crypto.randomUUID();
      const kq = db
        .query(
          `INSERT OR IGNORE INTO task_sua
             (id, thay_doi_nguon_id, ban_the_hien_id, loai, do_tin, ly_do, ds_muc,
              trang_thai, job_id, tao_luc, tao_boi, cap_nhat_luc)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'mo', NULL, ?, ?, ?)`,
        )
        .run(
          taskId,
          thayDoi.id,
          uv.bth.id,
          loaiTask,
          uv.do_tin,
          lyDo,
          JSON.stringify(uv.ds_muc),
          ts,
          tacGia,
          ts,
        );
      if (kq.changes > 0) {
        ghiSuKien(
          db,
          "task_sua",
          taskId,
          "tao",
          { thay_doi_nguon_id: thayDoi.id, ban_the_hien_id: uv.bth.id, loai: loaiTask, do_tin: uv.do_tin },
          tacGia,
        );
      }
      const task = db
        .query(
          "SELECT * FROM task_sua WHERE thay_doi_nguon_id = ? AND ban_the_hien_id = ?",
        )
        .get(thayDoi.id, uv.bth.id) as DongTask;
      dsTask.push(docTask(task));
    }
    return { thay_doi: thayDoi, ds_task: dsTask };
  });
}

// Phát hiện trên nguồn nội dung: diff head revision mới với revision trước
// đó (dua_tren_revision_id), rồi quét bản thể hiện phụ thuộc. Gọi sau mọi
// đường ghi revision nguồn mới; an toàn gọi lại nhiều lần.
export function phatHienThayDoiNguon(
  db: Database,
  nguonId: string,
  tacGia: string,
): { thay_doi: ThayDoiNguon | null; ds_task: TaskSua[] } {
  const nguon = layNguon(db, nguonId);
  if (!nguon || !nguon.head_revision_id) return { thay_doi: null, ds_task: [] };
  const den = layNguonRevision(db, nguon.head_revision_id);
  // Revision đầu tiên hoặc không có revision trước → chưa có gì phụ thuộc.
  if (!den || !den.dua_tren_revision_id) return { thay_doi: null, ds_task: [] };
  const tu = layNguonRevision(db, den.dua_tren_revision_id);
  if (!tu) return { thay_doi: null, ds_task: [] };

  // Đã xử lý revision này rồi → trả về record cũ + quét bù task cho bản
  // thể hiện mới xuất hiện sau lần xử lý trước.
  const co = db
    .query("SELECT * FROM thay_doi_nguon WHERE loai = 'nguon' AND den_revision_id = ?")
    .get(den.id) as DongThayDoi | null;
  if (co) {
    const thayDoi = docThayDoi(co);
    return txn(db, () => {
      const dsTask = boSungTaskChoQuet(
        db,
        thayDoi,
        quetBthTheoNguon(db, nguonId, den),
        tacGia,
      );
      return { thay_doi: thayDoi, ds_task: dsTask };
    });
  }

  const dsThayDoi = diffCacMuc(tu.cac_muc, den.cac_muc);
  if (dsThayDoi.length === 0 && tu.noi_dung !== den.noi_dung) {
    // cac_muc trùng nhau nhưng toàn văn đổi (sửa tay cac_muc không khớp) —
    // ghi một mục tổng để người dùng thấy có đổi.
    dsThayDoi.push({
      muc_id: null,
      loai_muc: "noi_dung",
      loai_thay_doi: "sua",
      tieu_de: "Toàn văn",
      cu: tu.noi_dung,
      moi: den.noi_dung,
    });
  }
  // Nội dung hệt nhau (PUT lặp) → không có thay đổi thật, không ghi detection.
  if (dsThayDoi.length === 0) return { thay_doi: null, ds_task: [] };

  return ghiDetection(
    db,
    "nguon",
    nguonId,
    tu.id,
    den.id,
    dsThayDoi,
    quetBthTheoNguon(db, nguonId, den),
    tacGia,
  );
}

// Bổ sung task cho các ứng viên của một detection đã tồn tại (chạy lại sau):
// chỉ tạo task mới, không đụng task đã xong/bỏ qua.
function boSungTaskChoQuet(
  db: Database,
  thayDoi: ThayDoiNguon,
  dsUngVien: UngVien[],
  tacGia: string,
): TaskSua[] {
  const ts = bayGio();
  const dsTask: TaskSua[] = [];
  for (const uv of dsUngVien) {
    const daXuatBan = danhSachXuatBan(db, uv.bth.id).length > 0;
    const loaiTask = daXuatBan ? "thu_cong" : "sinh_lai";
    const lyDo = daXuatBan
      ? `${uv.ly_do}. Đã có bản xuất bản — file/copy bên ngoài cần sửa và phát lại bằng tay.`
      : uv.ly_do;
    const taskId = crypto.randomUUID();
    const kq = db
      .query(
        `INSERT OR IGNORE INTO task_sua
           (id, thay_doi_nguon_id, ban_the_hien_id, loai, do_tin, ly_do, ds_muc,
            trang_thai, job_id, tao_luc, tao_boi, cap_nhat_luc)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'mo', NULL, ?, ?, ?)`,
      )
      .run(taskId, thayDoi.id, uv.bth.id, loaiTask, uv.do_tin, lyDo, JSON.stringify(uv.ds_muc), ts, tacGia, ts);
    if (kq.changes > 0) {
      ghiSuKien(
        db,
        "task_sua",
        taskId,
        "tao",
        { thay_doi_nguon_id: thayDoi.id, ban_the_hien_id: uv.bth.id, loai: loaiTask, do_tin: uv.do_tin },
        tacGia,
      );
    } else {
      // Task đã có (INSERT OR IGNORE) — cập nhật metadata cho task còn 'mo':
      // độ tin đổi giữa 2 lần quét, hoặc bản vừa xuất bản sau khi task tạo
      // (sinh_lai → thu_cong). Task đang làm/đã đóng giữ nguyên.
      db.query(
        `UPDATE task_sua SET loai = ?, do_tin = ?, ly_do = ?, ds_muc = ?, cap_nhat_luc = ?
         WHERE thay_doi_nguon_id = ? AND ban_the_hien_id = ? AND trang_thai = 'mo'`,
      ).run(loaiTask, uv.do_tin, lyDo, JSON.stringify(uv.ds_muc), bayGio(), thayDoi.id, uv.bth.id);
    }
    const task = db
      .query("SELECT * FROM task_sua WHERE thay_doi_nguon_id = ? AND ban_the_hien_id = ?")
      .get(thayDoi.id, uv.bth.id) as DongTask;
    dsTask.push(docTask(task));
  }
  return dsTask;
}

// Phát hiện trên hồ sơ thương hiệu/đối tượng: diff 2 revision mới nhất của
// hồ sơ, rồi quét bản thể hiện có context sinh ghim revision cũ.
export function phatHienThayDoiHoSo(
  db: Database,
  loai: "thuong_hieu" | "doi_tuong",
  hoSoId: string,
  tacGia: string,
): { thay_doi: ThayDoiNguon | null; ds_task: TaskSua[] } {
  const hoSo = loai === "thuong_hieu" ? layThuongHieu(db, hoSoId) : layDoiTuong(db, hoSoId);
  if (!hoSo) return { thay_doi: null, ds_task: [] };
  const dsRev = danhSachHoSoRevision(db, loai, hoSoId); // DESC so_thu_tu
  const den = dsRev[0];
  const tu = dsRev[1];
  if (!den || !tu) return { thay_doi: null, ds_task: [] };

  const co = db
    .query("SELECT * FROM thay_doi_nguon WHERE loai = ? AND den_revision_id = ?")
    .get(loai, den.id) as DongThayDoi | null;
  if (co) {
    const thayDoi = docThayDoi(co);
    return txn(db, () => {
      const dsTask = boSungTaskChoQuet(
        db,
        thayDoi,
        quetBthTheoHoSo(db, loai, hoSoId, den.id, thayDoi.ds_thay_doi),
        tacGia,
      );
      return { thay_doi: thayDoi, ds_task: dsTask };
    });
  }

  const dsThayDoi = diffSnapshotHoSo(JSON.parse(tu.snapshot), JSON.parse(den.snapshot));
  if (dsThayDoi.length === 0) return { thay_doi: null, ds_task: [] };

  return ghiDetection(
    db,
    loai,
    hoSoId,
    tu.id,
    den.id,
    dsThayDoi,
    quetBthTheoHoSo(db, loai, hoSoId, den.id, dsThayDoi),
    tacGia,
  );
}

// --- Đọc kèm tự động đóng ---

// Một task 'sinh_lai' tự đóng khi head revision của bản đã ghim nguồn mới
// (≥ revision đích của detection): sửa xong bằng đề xuất hay bằng tay đều
// tính. Task 'thu_cong' không bao giờ tự đóng — bản copy ngoài là việc tay.
function daSuaXong(db: Database, task: TaskSua, thayDoi: ThayDoiNguon): boolean {
  if (task.loai !== "sinh_lai") return false;
  const bth = layBanTheHien(db, task.ban_the_hien_id);
  if (!bth?.head_revision_id) return false;
  const head = layRevision(db, bth.head_revision_id);
  if (!head) return false;
  if (thayDoi.loai === "nguon") {
    const tdRev = head.thong_diep_revision_id
      ? layThongDiepRevision(db, head.thong_diep_revision_id)
      : null;
    if (!tdRev) return false;
    const denSo =
      (layNguonRevision(db, thayDoi.den_revision_id)?.so_thu_tu ?? 0);
    for (const nid of tdRev.nguon_revision_ids) {
      const nr = layNguonRevision(db, nid);
      if (nr && nr.nguon_id === thayDoi.entity_id && nr.so_thu_tu >= denSo) return true;
    }
    return false;
  }
  // thuong_hieu / doi_tuong: context sinh của head ghim revision hồ sơ ≥ đích.
  const cs = head.context_sinh_id ? layContextSinh(db, head.context_sinh_id) : null;
  if (!cs) return false;
  const pinnedRevId =
    thayDoi.loai === "thuong_hieu" ? cs.thuong_hieu_revision_id : cs.doi_tuong_revision_id;
  const cotId = thayDoi.loai === "thuong_hieu" ? cs.thuong_hieu_id : cs.doi_tuong_id;
  if (cotId !== thayDoi.entity_id || !pinnedRevId) return false;
  const pinned = db
    .query("SELECT so_thu_tu FROM ho_so_revision WHERE id = ?")
    .get(pinnedRevId) as { so_thu_tu: number } | null;
  const den = db
    .query("SELECT so_thu_tu FROM ho_so_revision WHERE id = ?")
    .get(thayDoi.den_revision_id) as { so_thu_tu: number } | null;
  return pinned !== null && den !== null && pinned.so_thu_tu >= den.so_thu_tu;
}

// Đọc + tự đóng task đã sửa xong. Chạy lười trong các hàm liệt kê để danh
// sách luôn phản ánh trạng thái thật sau khi user sửa xong bản.
export function dongTaskTuDong(db: Database, task: TaskSua): TaskSua {
  if (task.trang_thai !== "mo" && task.trang_thai !== "dang_lam") return task;
  const thayDoi = layThayDoi(db, task.thay_doi_nguon_id);
  if (!thayDoi || !daSuaXong(db, task, thayDoi)) return task;
  db.query("UPDATE task_sua SET trang_thai = 'xong', cap_nhat_luc = ? WHERE id = ?").run(
    bayGio(),
    task.id,
  );
  ghiSuKien(db, "task_sua", task.id, "tu_dong_xong", {}, "he_thong");
  return layTaskSua(db, task.id)!;
}

export function danhSachThayDoi(
  db: Database,
  loc: { loai?: string; entityId?: string; gioiHan?: number } = {},
): ThayDoiNguon[] {
  const wh: string[] = [];
  const thamSo: string[] = [];
  if (loc.loai) {
    wh.push("loai = ?");
    thamSo.push(loc.loai);
  }
  if (loc.entityId) {
    wh.push("entity_id = ?");
    thamSo.push(loc.entityId);
  }
  const sql =
    `SELECT * FROM thay_doi_nguon${wh.length ? ` WHERE ${wh.join(" AND ")}` : ""}` +
    " ORDER BY tao_luc DESC LIMIT ?";
  const rows = db.query(sql).all(...thamSo, loc.gioiHan ?? 50) as DongThayDoi[];
  return rows.map(docThayDoi);
}

export function danhSachTaskSua(
  db: Database,
  loc: { trangThai?: string[]; banTheHienId?: string; entityId?: string; gioiHan?: number } = {},
): TaskSua[] {
  const wh: string[] = [];
  const thamSo: string[] = [];
  if (loc.trangThai && loc.trangThai.length > 0) {
    wh.push(`t.trang_thai IN (${loc.trangThai.map(() => "?").join(",")})`);
    thamSo.push(...loc.trangThai);
  }
  if (loc.banTheHienId) {
    wh.push("t.ban_the_hien_id = ?");
    thamSo.push(loc.banTheHienId);
  }
  if (loc.entityId) {
    wh.push("d.entity_id = ?");
    thamSo.push(loc.entityId);
  }
  const sql =
    `SELECT t.* FROM task_sua t JOIN thay_doi_nguon d ON d.id = t.thay_doi_nguon_id` +
    `${wh.length ? ` WHERE ${wh.join(" AND ")}` : ""}` +
    " ORDER BY t.tao_luc DESC LIMIT ?";
  const rows = db.query(sql).all(...thamSo, loc.gioiHan ?? 100) as DongTask[];
  // Đọc qua dongTaskTuDong: task vừa được sửa xong tự đóng ngay trong list.
  return rows.map((r) => dongTaskTuDong(db, docTask(r)));
}

export function danhSachTaskCuaThayDoi(db: Database, thayDoiId: string): TaskSua[] {
  const rows = db
    .query("SELECT * FROM task_sua WHERE thay_doi_nguon_id = ? ORDER BY tao_luc")
    .all(thayDoiId) as DongTask[];
  return rows.map((r) => dongTaskTuDong(db, docTask(r)));
}

// --- Đề xuất sửa ---

// Đảm bảo revision head của thông điệp ghim head mới nhất của nguồn — job
// sinh lại đọc nguồn qua thong_diep_revision_id nên phải re-pin trước.
// Chỉ ghi revision thông điệp mới khi head hiện tại chưa ghim đúng.
export function damBaoThongDiepGhimNguonMoi(
  db: Database,
  thongDiepId: string,
  nguonId: string,
  tacGia: string,
): boolean {
  const td = layThongDiep(db, thongDiepId);
  const nguon = layNguon(db, nguonId);
  if (!td || !nguon?.head_revision_id) return false;
  const tdRev = td.head_revision_id ? layThongDiepRevision(db, td.head_revision_id) : null;
  const pinned = (tdRev?.nguon_revision_ids ?? [])
    .map((id) => layNguonRevision(db, id))
    .find((nr) => nr !== null && nr.nguon_id === nguonId);
  if (pinned && pinned.id === nguon.head_revision_id) return false;
  // Nguồn có thể đã bị gỡ link sau khi detection tạo — thêm lại để job sinh
  // lại vẫn hút được nguồn mới (link thật giữ nguyên, không mất).
  const nguonIds = danhSachNguonCuaThongDiep(db, td.id);
  if (!nguonIds.includes(nguonId)) nguonIds.push(nguonId);
  capNhatThongDiep(
    db,
    td.id,
    {
      tieu_de: td.tieu_de,
      noi_dung: td.noi_dung,
      campaign_id: td.campaign_id,
      nguon_ids: nguonIds,
    },
    td.head_revision_id ?? "",
    tacGia,
  );
  return true;
}

// Đề xuất sửa một task: re-pin thông điệp lên head nguồn mới (loại nguồn),
// rồi enqueue job sinh_ban_the_hien ghim đúng head hiện tại — kết quả đi qua
// luồng review #21 (revision tao_boi='job' hiện panel đề xuất AI), không ghi
// đè text người viết.
export function deXuatSuaTask(
  db: Database,
  taskId: string,
  tacGia: string,
): { task: TaskSua; job: Job; da_tao_job: boolean } {
  return txn(db, () => {
    const task = layTaskSua(db, taskId);
    if (!task) loiRequest(404, "KHONG_TIM_THAY", "Không tìm thấy task sửa.");
    if (task.trang_thai === "xong" || task.trang_thai === "bo_qua") {
      throw new LoiApi(409, "XUNG_DOT_TRANG_THAI", "Task đã đóng — mở lại trước khi đề xuất.");
    }
    const thayDoi = layThayDoi(db, task.thay_doi_nguon_id);
    const bth = layBanTheHien(db, task.ban_the_hien_id);
    if (!thayDoi || !bth) loiRequest(404, "KHONG_TIM_THAY", "Task trỏ tới dữ liệu đã xóa.");
    const td = layThongDiep(db, bth.thong_diep_id);
    if (!td) loiRequest(404, "KHONG_TIM_THAY", "Không tìm thấy thông điệp của bản.");

    if (thayDoi.loai === "nguon") {
      damBaoThongDiepGhimNguonMoi(db, td.id, thayDoi.entity_id, tacGia);
    }

    // Tái dùng context sinh đã ghim trên head revision — hồ sơ giữ nguyên
    // (với thay đổi hồ sơ, lắp lại sẽ lấy revision mới nhất tự động).
    // Revision tay không ghim context_sinh → mượn context của revision gần
    // nhất có; vẫn thiếu thì fallback entity của detection để job không bỏ
    // quên hồ sơ đã đổi.
    const head = bth.head_revision_id ? layRevision(db, bth.head_revision_id) : null;
    let cs = head?.context_sinh_id ? layContextSinh(db, head.context_sinh_id) : null;
    if (!cs) {
      const gan = db
        .query(
          `SELECT context_sinh_id FROM revision
           WHERE ban_the_hien_id = ? AND context_sinh_id IS NOT NULL
           ORDER BY so_thu_tu DESC LIMIT 1`,
        )
        .get(bth.id) as { context_sinh_id: string } | null;
      cs = gan ? layContextSinh(db, gan.context_sinh_id) : null;
    }
    let ghiDe: Record<string, unknown> = {};
    try {
      const j = JSON.parse(cs?.ghi_de ?? "{}") as unknown;
      if (typeof j === "object" && j !== null && !Array.isArray(j)) {
        ghiDe = j as Record<string, unknown>;
      }
    } catch {
      /* ghi_de hỏng → để trống */
    }
    const { job, da_tao } = enqueueJob(db, {
      loai: "sinh_ban_the_hien",
      payload: {
        ban_the_hien_id: bth.id,
        thong_diep_id: td.id,
        dinh_dang: bth.dinh_dang,
        ngon_ngu: bth.ngon_ngu,
        doi_tuong: bth.doi_tuong || undefined,
        doi_tuong_id:
          cs?.doi_tuong_id ??
          (thayDoi.loai === "doi_tuong" ? thayDoi.entity_id : undefined),
        thuong_hieu_id:
          cs?.thuong_hieu_id ??
          (thayDoi.loai === "thuong_hieu" ? thayDoi.entity_id : undefined),
        ghi_de: ghiDe,
        dich_den: bth.dich_den || undefined,
        campaign_id: td.campaign_id ?? undefined,
      },
      entityLoai: "ban_the_hien",
      entityId: bth.id,
      revisionId: bth.head_revision_id ?? null,
      khoaIdem: `sinh_ban_the_hien:${bth.id}`,
    });
    db.query(
      "UPDATE task_sua SET trang_thai = 'dang_lam', job_id = ?, cap_nhat_luc = ? WHERE id = ?",
    ).run(job.id, bayGio(), task.id);
    ghiSuKien(
      db,
      "task_sua",
      task.id,
      "de_xuat",
      { job_id: job.id, da_tao_job: da_tao },
      tacGia,
    );
    return { task: layTaskSua(db, task.id)!, job, da_tao_job: da_tao };
  });
}

// Chuyển trạng thái task bằng tay: mo | dang_lam | xong | bo_qua — mọi chuyển
// hợp lệ trong POC (user có thể mở lại task đã bỏ qua).
export function chuyenTrangThaiTask(
  db: Database,
  taskId: string,
  den: string,
  tacGia: string,
): TaskSua {
  return txn(db, () => {
    const task = layTaskSua(db, taskId);
    if (!task) loiRequest(404, "KHONG_TIM_THAY", "Không tìm thấy task sửa.");
    if (!(DANH_SACH_TRANG_THAI_TASK as readonly string[]).includes(den)) {
      loiRequest(
        400,
        "VALIDATION",
        `trang_thai không hợp lệ. Cho phép: ${DANH_SACH_TRANG_THAI_TASK.join(", ")}.`,
      );
    }
    if (task.trang_thai === den) return task;
    db.query("UPDATE task_sua SET trang_thai = ?, cap_nhat_luc = ? WHERE id = ?").run(
      den,
      bayGio(),
      task.id,
    );
    ghiSuKien(
      db,
      "task_sua",
      task.id,
      "trang_thai",
      { tu: task.trang_thai, den },
      tacGia,
    );
    return layTaskSua(db, task.id)!;
  });
}
