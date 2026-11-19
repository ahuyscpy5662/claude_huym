import { describe, expect, it } from 'vitest';
import { buildDocDefinition, pagesNeedingImages } from '../../src/lib/docdef';

const chunks = [
  { startPage: 1, endPage: 2, status: 'done', text: '<<<PAGE 1>>>\n# Tiêu đề\n\nNội dung.\n\n<<<PAGE 2>>>\nTrang hai.' },
  { startPage: 3, endPage: 4, status: 'failed', text: '' },
];

describe('buildDocDefinition', () => {
  const def = buildDocDefinition({
    title: 'Sách',
    model: 'claude-sonnet-5-5',
    totalPages: 4,
    chunks,
    images: new Map([[1, [{ name: 'img-1-0', width: 400, height: 300 }]]]),
    date: '1/1/2026',
  }) as { content: Record<string, unknown>[] };
  const flat = JSON.stringify(def.content);

  it('có trang bìa, cảnh báo chưa hoàn chỉnh và ghi chú dịch máy', () => {
    expect(flat).toContain('Bản dịch tiếng Việt — chuyên ngành Răng Hàm Mặt');
    expect(flat).toContain('Cảnh báo');
    expect(flat).toContain('bản dịch máy');
  });
  it('ảnh trang 1 chèn ngay trước marker trang 2', () => {
    const iImg = def.content.findIndex((c) => c.image === 'img-1-0');
    const iM2 = def.content.findIndex((c) => c.text === '— trang gốc 2 —');
    const iM1 = def.content.findIndex((c) => c.text === '— trang gốc 1 —');
    expect(iM1).toBeLessThan(iImg);
    expect(iImg).toBeLessThan(iM2);
  });
  it('đoạn chưa dịch có chú thích nghiêng', () => {
    expect(flat).toContain('[Chưa dịch: trang 3–4]');
  });
  it('chỉ lấy ảnh cho đoạn đã dịch', () => expect(pagesNeedingImages(chunks)).toEqual([1, 2]));
});
