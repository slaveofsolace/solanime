import { deflateSync } from 'node:zlib';

/** A deterministic, valid PNG used only in tests, never delivered as catalogue artwork. */
export function artworkTestPng(width = 460, height = 650): Uint8Array<ArrayBuffer> {
  const chunk = (type: string, payload: Uint8Array) => {
    const data = Buffer.concat([Buffer.from(type),payload]); let crc = 0xffffffff;
    for (const byte of data) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
    const result = Buffer.alloc(payload.length+12); result.writeUInt32BE(payload.length); data.copy(result,4); result.writeUInt32BE((crc ^ 0xffffffff) >>> 0,result.length-4); return result;
  };
  const header = Buffer.alloc(13); header.writeUInt32BE(width,0); header.writeUInt32BE(height,4); header[8]=8; header[9]=2;
  const bytes = Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(Buffer.alloc(height*(width*3+1)))),chunk('IEND',Buffer.alloc(0))]);
  const output = new Uint8Array(bytes.length); output.set(bytes); return output;
}
