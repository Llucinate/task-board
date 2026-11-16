import { collection, clean, uid, readBody, send, fail, HttpError, persistent } from './_lib/store.js';
import categoryHandler from './_lib/categories.js';

const notes = collection('notes');
const categories = collection('categories');
const COLORS = ['yellow', 'pink', 'blue', 'green', 'orange'];
const has = (object, key) => Object.hasOwn(object, key);
const required = (value, max, message) => {
  const result = clean(value, max);
  if (!result) throw new HttpError(400, message);
  return result;
};
async function categoryId(value) {
  const id = clean(value, 80);
  if (id && !(await categories.get(id))) throw new HttpError(400, 'Категория не найдена. Обновите доску');
  return id;
}

export default async function handler(req, res) {
  if (req.query?.resource === 'categories') return categoryHandler(req, res);
  try {
    if (req.method === 'GET') {
      const list = await notes.all();
      list.sort((a, b) => b.created - a.created);
      return send(res, 200, { notes: list.map(note => ({ categoryId: '', subtasks: [], ...note })), persistent });
    }
    if (!['POST', 'PATCH', 'DELETE'].includes(req.method)) {
      res.setHeader('Allow', 'GET, POST, PATCH, DELETE');
      return send(res, 405, { error: 'Метод не поддерживается' });
    }
    const body = await readBody(req);
    if (req.method === 'POST') {
      const title = required(body.title, 80, 'Напишите название задачи');
      if ((await notes.all()).length >= 300) throw new HttpError(400, 'На доске уже 300 задач. Снимите ненужные');
      const note = {
        id: uid(), title, desc: clean(body.desc, 2000), author: clean(body.author, 30),
        color: COLORS.includes(body.color) ? body.color : 'yellow',
        categoryId: await categoryId(body.categoryId), created: Date.now(), takenBy: '', subtasks: [],
      };
      await notes.put(note);
      return send(res, 201, { note });
    }
    const id = required(body.id, 80, 'Задача не указана');
    const note = await notes.get(id);
    if (!note) throw new HttpError(404, 'Задачу уже сняли с доски');
    if (req.method === 'DELETE') {
      await notes.remove(id);
      return send(res, 200, { ok: true });
    }
    const version = note.version || 0;
    if (has(body, 'expectedVersion') && body.expectedVersion !== version) {
      throw new HttpError(409, 'Задача уже изменилась у другого участника. Закройте редактор и откройте задачу заново');
    }
    note.subtasks ||= [];
    note.categoryId ||= '';
    if (body.action) {
      if (body.action === 'addSubtask') {
        if (note.subtasks.length >= 50) throw new HttpError(400, 'В задаче уже 50 подзадач');
        note.subtasks.push({ id: uid(), title: required(body.title, 160, 'Напишите подзадачу'), done: false });
      } else if (['toggleSubtask', 'editSubtask', 'removeSubtask'].includes(body.action)) {
        const subtask = note.subtasks.find(item => item.id === body.subtaskId);
        if (!subtask) throw new HttpError(404, 'Подзадачу уже удалили. Обновите задачу');
        if (body.action === 'toggleSubtask') {
          if (typeof body.done !== 'boolean') throw new HttpError(400, 'Неверный статус подзадачи');
          subtask.done = body.done;
        }
        if (body.action === 'editSubtask') subtask.title = required(body.title, 160, 'Напишите подзадачу');
        if (body.action === 'removeSubtask') note.subtasks = note.subtasks.filter(item => item.id !== body.subtaskId);
      } else throw new HttpError(400, 'Неизвестное действие');
    } else {
      if (has(body, 'title')) note.title = required(body.title, 80, 'Напишите название задачи');
      if (has(body, 'desc')) note.desc = clean(body.desc, 2000);
      if (has(body, 'author')) note.author = clean(body.author, 30);
      if (has(body, 'takenBy')) note.takenBy = clean(body.takenBy, 30);
      if (has(body, 'categoryId')) note.categoryId = await categoryId(body.categoryId);
      if (has(body, 'color')) {
        if (!COLORS.includes(body.color)) throw new HttpError(400, 'Выберите цвет стикера');
        note.color = body.color;
      }
    }
    note.updated = Date.now();
    if (!(await notes.replace(note, version))) throw new HttpError(409, 'Задача изменилась. Повторите действие');
    return send(res, 200, { note });
  } catch (error) { return fail(res, error); }
}
