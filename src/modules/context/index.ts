import type { Database } from "bun:sqlite";

// Module context: thông tin thương hiệu/đối tượng áp cho mọi bản thể hiện.
// Một instance = một thư viện nội dung → context là một dòng duy nhất (id 'context').

export type Context = {
  id: string;
  ten: string;
  doi_tuong: string;
  giong_noi: string;
  gia_tri: string;
  cap_nhat_luc: string;
  cap_nhat_boi: string;
};

export const ID_CONTEXT = "context";

export function layContext(db: Database): Context | null {
  return (db.query("SELECT * FROM context WHERE id = ?").get(ID_CONTEXT) as Context | null) ?? null;
}

export function capNhatContext(
  db: Database,
  input: { ten: string; doi_tuong: string; giong_noi: string; gia_tri: string },
  tacGia: string,
): Context {
  const ts = new Date().toISOString();
  db.query(
    `INSERT INTO context (id, ten, doi_tuong, giong_noi, gia_tri, cap_nhat_luc, cap_nhat_boi)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET
       ten = excluded.ten,
       doi_tuong = excluded.doi_tuong,
       giong_noi = excluded.giong_noi,
       gia_tri = excluded.gia_tri,
       cap_nhat_luc = excluded.cap_nhat_luc,
       cap_nhat_boi = excluded.cap_nhat_boi`,
  ).run(ID_CONTEXT, input.ten, input.doi_tuong, input.giong_noi, input.gia_tri, ts, tacGia);
  return layContext(db)!;
}
