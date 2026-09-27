// Streaming BPS reader for the two release-candidate patches. No full-disc buffers.
const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  CRC_TABLE[n] = c >>> 0;
}

export class CRC32 {
  constructor() { this.value = 0xffffffff; }
  update(bytes) {
    let c = this.value;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 255] ^ (c >>> 8);
    this.value = c >>> 0;
  }
  hex() { return ((this.value ^ 0xffffffff) >>> 0).toString(16).padStart(8, '0'); }
  number() { return (this.value ^ 0xffffffff) >>> 0; }
}

export async function crcOfFile(file, onProgress = () => {}) {
  const crc = new CRC32();
  let bytes = 0;
  for await (const chunk of file.stream()) {
    crc.update(chunk);
    bytes += chunk.length;
    onProgress(bytes, file.size);
  }
  return crc.hex();
}

class PatchReader {
  constructor(stream) {
    this.iterator = stream[Symbol.asyncIterator]();
    this.chunk = new Uint8Array(0);
    this.offset = 0;
    this.consumed = 0;
    this.crc = new CRC32();
  }
  async take(max, checksum = true) {
    while (this.offset === this.chunk.length) {
      const next = await this.iterator.next();
      if (next.done) throw new Error('ไฟล์แพตช์ขาดข้อมูล');
      this.chunk = next.value;
      this.offset = 0;
    }
    const end = Math.min(this.offset + max, this.chunk.length);
    const out = this.chunk.subarray(this.offset, end);
    this.offset = end;
    this.consumed += out.length;
    if (checksum) this.crc.update(out);
    return out;
  }
  async byte(checksum = true) { return (await this.take(1, checksum))[0]; }
  async number() {
    let value = 0;
    let multiplier = 1;
    for (;;) {
      const byte = await this.byte();
      value += (byte & 127) * multiplier;
      if (!Number.isSafeInteger(value)) throw new Error('ขนาดในแพตช์ไม่ถูกต้อง');
      if (byte & 128) return value;
      multiplier *= 128;
      value += multiplier;
    }
  }
  async u32(checksum = true) {
    let result = 0;
    for (let i = 0; i < 4; i++) result |= (await this.byte(checksum)) << (i * 8);
    return result >>> 0;
  }
  async atEnd() {
    if (this.offset < this.chunk.length) return false;
    return (await this.iterator.next()).done === true;
  }
}

export async function applyBps({ source, patchStream, output, expected, sourceCrcVerified, onProgress = () => {} }) {
  if (source.size !== expected.source_size) throw new Error('ขนาดไฟล์ต้นฉบับไม่ตรงกับแผ่นที่เลือก');
  const sourceCrc = sourceCrcVerified ?? await crcOfFile(source, (done, total) => onProgress('check', done, total));
  if (sourceCrc !== expected.source_crc32) throw new Error('CRC32 ไฟล์ต้นฉบับไม่ตรง กรุณาใช้ BIN ต้นฉบับ Japan/Asia ที่ยังไม่แก้ไข');

  const patch = new PatchReader(patchStream);
  for (const letter of [66, 80, 83, 49]) {
    if (await patch.byte() !== letter) throw new Error('ไฟล์แพตช์ไม่ใช่ BPS');
  }
  const sourceSize = await patch.number();
  const targetSize = await patch.number();
  const metadataSize = await patch.number();
  if (sourceSize !== source.size || targetSize !== expected.target_size || metadataSize > 1048576) {
    throw new Error('ข้อมูลขนาดในแพตช์ไม่ตรง');
  }
  for (let left = metadataSize; left > 0;) left -= (await patch.take(Math.min(left, 1048576))).length;

  const targetCrc = new CRC32();
  let position = 0;
  while (position < targetSize) {
    const action = await patch.number();
    const length = Math.floor(action / 4) + 1;
    const kind = action % 4;
    if (length > targetSize - position) throw new Error('คำสั่งในแพตช์เกินขนาดไฟล์');
    if (kind !== 0 && kind !== 1) throw new Error('แพตช์ชนิดนี้มีคำสั่งที่ตัวอ่านยังไม่รองรับ');
    for (let left = length; left > 0;) {
      const count = Math.min(left, 1024 * 1024);
      const bytes = kind === 0
        ? new Uint8Array(await source.slice(position, position + count).arrayBuffer())
        : await patch.take(count);
      if (bytes.length === 0) throw new Error('อ่านข้อมูลแพตช์ไม่ครบ');
      await output.write(bytes);
      targetCrc.update(bytes);
      position += bytes.length;
      left -= bytes.length;
      onProgress('patch', position, targetSize);
    }
  }
  const patchSourceCrc = await patch.u32();
  const patchTargetCrc = await patch.u32();
  const actualPatchCrc = patch.crc.number();
  const patchCrc = await patch.u32(false);
  if (patch.consumed !== expected.patch_size || !(await patch.atEnd())) throw new Error('ขนาดไฟล์แพตช์ไม่ตรง');
  if (patchSourceCrc !== parseInt(expected.source_crc32, 16) ||
      patchTargetCrc !== targetCrc.number() ||
      patchTargetCrc !== parseInt(expected.target_crc32, 16) ||
      patchCrc !== actualPatchCrc ||
      patchCrc !== parseInt(expected.patch_crc32, 16)) {
    throw new Error('ตรวจสอบข้อมูลหลังแพตช์ไม่ผ่าน');
  }
  return { sourceCrc, targetCrc: targetCrc.hex(), patchCrc: patch.crc.hex() };
}
