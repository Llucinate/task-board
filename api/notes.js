import { transact } from './_lib/database.js';
import auth, { invite } from './_lib/auth.js';
import { HttpError, actor, publicUser, canSee, categoryFor, uid, clean, requireText, readBody, send, fail, sameOrigin } from './_lib/http.js';
const COLORS = ['yellow', 'pink', 'blue', 'green', 'orange'];
export default async function handler(req, res) {
  try {
    if (!['GET','POST','PATCH','DELETE'].includes(req.method)) throw new HttpError(405, 'Метод не поддерживается');
    sameOrigin(req);
    const body = req.method === 'GET' ? {} : await readBody(req);
    const resource = req.query?.resource || '';
    if (resource === 'auth') return send(res, 200, await auth(req, res, body));
    if (resource === 'invite') {
      if (req.method !== 'POST') throw new HttpError(405, 'Метод не поддерживается');
      return send(res, 201, await invite(req));
    }
    const result = await transact(db => {
      const user = actor(db, req);
      if (req.method === 'GET') {
        const categories = db.categories.filter(x => canSee(x, user)); const ids = new Set(categories.map(x => x.id));
        return { me: publicUser(user), categories, notes: db.notes.filter(x => ids.has(x.categoryId)).sort((a,b) => b.created - a.created), users: db.users.map(publicUser), revision: db.revision, persistent: true };
      }
      if (resource === 'categories') {
        if (req.method === 'POST') {
          const name = requireText(body.name, 40, 'Напишите название категории').replace(/\s+/g, ' ');
          if (!['private','shared'].includes(body.scope)) throw new HttpError(400, 'Выберите тип категории');
          if (db.categories.filter(x => canSee(x,user)).length >= 100) throw new HttpError(400, 'Создано слишком много категорий');
          if (db.categories.some(x => x.scope === body.scope && (x.scope === 'shared' || x.ownerId === user.id) && x.name.toLowerCase() === name.toLowerCase())) throw new HttpError(409, 'Такая категория уже есть');
          const category = { id: uid(), name, scope: body.scope, ownerId: user.id, created: Date.now() }; db.categories.push(category); return { category };
        }
        const category = categoryFor(db, body.id, user);
        if (req.method === 'PATCH') { category.name = requireText(body.name, 40, 'Напишите название категории'); return { category }; }
        if (req.method === 'DELETE') {
          if (db.notes.some(x => x.categoryId === category.id)) throw new HttpError(400, 'Сначала перенесите или удалите задачи категории');
          db.categories = db.categories.filter(x => x.id !== category.id); return { ok: true };
        }
      }
      if (req.method === 'POST') {
        categoryFor(db, body.categoryId, user);
        if (db.notes.length >= 5000) throw new HttpError(400, 'Достигнут лимит тестовой версии');
        const note = { id: uid(), title: requireText(body.title,160,'Напишите название задачи'), desc: clean(body.desc,5000), categoryId: body.categoryId, createdBy: user.id, author: user.name, assigneeId: '', takenBy: '', color: COLORS.includes(body.color) ? body.color : 'yellow', done: false, subtasks: [], created: Date.now(), version: 0 };
        db.notes.push(note); return { note };
      }
      const note = db.notes.find(x => x.id === body.id);
      if (!note) throw new HttpError(404, 'Задача не найдена');
      const source = categoryFor(db, note.categoryId, user);
      if (req.method === 'DELETE') { db.notes = db.notes.filter(x => x.id !== note.id); return { ok: true }; }
      if (body.expectedVersion !== undefined && body.expectedVersion !== note.version) throw new HttpError(409, 'Задача изменилась у другого участника. Закройте и откройте её заново');
      if (body.action === 'addSubtask') {
        if (note.subtasks.length >= 100) throw new HttpError(400, 'В задаче уже 100 подзадач');
        note.subtasks.push({ id: uid(), title: requireText(body.title,160,'Напишите подзадачу'), done: false });
      } else if (['toggleSubtask','editSubtask','removeSubtask'].includes(body.action)) {
        const step = note.subtasks.find(x => x.id === body.subtaskId); if (!step) throw new HttpError(404,'Подзадача не найдена');
        if (body.action === 'toggleSubtask') { if (typeof body.done !== 'boolean') throw new HttpError(400,'Неверный статус'); step.done = body.done; }
        if (body.action === 'editSubtask') step.title = requireText(body.title,160,'Напишите подзадачу');
        if (body.action === 'removeSubtask') note.subtasks = note.subtasks.filter(x => x.id !== step.id);
      } else {
        if (body.action) throw new HttpError(400,'Неизвестное действие');
        if (Object.hasOwn(body,'title')) note.title = requireText(body.title,160,'Напишите название задачи');
        if (Object.hasOwn(body,'desc')) note.desc = clean(body.desc,5000);
        if (Object.hasOwn(body,'categoryId')) {
          const target = categoryFor(db,body.categoryId,user);
          if (source.scope !== target.scope || (source.scope === 'private' && source.ownerId !== target.ownerId)) throw new HttpError(400,'Перенос между личной и общей категорией отключён, чтобы не раскрыть личные задачи');
          note.categoryId = target.id;
        }
        if (Object.hasOwn(body,'done')) { if (typeof body.done !== 'boolean') throw new HttpError(400,'Неверный статус'); note.done = body.done; note.completedAt = body.done ? Date.now() : null; }
        if (Object.hasOwn(body,'assigneeId')) {
          const person = body.assigneeId && db.users.find(x => x.id === body.assigneeId);
          if (body.assigneeId && !person) throw new HttpError(400,'Участник не найден');
          if (source.scope === 'private' && person && person.id !== user.id) throw new HttpError(400,'Личную задачу можно назначить только себе');
          note.assigneeId = person?.id || ''; note.takenBy = person?.name || '';
        }
      }
      note.version++; note.updated = Date.now(); return { note };
    });
    send(res, req.method === 'POST' ? 201 : 200, result);
  } catch (error) { fail(res,error); }
}
