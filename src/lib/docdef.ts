import { parseMarkdown, type Block, type Run } from './markdown';
import { modelInfo } from './models';

export interface ExportChunk {
  startPage: number;
  endPage: number;
  status: string;
  text: string;
}
export interface ExportImage {
  name: string;
  width: number;
  height: number;
}
export interface ExportInput {
  title: string;
  model: string;
  totalPages: number;
  chunks: ExportChunk[];
  /** ảnh gốc theo số trang */
  images: Map<number, ExportImage[]>;
  date: string;
}

export const PAGE_WIDTH_PT = 595.28 - 2 * 50;
const MAX_IMAGE_HEIGHT_PT = 620;

type Content = Record<string, unknown>;

function cellRuns(runs: Run[], extra: Record<string, unknown> = {}): Content {
  return { text: runs.map((r) => ({ text: r.text, ...(r.bold ? { bold: true } : {}), ...(r.italics ? { italics: true } : {}) })), ...extra };
}

function blockToContent(b: Block): Content | null {
  switch (b.type) {
    case 'page':
      return null;
    case 'heading':
      return cellRuns(b.runs, { style: `h${b.level}` });
    case 'paragraph':
      return cellRuns(b.runs, { style: 'p' });
    case 'list': {
      const items = b.items.map((it) => cellRuns(it));
      return b.ordered ? { ol: items, margin: [0, 0, 0, 6] } : { ul: items, margin: [0, 0, 0, 6] };
    }
    case 'table': {
      const cols = Math.max(b.header.length, ...b.rows.map((r) => r.length));
      const pad = (cells: Run[][]) => {
        const out = [...cells];
        while (out.length < cols) out.push([{ text: '' }]);
        return out;
      };
      const small = cols >= 5;
      const body = [
        pad(b.header).map((c) => cellRuns(c, { bold: true, fillColor: '#eeeeee', style: small ? 'cellSmall' : 'cell' })),
        ...b.rows.map((r) => pad(r).map((c) => cellRuns(c, { style: small ? 'cellSmall' : 'cell' }))),
      ];
      return {
        table: { headerRows: 1, widths: Array(cols).fill('*'), body },
        layout: 'lightHorizontalLines',
        margin: [0, 2, 0, 8],
      };
    }
  }
}

function imageContents(imgs: ExportImage[]): Content[] {
  return imgs.map((im) => {
    const wPt = im.width * 0.75;
    const hPt = im.height * 0.75;
    const scale = Math.min(PAGE_WIDTH_PT / wPt, MAX_IMAGE_HEIGHT_PT / hPt, 1.6);
    return { image: im.name, width: Math.round(wPt * scale), alignment: 'center', margin: [0, 4, 0, 8] };
  });
}

/** Các trang cần ảnh gốc (chỉ trang thuộc đoạn đã dịch). */
export function pagesNeedingImages(chunks: ExportChunk[]): number[] {
  const out: number[] = [];
  for (const c of chunks) {
    if (c.status !== 'done') continue;
    for (let p = c.startPage; p <= c.endPage; p++) out.push(p);
  }
  return out;
}

export function buildDocDefinition(input: ExportInput): Record<string, unknown> {
  const done = input.chunks.filter((c) => c.status === 'done');
  const pagesDone = done.reduce((n, c) => n + (c.endPage - c.startPage + 1), 0);
  const incomplete = pagesDone < input.totalPages;
  const content: Content[] = [];
  const imagesDone = new Set<number>();

  // ---- trang bìa
  content.push({ text: input.title, style: 'coverTitle', margin: [0, 150, 0, 14] });
  content.push({ text: 'Bản dịch tiếng Việt — chuyên ngành Răng Hàm Mặt', style: 'coverSub' });
  content.push({
    margin: [0, 40, 0, 0],
    alignment: 'center',
    lineHeight: 1.5,
    text: [
      `Số trang bản gốc: ${input.totalPages}\n`,
      `Đã dịch: ${pagesDone}/${input.totalPages} trang\n`,
      `Mô hình: ${modelInfo(input.model).id}\n`,
      `Ngày xuất: ${input.date}`,
    ],
  });
  if (incomplete) {
    content.push({
      margin: [30, 30, 30, 0],
      alignment: 'center',
      bold: true,
      color: '#b00020',
      text: `Cảnh báo: bản dịch chưa hoàn chỉnh — còn ${input.totalPages - pagesDone} trang chưa được dịch (đánh dấu trong văn bản).`,
    });
  }
  content.push({
    margin: [30, 40, 30, 0],
    alignment: 'center',
    italics: true,
    color: '#555555',
    fontSize: 9.5,
    text: 'Đây là bản dịch máy do trí tuệ nhân tạo thực hiện, cần được chuyên gia Răng Hàm Mặt rà soát trước khi sử dụng cho học tập hoặc lâm sàng. Văn bản được dàn lại; hình ảnh gốc được chèn sau từng trang.',
  });
  content.push({ text: '', pageBreak: 'after' });

  const pushImages = (p: number) => {
    if (imagesDone.has(p)) return;
    imagesDone.add(p);
    const imgs = input.images.get(p);
    if (imgs?.length) content.push(...imageContents(imgs));
  };
  const marker = (p: number): Content => ({ text: `— trang gốc ${p} —`, style: 'marker' });

  for (const chunk of input.chunks) {
    if (chunk.status !== 'done' || !chunk.text.trim()) {
      const lbl = chunk.startPage === chunk.endPage ? `trang ${chunk.startPage}` : `trang ${chunk.startPage}–${chunk.endPage}`;
      content.push(marker(chunk.startPage));
      content.push({ text: `[Chưa dịch: ${lbl}]`, italics: true, color: '#888888', margin: [0, 2, 0, 10] });
      continue;
    }
    let cur: number | null = null;
    for (const b of parseMarkdown(chunk.text)) {
      if (b.type === 'page') {
        if (cur !== null) pushImages(cur);
        cur = b.page;
        content.push(marker(b.page));
        continue;
      }
      if (cur === null) {
        cur = chunk.startPage;
        content.push(marker(cur));
      }
      const c = blockToContent(b);
      if (c) content.push(c);
    }
    if (cur !== null) pushImages(cur);
    for (let p = chunk.startPage; p <= chunk.endPage; p++) pushImages(p);
  }

  return {
    pageSize: 'A4',
    pageMargins: [50, 50, 50, 55],
    info: { title: `${input.title} - Tiếng Việt`, subject: 'Bản dịch máy — cần rà soát chuyên môn' },
    defaultStyle: { font: 'NotoSerif', fontSize: 10.5, lineHeight: 1.2 },
    styles: {
      coverTitle: { fontSize: 24, bold: true, alignment: 'center' },
      coverSub: { fontSize: 14, alignment: 'center', color: '#333333' },
      h1: { fontSize: 17, bold: true, margin: [0, 12, 0, 6] },
      h2: { fontSize: 14, bold: true, margin: [0, 10, 0, 5] },
      h3: { fontSize: 12, bold: true, margin: [0, 8, 0, 4] },
      p: { margin: [0, 0, 0, 6] },
      cell: { fontSize: 9.5 },
      cellSmall: { fontSize: 8 },
      marker: { fontSize: 8, color: '#888888', alignment: 'center', margin: [0, 8, 0, 6] },
    },
    content,
  };
}
