import { describe, expect, test } from "bun:test";
import { taoServerTam } from "./helpers.ts";
import {
  DANH_SACH_DINH_DANG,
  docNoiDung,
  kiemTraNoiDung,
  layDinhDang,
  renderHtml,
  renderMarkdown,
  renderText,
} from "../src/modules/formats/index.ts";
import { taoZip } from "../src/modules/formats/zip.ts";

// Test #19: registry định dạng có phiên bản, validation theo schema,
// render an toàn (markdown/text/HTML), xem trước qua API và bundle
// export deterministic chỉ gồm asset được chọn.

type App = Awaited<ReturnType<typeof taoServerTam>>;

function post(app: App, path: string, body: unknown, method = "POST") {
  return fetch(`${app.url}${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function getJson(app: App, path: string) {
  return (await fetch(`${app.url}${path}`)).json();
}

// Parser tối thiểu cho ZIP STORE của module zip.ts (không nén).
function docTepZip(buf: Uint8Array): Map<string, Uint8Array> {
  const ra = new Map<string, Uint8Array>();
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let p = 0;
  while (p + 4 <= v.byteLength && v.getUint32(p, true) === 0x04034b50) {
    const tenLen = v.getUint16(p + 26, true);
    const extLen = v.getUint16(p + 28, true);
    const n = v.getUint32(p + 18, true);
    const ten = new TextDecoder().decode(buf.subarray(p + 30, p + 30 + tenLen));
    const batDau = p + 30 + tenLen + extLen;
    ra.set(ten, buf.subarray(batDau, batDau + n));
    p = batDau + n;
  }
  return ra;
}

const JSON_BAI_VIET = JSON.stringify({
  tieu_de: "Bài viết tiếng Việt — ký tự đặc biệt: ồ à ể",
  noi_dung:
    "Đoạn một tiếng Việt. [Liên kết](https://example.com/vn).\n\n" +
    "Đoạn hai English paragraph with **bold** text.",
});

describe("registry định dạng (#19)", () => {
  test("đủ định dạng ban đầu, mỗi cái có phiên bản + schema trường + ngôn ngữ", () => {
    expect([...DANH_SACH_DINH_DANG].sort()).toEqual(
      ["bai-viet", "caption", "faq", "newsletter", "script-dai", "script-ngan", "thread"].sort(),
    );
    for (const id of DANH_SACH_DINH_DANG) {
      const def = layDinhDang(id)!;
      expect(def.phien_ban).toBeGreaterThanOrEqual(1);
      expect(def.truong.length).toBeGreaterThan(0);
      expect(def.ngon_ngu).toEqual(["vi", "en"]);
      // Field bắt buộc có sẵn để validate — script/newsletter/caption v.v.
      expect(def.truong.some((t) => t.bat_buoc)).toBe(true);
    }
  });

  test("kiểm lỗi trường: thiếu bắt buộc, vượt độ dài, vượt số mục, trường lạ", () => {
    const caption = layDinhDang("caption")!;
    const loi = kiemTraNoiDung(caption, JSON.stringify({}));
    expect(loi.some((l) => l.truong === "noi_dung" && l.loi.includes("bắt buộc"))).toBe(true);

    const quaDai = kiemTraNoiDung(caption, JSON.stringify({ noi_dung: "x".repeat(2300) }));
    expect(quaDai.some((l) => l.truong === "noi_dung" && l.loi.includes("2200"))).toBe(true);

    const thread = layDinhDang("thread")!;
    const rong = kiemTraNoiDung(thread, JSON.stringify({ cac_muc: [] }));
    expect(rong.some((l) => l.truong === "cac_muc")).toBe(true);
    const nhieu = kiemTraNoiDung(
      thread,
      JSON.stringify({ cac_muc: Array(26).fill("mục") }),
    );
    expect(nhieu.some((l) => l.loi.includes("25"))).toBe(true);
    const quaDaiMuc = kiemTraNoiDung(
      thread,
      JSON.stringify({ cac_muc: ["x".repeat(600)] }),
    );
    expect(quaDaiMuc.some((l) => l.loi.includes("500"))).toBe(true);

    const la = kiemTraNoiDung(caption, JSON.stringify({ noi_dung: "ok", truong_la: "?" }));
    expect(la.some((l) => l.truong === "truong_la" && l.loi.includes("không nằm trong schema"))).toBe(
      true,
    );
  });

  test("docNoiDung: plaintext provider map vào 'noi_dung', định dạng không có → '_tho'", () => {
    const bv = layDinhDang("bai-viet")!;
    expect(docNoiDung(bv, "# Tiêu đề\nNội dung markdown")).toEqual({
      noi_dung: "# Tiêu đề\nNội dung markdown",
    });
    const th = layDinhDang("thread")!;
    expect(docNoiDung(th, "văn bản thường")["_tho"]).toBe("văn bản thường");
    // '_tho' báo warning validation để người viết biết phải sửa theo schema.
    expect(kiemTraNoiDung(th, "văn bản thường").some((l) => l.truong === "_tho")).toBe(true);
  });
});

describe("render (#19)", () => {
  test("VI/EN giữ Unicode, cấu trúc đoạn và link; kết quả deterministic không cần LLM", () => {
    const def = layDinhDang("bai-viet")!;
    const md1 = renderMarkdown(def, JSON_BAI_VIET);
    const md2 = renderMarkdown(def, JSON_BAI_VIET);
    expect(md1).toBe(md2); // deterministic từ fixture
    expect(md1).toContain("ký tự đặc biệt");
    expect(md1).toContain("Đoạn hai English paragraph");
    expect(md1).toContain("[Liên kết](https://example.com/vn)");
    expect(md1).toContain("\n\n"); // giữ cấu trúc đoạn

    const html = renderHtml(def, JSON_BAI_VIET);
    expect(html).toContain('href="https://example.com/vn"');
    expect(html).toContain("<h1>");
    expect(html).toContain("<strong>bold</strong>");

    const txt = renderText(def, JSON_BAI_VIET);
    expect(txt).toContain("Liên kết");
    expect(txt).not.toContain("**");
  });

  test("nội dung không tin cẩn bị escape/sanh trong HTML", () => {
    const def = layDinhDang("bai-viet")!;
    const doc = JSON.stringify({
      noi_dung:
        'Chữ <script>alert("x")</script> sau.\n\n' +
        '[bấm](javascript:alert(1)) và [ok](https://a.b).\n\n' +
        '<img src="x" onerror="alert(2)">',
    });
    const html = renderHtml(def, doc);
    // Không tag thật: script/img bị escape thành text, link javascript: không
    // tạo href — chuỗi vẫn hiện dạng text nhưng trơ (inert), không chạy được.
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img");
    expect(html).not.toContain('href="javascript:');
    expect(html).not.toContain('onerror="');
    expect(html).toContain('href="https://a.b"');
    // Nội dung script vẫn hiện dạng text đã escape, không thiếu chữ.
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("zip deterministic", () => {
  test("cùng input → cùng byte, cấu trúc ZIP hợp lệ", () => {
    const enc = new TextEncoder();
    const ds = [
      { duong_dan: "noi-dung.md", noi_dung: enc.encode("nội dung — unicode") },
      { duong_dan: "assets/a.png", noi_dung: new Uint8Array([1, 2, 3]) },
    ];
    const z1 = taoZip(ds);
    const z2 = taoZip([...ds].reverse()); // thứ tự vào khác → byte ra vẫn giống (sort)
    expect(z1).toEqual(z2);
    // Signature local file header.
    expect(z1[0]).toBe(0x50); // 'P'
    expect(z1[1]).toBe(0x4b); // 'K'
    const tep = docTepZip(z1);
    expect(new TextDecoder().decode(tep.get("noi-dung.md"))).toBe("nội dung — unicode");
    expect([...(tep.get("assets/a.png") ?? [])]).toEqual([1, 2, 3]);
  });
});

describe("API xem trước + export (#19)", () => {
  test("GET /api/dinh-dang trả def đầy đủ; :id 404 khi lạ", async () => {
    const app = await taoServerTam();
    try {
      const ds = await getJson(app, "/api/dinh-dang");
      expect(ds.ok).toBe(true);
      expect(ds.du_lieu.map((d: { id: string }) => d.id).sort()).toEqual(
        [...DANH_SACH_DINH_DANG].sort(),
      );
      const def = await getJson(app, "/api/dinh-dang/thread");
      expect(def.du_lieu.truong.some((t: { ten: string }) => t.ten === "cac_muc")).toBe(true);
      const miss = await fetch(`${app.url}/api/dinh-dang/khong-co`);
      expect(miss.status).toBe(404);
    } finally {
      await app.dong();
    }
  });

  test("validate định dạng + ngôn ngữ khi tạo bản thể hiện và enqueue job", async () => {
    const app = await taoServerTam();
    try {
      const td = await post(app, "/api/thong-diep", { tieu_de: "TD" });
      const tdId = (await td.json()).du_lieu.id;

      const saiDd = await post(app, "/api/ban-the-hien", {
        thong_diep_id: tdId,
        dinh_dang: "khong-co",
      });
      expect(saiDd.status).toBe(400);
      expect((await saiDd.json()).loi.ma).toBe("VALIDATION");

      const saiNn = await post(app, "/api/ban-the-hien", {
        thong_diep_id: tdId,
        dinh_dang: "bai-viet",
        ngon_ngu: "jp",
      });
      expect(saiNn.status).toBe(400);

      const job = await post(app, "/api/job", {
        loai: "sinh_ban_the_hien",
        payload: { thong_diep_id: tdId, dinh_dang: "faq", ngon_ngu: "fr" },
      });
      expect(job.status).toBe(400);

      // Hợp lệ → 201 và phien_ban_dinh_dang ghim phiên bản registry.
      const ok_ = await post(app, "/api/ban-the-hien", {
        thong_diep_id: tdId,
        dinh_dang: "faq",
        ngon_ngu: "en",
      });
      expect(ok_.status).toBe(201);
      const bth = (await ok_.json()).du_lieu;
      expect(bth.phien_ban_dinh_dang).toBe(1);
    } finally {
      await app.dong();
    }
  });

  test("xem trước render đúng revision ghim, báo lỗi field; bundle deterministic + chỉ asset được chọn", async () => {
    const app = await taoServerTam();
    try {
      const td = await post(app, "/api/thong-diep", { tieu_de: "Bài viết demo" });
      const tdId = (await td.json()).du_lieu.id;
      const bthRes = await post(app, "/api/ban-the-hien", {
        thong_diep_id: tdId,
        dinh_dang: "bai-viet",
      });
      const bth = (await bthRes.json()).du_lieu;

      // Revision thiếu required: POST trả ds_loi_dinh_dang cụ thể (#19).
      const thieu = await post(app, `/api/ban-the-hien/${bth.id}/revision`, {
        noi_dung: JSON.stringify({ tieu_de: "Chỉ có tiêu đề" }),
      });
      const thieuRev = (await thieu.json()).du_lieu;
      expect(
        thieuRev.ds_loi_dinh_dang.some(
          (l: { truong: string }) => l.truong === "noi_dung",
        ),
      ).toBe(true);

      // Revision đủ field → preview render được, ds_loi rỗng.
      const rev = await post(app, `/api/ban-the-hien/${bth.id}/revision`, {
        noi_dung: JSON_BAI_VIET,
        dua_tren_revision_id: thieuRev.id,
      });
      const revId = (await rev.json()).du_lieu.id;

      const xt = await getJson(app, `/api/ban-the-hien/${bth.id}/xem-truoc`);
      expect(xt.du_lieu.revision_id).toBe(revId); // mặc định head
      expect(xt.du_lieu.html).toContain("ký tự đặc biệt");
      expect(xt.du_lieu.ds_loi).toHaveLength(0);
      const xt1 = await getJson(
        app,
        `/api/ban-the-hien/${bth.id}/xem-truoc?revision_id=${thieuRev.id}`,
      );
      expect(xt1.du_lieu.ds_loi.length).toBeGreaterThan(0);
      const xtSai = await fetch(`${app.url}/api/ban-the-hien/${bth.id}/xem-truoc?revision_id=khong-co`);
      expect(xtSai.status).toBe(404);

      // Asset: một cái được đính kèm, một cái không — bundle chỉ có cái được chọn.
      const anh = await fetch(`${app.url}/api/assets?ten=anh-chon.png`, {
        method: "POST",
        body: new Uint8Array([9, 8, 7]),
      });
      const anhId = (await anh.json()).du_lieu.id;
      const anhKhac = await fetch(`${app.url}/api/assets?ten=anh-khac.png`, {
        method: "POST",
        body: new Uint8Array([1, 1, 1]),
      });
      expect(anhKhac.status).toBe(201);
      await post(app, `/api/ban-the-hien/${bth.id}/assets`, { asset_ids: [anhId] }, "PUT");

      // Xuất bản kèm ghi chú nội bộ — không được lọt vào bundle.
      const xb = await post(app, `/api/ban-the-hien/${bth.id}/xuat-ban`, {
        dich_den: "web",
        ghi_chu: "ghi chú nội bộ không export",
      });
      expect(xb.status).toBe(201);
      const xbId = (await xb.json()).du_lieu.id;

      const tai = await fetch(`${app.url}/api/ban-the-hien/${bth.id}/xuat-ban/${xbId}/tai-ve`);
      expect(tai.status).toBe(200);
      expect(tai.headers.get("content-type")).toBe("application/zip");
      const byte1 = new Uint8Array(await tai.arrayBuffer());
      const tai2 = await fetch(`${app.url}/api/ban-the-hien/${bth.id}/xuat-ban/${xbId}/tai-ve`);
      const byte2 = new Uint8Array(await tai2.arrayBuffer());
      expect(byte1).toEqual(byte2); // deterministic

      const tep = docTepZip(byte1);
      const manifest = JSON.parse(new TextDecoder().decode(tep.get("manifest.json")!));
      expect(manifest.dinh_dang.id).toBe("bai-viet");
      expect(manifest.dinh_dang.phien_ban).toBe(1);
      expect(manifest.revision.id).toBe(revId); // đúng revision đã duyệt/xu���t bản
      expect(manifest.assets.map((a: { ten_file: string }) => a.ten_file)).toEqual([
        "anh-chon.png",
      ]);
      expect(manifest.nguon).toEqual([]);
      // Nội dung render từ revision ghim, không qua AI.
      const md = new TextDecoder().decode(tep.get("noi-dung.md")!);
      expect(md).toContain("# Bài viết tiếng Việt"); // render theo schema, không phải JSON thô
      expect(md.startsWith("{")).toBe(false);
      expect(md).toContain("Đoạn hai English paragraph");
      const html = new TextDecoder().decode(tep.get("noi-dung.html")!);
      expect(html).toContain("<h1>");
      expect(html).toContain('href="https://example.com/vn"');
      // Asset được chọn có byte; asset khác và ghi chú nội bộ không lọt vào.
      expect([...(tep.get("assets/anh-chon.png") ?? [])]).toEqual([9, 8, 7]);
      expect(tep.has("assets/anh-khac.png")).toBe(false);
      for (const [ten, d] of tep) {
        expect(new TextDecoder().decode(d)).not.toContain("ghi chú nội bộ");
        expect(ten).not.toContain("ghi-chu");
      }
    } finally {
      await app.dong();
    }
  });
});
