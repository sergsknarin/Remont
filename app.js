/* Справочник ремонта — шаг 4: фото (качество, подсказка, ⭐, память) */
'use strict';
const APP_VERSION = '0.14.0';
// Настройки программы — config.js (JetService: своё имя, своё хранилище, только Jetour). Нет файла — общий справочник.
const APP = Object.assign({ name: 'Справочник ремонта', db: 'repairRef', ls: 'rr_', only: '' }, window.APP_CFG || {});

/* ---------- Хранилище (IndexedDB, запасной вариант — память) ---------- */
const Store = {
  db: null,
  open() {
    return new Promise(res => {
      try {
        const rq = indexedDB.open(APP.db, 3);
        rq.onupgradeneeded = () => { const d = rq.result;
          if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv');
          if (!d.objectStoreNames.contains('photos')) d.createObjectStore('photos'); // фото: id → Blob
          if (!d.objectStoreNames.contains('files')) d.createObjectStore('files'); }; // документы: docf_id → PDF (0.9.0)
        rq.onsuccess = () => { this.db = rq.result; res(); };
        rq.onerror = () => res();
      } catch (e) { res(); }
    });
  },
  get(k, st = 'kv') {
    return new Promise(res => {
      if (!this.db) return res(null);
      const rq = this.db.transaction(st).objectStore(st).get(k);
      rq.onsuccess = () => res(rq.result ?? null);
      rq.onerror = () => res(null);
    });
  },
  set(k, v, st = 'kv') {
    return new Promise(res => {
      if (!this.db) { saveMark(false); return res(false); }
      saveMark(null);
      try {
        const tx = this.db.transaction(st, 'readwrite');
        tx.objectStore(st).put(v, k);
        tx.oncomplete = () => { saveMark(true); res(true); };
        tx.onerror = () => { saveMark(false); res(false); };
      } catch (e) { saveMark(false); res(false); }
    });
  }
};

/* ---------- Метка «Сохранено» в шапке (0.5.0) ---------- */
let saving = 0;
function saveMark(ok) {
  const el = document.getElementById('saveState'); if (!el) return;
  if (ok === null) { saving++; el.className = 'sv busy'; el.textContent = 'Сохраняю…'; return; }
  saving = Math.max(0, saving - 1); if (saving && ok) return;
  const d = new Date(), hm = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  el.className = 'sv ' + (ok ? 'ok' : 'err');
  el.innerHTML = ok ? '✓ <span class="w">Сохранено </span>' + hm : '⚠ Не сохранено';
  el.title = ok ? 'Все изменения сохранены в ' + hm : 'Ошибка сохранения — сделайте резервную копию (⋮)';
}

let DB = null;
const state = { path: [] }; // [{type:'brand',id},{type:'model',id},{type:'group',name}...,{type:'work',id}]

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast._t); toast._t = setTimeout(() => t.hidden = true, 2500); }

function validDB(d) { return d && d.format === 'repair-ref' && Array.isArray(d.brands) && Array.isArray(d.templates) && Array.isArray(d.items); }
async function save() { if (!(await Store.set('db', DB))) toast('Не удалось сохранить в память браузера'); else if (typeof bkMark === 'function') bkMark(); } // bkMark — backup.js

/* ---------- Работы для марки/модели ---------- */
// Общие шаблоны + работы конкретной марки (без модели) + работы модели
// Своя работа с полем overrides заменяет общую; brand.hidden — скрытые у марки общие работы
function worksFor(brandId, modelId) {
  const b = findBrand(brandId), hidden = new Set((b && b.hidden) || []);
  const own = DB.items.filter(i => i.brand === brandId && (!i.model || i.model === modelId));
  const over = new Map(own.filter(i => i.overrides).map(i => [i.overrides, i]));
  // изменённая для марки работа стоит на месте общей
  return DB.templates.filter(t => !hidden.has(t.id)).map(t => over.has(t.id) ? { ...over.get(t.id), src: 'own' } : { ...t, src: 'tpl' })
    .concat(own.filter(i => !i.overrides).map(i => ({ ...i, src: 'own' })));
}
const newId = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const num = v => { if (v === '' || v == null) return null; const n = parseFloat(String(v).replace(',', '.')); return isNaN(n) ? null : n; };

/* ---------- Диалоги внутри страницы (без alert/confirm) ---------- */
function modal(html) {
  const m = document.createElement('div'); m.className = 'modal';
  m.innerHTML = '<div class="box">' + html + '</div>';
  document.body.appendChild(m); return m;
}
// ask('Текст', [{k:'yes',t:'Да',cls:'danger'},{k:null,t:'Отмена'}]) → k
function ask(msg, btns) {
  return new Promise(res => {
    const m = modal(`<p>${esc(msg).replace(/\n/g, '<br>')}</p><div class="btns">` +
      btns.map((b, i) => `<button data-i="${i}" class="${b.cls || ''}">${esc(b.t)}</button>`).join('') + '</div>');
    m.onclick = e => { const i = e.target.dataset.i; if (i == null && e.target !== m) return; m.remove(); res(i == null ? null : btns[i].k); };
  });
}
const confirmBox = (msg, yes = 'Да', cls = '') => ask(msg, [{ k: true, t: yes, cls }, { k: false, t: 'Отмена' }]);
// fields: [{k,label,type:'text'|'num'|'area',list:[...] }] → объект или null
function formBox(title, fields, val = {}) {
  return new Promise(res => {
    const m = modal(`<h3>${esc(title)}</h3><form>` + fields.map(f => {
      const id = 'f_' + f.k, v = esc(val[f.k] ?? '');
      const dl = f.list ? `<datalist id="${id}_l">${f.list.map(o => `<option value="${esc(o)}">`).join('')}</datalist>` : '';
      const inp = f.type === 'area' ? `<textarea id="${id}" rows="3">${v}</textarea>`
        : `<input id="${id}" value="${v}" ${f.type === 'num' ? 'inputmode="decimal"' : ''} ${f.list ? `list="${id}_l"` : ''} autocomplete="off">`;
      return `<label for="${id}">${esc(f.label)}</label>${inp}${dl}`;
    }).join('') + '<div class="btns"><button type="submit" class="pri">Сохранить</button><button type="button" data-c="1">Отмена</button></div></form>');
    const fm = m.querySelector('form');
    setTimeout(() => { const first = fm.querySelector('input,textarea'); first && first.focus(); }, 50);
    m.querySelector('[data-c]').onclick = () => { m.remove(); res(null); };
    fm.onsubmit = e => {
      e.preventDefault();
      const out = {}; fields.forEach(f => out[f.k] = fm.querySelector('#f_' + f.k).value.trim());
      if (fields[0] && !out[fields[0].k]) { fm.querySelector('#f_' + fields[0].k).focus(); return; }
      m.remove(); res(out);
    };
  });
}
const findBrand = id => DB.brands.find(b => b.id === id);
const findModel = (b, id) => b && b.models.find(m => m.id === id);

