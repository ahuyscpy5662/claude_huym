import type Anthropic from '@anthropic-ai/sdk';
import * as store from './db';
import { buildParams, CancelledError, ChunkError, FatalError, makeClient, translateRange, toErrorLike, withRetry, type RequestCtx } from './claude';
import { customIdOf, mapBatchResult, shouldFlush, type BatchResultLike } from './batchutil';
import { PdfSplitter } from './pdfsplit';
import { tail } from './prompt';
import { describeError } from './retry';
import { holdWakeLock, releaseWakeLock } from './wakelock';
import type { BatchInfo, Chunk, Job, Settings } from './types';

type Listener = () => void;
const listeners = new Map<string, Set<Listener>>();

export function subscribe(jobId: string, fn: Listener): () => void {
  if (!listeners.has(jobId)) listeners.set(jobId, new Set());
  listeners.get(jobId)!.add(fn);
  return () => listeners.get(jobId)?.delete(fn);
}
function emit(jobId: string) {
  listeners.get(jobId)?.forEach((f) => f());
}

interface Run {
  abort: AbortController;
  paused: boolean;
  waiters: (() => void)[];
  note: string;
}
const runs = new Map<string, Run>();

export function isRunning(jobId: string): boolean {
  return runs.has(jobId);
}
export function runNote(jobId: string): string {
  return runs.get(jobId)?.note ?? '';
}
export function isPaused(jobId: string): boolean {
  return runs.get(jobId)?.paused ?? false;
}

async function setJob(job: Job, patch: Partial<Job>) {
  Object.assign(job, patch);
  await store.putJob(job);
  emit(job.id);
}

function requireKey(settings: Settings) {
  if (!settings.apiKey) throw new FatalError('Chưa nhập khóa API. Vào Cài đặt để nhập khóa Anthropic.');
}

export function pauseJob(jobId: string) {
  const r = runs.get(jobId);
  if (r) {
    r.paused = true;
    void store.getJob(jobId).then((j) => j && setJob(j, { status: 'paused' }));
  }
}
export function resumeJob(jobId: string) {
  const r = runs.get(jobId);
  if (r) {
    r.paused = false;
    r.waiters.splice(0).forEach((f) => f());
    void store.getJob(jobId).then((j) => j && setJob(j, { status: 'running' }));
  }
}
export function stopJob(jobId: string) {
  const r = runs.get(jobId);
  if (r) {
    r.abort.abort();
    r.paused = false;
    r.waiters.splice(0).forEach((f) => f());
  }
}

