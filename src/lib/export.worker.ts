/// <reference lib="webworker" />
import pdfMake from 'pdfmake/build/pdfmake';
import regularUrl from '../assets/fonts/NotoSerif-Regular.ttf?url';
import boldUrl from '../assets/fonts/NotoSerif-Bold.ttf?url';
import italicUrl from '../assets/fonts/NotoSerif-Italic.ttf?url';
import boldItalicUrl from '../assets/fonts/NotoSerif-BoldItalic.ttf?url';

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

async function loadFonts() {
  const files: Record<string, string> = {
    'NotoSerif-Regular.ttf': regularUrl,
    'NotoSerif-Bold.ttf': boldUrl,
    'NotoSerif-Italic.ttf': italicUrl,
    'NotoSerif-BoldItalic.ttf': boldItalicUrl,
  };
  const vfs: Record<string, string> = {};
  for (const [name, url] of Object.entries(files)) {
    const r = await fetch(url);
    if (!r.ok) throw new Error('Không tải được phông chữ ' + name);
    vfs[name] = toBase64(await r.arrayBuffer());
  }
  (pdfMake as unknown as { addVirtualFileSystem(v: Record<string, string>): void }).addVirtualFileSystem(vfs);
  pdfMake.addFonts({
    NotoSerif: {
      normal: 'NotoSerif-Regular.ttf',
      bold: 'NotoSerif-Bold.ttf',
      italics: 'NotoSerif-Italic.ttf',
      bolditalics: 'NotoSerif-BoldItalic.ttf',
    },
  });
}

self.onmessage = async (ev: MessageEvent<{ docDefinition: Record<string, unknown> }>) => {
  try {
    await loadFonts();
    const def = ev.data.docDefinition;
    def.footer = (currentPage: number) => ({ text: String(currentPage), alignment: 'center', fontSize: 8, color: '#666666', margin: [0, 20, 0, 0] });
    (pdfMake as unknown as { setProgressCallback(cb: (p: number) => void): void }).setProgressCallback((p) => self.postMessage({ type: 'progress', value: p }));
    const buf = await pdfMake.createPdf(def as never).getBuffer();
    const u8 = new Uint8Array(buf);
    const copy = u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
    self.postMessage({ type: 'done', buffer: copy }, [copy]);
  } catch (e) {
    self.postMessage({ type: 'error', message: e instanceof Error ? e.message : String(e) });
  }
};
