import { expect, test, type Page, type Route } from '@playwright/test';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { deflateSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

// ---------- dữ liệu thử ----------
function crc32(buf: Buffer): number {
  let c: number;
  let crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function png(w: number, h: number): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const o = y * (w * 3 + 1) + 1 + x * 3;
      raw[o] = (x * 255) / w;
      raw[o + 1] = (y * 255) / h;
      raw[o + 2] = (x * y) % 256;
    }
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
async function makePdf(pages: number): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const img = await doc.embedPng(png(220, 170));
  for (let i = 1; i <= pages; i++) {
    const p = doc.addPage([595, 842]);
    p.drawText(`Chapter ${i}. Dental implant osseointegration and periodontitis.`, { x: 50, y: 780, size: 14, font });
    p.drawText('The mandible and maxilla are described here.', { x: 50, y: 750, size: 11, font });
    if (i === 2) p.drawImage(img, { x: 100, y: 450, width: 220, height: 170 });
  }
  return Buffer.from(await doc.save());
}

// ---------- mock Anthropic ----------
const viPage = (n: number) =>
  `<<<PAGE ${n}>>>\n## Chương ${n}. Tích hợp xương implant\n\nViêm nha chu và **tích hợp xương** quanh implant nha khoa (dental implant) được mô tả ở đây.\n\n` +
  (n === 2 ? '| Răng | Số chân |\n|---|---|\n| Răng cửa | 1 |\n| Răng hàm lớn | 2–3 |\n\n' : '- Xương hàm dưới\n- Xương hàm trên\n\n');

function pagesFromBody(body: { messages: { content: { type: string; text?: string }[] }[] }): number[] {
  const t = body.messages[0].content.find((b) => b.type === 'text')!.text!;
  const m = /original pages ([\d, ]+) of the document/.exec(t)!;
  return m[1].split(',').map((x) => parseInt(x.trim(), 10));
}

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': '*' };

interface Mock {
  messageBodies: any[];
  messageHeaders: Record<string, string>[];
  batchCreate: any[];
}

async function mockApi(page: Page): Promise<Mock> {
  const mock: Mock = { messageBodies: [], messageHeaders: [], batchCreate: [] };
  const batchPages = new Map<string, number[]>();
  await page.route('https://api.anthropic.com/**', async (route: Route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const json = (obj: unknown, status = 200) => route.fulfill({ status, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify(obj) });

    if (url.pathname === '/v1/messages' && req.method() === 'POST') {
      const body = req.postDataJSON();
      mock.messageBodies.push(body);
      mock.messageHeaders.push(req.headers());
      const text = pagesFromBody(body).map(viPage).join('\n');
      const ev = (name: string, data: unknown) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
      const sse =
        ev('message_start', { type: 'message_start', message: { id: 'msg_1', type: 'message', role: 'assistant', model: body.model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 3000, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 1200 } } }) +
        ev('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }) +
        ev('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } }) +
        ev('content_block_stop', { type: 'content_block_stop', index: 0 }) +
        ev('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 1500 } }) +
        ev('message_stop', { type: 'message_stop' });
      return route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'text/event-stream' }, body: sse });
    }
    if (url.pathname === '/v1/messages/batches' && req.method() === 'POST') {
      const body = req.postDataJSON();
      mock.batchCreate.push(body);
      const id = 'msgbatch_test01';
      batchPages.set(id, body.requests.map((r: any) => r.custom_id));
      for (const r of body.requests) batchPages.set(r.custom_id, pagesFromBody(r.params));
      return json({ id, type: 'message_batch', processing_status: 'in_progress', request_counts: { processing: body.requests.length, succeeded: 0, errored: 0, canceled: 0, expired: 0 }, created_at: new Date().toISOString() });
    }
    if (/^\/v1\/messages\/batches\/[^/]+$/.test(url.pathname) && req.method() === 'GET') {
      return json({ id: 'msgbatch_test01', type: 'message_batch', processing_status: 'ended', request_counts: { processing: 0, succeeded: 2, errored: 0, canceled: 0, expired: 0 }, results_url: 'https://api.anthropic.com/v1/messages/batches/msgbatch_test01/results' });
    }
    if (/\/results$/.test(url.pathname)) {
      const ids = batchPages.get('msgbatch_test01') ?? [];
      const lines = [...ids].reverse().map((cid) =>
        JSON.stringify({ custom_id: cid, result: { type: 'succeeded', message: { id: 'm', type: 'message', role: 'assistant', model: 'claude-sonnet-5-5', content: [{ type: 'text', text: (batchPages.get(cid) ?? []).map(viPage).join('\n') }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 3000, output_tokens: 1500, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } } }),
      );
      return route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'application/x-jsonl' }, body: lines.join('\n') + '\n' });
    }
    return json({ type: 'error', error: { type: 'not_found_error', message: 'mock: ' + url.pathname } }, 404);
  });
  return mock;
}

async function setupApp(page: Page) {
  const mock = await mockApi(page);
  await page.goto('/#/settings');
  await page.fill('#key', 'sk-ant-test-key');
  await page.fill('#chunk', '3');
  await page.click('#save');
  await expect(page.locator('#saved')).toHaveText('Đã lưu.');
  await page.goto('/#/');
  return mock;
}

async function importPdf(page: Page, pages: number) {
  const buf = await makePdf(pages);
  await page.setInputFiles('#file', { name: 'Implant Test Book.pdf', mimeType: 'application/pdf', buffer: buf });
  await expect(page.locator('h2', { hasText: 'Implant Test Book' }).first()).toBeVisible();
}

