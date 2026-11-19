import { describe, expect, it } from 'vitest';
import { costOf, estimateCost, MODELS, DEFAULT_MODEL } from '../../src/lib/models';

describe('costOf', () => {
  const u = { input: 1_000_000, output: 1_000_000, cacheRead: 1_000_000, cacheWrite: 1_000_000 };
  it('sonnet realtime', () => expect(costOf(u, 'claude-sonnet-5-5', false)).toBeCloseTo(2 + 10 + 0.1 + 2.5, 6));
  it('opus batch giảm 50%', () => expect(costOf(u, 'claude-opus-5-5', true)).toBeCloseTo((4 + 20 + 0.2 + 5) / 2, 6));
  it('haiku', () => expect(costOf(u, 'claude-haiku-5-5', false)).toBeCloseTo(0.1 + 0.5 + 0.01 + 0.125, 6));
  it('mô hình lạ rơi về mô hình đầu', () => expect(costOf(u, 'x', false)).toBeCloseTo(costOf(u, MODELS[0].id, false), 6));
  it('mô hình mặc định là sonnet 5.5', () => expect(DEFAULT_MODEL).toBe('claude-sonnet-5-5'));
});

describe('estimateCost', () => {
  it('sách 300 trang ~ vài đô la với Sonnet, batch bằng một nửa', () => {
    const rt = estimateCost(300, 75, 5000, 'claude-sonnet-5-5', false);
    const b = estimateCost(300, 75, 5000, 'claude-sonnet-5-5', true);
    expect(rt).toBeGreaterThan(4);
    expect(rt).toBeLessThan(9);
    expect(b).toBeCloseTo(rt / 2, 6);
  });
});
