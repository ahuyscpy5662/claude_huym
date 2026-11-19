import type { Usage } from './types';

export const customIdOf = (index: number) => `chunk-${index}`;

export function parseCustomId(id: string): number | null {
  const m = /^chunk-(\d+)$/.exec(id);
  return m ? parseInt(m[1], 10) : null;
}

/** Có cần đóng batch hiện tại trước khi thêm yêu cầu tiếp theo không. */
export function shouldFlush(curBytes: number, curCount: number, nextBytes: number, maxBytes: number, maxRequests: number): boolean {
  return curCount > 0 && (curBytes + nextBytes > maxBytes || curCount >= maxRequests);
}

/** Gom các yêu cầu vào nhiều batch, mỗi batch không quá `maxBytes` và `maxRequests`. */
export function planBatches<T extends { bytes: number }>(items: T[], maxBytes = 100 * 1024 * 1024, maxRequests = 2000): T[][] {
  const out: T[][] = [];
  let cur: T[] = [];
  let size = 0;
  for (const it of items) {
    if (shouldFlush(size, cur.length, it.bytes, maxBytes, maxRequests)) {
      out.push(cur);
      cur = [];
      size = 0;
    }
    cur.push(it);
    size += it.bytes;
  }
  if (cur.length) out.push(cur);
  return out;
}

export interface BatchResultLike {
  custom_id: string;
  result:
    | { type: 'succeeded'; message: { content: { type: string; text?: string }[]; stop_reason: string | null; usage?: UsageLike } }
    | { type: 'errored'; error?: { error?: { message?: string; type?: string }; message?: string } }
    | { type: 'canceled' }
    | { type: 'expired' };
}

export interface UsageLike {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}

export function usageFrom(u: UsageLike | undefined | null): Usage {
  return {
    input: u?.input_tokens ?? 0,
    output: u?.output_tokens ?? 0,
    cacheRead: u?.cache_read_input_tokens ?? 0,
    cacheWrite: u?.cache_creation_input_tokens ?? 0,
  };
}

export type MappedResult =
  | { index: number; ok: true; text: string; usage: Usage }
  | { index: number; ok: false; error: string; usage?: Usage };

/** Chuyển kết quả batch (thứ tự bất kỳ) thành kết quả theo chỉ số đoạn. */
export function mapBatchResult(r: BatchResultLike): MappedResult | null {
  const index = parseCustomId(r.custom_id);
  if (index === null) return null;
  const res = r.result;
  if (res.type === 'succeeded') {
    const usage = usageFrom(res.message.usage);
    const sr = res.message.stop_reason;
    if (sr === 'refusal') return { index, ok: false, error: 'Mô hình từ chối dịch đoạn này (refusal). Thử dịch lại ở chế độ Nhanh.', usage };
    if (sr === 'max_tokens') return { index, ok: false, error: 'Bản dịch bị cắt do chạm giới hạn đầu ra. Hãy dịch lại ở chế độ Nhanh (tự chia nhỏ).', usage };
    const text = res.message.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text ?? '')
      .join('')
      .trim();
    if (!text) return { index, ok: false, error: 'Phản hồi trống.', usage };
    return { index, ok: true, text, usage };
  }
  if (res.type === 'errored') {
    const msg = res.error?.error?.message ?? res.error?.message ?? 'lỗi không rõ';
    return { index, ok: false, error: `Batch báo lỗi: ${msg}` };
  }
  if (res.type === 'expired') return { index, ok: false, error: 'Yêu cầu batch đã hết hạn (24 giờ). Dịch lại ở chế độ Nhanh.' };
  return { index, ok: false, error: 'Yêu cầu batch đã bị hủy.' };
}
