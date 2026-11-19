export type ChunkStatus = 'pending' | 'running' | 'batched' | 'done' | 'failed';
export type Mode = 'realtime' | 'batch';
export type JobStatus = 'idle' | 'running' | 'paused' | 'done' | 'error';

export interface Usage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface BatchInfo {
  id: string;
  chunkIndexes: number[];
  status: 'in_progress' | 'canceling' | 'ended';
  createdAt: number;
  /** số yêu cầu thành công / lỗi khi đã kết thúc */
  succeeded?: number;
  failed?: number;
}

export interface Job {
  id: string;
  title: string;
  fileName: string;
  pages: number;
  chunkSize: number;
  createdAt: number;
  model: string;
  status: JobStatus;
  lastError?: string;
  batches: BatchInfo[];
}

export interface Chunk {
  jobId: string;
  index: number;
  startPage: number; // 1-based, bao gồm
  endPage: number;
  status: ChunkStatus;
  text: string;
  error?: string;
  usage?: Usage;
  mode?: Mode;
  model?: string;
  edited?: boolean;
  batchId?: string;
}

export interface PageRange {
  startPage: number;
  endPage: number;
}

export interface Settings {
  apiKey: string;
  model: string;
  effort: 'low' | 'medium' | 'high';
  concurrency: number;
  chunkSize: number;
  keepEnglishTerms: boolean;
  glossary: string;
}

export interface StoredImage {
  jobId: string;
  page: number;
  items: { blob: Blob; width: number; height: number }[];
}
