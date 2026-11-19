export type ErrorKind = 'retry' | 'fatal' | 'invalid';

export interface ErrorLike {
  status?: number;
  message?: string;
  retryAfterSec?: number | null;
  name?: string;
}

/** Phân loại lỗi: retry (thử lại), fatal (dừng cả job), invalid (lỗi của riêng đoạn). */
export function classifyError(e: ErrorLike): ErrorKind {
  const msg = (e.message ?? '').toLowerCase();
  if (e.status === 401 || e.status === 403) return 'fatal';
  if (/credit balance|billing|insufficient (funds|credit)/.test(msg)) return 'fatal';
  if (e.status === undefined || e.status === 0) {
    // lỗi mạng / timeout / abort không rõ mã
    if (e.name === 'AbortError') return 'invalid';
    return 'retry';
  }
  if ([408, 409, 429, 529].includes(e.status) || e.status >= 500) return 'retry';
  return 'invalid';
}

export const MAX_ATTEMPTS = 6;

/** Thời gian chờ (ms) trước lần thử lại thứ `attempt` (1-based): lũy thừa + jitter, tôn trọng retry-after. */
export function backoffMs(attempt: number, retryAfterSec?: number | null, rand: () => number = Math.random): number {
  if (retryAfterSec != null && isFinite(retryAfterSec) && retryAfterSec >= 0) {
    return Math.min(120, retryAfterSec) * 1000 + Math.floor(rand() * 500);
  }
  const base = Math.min(60, 2 ** attempt * 2);
  return Math.floor((base + rand() * 1.5) * 1000);
}

export function describeError(e: ErrorLike): string {
  const kind = classifyError(e);
  if (e.status === 401 || e.status === 403) return 'Khóa API không hợp lệ hoặc không có quyền (401/403). Kiểm tra lại khóa trong Cài đặt.';
  if (/credit balance/i.test(e.message ?? '')) return 'Tài khoản Anthropic hết tín dụng. Hãy nạp thêm credit rồi tiếp tục.';
  if (e.status === 429) return 'Bị giới hạn tốc độ (429). Hãy giảm số luồng song song.';
  if (e.status === 529) return 'Máy chủ Anthropic đang quá tải (529).';
  if (e.status && e.status >= 500) return `Lỗi máy chủ (${e.status}).`;
  if (kind === 'retry') return 'Lỗi mạng. Kiểm tra kết nối Internet.';
  return `Lỗi API${e.status ? ' ' + e.status : ''}: ${e.message ?? 'không rõ'}`;
}
