import type { PDFDocumentProxy } from 'pdfjs-dist';
import * as store from '../lib/db';
import { closePdf, openPdf, renderPage } from '../lib/pdfinfo';
import { isRunning, runRealtime, subscribe } from '../lib/runner';
import { loadSettings } from '../lib/settings';
import { costOf, formatUsd } from '../lib/models';
import { $, CHUNK_LABEL, esc, mdToHtml } from './util';

export async function renderChunk(root: HTMLElement, jobId: string, index: number): Promise<() => void> {
  const job = await store.getJob(jobId);
  const chunk = await store.getChunk(jobId, index);
  if (!job || !chunk) {
    root.innerHTML = '<p>Không tìm thấy đoạn. <a href="#/">Về trang chủ</a></p>';
    return () => undefined;
  }
  let editing = false;
  let doc: PDFDocumentProxy | null = null;
  let disposed = false;
  let thumbsDone = false;

  const draw = async () => {
    const c = (await store.getChunk(jobId, index)) ?? chunk;
    const cost = c.usage ? formatUsd(costOf(c.usage, c.model ?? job.model, c.mode === 'batch')) : '—';
    const pagesLabel = c.startPage === c.endPage ? `trang ${c.startPage}` : `trang ${c.startPage}–${c.endPage}`;
    root.innerHTML = `
      <header class="top"><a class="back" href="#/job/${jobId}">‹ ${esc(job.title)}</a>
        <span class="row">${index > 0 ? `<a class="btn" href="#/job/${jobId}/chunk/${index - 1}">‹</a>` : ''}<a class="btn" href="#/job/${jobId}/chunk/${index + 1}" id="next">›</a></span></header>
      <div class="card">
        <div class="row"><b class="grow">Đoạn ${index + 1} · ${pagesLabel}</b><span class="badge ${c.status}">${CHUNK_LABEL[c.status]}</span></div>
        <div class="muted small">Chi phí đoạn: ${cost}${c.usage ? ` · ${c.usage.input} vào / ${c.usage.output} ra / ${c.usage.cacheRead} cache đọc` : ''}</div>
        ${c.error ? `<div class="alert error">${esc(c.error)}</div>` : ''}
        <div class="row" style="margin-top:8px">
          <button data-act="edit">${editing ? 'Xem' : 'Sửa tay'}</button>
          <button data-act="retranslate" ${isRunning(jobId) ? 'disabled' : ''}>Dịch lại đoạn này</button>
        </div>
      </div>
      <div class="split">
        <div class="card"><h2>Bản gốc</h2><div class="thumbs" id="thumbs"><span class="muted">Đang vẽ trang…</span></div></div>
        <div class="card"><h2>Bản dịch</h2>
          ${
            editing
              ? `<textarea id="txt" class="edit-area">${esc(c.text)}</textarea><div class="row" style="margin-top:8px"><button class="primary" data-act="save">Lưu</button><button data-act="edit">Hủy</button></div>
                 <div class="field-note">Markdown nhẹ: # tiêu đề, - danh sách, bảng |…|, dòng &lt;&lt;&lt;PAGE n&gt;&gt;&gt; đánh dấu trang gốc.</div>`
              : c.text
                ? `<div class="preview">${mdToHtml(c.text)}</div>`
                : '<p class="muted">Chưa có bản dịch.</p>'
          }
        </div>
      </div>`;
    thumbsDone = false;
    void thumbs(c.startPage, c.endPage);
    root.querySelectorAll<HTMLButtonElement>('[data-act]').forEach((b) =>
      b.addEventListener('click', async () => {
        const act = b.dataset.act;
        if (act === 'edit') {
          editing = !editing;
          void draw();
        } else if (act === 'save') {
          const cur = (await store.getChunk(jobId, index))!;
          cur.text = $<HTMLTextAreaElement>('#txt', root)!.value;
          cur.status = cur.text.trim() ? 'done' : 'pending';
          cur.edited = true;
          cur.error = undefined;
          await store.putChunk(cur);
          editing = false;
          void draw();
        } else if (act === 'retranslate') {
          void runRealtime(jobId, loadSettings(), [index]);
        }
      }),
    );
  };

  const thumbs = async (start: number, end: number) => {
    const box = $('#thumbs', root);
    if (!box) return;
    try {
      if (!doc) {
        const blob = await store.getPdf(jobId);
        if (!blob) throw new Error('không có PDF gốc');
        doc = await openPdf(blob);
      }
      const frag = document.createDocumentFragment();
      for (let p = start; p <= end && !disposed; p++) {
        frag.appendChild(await renderPage(doc, p, 360));
      }
      if (!disposed && !thumbsDone) {
        thumbsDone = true;
        box.replaceChildren(frag);
      }
    } catch (e) {
      box.textContent = 'Không vẽ được trang gốc: ' + (e instanceof Error ? e.message : String(e));
    }
  };

  const unsub = subscribe(jobId, () => {
    if (!editing) void draw();
  });
  await draw();
  return () => {
    disposed = true;
    unsub();
    if (doc) void closePdf(doc);
  };
}
