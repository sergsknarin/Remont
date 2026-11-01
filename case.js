/* Справочник ремонта — «⚡ Быстрый случай» (0.14.0): марка, модель, симптом, причина, артикул, что сделали, фото.
   Сохраняется как работа в разделе «Случаи из практики» у этой модели (поле kase). Ищется с главной по любому слову. */
'use strict';

const CASE_GROUP = 'Случаи из практики';
function caseText(k) {
  return ['Симптом: ' + k.symptom, k.cause && 'Причина: ' + k.cause, k.part && 'Артикул: ' + k.part, k.fix && 'Что сделали: ' + k.fix, 'Дата: ' + new Date(k.date).toLocaleDateString('ru-RU')].filter(Boolean).join('\n');
}
function quickCase() {
  const c = ctx(), brands = DB.brands.map(b => b.name);
  const m = modal(`<h3>⚡ Быстрый случай</h3><form>
    <label>Марка</label><input id="kB" list="kBl" value="${esc(c.brand ? c.brand.name : '')}" autocomplete="off" placeholder="Chery"><datalist id="kBl">${brands.map(n => `<option value="${esc(n)}">`).join('')}</datalist>
    <label>Модель</label><input id="kM" list="kMl" value="${esc(c.model ? c.model.name : '')}" autocomplete="off" placeholder="Tiggo 4 Pro"><datalist id="kMl"></datalist>
    <label>Симптом (что видно) *</label><input id="kS" autocomplete="off" placeholder="Постоянно горят стоп-сигналы">
    <label>Причина</label><input id="kC" autocomplete="off" placeholder="Выключатель стоп-сигнала (жабка)">
    <label>Артикул / деталь</label><input id="kP" autocomplete="off" placeholder="B21-3720010BA">
    <label>Что сделали</label><textarea id="kF" rows="3" placeholder="Заменили выключатель, проверили — стопы гаснут"></textarea>
    <label>Фото (можно несколько)</label><input id="kPh" type="file" accept="image/*" multiple>
    <div class="btns"><button type="submit" class="pri">Сохранить</button><button type="button" data-c="1">Отмена</button></div></form>`);
  const $m = s => m.querySelector(s), fm = $m('form');
  const fillModels = () => { const b = DB.brands.find(x => norm(x.name) === norm($m('#kB').value.trim())); $m('#kMl').innerHTML = (b ? b.models : []).map(x => `<option value="${esc(x.name)}">`).join(''); };
  $m('#kB').oninput = fillModels; fillModels();
  setTimeout(() => (c.brand ? $m('#kS') : $m('#kB')).focus(), 50);
  $m('[data-c]').onclick = () => m.remove();
  fm.onsubmit = async e => {
    e.preventDefault();
    const bn = $m('#kB').value.trim(), mn = $m('#kM').value.trim(), sym = $m('#kS').value.trim();
    if (!bn) return $m('#kB').focus(); if (!sym) return $m('#kS').focus();
    // марка и модель: найти или создать
    let b = DB.brands.find(x => norm(x.name) === norm(bn));
    if (!b) { b = { id: newId('b'), name: bn, models: [] }; DB.brands.push(b); }
    let md = mn ? b.models.find(x => norm(x.name) === norm(mn)) : null;
    if (mn && !md) { md = { id: newId('m'), name: mn }; b.models.push(md); }
    const k = { symptom: sym, cause: $m('#kC').value.trim(), part: $m('#kP').value.trim(), fix: $m('#kF').value.trim(), date: new Date().toISOString() };
    const w = { id: newId('w'), brand: b.id, model: md ? md.id : null, name: sym + (k.cause ? ' — ' + k.cause : ''), group: CASE_GROUP, instr: caseText(k), kase: k };
    DB.items.push(w);
    const files = [...$m('#kPh').files];
    m.remove(); await save();
    if (files.length) await addPhotos(files, async f => { f(w); await save(); });
    goPath([{ type: 'brand', id: b.id }, { type: 'model', id: md ? md.id : null }, { type: 'work', id: w.id }]);
    toast('Случай сохранён · ' + b.name + (md ? ' ' + md.name : ''));
  };
}
// Поиск по случаям всех марок: симптом, причина, артикул, что сделали
function caseHits(has, hl, h) {
  const hits = DB.items.filter(w => w.kase && has([w.name, w.instr, w.kase.part].join(' '))).slice(0, 50);
  if (!hits.length) return '';
  return '<h2>Случаи из практики: ' + hits.length + '</h2>' + rowsHtml(hits.map(w => {
    const b = findBrand(w.brand), md = b && w.model && findModel(b, w.model);
    h['k' + w.id] = () => goPath([{ type: 'brand', id: w.brand }, { type: 'model', id: w.model || null }, { type: 'work', id: w.id }]);
    return { k: 'k' + w.id, t: hl(w.name), s: esc([b && b.name, md && md.name, w.kase.part].filter(Boolean).join(' · ')) };
  }));
}

