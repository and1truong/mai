import type { ContextTask, KetQuaTask, NguonContext, TrichDan } from "./index.ts";
import type { DinhNghiaTruong } from "../formats/index.ts";

// Adapter fixture (#20): cùng input → cùng output, không mạng, không ngẫu
// nhiên. Sinh canonical JSON theo schema định dạng + trích dẫn tham chiếu
// đúng revision nguồn đã đưa vào — cùng contract với adapter live nên mọi
// đường kiểm chứng (schema, trích dẫn, usage) đều đi qua đoạn chung đó.

function cauDau(vanBan: string): string {
  return (
    vanBan
      .split(/\n+|(?<=[.!?])\s+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0)[0] ?? ""
  );
}

function trichTatCa(dsNguon: NguonContext[]): TrichDan[] {
  return dsNguon.map((n) => ({
    nguon_revision_id: n.revision_id,
    doan: cauDau(n.noi_dung).slice(0, 80),
  }));
}

// Câu bổ sung chứng cứ thiếu: để câu hỏi tường minh, không bịa số liệu.
function dongThieuChungCu(ctx: ContextTask): string[] {
  const nhan: Record<string, string> = {
    so_lieu: "số liệu cụ thể",
    moc_thoi_gian: "mốc thời gian",
    ngay_gio_cu_the: "ngày giờ cụ thể (kèm múi giờ)",
    gia_ca: "thông tin giá",
    // Số báo (#8): tham chiếu đã khai báo trên campaign nhưng văn bản nguồn
    // chưa có — provider gắn cờ thay vì bịa trích dẫn.
    van_ban_tham_chieu: "văn bản nguồn của tham chiếu đã khai báo",
    // Phát hành (#9): một số fact không trỏ nguồn đã nạp hoặc nguồn đó
    // không vào chuỗi provenance — claim tính năng chưa xác nhận.
    fact_chua_xac_nhan: "bằng chứng nguồn cho một số tính năng đã khai báo",
    // Gây quỹ (#10): tác động/trích dẫn chưa trỏ nguồn tư liệu — đầu ra
    // để câu hỏi biên tập, không bịa số đo hay lời người thụ hưởng.
    tac_dong_chua_xac_nhan: "bằng chứng nguồn cho một số tác động đã khai báo",
    trich_dan_chua_nguon: "nguồn tư liệu cho một số trích dẫn đã khai báo",
    // Công quyền (#11): mục chưa trỏ nguồn chính sách → câu hỏi thẩm
    // quyền; điều khoản nguồn mơ hồ → câu hỏi diễn giải, không bịa luật.
    yeu_cau_chua_xac_nhan: "bằng chứng nguồn cho một số yêu cầu chính sách",
    ngoai_le_chua_xac_nhan: "bằng chứng nguồn cho một số ngoại lệ chính sách",
    fact_van_hanh_chua_nguon: "nguồn cho một số fact vận hành đã khai báo",
    dieu_khoan_mo_ho: "diễn giải của thẩm quyền cho một số điều khoản nguồn mơ hồ",
  };
  return ctx.thieu_chung_cu.map(
    (t) => `[CÂU HỎI: nguồn chưa có ${nhan[t] ?? t} — cần người viết bổ sung.]`,
  );
}

// Cắt có chủ đích: giữ đuôi "…" để output vẫn validate hợp lệ schema khi
// input dài — fixture tự sinh vi phạm thì repair không bao giờ cứu được.
// Ưu tiên cắt ở biên từ cuối thay vì chẻ giữa từ.
function catChuoi(s: string, toiDa?: number): string {
  if (!toiDa || s.length <= toiDa) return s;
  const cat = s.slice(0, toiDa - 1);
  const khoangTrang = cat.lastIndexOf(" ");
  const bien = khoangTrang > toiDa / 2 ? cat.slice(0, khoangTrang) : cat;
  return `${bien.trimEnd()}…`;
}