/* ---------- Отрисовка ---------- */
function ctx() {
  const c = { brand: null, model: null, groups: [], work: null };
  for (const p of state.path) {
    if (p.type === 'brand') c.brand = findBrand(p.id);
    else if (p.type === 'model') c.model = findModel(c.brand, p.id);
    else if (p.type === 'group') c.groups.push(p.name);
    else if (p.type === 'work') c.work = p.id;
  }
  return c;
}

function render() {
  const c = ctx(), v = $('#view'), q = $('#q').value.trim().toLowerCase();
  $('#btnBack').hidden = $('#btnHome').hidden = state.path.length === 0;
  const crumbs = [c.brand && c.brand.name, c.model && c.model.name, ...c.groups].filter(Boolean);
  $('#crumbs').textContent = crumbs.length ? crumbs.join(' › ') : APP.name;

  if (q) return renderSearch(v, c, q);
  remember(c);
  const tail = state.path[state.path.length - 1];
  if (tail && (tail.type === 'codes' || tail.type === 'code')) { // ошибки сканера (errors.js)
    const x = tail.type === 'code' && codesDB().find(e => e.id === tail.id);
    $('#crumbs').textContent = [c.brand && c.brand.name, c.model && c.model.name, 'Ошибки', x ? x.code : tail.type === 'code' && String(tail.id).startsWith('dtc:') ? tail.id.slice(4) : ''].filter(Boolean).join(' › ');
    return tail.type === 'code' ? renderCode(v, c, tail.id) : renderCodes(v, c);
  }
  if (tail && tail.type === 'to') { // ТО и жидкости (to.js)
    $('#crumbs').textContent = [c.brand && c.brand.name, c.model && c.model.name, 'ТО и жидкости'].filter(Boolean).join(' › ');
    return renderTO(v, c);
  }
  if (tail && (tail.type === 'docs' || tail.type === 'doc')) { // документация (docs.js)
    const d = tail.type === 'doc' && docsAll().find(x => x.id === tail.id);
    $('#crumbs').textContent = [c.brand && c.brand.name, c.model && c.model.name, 'Документация', d && d.title].filter(Boolean).join(' › ');
    return tail.type === 'doc' ? renderDoc(v, c, tail.id) : renderDocs(v, c);
  }
  if (!c.brand) return renderBrands(v);
  if (c.brand.models.length && !c.model && !state.path.some(p => p.type === 'model')) return renderModels(v, c.brand);
  const works = worksFor(c.brand.id, c.model && c.model.id);
  if (c.work) return renderWork(v, works.find(w => w.id === c.work), c);
  renderGroup(v, works, c.groups);
}

// i.ed — показывать кнопки ✎/✕ в режиме правки (state.edit)
function rowsHtml(items) {
  return '<div class="list">' + items.map(i =>
    `<div class="row" data-i="${i.k}"><div class="t">${i.t}${i.s ? `<div class="s">${i.s}</div>` : ''}</div>` +
    (i.n != null ? `<span class="n">${i.n}</span>` : '') +
    (i.ed && state.edit ? `<button class="mini" data-e="${i.k}" aria-label="Переименовать">✎</button><button class="mini del" data-d="${i.k}" aria-label="Удалить">✕</button>` : '') +
    `<span class="ch">›</span></div>`).join('') + '</div>';
}
function bindRows(v, h, he = {}, hd = {}) {
  v.querySelectorAll('.row').forEach(r => r.onclick = e => {
    const b = e.target.closest('button');
    if (b && b.dataset.e) return he[b.dataset.e]();
    if (b && b.dataset.d) return hd[b.dataset.d]();
    h[r.dataset.i] && h[r.dataset.i]();
  });
}
const addBtns = list => '<div class="adds">' + list.map(([a, t]) => `<button class="add" data-add="${a}">+ ${t}</button>`).join('') + '</div>';
function bindAdds(v, h) { v.querySelectorAll('[data-add]').forEach(b => b.onclick = () => h[b.dataset.add]()); }

function renderBrands(v) {
  const ob = APP.only && DB.brands.find(b => norm(b.name) === norm(APP.only));
  if (ob) return renderOnly(v, ob);
  const h = {}, he = {}, hd = {}, items = DB.brands.map(b => {
    h[b.id] = () => go({ type: 'brand', id: b.id });
    he[b.id] = () => renameBrand(b);
    hd[b.id] = () => deleteBrand(b);
    return { k: b.id, t: esc(b.name), n: b.models.length ? b.models.length + ' мод.' : null, ed: true };
  });
  v.innerHTML = quickHtml(h) + '<h2>Марки</h2>' + rowsHtml(items) + addBtns([['brand', 'Марка']]);
  bindRows(v, h, he, hd); bindAdds(v, { brand: addBrand });
}

