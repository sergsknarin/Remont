/* Справочник ремонта — ошибки сканера (0.6.0): код → описание → решения по маркам/моделям */
'use strict';

// Код с любой раскладкой и похожими буквами: «з2002», «Р2002», «p 2002» → «P2002»
const CODE_FIRST = { 'р': 'P', 'з': 'P', 'с': 'C', 'в': 'B', 'и': 'B', 'г': 'U', 'у': 'U' };
function codeNorm(s) {
  s = String(s || '').trim().toLowerCase().replace(/[\s\-–]/g, '');
  return [...s].map((ch, i) => (i === 0 && CODE_FIRST[ch]) || (CYR.includes(ch) ? LAT[CYR.indexOf(ch)] : ch)).join('').toUpperCase();
}
const codesDB = () => (DB.codes = DB.codes || []);
const findCode = code => codesDB().find(x => x.code === code);
const carName = (bId, mId) => { const b = findBrand(bId); if (!b) return ''; const m = mId && findModel(b, mId); return b.name + (m ? ' ' + m.name : ''); };
// Решение подходит текущей машине: 2 — та же модель, 1 — та же марка
const solRank = (s, c) => !c.brand || s.brand !== c.brand.id ? 0 : (c.model && s.model === c.model.id ? 2 : s.model ? 0.5 : 1);
const okBadge = ok => ok === true ? '<span class="ok">✓ помогло</span>' : ok === false ? '<span class="bad">✗ не помогло</span>' : '<span class="muted">? не проверено</span>';

/* ---------- Список ошибок ---------- */
function renderCodes(v, c) {
  if (!ERR && !errFailed) { v.innerHTML = '<div class="empty">Загружаю базу кодов из мануалов Jetour…</div>'; loadErrDb().then(render, () => { errFailed = true; render(); }); return; }
  migrateErrNotes();
  const car = c.brand ? carName(c.brand.id, c.model && c.model.id) : '';
  v.innerHTML = `<h2>Ошибки сканера${car ? ' · ' + esc(car) : ''}</h2>
    <div class="codein"><input id="codeQ" placeholder="Код или слово, например P2002" autocomplete="off" autocapitalize="characters"><button id="codeGo" class="pri">Открыть</button></div>
    <div id="codeList"></div>`;
  const inp = $('#codeQ'), list = $('#codeList');
  const draw = () => {
    const raw = inp.value.trim(), cq = codeNorm(raw), vs = raw ? qVariants(raw.toLowerCase()) : null;
    let items = codesDB().filter(x => !raw || x.code.includes(cq) || hasAny(vs, x.title + ' ' + (x.sys || '') + ' ' + x.sols.map(s => s.text).join(' ')));
    const rank = x => Math.max(0, ...x.sols.map(s => solRank(s, c)));
    items.sort((a, b) => rank(b) - rank(a) || (b.seen || 0) - (a.seen || 0) || a.code.localeCompare(b.code));
    const h = {};
    let html = '';
    if (raw && cq.length >= 4 && /^[PCBU][0-9A-F]/.test(cq) && !findCode(cq)) html += `<button class="add" id="codeNew">+ Записать новую ошибку ${esc(cq)}</button>`;
    html += items.length ? rowsHtml(items.slice(0, 200).map(x => {
      h[x.id] = () => go({ type: 'code', id: x.id });
      const mine = rank(x) >= 1 ? ' · <b>есть решение для этой машины</b>' : '';
      return { k: x.id, t: '<b>' + esc(x.code) + '</b> ' + esc(x.title || ''), s: `решений: ${x.sols.length}${x.seen ? ' · встречалась ' + x.seen : ''}${mine}` };
    })) : `<div class="empty">${raw ? 'В ваших записях такой ошибки нет' : 'Своих записей пока нет. Введите код с экрана сканера.'}</div>`;
    html += dtcListHtml(raw, cq, c, h);
    list.innerHTML = html; bindRows(list, h);
    const nb = $('#codeNew'); if (nb) nb.onclick = () => newCode(cq, c);
  };
  inp.oninput = draw;
  $('#codeGo').onclick = () => { const cq = codeNorm(inp.value); if (!cq) return inp.focus(); const x = findCode(cq); x ? go({ type: 'code', id: x.id }) : ERR && ERR.codes[cq] ? go({ type: 'code', id: 'dtc:' + cq }) : newCode(cq, c); };
  inp.onkeydown = e => { if (e.key === 'Enter') $('#codeGo').click(); };
  draw();
  if (!('ontouchstart' in window)) inp.focus();
}