// Thứ tự ưu tiên loại CTA cho trường lien_ket theo định dạng (#9): link
// trỏ đúng trang docs/nâng cấp/hỗ trợ tùy đầu ra — CTA rỗng → rơi về
// luồng chung (nhặt URL từ nguồn thật, không bịa).
const LOAI_CTA_UU_TIEN: Record<string, string[]> = {
  "huong-dan-tich-hop": ["tai_lieu", "ho_tro"],
  "thay-doi-khach-hang": ["nang_cap", "tai_lieu"],
  "loi-ich-tiem-nang": ["tai_lieu", "nang_cap"],
  "kiem-soat-bao-mat": ["tai_lieu", "ho_tro"],
  "brief-ban-hang": ["tai_lieu", "nang_cap"],
  "email-phan-doan": ["nang_cap", "tai_lieu"],
  faq: ["ho_tro", "tai_lieu"],
  caption: ["tai_lieu", "nang_cap"],
};

// Trường danh sách của định dạng phát hành được đổ từ ds_fact: fact đã
// xác nhận thành dòng claim kèm marker [F:<id>]; fact chưa xác nhận chỉ
// thành dòng [CÂU HỎI] — fixture không bịa sự thật.
const TRUONG_DS_FACT = new Set([
  "cac_thay_doi",
  "cac_loi_ich",
  "kiem_soat",
  "diem_ban",
  "doi_pho",
  "cac_buoc",
  "yeu_cau_truoc",
  "hoi_dap",
]);

// Field theo tên cho ngữ cảnh bản phát hành (#9) — trả undefined để rơi
// về luồng chung khi field không thuộc từ điển release.
function noiDungTruongPhatHanh(
  t: DinhNghiaTruong,
  ctx: ContextTask,
): string | string[] | undefined {
  const ph = ctx.phat_hanh;
  if (!ph) return undefined;

  if (t.loai === "van_ban") {
    if (t.ten === "phien_ban") return ph.phien_ban;
    if (t.ten === "ngay_phat_hanh") return ph.ngay_phat_hanh;
    if (t.ten === "phan_doan") {
      return ctx.context_sinh?.doi_tuong?.ten || ctx.doi_tuong || "chung";
    }
    if (t.ten === "thong_diep_chinh") {
      return ph.dinh_vi || cauDau(ctx.thong_diep.noi_dung) || ctx.thong_diep.tieu_de;
    }
    if (t.ten === "lich_gui") {
      return ph.ngay_phat_hanh || cauDau(ctx.thong_diep.noi_dung) || ctx.thong_diep.tieu_de;
    }
    if (t.ten === "lien_ket") {
      for (const loai of LOAI_CTA_UU_TIEN[ctx.dinh_dang?.id ?? ""] ?? []) {
        const c = ph.cta.find((x) => x.loai === loai);
        if (c) return c.url;
      }
      if (ph.cta.length > 0) return ph.cta[0]!.url;
      return undefined;
    }
    if (t.ten === "cta") {
      const c = ph.cta[0];
      return c ? `${c.nhan}: ${c.url}` : undefined;
    }
    if (t.ten === "hanh_dong" || t.ten === "tiep_theo") {
      const c = ph.cta.find((x) => x.loai === "nang_cap") ?? ph.cta[0];
      return c ? `${c.nhan} — ${c.url}` : undefined;
    }
    return undefined;
  }

  if (t.loai !== "danh_sach") return undefined;

  if (t.ten === "gioi_han" || t.ten === "gioi_han_ap_dung") {
    return ph.gioi_han.map((g) => `${g.tinh_nang}: ${g.mo_ta} [GH:${g.id}]`);
  }
  const factXacNhan = ph.ds_fact.filter((f) => f.xac_nhan);
  const factChua = ph.ds_fact.filter((f) => !f.xac_nhan);
  if (t.ten === "bang_chung") {
    return factXacNhan.map(
      (f) =>
        `${f.noi_dung} [F:${f.id}]${f.nguon_tieu_de ? ` — nguồn: ${f.nguon_tieu_de}` : ""}`,
    );
  }
  if (t.ten === "con_thieu") {
    return factChua.map(
      (f) => `[CÂU HỎI: '${f.tinh_nang}' chưa có bằng chứng nguồn — cần xác nhận trước khi công bố.]`,
    );
  }
  if (TRUONG_DS_FACT.has(t.ten) && ph.ds_fact.length > 0) {
    const ds = ph.ds_fact.map((f) => {
      if (!f.xac_nhan) {
        return `[CÂU HỎI: '${f.tinh_nang}' chưa có bằng chứng nguồn — cần xác nhận trước khi công bố.]`;
      }
      if (t.ten === "hoi_dap") {
        return `Hỏi: ${f.tinh_nang} thay đổi gì? Đáp: ${f.noi_dung} [F:${f.id}]`;
      }
      return `${f.tinh_nang}: ${f.noi_dung} [F:${f.id}]`;
    });
    // FAQ support cũng liệt kê giới hạn — người dùng sẽ hỏi tính năng
    // bị giới hạn ngay khi đọc changelog.
    if (t.ten === "hoi_dap" && ph.gioi_han.length > 0) {
      ds.push(
        `Hỏi: giới hạn của bản phát hành? Đáp: ${ph.gioi_han.map((g) => `${g.tinh_nang}: ${g.mo_ta}`).join("; ")}`,
      );
    }
    return ds;
  }
  return undefined;
}

