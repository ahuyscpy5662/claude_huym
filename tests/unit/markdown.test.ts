import { describe, expect, it } from 'vitest';
import { parseInline, parseMarkdown, runsText } from '../../src/lib/markdown';

describe('parseMarkdown', () => {
  const md = `<<<PAGE 3>>>
# Chương 1. Giải phẫu

Đoạn **đậm** và *nghiêng* ở đây,
tiếp tục dòng sau.

- ý một
- ý hai

1. bước một
2. bước hai

<<<PAGE 4>>>
## Bảng

| Răng | Số chân |
|---|---|
| Răng cửa | 1 |
| Răng hàm lớn | 2–3 |

Hết.`;
  const blocks = parseMarkdown(md);
  it('nhận marker trang', () => {
    expect(blocks.filter((b) => b.type === 'page')).toEqual([{ type: 'page', page: 3 }, { type: 'page', page: 4 }]);
  });
  it('tiêu đề và đoạn văn nối dòng', () => {
    expect(blocks[1]).toMatchObject({ type: 'heading', level: 1 });
    const p = blocks[2];
    expect(p.type).toBe('paragraph');
    if (p.type === 'paragraph') {
      expect(runsText(p.runs)).toBe('Đoạn đậm và nghiêng ở đây, tiếp tục dòng sau.');
      expect(p.runs.some((r) => r.bold)).toBe(true);
      expect(p.runs.some((r) => r.italics)).toBe(true);
    }
  });
  it('danh sách', () => {
    const lists = blocks.filter((b) => b.type === 'list');
    expect(lists).toHaveLength(2);
    expect(lists[0]).toMatchObject({ ordered: false });
    expect(lists[1]).toMatchObject({ ordered: true });
  });
  it('bảng', () => {
    const t = blocks.find((b) => b.type === 'table');
    expect(t).toBeTruthy();
    if (t?.type === 'table') {
      expect(t.header.map(runsText)).toEqual(['Răng', 'Số chân']);
      expect(t.rows).toHaveLength(2);
      expect(runsText(t.rows[1][1])).toBe('2–3');
    }
  });
  it('đoạn cuối sau bảng', () => {
    const last = blocks[blocks.length - 1];
    expect(last.type).toBe('paragraph');
  });
  it('bỏ rào code bao ngoài', () => {
    expect(parseMarkdown('```markdown\n# A\n```')).toEqual([{ type: 'heading', level: 1, runs: [{ text: 'A' }] }]);
  });
  it('marker nằm giữa dòng', () => {
    const b = parseMarkdown('văn bản <<<PAGE 7>>> tiếp');
    expect(b.map((x) => x.type)).toEqual(['paragraph', 'page', 'paragraph']);
  });
});

describe('parseInline', () => {
  it('đậm-nghiêng', () => expect(parseInline('***x***')).toEqual([{ text: 'x', bold: true, italics: true }]));
  it('văn bản thường', () => expect(parseInline('a * b')).toEqual([{ text: 'a * b' }]));
});
