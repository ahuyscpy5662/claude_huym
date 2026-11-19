import Anthropic from '@anthropic-ai/sdk';
import { classifyError, describeError, backoffMs, MAX_ATTEMPTS, type ErrorLike } from './retry';
import { modelInfo } from './models';
import { buildSystemPrompt, buildUserText } from './prompt';
import { splitRange } from './chunking';
import { usageFrom } from './batchutil';
import { addUsage, emptyUsage } from './models';
import type { PageRange, Settings, Usage } from './types';

export const MAX_OUTPUT_TOKENS = 32000;
export const FALLBACK_BETA = 'server-side-fallback-2026-07-01';
/** base64 vượt ngưỡng này (≈ 32 MB giới hạn request) thì tự chia nhỏ khoảng trang. */
export const MAX_PDF_BASE64 = 28 * 1024 * 1024;

export function makeClient(apiKey: string): Anthropic {
  return new Anthropic({
    apiKey,
    dangerouslyAllowBrowser: true,
    maxRetries: 0, // tự xử lý thử lại để tôn trọng retry-after và hiển thị trạng thái
    timeout: 15 * 60 * 1000,
  });
}

/** Lỗi dừng cả job (khóa sai, hết credit). */
export class FatalError extends Error {}
/** Lỗi riêng của một đoạn (từ chối, hết lượt thử, yêu cầu không hợp lệ). */
export class ChunkError extends Error {}
export class CancelledError extends Error {}