function renderModels(v, b) {
  const h = { all: () => go({ type: 'model', id: null }) }, he = {}, hd = {};
  const items = [{ k: 'all', t: 'Все модели', s: 'общие работы марки' }].concat(b.models.map(m => {
    h[m.id] = () => go({ type: 'model', id: m.id });
    he[m.id] = () => renameModel(b, m);
    hd[m.id] = () => deleteModel(b, m);
    return { k: m.id, t: esc(m.name), ed: true };
  }));
  v.innerHTML = docsRow(ctx(), h) + '<h2>Модели</h2>' + rowsHtml(items) + addBtns([['model', 'Модель']]);
  bindRows(v, h, he, hd); bindAdds(v, { model: () => addModel(b) });
}

// Программа под одну марку (JetService): на главной сразу её модели
function renderOnly(v, b) {
  const h = {}, he = {}, hd = {}, P = m => [{ type: 'brand', id: b.id }, { type: 'model', id: m }];
  h.all = () => goPath(P(null));
  const items = [{ k: 'all', t: 'Все модели', s: 'общие работы ' + esc(b.name) }].concat(b.models.map(m => {
    h[m.id] = () => goPath(P(m.id)); he[m.id] = () => renameModel(b, m); hd[m.id] = () => deleteModel(b, m);
    return { k: m.id, t: esc(m.name), ed: true };
  }));
  v.innerHTML = quickHtml(h) + '<h2>Модели ' + esc(b.name) + '</h2>' + rowsHtml(items) + addBtns([['model', 'Модель']]);
  bindRows(v, h, he, hd); bindAdds(v, { model: () => addModel(b) });
}

/* ---------- Правка марок и моделей ---------- */
async function addBrand() {
  const r = await formBox('Новая марка', [{ k: 'name', label: 'Название' }, AKA_FIELD]); if (!r) return;
  if (DB.brands.some(b => b.name.toLowerCase() === r.name.toLowerCase())) return toast('Такая марка уже есть');
  DB.brands.push({ id: newId('b'), name: r.name, aka: r.aka, models: [] }); await save(); render(); toast('Марка добавлена');
}
async function renameBrand(b) {
  const r = await formBox('Марка', [{ k: 'name', label: 'Название' }, AKA_FIELD], { name: b.name, aka: akaOf(b) }); if (!r) return;
  b.name = r.name; b.aka = r.aka; await save(); render();
}
async function deleteBrand(b) {
  const own = DB.items.filter(i => i.brand === b.id).length;
  if (!await confirmBox(`Удалить марку «${b.name}»?` + (own ? `\nВместе с ней удалятся её работы: ${own}.` : ''), 'Удалить', 'danger')) return;
  DB.brands = DB.brands.filter(x => x !== b); DB.items = DB.items.filter(i => i.brand !== b.id);
  await save(); render(); toast('Марка удалена');
}
async function addModel(b) {
  const r = await formBox('Новая модель ' + b.name, [{ k: 'name', label: 'Модель (например L200)' }, AKA_FIELD]); if (!r) return;
  if (b.models.some(m => m.name.toLowerCase() === r.name.toLowerCase())) return toast('Такая модель уже есть');
  b.models.push({ id: newId('m'), name: r.name, aka: r.aka }); await save(); render(); toast('Модель добавлена');
}
async function renameModel(b, m) {
  const r = await formBox('Модель', [{ k: 'name', label: 'Модель' }, AKA_FIELD], { name: m.name, aka: akaOf(m) }); if (!r) return;
  m.name = r.name; m.aka = r.aka; await save(); render();
}
async function deleteModel(b, m) {
  const own = DB.items.filter(i => i.model === m.id).length;
  if (!await confirmBox(`Удалить модель «${b.name} ${m.name}»?` + (own ? `\nВместе с ней удалятся её работы: ${own}.` : ''), 'Удалить', 'danger')) return;
  b.models = b.models.filter(x => x !== m); DB.items = DB.items.filter(i => i.model !== m.id);
  await save(); render(); toast('Модель удалена');
}

/* ---------- Правка работ ---------- */
function allGroups(works) { return [...new Set(works.map(w => w.group))].sort((a, b) => a.localeCompare(b, 'ru')); }
const workFields = groups => [
  { k: 'name', label: 'Название работы' },
  { k: 'group', label: 'Раздел (через « / », можно новый)', list: groups },
  { k: 'hours', label: 'Нормо-часы', type: 'num' },
  { k: 'price', label: 'Цена, ₽', type: 'num' },
  { k: 'note', label: 'Примечание', type: 'area' }
];
async function addWork(c, groupPrefix) {
  const where = c.brand.name + (c.model ? ' ' + c.model.name : '');
  const r = await formBox('Новая работа · ' + where, workFields(allGroups(worksFor(c.brand.id, c.model && c.model.id))), { group: groupPrefix });
  if (!r) return;
  DB.items.push({ id: newId('w'), brand: c.brand.id, model: c.model ? c.model.id : null,
    name: r.name, group: r.group || 'Прочее', hours: num(r.hours), price: num(r.price), note: r.note });
  await save(); render(); toast('Работа добавлена в «' + (r.group || 'Прочее') + '»');
}
// Объект работы, который можно менять. Для общей — спросить: только для марки (копия) или для всех.
async function editable(w, c) {
  if (w.src !== 'tpl') return DB.items.find(i => i.id === w.id);
  if (!state.allScope) state.allScope = new Set();
  let scope = state.allScope.has(w.id) ? 'all' : await ask('Это общая работа — она есть у всех марок. Что изменить?', [
    { k: 'brand', t: 'Только для ' + c.brand.name }, { k: 'all', t: 'Для всех марок' }, { k: null, t: 'Отмена' }]);
  if (!scope) return null;
  const t = DB.templates.find(x => x.id === w.id);
  if (scope === 'all') { state.allScope.add(w.id); return t; }
  const copy = { ...structuredClone(t), id: newId('w'), brand: c.brand.id, model: null, overrides: t.id };
  DB.items.push(copy); state.path[state.path.length - 1].id = copy.id; history.replaceState(navState(), '');
  return copy;
}
async function editWork(w, c) {
  const r = await formBox('Изменить работу', workFields(allGroups(worksFor(c.brand.id, c.model && c.model.id))), w); if (!r) return;
  const o = await editable(w, c); if (!o) return;
  Object.assign(o, { name: r.name, group: r.group || 'Прочее', hours: num(r.hours), price: num(r.price), note: r.note });
  await save(); render(); toast('Сохранено');
}
async function deleteWork(w, c) {
  if (w.src === 'tpl') {
    const k = await ask(`Удалить общую работу «${w.name}»?`, [
      { k: 'brand', t: 'Скрыть только у ' + c.brand.name }, { k: 'all', t: 'Удалить у всех марок', cls: 'danger' }, { k: null, t: 'Отмена' }]);
    if (!k) return;
    if (k === 'all') { DB.templates = DB.templates.filter(t => t.id !== w.id); DB.brands.forEach(b => b.hidden && (b.hidden = b.hidden.filter(x => x !== w.id))); }
    else (c.brand.hidden = c.brand.hidden || []).push(w.id);
  } else {
    if (!await confirmBox(`Удалить работу «${w.name}»?` + (w.overrides ? '\nВернётся общая версия этой работы.' : ''), 'Удалить', 'danger')) return;
    DB.items = DB.items.filter(i => i.id !== w.id);
  }
  await save(); history.back(); toast('Удалено');
}

