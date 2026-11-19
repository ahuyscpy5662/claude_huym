import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import * as fontkit from 'fontkit';

const VI = 'aăâbcdđeêghiklmnoôơpqrstuưvxyAĂÂĐÊÔƠƯàáảãạằắẳẵặầấẩẫậèéẻẽẹềếểễệìíỉĩịòóỏõọồốổỗộờớởỡợùúủũụừứửữựỳýỷỹỵ—–“”…';

describe('Phông Noto Serif hỗ trợ tiếng Việt', () => {
  for (const f of ['Regular', 'Bold', 'Italic', 'BoldItalic']) {
    it(f, () => {
      const font = fontkit.create(readFileSync(`src/assets/fonts/NotoSerif-${f}.ttf`)) as fontkit.Font;
      const missing = [...VI].filter((ch) => !font.hasGlyphForCodePoint(ch.codePointAt(0)!));
      expect(missing).toEqual([]);
    });
  }
});
