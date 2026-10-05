import { kiemTraNoiDung } from "../formats/index.ts";
import type { ContextTask, KetQuaTask } from "./index.ts";

// Kiểm chứng đầu ra sinh (#20). Hai mức:
// - loi_cung: schema định dạng vi phạm hoặc claim bị cấm → repair có biên
//   rồi fail vĩnh viễn. Schema hợp lệ một mình KHÔNG chứng minh đúng sự thật.
// - canh_bao: trích dẫn không resolve tới nguồn đã đưa vào, thuật ngữ giữ
//   nguyên bị bỏ sót → đưa ra review thay vì chặn.
export type KetQuaKiemTra = {
  hop_le: boolean;
  loi_cung: string[];
  canh_bao: string[];
};

export function kiemTraDauRa(ctx: ContextTask, kq: KetQuaTask): KetQuaKiemTra {
  const loiCung: string[] = [];
  const canhBao: string[] = [...kq.canh_bao];

  // Schema định dạng — lỗi cứng vì đầu ra không lưu được dạng canonical.
  if (ctx.dinh_dang) {
    for (const l of kiemTraNoiDung(ctx.dinh_dang, kq.noi_dung)) {
      // Nội dung không-JSON fallback '_tho' cũng là vi phạm: provider phải
      // trả canonical JSON theo schema.
      loiCung.push(`${l.truong}: ${l.loi}`);
    }
  }

  // Claim bị cấm của thương hiệu: lỗi biên tập nghiêm → lỗi cứng.
  for (const c of ctx.context_sinh?.thuong_hieu?.claim_cam ?? []) {
    if (c && kq.noi_dung.includes(c)) {
      loiCung.push(`Đầu ra chứa claim bị cấm: "${c.slice(0, 80)}".`);
    }
  }

  // Trích dẫn chỉ hợp lệ khi resolve tới revision nguồn ĐÃ đưa vào context —
  // id bịa hay trỏ nguồn ngoài context → cảnh báo review, không phải "đúng".
  const nguonDaDua = new Set(ctx.ds_nguon.map((n) => n.revision_id));
  const bia = new Set<string>();
  for (const t of kq.trich_dan) {
    if (!nguonDaDua.has(t.nguon_revision_id)) bia.add(t.nguon_revision_id);
  }
  if (bia.size > 0) {
    canhBao.push(`Trích dẫn không khớp nguồn đã đưa vào context: ${[...bia].join(", ")}.`);
  }

  // Thuật ngữ giữ nguyên: chỉ cảnh báo khi từ có trong input mà đầu ra bỏ —
  // không yêu cầu xuất hiện bất kể ngữ cảnh.
  const vanBanDauVao = [ctx.thong_diep.noi_dung, ...ctx.ds_nguon.map((n) => n.noi_dung)].join("\n");
  for (const t of ctx.context_sinh?.thuong_hieu?.thuat_ngu ?? []) {
    if (t.giu_nguyen && t.thuat_ngu && vanBanDauVao.includes(t.thuat_ngu) && !kq.noi_dung.includes(t.thuat_ngu)) {
      canhBao.push(`Thuật ngữ giữ nguyên '${t.thuat_ngu}' có trong nguồn nhưng không có trong đầu ra.`);
    }
  }

  // Bản phát hành (#9): giới hạn phải hiển thị trên đầu ra bị ảnh hưởng;
  // fact chưa xác nhận không được trình bày như sự thật; marker bằng chứng
  // phải trỏ fact/giới hạn có trong context — không bịa nguồn.
  const ph = ctx.phat_hanh;
  if (ph) {
    const dauRa = kq.noi_dung.toLowerCase();
    for (const g of ph.gioi_han) {
      if (!g.tinh_nang || !g.mo_ta) continue;
      if (
        dauRa.includes(g.tinh_nang.toLowerCase()) &&
        !dauRa.includes(g.mo_ta.toLowerCase())
      ) {
        canhBao.push(
          `Giới hạn ${g.id} ('${g.mo_ta}') của '${g.tinh_nang}' chưa hiển thị trên đầu ra dù tính năng được nhắc.`,
        );
      }
    }
    for (const f of ph.ds_fact) {
      if (f.xac_nhan || !f.tinh_nang) continue;
      const dongNham = kq.noi_dung
        .split(/\n/)
        .some(
          (dong) =>
            dong.toLowerCase().includes(f.tinh_nang.toLowerCase()) &&
            !/câu\s*hỏi/i.test(dong),
        );
      if (dongNham) {
        canhBao.push(
          `Fact ${f.id} '${f.tinh_nang}' chưa có bằng chứng nguồn — đầu ra đang nhắc nó ngoài câu hỏi, cần xác nhận trước khi công bố.`,
        );
      }
    }
    const idFact = new Set(ph.ds_fact.map((f) => f.id));
    const idGh = new Set(ph.gioi_han.map((g) => g.id));
    for (const m of kq.noi_dung.matchAll(/\[F:([a-z0-9_-]+)\]/gi)) {
      if (!idFact.has(m[1]!)) canhBao.push(`Đầu ra tham chiếu fact '${m[1]}' không có trong bản phát hành.`);
    }
    for (const m of kq.noi_dung.matchAll(/\[GH:([a-z0-9_-]+)\]/gi)) {
      if (!idGh.has(m[1]!)) canhBao.push(`Đầu ra tham chiếu giới hạn '${m[1]}' không có trong bản phát hành.`);
    }
  }

  // Chiến dịch gây quỹ (#10): tác động đã đạt/ước tính phải phân biệt;
  // tổng tiền luôn kèm tiền tệ; trích dẫn và số đo không được bịa; CTA
  // quyên góp dùng đúng đích được cung cấp; bản ngôn ngữ thứ hai giữ
  // nguyên số liệu, tiền tệ và CTA.
  const gq = ctx.gay_quy;
  if (gq) {
    // Giá trị trường sau parse — trích dẫn/số đo kiểm trên giá trị,
    // không trên JSON serialize (field name/escape không phải nội dung).
    let giaTriTruong: string[] = [kq.noi_dung];
    try {
      const j: unknown = JSON.parse(kq.noi_dung);
      if (j !== null && typeof j === "object" && !Array.isArray(j)) {
        const ds: string[] = [];
        for (const v of Object.values(j as Record<string, unknown>)) {
          if (typeof v === "string") ds.push(v);
          else if (Array.isArray(v)) {
            for (const m of v) if (typeof m === "string") ds.push(m);
          }
        }
        if (ds.length > 0) giaTriTruong = ds;
      }
    } catch {
      // Không phải JSON — kiểm trên nguyên văn.
    }
    const giaTri = giaTriTruong.join("\n");
    const chuanHoa = (s: string) => s.replace(/\s+/g, " ").trim();
    const coTienTeDauRa = gq.tien_te
      ? giaTri.toLowerCase().includes(gq.tien_te.toLowerCase())
      : false;

    // Marker bằng chứng phải trỏ tác động/trích dẫn có trong context.
    const idTd = new Set(gq.ds_tac_dong.map((t) => t.id));
    const idTq = new Set(gq.ds_trich_dan.map((t) => t.id));
    for (const m of kq.noi_dung.matchAll(/\[TD:([a-z0-9_-]+)\]/gi)) {
      if (!idTd.has(m[1]!)) {
        canhBao.push(`Đầu ra tham chiếu tác động '${m[1]}' không có trong chiến dịch.`);
      }
    }
    for (const m of kq.noi_dung.matchAll(/\[TQ:([a-z0-9_-]+)\]/gi)) {
      if (!idTq.has(m[1]!)) {
        canhBao.push(`Đầu ra tham chiếu trích dẫn '${m[1]}' không có trong chiến dịch.`);
      }
    }

    for (const t of gq.ds_tac_dong) {
      if (!t.tieu_de) continue;
      const tieuDe = t.tieu_de.toLowerCase();
      const dongNham = giaTri
        .split(/\n/)
        .some(
          (dong) => dong.toLowerCase().includes(tieuDe) && !/câu\s*hỏi/i.test(dong),
        );
      if (!dongNham) continue;
      if (!t.xac_nhan) {
        canhBao.push(
          `Tác động ${t.id} '${t.tieu_de}' chưa có bằng chứng nguồn — đầu ra đang nhắc nó ngoài câu hỏi, cần xác nhận trước khi công bố.`,
        );
      } else if (t.trang_thai === "uoc_tinh") {
        const coNhanUocTinh = giaTri
          .split(/\n/)
          .some(
            (dong) => dong.toLowerCase().includes(tieuDe) && /ước|estimate/i.test(dong),
          );
        if (!coNhanUocTinh) {
          canhBao.push(
            `Tác động ${t.id} '${t.tieu_de}' là ước tính — đầu ra phải ghi rõ ước tính, không trình bày như đã đạt.`,
          );
        }
      }
    }
    for (const t of gq.ds_trich_dan) {
      if (t.xac_nhan || !t.ten_nguoi) continue;
      const dongNham = giaTri
        .split(/\n/)
        .some(
          (dong) =>
            dong.toLowerCase().includes(t.ten_nguoi.toLowerCase()) &&
            !/câu\s*hỏi/i.test(dong),
        );
      if (dongNham) {
        canhBao.push(
          `Trích dẫn ${t.id} '${t.ten_nguoi}' chưa có nguồn tư liệu — đầu ra đang nhắc nó ngoài câu hỏi.`,
        );
      }
    }

    // Trích dẫn trong đầu ra phải khớp tư liệu: lời trong ngoặc kép chỉ
    // được là một phần của ds_trich_dan đã khai báo hoặc văn bản nguồn.
    const vanBanTuLieu = chuanHoa(
      [
        vanBanDauVao,
        ...gq.ds_trich_dan.map((t) => t.loi),
        ...gq.ds_trich_dan.map((t) => t.ten_nguoi),
      ].join("\n"),
    );
    for (const m of giaTri.matchAll(/"([^"\n]{8,300})"|«([^»\n]{8,300})»|“([^”\n]{8,300})”/g)) {
      const trich = chuanHoa(m[1] ?? m[2] ?? m[3] ?? "");
      if (!trich) continue;
      if (!vanBanTuLieu.includes(trich)) {
        canhBao.push(
          `Trích dẫn "${trich.slice(0, 60)}${trich.length > 60 ? "…" : ""}" không khớp tư liệu đã khai báo — có nguy cơ bịa lời người thụ hưởng.`,
        );
      }
    }

    // Số đo trong đầu ra phải có trong input: tác động, số tiền mục tiêu
    // hoặc văn bản nguồn — chống bịa "X người/hộ/đồng/%".
    const RE_SO_DO =
      /\d[\d.,]*\s*(?:người|hộ|giếng|điểm|đồng|đ|₫|vnđ|usd|eur|vnd|tỷ|triệu|%|phần\s*trăm)/giu;
    const soDauVao = new Set(
      [
        ...(vanBanDauVao.match(/\d[\d.,]*/g) ?? []),
        ...gq.ds_tac_dong.map((t) => t.so_lieu),
        gq.so_tien_muc_tieu !== null ? String(gq.so_tien_muc_tieu) : "",
      ]
        .map((s) => s.replace(/[.,]/g, ""))
        .filter(Boolean),
    );
    for (const m of giaTri.matchAll(RE_SO_DO)) {
      const so = (/\d[\d.,]*/.exec(m[0])?.[0] ?? "").replace(/[.,]/g, "");
      if (so && !soDauVao.has(so)) {
        canhBao.push(
          `Số đo '${m[0].trim()}' không có trong tư liệu đã cung cấp — cần nguồn xác nhận trước khi công bố.`,
        );
      }
    }

    // Tổng tiền mục tiêu có mặt thì phải kèm đơn vị tiền tệ.
    if (gq.so_tien_muc_tieu !== null) {
      const soChuan = String(gq.so_tien_muc_tieu).replace(/[.,]/g, "");
      const coSoTien = giaTri.replace(/[.,]/g, "").includes(soChuan);
      if (coSoTien && gq.tien_te && !coTienTeDauRa) {
        canhBao.push(
          `Đầu ra nhắc số tiền mục tiêu ${gq.so_tien_muc_tieu} nhưng thiếu đơn vị tiền tệ '${gq.tien_te}'.`,
        );
      }
    }

    // CTA quyên góp: định dạng có trường lien_ket/cta thì phải dùng đúng
    // đích ngoài được cung cấp — xem trước cho thấy link cuối trước duyệt.
    const ctaQg = gq.cta.find((c) => c.loai === "quyen_gop");
    const coTruongLienKet = ctx.dinh_dang?.truong.some(
      (t) => t.ten === "lien_ket" || t.ten === "cta",
    );
    if (ctaQg && coTruongLienKet && !giaTri.includes(ctaQg.url)) {
      canhBao.push(
        `Đầu ra không dùng đích quyên góp được cung cấp (${ctaQg.url}) — CTA phải trỏ đúng link cuối của tổ chức.`,
      );
    }

    // Bản ngôn ngữ thứ hai: giữ nguyên số liệu, tiền tệ và đích CTA —
    // dịch sai định lượng sự thật là lỗi biên tập.
    if (ctx.ngon_ngu !== "vi") {
      const giaTriBoDau = giaTri.replace(/[.,]/g, "");
      const thieu: string[] = [];
      for (const t of gq.ds_tac_dong) {
        if (!t.xac_nhan || !t.so_lieu) continue;
        if (!giaTriBoDau.includes(t.so_lieu.replace(/[.,]/g, ""))) {
          thieu.push(`số liệu '${t.so_lieu}${t.don_vi ? ` ${t.don_vi}` : ""}' của '${t.tieu_de}'`);
        }
      }
      if (gq.tien_te && gq.so_tien_muc_tieu !== null && !coTienTeDauRa) {
        thieu.push(`đơn vị tiền tệ '${gq.tien_te}'`);
      }
      if (ctaQg && !giaTri.includes(ctaQg.url)) {
        thieu.push("đích CTA quyên góp");
      }
      if (thieu.length > 0) {
        canhBao.push(
          `Bản ${ctx.ngon_ngu} mất định lượng/CTA so với nguồn: ${thieu.join("; ")}.`,
        );
      }
    }
  }

  // Chiến dịch công quyền (#11): yêu cầu bắt buộc phân biệt với ngôn
  // ngữ giải thích; ngoại lệ/phạm vi quyền hạn/ngày hiệu lực giữ nguyên
  // qua đơn giản hóa và dịch; marker bằng chứng phải trỏ mục có trong
  // context — không bịa nguồn; điều khoản mơ hồ chỉ là câu hỏi review.
  const cq = ctx.cong_quyen;
  if (cq) {
    // Giá trị trường sau parse — giống khối gây quỹ: kiểm trên giá trị,
    // không trên JSON serialize.
    let giaTriTruong: string[] = [kq.noi_dung];
    let fields: Record<string, unknown> = {};
    try {
      const j: unknown = JSON.parse(kq.noi_dung);
      if (j !== null && typeof j === "object" && !Array.isArray(j)) {
        fields = j as Record<string, unknown>;
        const ds: string[] = [];
        for (const v of Object.values(fields)) {
          if (typeof v === "string") ds.push(v);
          else if (Array.isArray(v)) {
            for (const m of v) if (typeof m === "string") ds.push(m);
          }
        }
        if (ds.length > 0) giaTriTruong = ds;
      }
    } catch {
      // Không phải JSON — kiểm trên nguyên văn.
    }
    const giaTri = giaTriTruong.join("\n");
    const dsDong = giaTri.split(/\n/);

    // Marker bằng chứng phải trỏ yêu cầu/ngoại lệ/fact có trong context.
    const idYc = new Set(cq.ds_yeu_cau.map((t) => t.id));
    const idNl = new Set(cq.ds_ngoai_le.map((t) => t.id));
    const idFv = new Set(cq.ds_fact_van_hanh.map((t) => t.id));
    for (const m of kq.noi_dung.matchAll(/\[YC:([a-z0-9_-]+)\]/gi)) {
      if (!idYc.has(m[1]!)) {
        canhBao.push(`Đầu ra tham chiếu yêu cầu '${m[1]}' không có trong chính sách.`);
      }
    }
    for (const m of kq.noi_dung.matchAll(/\[NL:([a-z0-9_-]+)\]/gi)) {
      if (!idNl.has(m[1]!)) {
        canhBao.push(`Đầu ra tham chiếu ngoại lệ '${m[1]}' không có trong chính sách.`);
      }
    }
    for (const m of kq.noi_dung.matchAll(/\[FV:([a-z0-9_-]+)\]/gi)) {
      if (!idFv.has(m[1]!)) {
        canhBao.push(`Đầu ra tham chiếu fact vận hành '${m[1]}' không có trong chiến dịch.`);
      }
    }

    // Mục chưa xác nhận không được trình bày ngoài dòng câu hỏi — khớp
    // 40 ký tự đầu nội dung đủ phân biệt mà không đòi trùng toàn văn.
    const dongNhamNgoaiHoi = (doan: string): boolean => {
      const mau = doan.slice(0, 40).toLowerCase();
      if (mau.length < 12) return false;
      return dsDong.some(
        (d) => d.toLowerCase().includes(mau) && !/câu\s*hỏi/i.test(d),
      );
    };
    for (const y of cq.ds_yeu_cau) {
      if (y.xac_nhan || !y.noi_dung) continue;
      if (dongNhamNgoaiHoi(y.noi_dung)) {
        canhBao.push(
          `Yêu cầu ${y.id} chưa có bằng chứng nguồn — đầu ra đang nhắc nó ngoài câu hỏi, cần thẩm quyền xác nhận trước khi công bố.`,
        );
      }
    }
    for (const nl of cq.ds_ngoai_le) {
      if (nl.xac_nhan || !nl.noi_dung) continue;
      if (dongNhamNgoaiHoi(nl.noi_dung)) {
        canhBao.push(
          `Ngoại lệ ${nl.id} chưa có bằng chứng nguồn — đầu ra đang nhắc nó ngoài câu hỏi.`,
        );
      }
    }
    for (const f of cq.ds_fact_van_hanh) {
      if (f.xac_nhan || !f.tieu_de) continue;
      if (dongNhamNgoaiHoi(f.tieu_de)) {
        canhBao.push(
          `Fact vận hành ${f.id} '${f.tieu_de}' chưa có nguồn — đầu ra đang nhắc nó ngoài câu hỏi.`,
        );
      }
    }

    // Điểm giải thích không trình bày như nghĩa vụ bắt buộc.
    for (const y of cq.ds_yeu_cau) {
      if (!y.xac_nhan || y.loai !== "giai_thich" || !y.noi_dung) continue;
      const mau = y.noi_dung.slice(0, 40).toLowerCase();
      if (mau.length < 12) continue;
      const nham = dsDong.some(
        (d) => d.toLowerCase().includes(mau) && /bắt\s*buộc/i.test(d),
      );
      if (nham) {
        canhBao.push(
          `Điểm giải thích ${y.id} đang trình bày như nghĩa vụ bắt buộc — phân biệt ngôn ngữ giải thích với yêu cầu bắt buộc.`,
        );
      }
    }

    // Ngoại lệ liên kết yêu cầu không bị bỏ: đầu ra nhắc yêu cầu phải
    // nhắc ngoại lệ của nó (ngoại lệ sống qua đơn giản hóa/dịch).
    for (const nl of cq.ds_ngoai_le) {
      if (!nl.xac_nhan || !nl.yeu_cau_id || !nl.noi_dung) continue;
      const yc = cq.ds_yeu_cau.find((x) => x.id === nl.yeu_cau_id);
      if (!yc?.xac_nhan || !yc.noi_dung) continue;
      const mauYc = yc.noi_dung.slice(0, 40).toLowerCase();
      const mauNl = nl.noi_dung.slice(0, 40).toLowerCase();
      if (mauYc.length < 12 || mauNl.length < 12) continue;
      const coYc = dsDong.some((d) => d.toLowerCase().includes(mauYc));
      const coNl = dsDong.some((d) => d.toLowerCase().includes(mauNl));
      if (coYc && !coNl) {
        canhBao.push(
          `Đầu ra nhắc yêu cầu '${yc.id}' mà bỏ ngoại lệ '${nl.id}' liên kết — ngoại lệ phải sống qua đơn giản hóa/dịch.`,
        );
      }
    }

    // Ngày hiệu lực giữ nguyên ở mọi ngôn ngữ (ISO date không dịch);
    // phạm vi quyền hạn giữ nguyên trong bản tiếng Việt — bản dịch được
    // dịch câu nhưng không được bớt phạm vi.
    if (cq.ngay_hieu_luc && !giaTri.includes(cq.ngay_hieu_luc)) {
      canhBao.push(
        `Đầu ra không giữ nguyên ngày hiệu lực '${cq.ngay_hieu_luc}' của chính sách.`,
      );
    }
    if (
      cq.pham_vi_quyen_han &&
      ctx.ngon_ngu === "vi" &&
      !giaTri.includes(cq.pham_vi_quyen_han)
    ) {
      canhBao.push(
        `Đầu ra không giữ nguyên phạm vi quyền hạn '${cq.pham_vi_quyen_han}' của chính sách.`,
      );
    }

    // Trường ngoai_le phải có đủ mục cho ngoại lệ đã xác nhận — dịch được
    // phép dịch câu nhưng không được bỏ mục.
    const nlXacNhan = cq.ds_ngoai_le.filter((x) => x.xac_nhan).length;
    const coTruongNgoaiLe = ctx.dinh_dang?.truong.some((t) => t.ten === "ngoai_le");
    if (nlXacNhan > 0 && coTruongNgoaiLe) {
      const v = fields["ngoai_le"];
      const soMuc = Array.isArray(v)
        ? v.filter((m) => typeof m === "string" && m.trim() !== "").length
        : 0;
      if (soMuc < nlXacNhan) {
        canhBao.push(
          `Trường ngoai_le có ${soMuc} mục trong khi chính sách khai báo ${nlXacNhan} ngoại lệ đã xác nhận — đơn giản hóa/dịch phải giữ ngoại lệ.`,
        );
      }
    }
  }

  // Chiến dịch thương hiệu (#12): claim chưa xác nhận không được trình
  // bày ngoài câu hỏi; giá/tiền tệ/khả dụng của thị trường giữ nguyên
  // văn — không quy đổi tiền, không bịa giá hay tình trạng khả dụng;
  // chi tiết đối tượng do đội local cung cấp giữ nguyên văn; CTA local
  // thắng CTA mặc định khi thị trường ghi đè; marker bằng chứng [CL:id]
  // phải trỏ claim có trong context — không bịa nguồn.
  const th = ctx.thuong_hieu;
  if (th) {
    // Giá trị trường sau parse — giống khối gây quỹ/công quyền.
    let giaTriTruong: string[] = [kq.noi_dung];
    let fieldsTh: Record<string, unknown> = {};
    try {
      const j: unknown = JSON.parse(kq.noi_dung);
      if (j !== null && typeof j === "object" && !Array.isArray(j)) {
        fieldsTh = j as Record<string, unknown>;
        const ds: string[] = [];
        for (const v of Object.values(fieldsTh)) {
          if (typeof v === "string") ds.push(v);
          else if (Array.isArray(v)) {
            for (const m of v) if (typeof m === "string") ds.push(m);
          }
        }
        if (ds.length > 0) giaTriTruong = ds;
      }
    } catch {
      // Không phải JSON — kiểm trên nguyên văn.
    }
    const giaTri = giaTriTruong.join("\n");
    const dsDongTh = giaTri.split(/\n/);
    const tt = th.thi_truong;

    // Marker [CL:id] phải trỏ claim đã khai báo trong chiến dịch.
    const idCl = new Set(th.ds_claim.map((c) => c.id));
    for (const m of kq.noi_dung.matchAll(/\[CL:([a-z0-9_-]+)\]/gi)) {
      if (!idCl.has(m[1]!)) {
        canhBao.push(`Đầu ra tham chiếu claim '${m[1]}' không có trong chiến dịch.`);
      }
    }

    // Claim chưa xác nhận không được trình bày ngoài dòng câu hỏi — khớp
    // 40 ký tự đầu đủ phân biệt, giống khối công quyền.
    const dongNhamNgoaiHoiTh = (doan: string): boolean => {
      // Cắt 40 ký tự đầu rồi bỏ dấu câu/khoảng trắng cuối — claim hay
      // được trích giữa câu, dấu '.' cuối claim không có trong đầu ra.
      const mau = doan
        .slice(0, 40)
        .toLowerCase()
        .replace(/[\s.,;:!?"'“”‘’…]+$/u, "");
      if (mau.length < 12) return false;
      return dsDongTh.some(
        (d) => d.toLowerCase().includes(mau) && !/câu\s*hỏi/i.test(d),
      );
    };
    for (const cl of th.ds_claim) {
      if (cl.xac_nhan || !cl.noi_dung) continue;
      if (dongNhamNgoaiHoiTh(cl.noi_dung)) {
        canhBao.push(
          `Claim ${cl.id} chưa có bằng chứng nguồn — đầu ra đang nhắc nó ngoài câu hỏi, cần đội brand xác nhận trước khi dùng.`,
        );
      }
    }

    if (tt) {
      // Giá giữ nguyên văn + tiền tệ đi kèm: đầu ra nhắc số giá mà thiếu
      // mã tiền tệ, hoặc nhắc mã tiền khác → quy đổi ngầm, cảnh báo.
      if (tt.co_gia) {
        const soGia = tt.gia.replace(/[.,\s]/g, "");
        const giaTriBoDau = giaTri.replace(/[.,\s]/g, "");
        const coGia = giaTriBoDau.includes(soGia);
        if (coGia && tt.tien_te && !giaTri.includes(tt.tien_te)) {
          canhBao.push(
            `Đầu ra nhắc giá '${tt.gia}' của thị trường nhưng thiếu tiền tệ '${tt.tien_te}' — giá phải giữ nguyên văn kèm đơn vị.`,
          );
        }
        // Mã tiền tệ khác trong đầu ra → dấu hiệu tự quy đổi.
        const tienTeKhac = new Set<string>();
        for (const m of giaTri.matchAll(/\b(USD|EUR|VND|GBP|JPY|AUD|SGD|CAD|CNY)\b/g)) {
          if (m[1] !== tt.tien_te) tienTeKhac.add(m[1]!);
        }
        for (const m of giaTri.matchAll(/[$€£¥₫]/g)) {
          const kyHieu = m[0] === "$" ? "USD" : m[0] === "€" ? "EUR" : "VND";
          if (kyHieu !== tt.tien_te) tienTeKhac.add(m[0]);
        }
        if (tienTeKhac.size > 0) {
          canhBao.push(
            `Đầu ra nhắc tiền tệ khác (${[...tienTeKhac].join(", ")}) ngoài '${tt.tien_te}' được cung cấp — không được tự quy đổi giá.`,
          );
        }
      } else {
        // Thị trường chưa cung cấp giá → đầu ra không được chứa dạng giá
        // ngoài dòng câu hỏi (không bịa giá, không quy đổi từ nơi khác).
        const coGiaBia = dsDongTh.some(
          (d) =>
            /câu\s*hỏi/i.test(d) === false &&
            (/\d[\d.,]*\s*(USD|EUR|VND|đ|₫|\$|€)/i.test(d) || /giá\s*[:]/i.test(d)),
        );
        if (coGiaBia) {
          canhBao.push(
            `Thị trường '${tt.ten}' chưa cung cấp giá nhưng đầu ra có dạng giá — không được bịa hoặc tự quy đổi giá.`,
          );
        }
      }
      // Khả dụng: thị trường chưa cung cấp → không được khẳng định tình
      // trạng còn hàng/hết hàng ngoài câu hỏi.
      if (!tt.co_kha_dung) {
        const coKhaDungBia = dsDongTh.some(
          (d) =>
            /câu\s*hỏi/i.test(d) === false &&
            /còn\s*hàng|hết\s*hàng|đặt\s*trước|in\s*stock|out\s*of\s*stock|pre-?order/i.test(d),
        );
        if (coKhaDungBia) {
          canhBao.push(
            `Thị trường '${tt.ten}' chưa cung cấp tình trạng khả dụng nhưng đầu ra khẳng định nó — phải để [CÂU HỎI].`,
          );
        }
      }
      // Chi tiết đối tượng do đội local cung cấp giữ nguyên văn — có
      // trong đầu ra (lời thoại/ưu đãi đã duyệt riêng cho đối tượng).
      if (tt.chi_tiet && !giaTri.includes(tt.chi_tiet)) {
        canhBao.push(
          `Đầu ra bỏ hoặc sửa chi tiết đối tượng đã cung cấp của thị trường '${tt.ten}' — phải giữ nguyên văn.`,
        );
      }
      // CTA local ghi đè: định dạng có trường lien_ket/cta/landing thì
      // phải dùng URL local, không rơi về CTA mặc định của chiến dịch.
      if (tt.cta_url) {
        const coTruongCta = ctx.dinh_dang?.truong.some(
          (t) => t.ten === "lien_ket" || t.ten === "cta" || t.ten === "landing",
        );
        if (coTruongCta && !giaTri.includes(tt.cta_url)) {
          canhBao.push(
            `Đầu ra không dùng CTA local của thị trường (${tt.cta_url}) — CTA local ghi đè CTA mặc định.`,
          );
        }
      }
      // Ghi đè tự do: giá trị phải sống qua đầu ra khi định dạng có
      // trường ghi_chu/gioi_han — ghi đè tường minh không được nuốt.
      const coTruongGhiDe = ctx.dinh_dang?.truong.some(
        (t) => t.ten === "ghi_chu" || t.ten === "gioi_han" || t.ten === "gioi_han_ap_dung",
      );
      if (coTruongGhiDe) {
        for (const g of tt.ds_ghi_de) {
          if (g.gia_tri && !giaTri.includes(g.gia_tri)) {
            canhBao.push(
              `Đầu ra không giữ ghi đè '${g.khoa}: ${g.gia_tri}' của thị trường '${tt.ten}'.`,
            );
          }
        }
      }
    }
  }

  return { hop_le: loiCung.length === 0, loi_cung: loiCung, canh_bao: canhBao };
}