// Field theo tên cho ngữ cảnh gây quỹ (#10) — trả undefined để rơi về
// luồng chung khi field không thuộc từ điển gây quỹ.
function noiDungTruongGayQuy(
  t: DinhNghiaTruong,
  ctx: ContextTask,
): string | string[] | undefined {
  const gq = ctx.gay_quy;
  if (!gq) return undefined;
  const soTien =
    gq.so_tien_muc_tieu !== null
      ? `${gq.so_tien_muc_tieu.toLocaleString("vi-VN")}${gq.tien_te ? ` ${gq.tien_te}` : ""}`
      : "";
  const ctaQuyenGop = gq.cta.find((c) => c.loai === "quyen_gop") ?? gq.cta[0];

  if (t.loai === "van_ban") {
    if (t.ten === "muc_tieu") {
      return [gq.muc_tieu, soTien].filter(Boolean).join(" — ") || undefined;
    }
    if (t.ten === "phan_doan") {
      return ctx.context_sinh?.doi_tuong?.ten || ctx.doi_tuong || "chung";
    }
    if (t.ten === "thong_diep_chinh") {
      return gq.thong_diep_loi || cauDau(ctx.thong_diep.noi_dung) || ctx.thong_diep.tieu_de;
    }
    if (t.ten === "lien_ket") {
      // Đích quyên góp luôn là link ngoài do tổ chức cung cấp — xem
      // trước đầu ra hiện đúng link cuối này trước khi duyệt.
      return ctaQuyenGop?.url;
    }
    if (t.ten === "cta" || t.ten === "hanh_dong" || t.ten === "tiep_theo") {
      return ctaQuyenGop ? `${ctaQuyenGop.nhan}: ${ctaQuyenGop.url}` : undefined;
    }
    return undefined;
  }

  const dongTacDong = (trangThai: string) =>
    gq.ds_tac_dong
      .filter((x) => x.trang_thai === trangThai)
      .map((x) => {
        if (!x.xac_nhan) {
          return `[CÂU HỎI: tác động '${x.tieu_de}' chưa có bằng chứng nguồn — cần xác nhận trước khi công bố.]`;
        }
        const soLieu = x.so_lieu ? ` — ${x.so_lieu}${x.don_vi ? ` ${x.don_vi}` : ""}` : "";
        const tienTo = trangThai === "uoc_tinh" ? "Ước tính: " : "";
        return `${tienTo}${x.tieu_de}${soLieu}: ${x.noi_dung} [TD:${x.id}]`;
      });

  if (t.loai === "danh_sach") {
    if (t.ten === "tac_dong_da_dat") return dongTacDong("da_dat");
    if (t.ten === "tac_dong_uoc_tinh") return dongTacDong("uoc_tinh");
    if (t.ten === "trich_dan") {
      return gq.ds_trich_dan.map((x) => {
        if (!x.xac_nhan) {
          return `[CÂU HỎI: trích dẫn '${x.ten_nguoi}' chưa có nguồn tư liệu — cần đối chiếu trước khi đăng.]`;
        }
        return `"${x.loi}" — ${x.ten_nguoi} [TQ:${x.id}]`;
      });
    }
    if (t.ten === "con_thieu") {
      const ds: string[] = [
        ...gq.ds_tac_dong
          .filter((x) => !x.xac_nhan)
          .map(
            (x) =>
              `[CÂU HỎI: tác động '${x.tieu_de}' chưa có bằng chứng nguồn — cần xác nhận trước khi công bố.]`,
          ),
        ...gq.ds_trich_dan
          .filter((x) => !x.xac_nhan)
          .map(
            (x) =>
              `[CÂU HỎI: trích dẫn '${x.ten_nguoi}' chưa có nguồn tư liệu — cần đối chiếu trước khi đăng.]`,
          ),
      ];
      return ds;
    }
    return undefined;
  }

  if (t.loai === "markdown" && t.ten === "noi_dung") {
    // Thân đầu ra gây quỹ: thông điệp lõi → tác động đã đạt → ước tính →
    // mục tiêu tương lai → CTA quyên góp. Đã đạt và ước tính là hai mục
    // riêng; mục tiêu không trình bày như tác động đã đạt.
    const dong: string[] = [
      gq.thong_diep_loi || cauDau(ctx.thong_diep.noi_dung) || ctx.thong_diep.tieu_de,
    ];
    const daDat = dongTacDong("da_dat");
    const uocTinh = dongTacDong("uoc_tinh");
    if (daDat.length > 0) dong.push("", "**Đã đạt được:**", ...daDat.map((d) => `- ${d}`));
    if (uocTinh.length > 0) dong.push("", "**Ước tính:**", ...uocTinh.map((d) => `- ${d}`));
    if (gq.muc_tieu || soTien) {
      dong.push(
        "",
        `**Mục tiêu gây quỹ (chưa đạt):** ${[gq.muc_tieu, soTien].filter(Boolean).join(" — ")}`,
      );
    }
    const tq = gq.ds_trich_dan.filter((x) => x.xac_nhan);
    if (tq.length > 0) {
      dong.push("", ...tq.map((x) => `"${x.loi}" — ${x.ten_nguoi} [TQ:${x.id}]`));
    }
    if (ctaQuyenGop) dong.push("", `${ctaQuyenGop.nhan}: ${ctaQuyenGop.url}`);
    return dong.join("\n");
  }
  return undefined;
}

