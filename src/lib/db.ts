import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Chunk, Job, StoredImage } from './types';

interface Schema extends DBSchema {
  jobs: { key: string; value: Job };
  pdfs: { key: string; value: Blob };
  chunks: { key: [string, number]; value: Chunk; indexes: { byJob: string } };
  images: { key: [string, number]; value: StoredImage };
}

let dbp: Promise<IDBPDatabase<Schema>> | null = null;

export function db() {
  if (!dbp) {
    dbp = openDB<Schema>('rhm-dich-pdf', 1, {
      upgrade(d) {
        d.createObjectStore('jobs', { keyPath: 'id' });
        d.createObjectStore('pdfs');
        const c = d.createObjectStore('chunks', { keyPath: ['jobId', 'index'] });
        c.createIndex('byJob', 'jobId');
        d.createObjectStore('images', { keyPath: ['jobId', 'page'] });
      },
    });
  }
  return dbp;
}

export async function listJobs(): Promise<Job[]> {
  const all = await (await db()).getAll('jobs');
  return all.sort((a, b) => b.createdAt - a.createdAt);
}
export async function getJob(id: string): Promise<Job | undefined> {
  return (await db()).get('jobs', id);
}
export async function putJob(job: Job): Promise<void> {
  await (await db()).put('jobs', job);
}
export async function createJob(job: Job, pdf: Blob, chunks: Chunk[]): Promise<void> {
  const d = await db();
  const tx = d.transaction(['jobs', 'pdfs', 'chunks'], 'readwrite');
  tx.objectStore('jobs').put(job);
  tx.objectStore('pdfs').put(pdf, job.id);
  for (const c of chunks) tx.objectStore('chunks').put(c);
  await tx.done;
}
export async function getPdf(jobId: string): Promise<Blob | undefined> {
  return (await db()).get('pdfs', jobId);
}
export async function getChunks(jobId: string): Promise<Chunk[]> {
  const all = await (await db()).getAllFromIndex('chunks', 'byJob', jobId);
  return all.sort((a, b) => a.index - b.index);
}
export async function getChunk(jobId: string, index: number): Promise<Chunk | undefined> {
  return (await db()).get('chunks', [jobId, index]);
}
export async function putChunk(chunk: Chunk): Promise<void> {
  await (await db()).put('chunks', chunk);
}
export async function getImages(jobId: string, page: number): Promise<StoredImage | undefined> {
  return (await db()).get('images', [jobId, page]);
}
export async function putImages(img: StoredImage): Promise<void> {
  await (await db()).put('images', img);
}
export async function deleteJob(jobId: string): Promise<void> {
  const d = await db();
  const tx = d.transaction(['jobs', 'pdfs', 'chunks', 'images'], 'readwrite');
  tx.objectStore('jobs').delete(jobId);
  tx.objectStore('pdfs').delete(jobId);
  const cs = tx.objectStore('chunks');
  for (const c of await cs.index('byJob').getAllKeys(jobId)) cs.delete(c);
  const is = tx.objectStore('images');
  for (const k of await is.getAllKeys(IDBKeyRange.bound([jobId, 0], [jobId, Infinity]))) is.delete(k);
  await tx.done;
}