function renderGroup(v, works, groups) {
  const prefix = groups.join(' / ');
  const inside = works.filter(w => prefix === '' || w.group === prefix || w.group.startsWith(prefix + ' / '));
  const sub = new Map(), here = [];
  for (const w of inside) {
    const rest = prefix ? w.group.slice(prefix.length).replace(/^ \/ /, '') : w.group;
    if (!rest) here.push(w);
    else { const g = rest.split(' / ')[0]; sub.set(g, (sub.get(g) || 0) + 1); }
  }
  const h = {}; let html = '';
  if (sub.size) {
    html += '<h2>Разделы</h2>' + rowsHtml([...sub].map(([g, n], i) => {
      h['g' + i] = () => go({ type: 'group', name: g });
      return { k: 'g' + i, t: esc(g), n };
    }));
  }
  if (here.length) {
    html += '<h2>Работы</h2>' + rowsHtml(here.map(w => {
      h[w.id] = () => go({ type: 'work', id: w.id });
      return { k: w.id, t: esc(w.name), s: w.hours != null ? w.hours + ' н/ч' : '' };
    }));
  }
  const c = ctx(), adds = [['work', 'Работа']];
  if (!groups.length) html = docsRow(c, h) + html;
  if (!groups.length && !c.brand.models.length) adds.push(['model', 'Модель']);
  v.innerHTML = (html || '<div class="empty">Пусто</div>') + addBtns(adds);
  bindRows(v, h);
  bindAdds(v, { work: () => addWork(c, prefix), model: () => addModel(c.brand) });
}

/* ---------- Карточка работы: инструкция, пункты, параметры ---------- */
// Отметки и введённые значения хранятся отдельно от работы — для каждой марки/модели свои
function progOf(w, c) {
  DB.progress = DB.progress || {};
  const k = c.brand.id + '|' + (c.model ? c.model.id : '') + '|' + (w.overrides || w.id);
  return DB.progress[k] = DB.progress[k] || { done: [], vals: {} };
}
function paramState(p, v) {
  const x = num(v); if (x == null) return '';
  if ((p.min != null && x < p.min) || (p.max != null && x > p.max)) return 'bad';
  return 'ok';
}
const normText = p => p.min != null && p.max != null ? `${p.min}…${p.max}` : p.min != null ? `не меньше ${p.min}` : p.max != null ? `не больше ${p.max}` : '—';