const codeFields = [{ k: 'code', label: 'Код (P2002)' }, { k: 'title', label: 'Описание (что пишет сканер)' }, { k: 'sys', label: 'Блок / система (необязательно)' }];
async function newCode(code, c) {
  const r = await formBox('Новая ошибка', codeFields, { code, title: dtcDesc(code) }); if (!r) return;
  const cd = codeNorm(r.code); if (findCode(cd)) { toast('Такой код уже есть'); return go({ type: 'code', id: findCode(cd).id }); }
  const x = { id: newId('e'), code: cd, title: r.title, sys: r.sys, sols: [], seen: 1, added: new Date().toISOString() };
  codesDB().push(x); await save(); go({ type: 'code', id: x.id }); toast('Ошибка записана. Добавьте, как устранили.');
}

/* ---------- Карточка ошибки ---------- */
function renderCode(v, c, id) {
  if (!ERR && !errFailed) { v.innerHTML = '<div class="empty">Загружаю базу кодов…</div>'; loadErrDb().then(render, () => { errFailed = true; render(); }); return; }
  if (id.startsWith('dtc:')) {   // код только из мануалов — своих записей ещё нет
    const code = id.slice(4), own = findCode(code);
    if (own) { state.path[state.path.length - 1].id = own.id; history.replaceState(navState(), ''); return render(); }
    v.innerHTML = `<div class="card"><h1>${esc(code)}</h1><div class="meta">${esc(dtcDesc(code) || 'нет в мануалах Jetour')}</div>
      <div class="muted">Своих решений пока нет. Запишите, как устранили, — в следующий раз будет подсказка.</div>
      <button class="add" id="cSol">+ Решение</button></div>${dtcCardHtml(code, c)}`;
    $('#cSol').onclick = async () => {
      const x = { id: newId('e'), code, title: dtcDesc(code), sys: '', sols: [], seen: 1, added: new Date().toISOString() };
      codesDB().push(x); state.path[state.path.length - 1].id = x.id; history.replaceState(navState(), ''); await save(); editSol(x, null, c);
    };
    return bindDtcRefs(v);
  }
  const x = codesDB().find(e => e.id === id);
  if (!x) { v.innerHTML = '<div class="empty">Ошибка не найдена</div>'; return; }
  const sols = x.sols.map((s, i) => ({ s, i })).sort((a, b) => solRank(b.s, c) - solRank(a.s, c) || (b.s.ok === true) - (a.s.ok === true) || String(b.s.date).localeCompare(String(a.s.date)));
  const works = workLinks(x.code, c);
  v.innerHTML = `<div class="card"><h1>${esc(x.code)}</h1>
    <div class="meta">${esc(x.title || 'без описания')}${x.sys ? ' · ' + esc(x.sys) : ''}</div>
    <div class="meta">Встречалась: ${x.seen || 0} раз <button class="mini" id="cSeen" aria-label="Ещё раз встретилась" title="Ещё раз встретилась">+1</button></div>
    <div class="sec"><h2>Как устранить ${x.sols.length || ''}</h2></div>
    ${sols.length ? sols.map(({ s }) => `<div class="sol${solRank(s, c) >= 1 ? ' mine' : ''}">
      <div class="st">${esc(s.text).replace(/\n/g, '<br>')}</div>
      <div class="meta">${esc(carName(s.brand, s.model) || s.car || 'все машины')} · ${esc(s.date || '')} · <button class="okb" data-ok="${s.id}">${okBadge(s.ok)}</button>
      <button class="mini" data-es="${s.id}" aria-label="Изменить">✎</button><button class="mini del" data-ds="${s.id}" aria-label="Удалить">✕</button></div></div>`).join('')
      : '<div class="muted">Решений пока нет. Запишите, что сделали.</div>'}
    <button class="add" id="cSol">+ Решение</button>
    ${works.length ? '<div class="sec"><h2>Связанные работы</h2></div>' + rowsHtml(works.map((w, i) => ({ k: 'w' + i, t: esc(w.name), s: esc(w.group) }))) : ''}
    <div class="btns"><button id="cEdit">Код и описание</button><button id="cDel" class="danger">Удалить ошибку</button></div></div>${dtcCardHtml(x.code, c)}`;
  bindDtcRefs(v);
  const h = {}; works.forEach((w, i) => h['w' + i] = () => goPath(state.path.filter(p => p.type === 'brand' || p.type === 'model').concat({ type: 'work', id: w.id })));
  bindRows(v, h);
  const S = sid => x.sols.find(s => s.id === sid);
  $('#cSeen').onclick = async () => { x.seen = (x.seen || 0) + 1; await save(); render(); };
  $('#cSol').onclick = () => editSol(x, null, c);
  v.querySelectorAll('[data-es]').forEach(b => b.onclick = () => editSol(x, S(b.dataset.es), c));
  v.querySelectorAll('[data-ds]').forEach(b => b.onclick = async () => { if (await confirmBox('Удалить это решение?', 'Удалить', 'danger')) { x.sols = x.sols.filter(s => s.id !== b.dataset.ds); await save(); render(); } });
  v.querySelectorAll('[data-ok]').forEach(b => b.onclick = async () => { const s = S(b.dataset.ok); s.ok = s.ok === true ? false : s.ok === false ? null : true; await save(); render(); });
  $('#cEdit').onclick = async () => {
    const r = await formBox('Ошибка', codeFields, x); if (!r) return;
    const cd = codeNorm(r.code); if (cd !== x.code && findCode(cd)) return toast('Код ' + cd + ' уже есть');
    Object.assign(x, { code: cd, title: r.title, sys: r.sys }); await save(); render();
  };
  $('#cDel').onclick = async () => { if (await confirmBox(`Удалить ошибку ${x.code} вместе с решениями (${x.sols.length})?`, 'Удалить', 'danger')) { DB.codes = codesDB().filter(e => e !== x); await save(); history.back(); toast('Удалено'); } };
}

