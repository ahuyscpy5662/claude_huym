import { describe, expect, it } from 'vitest';
import { chunkRanges, pageList, splitRange } from '../../src/lib/chunking';

describe('chunkRanges', () => {
  it('chia 10 trang thành đoạn 4 trang', () => {
    expect(chunkRanges(10, 4)).toEqual([
      { startPage: 1, endPage: 4 },
      { startPage: 5, endPage: 8 },
      { startPage: 9, endPage: 10 },
    ]);
  });
  it('kẹp kích thước vào 1–10', () => {
    expect(chunkRanges(3, 0)).toHaveLength(3);
    expect(chunkRanges(25, 99)).toHaveLength(3);
  });
  it('tài liệu rỗng', () => expect(chunkRanges(0, 4)).toEqual([]));
  it('sách 1200 trang không bỏ sót trang nào', () => {
    const r = chunkRanges(1200, 4);
    expect(r).toHaveLength(300);
    expect(r[299].endPage).toBe(1200);
    expect(r.flatMap(pageList)).toHaveLength(1200);
  });
});

describe('splitRange', () => {
  it('chia đôi', () => expect(splitRange({ startPage: 5, endPage: 8 })).toEqual([{ startPage: 5, endPage: 6 }, { startPage: 7, endPage: 8 }]));
  it('3 trang', () => expect(splitRange({ startPage: 1, endPage: 3 })).toEqual([{ startPage: 1, endPage: 2 }, { startPage: 3, endPage: 3 }]));
  it('1 trang không chia được', () => expect(splitRange({ startPage: 2, endPage: 2 })).toBeNull());
});
