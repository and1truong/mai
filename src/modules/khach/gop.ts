// Ticket #67 (epic #59): merge hai person trùng an toàn.
//
// Nguyên tắc:
// - Merge là hành động TƯỜNG MINH qua API — không auto-merge.
// - All-or-nothing trong một transaction; không field nào bị discard âm
//   thầm — mọi khác biệt không chuyển được đều vào `xung_dot`.
// - Person nguồn giữ record (trang_thai='da_gop', gop_vao_id → đích) —
//   không DELETE; `diTroKhachGop` redirect đọc/ghi tiếp theo.
// - Không unmerge (giới hạn POC, ghi trong conventions).

import type { Database } from "bun:sqlite";
import { LoiApi } from "../../loi.ts";
import { ghiSuKien, txn } from "../content/index.ts";
import {
  capNhatDoiKhach,
  diTroKhachGop,
  layKhach,
  type Khach,
} from "./index.ts";

const bayGio = () => new Date().toISOString();

export type XungDotGop = {
  loai: "dinh_danh" | "dong_y" | "dau_cham_dau" | "truong_ho_so" | "tag";
  mo_ta: string;
  chi_tiet?: Record<string, unknown>;
};

export type KhachGop = {
  id: string;
  khach_nguon_id: string;
  khach_dich_id: string;
  xung_dot: XungDotGop[];
  luc: string;
  boi: string;
};

// Redirect đọc/ghi sau merge — cài trong index.ts (diTroKhachGop);
// API import gop.ts cho một chỗ.
export { diTroKhachGop };

function batBuocNguonDich(
  db: Database,
  nguonId: string,
  dichId: string,
): { nguon: Khach; dich: Khach } {
  const nguon = layKhach(db, nguonId);
  const dich = layKhach(db, dichId);
  // Không tồn tại → 404 (house style của các route khách khác);
  // lỗi nghiệp vụ (tự gộp, đã gộp) → 400.
  if (!nguon) {
    throw new LoiApi(404, "KHONG_TIM_THAY", `Không tìm thấy khách nguồn '${nguonId}'.`);
  }
  if (!dich) {
    throw new LoiApi(404, "KHONG_TIM_THAY", `Không tìm thấy vao_khach_id '${dichId}'.`);
  }
  const dsLoi: string[] = [];
  if (nguonId === dichId) dsLoi.push("không thể gộp person vào chính nó.");
  if (nguon && nguon.trang_thai === "da_gop") {
    dsLoi.push(`khách nguồn đã gộp vào '${nguon.gop_vao_id}'.`);
  }
  if (dich && dich.trang_thai === "da_gop") {
    dsLoi.push(`đích '${dichId}' đã gộp vào '${dich.gop_vao_id}' — gộp vào person cuối.`);
  }
  if (dsLoi.length) {
    throw new LoiApi(400, "VALIDATION", "Yêu cầu không hợp lệ.", { loi: dsLoi });
  }
  return { nguon: nguon!, dich: dich! };
}