// Машины для выбора: «Марка» и «Марка Модель»
function carList() { return DB.brands.flatMap(b => [b.name].concat(b.models.map(m => b.name + ' ' + m.name))); }
function carFromText(t) {
  t = norm(t).trim(); if (!t) return {};
  for (const b of DB.brands) {
    for (const m of b.models) if (norm(b.name + ' ' + m.name) === t) return { brand: b.id, model: m.id };
    if (norm(b.name) === t) return { brand: b.id, model: null };
  }
  return { car: t };
}
async function editSol(x, s, c) {
  const cur = s ? (carName(s.brand, s.model) || s.car || '') : (c.brand ? carName(c.brand.id, c.model && c.model.id) : '');
  const r = await formBox(s ? 'Изменить решение · ' + x.code : 'Как устранили ' + x.code, [
    { k: 'text', label: 'Что сделали (по шагам, что помогло)', type: 'area' },
    { k: 'car', label: 'Машина (пусто — для всех)', list: carList() }], { text: s ? s.text : '', car: cur });
  if (!r) return;
  let ok = s ? s.ok : await ask('Помогло?', [{ k: true, t: '✓ Да, ошибка ушла' }, { k: false, t: '✗ Нет' }, { k: 'n', t: 'Пока не знаю' }]);
  if (ok === 'n' || ok === undefined) ok = null;
  const car = carFromText(r.car), d = new Date();
  const data = { text: r.text, brand: car.brand || null, model: car.model || null, car: car.car || '' };
  if (s) Object.assign(s, data);
  else x.sols.push({ id: newId('r'), ...data, ok, date: d.toLocaleDateString('ru-RU') });
  await save(); render(); toast('Решение сохранено');
}

