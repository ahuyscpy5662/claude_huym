import type { Usage } from './types';

export interface ModelInfo {
  id: string;
  name: string;
  /** USD / 1 triệu token */
  input: number;
  output: number;
  cacheRead: number;
  serverFallback: boolean;
}

export const DEFAULT_MODEL = 'claude-sonnet-5-5';

export const MODELS: ModelInfo[] = [
  { id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5 (cân bằng, mặc định)', input: 2, output: 10, cacheRead: 0.1, serverFallback: true },
  { id: 'claude-opus-5-5', name: 'Claude Opus 5.5 (chất lượng cao nhất)', input: 4, output: 20, cacheRead: 0.2, serverFallback: true },
  { id: 'claude-haiku-5-5', name: 'Claude Haiku 5.5 (rẻ nhất)', input: 0.1, output: 0.5, cacheRead: 0.01, serverFallback: false },
];

export function modelInfo(id: string): ModelInfo {
  return MODELS.find((m) => m.id === id) ?? MODELS[0];
}

export const emptyUsage = (): Usage => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });

export function addUsage(a: Usage, b: Usage): Usage {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cacheRead: a.cacheRead + b.cacheRead,
    cacheWrite: a.cacheWrite + b.cacheWrite,
  };
}

/** Chi phí (USD). Ghi cache = 1,25 × giá đầu vào. Batch giảm 50%. */
export function costOf(usage: Usage, modelId: string, batch: boolean): number {
  const m = modelInfo(modelId);
  const total =
    (usage.input * m.input +
      usage.cacheWrite * m.input * 1.25 +
      usage.cacheRead * m.cacheRead +
      usage.output * m.output) /
    1_000_000;
  return batch ? total * 0.5 : total;
}

/** Ước tính sơ bộ: ~2.500 token vào / trang (chữ + ảnh trang) và ~1.500 token ra / trang. */
export function estimateCost(pages: number, chunkCount: number, systemTokens: number, modelId: string, batch: boolean): number {
  const usage: Usage = {
    input: pages * 2500,
    output: pages * 1500,
    cacheWrite: systemTokens,
    cacheRead: systemTokens * Math.max(0, chunkCount - 1),
  };
  return costOf(usage, modelId, batch);
}

export function formatUsd(v: number): string {
  if (v < 0.01) return '$' + v.toFixed(4);
  return '$' + v.toFixed(2);
}
