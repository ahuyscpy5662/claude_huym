import { DEFAULT_GLOSSARY_TEXT, parseGlossary } from '../lib/glossary';
import { MODELS } from '../lib/models';
import { loadSettings, sanitize, saveSettings } from '../lib/settings';
import { $, esc } from './util';

export function renderSettings(root: HTMLElement): void {
  const s = loadSettings();
  root.innerHTML = `
    <header class="top"><a class="back" href="#/">‹ Danh sách</a><h1>Cài đặt</h1></header>
    <div class="card">
      <h2>Khóa API Anthropic</h2>
      <div class="row"><input id="key" class="grow" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="sk-ant-…" value="${esc(s.apiKey)}" /><button id="show" type="button">Hiện</button></div>
      <div class="field-note">Khóa chỉ lưu trong trình duyệt này (localStorage) và chỉ được gửi tới api.anthropic.com. Không có máy chủ trung gian.</div>
    </div>
    <div class="card">
      <h2>Dịch</h2>
      <label for="model">Mô hình</label>
      <select id="model">${MODELS.map((m) => `<option value="${m.id}" ${m.id === s.model ? 'selected' : ''}>${esc(m.name)} — ${m.id}</option>`).join('')}</select>
      <label for="effort">Mức suy luận (effort)</label>
      <select id="effort">${(['low', 'medium', 'high'] as const).map((e) => `<option value="${e}" ${e === s.effort ? 'selected' : ''}>${{ low: 'Thấp (nhanh, rẻ)', medium: 'Trung bình (mặc định)', high: 'Cao (chậm, đắt)' }[e]}</option>`).join('')}</select>
      <label for="conc">Số luồng song song (chế độ Nhanh): <span id="concv">${s.concurrency}</span></label>
      <input id="conc" type="range" min="1" max="8" value="${s.concurrency}" />
      <div class="field-note">Nếu gặp lỗi 429 (giới hạn tốc độ), hãy giảm số luồng.</div>
      <label for="chunk">Số trang mỗi đoạn: <span id="chunkv">${s.chunkSize}</span></label>
      <input id="chunk" type="range" min="1" max="10" value="${s.chunkSize}" />
      <div class="field-note">Áp dụng cho tài liệu nhập sau này. Mỗi đoạn được gửi cho Claude dưới dạng một tệp PDF nhỏ.</div>
      <label class="inline" style="margin-top:12px"><input id="keep" type="checkbox" ${s.keepEnglishTerms ? 'checked' : ''}/> Ghi thuật ngữ tiếng Anh trong ngoặc ở lần xuất hiện đầu</label>
    </div>
    <div class="card">
      <h2>Bảng thuật ngữ</h2>
      <div class="field-note" style="margin:0 0 8px">Mỗi dòng: <code>English = Tiếng Việt</code> (hoặc phím Tab). Dòng bắt đầu bằng # là chú thích. Bảng này được ưu tiên tuyệt đối khi dịch. <span id="gcount"></span></div>
      <textarea id="glossary" rows="14" spellcheck="false">${esc(s.glossary)}</textarea>
      <div class="row" style="margin-top:8px"><button id="restore" type="button">Khôi phục mặc định</button></div>
    </div>
    <div class="row"><button class="primary" id="save">Lưu cài đặt</button><span id="saved" class="muted"></span></div>`;
  const key = $<HTMLInputElement>('#key', root)!;
  $('#show', root)!.addEventListener('click', (e) => {
    key.type = key.type === 'password' ? 'text' : 'password';
    (e.target as HTMLButtonElement).textContent = key.type === 'password' ? 'Hiện' : 'Ẩn';
  });
  const conc = $<HTMLInputElement>('#conc', root)!;
  conc.addEventListener('input', () => ($('#concv', root)!.textContent = conc.value));
  const chunk = $<HTMLInputElement>('#chunk', root)!;
  chunk.addEventListener('input', () => ($('#chunkv', root)!.textContent = chunk.value));
  const gl = $<HTMLTextAreaElement>('#glossary', root)!;
  const count = () => ($('#gcount', root)!.textContent = `Hiện có ${parseGlossary(gl.value).length} thuật ngữ.`);
  gl.addEventListener('input', count);
  count();
  $('#restore', root)!.addEventListener('click', () => {
    if (confirm('Khôi phục bảng thuật ngữ mặc định? Các chỉnh sửa của bạn sẽ mất.')) {
      gl.value = DEFAULT_GLOSSARY_TEXT;
      count();
    }
  });
  $('#save', root)!.addEventListener('click', () => {
    saveSettings(
      sanitize({
        apiKey: key.value,
        model: $<HTMLSelectElement>('#model', root)!.value,
        effort: $<HTMLSelectElement>('#effort', root)!.value as 'low',
        concurrency: Number(conc.value),
        chunkSize: Number(chunk.value),
        keepEnglishTerms: $<HTMLInputElement>('#keep', root)!.checked,
        glossary: gl.value,
      }),
    );
    $('#saved', root)!.textContent = 'Đã lưu.';
  });
}
