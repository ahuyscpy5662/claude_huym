export interface Run {
  text: string;
  bold?: boolean;
  italics?: boolean;
}

export type Block =
  | { type: 'page'; page: number }
  | { type: 'heading'; level: 1 | 2 | 3; runs: Run[] }
  | { type: 'paragraph'; runs: Run[] }
  | { type: 'list'; ordered: boolean; items: Run[][] }
  | { type: 'table'; header: Run[][]; rows: Run[][][] };

const PAGE_RE = /^\s*<<<\s*PAGE\s+(\d+)\s*>>>\s*$/i;
const PAGE_INLINE_RE = /<<<\s*PAGE\s+(\d+)\s*>>>/gi;

/** Phân tích **đậm** và *nghiêng* trong một dòng. */
export function parseInline(src: string): Run[] {
  const runs: Run[] = [];
  const re = /(\*\*\*([^*]+)\*\*\*|\*\*([^*]+)\*\*|\*([^*\s][^*]*)\*|__([^_]+)__)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    if (m.index > last) runs.push({ text: src.slice(last, m.index) });
    if (m[2] !== undefined) runs.push({ text: m[2], bold: true, italics: true });
    else if (m[3] !== undefined) runs.push({ text: m[3], bold: true });
    else if (m[4] !== undefined) runs.push({ text: m[4], italics: true });
    else if (m[5] !== undefined) runs.push({ text: m[5], bold: true });
    last = m.index + m[0].length;
  }
  if (last < src.length) runs.push({ text: src.slice(last) });
  return runs.length ? runs : [{ text: '' }];
}

function splitRow(line: string): string[] {
  let t = line.trim();
  if (t.startsWith('|')) t = t.slice(1);
  if (t.endsWith('|') && !t.endsWith('\\|')) t = t.slice(0, -1);
  return t.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'));
}

const isSepRow = (line: string) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line) && line.includes('-');
const isTableLine = (line: string) => line.includes('|') && line.trim().length > 1;

/** Chuyển Markdown nhẹ (kèm các dòng <<<PAGE n>>>) thành danh sách khối. */
export function parseMarkdown(input: string): Block[] {
  let text = input.replace(/\r\n?/g, '\n').trim();
  // bỏ rào code nếu mô hình bọc cả đầu ra
  text = text.replace(/^```[a-z]*\n/i, '').replace(/\n```\s*$/i, '');
  const lines = text.split('\n');
  const blocks: Block[] = [];
  let para: string[] = [];

  const flushPara = () => {
    if (para.length) {
      blocks.push({ type: 'paragraph', runs: parseInline(para.join(' ').replace(/\s+/g, ' ').trim()) });
      para = [];
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const pm = PAGE_RE.exec(line);
    if (pm) {
      flushPara();
      blocks.push({ type: 'page', page: parseInt(pm[1], 10) });
      continue;
    }
    if (!line.trim()) {
      flushPara();
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      flushPara();
      const level = Math.min(3, h[1].length) as 1 | 2 | 3;
      blocks.push({ type: 'heading', level, runs: parseInline(h[2].trim()) });
      continue;
    }
    // bảng: dòng tiêu đề + dòng phân cách
    if (isTableLine(line) && i + 1 < lines.length && isSepRow(lines[i + 1])) {
      flushPara();
      const header = splitRow(line).map(parseInline);
      const rows: Run[][][] = [];
      i += 2;
      while (i < lines.length && isTableLine(lines[i]) && !PAGE_RE.test(lines[i])) {
        const cells = splitRow(lines[i]).map(parseInline);
        while (cells.length < header.length) cells.push([{ text: '' }]);
        rows.push(cells.slice(0, Math.max(header.length, cells.length)));
        i++;
      }
      i--;
      blocks.push({ type: 'table', header, rows });
      continue;
    }
    const li = /^\s*(?:([-*•])|(\d+)[.)])\s+(.*)$/.exec(line);
    if (li) {
      flushPara();
      const ordered = li[2] !== undefined;
      const items: Run[][] = [parseInline(li[3].trim())];
      while (i + 1 < lines.length) {
        const nx = lines[i + 1];
        const m2 = /^\s*(?:([-*•])|(\d+)[.)])\s+(.*)$/.exec(nx);
        if (m2 && (m2[2] !== undefined) === ordered) {
          items.push(parseInline(m2[3].trim()));
          i++;
        } else if (/^\s{2,}\S/.test(nx) && !m2) {
          // dòng tiếp nối của mục trước
          const prev = items[items.length - 1];
          prev.push(...parseInline(' ' + nx.trim()));
          i++;
        } else break;
      }
      blocks.push({ type: 'list', ordered, items });
      continue;
    }
    // đoạn văn có thể chứa marker trang giữa dòng: tách ra
    if (PAGE_INLINE_RE.test(line)) {
      PAGE_INLINE_RE.lastIndex = 0;
      const pieces = line.split(PAGE_INLINE_RE);
      // split với nhóm bắt: [text, num, text, num, ...]
      for (let k = 0; k < pieces.length; k++) {
        if (k % 2 === 1) {
          flushPara();
          blocks.push({ type: 'page', page: parseInt(pieces[k], 10) });
        } else if (pieces[k].trim()) para.push(pieces[k].trim());
      }
      PAGE_INLINE_RE.lastIndex = 0;
      continue;
    }
    para.push(line.trim());
  }
  flushPara();
  return blocks;
}

/** Số ký tự văn bản thuần của các Run (dùng để kiểm thử/ước lượng). */
export const runsText = (runs: Run[]) => runs.map((r) => r.text).join('');