/* ---------- «⚡ Быстрая работа» (0.16.0): название с подсказками, раздел/нормо-часы/цена сами, пункты с другой машины ---------- */
// Мастерские слова → как в базе: «печка» найдёт «отопитель», «жабка» — «выключатель стоп-сигнала»
const WORK_SYN = { 'печк': 'отопит', 'печь': 'отопит', 'жабк': 'выключатель стоп', 'стопарь': 'стоп-сигнал', 'грм': 'ремень грм', 'колодк': 'колодки', 'антифриз': 'охлаждающ', 'тосол': 'охлаждающ',
  'кондей': 'кондиционер', 'кондер': 'кондиционер', 'сажев': 'сажевый', 'стабил': 'стабилизатор', 'шрус': 'шрус', 'ступиц': 'ступиц', 'лямбд': 'лямбда', 'свечи': 'свеч', 'масло': 'масл' };
function workSuggest(q) {
  q = norm(q).trim(); if (q.length < 2) return [];
  const words = q.split(/\s+/).map(w => { for (const k in WORK_SYN) if (w.startsWith(k) || (w.length >= 3 && k.startsWith(w))) return [w, WORK_SYN[k]]; return [w]; });
  const seen = new Set(), out = [];
  const pool = DB.items.filter(i => i.steps && i.steps.length).concat(DB.templates, DB.items);   // сначала работы с пунктами
  for (const w of pool) {
    const n = norm(w.name), key = n + '|' + norm(w.group);
    if (seen.has(n) || !words.every(alts => alts.some(a => hasAny(qVariants(a), n + ' ' + norm(w.group))))) continue;
    seen.add(n); out.push(w); if (out.length >= 8) break;
  }
  return out;
}
function quickWork() {
  const c = ctx(), brands = DB.brands.map(b => b.name), groups = [...new Set(DB.templates.concat(DB.items).map(w => w.group).filter(Boolean))].sort();
  const m = modal(`<h3>⚡ Быстрая работа</h3><form autocomplete="off">
    <label>Марка</label><input id="wB" list="wBl" value="${esc(c.brand ? c.brand.name : '')}" placeholder="Jetour"><datalist id="wBl">${brands.map(n => `<option value="${esc(n)}">`).join('')}</datalist>
    <label>Модель</label><input id="wM" list="wMl" value="${esc(c.model ? c.model.name : '')}" placeholder="Dashing"><datalist id="wMl"></datalist>
    <label>Работа * <span class="muted">(начните вводить: «рад печ», «колод пер»)</span></label><input id="wN" placeholder="Замена радиатора печки"><div id="wSug" class="wsug"></div>
    <label>Раздел</label><input id="wG" list="wGl" placeholder="Охлаждение"><datalist id="wGl">${groups.map(g => `<option value="${esc(g)}">`).join('')}</datalist>
    <div class="row2"><div><label>Нормо-часы</label><input id="wH" inputmode="decimal"></div><div><label>Цена, ₽</label><input id="wP" inputmode="decimal"></div></div>
    <label>Пункты (каждый с новой строки)</label><textarea id="wS" rows="5" placeholder="Слить антифриз&#10;Снять панель / кожух&#10;Заменить радиатор&#10;Залить, прогнать воздух, проверить течь"></textarea>
    <label>Заметка</label><input id="wNote" placeholder="Что важно, артикул…">
    <label>Фото</label><input id="wPh" type="file" accept="image/*" multiple>
    <div class="btns"><button type="submit" class="pri">Сохранить</button><button type="button" data-c="1">Отмена</button></div></form>`);
  const $m = s => m.querySelector(s);
  const fillModels = () => { const b = DB.brands.find(x => norm(x.name) === norm($m('#wB').value.trim())); $m('#wMl').innerHTML = (b ? b.models : []).map(x => `<option value="${esc(x.name)}">`).join(''); };
  $m('#wB').oninput = fillModels; fillModels();
  let picked = null;
  const sug = () => {
    const list = workSuggest($m('#wN').value);
    $m('#wSug').innerHTML = list.map((w, i) => { const b = w.brand && findBrand(w.brand), md = b && w.model && findModel(b, w.model);
      return `<button type="button" data-s="${i}"><b>${esc(w.name)}</b><span>${esc([w.group, w.hours ? w.hours + ' н/ч' : '', w.steps && w.steps.length ? 'пунктов: ' + w.steps.length + (b ? ' (' + b.name + (md ? ' ' + md.name : '') + ')' : '') : ''].filter(Boolean).join(' · '))}</span></button>`; }).join('');
    $m('#wSug').querySelectorAll('[data-s]').forEach(bt => bt.onclick = () => {
      const w = list[+bt.dataset.s]; picked = w; $m('#wN').value = w.name; $m('#wG').value = w.group || '';
      if (w.hours != null) $m('#wH').value = String(w.hours).replace('.', ',');
      if (w.price != null) $m('#wP').value = w.price;
      if (w.steps && w.steps.length && !$m('#wS').value.trim()) $m('#wS').value = w.steps.map(s => s.text).join('\n');
      $m('#wSug').innerHTML = '';
    });
  };
  $m('#wN').oninput = () => { picked = null; sug(); };
  setTimeout(() => (c.brand ? $m('#wN') : $m('#wB')).focus(), 50);
  $m('[data-c]').onclick = () => m.remove();
  $m('form').onsubmit = async e => {
    e.preventDefault();
    const bn = $m('#wB').value.trim(), mn = $m('#wM').value.trim(), name = $m('#wN').value.trim();
    if (!bn) return $m('#wB').focus(); if (!name) return $m('#wN').focus();
    let b = DB.brands.find(x => norm(x.name) === norm(bn));
    if (!b) { b = { id: newId('b'), name: bn, models: [] }; DB.brands.push(b); }
    let md = mn ? b.models.find(x => norm(x.name) === norm(mn)) : null;
    if (mn && !md) { md = { id: newId('m'), name: mn }; b.models.push(md); }
    const steps = $m('#wS').value.split('\n').map(t => t.trim()).filter(Boolean).map(t => ({ id: newId('s'), text: t, sub: [] }));
    const w = { id: newId('w'), brand: b.id, model: md ? md.id : null, name, group: $m('#wG').value.trim() || (picked && picked.group) || 'Прочее',
      hours: num($m('#wH').value), price: num($m('#wP').value), note: $m('#wNote').value.trim(), steps, params: (picked && picked.params ? structuredClone(picked.params) : []) };
    if (picked && picked.instr) w.instr = picked.instr;
    DB.items.push(w);
    const files = [...$m('#wPh').files];
    m.remove(); await save();
    if (files.length) await addPhotos(files, async f => { f(w); await save(); });
    goPath([{ type: 'brand', id: b.id }, { type: 'model', id: md ? md.id : null }, { type: 'work', id: w.id }]);
    toast('Работа добавлена · ' + b.name + (md ? ' ' + md.name : ''));
  };
}