function renderWork(v, w, c) {
  if (!w) { v.innerHTML = '<div class="empty">Работа не найдена</div>'; return; }
  const src = w.src === 'tpl' ? 'общая работа (у всех марок)' : w.overrides ? 'изменена для этой марки' : w.model ? 'только для этой модели' : 'только для этой марки';
  const pr = progOf(w, c), steps = w.steps || [], params = w.params || [], ed = state.edit;
  const all = steps.flatMap(s => [s, ...(s.sub || [])]), done = all.filter(s => pr.done.includes(s.id)).length;
  const stepHtml = (s, sub, parent) => `<div class="step${sub ? ' sub' : ''}${pr.done.includes(s.id) ? ' done' : ''}">
    <label><input type="checkbox" data-chk="${s.id}" ${pr.done.includes(s.id) ? 'checked' : ''}><span>${esc(s.text)}</span></label>
    ${s.photo ? `<button class="sth" data-sph="${s.photo}" aria-label="Фото к пункту"><img data-src="${s.photo}" alt=""></button>` : ''}
    ${ed ? `${sub ? '' : `<button class="mini" data-addsub="${s.id}" aria-label="Подпункт">+</button>`}<button class="mini" data-es="${s.id}" data-p="${parent || ''}" aria-label="Изменить">✎</button><button class="mini del" data-ds="${s.id}" data-p="${parent || ''}" aria-label="Удалить">✕</button>` : ''}</div>`;
  v.innerHTML = `<div class="card"><h1>${esc(w.name)}</h1>
    <div class="meta">${esc(c.brand.name)}${c.model ? ' ' + esc(c.model.name) : ''} · ${esc(w.group)}${w.hours != null ? ' · ' + w.hours + ' н/ч' : ''}${w.price != null ? ' · ' + w.price + ' ₽' : ''}</div>
    ${w.note ? `<div class="note">${esc(w.note)}</div>` : ''}
    <div class="sec"><h2>Инструкция</h2>${ed ? '<button class="mini" id="eInstr" aria-label="Изменить инструкцию">✎</button>' : ''}</div>
    <div class="instr">${w.instr ? esc(w.instr).replace(/\n/g, '<br>') : '<span class="muted">Нет. Нажмите «Править», чтобы добавить: куда войти, что сделать.</span>'}</div>
    <div class="sec"><h2>Пункты ${all.length ? done + ' / ' + all.length : ''}</h2></div>
    <div class="steps">${steps.map(s => stepHtml(s, false) + (s.sub || []).map(x => stepHtml(x, true, s.id)).join('')).join('') || '<div class="muted">Пунктов нет</div>'}</div>
    ${ed ? '<button class="add" id="aStep">+ Пункт</button>' : ''}
    <div class="sec"><h2>Параметры</h2></div>
    ${params.length ? `<div class="params">${params.map(p => `<div class="prm ${paramState(p, pr.vals[p.id])}">
      <div class="pn">${esc(p.name)}<div class="s">норма: ${normText(p)} ${esc(p.unit || '')}</div></div>
      <input data-val="${p.id}" value="${esc(pr.vals[p.id] ?? '')}" inputmode="decimal" placeholder="значение" aria-label="${esc(p.name)}">
      ${ed ? `<button class="mini" data-ep="${p.id}" aria-label="Изменить">✎</button><button class="mini del" data-dp="${p.id}" aria-label="Удалить">✕</button>` : ''}</div>`).join('')}</div>` : '<div class="muted">Параметров нет</div>'}
    ${ed ? '<button class="add" id="aParam">+ Параметр</button>' : ''}
    ${workCodesHtml(w, ed)}
    ${photosHtml(w)}
    <div class="meta">Источник: ${src}</div>
    <div class="btns"><button id="wMode" class="pri">${ed ? 'Готово' : 'Править'}</button><button id="wReset">Сбросить отметки</button></div>
    <div class="btns"><button id="wEdit">Название, раздел, норма</button><button id="wDel" class="danger">Удалить работу</button></div></div>`;
  $('#wEdit').onclick = () => editWork(w, c);
  $('#wDel').onclick = () => deleteWork(w, c);
  $('#wMode').onclick = () => { state.edit = !ed; render(); };
  $('#wReset').onclick = async () => { if (await confirmBox('Снять все отметки и очистить значения?', 'Сбросить')) { pr.done = []; pr.vals = {}; await save(); render(); } };
  v.querySelectorAll('[data-chk]').forEach(b => b.onchange = async () => {
    const id = b.dataset.chk; pr.done = pr.done.filter(x => x !== id); if (b.checked) pr.done.push(id); await save(); render();
  });
  v.querySelectorAll('[data-val]').forEach(i => i.onchange = async () => { pr.vals[i.dataset.val] = i.value.trim(); await save(); render(); });
  // правка структуры — через editable(): общая работа спросит «для марки / для всех»
  const mut = async fn => { const o = await editable(w, c); if (!o) return; o.steps = o.steps || []; o.params = o.params || []; fn(o); await save(); render(); };
  const stepIn = (o, id, p) => p ? o.steps.find(s => s.id === p).sub : o.steps;
  bindPhotos(v, w, c, mut);
  bindWorkCodes(v, w, c, mut);
  v.querySelectorAll('[data-sph]').forEach(b => b.onclick = () => viewPhoto(w, (w.photos || []).findIndex(p => p.id === b.dataset.sph), mut));
  if (!ed) return;
  $('#eInstr').onclick = async () => { const r = await formBox('Инструкция', [{ k: 'instr', label: 'Куда войти, что сделать, на что смотреть', type: 'area' }], w); if (r) mut(o => o.instr = r.instr); };
  $('#aStep').onclick = async () => { const r = await formBox('Новый пункт', [{ k: 'text', label: 'Пункт' }]); if (r) mut(o => o.steps.push({ id: newId('s'), text: r.text, sub: [] })); };
  v.querySelectorAll('[data-addsub]').forEach(b => b.onclick = async () => { const r = await formBox('Новый подпункт', [{ k: 'text', label: 'Подпункт' }]); if (r) mut(o => { const s = o.steps.find(x => x.id === b.dataset.addsub); (s.sub = s.sub || []).push({ id: newId('s'), text: r.text }); }); });
  v.querySelectorAll('[data-es]').forEach(b => b.onclick = async () => { const list = stepIn(w, b.dataset.es, b.dataset.p), s = list.find(x => x.id === b.dataset.es); const r = await formBox('Изменить пункт', [{ k: 'text', label: 'Пункт' }], s); if (r) mut(o => stepIn(o, 0, b.dataset.p).find(x => x.id === b.dataset.es).text = r.text); });
  v.querySelectorAll('[data-ds]').forEach(b => b.onclick = async () => { if (await confirmBox('Удалить пункт' + (b.dataset.p ? '' : ' вместе с подпунктами') + '?', 'Удалить', 'danger')) mut(o => { const l = stepIn(o, 0, b.dataset.p); l.splice(l.findIndex(x => x.id === b.dataset.ds), 1); }); });
  const pf = [{ k: 'name', label: 'Параметр (например «Сажа, г»)' }, { k: 'min', label: 'Норма от', type: 'num' }, { k: 'max', label: 'Норма до', type: 'num' }, { k: 'unit', label: 'Ед. изм.' }];
  const pdata = r => ({ name: r.name, min: num(r.min), max: num(r.max), unit: r.unit });
  $('#aParam').onclick = async () => { const r = await formBox('Новый параметр', pf); if (r) mut(o => o.params.push({ id: newId('p'), ...pdata(r) })); };
  v.querySelectorAll('[data-ep]').forEach(b => b.onclick = async () => { const r = await formBox('Изменить параметр', pf, params.find(p => p.id === b.dataset.ep)); if (r) mut(o => Object.assign(o.params.find(p => p.id === b.dataset.ep), pdata(r))); });
  v.querySelectorAll('[data-dp]').forEach(b => b.onclick = async () => { if (await confirmBox('Удалить параметр?', 'Удалить', 'danger')) mut(o => o.params.splice(o.params.findIndex(p => p.id === b.dataset.dp), 1)); });
}

