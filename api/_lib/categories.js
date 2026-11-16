import { collection, clean, uid, readBody, send, fail, HttpError } from './store.js';
const categories = collection('categories');

export default async function handler(req, res) {
  try {
    const list = await categories.all();
    if (req.method === 'GET') return send(res, 200, { categories: list.sort((a, b) => a.created - b.created) });
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST');
      return send(res, 405, { error: 'Метод не поддерживается' });
    }
    const body = await readBody(req);
    const name = clean(body.name, 40).replace(/\s+/g, ' ');
    if (!name) throw new HttpError(400, 'Напишите название категории');
    if (list.some(item => item.name.toLocaleLowerCase('ru') === name.toLocaleLowerCase('ru'))) {
      throw new HttpError(409, 'Такая категория уже есть');
    }
    if (list.length >= 50) throw new HttpError(400, 'Уже создано 50 категорий');
    const category = { id: uid(), name, created: Date.now() };
    await categories.put(category);
    return send(res, 201, { category });
  } catch (error) { return fail(res, error); }
}
