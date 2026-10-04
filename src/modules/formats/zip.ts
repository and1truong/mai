// ZIP deterministic: entry STORE (không nén), timestamp DOS cố định,
// file sắp theo đường dẫn. Cùng danh sách file → cùng byte output —
// tiêu chí "bundle tải về deterministic" của #19.

const BANG_CRC = (() => {
  const bang = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    bang[n] = c >>> 0;
  }
  return bang;
})();

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of buf) c = BANG_CRC[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export type TepZip = { duong_dan: string; noi_dung: Uint8Array };

export function taoZip(dsTep: TepZip[]): Uint8Array<ArrayBuffer> {
  const ds = [...dsTep].sort((a, b) => (a.duong_dan < b.duong_dan ? -1 : 1));
  const enc = new TextEncoder();
  const phan: Uint8Array[] = [];
  const trungTam: Uint8Array[] = [];
  let offset = 0;

  const ghiLocal = (ten: Uint8Array, crc: number, n: number) => {
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); // local file header
    h.setUint16(4, 20, true); // version needed
    h.setUint16(6, 0x0800, true); // flags: tên UTF-8
    h.setUint16(8, 0, true); // method: STORE
    h.setUint16(10, 0, true); // mod time cố định
    h.setUint16(12, 0, true); // mod date cố định
    h.setUint32(14, crc, true);
    h.setUint32(18, n, true); // comp size = uncomp (STORE)
    h.setUint32(22, n, true);
    h.setUint16(26, ten.length, true);
    h.setUint16(28, 0, true); // extra len
    return new Uint8Array(h.buffer);
  };

  const ghiTrungTam = (ten: Uint8Array, crc: number, n: number, off: number) => {
    const h = new DataView(new ArrayBuffer(46));
    h.setUint32(0, 0x02014b50, true); // central directory header
    h.setUint16(4, 20, true); // version made by
    h.setUint16(6, 20, true); // version needed
    h.setUint16(8, 0x0800, true);
    h.setUint16(10, 0, true);
    h.setUint16(12, 0, true);
    h.setUint16(14, 0, true);
    h.setUint32(16, crc, true);
    h.setUint32(20, n, true);
    h.setUint32(24, n, true);
    h.setUint16(28, ten.length, true);
    h.setUint16(30, 0, true); // extra
    h.setUint16(32, 0, true); // comment
    h.setUint16(34, 0, true); // disk
    h.setUint16(36, 0, true); // internal attrs
    h.setUint32(38, 0, true); // external attrs
    h.setUint32(42, off, true);
    return new Uint8Array(h.buffer);
  };

  for (const tep of ds) {
    const ten = enc.encode(tep.duong_dan);
    const crc = crc32(tep.noi_dung);
    phan.push(ghiLocal(ten, crc, tep.noi_dung.length), ten, tep.noi_dung);
    trungTam.push(ghiTrungTam(ten, crc, tep.noi_dung.length, offset), ten);
    offset += 30 + ten.length + tep.noi_dung.length;
  }

  let cdLen = 0;
  for (const h of trungTam) cdLen += h.length;
  const eo = new DataView(new ArrayBuffer(22));
  eo.setUint32(0, 0x06054b50, true); // end of central directory
  eo.setUint16(8, ds.length, true);
  eo.setUint16(10, ds.length, true);
  eo.setUint32(12, cdLen, true);
  eo.setUint32(16, offset, true);

  const tong =
    offset + cdLen + 22;
  const ra = new Uint8Array(tong);
  let p = 0;
  for (const c of phan) {
    ra.set(c, p);
    p += c.length;
  }
  for (const c of trungTam) {
    ra.set(c, p);
    p += c.length;
  }
  ra.set(new Uint8Array(eo.buffer), p);
  return ra;
}