// Field theo tên cho ngữ cảnh công quyền (#11) — trả undefined để rơi
// về luồng chung khi field không thuộc từ điển chính sách.
function noiDungTruongCongQuyen(
  t: DinhNghiaTruong,
  ctx: ContextTask,
): string | string[] | undefined {
  const cq = ctx.cong_quyen;
  if (!cq) return undefined;
  const ctaChinh = cq.cta[0];

  // Một dòng mỗi mục: mục chưa xác nhận thành [CÂU HỎI] — fixture không
  // bịa luật; mục xác nhận giữ nhãn [BẮT BUỘC]/[GIẢI THÍCH] để đầu ra
  // phân biệt nghĩa vụ với ngôn ngữ giải thích.
  const dongYeuCau = (loai?: string) =>
    cq.ds_yeu_cau
      .filter((y) => (loai ? y.loai === loai : true))
      .map((y) => {
        if (!y.xac_nhan) {
          return `[CÂU HỎI: yêu cầu '${y.noi_dung.slice(0, 60)}' chưa có bằng chứng nguồn — cần thẩm quyền xác nhận trước khi công bố.]`;
        }
        const nhanLoai = y.loai === "bat_buoc" ? "BẮT BUỘC" : "GIẢI THÍCH";
        const dt = y.doi_tuong_ap_dung ? ` (${y.doi_tuong_ap_dung})` : "";
        return `${y.noi_dung} [${nhanLoai}]${dt} [YC:${y.id}]`;
      });
  const dongNgoaiLe = () =>
    cq.ds_ngoai_le.map((nl) => {
      if (!nl.xac_nhan) {
        return `[CÂU HỎI: ngoại lệ '${nl.noi_dung.slice(0, 60)}' chưa có bằng chứng nguồn — cần thẩm quyền xác nhận.]`;
      }
      const lienKet = nl.yeu_cau_id ? ` (ngoại lệ của yêu cầu ${nl.yeu_cau_id})` : "";
      return `${nl.noi_dung}${lienKet} [NL:${nl.id}]`;
    });
  const dongFact = () =>
    cq.ds_fact_van_hanh.map((f) => {
      if (!f.xac_nhan) {
        return `[CÂU HỎI: fact '${f.tieu_de}' chưa có nguồn — cần xác nhận trước khi công bố.]`;
      }
      return `${f.tieu_de}: ${f.noi_dung} [FV:${f.id}]`;
    });
  // Điều khoản nguồn mơ hồ/mâu thuẫn đổ thành câu hỏi review — không
  // phải luật bịa.
  const dongMoHo = () =>
    cq.dieu_khoan_mo_ho.map(
      (d) =>
        `[CÂU HỎI: điều khoản nguồn mơ hồ — '${d.slice(0, 120)}' cần thẩm quyền diễn giải, đầu ra không được bịa luật.]`,
    );

  if (t.loai === "van_ban") {
    if (t.ten === "tieu_de") return `Chính sách ${cq.ten}`;
    if (t.ten === "pham_vi") return cq.pham_vi_quyen_han || "Theo văn bản chính sách";
    if (t.ten === "ngay_hieu_luc") {
      return cq.ngay_hieu_luc || "[CÂU HỎI: ngày hiệu lực chưa được đặt trong chiến dịch.]";
    }
    if (t.ten === "tom_tat") {
      return `Chính sách ${cq.ten}${cq.ngay_hieu_luc ? ` có hiệu lực từ ${cq.ngay_hieu_luc}` : ""}${cq.pham_vi_quyen_han ? `, áp dụng: ${cq.pham_vi_quyen_han}` : ""}.`;
    }
    if (t.ten === "phan_doan") {
      return ctx.context_sinh?.doi_tuong?.ten || ctx.doi_tuong || "chung";
    }
    if (t.ten === "lien_ket" || t.ten === "hoi_them") {
      return ctaChinh?.url;
    }
    if (t.ten === "cta" || t.ten === "hanh_dong" || t.ten === "tiep_theo") {
      return ctaChinh ? `${ctaChinh.nhan}: ${ctaChinh.url}` : undefined;
    }
    return undefined;
  }

  if (t.loai === "danh_sach") {
    if (t.ten === "yeu_cau") return dongYeuCau();
    if (t.ten === "ngoai_le") return dongNgoaiLe();
    if (t.ten === "hoi_dap") {
      const ds = cq.ds_yeu_cau.map((y) => {
        if (!y.xac_nhan) {
          return `[CÂU HỎI: yêu cầu '${y.noi_dung.slice(0, 60)}' chưa có bằng chứng nguồn — cần thẩm quyền xác nhận.]`;
        }
        return `Hỏi: ${y.noi_dung}? Đáp: ${y.noi_dung} [YC:${y.id}]`;
      });
      for (const nl of cq.ds_ngoai_le) {
        if (!nl.xac_nhan) continue;
        ds.push(`Hỏi: có ngoại lệ nào? Đáp: ${nl.noi_dung} [NL:${nl.id}]`);
      }
      return ds;
    }
    if (t.ten === "cac_buoc" || t.ten === "nghia_vu") {
      const ds = dongYeuCau("bat_buoc");
      return ds.length > 0 ? ds : undefined;
    }
    if (t.ten === "goi_y_hoat_dong") {
      const ds = dongYeuCau("giai_thich");
      return ds.length > 0 ? ds : undefined;
    }
    if (t.ten === "ghi_chu") return dongMoHo();
    if (t.ten === "bang_chung") {
      return [
        ...cq.ds_yeu_cau
          .filter((x) => x.xac_nhan)
          .map(
            (x) =>
              `${x.noi_dung} [YC:${x.id}]${x.nguon_tieu_de ? ` — nguồn: ${x.nguon_tieu_de}` : ""}`,
          ),
        ...cq.ds_ngoai_le
          .filter((x) => x.xac_nhan)
          .map((x) => `${x.noi_dung} [NL:${x.id}]`),
        ...cq.ds_fact_van_hanh
          .filter((x) => x.xac_nhan)
          .map((x) => `${x.tieu_de}: ${x.noi_dung} [FV:${x.id}]`),
      ];
    }
    if (t.ten === "con_thieu") {
      return [
        ...cq.ds_yeu_cau
          .filter((x) => !x.xac_nhan)
          .map(
            (x) =>
              `[CÂU HỎI: yêu cầu '${x.noi_dung.slice(0, 60)}' chưa có bằng chứng nguồn — cần thẩm quyền xác nhận.]`,
          ),
        ...cq.ds_ngoai_le
          .filter((x) => !x.xac_nhan)
          .map(
            (x) =>
              `[CÂU HỎI: ngoại lệ '${x.noi_dung.slice(0, 60)}' chưa có bằng chứng nguồn — cần thẩm quyền xác nhận.]`,
          ),
        ...cq.ds_fact_van_hanh
          .filter((x) => !x.xac_nhan)
          .map((x) => `[CÂU HỎI: fact '${x.tieu_de}' chưa có nguồn — cần xác nhận trước khi công bố.]`),
        ...dongMoHo(),
      ];
    }
    return undefined;
  }

  if (t.loai === "markdown" && (t.ten === "noi_dung" || t.ten === "gioi_thieu")) {
    // Thân bài giải thích chính sách: phạm vi + ngày hiệu lực → yêu cầu
    // bắt buộc → ngoại lệ → điểm giải thích → fact vận hành → điều khoản
    // mơ hồ đổ thành [CÂU HỎI]. Đơn giản hóa giữ nguyên bốn phần đó.
    const dong: string[] = [
      `Chính sách ${cq.ten}${cq.phien_ban ? ` (phiên bản ${cq.phien_ban})` : ""}.`,
    ];
    if (cq.ngay_hieu_luc) dong.push(`Có hiệu lực từ ${cq.ngay_hieu_luc}.`);
    if (cq.pham_vi_quyen_han) dong.push(`Áp dụng: ${cq.pham_vi_quyen_han}.`);
    const batBuoc = dongYeuCau("bat_buoc");
    if (batBuoc.length > 0) dong.push("", "**Bắt buộc:**", ...batBuoc.map((d) => `- ${d}`));
    const ngoaiLe = dongNgoaiLe();
    if (ngoaiLe.length > 0) dong.push("", "**Ngoại lệ:**", ...ngoaiLe.map((d) => `- ${d}`));
    const giaiThich = dongYeuCau("giai_thich");
    if (giaiThich.length > 0) dong.push("", "**Giải thích:**", ...giaiThich.map((d) => `- ${d}`));
    const fact = dongFact();
    if (fact.length > 0) dong.push("", "**Thông tin vận hành:**", ...fact.map((d) => `- ${d}`));
    const moHo = dongMoHo();
    if (moHo.length > 0) dong.push("", ...moHo);
    if (ctaChinh) dong.push("", `${ctaChinh.nhan}: ${ctaChinh.url}`);
    return dong.join("\n");
  }
  return undefined;
}

