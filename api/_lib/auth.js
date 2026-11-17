import { transact } from './database.js';
import { HttpError, actor, publicUser, hash, secret, uid, clean, requireText, passwordHash, checkPassword, cookie, sessionToken } from './http.js';
export default async function auth(req, res, body) {
  if (req.method === 'GET') return transact(db => { let me = null; try { me = publicUser(actor(db, req)); } catch {} return { me, needsSetup: !db.users.length }; });
  if (req.method !== 'POST') throw new HttpError(405, 'Метод не поддерживается');
  if (body.action === 'logout') { await transact(db => { db.sessions = db.sessions.filter(x => x.hash !== hash(sessionToken(req))); }); cookie(res, '', req); return { ok: true }; }
  if (body.action === 'profile') return transact(db => { const user = actor(db, req); user.name = requireText(body.name, 40, 'Укажите имя'); return { me: publicUser(user) }; });
  if (!['login', 'register'].includes(body.action)) throw new HttpError(400, 'Неизвестное действие');
  const ip = hash(req.headers['x-forwarded-for']?.split(',')[0] || req.socket?.remoteAddress || 'unknown');
  await transact(db => {
    const now = Date.now();
    for (const [key, value] of Object.entries(db.attempts)) if (value.until < now) delete db.attempts[key];
    const counter = db.attempts[ip] ||= { count: 0, until: now + 10 * 60 * 1000 };
    if (counter.count >= 15) throw new HttpError(429, 'Слишком много попыток. Попробуйте через 10 минут'); counter.count++;
  });
  const username = clean(body.username, 32).toLowerCase();
  if (!/^[a-z0-9_.-]{3,32}$/.test(username)) throw new HttpError(400, 'Логин: от 3 до 32 латинских букв, цифр, точек, дефисов или подчёркиваний');
  let userId;
  if (body.action === 'login') {
    const user = await transact(db => db.users.find(x => x.username === username));
    const stored = user?.password || '00000000000000000000000000000000:' + '00'.repeat(64);
    if (!(await checkPassword(body.password, stored)) || !user) throw new HttpError(401, 'Неверный логин или пароль');
    userId = user.id;
  } else {
    const password = await passwordHash(body.password);
    const name = requireText(body.name, 40, 'Укажите имя');
    userId = await transact(db => {
      const first = !db.users.length;
      if (first) {
        if (!process.env.TASK_BOARD_SETUP_TOKEN || hash(String(body.invite || '')) !== hash(process.env.TASK_BOARD_SETUP_TOKEN)) throw new HttpError(403, 'Для первого входа нужна ссылка владельца');
      } else {
        const invite = db.invitations.find(x => x.hash === hash(String(body.invite || '')) && x.expires > Date.now() && !x.used);
        if (!invite) throw new HttpError(403, 'Приглашение недействительно или уже использовано');
        invite.used = true;
      }
      if (db.users.some(x => x.username === username)) throw new HttpError(409, 'Этот логин уже занят');
      if (db.users.length >= 20) throw new HttpError(400, 'Достигнут лимит участников тестовой версии');
      const user = { id: uid(), username, name, password, role: first ? 'owner' : 'member' }; db.users.push(user);
      if (first) db.categories.push({ id: uid(), name: 'Общее', scope: 'shared', ownerId: user.id, created: Date.now() });
      db.categories.push({ id: uid(), name: 'Личное', scope: 'private', ownerId: user.id, created: Date.now() });
      return user.id;
    });
  }
  const token = secret();
  const me = await transact(db => {
    db.sessions = db.sessions.filter(x => x.expires > Date.now());
    db.sessions.push({ hash: hash(token), userId, expires: Date.now() + 30 * 86400000 });
    delete db.attempts[ip]; return publicUser(db.users.find(x => x.id === userId));
  });
  cookie(res, token, req); return { me };
}
export async function invite(req) {
  const token = secret();
  await transact(db => {
    const user = actor(db, req); if (user.role !== 'owner') throw new HttpError(403, 'Приглашать участников может владелец');
    db.invitations = db.invitations.filter(x => x.expires > Date.now() && !x.used);
    if (db.invitations.length >= 10) throw new HttpError(400, 'Уже есть 10 активных приглашений');
    db.invitations.push({ hash: hash(token), expires: Date.now() + 7 * 86400000, createdBy: user.id });
  });
  return { token };
}
