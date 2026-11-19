import * as store from './db';
import { buildDocDefinition, pagesNeedingImages, type ExportImage } from './docdef';
import { getPageImages } from './images';
import { closePdf, openPdf } from './pdfinfo';
import { safeFileName } from './bytes';
import type { Job } from './types';

export interface ExportProgress {
  phase: 'images' | 'build';
  done: number;
  total: number;
}

function blobToDataUrl(b: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(b);
  });
}

async function buildInWorker(docDefinition: Record<string, unknown>): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./export.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (ev: MessageEvent) => {
      if (ev.data.type === 'done') {
        worker.terminate();
        resolve(ev.data.buffer);
      } else if (ev.data.type === 'error') {
        worker.terminate();
        reject(new Error(ev.data.message));
      }
    };
    worker.onerror = (ev) => {
      worker.terminate();
      reject(new Error(ev.message || 'Lỗi trong tiến trình tạo PDF'));
    };
    worker.postMessage({ docDefinition });
  });
}

export function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Xuất bản dịch (kể cả một phần) ra PDF tiếng Việt và tải về. */
export async function exportJobPdf(job: Job, onProgress?: (p: ExportProgress) => void): Promise<void> {
  const chunks = await store.getChunks(job.id);
  const exportChunks = chunks.map((c) => ({ startPage: c.startPage, endPage: c.endPage, status: c.status, text: c.text }));
  const pages = pagesNeedingImages(exportChunks);
  const images = new Map<number, ExportImage[]>();
  const dataUrls: Record<string, string> = {};

  const blob = await store.getPdf(job.id);
  if (blob && pages.length) {
    const doc = await openPdf(blob);
    let n = 0;
    for (const p of pages) {
      const items = await getPageImages(job.id, doc, p);
      const list: ExportImage[] = [];
      for (let k = 0; k < items.length; k++) {
        const name = `img-${p}-${k}`;
        dataUrls[name] = await blobToDataUrl(items[k].blob);
        list.push({ name, width: items[k].width, height: items[k].height });
      }
      if (list.length) images.set(p, list);
      onProgress?.({ phase: 'images', done: ++n, total: pages.length });
    }
    await closePdf(doc);
  }

  onProgress?.({ phase: 'build', done: 0, total: 1 });
  const def = buildDocDefinition({
    title: job.title,
    model: job.model,
    totalPages: job.pages,
    chunks: exportChunks,
    images,
    date: new Date().toLocaleDateString('vi-VN'),
  });
  def.images = dataUrls;
  const buf = await buildInWorker(def);
  downloadBlob(new Blob([buf], { type: 'application/pdf' }), `${safeFileName(job.title)} - Tieng Viet.pdf`);
  onProgress?.({ phase: 'build', done: 1, total: 1 });
}
