import * as store from '../lib/db';
import { chunkRanges } from '../lib/chunking';
import { closePdf, openPdf, pdfTitle } from '../lib/pdfinfo';
import { loadSettings } from '../lib/settings';
import { DEFAULT_MODEL } from '../lib/models';
import type { Chunk, Job } from '../lib/types';
import { $, actualCost, esc, formatUsd, JOB_LABEL, jobProgress } from './util';

export async function renderHome(root: HTMLElement): Promise<void> {
  const jobs = await store.listJobs();
  const rows: string[] = [];
  for (const j of jobs) {
    const chunks = await store.getChunks(j.id);
    const p = jobProgress(chunks);
    rows.push(`
      <div class="card">
        <a class="job" href="#/job/${j.id}">
          <div class="row"><div class="title grow">${esc(j.title)}</div><span class="badge ${j.status}">${JOB_LABEL[j.status]}</span></div>
          <div class="bar"><span style="width:${p.pct}%"></span></div>
          <div class="muted small">${j.pages} trang · ${p.done}/${p.total} đoạn xong${p.failed ? ` · ${p.failed} lỗi` : ''} · chi phí ${formatUsd(actualCost(j, chunks))}</div>
        </a>
        <div class="row" style="margin-top:8px"><button class="danger small" data-del="${j.id}">Xóa</button></div>
      </div>`);
  }
  const hasKey = !!loadSettings().apiKey;
  root.innerHTML = `
    <header class="top"><h1>Dịch PDF Răng Hàm Mặt</h1><a href="#/settings" class="btn">Cài đặt</a></header>
    ${hasKey ? '' : '<div class="alert warn">Chưa có khóa API. Vào <a href="#/settings">Cài đặt</a> để nhập khóa Anthropic trước khi dịch.</div>'}
    <div class="card">
      <h2>Thêm tài liệu mới</h2>
      <p class="muted">Chọn tệp PDF tiếng Anh (sách, giáo trình, bài báo). Tệp được lưu ngay trong trình duyệt của bạn.</p>
      <input id="file" type="file" accept="application/pdf,.pdf" />
      <label for="title">Tên tài liệu (có thể để trống)</label>
      <input id="title" type="text" placeholder="Mặc định lấy từ tệp PDF" />
      <div id="imp-status" class="muted" style="margin-top:8px"></div>
    </div>
    <h2 style="font-size:1.05rem">Tài liệu của bạn</h2>
    ${rows.join('') || '<p class="muted">Chưa có tài liệu nào.</p>'}
  `;
  const status = $('#imp-status', root)!;
  $<HTMLInputElement>('#file', root)!.addEventListener('change', async (ev) => {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    status.textContent = 'Đang đọc PDF…';
    try {
      const job = await importPdf(file, ($<HTMLInputElement>('#title', root)!.value || '').trim());
      location.hash = `#/job/${job.id}`;
    } catch (e) {
      status.innerHTML = `<span style="color:var(--danger)">Không đọc được tệp PDF: ${esc(e instanceof Error ? e.message : String(e))}</span>`;
    }
    input.value = '';
  });
  root.querySelectorAll<HTMLButtonElement>('[data-del]').forEach((b) =>
    b.addEventListener('click', async () => {
      if (confirm('Xóa tài liệu này và toàn bộ bản dịch? Không thể hoàn tác.')) {
        await store.deleteJob(b.dataset.del!);
        await renderHome(root);
      }
    }),
  );
}

export async function importPdf(file: File, titleInput: string): Promise<Job> {
  const doc = await openPdf(file);
  const pages = doc.numPages;
  const meta = await pdfTitle(doc);
  await closePdf(doc);
  const settings = loadSettings();
  const id = typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const title = titleInput || meta || file.name.replace(/\.pdf$/i, '');
  const job: Job = {
    id,
    title,
    fileName: file.name,
    pages,
    chunkSize: settings.chunkSize,
    createdAt: Date.now(),
    model: settings.model || DEFAULT_MODEL,
    status: 'idle',
    batches: [],
  };
  const chunks: Chunk[] = chunkRanges(pages, settings.chunkSize).map((r, index) => ({ jobId: id, index, ...r, status: 'pending', text: '' }));
  await store.createJob(job, file, chunks);
  return job;
}
