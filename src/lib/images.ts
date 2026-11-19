import { OPS } from 'pdfjs-dist';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { getImages, putImages } from './db';
import type { StoredImage } from './types';

export const MIN_IMAGE_SIDE = 120;
export const MAX_PAGE_COVERAGE = 0.8;

interface PdfImgObj {
  width: number;
  height: number;
  data?: Uint8Array | Uint8ClampedArray;
  kind?: number;
  bitmap?: ImageBitmap;
}

type Matrix = [number, number, number, number, number, number];
const mul = (m: Matrix, n: Matrix): Matrix => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
];

/** Có nên giữ ảnh này không (bỏ ảnh nhỏ và ảnh phủ gần hết trang như trang scan). */
export function keepImage(w: number, h: number, drawnArea: number, pageArea: number): boolean {
  if (w < MIN_IMAGE_SIDE || h < MIN_IMAGE_SIDE) return false;
  if (pageArea > 0 && drawnArea / pageArea > MAX_PAGE_COVERAGE) return false;
  return true;
}

function getObj(page: { objs: { get: (id: string, cb: (o: unknown) => void) => void }; commonObjs: { get: (id: string, cb: (o: unknown) => void) => void } }, id: string): Promise<PdfImgObj | null> {
  const store = id.startsWith('g_') ? page.commonObjs : page.objs;
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(null), 8000);
    try {
      store.get(id, (o) => {
        clearTimeout(t);
        resolve((o as PdfImgObj) ?? null);
      });
    } catch {
      clearTimeout(t);
      resolve(null);
    }
  });
}

function toCanvas(img: PdfImgObj): HTMLCanvasElement | null {
  const { width, height } = img;
  if (!width || !height) return null;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  if (img.bitmap) {
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img.bitmap, 0, 0);
    return canvas;
  }
  if (!img.data) return null;
  const out = ctx.createImageData(width, height);
  const d = out.data;
  const s = img.data;
  if (img.kind === 3 || s.length === width * height * 4) {
    d.set(s.subarray(0, d.length));
  } else if (img.kind === 2 || s.length === width * height * 3) {
    for (let i = 0, j = 0; i < width * height; i++, j += 3) {
      d[i * 4] = s[j];
      d[i * 4 + 1] = s[j + 1];
      d[i * 4 + 2] = s[j + 2];
      d[i * 4 + 3] = 255;
    }
  } else if (img.kind === 1) {
    const rowBytes = (width + 7) >> 3;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const bit = (s[y * rowBytes + (x >> 3)] >> (7 - (x & 7))) & 1;
        const v = bit ? 255 : 0;
        const k = (y * width + x) * 4;
        d[k] = d[k + 1] = d[k + 2] = v;
        d[k + 3] = 255;
      }
    }
  } else return null;
  ctx.putImageData(out, 0, 0);
  return canvas;
}

function canvasToBlob(c: HTMLCanvasElement): Promise<Blob> {
  const big = c.width * c.height > 300_000;
  return new Promise((resolve, reject) => {
    if (big) {
      // nền trắng để JPEG không bị đen ở vùng trong suốt
      const flat = document.createElement('canvas');
      flat.width = c.width;
      flat.height = c.height;
      const fctx = flat.getContext('2d')!;
      fctx.fillStyle = '#fff';
      fctx.fillRect(0, 0, flat.width, flat.height);
      fctx.drawImage(c, 0, 0);
      flat.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob'))), 'image/jpeg', 0.85);
    } else {
      c.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob'))), 'image/png');
    }
  });
}

/** Trích ảnh raster nhúng trong một trang. */
export async function extractPageImages(doc: PDFDocumentProxy, pageNo: number): Promise<StoredImage['items']> {
  const page = await doc.getPage(pageNo);
  const view = page.view; // [x0,y0,x1,y1]
  const pageArea = Math.abs((view[2] - view[0]) * (view[3] - view[1]));
  const ops = await page.getOperatorList();
  const stack: Matrix[] = [];
  let ctm: Matrix = [1, 0, 0, 1, 0, 0];
  const seen = new Set<string>();
  const items: StoredImage['items'] = [];
  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i];
    const args = ops.argsArray[i] as unknown[];
    if (fn === OPS.save) stack.push([...ctm] as Matrix);
    else if (fn === OPS.restore) ctm = stack.pop() ?? [1, 0, 0, 1, 0, 0];
    else if (fn === OPS.transform) ctm = mul(ctm, args as unknown as Matrix);
    else if (fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject) {
      const drawn = Math.abs(ctm[0] * ctm[3] - ctm[1] * ctm[2]);
      let img: PdfImgObj | null = null;
      let key = '';
      if (fn === OPS.paintImageXObject) {
        key = String(args[0]);
        if (seen.has(key)) continue;
        img = await getObj(page as never, key);
      } else {
        img = args[0] as PdfImgObj;
        key = `inline-${i}`;
      }
      seen.add(key);
      if (!img || !keepImage(img.width, img.height, drawn, pageArea)) continue;
      const canvas = toCanvas(img);
      if (!canvas) continue;
      try {
        items.push({ blob: await canvasToBlob(canvas), width: img.width, height: img.height });
      } catch {
        /* bỏ ảnh lỗi */
      }
    }
  }
  page.cleanup();
  return items;
}

/** Lấy ảnh của trang từ cache IndexedDB, trích mới nếu chưa có. */
export async function getPageImages(jobId: string, doc: PDFDocumentProxy, pageNo: number): Promise<StoredImage['items']> {
  const cached = await getImages(jobId, pageNo);
  if (cached) return cached.items;
  let items: StoredImage['items'] = [];
  try {
    items = await extractPageImages(doc, pageNo);
  } catch (e) {
    console.warn('Không trích được ảnh trang', pageNo, e);
  }
  await putImages({ jobId, page: pageNo, items });
  return items;
}
