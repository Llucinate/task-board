import { randomBytes, randomUUID, createHash, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
const scrypt = promisify(scryptCallback);
export const uid = () => randomUUID();
export const secret = () => randomBytes(32).toString('base64url');
export const hash = value => createHash('sha256').update(value).digest('hex');
export class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
export const clean = (value, max) => typeof value === 'string' ? value.trim().slice(0, max) : '';
export const requireText = (value, max, message) => { const text = clean(value, max); if (!text) throw new HttpError(400, message); return text; };
export async function passwordHash(password, salt = randomBytes(16).toString('hex')) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 128) throw new HttpError(400, 'Пароль должен содержать от 12 до 128 символов');
  const key = await scrypt(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return `${salt}:${key.toString('hex')}`;
}
export async function checkPassword(password, stored) {
  if (typeof password !== 'string' || password.length > 128) return false;
  const [salt, expected] = stored.split(':');
  const key = await scrypt(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return timingSafeEqual(key, Buffer.from(expected, 'hex'));
}
export async function readBody(req) {
  let body = req.body;
  if (body === undefined) { let data = ''; for await (const chunk of req) { data += chunk; if (Buffer.byteLength(data) > 32768) throw new HttpError(413, 'Слишком много данных'); } body = data || '{}'; }
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { throw new HttpError(400, 'Не удалось прочитать данные'); } }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'Неверный формат данных');
  return body;
}
export function send(res, status, data) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(JSON.stringify(data));
}
export function fail(res, error) { if (!error.status) console.error(error.name, error.message); send(res, error.status || 503, { error: error.status ? error.message : 'Хранилище временно недоступно. Изменения не сохранены, попробуйте ещё раз' }); }
export function sameOrigin(req) {
  if (['GET', 'HEAD'].includes(req.method)) return;
  let origin; try { origin = new URL(req.headers.origin); } catch { throw new HttpError(403, 'Обновите страницу и повторите действие'); }
  if (origin.host !== req.headers.host) throw new HttpError(403, 'Запрос с другого сайта отклонён');
}
export function sessionToken(req) { const cookie = req.headers.cookie || ''; return cookie.split(';').map(x => x.trim()).find(x => x.startsWith('task_session='))?.slice(13) || ''; }
export function cookie(res, token, req) { res.setHeader('Set-Cookie', `task_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${token ? 2592000 : 0}${process.env.VERCEL || process.env.NODE_ENV === 'production' ? '; Secure' : ''}`); }
export function actor(db, req) { const token = sessionToken(req); const session = token && db.sessions.find(x => x.hash === hash(token) && x.expires > Date.now()); const user = session && db.users.find(x => x.id === session.userId); if (!user) throw new HttpError(401, 'Войдите в свой аккаунт'); return user; }
export const publicUser = user => ({ id: user.id, name: user.name, username: user.username, role: user.role });
export const canSee = (category, user) => category && (category.scope === 'shared' || category.ownerId === user.id);
export function categoryFor(db, id, user) { const category = db.categories.find(x => x.id === id); if (!canSee(category, user)) throw new HttpError(404, 'Категория не найдена'); return category; }