export function toErrorLike(e: unknown): ErrorLike & { aborted: boolean } {
  const err = e as {
    status?: number;
    message?: string;
    name?: string;
    headers?: { get?: (k: string) => string | null } | Record<string, string>;
  };
  let ra: number | null = null;
  const h = err.headers;
  const raw = h && typeof (h as { get?: unknown }).get === 'function' ? (h as { get: (k: string) => string | null }).get('retry-after') : h ? (h as Record<string, string>)['retry-after'] : null;
  if (raw) {
    const n = Number(raw);
    if (isFinite(n)) ra = n;
  }
  const aborted = err.name === 'APIUserAbortError' || err.name === 'AbortError';
  return { status: err.status, message: err.message, name: err.name, retryAfterSec: ra, aborted };
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new CancelledError('Đã dừng'));
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(new CancelledError('Đã dừng'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** Thử lại với backoff lũy thừa + jitter. Ném FatalError / ChunkError / CancelledError. */
export async function withRetry<T>(
  fn: () => Promise<T>,
  signal: AbortSignal | undefined,
  onRetry?: (attempt: number, waitMs: number, e: ErrorLike) => void,
  sleeper: (ms: number, s?: AbortSignal) => Promise<void> = sleep,
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    if (signal?.aborted) throw new CancelledError('Đã dừng');
    try {
      return await fn();
    } catch (e) {
      if (e instanceof FatalError || e instanceof ChunkError || e instanceof CancelledError) throw e;
      const el = toErrorLike(e);
      if (el.aborted || signal?.aborted) throw new CancelledError('Đã dừng');
      const kind = classifyError(el);
      if (kind === 'fatal') throw new FatalError(describeError(el));
      if (kind === 'invalid') throw new ChunkError(describeError(el));
      if (attempt >= MAX_ATTEMPTS) throw new ChunkError(describeError(el) + ` (đã thử ${attempt} lần)`);
      const wait = backoffMs(attempt, el.retryAfterSec);
      onRetry?.(attempt, wait, el);
      await sleeper(wait, signal);
    }
  }
}

export interface RequestCtx {
  settings: Settings;
  title: string;
}

/** Tham số dùng chung cho Messages và Batches (không có stream/fallbacks). */
export function buildParams(ctx: RequestCtx, range: PageRange, pdfBase64: string, previousContext?: string) {
  const s = ctx.settings;
  return {
    model: s.model,
    max_tokens: MAX_OUTPUT_TOKENS,
    // system + bảng thuật ngữ giữ nguyên từng byte giữa các request → cache_control
    system: [{ type: 'text' as const, text: buildSystemPrompt(s.glossary, s.keepEnglishTerms), cache_control: { type: 'ephemeral' as const } }],
    output_config: { effort: s.effort },
    messages: [
      {
        role: 'user' as const,
        content: [
          { type: 'document' as const, source: { type: 'base64' as const, media_type: 'application/pdf' as const, data: pdfBase64 } },
          { type: 'text' as const, text: buildUserText({ startPage: range.startPage, endPage: range.endPage, documentTitle: ctx.title, previousContext }) },
        ],
      },
    ],
  };
}

export interface MessageResult {
  text: string;
  stopReason: string | null;
  usage: Usage;
}

/** Một request realtime (streaming) — chỉ ghép các khối `text`. */
export async function sendRealtime(client: Anthropic, ctx: RequestCtx, range: PageRange, pdfBase64: string, previousContext: string | undefined, signal?: AbortSignal): Promise<MessageResult> {
  const params = buildParams(ctx, range, pdfBase64, previousContext);
  const useFallback = modelInfo(ctx.settings.model).serverFallback;
  let msg;
  if (useFallback) {
    const stream = client.beta.messages.stream({ ...params, betas: [FALLBACK_BETA], fallbacks: 'default' } as never, { signal });
    msg = await stream.finalMessage();
  } else {
    const stream = client.messages.stream(params as never, { signal });
    msg = await stream.finalMessage();
  }
  const content = msg.content as { type: string; text?: string }[];
  const text = content
    .filter((b) => b.type === 'text')
    .map((b) => b.text ?? '')
    .join('')
    .trim();
  return { text, stopReason: msg.stop_reason ?? null, usage: usageFrom(msg.usage as never) };
}

export interface RangeSource {
  slice(range: PageRange): Promise<{ data: string; bytes: number }>;
}

export interface TranslateHooks {
  onRetry?: (attempt: number, waitMs: number, e: ErrorLike) => void;
  sleeper?: (ms: number, s?: AbortSignal) => Promise<void>;
  send?: typeof sendRealtime;
}

/**
 * Dịch một khoảng trang. Chạm max_tokens (hoặc PDF quá lớn) → tự chia đôi khoảng trang, tới 1 trang.
 */
export async function translateRange(
  client: Anthropic,
  ctx: RequestCtx,
  src: RangeSource,
  range: PageRange,
  previousContext: string | undefined,
  signal: AbortSignal | undefined,
  hooks: TranslateHooks = {},
): Promise<{ text: string; usage: Usage }> {
  const send = hooks.send ?? sendRealtime;
  const halves = splitRange(range);
  const part = await src.slice(range);
  if (part.data.length > MAX_PDF_BASE64 && halves) return translateHalves(halves);

  const res = await withRetry(() => send(client, ctx, range, part.data, previousContext, signal), signal, hooks.onRetry, hooks.sleeper);
  if (res.stopReason === 'refusal') throw new ChunkError('Mô hình từ chối dịch đoạn này (refusal). Có thể thử lại hoặc đổi mô hình.');
  if (res.stopReason === 'max_tokens') {
    if (halves) return translateHalves(halves, res.usage);
    throw new ChunkError('Bản dịch của một trang vượt giới hạn đầu ra (max_tokens).');
  }
  if (!res.text) throw new ChunkError('Phản hồi trống.');
  return { text: res.text, usage: res.usage };

  async function translateHalves(h: [PageRange, PageRange], spent: Usage = emptyUsage()) {
    const a = await translateRange(client, ctx, src, h[0], previousContext, signal, hooks);
    const ctxB = a.text.slice(-700);
    const b = await translateRange(client, ctx, src, h[1], ctxB, signal, hooks);
    return { text: `${a.text}\n\n${b.text}`, usage: addUsage(addUsage(spent, a.usage), b.usage) };
  }
}
