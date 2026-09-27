// Read consecutively hosted BPS parts without retaining the whole patch in memory.
export async function* hostedPatch(selected, baseUrl = document.baseURI) {
  const urls = selected.patch_parts ?? [selected.patch_url];
  let received = 0;
  for (let i = 0; i < urls.length; i++) {
    const response = await fetch(new URL(urls[i], baseUrl), { cache: 'no-store' });
    if (!response.ok || !response.body) throw new Error(`ดาวน์โหลดแพตช์ส่วนที่ ${i + 1} ไม่สำเร็จ (HTTP ${response.status})`);
    for await (const chunk of response.body) {
      received += chunk.length;
      if (received > selected.patch_size) throw new Error('ขนาดแพตช์บนเว็บเกินค่าที่กำหนด');
      yield chunk;
    }
  }
  if (received !== selected.patch_size) throw new Error('แพตช์บนเว็บดาวน์โหลดไม่ครบ');
}