/** Dịch realtime các đoạn chưa xong (hoặc đúng các chỉ số `only`, kể cả đoạn đã dịch → dịch lại). */
export async function runRealtime(jobId: string, settings: Settings, only?: number[]): Promise<void> {
  if (runs.has(jobId)) return;
  const job = await store.getJob(jobId);
  if (!job) return;
  const run: Run = { abort: new AbortController(), paused: false, waiters: [], note: '' };
  runs.set(jobId, run);
  holdWakeLock();
  try {
    requireKey(settings);
    const blob = await store.getPdf(jobId);
    if (!blob) throw new FatalError('Không tìm thấy tệp PDF gốc trong bộ nhớ trình duyệt.');
    await setJob(job, { status: 'running', lastError: undefined, model: settings.model });
    const splitter = await PdfSplitter.fromBlob(blob);
    const client = makeClient(settings.apiKey);
    const ctx: RequestCtx = { settings, title: job.title };

    let chunks = await store.getChunks(jobId);
    const todo = chunks.filter((c) => (only ? only.includes(c.index) : c.status !== 'done' && c.status !== 'batched'));
    for (const c of todo) {
      c.status = 'pending';
      c.error = undefined;
      await store.putChunk(c);
    }
    emit(jobId);
    let next = 0;
    let fatal: string | null = null;

    const worker = async () => {
      while (!run.abort.signal.aborted && !fatal) {
        while (run.paused && !run.abort.signal.aborted) await new Promise<void>((r) => run.waiters.push(r));
        if (run.abort.signal.aborted || fatal) return;
        const chunk = todo[next++];
        if (!chunk) return;
        await translateOne(chunk);
      }
    };

    const translateOne = async (chunk: Chunk) => {
      chunk.status = 'running';
      await store.putChunk(chunk);
      emit(jobId);
      try {
        const prev = chunk.index > 0 ? await store.getChunk(jobId, chunk.index - 1) : undefined;
        const prevCtx = prev?.status === 'done' && prev.text ? tail(prev.text) : undefined;
        const out = await translateRange(
          client,
          ctx,
          { slice: (r) => splitter.sliceBase64(r.startPage, r.endPage) },
          { startPage: chunk.startPage, endPage: chunk.endPage },
          prevCtx,
          run.abort.signal,
          {
            onRetry: (attempt, wait, e) => {
              run.note = `Thử lại đoạn ${chunk.index + 1} (lần ${attempt}, chờ ${Math.round(wait / 1000)}s): ${describeError(e)}`;
              emit(jobId);
            },
          },
        );
        Object.assign(chunk, { status: 'done', text: out.text, usage: out.usage, mode: 'realtime', model: settings.model, error: undefined, edited: false, batchId: undefined });
        run.note = '';
      } catch (e) {
        if (e instanceof CancelledError) {
          chunk.status = 'pending';
        } else if (e instanceof FatalError) {
          chunk.status = 'pending';
          fatal = e.message;
          run.abort.abort();
        } else {
          chunk.status = 'failed';
          chunk.error = e instanceof ChunkError ? e.message : describeError(toErrorLike(e));
        }
      }
      await store.putChunk(chunk);
      emit(jobId);
    };

    const n = Math.max(1, Math.min(8, settings.concurrency));
    await Promise.all(Array.from({ length: n }, worker));

    chunks = await store.getChunks(jobId);
    const allDone = chunks.every((c) => c.status === 'done');
    if (fatal) await setJob(job, { status: 'error', lastError: fatal });
    else await setJob(job, { status: allDone ? 'done' : 'idle' });
  } catch (e) {
    await setJob(job, { status: 'error', lastError: e instanceof Error ? e.message : String(e) });
  } finally {
    runs.delete(jobId);
    releaseWakeLock();
    // đoạn còn 'running' do tab bị dừng đột ngột sẽ được dọn khi mở lại job
    emit(jobId);
  }
}

/** Dọn trạng thái dở dang sau khi tải lại trang. */
export async function recoverJob(jobId: string): Promise<void> {
  if (runs.has(jobId)) return;
  const job = await store.getJob(jobId);
  if (!job) return;
  const chunks = await store.getChunks(jobId);
  for (const c of chunks) {
    if (c.status === 'running') {
      c.status = 'pending';
      await store.putChunk(c);
    }
  }
  if (job.status === 'running' || job.status === 'paused') await setJob(job, { status: 'idle' });
}

// ---------------------------------------------------------------- Batch

const BATCH_MAX_BYTES = 90 * 1024 * 1024;
const BATCH_MAX_REQUESTS = 2000;

/** Tạo (các) batch cho mọi đoạn chưa dịch. */
export async function submitBatches(jobId: string, settings: Settings): Promise<string> {
  const job = await store.getJob(jobId);
  if (!job) return '';
  if (runs.has(jobId)) throw new Error('Job đang chạy.');
  const run: Run = { abort: new AbortController(), paused: false, waiters: [], note: 'Đang tạo batch…' };
  runs.set(jobId, run);
  try {
    requireKey(settings);
    const blob = await store.getPdf(jobId);
    if (!blob) throw new FatalError('Không tìm thấy tệp PDF gốc.');
    const splitter = await PdfSplitter.fromBlob(blob);
    const client = makeClient(settings.apiKey);
    const ctx: RequestCtx = { settings, title: job.title };
    const chunks = (await store.getChunks(jobId)).filter((c) => c.status === 'pending' || c.status === 'failed' || c.status === 'running');
    if (!chunks.length) return 'Không còn đoạn nào cần dịch.';
    await setJob(job, { status: 'running', lastError: undefined, model: settings.model });

    type Req = { custom_id: string; params: ReturnType<typeof buildParams> };
    let group: { chunk: Chunk; req: Req; bytes: number }[] = [];
    let bytes = 0;
    let created = 0;

    const flush = async () => {
      if (!group.length) return;
      const g = group;
      group = [];
      bytes = 0;
      run.note = `Đang gửi batch ${created + 1} (${g.length} đoạn)…`;
      emit(jobId);
      const b = await withRetry(() => client.messages.batches.create({ requests: g.map((x) => x.req) as never }, { signal: run.abort.signal }), run.abort.signal);
      const info: BatchInfo = { id: b.id, chunkIndexes: g.map((x) => x.chunk.index), status: 'in_progress', createdAt: Date.now() };
      job.batches = [...job.batches, info];
      for (const x of g) {
        x.chunk.status = 'batched';
        x.chunk.batchId = b.id;
        x.chunk.error = undefined;
        await store.putChunk(x.chunk);
      }
      created++;
      await setJob(job, { batches: job.batches });
    };

    for (const chunk of chunks) {
      const part = await splitter.sliceBase64(chunk.startPage, chunk.endPage);
      const req: Req = { custom_id: customIdOf(chunk.index), params: buildParams(ctx, chunk, part.data) };
      if (shouldFlush(bytes, group.length, part.data.length, BATCH_MAX_BYTES, BATCH_MAX_REQUESTS)) await flush();
      group.push({ chunk, req, bytes: part.data.length });
      bytes += part.data.length;
    }
    await flush();
    await setJob(job, { status: 'idle' });
    return `Đã tạo ${created} batch cho ${chunks.length} đoạn. Có thể đóng tab; quay lại và bấm "Kiểm tra batch" sau.`;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await setJob(job, { status: job.batches.length ? 'idle' : 'error', lastError: msg });
    return msg;
  } finally {
    runs.delete(jobId);
    emit(jobId);
  }
}