// Detect mọi khác biệt không chuyển sạch được — dry-run và merge thật
// dùng chung hàm này để preview = đúng cái sẽ ghi vào audit.
export function phatHienXungDotGop(
  db: Database,
  nguon: Khach,
  dich: Khach,
): XungDotGop[] {
  const xd: XungDotGop[] = [];

  // Identity trùng (loai, gia_tri_chuan) ở cả hai → bản nguồn thừa, đích
  // đã có — ghi conflict thay vì discard lặng.
  const ddNguon = db
    .query("SELECT loai, gia_tri_chuan FROM dinh_danh WHERE khach_id = ?")
    .all(nguon.id) as { loai: string; gia_tri_chuan: string }[];
  for (const d of ddNguon) {
    const trung = db
      .query(
        "SELECT 1 FROM dinh_danh WHERE loai = ? AND gia_tri_chuan = ? AND khach_id = ?",
      )
      .get(d.loai, d.gia_tri_chuan, dich.id);
    if (trung) {
      xd.push({
        loai: "dinh_danh",
        mo_ta: `identity ${d.loai}='${d.gia_tri_chuan}' đã có ở đích — bản nguồn bỏ.`,
        chi_tiet: { loai: d.loai, gia_tri_chuan: d.gia_tri_chuan },
      });
    }
  }

  // Consent cùng (kenh, muc_dich) khác trang_thai → mới hơn thắng.
  const dyNguon = db
    .query(
      "SELECT kenh, muc_dich, trang_thai, nguon, cap_nhat_luc FROM dong_y WHERE khach_id = ?",
    )
    .all(nguon.id) as {
    kenh: string;
    muc_dich: string;
    trang_thai: string;
    nguon: string;
    cap_nhat_luc: string;
  }[];
  for (const y of dyNguon) {
    const dyDich = db
      .query(
        "SELECT trang_thai, nguon, cap_nhat_luc FROM dong_y WHERE khach_id = ? AND kenh = ? AND muc_dich = ?",
      )
      .get(dich.id, y.kenh, y.muc_dich) as
      | { trang_thai: string; nguon: string; cap_nhat_luc: string }
      | null;
    if (dyDich) {
      const nguonMoiHon = y.cap_nhat_luc > dyDich.cap_nhat_luc;
      // Conflict khi đích bị thay đổi: trạng thái khác (một chiều nào đó
      // thắng), hoặc nguồn mới hơn và ghi đè provenance `nguon` khác.
      if (dyDich.trang_thai !== y.trang_thai || (nguonMoiHon && dyDich.nguon !== y.nguon)) {
        const giu = nguonMoiHon ? "nguon" : "dich";
        xd.push({
          loai: "dong_y",
          mo_ta: `consent ${y.kenh}/${y.muc_dich}: nguồn '${y.trang_thai}' (${y.cap_nhat_luc}) vs đích '${dyDich.trang_thai}' (${dyDich.cap_nhat_luc}) — giữ bản mới hơn (${giu}).`,
          chi_tiet: {
            kenh: y.kenh,
            muc_dich: y.muc_dich,
            nguon: { trang_thai: y.trang_thai, nguon: y.nguon, cap_nhat_luc: y.cap_nhat_luc },
            dich: dyDich,
            giu,
          },
        });
      }
    }
  }

  // first_touch: cả hai có chạm đầu → đích giữ cái SỚM hơn; bản thua ghi
  // conflict (không discard lặng).
  const dcNguon = db
    .query("SELECT tuong_tac_id, xay_ra_luc FROM dau_cham_dau WHERE khach_id = ?")
    .get(nguon.id) as { tuong_tac_id: string; xay_ra_luc: string } | null;
  const dcDich = db
    .query("SELECT tuong_tac_id, xay_ra_luc FROM dau_cham_dau WHERE khach_id = ?")
    .get(dich.id) as { tuong_tac_id: string; xay_ra_luc: string } | null;
  if (dcNguon && dcDich) {
    const giu = dcNguon.xay_ra_luc < dcDich.xay_ra_luc ? "nguon" : "dich";
    xd.push({
      loai: "dau_cham_dau",
      mo_ta: `hai person đều có first_touch — giữ mốc sớm hơn (${giu}: ${giu === "nguon" ? dcNguon.xay_ra_luc : dcDich.xay_ra_luc}).`,
      chi_tiet: { nguon: dcNguon, dich: dcDich, giu },
    });
  }

  // Tag: đích đã có cùng tag → metadata (nguon, tao_luc) của nguồn bị
  // bỏ — ghi conflict thay vì nuốt lặng.
  const tagNguon = db
    .query("SELECT tag, nguon, tao_luc FROM khach_tag WHERE khach_id = ?")
    .all(nguon.id) as { tag: string; nguon: string; tao_luc: string }[];
  for (const t of tagNguon) {
    const tagDich = db
      .query("SELECT nguon, tao_luc FROM khach_tag WHERE khach_id = ? AND tag = ?")
      .get(dich.id, t.tag) as { nguon: string; tao_luc: string } | null;
    if (tagDich && (tagDich.nguon !== t.nguon || tagDich.tao_luc !== t.tao_luc)) {
      xd.push({
        loai: "tag",
        mo_ta: `tag '${t.tag}' đã có ở đích — giữ metadata đích (nguon='${tagDich.nguon}'), bỏ bản nguồn (nguon='${t.nguon}').`,
        chi_tiet: { tag: t.tag, nguon: { nguon: t.nguon, tao_luc: t.tao_luc }, dich: tagDich },
      });
    }
  }

  // Field profile: đích giữ giá trị của mình; nguồn có giá trị khác đích
  // (và đích không rỗng) → conflict, không ghi đè.
  for (const f of ["ten", "email", "sdt"] as const) {
    const vn = nguon[f];
    const vd = dich[f];
    if (vn && vd && vn !== vd) {
      xd.push({
        loai: "truong_ho_so",
        mo_ta: `field '${f}': đích giữ '${vd}', nguồn có '${vn}' không chuyển.`,
        chi_tiet: { truong: f, nguon: vn, dich: vd },
      });
    }
  }
  return xd;
}

