import { DEFAULT_GLOSSARY_TEXT } from './glossary';
import { DEFAULT_MODEL, MODELS } from './models';
import type { Settings } from './types';

const KEY = 'rhm-dich-pdf:settings';

export const DEFAULT_SETTINGS: Settings = {
  apiKey: '',
  model: DEFAULT_MODEL,
  effort: 'medium',
  concurrency: 3,
  chunkSize: 4,
  keepEnglishTerms: true,
  glossary: DEFAULT_GLOSSARY_TEXT,
};

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(v) || lo));

export function sanitize(s: Partial<Settings>): Settings {
  const d = DEFAULT_SETTINGS;
  const model = MODELS.some((m) => m.id === s.model) ? (s.model as string) : d.model;
  const effort = s.effort === 'low' || s.effort === 'high' || s.effort === 'medium' ? s.effort : d.effort;
  return {
    apiKey: (s.apiKey ?? d.apiKey).trim(),
    model,
    effort,
    concurrency: clamp(s.concurrency ?? d.concurrency, 1, 8),
    chunkSize: clamp(s.chunkSize ?? d.chunkSize, 1, 10),
    keepEnglishTerms: s.keepEnglishTerms ?? d.keepEnglishTerms,
    glossary: typeof s.glossary === 'string' && s.glossary.trim() ? s.glossary : d.glossary,
  };
}

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return sanitize(JSON.parse(raw));
  } catch {
    /* bỏ qua */
  }
  return { ...DEFAULT_SETTINGS };
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(sanitize(s)));
  } catch {
    /* bỏ qua */
  }
}