async function inspectPdf(path: string) {
  const data = new Uint8Array(readFileSync(path));
  const doc = await pdfjs.getDocument({ data, useSystemFonts: false }).promise;
  let text = '';
  let images = 0;
  for (let i = 1; i <= doc.numPages; i++) {
    const p = await doc.getPage(i);
    text += (await p.getTextContent()).items.map((it: any) => it.str).join(' ') + '\n';
    const ops = await p.getOperatorList();
    images += ops.fnArray.filter((f: number) => f === pdfjs.OPS.paintImageXObject || f === pdfjs.OPS.paintInlineImageXObject).length;
  }
  return { pages: doc.numPages, text, images };
}

test('Nhanh: nhập PDF → dịch → xuất PDF tiếng Việt có hình', async ({ page }, testInfo) => {
  const mock = await setupApp(page);
  await importPdf(page, 6);
  await expect(page.locator('.chunks li')).toHaveCount(2);

  await page.getByRole('button', { name: 'Bắt đầu dịch' }).click();
  await expect(page.locator('.badge', { hasText: 'Hoàn tất' }).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('.stat b', { hasText: '2/2' })).toBeVisible();
  // chi phí thực tế > 0
  await expect(page.locator('#cost')).not.toHaveText('$0.0000');

  // kiểm tra request gửi lên
  expect(mock.messageBodies).toHaveLength(2);
  const b = mock.messageBodies[0];
  expect(b.model).toBe('claude-sonnet-5-5');
  expect(b.max_tokens).toBe(32000);
  expect(b.output_config).toEqual({ effort: 'medium' });
  expect(b.fallbacks).toBe('default');
  expect(b.thinking).toBeUndefined();
  expect(b.temperature).toBeUndefined();
  expect(b.system[0].cache_control).toEqual({ type: 'ephemeral' });
  expect(b.messages[0].content[0]).toMatchObject({ type: 'document', source: { type: 'base64', media_type: 'application/pdf' } });
  expect(b.messages[0].content[0].source.data.length).toBeGreaterThan(500);
  expect(mock.messageHeaders[0]['anthropic-beta']).toContain('server-side-fallback-2026-07-01');
  expect(mock.messageHeaders[0]['anthropic-dangerous-direct-browser-access']).toBe('true');

  // xem một đoạn
  await page.locator('.chunks li a').first().click();
  await expect(page.locator('.preview')).toContainText('Tích hợp xương implant');
  await expect(page.locator('#thumbs canvas').first()).toBeVisible({ timeout: 20_000 });
  await page.goBack();

  // xuất PDF
  const dl = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Xuất PDF' }).click();
  const download = await dl;
  expect(download.suggestedFilename()).toBe('Implant Test Book - Tieng Viet.pdf');
  const out = testInfo.outputPath('out.pdf');
  await download.saveAs(out);

  const info = await inspectPdf(out);
  expect(info.pages).toBeGreaterThan(1);
  expect(info.text).toContain('Bản dịch tiếng Việt');
  expect(info.text).toContain('tích hợp xương');
  expect(info.text).toContain('Viêm nha chu');
  expect(info.text).toContain('trang gốc 2');
  expect(info.text).toContain('Răng hàm lớn');
  expect(info.images).toBeGreaterThanOrEqual(1);
});

test('Tiết kiệm 50%: gửi batch → kiểm tra batch → kết quả khớp theo custom_id', async ({ page }) => {
  const mock = await setupApp(page);
  await importPdf(page, 6);
  await page.locator('label.mode', { hasText: 'Tiết kiệm 50%' }).click();
  await page.getByRole('button', { name: 'Gửi batch' }).click();
  await expect(page.locator('.alert', { hasText: 'Đã tạo 1 batch' })).toBeVisible({ timeout: 30_000 });
  expect(mock.batchCreate).toHaveLength(1);
  const reqs = mock.batchCreate[0].requests;
  expect(reqs.map((r: any) => r.custom_id)).toEqual(['chunk-0', 'chunk-1']);
  expect(reqs[0].params.fallbacks).toBeUndefined();
  expect(JSON.stringify(reqs[0].params)).not.toContain('fallbacks');
  expect(reqs[0].params.system[0].cache_control).toEqual({ type: 'ephemeral' });
  await expect(page.locator('.badge', { hasText: 'Đã gửi batch' }).first()).toBeVisible();

  await page.getByRole('button', { name: 'Kiểm tra batch' }).click();
  await expect(page.locator('.badge', { hasText: 'Hoàn tất' }).first()).toBeVisible({ timeout: 30_000 });
  await page.locator('.chunks li a').nth(1).click();
  await expect(page.locator('.preview')).toContainText('Chương 4');
});

test('Khóa API sai (401) dừng cả job với thông báo tiếng Việt', async ({ page }) => {
  await page.route('https://api.anthropic.com/**', async (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    return route.fulfill({ status: 401, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }) });
  });
  await page.goto('/#/settings');
  await page.fill('#key', 'sk-ant-bad');
  await page.click('#save');
  await page.goto('/#/');
  await importPdf(page, 4);
  await page.getByRole('button', { name: 'Bắt đầu dịch' }).click();
  await expect(page.locator('.alert.error')).toContainText('Khóa API không hợp lệ', { timeout: 30_000 });
});
