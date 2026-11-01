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
