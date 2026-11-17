import { HttpError } from './http.js';
const pathname = 'planner/state-v2.json';
export const emptyState = () => ({ revision: 0, users: [], sessions: [], invitations: [], categories: [], notes: [], attempts: {} });
let fileQueue = Promise.resolve();
async function blobSnapshot() {
  if (!process.env.BLOB_READ_WRITE_TOKEN) throw new HttpError(503, 'Постоянное хранилище не подключено. Создание задач временно недоступно');
  const { get } = await import('@vercel/blob');
  const result = await get(pathname, { access: 'private', useCache: false, token: process.env.BLOB_READ_WRITE_TOKEN });
  if (!result) return { data: emptyState(), etag: null };
  // Private download transport can mark the same storage ETag as weak.
  // Blob conditional PUT expects the strong storage tag, including quotes.
  return { data: await new Response(result.stream).json(), etag: result.blob.etag.replace(/^W\//, '') };
}
export async function transact(action) {
  if (process.env.TASK_BOARD_DATA_FILE && !process.env.VERCEL && process.env.NODE_ENV !== 'production') {
    const previous = fileQueue; let release; fileQueue = new Promise(resolve => { release = resolve; }); await previous;
    try {
      const fs = await import('node:fs/promises'); const file = process.env.TASK_BOARD_DATA_FILE;
      let data; try { data = JSON.parse(await fs.readFile(file, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; data = emptyState(); }
      const before = JSON.stringify(data); const result = await action(data);
      if (JSON.stringify(data) !== before) { data.revision++; await fs.writeFile(file + '.tmp', JSON.stringify(data)); await fs.rename(file + '.tmp', file); }
      return result;
    } finally { release(); }
  }
  for (let attempt = 0; attempt < 5; attempt++) {
    const { data, etag } = await blobSnapshot(); const before = JSON.stringify(data);
    const result = await action(data);
    if (JSON.stringify(data) === before) return result;
    data.revision++;
    const { put, BlobPreconditionFailedError } = await import('@vercel/blob');
    try {
      await put(pathname, JSON.stringify(data), { access: 'private', token: process.env.BLOB_READ_WRITE_TOKEN, addRandomSuffix: false, contentType: 'application/json', cacheControlMaxAge: 0, ...(etag ? { allowOverwrite: true, ifMatch: etag } : { allowOverwrite: false }) });
      return result;
    } catch (error) {
      if (!(error instanceof BlobPreconditionFailedError) && !(!etag && /already exists/i.test(error.message))) throw error;
    }
  }
  throw new HttpError(409, 'Данные изменились у другого участника. Повторите действие');
}
