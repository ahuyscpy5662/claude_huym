import { describe, expect, it } from 'vitest';
import { backoffMs, classifyError } from '../../src/lib/retry';
import { ChunkError, FatalError, withRetry, translateRange, type RangeSource } from '../../src/lib/claude';

describe('classifyError', () => {
  it.each([[429], [408], [409], [500], [503], [529]])('thử lại %i', (s) => expect(classifyError({ status: s })).toBe('retry'));
  it.each([[401], [403]])('dừng job %i', (s) => expect(classifyError({ status: s })).toBe('fatal'));
  it('hết credit', () => expect(classifyError({ status: 400, message: 'Your credit balance is too low' })).toBe('fatal'));
  it('400 thường là lỗi đoạn', () => expect(classifyError({ status: 400, message: 'bad' })).toBe('invalid'));
  it('lỗi mạng không mã', () => expect(classifyError({ message: 'Connection error.' })).toBe('retry'));
});

describe('backoffMs', () => {
  it('tôn trọng retry-after', () => expect(backoffMs(1, 7, () => 0)).toBe(7000));
  it('lũy thừa có trần 60s', () => {
    expect(backoffMs(1, null, () => 0)).toBe(4000);
    expect(backoffMs(2, null, () => 0)).toBe(8000);
    expect(backoffMs(9, null, () => 0)).toBe(60000);
  });
  it('jitter', () => expect(backoffMs(1, null, () => 1)).toBe(5500));
});

describe('withRetry', () => {
  const noSleep = async () => undefined;
  it('thử lại rồi thành công', async () => {
    let n = 0;
    const r = await withRetry(async () => { if (++n < 3) throw Object.assign(new Error('x'), { status: 529 }); return 'ok'; }, undefined, undefined, noSleep);
    expect(r).toBe('ok');
    expect(n).toBe(3);
  });
  it('401 → FatalError ngay', async () => {
    let n = 0;
    await expect(withRetry(async () => { n++; throw Object.assign(new Error('no'), { status: 401 }); }, undefined, undefined, noSleep)).rejects.toBeInstanceOf(FatalError);
    expect(n).toBe(1);
  });
  it('hết lượt thử → ChunkError (tối đa 6 lần)', async () => {
    let n = 0;
    await expect(withRetry(async () => { n++; throw Object.assign(new Error('x'), { status: 500 }); }, undefined, undefined, noSleep)).rejects.toBeInstanceOf(ChunkError);
    expect(n).toBe(6);
  });
});

describe('translateRange', () => {
  const src: RangeSource = { slice: async () => ({ data: 'AAAA', bytes: 3 }) };
  const ctx = { settings: {} as never, title: 't' };
  const usage = { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 };
  it('max_tokens → chia đôi tới khi xong', async () => {
    const calls: string[] = [];
    const send = (async (_c: unknown, _x: unknown, range: { startPage: number; endPage: number }) => {
      calls.push(`${range.startPage}-${range.endPage}`);
      if (range.endPage - range.startPage >= 2) return { text: 'cắt', stopReason: 'max_tokens', usage };
      return { text: `<<<PAGE ${range.startPage}>>>`, stopReason: 'end_turn', usage };
    }) as never;
    const out = await translateRange({} as never, ctx, src, { startPage: 1, endPage: 4 }, undefined, undefined, { send, sleeper: async () => undefined });
    expect(calls).toEqual(['1-4', '1-2', '3-4']);
    expect(out.text).toBe('<<<PAGE 1>>>\n\n<<<PAGE 3>>>');
    expect(out.usage.input).toBe(3);
  });
  it('refusal → ChunkError', async () => {
    const send = (async () => ({ text: '', stopReason: 'refusal', usage })) as never;
    await expect(translateRange({} as never, ctx, src, { startPage: 1, endPage: 2 }, undefined, undefined, { send })).rejects.toBeInstanceOf(ChunkError);
  });
  it('max_tokens ở 1 trang → ChunkError', async () => {
    const send = (async () => ({ text: 'x', stopReason: 'max_tokens', usage })) as never;
    await expect(translateRange({} as never, ctx, src, { startPage: 2, endPage: 2 }, undefined, undefined, { send })).rejects.toBeInstanceOf(ChunkError);
  });
});