/* ---------- Связь с работами ---------- */
function workLinks(code, c) {
  if (!c.brand) return DB.templates.filter(w => (w.codes || []).includes(code)).map(w => ({ ...w, src: 'tpl' }));
  return worksFor(c.brand.id, c.model && c.model.id).filter(w => (w.codes || []).includes(code));
}
function workCodesHtml(w, ed) {
  const list = w.codes || [];
  return `<div class="sec"><h2>Ошибки сканера ${list.length || ''}</h2></div>
    <div class="chips">${list.map(cd => { const x = findCode(cd); return `<button class="chip" data-code="${esc(cd)}">${esc(cd)}${x ? ' · ' + x.sols.length + ' реш.' : ''}</button>${ed ? `<button class="mini del" data-uncode="${esc(cd)}" aria-label="Отвязать">✕</button>` : ''}`; }).join('')}
    ${ed ? '<button class="chip add" id="aCode">+ Код</button>' : ''}</div>
    <button class="add" id="openCodes">Проверить сканером: ошибки и решения</button>`;
}
function bindWorkCodes(v, w, c, mut) {
  $('#openCodes').onclick = () => go({ type: 'codes' });
  v.querySelectorAll('[data-code]').forEach(b => b.onclick = () => { const x = findCode(b.dataset.code); x ? go({ type: 'code', id: x.id }) : newCode(b.dataset.code, c); });
  v.querySelectorAll('[data-uncode]').forEach(b => b.onclick = () => mut(o => { o.codes = (o.codes || []).filter(x => x !== b.dataset.uncode); }));
  const a = $('#aCode'); if (a) a.onclick = async () => {
    const r = await formBox('Привязать код к работе', [{ k: 'code', label: 'Код (можно несколько через запятую)', list: codesDB().map(x => x.code) }]); if (!r) return;
    const add = r.code.split(/[,;]/).map(codeNorm).filter(Boolean);
    mut(o => { o.codes = [...new Set((o.codes || []).concat(add))]; });
  };
}

/* ---------- Для общего поиска ---------- */
function codeHits(q, hl, h) {
  const dtc = ERR ? dtcListHtml(q, codeNorm(q), ctx(), h, 20) : '';
  const cq = codeNorm(q), vs = qVariants(q);
  const xs = codesDB().filter(x => (cq.length >= 2 && x.code.includes(cq)) || hasAny(vs, x.title || '')).slice(0, 30);
  xs.forEach(x => h['sc' + x.id] = () => goPath(state.path.filter(p => p.type === 'brand' || p.type === 'model').concat({ type: 'code', id: x.id })));
  return (xs.length ? '<h2>Ошибки сканера</h2>' + rowsHtml(xs.map(x => ({ k: 'sc' + x.id, t: '<b>' + esc(x.code) + '</b> ' + hl(x.title || ''), s: 'решений: ' + x.sols.length }))) : '') + dtc;
}