// Gán nội dung cho một trường theo kiểu — deterministic từ context.
function noiDungTruong(t: DinhNghiaTruong, ctx: ContextTask): string | string[] {
  if (ctx.phat_hanh) {
    const ph = noiDungTruongPhatHanh(t, ctx);
    if (ph !== undefined) return ph;
  }
  if (ctx.gay_quy) {
    const gq = noiDungTruongGayQuy(t, ctx);
    if (gq !== undefined) return gq;
  }
  if (ctx.cong_quyen) {
    const cq = noiDungTruongCongQuyen(t, ctx);
    if (cq !== undefined) return cq;
  }
  const dongMeta = [
    `Đối tượng: ${ctx.context_sinh?.doi_tuong?.ten || ctx.doi_tuong || "chung"}`,
    `Ngôn ngữ: ${ctx.ngon_ngu}`,
  ];
  if (ctx.context_sinh?.thuong_hieu?.ten) {
    dongMeta.push(`Thương hiệu: ${ctx.context_sinh.thuong_hieu.ten}`);
  }
  if (ctx.lap_truong) {
    dongMeta.push(`Lập trường: ${ctx.lap_truong}`);
  }
  if (ctx.phat_hanh) {
    dongMeta.push(
      `Phát hành: ${ctx.phat_hanh.ten}${ctx.phat_hanh.phien_ban ? ` ${ctx.phat_hanh.phien_ban}` : ""}`,
    );
  }
  if (ctx.gay_quy) {
    dongMeta.push(`Gây quỹ: ${ctx.gay_quy.ten}`);
  }
  if (ctx.cong_quyen) {
    dongMeta.push(
      `Chính sách: ${ctx.cong_quyen.ten}${ctx.cong_quyen.phien_ban ? ` ${ctx.cong_quyen.phien_ban}` : ""}`,
    );
  }
  const dongThieu = dongThieuChungCu(ctx);

  switch (t.loai) {
    case "van_ban": {
      let s: string;
      if (t.ten === "tieu_de") s = ctx.thong_diep.tieu_de;
      else if (t.ten === "tom_tat" || t.ten === "gioi_thieu" || t.ten === "hook") {
        s = cauDau(ctx.thong_diep.noi_dung || ctx.ds_nguon[0]?.noi_dung || ctx.thong_diep.tieu_de);
      } else if (t.ten === "lich_gui") {
        // Lịch gửi dự kiến lấy dòng thông báo chuẩn — mang sẵn ngày giờ và
        // múi giờ đã xác nhận ở intake (#7), không bịa thời điểm khác.
        s = cauDau(ctx.thong_diep.noi_dung || ctx.thong_diep.tieu_de);
      } else if (t.ten === "lien_ket") {
        // Link chỉ nhặt từ input thật (fact đặt hàng/nguồn) — không bịa URL.
        const m = /https?:\/\/\S+/.exec(
          [ctx.thong_diep.noi_dung, ...ctx.ds_nguon.map((n) => n.noi_dung)].join("\n"),
        );
        // \S+ có thể cuốn cả dấu câu cuối — cắt phần đuôi không phải URL.
        s = (m?.[0] ?? "").replace(/[.,;:!?)\]"']+$/, "");
      } else if (t.ten === "cta") s = `Tìm hiểu thêm: ${ctx.thong_diep.tieu_de}`;
      else if (t.ten === "hashtag") s = `#mai #${ctx.dinh_dang?.id ?? "noi-dung"}`;
      else s = ctx.thong_diep.tieu_de;
      return catChuoi(s, t.do_dai_toi_da);
    }
    case "markdown": {
      const dong: string[] = [];
      if (t.ten !== "noi_dung") dong.push(`## ${t.nhan}`);
      dong.push(cauDau(ctx.thong_diep.noi_dung) || ctx.thong_diep.tieu_de);
      for (const [i, n] of ctx.ds_nguon.entries()) {
        const trich = cauDau(n.noi_dung);
        if (trich) dong.push(`\n${trich} [src${i + 1}]`);
      }
      if (dongThieu.length > 0) dong.push("", ...dongThieu);
      dong.push("", `— ${dongMeta.join(" · ")}`);
      return catChuoi(dong.join("\n"), t.do_dai_toi_da);
    }
    case "danh_sach": {
      // Một mục cho mỗi nguồn (có đánh số để khớp trích dẫn); thiếu nguồn →
      // một mục từ thông điệp. CTA/cảnh gợi ý vẫn là mục văn bản fixture.
      const goc =
        ctx.ds_nguon.length === 0
          ? [cauDau(ctx.thong_diep.noi_dung) || ctx.thong_diep.tieu_de]
          : ctx.ds_nguon.map((n, i) => `${n.tieu_de}: ${cauDau(n.noi_dung)} [src${i + 1}]`);
      const dsMuc = t.so_muc_toi_da ? goc.slice(0, t.so_muc_toi_da) : goc;
      return dsMuc.map((m) => catChuoi(m, t.do_dai_toi_da));
    }
  }
}

