(() => {
'use strict';
const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[char]);
const state = { me:null, users:[], notes:[], categories:[], category:'all', done:false, busy:false, loading:false, revision:0, active:null, editorVersion:0, dirty:false, categoryEditing:null };
const fragment = new URLSearchParams(location.hash.slice(1));
let invitation = fragment.get('setup') || fragment.get('invite') || '';
let registering = Boolean(invitation), toastTimer;
if (invitation) history.replaceState(null,'',location.pathname);
function toast(text) { $('toast').textContent=text; $('toast').hidden=false; clearTimeout(toastTimer); toastTimer=setTimeout(()=>$('toast').hidden=true,3500); }
function busy(value) { state.busy=value; document.querySelectorAll('[data-mutate],.close').forEach(x=>x.disabled=value); $('taskList').querySelectorAll('input').forEach(x=>x.disabled=value); $('stepList').querySelectorAll('button,input').forEach(x=>x.disabled=value); $('authSubmit').disabled=value; }
function showAuth() { document.querySelectorAll('dialog[open]').forEach(x=>x.close()); $('appView').hidden=true; $('authView').hidden=false; $('authHeading').textContent=registering?'Создать аккаунт':'Войти'; $('authSubmit').textContent=registering?'Создать аккаунт':'Войти'; $('registerFields').hidden=!registering; $('authName').required=registering; $('switchLogin').hidden=!registering; $('authPassword').autocomplete=registering?'new-password':'current-password'; }
async function request(method,body,resource='') {
  const controller=new AbortController(), timeout=setTimeout(()=>controller.abort(),25000);
  try {
    const response=await fetch('/api/notes'+(resource?'?resource='+resource:''),{method,cache:'no-store',credentials:'same-origin',headers:{'Content-Type':'application/json'},signal:controller.signal,...(body?{body:JSON.stringify(body)}:{})});
    const data=await response.json().catch(()=>({}));
    if (!response.ok) { const error=new Error(data.error||'Не удалось выполнить действие'); error.status=response.status; throw error; } return data;
  } finally { clearTimeout(timeout); }
}
async function mutate(method,body,errorId,resource='') {
  if(state.busy)return null; $(errorId).textContent=''; state.revision++; busy(true);
  try{return await request(method,body,resource);}catch(error){$(errorId).textContent=error.name==='AbortError'?'Сервер не подтвердил сохранение. Обновите список перед повторной попыткой.':error.message||'Нет связи. Введённые данные остались в форме';if(error.status===401&&resource!=='auth'){state.me=null;showAuth();$('authError').textContent='Войдите снова';}return null;}finally{busy(false);}
}
function currentCategory(){return state.categories.find(x=>x.id===state.category);}
function categoryName(id){return state.categories.find(x=>x.id===id)?.name||'';}
function person(id){return state.users.find(x=>x.id===id)?.name||'';}
function categoryOptions(categories){return categories.map(x=>`<option value="${esc(x.id)}">${x.scope==='private'?'Личная: ':'Общая: '}${esc(x.name)}</option>`).join('');}
function render(){
  $('myName').textContent=state.me.name;
  const allActive=state.notes.filter(x=>!x.done).length;$('allCount').textContent=allActive||'';
  $('allTasks').classList.toggle('active',state.category==='all');
  for(const [scope,id] of [['shared','sharedCategories'],['private','privateCategories']]){
    $(id).innerHTML=state.categories.filter(x=>x.scope===scope).map(category=>`<button class="category-item${category.id===state.category?' active':''}" data-category="${esc(category.id)}" aria-label="${scope==='private'?'Личная':'Общая'} категория: ${esc(category.name)}">${scope==='private'?'<span aria-hidden="true">◉</span>':''}${esc(category.name)}<span>${state.notes.filter(x=>x.categoryId===category.id&&!x.done).length||''}</span></button>`).join('');
  }
  const category=currentCategory();
  $('pageTitle').textContent=category?.name||'Все задачи';$('scopeLabel').textContent=category?(category.scope==='private'?'ЛИЧНАЯ КАТЕГОРИЯ':'ОБЩАЯ КАТЕГОРИЯ'):'ВСЕ КАТЕГОРИИ';
  $('pageDescription').textContent=category?(category.scope==='private'?'Эти задачи видны только вам.':'Задачи видны вам и участникам команды.'):'Личные дела и общая работа в одном месте.';
  $('workspaceLabel').textContent=category?(category.scope==='private'?'Личное пространство':'Общее пространство'):'Общий обзор';
  $('editCategoryBtn').hidden=!category;
  const selected=$('quickCategory').value;$('quickCategory').innerHTML=categoryOptions(state.categories);$('quickCategory').value=category?.id||(state.categories.some(x=>x.id===selected)?selected:state.categories.find(x=>x.scope==='shared')?.id||state.categories[0]?.id||'');
  const scoped=state.notes.filter(x=>state.category==='all'||x.categoryId===state.category);
  $('activeCount').textContent=scoped.filter(x=>!x.done).length;$('doneCount').textContent=scoped.filter(x=>x.done).length;
  $('activeTab').setAttribute('aria-pressed',String(!state.done));$('doneTab').setAttribute('aria-pressed',String(state.done));
  const query=$('search').value.trim().toLocaleLowerCase('ru');
  const list=scoped.filter(x=>x.done===state.done&&(!query||`${x.title} ${x.desc}`.toLocaleLowerCase('ru').includes(query)));
  $('taskList').innerHTML=list.length?list.map(note=>`<div class="task-row${note.done?' done':''}"><input type="checkbox" data-complete="${esc(note.id)}" ${note.done?'checked':''} aria-label="${note.done?'Вернуть в активные':'Выполнить'}: ${esc(note.title)}"><button class="task-open" data-note="${esc(note.id)}"><span class="task-title">${esc(note.title)}</span><span class="task-meta"><span>${esc(categoryName(note.categoryId))}</span>${note.subtasks.length?`<span>Шаги: ${note.subtasks.filter(x=>x.done).length}/${note.subtasks.length}</span>`:''}</span></button><span class="task-person">${esc(person(note.assigneeId)||'Без исполнителя')}</span><span class="row-arrow" aria-hidden="true">›</span></div>`).join(''):`<div class="empty"><h2>${query?'Ничего не найдено':state.done?'Выполненные задачи появятся здесь':'Всё разобрано'}</h2><p>${query?'Попробуйте другое название.':state.done?'Отметьте задачу галочкой в списке активных.':'Добавьте задачу строкой выше. Категорию можно выбрать сразу.'}</p></div>`;
  $('members').innerHTML=state.users.map(x=>`<div class="member">${esc(x.name)}${x.id===state.me.id?' (вы)':''}<span>${x.role==='owner'?'Владелец':'Участник'}</span></div>`).join('');$('inviteArea').hidden=state.me.role!=='owner';
}
async function load(){
  if(!state.me||state.busy||state.loading)return;state.loading=true;const revision=state.revision;
  try{const data=await request('GET');if(revision!==state.revision)return;state.me=data.me;state.users=data.users;state.notes=data.notes;state.categories=data.categories;if(state.category!=='all'&&!currentCategory())state.category='all';render();$('connection').textContent='Все изменения сохранены · Обновлено '+new Date().toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'});}
  catch(error){if(error.status===401){state.me=null;showAuth();}else $('connection').textContent='Нет связи. Список не обновлён. Повторим подключение.';}
  finally{state.loading=false;}
}
function applyNote(note){const index=state.notes.findIndex(x=>x.id===note.id);if(index<0)state.notes.unshift(note);else state.notes[index]=note;render();}
function showTask(id){const note=state.notes.find(x=>x.id===id);if(!note)return;state.active=id;state.editorVersion=note.version;state.dirty=false;
  $('taskHeading').textContent=note.title;$('taskTitle').value=note.title;$('taskDesc').value=note.desc;
  const category=state.categories.find(x=>x.id===note.categoryId);$('taskScope').textContent=category.scope==='private'?'ЛИЧНАЯ ЗАДАЧА':'ОБЩАЯ ЗАДАЧА';
  $('taskCategory').innerHTML=categoryOptions(state.categories.filter(x=>x.scope===category.scope));$('taskCategory').value=note.categoryId;
  const users=category.scope==='private'?[state.me]:state.users;$('taskAssignee').innerHTML='<option value="">Пока никто</option>'+users.map(x=>`<option value="${esc(x.id)}">${esc(x.name)}${x.id===state.me.id?' (я)':''}</option>`).join('');$('taskAssignee').value=note.assigneeId;
  $('taskAuthor').textContent='Создал(а): '+(person(note.createdBy)||note.author)+' · '+new Date(note.created).toLocaleDateString('ru-RU');
  $('taskComplete').textContent=note.done?'Вернуть в активные':'Отметить выполненной';$('taskError').textContent='';$('deleteConfirm').hidden=true;$('stepTitle').value='';renderSteps(note);$('taskDialog').showModal();
}
function renderSteps(note){const done=note.subtasks.filter(x=>x.done).length;$('stepCount').textContent=`${done} из ${note.subtasks.length}`;$('stepProgress').max=note.subtasks.length||1;$('stepProgress').value=done;
  $('stepList').innerHTML=note.subtasks.map(x=>`<li class="step-row${x.done?' done':''}" data-step="${esc(x.id)}"><label><input type="checkbox" data-step-check="${esc(x.id)}" ${x.done?'checked':''}><span>${esc(x.title)}</span></label><button data-step-edit="${esc(x.id)}" aria-label="Изменить подзадачу: ${esc(x.title)}">Изменить</button><button data-step-remove="${esc(x.id)}" aria-label="Удалить подзадачу: ${esc(x.title)}">×</button></li>`).join('');
}
async function saveTask(){const result=await mutate('PATCH',{id:state.active,expectedVersion:state.editorVersion,title:$('taskTitle').value,desc:$('taskDesc').value,categoryId:$('taskCategory').value,assigneeId:$('taskAssignee').value},'taskError');if(!result)return false;state.editorVersion=result.note.version;state.dirty=false;applyNote(result.note);$('taskHeading').textContent=result.note.title;return true;}
async function changeStep(patch){if(state.dirty&&!(await saveTask()))return null;const result=await mutate('PATCH',{id:state.active,...patch},'taskError');if(result){state.editorVersion=result.note.version;applyNote(result.note);renderSteps(result.note);}return result;}
function selectCategory(id){state.category=id;state.done=false;$('tasksView').hidden=false;$('settingsView').hidden=true;$('search').value='';render();}
$('authForm').addEventListener('submit',async event=>{event.preventDefault();const result=await mutate('POST',{action:registering?'register':'login',name:$('authName').value,username:$('authUsername').value,password:$('authPassword').value,invite:invitation},'authError','auth');if(result){$('authPassword').value='';invitation='';registering=false;state.me=result.me;$('authView').hidden=true;$('appView').hidden=false;await load();}});
$('switchLogin').addEventListener('click',()=>{registering=false;showAuth();});
$('logoutBtn').addEventListener('click',async()=>{if(state.busy)return;const result=await mutate('POST',{action:'logout'},'mainError','auth');if(result){state.me=null;state.notes=[];state.categories=[];$('taskList').replaceChildren();$('sharedCategories').replaceChildren();$('privateCategories').replaceChildren();$('members').replaceChildren();$('inviteLink').value='';$('inviteResult').hidden=true;showAuth();}});
$('allTasks').addEventListener('click',()=>selectCategory('all'));
for(const id of ['sharedCategories','privateCategories'])$(id).addEventListener('click',event=>{const button=event.target.closest('[data-category]');if(button)selectCategory(button.dataset.category);});
$('activeTab').addEventListener('click',()=>{state.done=false;render();});$('doneTab').addEventListener('click',()=>{state.done=true;render();});$('search').addEventListener('input',render);
$('quickForm').addEventListener('submit',async event=>{event.preventDefault();const result=await mutate('POST',{title:$('quickTitle').value,categoryId:$('quickCategory').value},'mainError');if(result){$('quickTitle').value='';state.done=false;applyNote(result.note);$('connection').textContent='Задача сохранена';$('quickTitle').focus();}});
$('taskList').addEventListener('click',event=>{const button=event.target.closest('[data-note]');if(button&&!state.busy)showTask(button.dataset.note);});
$('taskList').addEventListener('change',async event=>{const input=event.target.closest('[data-complete]');if(!input)return;const done=input.checked;const result=await mutate('PATCH',{id:input.dataset.complete,done},'mainError');if(result){applyNote(result.note);toast(done?'Задача выполнена':'Задача снова активна');}else input.checked=!done;});
function openCategory(editing=false){state.categoryEditing=editing?state.category:null;$('categoryHeading').textContent=editing?'Название категории':'Новая категория';$('categoryName').value=editing?currentCategory().name:'';$('categoryScope').hidden=editing;$('categoryError').textContent='';$('categoryDialog').showModal();$('categoryName').focus();}
$('addCategory').addEventListener('click',()=>openCategory());$('editCategoryBtn').addEventListener('click',()=>openCategory(true));
$('categoryForm').addEventListener('submit',async event=>{event.preventDefault();const id=state.categoryEditing;const result=await mutate(id?'PATCH':'POST',{...(id?{id}:{scope:$('categoryForm').querySelector('[name=scope]:checked').value}),name:$('categoryName').value},'categoryError','categories');if(result){if(id)state.categories=state.categories.map(x=>x.id===id?result.category:x);else state.categories.push(result.category);$('categoryDialog').close();selectCategory(result.category.id);toast('Категория сохранена');}});
$('settingsBtn').addEventListener('click',()=>{$('tasksView').hidden=true;$('settingsView').hidden=false;$('profileName').value=state.me.name;});$('backToTasks').addEventListener('click',()=>{$('settingsView').hidden=true;$('tasksView').hidden=false;});
$('profileForm').addEventListener('submit',async event=>{event.preventDefault();const result=await mutate('POST',{action:'profile',name:$('profileName').value},'profileError','auth');if(result){state.me=result.me;state.users=state.users.map(x=>x.id===result.me.id?result.me:x);render();toast('Имя сохранено');}});
$('inviteBtn').addEventListener('click',async()=>{const result=await mutate('POST',{},'inviteError','invite');if(result){$('inviteLink').value=location.origin+location.pathname+'#invite='+result.token;$('inviteResult').hidden=false;}});
$('copyInvite').addEventListener('click',async()=>{try{await navigator.clipboard.writeText($('inviteLink').value);toast('Ссылка скопирована');}catch{$('inviteLink').focus();$('inviteLink').select();toast('Скопируйте выделенную ссылку');}});
$('taskForm').addEventListener('input',()=>state.dirty=true);$('taskForm').addEventListener('change',()=>state.dirty=true);$('taskForm').addEventListener('submit',async event=>{event.preventDefault();if(await saveTask())toast('Изменения сохранены');});
$('stepForm').addEventListener('submit',async event=>{event.preventDefault();if(await changeStep({action:'addSubtask',title:$('stepTitle').value})){$('stepTitle').value='';$('stepTitle').focus();}});
$('stepList').addEventListener('change',async event=>{const input=event.target.closest('[data-step-check]');if(input){const done=input.checked;if(!(await changeStep({action:'toggleSubtask',subtaskId:input.dataset.stepCheck,done})))input.checked=!done;}});
$('stepList').addEventListener('click',async event=>{if(state.busy)return;const remove=event.target.closest('[data-step-remove]');if(remove){await changeStep({action:'removeSubtask',subtaskId:remove.dataset.stepRemove});return;}const edit=event.target.closest('[data-step-edit]');if(edit){if($('stepList').querySelector('.step-edit'))return;const step=state.notes.find(x=>x.id===state.active).subtasks.find(x=>x.id===edit.dataset.stepEdit);edit.closest('li').innerHTML=`<form class="step-edit" data-id="${esc(step.id)}"><label class="sr-only" for="stepEditTitle">Название подзадачи</label><input id="stepEditTitle" maxlength="160" required value="${esc(step.title)}"><div class="input-row"><button type="button" data-step-cancel>Отмена</button><button data-mutate>Сохранить</button></div></form>`;$('stepEditTitle').focus();}if(event.target.closest('[data-step-cancel]'))renderSteps(state.notes.find(x=>x.id===state.active));});
$('stepList').addEventListener('submit',async event=>{event.preventDefault();if(event.target.matches('.step-edit'))await changeStep({action:'editSubtask',subtaskId:event.target.dataset.id,title:$('stepEditTitle').value});});
$('taskComplete').addEventListener('click',async()=>{if(state.dirty&&!(await saveTask()))return;const note=state.notes.find(x=>x.id===state.active);const result=await mutate('PATCH',{id:note.id,done:!note.done},'taskError');if(result){applyNote(result.note);$('taskDialog').close();toast(result.note.done?'Задача выполнена':'Задача снова активна');}});
$('deleteBtn').addEventListener('click',()=>{$('deleteConfirm').hidden=false;});$('cancelDelete').addEventListener('click',()=>{$('deleteConfirm').hidden=true;});$('confirmDelete').addEventListener('click',async()=>{const result=await mutate('DELETE',{id:state.active},'taskError');if(result){state.notes=state.notes.filter(x=>x.id!==state.active);state.dirty=false;$('taskDialog').close();render();toast('Задача удалена');}});
function mayClose(dialog){return !state.busy&&(dialog.id!=='taskDialog'||!state.dirty||confirm('Изменения задачи не сохранены. Закрыть без сохранения?'));}
document.querySelectorAll('[data-close]').forEach(button=>button.addEventListener('click',()=>{const dialog=$(button.dataset.close);if(mayClose(dialog))dialog.close();}));document.querySelectorAll('dialog').forEach(dialog=>dialog.addEventListener('cancel',event=>{if(!mayClose(dialog))event.preventDefault();}));
setInterval(()=>{if(!document.hidden)load();},60000);document.addEventListener('visibilitychange',()=>{if(!document.hidden)load();});
(async()=>{try{const data=await request('GET',null,'auth');state.me=data.me;if(state.me){$('appView').hidden=false;await load();}else{showAuth();if(data.needsSetup&&!invitation)$('authIntro').textContent='Первый вход доступен по персональной ссылке владельца. После создания аккаунтов входите по логину и паролю.';}}catch{showAuth();$('authError').textContent='Не удалось подключиться к хранилищу. Обновите страницу чуть позже.';}})();
})();