/** Hỏi trạng thái các batch đang chạy và tải kết quả của batch đã xong. */
export async function checkBatches(jobId: string, settings: Settings): Promise<string> {
  const job = await store.getJob(jobId);
  if (!job) return '';
  requireKey(settings);
  const client: Anthropic = makeClient(settings.apiKey);
  const messages: string[] = [];
  const pending = job.batches.filter((b) => b.status !== 'ended');
  if (!pending.length) return 'Không có batch nào đang chờ.';
  for (const info of pending) {
    try {
      const b = await withRetry(() => client.messages.batches.retrieve(info.id), undefined);
      if (b.processing_status !== 'ended') {
        info.status = b.processing_status === 'canceling' ? 'canceling' : 'in_progress';
        const rc = b.request_counts;
        messages.push(`Batch …${info.id.slice(-6)}: đang xử lý (${rc.processing} chờ, ${rc.succeeded} xong).`);
        continue;
      }
      const seen = new Set<number>();
      let ok = 0;
      let bad = 0;
      const results = await client.messages.batches.results(info.id);
      for await (const r of results) {
        const m = mapBatchResult(r as unknown as BatchResultLike);
        if (!m) continue;
        const chunk = await store.getChunk(jobId, m.index);
        if (!chunk) continue;
        seen.add(m.index);
        if (m.ok) {
          Object.assign(chunk, { status: 'done', text: m.text, usage: m.usage, mode: 'batch', model: settings.model, error: undefined, edited: false });
          ok++;
        } else {
          Object.assign(chunk, { status: 'failed', error: m.error, usage: m.usage ?? chunk.usage, mode: 'batch', model: settings.model });
          bad++;
        }
        chunk.batchId = undefined;
        await store.putChunk(chunk);
      }
      for (const idx of info.chunkIndexes) {
        if (seen.has(idx)) continue;
        const chunk = await store.getChunk(jobId, idx);
        if (chunk && chunk.status === 'batched') {
          Object.assign(chunk, { status: 'failed', error: 'Batch không trả kết quả cho đoạn này.', batchId: undefined });
          await store.putChunk(chunk);
          bad++;
        }
      }
      info.status = 'ended';
      info.succeeded = ok;
      info.failed = bad;
      messages.push(`Batch …${info.id.slice(-6)} đã xong: ${ok} đoạn thành công, ${bad} lỗi.`);
    } catch (e) {
      if (e instanceof FatalError) {
        await setJob(job, { lastError: e.message });
        throw e;
      }
      messages.push(`Batch …${info.id.slice(-6)}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  const chunks = await store.getChunks(jobId);
  const allDone = chunks.every((c) => c.status === 'done');
  await setJob(job, { batches: job.batches, status: allDone ? 'done' : job.status === 'done' ? 'idle' : job.status });
  return messages.join('\n');
}

export async function cancelBatch(jobId: string, batchId: string, settings: Settings): Promise<void> {
  const job = await store.getJob(jobId);
  if (!job) return;
  requireKey(settings);
  const client = makeClient(settings.apiKey);
  await client.messages.batches.cancel(batchId);
  const info = job.batches.find((b) => b.id === batchId);
  if (info) info.status = 'canceling';
  await setJob(job, { batches: job.batches });
}

