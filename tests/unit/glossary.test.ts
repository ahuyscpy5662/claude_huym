import { describe, expect, it } from 'vitest';
import { DEFAULT_GLOSSARY_TEXT, glossaryPromptText, parseGlossary } from '../../src/lib/glossary';
import { buildSystemPrompt, buildUserText } from '../../src/lib/prompt';

describe('parseGlossary', () => {
  it('đọc TAB và " = ", bỏ chú thích và dòng sai', () => {
    const e = parseGlossary('# chú thích\nmolar\trăng hàm lớn\n\ncanine = răng nanh\nkhông có dấu phân cách\nx\t');
    expect(e).toEqual([
      { english: 'molar', vietnamese: 'răng hàm lớn' },
      { english: 'canine', vietnamese: 'răng nanh' },
    ]);
  });
  it('bảng mặc định có ~190 thuật ngữ', () => {
    const e = parseGlossary(DEFAULT_GLOSSARY_TEXT);
    expect(e.length).toBeGreaterThan(170);
    expect(e.find((x) => x.english === 'osseointegration')?.vietnamese).toBe('tích hợp xương');
  });
  it('dạng prompt', () => expect(glossaryPromptText([{ english: 'a', vietnamese: 'b' }])).toBe('a => b'));
});

describe('prompt', () => {
  it('system prompt ổn định từng byte', () => {
    expect(buildSystemPrompt(DEFAULT_GLOSSARY_TEXT, true)).toBe(buildSystemPrompt(DEFAULT_GLOSSARY_TEXT, true));
  });
  it('quy tắc thuật ngữ tiếng Anh đổi theo cài đặt', () => {
    expect(buildSystemPrompt('', true)).toContain('followed by the original English in parentheses');
    expect(buildSystemPrompt('', false)).toContain('do not add the English original');
  });
  it('user message chứa số trang tuyệt đối và không nằm trong system', () => {
    const u = buildUserText({ startPage: 9, endPage: 11, documentTitle: 'Sách X' });
    expect(u).toContain('<<<PAGE 9>>> <<<PAGE 10>>> <<<PAGE 11>>>');
    expect(u).toContain('Sách X');
    expect(buildSystemPrompt('', true)).not.toContain('Sách X');
  });
});
