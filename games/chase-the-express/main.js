import { applyBps, crcOfFile } from './bps.js';
import { hostedPatch } from './hosted-patch.js';

const sourceInput = document.querySelector('#source');
const patchInput = document.querySelector('#local-patch');
const sourceName = document.querySelector('#source-name');
const patchName = document.querySelector('#patch-name');
const expectedLabel = document.querySelector('#expected');
const start = document.querySelector('#start');
const status = document.querySelector('#status');
const bar = document.querySelector('#bar');
const result = document.querySelector('#result');
const cueButton = document.querySelector('#cue');
let config;
let discNumber = 1;
let busy = false;
let lastProgress = 0;
const assetBase = new URL('.', import.meta.url);

function disc() { return config.discs.find(item => item.disc === discNumber); }
function size(bytes) { return `${(bytes / 1048576).toFixed(1)} MiB`; }
function show(message, percent = 0) { status.textContent = message; bar.value = percent; }
function refresh() {
  if (!config) return;
  const selected = disc();
  const source = sourceInput.files[0];
  sourceName.textContent = source ? source.name : 'เลือกไฟล์ BIN';
  patchName.textContent = patchInput.files[0]?.name ?? 'ไม่เลือก — ใช้แพตช์จากเว็บ';
  expectedLabel.textContent = `แผ่น ${discNumber}: BIN ต้นฉบับ ${size(selected.source_size)} · CRC32 ${selected.source_crc32}`;
  start.disabled = busy || !source || source.size !== selected.source_size || !('showSaveFilePicker' in window);
  if (!busy) {
    result.hidden = true;
    if (!('showSaveFilePicker' in window)) show('เบราว์เซอร์นี้ยังไม่รองรับการบันทึกไฟล์ใหญ่โดยตรง กรุณาใช้ Chrome หรือ Edge บนคอมพิวเตอร์');
    else if (source && source.size !== selected.source_size) show('ขนาด BIN ไม่ตรงกับแผ่นที่เลือก ตรวจสอบแผ่นและไฟล์ต้นฉบับ');
    else if (source) show('พร้อมตรวจสอบและลงแพตช์');
    else show('กรุณาเลือกไฟล์ BIN');
  }
}

for (const button of document.querySelectorAll('.disc')) {
  button.addEventListener('click', () => {
    if (busy) return;
    discNumber = Number(button.dataset.disc);
    for (const item of document.querySelectorAll('.disc')) item.classList.toggle('active', item === button);
    refresh();
  });
}
sourceInput.addEventListener('change', refresh);
patchInput.addEventListener('change', refresh);

start.addEventListener('click', async () => {
  if (busy || !sourceInput.files[0]) return;
  const selected = disc();
  const original = sourceInput.files[0];
  let handle;
  try {
    // This call must happen directly from the click gesture.
    handle = await window.showSaveFilePicker({
      suggestedName: selected.target_bin,
      types: [{ description: 'PlayStation BIN', accept: { 'application/octet-stream': ['.bin'] } }]
    });
  } catch (error) {
    if (error.name !== 'AbortError') show(`เลือกตำแหน่งบันทึกไม่สำเร็จ: ${error.message}`);
    return;
  }

  busy = true;
  start.disabled = true;
  result.hidden = true;
  let writable;
  try {
    if (handle.name.toLowerCase() === original.name.toLowerCase()) {
      throw new Error('กรุณาบันทึก BIN ใหม่ด้วยชื่ออื่น เพื่อไม่ให้ทับไฟล์ต้นฉบับ');
    }
    const localPatch = patchInput.files[0];
    if (localPatch && localPatch.size !== selected.patch_size) throw new Error('ขนาดไฟล์ BPS ไม่ตรงกับแผ่นที่เลือก');
    const progress = (phase, done, total) => {
      const now = performance.now();
      if (now - lastProgress < 100 && done !== total) return;
      lastProgress = now;
      show(phase === 'check'
        ? `กำลังตรวจสอบ BIN ต้นฉบับ: ${Math.round(done / total * 100)}%`
        : `กำลังลงแพตช์: ${Math.round(done / total * 100)}%`,
      phase === 'check' ? done / total * 15 : 15 + done / total * 85);
    };
    show('กำลังตรวจสอบ BIN ต้นฉบับ…');
    const sourceCrcVerified = await crcOfFile(original, (done, total) => progress('check', done, total));
    if (sourceCrcVerified !== selected.source_crc32) {
      throw new Error('CRC32 ไฟล์ต้นฉบับไม่ตรง กรุณาใช้ BIN ต้นฉบับ Japan/Asia ที่ยังไม่แก้ไข');
    }

    const patchStream = localPatch ? localPatch.stream() : hostedPatch(selected, assetBase);
    writable = await handle.createWritable();
    await applyBps({ source: original, patchStream, output: writable, expected: selected, sourceCrcVerified, onProgress: progress });
    await writable.close();
    writable = undefined;
    show('แพตช์สำเร็จ ตรวจสอบข้อมูลผ่าน', 100);
    result.hidden = false;
  } catch (error) {
    if (writable) await writable.abort().catch(() => {});
    show(`ไม่สำเร็จ: ${error.message}`);
  } finally {
    busy = false;
    start.disabled = false;
  }
});

cueButton.addEventListener('click', () => {
  const name = disc().target_bin;
  const text = `FILE "${name}" BINARY\r\n  TRACK 01 MODE2/2352\r\n    INDEX 01 00:00:00\r\n`;
  const url = URL.createObjectURL(new Blob([text], { type: 'application/octet-stream' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name.replace(/\.bin$/i, '.cue');
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
});

try {
  const response = await fetch(new URL('config.json', assetBase), { cache: 'no-store' });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  config = await response.json();
  refresh();
} catch (error) {
  show(`โหลดรายการแพตช์ไม่สำเร็จ: ${error.message}`);
}
