import type { PageRange } from './types';

/** Chia `totalPages` trang thành các đoạn liên tiếp, mỗi đoạn tối đa `size` trang (1–10). */
export function chunkRanges(totalPages: number, size: number): PageRange[] {
  const s = Math.max(1, Math.min(10, Math.floor(size) || 1));
  const out: PageRange[] = [];
  for (let start = 1; start <= totalPages; start += s) {
    out.push({ startPage: start, endPage: Math.min(totalPages, start + s - 1) });
  }
  return out;
}

/** Chia đôi một khoảng trang (dùng khi chạm max_tokens). Trả null nếu chỉ có 1 trang. */
export function splitRange(r: PageRange): [PageRange, PageRange] | null {
  if (r.endPage <= r.startPage) return null;
  const mid = Math.floor((r.startPage + r.endPage) / 2);
  return [
    { startPage: r.startPage, endPage: mid },
    { startPage: mid + 1, endPage: r.endPage },
  ];
}

export function pageList(r: PageRange): number[] {
  const out: number[] = [];
  for (let p = r.startPage; p <= r.endPage; p++) out.push(p);
  return out;
}

export function rangeLabel(r: PageRange): string {
  return r.startPage === r.endPage ? `trang ${r.startPage}` : `trang ${r.startPage}–${r.endPage}`;
}