// Merge nguồn VÀO đích. xem_truoc → chỉ trả conflict, không ghi gì.
export function gopKhach(
  db: Database,
  nguonId: string,
  dichId: string,
  opt: { xemTruoc?: boolean; duaTren?: string },
  actor: string,
): { khach_nguon: Khach; khach_dich: Khach; xung_dot: XungDotGop[]; xem_truoc: boolean } {
  const { nguon, dich } = batBuocNguonDich(db, nguonId, dichId);
  const xungDot = phatHienXungDotGop(db, nguon, dich);
  if (opt.xemTruoc) {
    return {
      khach_nguon: nguon,
      khach_dich: dich,
      xung_dot: xungDot,
      xem_truoc: true,
    };
  }
  const luc = bayGio();
  return txn(db, () => {
    // --- Chuyển toàn bộ quan hệ một chiều trước ---
    // Identity: trùng khóa ở đích → bỏ bản nguồn; còn lại re-point.
    const ddTrung = xungDot
      .filter((x) => x.loai === "dinh_danh")
      .map((x) => x.chi_tiet!) as { loai: string; gia_tri_chuan: string }[];
    for (const d of ddTrung) {
      db.query(
        "DELETE FROM dinh_danh WHERE khach_id = ? AND loai = ? AND gia_tri_chuan = ?",
      ).run(nguon.id, d.loai, d.gia_tri_chuan);
    }
    db.query("UPDATE dinh_danh SET khach_id = ? WHERE khach_id = ?").run(
      dich.id,
      nguon.id,
    );
    db.query("UPDATE tuong_tac SET khach_id = ? WHERE khach_id = ?").run(
      dich.id,
      nguon.id,
    );
    db.query("UPDATE chuyen_doi SET khach_id = ? WHERE khach_id = ?").run(
      dich.id,
      nguon.id,
    );
    db.query("UPDATE quy_ve SET khach_id = ? WHERE khach_id = ?").run(
      dich.id,
      nguon.id,
    );
    // dong_y_log giữ nguyên lịch sử — chỉ re-point chủ sở hữu.
    db.query("UPDATE dong_y_log SET khach_id = ? WHERE khach_id = ?").run(
      dich.id,
      nguon.id,
    );

    // --- Consent: cùng (kenh,muc_dich) khác state → mới hơn thắng ---
    const dyNguon = db
      .query("SELECT * FROM dong_y WHERE khach_id = ?")
      .all(nguon.id) as {
      id: string;
      kenh: string;
      muc_dich: string;
      trang_thai: string;
      nguon: string;
      cap_nhat_luc: string;
    }[];
    for (const y of dyNguon) {
      const dyDich = db
        .query(
          "SELECT * FROM dong_y WHERE khach_id = ? AND kenh = ? AND muc_dich = ?",
        )
        .get(dich.id, y.kenh, y.muc_dich) as { trang_thai: string; cap_nhat_luc: string } | null;
      if (!dyDich) {
        db.query("UPDATE dong_y SET khach_id = ? WHERE id = ?").run(dich.id, y.id);
      } else if (y.cap_nhat_luc > dyDich.cap_nhat_luc) {
        // Nguồn mới hơn → đích nhận state nguồn, xóa bản nguồn thừa.
        // Log transition của ĐÍCH lúc merge (nguon='gop') — lich_su đích
        // tự đủ audit, không chỉ log re-point của nguồn.
        db.query(
          "UPDATE dong_y SET trang_thai = ?, nguon = ?, cap_nhat_luc = ? WHERE khach_id = ? AND kenh = ? AND muc_dich = ?",
        ).run(y.trang_thai, y.nguon, y.cap_nhat_luc, dich.id, y.kenh, y.muc_dich);
        if (dyDich.trang_thai !== y.trang_thai) {
          db.query(
            `INSERT INTO dong_y_log (id, khach_id, kenh, muc_dich, tu_trang_thai, sang_trang_thai, nguon, luc)
             VALUES (?, ?, ?, ?, ?, ?, 'gop', ?)`,
          ).run(
            crypto.randomUUID(),
            dich.id,
            y.kenh,
            y.muc_dich,
            dyDich.trang_thai,
            y.trang_thai,
            luc,
          );
        }
        db.query("DELETE FROM dong_y WHERE id = ?").run(y.id);
      } else {
        db.query("DELETE FROM dong_y WHERE id = ?").run(y.id);
      }
    }

    // --- Tag: re-point, giữ nguon của đích khi tag đã có ---
    const tagNguon = db
      .query("SELECT tag, nguon, tao_luc FROM khach_tag WHERE khach_id = ?")
      .all(nguon.id) as { tag: string; nguon: string; tao_luc: string }[];
    for (const t of tagNguon) {
      db.query(
        "INSERT OR IGNORE INTO khach_tag (khach_id, tag, nguon, tao_luc) VALUES (?, ?, ?, ?)",
      ).run(dich.id, t.tag, t.nguon, t.tao_luc);
    }
    db.query("DELETE FROM khach_tag WHERE khach_id = ?").run(nguon.id);

    // --- first_touch: đích giữ mốc sớm hơn ---
    const dcNguon = db
      .query("SELECT * FROM dau_cham_dau WHERE khach_id = ?")
      .get(nguon.id) as { xay_ra_luc: string } | null;
    const dcDich = db
      .query("SELECT * FROM dau_cham_dau WHERE khach_id = ?")
      .get(dich.id) as { xay_ra_luc: string } | null;
    if (dcNguon && !dcDich) {
      db.query("UPDATE dau_cham_dau SET khach_id = ? WHERE khach_id = ?").run(
        dich.id,
        nguon.id,
      );
    } else if (dcNguon && dcDich && dcNguon.xay_ra_luc < dcDich.xay_ra_luc) {
      // Nguồn chạm sớm hơn → đích nhận bản ghi nguồn (row nguồn thắng).
      db.query("DELETE FROM dau_cham_dau WHERE khach_id = ?").run(dich.id);
      db.query("UPDATE dau_cham_dau SET khach_id = ? WHERE khach_id = ?").run(
        dich.id,
        nguon.id,
      );
    } else if (dcNguon) {
      db.query("DELETE FROM dau_cham_dau WHERE khach_id = ?").run(nguon.id);
    }

    // --- Field profile: chỉ lấp vào chỗ trống của đích ---
    const ten = dich.ten || nguon.ten;
    const email = dich.email || nguon.email;
    const sdt = dich.sdt || nguon.sdt;
    const lanDau = nguon.lan_dau_thay < dich.lan_dau_thay ? nguon.lan_dau_thay : dich.lan_dau_thay;
    const lanCuoi = nguon.lan_cuoi_thay > dich.lan_cuoi_thay ? nguon.lan_cuoi_thay : dich.lan_cuoi_thay;
    db.query(
      "UPDATE khach SET ten = ?, email = ?, sdt = ?, lan_dau_thay = ?, lan_cuoi_thay = ? WHERE id = ?",
    ).run(ten, email, sdt, lanDau, lanCuoi, dich.id);

    // --- Person nguồn thành bản ghi đã gộp + redirect ---
    db.query(
      "UPDATE khach SET trang_thai = 'da_gop', gop_vao_id = ? WHERE id = ?",
    ).run(dich.id, nguon.id);

    // Audit: một dòng khach_gop + su_kien hai đầu.
    db.query(
      "INSERT INTO khach_gop (id, khach_nguon_id, khach_dich_id, xung_dot, luc, boi) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(
      crypto.randomUUID(),
      nguon.id,
      dich.id,
      JSON.stringify(xungDot),
      luc,
      actor,
    );
    ghiSuKien(db, "khach", nguon.id, "da_gop_vao", {
      vao: dich.id,
      so_xung_dot: xungDot.length,
      dua_tren: opt.duaTren ?? "",
    }, actor);
    ghiSuKien(db, "khach", dich.id, "nhan_gop", {
      tu: nguon.id,
      so_xung_dot: xungDot.length,
    }, actor);

    // Lifecycle đích tính lại trên toàn bộ lịch sử đã gộp.
    capNhatDoiKhach(db, dich.id, luc);

    return {
      khach_nguon: layKhach(db, nguon.id)!,
      khach_dich: layKhach(db, dich.id)!,
      xung_dot: xungDot,
      xem_truoc: false,
    };
  });
}

export function danhSachGop(
  db: Database,
  khachId: string,
): KhachGop[] {
  return (
    db
      .query(
        "SELECT * FROM khach_gop WHERE khach_nguon_id = ? OR khach_dich_id = ? ORDER BY luc",
      )
      .all(khachId, khachId) as (Omit<KhachGop, "xung_dot"> & { xung_dot: string })[]
  ).map((r) => ({ ...r, xung_dot: JSON.parse(r.xung_dot) as XungDotGop[] }));
}
