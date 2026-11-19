import { escapeHtml } from '../lib/bytes';
import { parseMarkdown, type Block, type Run } from '../lib/markdown';
import { costOf, formatUsd } from '../lib/models';
import type { Chunk, Job } from '../lib/types';

export { escapeHtml as esc };

export const $ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector(sel) as T | null;

export const CHUNK_LABEL: Record<string, string> = { pending: 'Chờ dịch', running: 'Đang dịch', batched: 'Đã gửi batch', done: 'Xong', failed: 'Lỗi' };
export const JOB_LABEL: Record<string, string> = { idle: 'Chưa chạy / đã dừng', running: 'Đang dịch', paused: 'Tạm dừng', done: 'Hoàn tất', error: 'Lỗi' };

export function jobProgress(chunks: Chunk[]) {
  const total = chunks.length;
  const done = chunks.filter((c) => c.status === 'done').length;
  const failed = chunks.filter((c) => c.status === 'failed').length;
  const batched = chunks.filter((c) => c.status === 'batched').length;
  return { total, done, failed, batched, pct: total ? Math.round((done / total) * 100) : 0 };
}

export function actualCost(job: Job, chunks: Chunk[]): number {
  let t = 0;
  for (const c of chunks) if (c.usage) t += costOf(c.usage, c.model ?? job.model, c.mode === 'batch');
  return t;
}

const runHtml = (runs: Run[]) =>
  runs
    .map((r) => {
      let s = escapeHtml(r.text);
      if (r.italics) s = `<em>${s}</em>`;
      if (r.bold) s = `<strong>${s}</strong>`;
      return s;
    })
    .join('');

export function blocksToHtml(blocks: Block[]): string {
  return blocks
    .map((b) => {
      switch (b.type) {
        case 'page':
          return `<div class="pm">— trang gốc ${b.page} —</div>`;
        case 'heading':
          return `<h${b.level}>${runHtml(b.runs)}</h${b.level}>`;
        case 'paragraph':
          return `<p>${runHtml(b.runs)}</p>`;
        case 'list': {
          const tag = b.ordered ? 'ol' : 'ul';
          return `<${tag}>${b.items.map((i) => `<li>${runHtml(i)}</li>`).join('')}</${tag}>`;
        }
        case 'table':
          return `<table><thead><tr>${b.header.map((c) => `<th>${runHtml(c)}</th>`).join('')}</tr></thead><tbody>${b.rows
            .map((r) => `<tr>${r.map((c) => `<td>${runHtml(c)}</td>`).join('')}</tr>`)
            .join('')}</tbody></table>`;
      }
    })
    .join('\n');
}

export const mdToHtml = (md: string) => blocksToHtml(parseMarkdown(md));
export { formatUsd };
