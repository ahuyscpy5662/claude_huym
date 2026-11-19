import { describe, expect, it } from 'vitest';
import { customIdOf, mapBatchResult, parseCustomId, planBatches, type BatchResultLike } from '../../src/lib/batchutil';

const ok = (id: string, text: string, stop = 'end_turn'): BatchResultLike => ({
  custom_id: id,
  result: { type: 'succeeded', message: { content: [{ type: 'thinking' }, { type: 'text', text }], stop_reason: stop, usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 3, cache_creation_input_tokens: null } } },
});

describe('custom_id', () => {
  it('khứ hồi', () => expect(parseCustomId(customIdOf(42))).toBe(42));
  it('từ chối id lạ', () => expect(parseCustomId('abc')).toBeNull());
});

describe('mapBatchResult', () => {
  it('thành công, chỉ ghép khối text', () => {
    const m = mapBatchResult(ok('chunk-7', ' Xin chào '));
    expect(m).toEqual({ index: 7, ok: true, text: 'Xin chào', usage: { input: 10, output: 5, cacheRead: 3, cacheWrite: 0 } });
  });
  it('thứ tự bất kỳ vẫn khớp theo custom_id', () => {
    const arr = [ok('chunk-2', 'b'), ok('chunk-0', 'a'), ok('chunk-1', 'c')].map(mapBatchResult);
    expect(arr.map((x) => x!.index)).toEqual([2, 0, 1]);
  });
  it('refusal / max_tokens → thất bại', () => {
    expect(mapBatchResult(ok('chunk-1', 'x', 'refusal'))).toMatchObject({ ok: false });
    expect(mapBatchResult(ok('chunk-1', 'x', 'max_tokens'))).toMatchObject({ ok: false });
  });
  it('errored / expired / canceled → thất bại', () => {
    expect(mapBatchResult({ custom_id: 'chunk-3', result: { type: 'errored', error: { error: { message: 'boom' } } } })).toMatchObject({ index: 3, ok: false });
    expect(mapBatchResult({ custom_id: 'chunk-4', result: { type: 'expired' } })).toMatchObject({ ok: false });
    expect(mapBatchResult({ custom_id: 'chunk-5', result: { type: 'canceled' } })).toMatchObject({ ok: false });
  });
  it('bỏ qua custom_id lạ', () => expect(mapBatchResult({ custom_id: 'zzz', result: { type: 'expired' } })).toBeNull());
});

describe('planBatches', () => {
  it('chia theo dung lượng', () => {
    const items = [40, 40, 40, 40, 40].map((m, i) => ({ i, bytes: m * 1024 * 1024 }));
    const plan = planBatches(items, 100 * 1024 * 1024);
    expect(plan.map((b) => b.length)).toEqual([2, 2, 1]);
  });
  it('chia theo số yêu cầu', () => {
    const items = Array.from({ length: 5 }, (_, i) => ({ i, bytes: 1 }));
    expect(planBatches(items, 1e9, 2).map((b) => b.length)).toEqual([2, 2, 1]);
  });
  it('một mục quá lớn vẫn nằm trong batch riêng', () => {
    expect(planBatches([{ bytes: 500 }, { bytes: 1 }], 100).map((b) => b.length)).toEqual([1, 1]);
  });
});
