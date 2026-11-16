import { test } from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/notes.js';
import { collection } from '../api/_lib/store.js';

async function call(method, body, resource) {
  const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(value) { this.data = JSON.parse(value); } };
  await handler({ method, body, query: resource ? { resource } : {} }, res);
  return { status: res.statusCode, ...res.data };
}

test('Полный сценарий доски и совместимость старых заметок', async t => {
  let category, note, step;
  await t.test('Создание и фильтруемые данные категорий, запрет дублей', async () => {
    const created = await call('POST', { name: '  Работа  ' }, 'categories');
    assert.equal(created.status, 201); category = created.category;
    assert.equal(category.name, 'Работа');
    assert.equal((await call('POST', { name: 'работа' }, 'categories')).status, 409);
    assert.equal((await call('POST', { name: ' ' }, 'categories')).status, 400);
    assert.ok((await call('GET', null, 'categories')).categories.some(item => item.id === category.id));
  });
  await t.test('Новая заметка получает автора профиля и категорию', async () => {
    const created = await call('POST', { title: 'Цель', author: 'Артём', desc: 'Подробности', color: 'green', categoryId: category.id });
    assert.equal(created.status, 201); note = created.note;
    assert.equal(note.author, 'Артём'); assert.equal(note.categoryId, category.id); assert.deepEqual(note.subtasks, []);
  });
  await t.test('Назначение и редактирование не сбрасывают исполнителя или автора', async () => {
    assert.equal((await call('PATCH', { id: note.id, takenBy: 'Артём' })).status, 200);
    const changed = await call('PATCH', { id: note.id, title: 'Новая цель', desc: 'Новые детали', color: 'blue' });
    assert.equal(changed.status, 200); assert.equal(changed.note.title, 'Новая цель'); assert.equal(changed.note.takenBy, 'Артём'); assert.equal(changed.note.author, 'Артём');
    assert.equal(changed.note.categoryId, category.id);
  });
  await t.test('Создание, выполнение, изменение и удаление подзадачи', async () => {
    const added = await call('PATCH', { id: note.id, action: 'addSubtask', title: 'Первый шаг' });
    assert.equal(added.status, 200); step = added.note.subtasks[0];
    const completed = await call('PATCH', { id: note.id, action: 'toggleSubtask', subtaskId: step.id, done: true });
    assert.equal(completed.note.subtasks[0].done, true);
    const edited = await call('PATCH', { id: note.id, action: 'editSubtask', subtaskId: step.id, title: 'Уточнённый шаг' });
    assert.equal(edited.note.subtasks[0].title, 'Уточнённый шаг'); assert.equal(edited.note.subtasks[0].done, true);
    const removed = await call('PATCH', { id: note.id, action: 'removeSubtask', subtaskId: step.id });
    assert.deepEqual(removed.note.subtasks, []);
  });
  await t.test('Неверная правка не меняет сохранённую заметку', async () => {
    const before = await collection('notes').get(note.id);
    assert.equal((await call('PATCH', { id: note.id, title: 'Перезапись', color: 'invalid' })).status, 400);
    assert.deepEqual(await collection('notes').get(note.id), before);
    assert.equal((await call('PATCH', { id: note.id, title: ' ' })).status, 400);
    assert.equal((await call('PATCH', { id: note.id, categoryId: 'missing' })).status, 400);
    assert.equal((await call('PATCH', { id: note.id, action: 'addSubtask', title: ' ' })).status, 400);
    assert.equal((await call('PATCH', { id: note.id, action: 'toggleSubtask', subtaskId: 'missing', done: true })).status, 404);
  });
  await t.test('Смена и снятие категории', async () => {
    const second = (await call('POST', { name: 'Личное' }, 'categories')).category;
    assert.equal((await call('PATCH', { id: note.id, categoryId: second.id })).note.categoryId, second.id);
    assert.equal((await call('PATCH', { id: note.id, categoryId: '' })).note.categoryId, '');
  });
  await t.test('Старая заметка без категории и списка подзадач доступна для правки', async () => {
    await collection('notes').put({ id: 'legacy', title: 'Из архива', created: 1, takenBy: 'Старый исполнитель', color: 'yellow' });
    const old = (await call('GET')).notes.find(item => item.id === 'legacy');
    assert.deepEqual(old.subtasks, []); assert.equal(old.categoryId, '');
    const result = await call('PATCH', { id: 'legacy', desc: 'Дополнено' });
    assert.equal(result.status, 200); assert.equal(result.note.takenBy, 'Старый исполнитель');
  });
  await t.test('Устаревший редактор получает конфликт и не затирает изменения', async () => {
    const current = await collection('notes').get(note.id);
    await call('PATCH', { id: note.id, takenBy: 'Другой участник' });
    const result = await call('PATCH', { id: note.id, expectedVersion: current.version, title: 'Устаревшая правка' });
    assert.equal(result.status, 409); assert.notEqual((await collection('notes').get(note.id)).title, 'Устаревшая правка');
  });
  await t.test('Параллельные изменения обнаруживают конфликт вместо потери подзадачи', async () => {
    const results = await Promise.all(['А', 'Б'].map(title => call('PATCH', { id: note.id, action: 'addSubtask', title })));
    assert.deepEqual(results.map(item => item.status).sort(), [200, 409]);
    assert.equal((await collection('notes').get(note.id)).subtasks.length, 1);
  });
  await t.test('Ошибочные данные и неподдерживаемые методы', async () => {
    assert.equal((await call('POST', '{bad')).status, 400);
    assert.equal((await call('POST', [])).status, 400);
    assert.equal((await call('PUT', {})).status, 405);
    assert.equal((await call('PATCH', { id: 'missing' })).status, 404);
    assert.equal((await call('POST', { title: 'Без настоящей категории', categoryId: 'missing' })).status, 400);
  });
  await t.test('Удаление задачи удаляет и её подзадачи', async () => {
    assert.equal((await call('DELETE', { id: note.id })).status, 200);
    assert.ok(!(await call('GET')).notes.some(item => item.id === note.id));
  });
});