/* ---------- Поиск: марки, модели, работы; понимает другую раскладку (0.5.0) ---------- */
const LAT = "qwertyuiop[]asdfghjkl;'zxcvbnm,.`", CYR = 'йцукенгшщзхъфывапролджэячсмитьбюё';
const altLayout = s => [...s].map(ch => { let i = LAT.indexOf(ch); if (i >= 0) return CYR[i]; i = CYR.indexOf(ch); return i >= 0 ? LAT[i] : ch; }).join('');
// Русские буквы, похожие на латинские: «х50» → «x50»
const LOOK = { 'а': 'a', 'в': 'b', 'е': 'e', 'к': 'k', 'м': 'm', 'н': 'h', 'о': 'o', 'р': 'p', 'с': 'c', 'т': 't', 'у': 'y', 'х': 'x' };
const lookLat = s => [...s].map(ch => LOOK[ch] || ch).join('');
const norm = s => String(s || '').toLowerCase().replace(/ё/g, 'е');
// Варианты запроса: как набрано, в другой раскладке, с похожими латинскими буквами
const qVariants = q => [...new Set([q, altLayout(q), lookLat(q)].map(norm))];
const hasAny = (vs, s) => { s = norm(s); return vs.some(v => s.includes(v)); };

/* ---------- Другие названия марок и моделей (0.5.1) ---------- */
const AKA_FIELD = { k: 'aka', label: 'Другие названия для поиска (через запятую)' };
const DEFAULT_AKA = {
  'Lada': 'лада, ваз, жигули, приора, веста, гранта, нива, калина, ларгус', 'Haval': 'хавал, хавейл, хавэйл', 'Chery': 'чери, черри',
  'Geely': 'джили, джилли', 'Changan': 'чанган, чанъань', 'Exeed': 'эксид, иксид', 'Omoda': 'омода', 'Jaecoo': 'джейку, джеку',
  'Tank': 'танк', 'JAC': 'джак', 'Belgee': 'белджи', 'Tenet': 'тенет', 'Solaris': 'солярис', 'Moskvich': 'москвич', 'GAC': 'гак',
  'FAW': 'фав', 'Dongfeng': 'донгфенг, дунфэн', 'BAIC': 'баик', 'Li Auto': 'ли авто, лисян, lixiang', 'Zeekr': 'зикр, зекр',
  'Voyah': 'воя, вояж', 'Kia': 'киа', 'Hyundai': 'хендай, хундай, хёндай, хюндай, хендэ', 'Toyota': 'тойота', 'Lexus': 'лексус',
  'Nissan': 'ниссан', 'Mitsubishi': 'митсубиси, мицубиси, мицубиши, митсубиши, мица, митсу', 'Mazda': 'мазда', 'Honda': 'хонда',
  'Subaru': 'субару', 'Suzuki': 'сузуки', 'Volkswagen': 'фольксваген, фольц, фольк, вв, vw', 'Skoda': 'шкода', 'Audi': 'ауди',
  'BMW': 'бмв, бумер', 'Mercedes-Benz': 'мерседес, мерс, бенц', 'Volvo': 'вольво', 'Renault': 'рено', 'Ford': 'форд',
  'Chevrolet': 'шевроле, шеви', 'Opel': 'опель', 'Peugeot': 'пежо', 'Citroen': 'ситроен', 'Land Rover': 'ленд ровер, лэнд ровер, рендж, range rover',
  'Porsche': 'порше', 'UAZ': 'уаз, буханка, патриот, хантер', 'GAZ': 'газ, газель, соболь', 'Jetour': 'джетур, жетур'
};
const akaOf = x => x.aka != null ? x.aka : (DEFAULT_AKA[x.name] || '');

function brandModelHits(vs, hl, h) {
  const rows = [];
  for (const b of DB.brands) {
    const byName = hasAny(vs, b.name), byAka = !byName && hasAny(vs, akaOf(b));
    if (byName || byAka) { h['sb' + b.id] = () => goPath([{ type: 'brand', id: b.id }]); rows.push({ k: 'sb' + b.id, t: hl(b.name), s: (byAka ? hl(akaOf(b)) + ' · ' : '') + (b.models.length ? b.models.map(m => esc(m.name)).join(', ') : 'марка') }); }
    for (const m of b.models) if (hasAny(vs, m.name) || hasAny(vs, akaOf(m)) || hasAny(vs, b.name + ' ' + m.name)) {
      h['sm' + m.id] = () => goPath([{ type: 'brand', id: b.id }, { type: 'model', id: m.id }]);
      rows.push({ k: 'sm' + m.id, t: hl(m.name), s: 'модель · ' + esc(b.name) });
    }
  }
  return rows.length ? '<h2>Марки и модели</h2>' + rowsHtml(rows) : '';
}
function renderSearch(v, c, q) {
  const vs = qVariants(q), has = s => hasAny(vs, s);
  const rx = new RegExp(vs.map(x => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/е/g, '[её]')).join('|'), 'gi');
  const hl = s => esc(s).replace(rx, m => `<mark>${m}</mark>`);
  const h = {}; let html = '';
  if (!c.brand) {
    html += caseHits(has, hl, h) + brandModelHits(vs, hl, h);
    const ws = DB.templates.filter(t => has(t.name)).slice(0, 100);
    html += codeHits(q, hl, h);
    if (ws.length) html += '<h2>Общие работы</h2>' + rowsHtml(ws.map(w => { h[w.id] = () => {}; return { k: w.id, t: hl(w.name), s: esc(w.group) }; })) + '<p class="s" style="color:var(--muted);padding:8px 4px">Выберите марку, чтобы открыть работу.</p>';
  } else {
    const base = state.path.filter(p => p.type === 'brand' || p.type === 'model');
    const ws = worksFor(c.brand.id, c.model && c.model.id).filter(w => has(w.name + ' ' + w.group)).slice(0, 200);
    if (ws.length) html += '<h2>Работы ' + esc(c.brand.name) + (c.model ? ' ' + esc(c.model.name) : '') + ': ' + ws.length + '</h2>' + rowsHtml(ws.map(w => {
      h[w.id] = () => goPath(base.concat({ type: 'work', id: w.id }));
      return { k: w.id, t: hl(w.name), s: esc(w.group) };
    }));
    html += codeHits(q, hl, h) + caseHits(has, hl, h) + brandModelHits(vs, hl, h);
  }
  v.innerHTML = html || '<div class="empty">Ничего не найдено</div>';
  bindRows(v, h);
}

