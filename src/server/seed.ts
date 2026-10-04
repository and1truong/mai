import type { Database } from "bun:sqlite";
import { taiCauHinh } from "../config.ts";
import { log } from "../log.ts";
import { chayMigration, moDb } from "./db.ts";

// Seed demo tối thiểu: 1 context, 1 nguồn, 1 bản thể hiện nháp (revision 1).
// Dùng id cố định + kiểm tra tồn tại → chạy lại nhiều lần được (idempotent).

export function seed(db: Database, tacGia = "demo"): { da_seed: string[] } {
  const daSeed: string[] = [];
  const ts = new Date().toISOString();

  if (!db.query("SELECT id FROM context WHERE id = 'context'").get()) {
    db.query(
      "INSERT INTO context (id, ten, doi_tuong, giong_noi, gia_tri, cap_nhat_luc, cap_nhat_boi) VALUES ('context', ?, ?, ?, ?, ?, ?)",
    ).run(
      "MAI Demo",
      "người dùng nội bộ",
      "rõ ràng, ngắn gọn",
      "độc lập, đơn giản, minh bạch",
      ts,
      tacGia,
    );
    daSeed.push("context");
  }

  if (!db.query("SELECT id FROM nguon WHERE id = 'seed-nguon-1'").get()) {
    db.query(
      "INSERT INTO nguon (id, tieu_de, noi_dung, loai, tao_luc, tao_boi, cap_nhat_luc) VALUES ('seed-nguon-1', ?, ?, 'van_ban', ?, ?, ?)",
    ).run(
      "Nguồn demo: giới thiệu MAI",
      [
        "MAI là nền tảng nội dung độc lập, deploy một gói duy nhất.",
        "Một instance sở hữu một thư viện nội dung.",
        "Chạy local với fixture AI, không cần credential.",
      ].join("\n"),
      ts,
      tacGia,
      ts,
    );
    daSeed.push("nguon");
  }

  if (!db.query("SELECT id FROM ban_the_hien WHERE id = 'seed-bth-1'").get()) {
    db.query(
      "INSERT INTO ban_the_hien (id, nguon_id, dinh_dang, doi_tuong, trang_thai, head_revision_id, tao_luc, tao_boi) VALUES ('seed-bth-1', 'seed-nguon-1', 'web', 'chung', 'nhap', NULL, ?, ?)",
    ).run(ts, tacGia);
    db.query(
      "INSERT INTO revision (id, ban_the_hien_id, so_thu_tu, noi_dung, dua_tren_revision_id, tao_luc, tao_boi) VALUES ('seed-rev-1', 'seed-bth-1', 1, ?, NULL, ?, ?)",
    ).run(
      [
        "# Nguồn demo: giới thiệu MAI",
        "",
        "- Kênh: web",
        "- Đối tượng: chung",
        "",
        "MAI là nền tảng nội dung độc lập, deploy một gói duy nhất. Một instance sở hữu một thư viện nội dung. Chạy local với fixture AI, không cần credential.",
      ].join("\n"),
      ts,
      tacGia,
    );
    db.query("UPDATE ban_the_hien SET head_revision_id = 'seed-rev-1' WHERE id = 'seed-bth-1'").run();
    daSeed.push("ban_the_hien");
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
