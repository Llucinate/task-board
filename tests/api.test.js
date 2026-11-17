import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
const dir=await mkdtemp(resolve('../../test-data-'));
process.env.TASK_BOARD_DATA_FILE=join(dir,'state.json');process.env.TASK_BOARD_SETUP_TOKEN='test-only-bootstrap-token';
const {default:handler}=await import('../api/notes.js');
const password='test-password-at-least-12';
async function call(method,body,resource='',session='',headers={}){
 const res={headers:{},setHeader(k,v){this.headers[k]=v;},end(s){this.data=JSON.parse(s);}};
 await handler({method,body,query:{resource},headers:{host:'board.test',origin:'https://board.test',cookie:session,...headers},socket:{remoteAddress:'test'}},res);
 return {status:res.statusCode,...res.data,cookie:res.headers['Set-Cookie']?.split(';')[0]};
}
let owner,partner,oc,pc,shared,priv,personal,note;
test('Рабочий сценарий двух участников',async t=>{
 await t.test('Доступ анонима закрыт; регистрация требует приглашение',async()=>{
 assert.equal((await call('GET')).status,401);assert.equal((await call('POST',{action:'register',name:'Посторонний',username:'stranger',password},'auth')).status,403);
 });
 await t.test('Владелец создаётся только по начальной ссылке',async()=>{
 const r=await call('POST',{action:'register',name:'Владелец',username:'owner',password,invite:process.env.TASK_BOARD_SETUP_TOKEN},'auth');assert.equal(r.status,200);owner=r.me;oc=r.cookie;assert.equal(owner.role,'owner');
 const data=await call('GET',null,'',oc);shared=data.categories.find(x=>x.scope==='shared').id;priv=data.categories.find(x=>x.scope==='private').id;
 });
 await t.test('Одноразовое приглашение создаёт партнёра без прав владельца',async()=>{
 const inv=await call('POST',{},'invite',oc);const r=await call('POST',{action:'register',name:'Партнёр',username:'partner',password,invite:inv.token},'auth');assert.equal(r.status,200);partner=r.me;pc=r.cookie;
 assert.equal((await call('POST',{},'invite',pc)).status,403);assert.equal((await call('POST',{action:'register',name:'Третий',username:'third',password,invite:inv.token},'auth')).status,403);
 });
 await t.test('Общая задача видна обоим, автор определяется сервером',async()=>{
 const r=await call('POST',{title:'Общая задача',categoryId:shared,author:'Подделка'},'',oc);assert.equal(r.status,201);note=r.note;assert.equal(note.createdBy,owner.id);
 assert.ok((await call('GET',null,'',pc)).notes.some(x=>x.id===note.id));
 });
 await t.test('Приватные задачи не видны и не изменяются партнёром',async()=>{
 personal=(await call('POST',{title:'Личная задача',categoryId:priv},'',oc)).note;const data=await call('GET',null,'',pc);
 assert.ok(!data.categories.some(x=>x.id===priv));assert.ok(!data.notes.some(x=>x.id===personal.id));
 for(const method of ['PATCH','DELETE'])assert.equal((await call(method,{id:personal.id,title:'Чужая правка'},'',pc)).status,404);
 assert.equal((await call('POST',{title:'Чужая категория',categoryId:priv},'',pc)).status,404);
 });
 await t.test('Категории создаются; личное нельзя случайно раскрыть переносом',async()=>{
 const r=await call('POST',{name:'Ruby Studio',scope:'shared'},'categories',oc);assert.equal(r.status,201);assert.ok((await call('GET',null,'',pc)).categories.some(x=>x.id===r.category.id));
 assert.equal((await call('PATCH',{id:personal.id,categoryId:shared},'',oc)).status,400);assert.equal((await call('PATCH',{id:personal.id,assigneeId:partner.id},'',oc)).status,400);
 });
 await t.test('Задачи сохраняются между отдельными процессами сервера',async()=>{
 const file=pathToFileURL(resolve('api/notes.js')).href;
 const script=`import handler from ${JSON.stringify(file)};await handler({method:'GET',query:{},headers:{host:'board.test',cookie:${JSON.stringify(oc)}}},{setHeader(){},end(s){console.log(s)}});`;
 const child=spawnSync(process.execPath,['--input-type=module','-e',script],{encoding:'utf8',env:process.env});assert.equal(child.status,0,child.stderr);const data=JSON.parse(child.stdout);assert.ok(data.notes.some(x=>x.id===note.id));assert.ok(data.notes.some(x=>x.id===personal.id));
 });
 await t.test('Задача выполняется и возвращается в активные',async()=>{
 let r=await call('PATCH',{id:note.id,done:true},'',pc);assert.equal(r.note.done,true);assert.ok(r.note.completedAt);r=await call('PATCH',{id:note.id,done:false},'',oc);assert.equal(r.note.done,false);
 });
 await t.test('Подзадачи и назначение сохраняются при правке; устаревшая правка отклоняется',async()=>{
 await call('PATCH',{id:note.id,assigneeId:partner.id},'',oc);let r=await call('PATCH',{id:note.id,action:'addSubtask',title:'Шаг'},'',oc);const step=r.note.subtasks[0];
 r=await call('PATCH',{id:note.id,action:'toggleSubtask',subtaskId:step.id,done:true},'',pc);assert.equal(r.note.subtasks[0].done,true);
 r=await call('PATCH',{id:note.id,action:'editSubtask',subtaskId:step.id,title:'Уточнённый шаг'},'',pc);assert.equal(r.note.subtasks[0].title,'Уточнённый шаг');const version=r.note.version;
 r=await call('PATCH',{id:note.id,title:'Новое название',expectedVersion:version},'',oc);assert.equal(r.note.assigneeId,partner.id);assert.equal(r.note.subtasks[0].done,true);
 assert.equal((await call('PATCH',{id:note.id,title:'Старая правка',expectedVersion:version},'',pc)).status,409);await call('PATCH',{id:note.id,action:'removeSubtask',subtaskId:step.id},'',oc);
 });
 await t.test('Параллельные дополнения не теряют шаги',async()=>{
 const rs=await Promise.all(['А','Б'].map(title=>call('PATCH',{id:note.id,action:'addSubtask',title},'',oc)));assert.ok(rs.every(x=>x.status===200));assert.equal((await call('GET',null,'',oc)).notes.find(x=>x.id===note.id).subtasks.length,2);
 });
 await t.test('Пароли и сессии хешируются, секреты не выдаются клиенту',async()=>{
 const raw=await readFile(process.env.TASK_BOARD_DATA_FILE,'utf8');assert.ok(!raw.includes(password));assert.ok(!raw.includes(oc.split('=')[1]));const data=JSON.stringify(await call('GET',null,'',oc));assert.ok(!data.includes('password'));assert.ok(!data.includes('sessions'));assert.ok(!data.includes('invitations'));
 });
 await t.test('Ошибочная правка и CSRF ничего не меняют',async()=>{
 const before=(await call('GET',null,'',oc)).notes.find(x=>x.id===note.id);assert.equal((await call('PATCH',{id:note.id,title:'',desc:'Ошибка'},'',oc)).status,400);assert.deepEqual((await call('GET',null,'',oc)).notes.find(x=>x.id===note.id),before);
 assert.equal((await call('POST',{title:'CSRF',categoryId:shared},'',oc,{origin:'https://other.test'})).status,403);assert.equal((await call('POST','{bad','',oc)).status,400);
 });
 await t.test('Выход отзывает сессию; правильный пароль снова пускает',async()=>{
 await call('POST',{action:'logout'},'auth',pc);assert.equal((await call('GET',null,'',pc)).status,401);const r=await call('POST',{action:'login',username:'partner',password},'auth');assert.equal(r.me.id,partner.id);assert.equal((await call('POST',{action:'login',username:'partner',password:'wrong-long-password'},'auth')).status,401);
 });
 await t.test('Удаление одной задачи сохраняет остальные',async()=>{
 assert.equal((await call('DELETE',{id:note.id},'',oc)).status,200);const data=await call('GET',null,'',oc);assert.ok(!data.notes.some(x=>x.id===note.id));assert.ok(data.notes.some(x=>x.id===personal.id));
 });
});