/* ---------- База кодов из мануалов Jetour (data/errors.js: 1779 кодов из 44 мануалов) — с 0.10.0 ---------- */
let ERR = null, errLoading = null, errFailed = false;
function loadErrDb() {
  if (ERR) return Promise.resolve(ERR);
  return errLoading = errLoading || loadScript('data/errors.js').then(() => (ERR = window.ERR_DB || { codes: {}, src: [] }), e => { errLoading = null; throw e; });
}
const dtcGroups = code => (ERR && ERR.codes[code]) || [];
const dtcDesc = code => { const g = dtcGroups(code).slice().sort((a, b) => b.d.length - a.d.length)[0]; return g ? g.d : ''; };
const dtcModel = c => c.brand && /jetour/i.test(c.brand.name) && c.model ? c.model.name : '';
// Строки «из мануала» для списка: по коду (P0130, 0130) или по словам описания
function dtcListHtml(raw, cq, c, h, max = 100) {
  if (!ERR || !raw) return '';
  const model = dtcModel(c), out = [];
  const codeLike = /^[PCBU]?[0-9][0-9A-F]{1,6}$/.test(cq);
  if (codeLike) {
    const k = cq.length === 7 && /^[PCBU]/.test(cq) ? cq.slice(0, 5) : cq;
    for (const code in ERR.codes) if ((/^[PCBU]/.test(k) ? code.startsWith(k) : code.slice(1).startsWith(k)) && !findCode(code)) { out.push(code); if (out.length >= max) break; }
  } else if (raw.length >= 3) {
    const ws = raw.toLowerCase().split(/\s+/).filter(w => w.length > 1).map(qVariants);   // все слова, в любом порядке
    const ok = t => ws.every(vs => hasAny(vs, t));
    for (const code in ERR.codes) if (!findCode(code) && ERR.codes[code].some(g => ok(g.d + ' ' + Object.values(g.v || {}).join(' ')))) { out.push(code); if (out.length >= max) break; }
  }
  if (!out.length) return '';
  out.sort((a, b) => (dtcGroups(b).some(g => g.m.includes(model)) - dtcGroups(a).some(g => g.m.includes(model))) || a.localeCompare(b));
  return '<h2>Из мануалов Jetour: ' + out.length + (out.length >= max ? '+' : '') + '</h2>' + rowsHtml(out.map(code => {
    h['dtc' + code] = () => go({ type: 'code', id: 'dtc:' + code });
    const ms = [...new Set(dtcGroups(code).flatMap(g => g.m))];
    return { k: 'dtc' + code, t: '<b>' + esc(code) + '</b> ' + esc(dtcDesc(code)), s: 'Jetour ' + esc(ms.join(', ')) + (model && ms.includes(model) ? ' · <b>есть для ' + esc(model) + '</b>' : '') };
  }));
}
// Описание из мануалов в карточке кода: модели, подкоды, порядок проверки, страницы PDF
function dtcCardHtml(code, c) {
  const gs = dtcGroups(code); if (!gs.length) return '';
  const model = dtcModel(c);
  return '<div class="sec"><h2>Из мануалов Jetour</h2></div>' + gs.map(g => `<div class="card errg${model && !g.m.includes(model) ? ' dim' : ''}">
    <div class="meta">${g.m.map(m => `<span class="tag">Jetour ${esc(m)}</span>`).join(' ')}</div>
    <h3>${esc(g.d)}</h3>
    ${g.v ? '<div class="vars">' + Object.entries(g.v).map(([s, d]) => `<div><b>${esc(code)}-${esc(s)}</b> ${esc(d)}</div>`).join('') + '</div>' : ''}
    ${g.t ? `<details${gs.length === 1 ? ' open' : ''}><summary>Из мануала: описание и порядок проверки</summary><div class="snip">${esc(g.t)}${g.t.length >= 1500 ? '\n…продолжение в мануале' : ''}</div></details>` : ''}
    <div class="refs">${g.r.map(([sid, p, hd]) => `<div>📄 <button class="lnk" data-ref="${sid}:${p}">${esc((ERR.src[sid] || {}).f || '?')}, стр. ${p}</button>${hd ? '<br><span class="muted">' + esc(hd) + '</span>' : ''}</div>`).join('')}</div>
  </div>`).join('');
}
// Страница мануала: через «Документацию» (учитывает папку техдока), иначе прямой путь
function bindDtcRefs(v) {
  v.querySelectorAll('[data-ref]').forEach(b => b.onclick = () => {
    const [sid, p] = b.dataset.ref.split(':').map(Number), s = ERR.src[sid]; if (!s) return;
    const d = docsAll().find(x => x.rel === s.f);
    if (d) return openDoc(d, p);
    const a = document.createElement('a'); a.target = '_blank'; a.rel = 'noopener';
    a.href = 'file:///' + s.path.replace(/\\/g, '/').split('/').map(encodeURIComponent).join('/').replace('%3A', ':') + '#page=' + p;
    document.body.appendChild(a); a.click(); a.remove();
  });
}
// Решения, записанные в другой версии справочника («Моё решение», DB.errNotes), — перенести в «Как устранить»
function migrateErrNotes() {
  const N = DB.errNotes || {}, done = DB.errNotesMoved = DB.errNotesMoved || [];
  let moved = 0;
  for (const [code, n] of Object.entries(N)) {
    if (done.includes(code) || !n || !n.text) continue;
    let x = findCode(code);
    if (!x) { x = { id: newId('e'), code, title: n.title || dtcDesc(code), sys: '', sols: [], seen: 1, added: n.updated || new Date().toISOString() }; codesDB().push(x); }
    const car = carFromText(n.models || '');
    x.sols.push({ id: newId('r'), text: n.text, brand: car.brand || null, model: car.model || null, car: car.car || '', ok: true, date: new Date(n.updated || Date.now()).toLocaleDateString('ru-RU') });
    done.push(code); moved++;
  }
  if (moved) { save(); toast('Перенесены ваши решения из прошлой версии: ' + moved); }
}
