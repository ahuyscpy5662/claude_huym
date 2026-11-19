import { PDFDocument } from 'pdf-lib';
import { bytesToBase64 } from './bytes';

/** Giữ một PDFDocument nguồn và cắt từng khoảng trang theo yêu cầu (không giữ base64 trong bộ nhớ). */
export class PdfSplitter {
  private constructor(private src: PDFDocument) {}

  static async fromBlob(blob: Blob): Promise<PdfSplitter> {
    const buf = await blob.arrayBuffer();
    const doc = await PDFDocument.load(buf, { ignoreEncryption: true, updateMetadata: false });
    return new PdfSplitter(doc);
  }

  get pageCount(): number {
    return this.src.getPageCount();
  }

  /** Trả về PDF con (byte) gồm các trang start..end (1-based, bao gồm). */
  async slice(startPage: number, endPage: number): Promise<Uint8Array> {
    const out = await PDFDocument.create();
    const idx: number[] = [];
    for (let p = startPage; p <= endPage; p++) idx.push(p - 1);
    const pages = await out.copyPages(this.src, idx);
    pages.forEach((p) => out.addPage(p));
    return out.save({ useObjectStreams: true });
  }

  async sliceBase64(startPage: number, endPage: number): Promise<{ data: string; bytes: number }> {
    const u8 = await this.slice(startPage, endPage);
    return { data: bytesToBase64(u8), bytes: u8.length };
  }
}
