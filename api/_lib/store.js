import { Redis } from '@upstash/redis';
import { randomUUID } from 'node:crypto';

const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const redis = url && token ? new Redis({ url, token }) : null;
const memory = { notes: new Map(), categories: new Map() };
const decode = value => typeof value === 'string' ? JSON.parse(value) : value;

export const persistent = Boolean(redis);
export const uid = () => randomUUID();
export const clean = (value, max) => String(value ?? '').trim().slice(0, max);
export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export function collection(name) {
  const key = `board:${name}`;
  return {
    async all() {
      const values = redis ? Object.values(await redis.hgetall(key) || {}) : [...memory[name].values()];
      return values.map(value => structuredClone(decode(value)));
    },
    async get(id) {
      const value = redis ? await redis.hget(key, id) : memory[name].get(id);
      return value ? structuredClone(decode(value)) : null;
    },
    async put(value) {
      if (redis) await redis.hset(key, { [value.id]: JSON.stringify(value) });
      else memory[name].set(value.id, structuredClone(value));
    },
    async replace(value, expectedVersion) {
      value.version = expectedVersion + 1;
      if (redis) {
        const result = await redis.eval(`
          local raw = redis.call('HGET', KEYS[1], ARGV[1])
          if not raw then return 0 end
          local current = cjson.decode(raw)
          if (current.version or 0) ~= tonumber(ARGV[2]) then return 0 end
          redis.call('HSET', KEYS[1], ARGV[1], ARGV[3])
          return 1
        `, [key], [value.id, expectedVersion, JSON.stringify(value)]);
        return result === 1;
      }
      const current = memory[name].get(value.id);
      if (!current || (current.version || 0) !== expectedVersion) return false;
      memory[name].set(value.id, structuredClone(value));
      return true;
    },
    async remove(id) {
      if (redis) return redis.hdel(key, id);
      return memory[name].delete(id);
    },
  };
}
export async function readBody(req) {
  let body = req.body;
  if (body === undefined) {
    let data = '';
    for await (const chunk of req) {
      data += chunk;
      if (Buffer.byteLength(data) > 32768) throw new HttpError(413, 'Слишком много данных');
    }
    body = data || '{}';
  }
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { throw new HttpError(400, 'Не удалось прочитать данные'); }
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'Неверный формат данных');
  return body;
}
export function send(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}
export function fail(res, error) {
  if (!error.status) console.error(error);
  return send(res, error.status || 500, { error: error.status ? error.message : 'Ошибка сервера. Попробуйте ещё раз' });
}
