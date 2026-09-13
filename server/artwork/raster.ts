/** Bounded container validation before trusting dimensions. This is not a full pixel-decoder or malware verdict. */
export function completeRaster(bytes: Uint8Array, format: 'jpeg' | 'png' | 'webp'): boolean {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.subarray(start, end));
  if (format === 'jpeg') {
    if (bytes.length < 40 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes.at(-2) !== 0xff || bytes.at(-1) !== 0xd9) return false;
    let offset = 2; let frame = false;
    while (offset + 4 < bytes.length) {
      if (bytes[offset++] !== 0xff) return false;
      while (bytes[offset] === 0xff) offset++;
      const marker = bytes[offset++];
      if (marker === 0xda) { const length = view.getUint16(offset); return frame && length >= 6 && offset + length < bytes.length - 2; }
      if (marker === 0xd9 || marker === 0x00) return false;
      if (marker === 1 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      const length = view.getUint16(offset);
      if (length < 2 || offset + length > bytes.length - 2) return false;
      if ([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)) { if (length < 8) return false; frame = true; }
      offset += length;
    }
    return false;
  }
  if (format === 'webp') {
    if (bytes.length < 30 || ascii(0,4) !== 'RIFF' || ascii(8,12) !== 'WEBP' || view.getUint32(4,true) + 8 !== bytes.length) return false;
    let offset = 12; let frame = false;
    while (offset + 8 <= bytes.length) {
      const type = ascii(offset,offset+4); const length = view.getUint32(offset+4,true); offset += 8;
      if (!length || offset + length > bytes.length) return false;
      if (type === 'VP8 ') { if (length < 10 || bytes[offset+3] !== 0x9d || bytes[offset+4] !== 0x01 || bytes[offset+5] !== 0x2a) return false; frame = true; }
      if (type === 'VP8L') { if (length < 5 || bytes[offset] !== 0x2f) return false; frame = true; }
      // Animated banners are deliberately unsupported until a separate decode/frame budget is established.
      if (type === 'ANIM' || type === 'ANMF') return false;
      offset += length + (length % 2);
    }
    return frame && offset === bytes.length;
  }
  if (bytes.length < 57 || [137,80,78,71,13,10,26,10].some((value,index) => bytes[index] !== value)) return false;
  let offset = 8; let header = false; let data = false;
  while (offset + 12 <= bytes.length) {
    const length = view.getUint32(offset); const type = ascii(offset+4,offset+8);
    if (length > bytes.length - offset - 12) return false;
    if (!header && (type !== 'IHDR' || length !== 13)) return false;
    if (type === 'IHDR') { if (header || length !== 13) return false; header = true; }
    if (type === 'IDAT') { if (!length) return false; data = true; }
    if (type === 'acTL') return false;
    let crc = 0xffffffff;
    for (let index = offset + 4; index < offset + 8 + length; index++) {
      crc ^= bytes[index];
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
    if (((crc ^ 0xffffffff) >>> 0) !== view.getUint32(offset+8+length)) return false;
    offset += length + 12;
    if (type === 'IEND') return header && data && length === 0 && offset === bytes.length;
  }
  return false;
}
