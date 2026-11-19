import * as store from '../lib/db';
import { exportJobPdf } from '../lib/export';
import { buildSystemPrompt } from '../lib/prompt';
import { cancelBatch, checkBatches, isPaused, isRunning, pauseJob, recoverJob, resumeJob, runNote, runRealtime, stopJob, submitBatches, subscribe } from '../lib/runner';
import { loadSettings } from '../lib/settings';
import { estimateCost, formatUsd, modelInfo } from '../lib/models';
import type { Chunk, Job } from '../lib/types';
import { actualCost, CHUNK_LABEL, esc, JOB_LABEL, jobProgress, $ } from './util';

type Mode = 'realtime' | 'batch';
const MODE_KEY = 'rhm-dich-pdf:mode';
const getMode = (): Mode => {
  try {
    return localStorage.getItem(MODE_KEY) === 'batch' ? 'batch' : 'realtime';
  } catch {
    return 'realtime';
  }
};

export async function renderJob(root: HTMLElement, jobId: string): Promise<() => void> {
  await recoverJob(jobId);
  let mode = getMode();
  let message = '';
  let busy = false;
  let exportMsg = '';
  let timer: number | null = null;

  const draw = async () => {
    const job = await store.getJob(jobId);
    if (!job) {
      root.innerHTML = '<p>Không tìm thấy tài liệu. <a href="#/">Về trang chủ</a></p>';
      return;
    }
    const chunks = await store.getChunks(jobId);
    root.innerHTML = view(job, chunks);
    bind(job, chunks);
  };

  const schedule = () => {
    if (timer) return;
    timer = window.setTimeout(() => {
      timer = null;
      void draw();
    }, 250);
  };

  const view = (job: Job, chunks: Chunk[]): string => {
    const settings = loadSettings();
    const p = jobProgress(chunks);
    const running = isRunning(jobId);
    const paused = isPaused(jobId);
    const remaining = chunks.filter((c) => c.status !== 'done' && c.status !== 'batched');
    const remPages = remaining.reduce((n, c) => n + c.endPage - c.startPage + 1, 0);
    const sysTok = Math.round(buildSystemPrompt(settings.glossary, settings.keepEnglishTerms).length / 3.2);
    const est = (m: Mode) => formatUsd(estimateCost(remPages, remaining.length, sysTok, settings.model, m === 'batch'));
    const hasLiveBatch = job.batches.some((b) => b.status !== 'ended');
    const note = runNote(jobId);
    return `
      <header class="top"><a class="back" href="#/">‹ Danh sách</a><a href="#/settings" class="btn">Cài đặt</a></header>
      <div class="card">
        <div class="row"><h2 class="grow" style="margin:0;font-size:1.2rem">${esc(job.title)}</h2><span class="badge ${job.status}">${JOB_LABEL[job.status]}</span></div>
        <div class="bar"><span style="width:${p.pct}%"></span></div>
        <div class="stats">
          <div class="stat"><b>${job.pages}</b>trang</div>
          <div class="stat"><b>${p.done}/${p.total}</b>đoạn đã dịch (${job.chunkSize} trang/đoạn)</div>
          <div class="stat"><b>${p.failed}</b>đoạn lỗi</div>
          <div class="stat"><b id="cost">${formatUsd(actualCost(job, chunks))}</b>chi phí thực tế</div>
        </div>
        ${job.lastError ? `<div class="alert error">${esc(job.lastError)}</div>` : ''}
        ${note ? `<div class="alert warn">${esc(note)}</div>` : ''}
        ${message ? `<div class="alert">${esc(message)}</div>` : ''}
        ${!settings.apiKey ? '<div class="alert warn">Chưa có khóa API — vào Cài đặt để nhập.</div>' : ''}
      </div>

      <div class="card">
        <h2>Dịch</h2>
        <div class="modes">
          <label class="mode ${mode === 'realtime' ? 'sel' : ''}"><input type="radio" name="mode" value="realtime" ${mode === 'realtime' ? 'checked' : ''} ${running ? 'disabled' : ''}/><b>Nhanh</b> (thời gian thực)
            <div class="muted small">Dịch ngay, ${settings.concurrency} luồng song song. Cần giữ tab mở. Ước tính còn lại: <b>${est('realtime')}</b></div></label>
          <label class="mode ${mode === 'batch' ? 'sel' : ''}"><input type="radio" name="mode" value="batch" ${mode === 'batch' ? 'checked' : ''} ${running ? 'disabled' : ''}/><b>Tiết kiệm 50%</b> (Batch)
            <div class="muted small">Gửi cả lô, có thể đóng tab, kết quả trong vài phút đến 24 giờ. Ước tính còn lại: <b>${est('batch')}</b></div></label>
        </div>
        <div class="muted small" style="margin-top:6px">Mô hình: ${esc(modelInfo(settings.model).name)} · ước tính rất sơ bộ, chi phí thực tế tính từ lượng token đã dùng.</div>
        <div class="row" style="margin-top:12px">
          ${
            running && mode === 'realtime'
              ? `${paused ? '<button class="primary" data-act="resume">Tiếp tục</button>' : '<button data-act="pause">Tạm dừng</button>'}<button class="danger" data-act="stop">Dừng</button>`
              : `<button class="primary" data-act="start" ${busy || running || !remaining.length ? 'disabled' : ''}>${mode === 'batch' ? 'Gửi batch' : p.done ? 'Tiếp tục dịch' : 'Bắt đầu dịch'}</button>`
          }
          ${p.failed ? `<button data-act="retry-failed" ${running ? 'disabled' : ''}>Dịch lại ${p.failed} đoạn lỗi (Nhanh)</button>` : ''}
          ${job.batches.length ? `<button data-act="check" ${busy ? 'disabled' : ''}>Kiểm tra batch</button>` : ''}
        </div>
        ${
          job.batches.length
            ? `<div style="margin-top:10px">${job.batches
                .map(
                  (b) => `<div class="row small" style="margin-top:4px"><span class="badge ${b.status === 'ended' ? 'done' : 'batched'}">${b.status === 'ended' ? 'Đã xong' : b.status === 'canceling' ? 'Đang hủy' : 'Đang xử lý'}</span>
                  <span class="grow muted">Batch …${esc(b.id.slice(-8))} · ${b.chunkIndexes.length} đoạn${b.status === 'ended' ? ` · ${b.succeeded ?? 0} thành công, ${b.failed ?? 0} lỗi` : ''}</span>
                  ${b.status === 'in_progress' ? `<button class="danger small" data-cancel="${esc(b.id)}">Hủy batch</button>` : ''}</div>`,
                )
                .join('')}</div>`
            : ''
        }
        ${hasLiveBatch ? '<div class="muted small" style="margin-top:6px">Có batch đang chạy: đóng tab thoải mái, mở lại và bấm "Kiểm tra batch".</div>' : ''}
      </div>

      <div class="card">
        <h2>Xuất PDF tiếng Việt</h2>
        <p class="muted small">Có thể xuất bản dịch dở dang; đoạn chưa dịch sẽ có chú thích. Hình ảnh gốc được chèn sau từng trang.</p>
        <div class="row"><button class="primary" data-act="export" ${p.done === 0 || busy ? 'disabled' : ''}>Xuất PDF</button><span id="exp" class="muted small">${esc(exportMsg)}</span></div>
      </div>

      <div class="card">
        <h2>Các đoạn (${p.total})</h2>
        <ul class="chunks">
          ${chunks
            .map(
              (c) => `<li><a href="#/job/${jobId}/chunk/${c.index}">
              <span class="pages">Đoạn ${c.index + 1} · ${c.startPage === c.endPage ? `trang ${c.startPage}` : `trang ${c.startPage}–${c.endPage}`}${c.error ? `<div class="err">${esc(c.error)}</div>` : ''}${c.edited ? ' <span class="muted small">(đã sửa tay)</span>' : ''}</span>
              <span class="badge ${c.status}">${CHUNK_LABEL[c.status]}</span></a></li>`,
            )
            .join('')}
        </ul>
      </div>`;
  };

  const bind = (job: Job, chunks: Chunk[]) => {
    const settings = loadSettings();
    root.querySelectorAll<HTMLInputElement>('input[name=mode]').forEach((r) =>
      r.addEventListener('change', () => {
        mode = r.value as Mode;
        try {
          localStorage.setItem(MODE_KEY, mode);
        } catch {
          /* bỏ qua */
        }
        void draw();
      }),
    );
    root.querySelectorAll<HTMLButtonElement>('[data-act]').forEach((b) =>
      b.addEventListener('click', async () => {
        const act = b.dataset.act!;
        message = '';
        try {
          if (act === 'start') {
            if (mode === 'batch') {
              busy = true;
              void draw();
              message = await submitBatches(jobId, settings);
              busy = false;
            } else void runRealtime(jobId, settings);
          } else if (act === 'retry-failed') {
            void runRealtime(jobId, settings, chunks.filter((c) => c.status === 'failed').map((c) => c.index));
          } else if (act === 'pause') pauseJob(jobId);
          else if (act === 'resume') resumeJob(jobId);
          else if (act === 'stop') stopJob(jobId);
          else if (act === 'check') {
            busy = true;
            void draw();
            try {
              message = await checkBatches(jobId, settings);
            } catch (e) {
              message = e instanceof Error ? e.message : String(e);
            }
            busy = false;
          } else if (act === 'export') {
            busy = true;
            void draw();
            try {
              await exportJobPdf(job, (pr) => {
                exportMsg = pr.phase === 'images' ? `Đang trích hình ảnh… ${pr.done}/${pr.total} trang` : 'Đang tạo PDF…';
                const el = $('#exp', root);
                if (el) el.textContent = exportMsg;
              });
              exportMsg = 'Đã xuất xong — kiểm tra thư mục tải xuống.';
            } catch (e) {
              exportMsg = '';
              message = 'Xuất PDF thất bại: ' + (e instanceof Error ? e.message : String(e));
            }
            busy = false;
          }
        } catch (e) {
          busy = false;
          message = e instanceof Error ? e.message : String(e);
        }
        void draw();
      }),
    );
    root.querySelectorAll<HTMLButtonElement>('[data-cancel]').forEach((b) =>
      b.addEventListener('click', async () => {
        if (!confirm('Hủy batch này? Các đoạn chưa xử lý sẽ bị bỏ; có thể dịch lại ở chế độ Nhanh.')) return;
        try {
          await cancelBatch(jobId, b.dataset.cancel!, settings);
          message = 'Đã gửi yêu cầu hủy. Bấm "Kiểm tra batch" để cập nhật.';
        } catch (e) {
          message = e instanceof Error ? e.message : String(e);
        }
        void draw();
      }),
    );
  };

  const unsub = subscribe(jobId, schedule);
  await draw();
  return () => {
    unsub();
    if (timer) clearTimeout(timer);
  };
}