/* ---------- Где я был: продолжить, недавние, прокрутка (0.5.0) ---------- */
const LS = { get(k, d) { try { const v = localStorage.getItem(APP.ls + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(APP.ls + k, JSON.stringify(v)); } catch (e) {} } };
const pkey = p => JSON.stringify(p || state.path);
let scrolls = LS.get('scroll', {});
function saveScroll() {
  if ($('#q').value) return;
  scrolls[pkey()] = Math.round(window.scrollY);
  const ks = Object.keys(scrolls); if (ks.length > 40) delete scrolls[ks[0]];
  LS.set('scroll', scrolls);
}
function restoreScroll() { const y = scrolls[pkey()] || 0; requestAnimationFrame(() => window.scrollTo(0, y)); }
let scrollT; window.addEventListener('scroll', () => { clearTimeout(scrollT); scrollT = setTimeout(saveScroll, 300); }, { passive: true });
function remember(c) {
  if (!state.path.length) return;
  LS.set('last', state.path);
  if (c.work) { const k = pkey(); LS.set('recent', [state.path].concat(LS.get('recent', []).filter(p => pkey(p) !== k)).slice(0, 6)); }
}
// Название места по пути; null — если марка/модель/работа уже удалены
// Строка «📚 Документация» вверху марки/модели, если для неё есть техдок
// и «🛢 ТО и жидкости» (to.js) — всегда
function docsRow(c, h) {
  const n = docsFor(c).length, rows = [];
  if (n) { h.qdocs = () => go({ type: 'docs' }); rows.push({ k: 'qdocs', t: '📚 Документация', s: 'техдок: ' + n + ' · поиск до страницы' }); }
  h.qto = () => go({ type: 'to' }); rows.push({ k: 'qto', t: '🛢 ТО и жидкости', s: toSub(c) });
  return rowsHtml(rows);
}
function pathInfo(p) {
  const tl = p && p[p.length - 1];
  if (tl && (tl.type === 'codes' || tl.type === 'code')) {
    if (tl.type === 'code' && String(tl.id).startsWith('dtc:')) return { t: tl.id.slice(4) + ' (из мануала)', s: 'ошибки сканера' };
    const x = tl.type === 'code' && codesDB().find(e => e.id === tl.id); if (tl.type === 'code' && !x) return null;
    return { t: x ? x.code + ' ' + (x.title || '') : 'Ошибки сканера', s: 'ошибки сканера' };
  }
  if (tl && tl.type === 'to') {
    const b = p[0] && p[0].type === 'brand' && findBrand(p[0].id), m = b && p[1] && p[1].type === 'model' && p[1].id && findModel(b, p[1].id);
    return b ? { t: 'ТО и жидкости', s: [b.name, m && m.name].filter(Boolean).join(' › ') } : null;
  }
  if (tl && (tl.type === 'docs' || tl.type === 'doc')) {
    const d = tl.type === 'doc' && docsAll().find(e => e.id === tl.id); if (tl.type === 'doc' && !d) return null;
    const b = p[0] && p[0].type === 'brand' && findBrand(p[0].id), m = b && p[1] && p[1].type === 'model' && p[1].id && findModel(b, p[1].id);
    return { t: d ? d.title : 'Документация', s: [b && b.name, m && m.name, 'документация'].filter(Boolean).join(' › ') };
  }
  const b = p && p[0] && p[0].type === 'brand' && findBrand(p[0].id); if (!b) return null;
  const parts = [b.name]; let m = null;
  for (const s of p.slice(1)) {
    if (s.type === 'model') { if (s.id) { m = findModel(b, s.id); if (!m) return null; parts.push(m.name); } else parts.push('Все модели'); }
    else if (s.type === 'group') parts.push(s.name);
    else if (s.type === 'work') { const w = worksFor(b.id, m && m.id).find(x => x.id === s.id); return w ? { t: w.name, s: parts.join(' › ') } : null; }
  }
  return { t: parts[parts.length - 1], s: parts.slice(0, -1).join(' › ') };
}
function quickHtml(h) {
  h.qcodes = () => go({ type: 'codes' });
  h.qimp = importInstruction; h.qcase = quickCase; // case.js
  let html = backupHtml(h) + rowsHtml([{ k: 'qcase', t: '⚡ Быстрый случай', s: 'симптом, причина, артикул, фото — за минуту' },{ k: 'qcodes', t: '⚠ Ошибки сканера', s: 'записано кодов: ' + codesDB().length + ' · ввести код и увидеть решение' },
    { k: 'qimp', t: '📄 Загрузить инструкцию', s: 'PDF, фото листов или файл работы — разложится само' }]);
  const last = LS.get('last', null), li = pathInfo(last);
  if (li) { h.qlast = () => goPath(last); html += '<h2>Продолжить</h2><div class="cont">' + rowsHtml([{ k: 'qlast', t: '▶ ' + esc(li.t), s: esc(li.s) }]) + '</div>'; }
  const rec = LS.get('recent', []).filter(p => pkey(p) !== pkey(last)).map(p => [p, pathInfo(p)]).filter(x => x[1]).slice(0, 5);
  if (rec.length) html += '<h2>Недавние работы</h2>' + rowsHtml(rec.map(([p, i], n) => { h['qr' + n] = () => goPath(p); return { k: 'qr' + n, t: esc(i.t), s: esc(i.s) }; }));
  return html;
}

/* ---------- Навигация ---------- */
// В истории браузера хранится весь путь — «Назад» на телефоне идёт по шагам, «Домой» и «Продолжить» не ломают его
const navState = () => ({ p: structuredClone(state.path) });
function go(step) { saveScroll(); state.path.push(step); history.pushState(navState(), ''); render(); window.scrollTo(0, 0); }
function goPath(p) { saveScroll(); $('#q').value = ''; state.path = structuredClone(p); history.pushState(navState(), ''); render(); restoreScroll(); }
function back() { saveScroll(); const st = history.state; state.path = st && Array.isArray(st.p) ? structuredClone(st.p) : []; render(); restoreScroll(); }
window.addEventListener('popstate', back);
$('#btnBack').onclick = () => history.back();
$('#btnHome').onclick = () => { if (state.path.length || $('#q').value) goPath([]); };
$('#q').oninput = render;

/* ---------- Меню: резервная копия ---------- */
const menu = $('#menu');
$('#btnMenu').onclick = () => menu.hidden = !menu.hidden;
menu.onclick = async e => {
  const act = e.target.dataset.act; if (!act) return;
  menu.hidden = true;
  if (act === 'export') exportBackup();
  if (act === 'import') $('#file').click();
  if (act === 'edit') { state.edit = !state.edit; render(); toast(state.edit ? 'Режим правки: ✎ переименовать, ✕ удалить' : 'Режим правки выключен'); }
  if (act === 'reset' && await confirmBox('Сбросить базу к исходной? Все изменения будут потеряны. Сначала сохраните резервную копию.', 'Сбросить', 'danger')) {
    DB = structuredClone(window.BASE_DB); await save(); state.path = []; render(); toast('База сброшена');
  }
  if (act === 'memory') memoryScreen();
  if (act === 'importw') importInstruction();
  if (act === 'codes') goPath(state.path.filter(p => p.type === 'brand' || p.type === 'model').concat({ type: 'codes' }));
  if (act === 'about') toast(APP.name + ' v' + APP_VERSION + ' · марок: ' + DB.brands.length + ' · общих работ: ' + DB.templates.length);
};

async function exportBackup() {
  const ids = await photoKeys();
  let photoData;
  if (ids.length) {
    const mb = (await photoSizes()).reduce((a, x) => a + x.size, 0) / 1048576;
    const k = await ask(`В базе ${ids.length} фото (${mb.toFixed(1)} МБ). Сохранить копию с фото?`, [
      { k: 'with', t: 'С фото' }, { k: 'without', t: 'Только записи (без фото)' }, { k: null, t: 'Отмена' }]);
    if (!k) return;
    if (k === 'with') { photoData = {}; for (const id of ids) photoData[id] = await blobToData(await Store.get(id, 'photos')); }
  }
  // свои документы техдока: заголовки страниц всегда, PDF внутри программы — вместе с фото
  const docPagesData = (await Store.get('docpages')) || undefined;
  let fileData;
  const fdocs = (DB.docsUser || []).filter(d => d.blob);
  if (fdocs.length && (photoData || !ids.length) && await confirmBox(`Добавить в копию документы, которые хранятся внутри программы (${fdocs.length} шт.)?`, 'Да, добавить')) { fileData = {}; for (const d of fdocs) { const b = await Store.get('docf_' + d.id, 'files'); if (b) fileData['docf_' + d.id] = await blobToData(b); } }
  const d = new Date(), pad = n => String(n).padStart(2, '0');
  const name = `справочник_бэкап_${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}.json`;
  const blob = new Blob([JSON.stringify({ ...DB, exported: d.toISOString(), appVersion: APP_VERSION, photoData, fileData, docPagesData }, null, 1)], { type: 'application/json' });
  if (!(await deliverFile(blob, name))) return; // backup.js: ПК — «Сохранить как», iPhone — «Поделиться»
  bkDone(); toast('Копия сохранена: ' + name); render();
}

$('#file').onchange = async e => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  try {
    const d = JSON.parse(await f.text());
    if (!validDB(d)) throw new Error('не тот формат');
    if (!await confirmBox(`Загрузить копию «${f.name}»?\nМарок: ${d.brands.length}, своих работ: ${d.items.length}.\nТекущая база будет заменена.`, 'Загрузить')) return;
    if (d.photoData) for (const [id, data] of Object.entries(d.photoData)) await Store.set(id, await (await fetch(data)).blob(), 'photos');
    if (d.fileData) for (const [id, data] of Object.entries(d.fileData)) await Store.set(id, await (await fetch(data)).blob(), 'files');
    if (d.docPagesData) { await Store.set('docpages', d.docPagesData); userPages = null; }
    delete d.exported; delete d.appVersion; delete d.photoData; delete d.fileData; delete d.docPagesData;
    DB = d; await save(); LS.set('bkChanges', 0); LS.set('bkFirstChange', 0); state.path = []; render(); toast('Резервная копия загружена');
  } catch (err) { ask('Не удалось загрузить файл: ' + err.message, [{ k: 1, t: 'Понятно' }]); }
};

/* ---------- Напоминание для iPhone: без экрана «Домой» Safari может стереть данные ---------- */
function homeScreenHint() {
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = navigator.standalone || (window.matchMedia && matchMedia('(display-mode: standalone)').matches);
  if (standalone) { try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch (e) {} return; }
  if (!ios) return;
  const b = document.createElement('div'); b.className = 'hsb';
  b.innerHTML = '<b>Добавьте программу на экран «Домой»</b>, иначе iPhone может стереть базу и фото, если долго не открывать. ' +
    'Safari → кнопка «Поделиться» → «На экран Домой». <button>Понятно</button>';
  b.querySelector('button').onclick = () => b.remove(); // напомнит снова при следующем запуске
  document.querySelector('main').before(b);
}

/* ---------- Запуск ---------- */
(async function init() {
  history.replaceState(navState(), '');
  await Store.open();
  const saved = await Store.get('db');
  DB = validDB(saved) ? saved : structuredClone(window.BASE_DB);
  if (!saved) { await save(); LS.set('bkChanges', 0); LS.set('bkFirstChange', 0); } // первый запуск — не изменение
  render();
  homeScreenHint();
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