function sinhNhapBth(ctx: ContextTask): KetQuaTask {
  const def = ctx.dinh_dang;
  const fields: Record<string, string | string[]> = {};
  for (const t of def?.truong ?? []) {
    fields[t.ten] = noiDungTruong(t, ctx);
  }
  // Trần đầu ra: cắt nội dung markdown quá dài trước khi serialize.
  const json = JSON.stringify(fields);
  let noiDung = json;
  if (json.length > ctx.gioi_han_dau_ra) {
    for (const t of def?.truong ?? []) {
      const v = fields[t.ten];
      if (t.loai === "markdown" && typeof v === "string" && v.length > ctx.gioi_han_dau_ra / 2) {
        fields[t.ten] = `${v.slice(0, Math.floor(ctx.gioi_han_dau_ra / 2))}\n[...]`;
      }
    }
    noiDung = JSON.stringify(fields);
  }
  return { noi_dung: noiDung, trich_dan: trichTatCa(ctx.ds_nguon), canh_bao: [] };
}

export const fixture = {
  ten: "fixture",
  la_fixture: true,
  async sinh(ctx: ContextTask): Promise<KetQuaTask> {
    switch (ctx.task.id) {
      case "nhap_ban_the_hien":
        return sinhNhapBth(ctx);
      case "lap_ke_hoach":
        // Đề xuất đầu ra: bài viết + caption theo đối tượng hiện có.
        return {
          noi_dung: JSON.stringify({
            ds_dau_ra: [
              { dinh_dang: "bai-viet", doi_tuong: ctx.doi_tuong || "chung", ly_do: "kênh sở hữu đầy đủ" },
              { dinh_dang: "caption", doi_tuong: ctx.doi_tuong || "chung", ly_do: "điểm chạm mạng xã hội" },
            ],
          }),
          trich_dan: trichTatCa(ctx.ds_nguon),
          canh_bao: [],
        };
      case "localize":
        // Fixture không dịch thật: giữ nguyên trường, đánh dấu ngôn ngữ đích.
        // Contract noi_dung luôn là canonical JSON như adapter live.
        return {
          noi_dung: JSON.stringify({ noi_dung: ctx.thong_diep.noi_dung }),
          trich_dan: trichTatCa(ctx.ds_nguon),
          canh_bao: [`fixture không dịch thật — trả nguyên văn (đích: ${ctx.ngon_ngu}).`],
        };
      case "de_xuat_revision":
        return {
          noi_dung: JSON.stringify({ noi_dung: ctx.thong_diep.noi_dung }),
          trich_dan: trichTatCa(ctx.ds_nguon),
          canh_bao: ["fixture giữ nguyên nội dung gốc — đề xuất cần review người."],
        };
      default:
        throw new Error(`Fixture không hỗ trợ task: ${ctx.task.id}`);
    }
  },
};
