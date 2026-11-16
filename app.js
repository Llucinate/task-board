(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const colors = { yellow: 'Жёлтый', pink: 'Розовый', blue: 'Голубой', green: 'Зелёный', orange: 'Оранжевый' };
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const state = { notes: [], categories: [], filter: 'all', category: 'all', active: null, editing: null, busy: false, loaded: false, revision: 0, profile: '', pending: null, loading: false };
  try { state.profile = localStorage.getItem('board-profile-name') || localStorage.getItem('board-name') || ''; } catch {}
  state.profile = state.profile.trim().slice(0, 30);
  let toastTimer;
  function toast(message) {
    $('toast').textContent = message; $('toast').hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('toast').hidden = true; }, 3500);
  }
  async function request(method, body, resource = '') {
    const response = await fetch('/api/notes' + (resource ? '?resource=' + resource : ''), {
      method, headers: { 'Content-Type': 'application/json' }, cache: 'no-store',
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Не удалось сохранить. Попробуйте ещё раз');
    return data;
  }
  function setBusy(value) {
    state.busy = value;
    document.querySelectorAll('[data-mutate],[data-close]').forEach(button => { button.disabled = value; });
    $('subtaskList').querySelectorAll('input,button').forEach(input => { input.disabled = value; });
  }
  async function mutate(method, body, errorId, resource = '') {
    if (state.busy) return null;
    $(errorId).textContent = '';
    state.revision++; setBusy(true);
    try { return await request(method, body, resource); }
    catch (error) { $(errorId).textContent = error.message; return null; }
    finally { setBusy(false); }
  }
  function applyNote(note) {
    const index = state.notes.findIndex(item => item.id === note.id);
    if (index < 0) state.notes.unshift(note); else state.notes[index] = note;
    renderBoard();
    if ($('taskDialog').open && state.active === note.id) renderTask();
  }
  function categoryName(id) { return state.categories.find(item => item.id === id)?.name || 'Без категории'; }
  function renderCategoryOptions() {
    const selected = $('noteCategory').value;
    const options = state.categories.map(item => `<option value="${esc(item.id)}">${esc(item.name)}</option>`).join('');
    $('categoryFilter').innerHTML = '<option value="all">Все категории</option><option value="none">Без категории</option>' + options;
    $('categoryFilter').value = state.category;
    $('noteCategory').innerHTML = '<option value="">Без категории</option>' + options;
    $('noteCategory').value = selected;
  }
  function renderBoard() {
    const free = state.notes.filter(note => !note.takenBy).length;
    $('count').textContent = state.notes.length ? `Задач: ${state.notes.length} · свободных: ${free}` : 'Доска пока пустая';
    $('filters').innerHTML = [['all', 'Все'], ['free', 'Свободные'], ['taken', 'В работе']].map(([id, label]) => `<button class="chip${state.filter === id ? ' on' : ''}" data-filter="${id}" aria-pressed="${state.filter === id}">${label}</button>`).join('');
    const list = state.notes.filter(note => (state.filter === 'all' || (state.filter === 'free' ? !note.takenBy : Boolean(note.takenBy))) && (state.category === 'all' || (state.category === 'none' ? !note.categoryId : note.categoryId === state.category)));
    const focusedId = document.activeElement?.dataset?.note;
    $('board').innerHTML = list.length ? list.map(note => {
      const rotation = ([...note.id].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 5 - 2) * .55;
      const color = Object.hasOwn(colors, note.color) ? note.color : 'yellow';
      return `<button class="note c-${color}" data-note="${esc(note.id)}" aria-label="Открыть задачу: ${esc(note.title)}" style="transform:rotate(${rotation}deg)"><span class="note-title">${esc(note.title)}</span></button>`;
    }).join('') : `<div class="empty"><h2>${state.notes.length ? 'Здесь пока нет задач' : 'Начнём с одного стикера'}</h2><p>${state.notes.length ? 'Выберите другой фильтр или создайте задачу в этой категории.' : 'Повесьте задачу, а затем разбейте её на маленькие шаги.'}</p><button class="add-btn" data-add>+ Повесить задачу</button></div>`;
    if (focusedId) [...$('board').querySelectorAll('[data-note]')].find(item => item.dataset.note === focusedId)?.focus();
  }
  async function load() {
    if (state.loading || state.busy) return;
    state.loading = true;
    const revision = state.revision;
    try {
      const [data, cats] = await Promise.all([request('GET'), request('GET', null, 'categories')]);
      if (revision !== state.revision) return;
      const changed = JSON.stringify(data.notes) !== JSON.stringify(state.notes) || JSON.stringify(cats.categories) !== JSON.stringify(state.categories);
      state.notes = data.notes; state.categories = cats.categories;
      if (changed || !state.loaded) {
        renderCategoryOptions(); renderBoard();
        if ($('taskDialog').open) {
          if (!state.notes.some(note => note.id === state.active)) { $('taskDialog').close(); toast('Задачу сняли с доски'); }
          else if (!$('taskDialog').contains(document.activeElement) || !document.activeElement.matches('input,textarea,button.small-button')) {
            if (!$('subtaskTitle').value && !$('subtaskList').querySelector('.subtask-edit-form')) renderTask();
          }
        }
      }
      state.loaded = true;
      $('connection').classList.remove('error-state');
      $('connection').textContent = data.persistent ? 'Обновлено ' + new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : 'Доска работает без постоянного сохранения: задачи и категории могут теряться.';
    } catch {
      $('connection').classList.add('error-state');
      $('connection').textContent = 'Нет связи с доской. Повторяем подключение…';
      if (!state.loaded) { $('count').textContent = 'Не удалось загрузить задачи'; $('board').innerHTML = '<div class="empty"><h2>Доска недоступна</h2><button class="secondary" id="retryLoad">Повторить</button></div>'; }
    } finally { state.loading = false; }
  }
  function renderProfile() {
    $('profileLink').textContent = state.profile ? 'Мой профиль: ' + state.profile : 'Заполнить профиль';
    $('profileName').value = state.profile;
  }
  function route() {
    const settings = location.hash === '#settings';
    if (!settings) state.pending = null;
    $('boardView').hidden = settings; $('settingsView').hidden = !settings;
    $('boardTab').classList.toggle('active', !settings); $('settingsTab').classList.toggle('active', settings);
    if (settings) { $('settingsTab').setAttribute('aria-current', 'page'); $('boardTab').removeAttribute('aria-current'); }
    else { $('boardTab').setAttribute('aria-current', 'page'); $('settingsTab').removeAttribute('aria-current'); }
    if (settings) { document.querySelectorAll('dialog[open]').forEach(dialog => dialog.close()); renderProfile(); }
  }
  function requireProfile(action) {
    if (state.profile) { action(); return; }
    state.pending = action;
    location.hash = 'settings'; route();
    $('profileError').textContent = 'Укажите имя, чтобы подписать задачу. После сохранения продолжим.';
    $('profileName').focus();
  }
  function renderColors(selected) {
    $('colors').innerHTML = Object.entries(colors).map(([id, name]) => `<label class="color-option"><input type="radio" name="color" aria-label="${name}" value="${id}" ${selected === id ? 'checked' : ''}><span class="c-${id}" title="${name}" aria-hidden="true"></span><span class="sr-only">${name}</span></label>`).join('');
  }
  function showEditor(note = null) {
    state.editing = note?.id || null;
    state.editingVersion = note?.version || 0;
    $('editorHeading').textContent = note ? 'Редактировать задачу' : 'Новая задача';
    $('noteSave').textContent = note ? 'Сохранить изменения' : 'Повесить задачу';
    $('noteTitle').value = note?.title || ''; $('noteDesc').value = note?.desc || '';
    renderCategoryOptions();
    $('noteCategory').value = note?.categoryId || (state.category !== 'all' && state.category !== 'none' ? state.category : '');
    renderColors(note?.color || 'yellow');
    $('editorAuthor').textContent = note ? 'Автор: ' + (note.author || 'аноним') : 'Автор: ' + state.profile;
    $('editorCategoryFields').hidden = true; $('editorCategoryError').textContent = ''; $('noteError').textContent = '';
    $('editor').showModal(); $('noteTitle').focus();
  }
  function newNote() { requireProfile(() => { location.hash = 'board'; route(); showEditor(); }); }
  function showTask(id) {
    state.active = id; $('taskError').textContent = ''; $('subtaskTitle').value = ''; $('deleteConfirm').hidden = true;
    renderTask();
    if (!$('taskDialog').open) $('taskDialog').showModal();
    $('taskTitle').focus();
  }
  function renderTask() {
    const note = state.notes.find(item => item.id === state.active);
    if (!note) return;
    $('taskTitle').textContent = note.title;
    $('taskCategory').textContent = categoryName(note.categoryId);
    $('taskDescription').textContent = note.desc || 'Подробностей пока нет. Добавьте их через «Редактировать».';
    $('taskDescription').classList.toggle('no-description', !note.desc);
    $('taskMeta').innerHTML = `<span>Автор: <strong>${esc(note.author || 'аноним')}</strong></span><span>${note.takenBy ? 'В работе: <strong>' + esc(note.takenBy) + '</strong>' : 'Задача свободна'}</span>`;
    $('takeBtn').textContent = note.takenBy ? 'Освободить задачу' : 'Взять себе';
    $('taskDate').textContent = 'Создана ' + new Date(note.created).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
    const subtasks = note.subtasks || [], completed = subtasks.filter(item => item.done).length;
    $('subtaskCount').textContent = `${completed} из ${subtasks.length}`;
    $('subtaskProgress').max = subtasks.length || 1; $('subtaskProgress').value = completed;
    $('subtaskProgress').setAttribute('aria-valuetext', `Выполнено ${completed} из ${subtasks.length}`);
    $('subtaskEmpty').hidden = subtasks.length > 0;
    $('subtaskList').innerHTML = subtasks.map(item => `<li class="subtask${item.done ? ' done' : ''}" data-subtask="${esc(item.id)}"><label><input type="checkbox" data-toggle="${esc(item.id)}" ${item.done ? 'checked' : ''}><span class="subtask-title">${esc(item.title)}</span></label><button class="small-button" data-edit-subtask="${esc(item.id)}" aria-label="Изменить подзадачу: ${esc(item.title)}">Изменить</button><button class="small-button" data-remove-subtask="${esc(item.id)}" aria-label="Удалить подзадачу: ${esc(item.title)}">×</button></li>`).join('');
    setBusy(state.busy);
  }
  async function updateTask(patch, errorId = 'taskError') {
    const result = await mutate('PATCH', { id: state.active, ...patch }, errorId);
    if (result) applyNote(result.note);
    return result;
  }
  async function createCategory(name, errorId) {
    const result = await mutate('POST', { name }, errorId, 'categories');
    if (result) { state.categories.push(result.category); renderCategoryOptions(); toast('Категория создана'); }
    return result?.category;
  }
  $('addBtn').addEventListener('click', newNote);
  $('board').addEventListener('click', event => {
    const card = event.target.closest('[data-note]');
    if (card) showTask(card.dataset.note);
    if (event.target.closest('[data-add]')) newNote();
    if (event.target.closest('#retryLoad')) load();
  });
  $('filters').addEventListener('click', event => {
    const button = event.target.closest('[data-filter]');
    if (button) { state.filter = button.dataset.filter; renderBoard(); [...$('filters').children].find(item => item.dataset.filter === state.filter)?.focus(); }
  });
  $('categoryFilter').addEventListener('change', event => { state.category = event.target.value; renderBoard(); });
  $('categoryForm').addEventListener('submit', async event => {
    event.preventDefault();
    if (await createCategory($('categoryName').value, 'categoryError')) { $('categoryName').value = ''; $('categoryComposer').open = false; }
  });
  $('newCategoryBtn').addEventListener('click', () => { $('editorCategoryFields').hidden = !$('editorCategoryFields').hidden; if (!$('editorCategoryFields').hidden) $('editorCategoryName').focus(); });
  $('editorCategorySave').addEventListener('click', async () => {
    const category = await createCategory($('editorCategoryName').value, 'editorCategoryError');
    if (category) { $('noteCategory').value = category.id; $('editorCategoryName').value = ''; $('editorCategoryFields').hidden = true; }
  });
  $('editorCategoryName').addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); $('editorCategorySave').click(); } });
  $('profileLink').addEventListener('click', () => { state.pending = null; location.hash = 'settings'; });
  $('profileForm').addEventListener('submit', event => {
    event.preventDefault();
    const name = $('profileName').value.trim();
    if (!name) { $('profileError').textContent = 'Укажите имя'; return; }
    try { localStorage.setItem('board-profile-name', name); localStorage.setItem('board-name', name); }
    catch { $('profileError').textContent = 'Браузер не разрешает сохранить профиль. Разрешите хранение данных для сайта.'; return; }
    state.profile = name; $('profileError').textContent = ''; renderProfile(); toast('Профиль сохранён');
    const pending = state.pending; state.pending = null;
    if (pending) { location.hash = 'board'; route(); pending(); }
  });
  $('noteForm').addEventListener('submit', async event => {
    event.preventDefault();
    const fields = { title: $('noteTitle').value.trim(), desc: $('noteDesc').value.trim(), categoryId: $('noteCategory').value, color: $('noteForm').querySelector('[name=color]:checked').value };
    const id = state.editing;
    const result = await mutate(id ? 'PATCH' : 'POST', id ? { id, expectedVersion: state.editingVersion, ...fields } : { ...fields, author: state.profile }, 'noteError');
    if (!result) return;
    applyNote(result.note); $('editor').close();
    if (id) showTask(result.note.id);
    toast(id ? 'Изменения сохранены' : 'Задача на доске');
  });
  $('editBtn').addEventListener('click', () => {
    const note = state.notes.find(item => item.id === state.active);
    if (!note || state.busy) return;
    $('taskDialog').close(); showEditor(note);
  });
  $('takeBtn').addEventListener('click', () => {
    const note = state.notes.find(item => item.id === state.active);
    if (!note || state.busy) return;
    if (note.takenBy) { updateTask({ takenBy: '' }).then(result => { if (result) toast('Задача снова свободна'); }); return; }
    const id = note.id;
    requireProfile(async () => { if (!$('taskDialog').open) showTask(id); const result = await updateTask({ takenBy: state.profile }); if (result) toast('Задача теперь у вас'); });
  });
  $('subtaskForm').addEventListener('submit', async event => {
    event.preventDefault();
    const title = $('subtaskTitle').value.trim();
    if (!title) return;
    if (await updateTask({ action: 'addSubtask', title })) { $('subtaskTitle').value = ''; $('subtaskTitle').focus(); }
  });
  $('subtaskList').addEventListener('change', async event => {
    const input = event.target.closest('[data-toggle]');
    if (!input) return;
    const id = input.dataset.toggle;
    if (!(await updateTask({ action: 'toggleSubtask', subtaskId: id, done: input.checked }))) input.checked = !input.checked;
    [...$('subtaskList').querySelectorAll('[data-toggle]')].find(item => item.dataset.toggle === id)?.focus();
  });
  $('subtaskList').addEventListener('click', async event => {
    if (state.busy) return;
    const remove = event.target.closest('[data-remove-subtask]');
    if (remove) { await updateTask({ action: 'removeSubtask', subtaskId: remove.dataset.removeSubtask }); return; }
    const edit = event.target.closest('[data-edit-subtask]');
    if (edit) {
      if ($('subtaskList').querySelector('.subtask-edit-form')) { toast('Сначала сохраните текущую подзадачу'); return; }
      const subtask = state.notes.find(note => note.id === state.active)?.subtasks?.find(item => item.id === edit.dataset.editSubtask);
      if (!subtask) return;
      const row = edit.closest('li');
      row.innerHTML = `<form class="subtask-edit-form" data-id="${esc(subtask.id)}"><label class="sr-only" for="subtaskEdit">Название подзадачи</label><input id="subtaskEdit" maxlength="160" required value="${esc(subtask.title)}"><div class="form-actions"><button class="secondary" type="button" data-cancel-subtask>Отмена</button><button class="primary" data-mutate>Сохранить</button></div></form>`;
      $('subtaskEdit').focus();
    }
    if (event.target.closest('[data-cancel-subtask]')) renderTask();
  });
  $('subtaskList').addEventListener('submit', async event => {
    event.preventDefault();
    if (!event.target.matches('.subtask-edit-form')) return;
    await updateTask({ action: 'editSubtask', subtaskId: event.target.dataset.id, title: $('subtaskEdit').value });
  });
  $('deleteBtn').addEventListener('click', () => { $('deleteConfirm').hidden = false; $('cancelDelete').focus(); });
  $('cancelDelete').addEventListener('click', () => { $('deleteConfirm').hidden = true; $('deleteBtn').focus(); });
  $('confirmDelete').addEventListener('click', async () => {
    const id = state.active;
    if (await mutate('DELETE', { id }, 'taskError')) { state.notes = state.notes.filter(note => note.id !== id); $('taskDialog').close(); renderBoard(); toast('Задача снята'); }
  });
  document.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => $(button.dataset.close).close()));
  document.querySelectorAll('dialog').forEach(dialog => dialog.addEventListener('cancel', event => { if (state.busy) event.preventDefault(); }));
  $('editor').addEventListener('close', () => { if (state.editing && !$('taskDialog').open && location.hash !== '#settings' && state.notes.some(item => item.id === state.active)) showTask(state.active); });
  window.addEventListener('hashchange', route);
  renderProfile(); route(); load();
  setInterval(() => { if (!document.hidden) load(); }, 5000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });
})();
