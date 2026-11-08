/* Справочник ремонта — вкладки внизу, как у автосервиса (0.19.0):
   Марки · Работа · Ошибки · ТО · ＋ Добавить. Экраны прежние, вкладки только переключают их. */
'use strict';

const TABS = [['brands', '🚗', 'Марки'], ['work', '🔧', 'Работа'], ['codes', '⚠️', 'Ошибки'], ['to', '🛢', 'ТО'], ['add', '＋', 'Добавить']];
const carPath = () => state.path.filter(p => p.type === 'brand' || p.type === 'model');

function tabNow() {
  const t = state.path[state.path.length - 1];
  if (!t) return 'brands';
  if (t.type === 'codes' || t.type === 'code') return 'codes';
  if (t.type === 'to') return 'to';
  if (t.type === 'work') return 'work';
  return 'brands';
}
function tabsDraw() {
  let nav = document.getElementById('tabs');
  if (!nav) { nav = document.createElement('nav'); nav.id = 'tabs'; nav.className = 'tabs'; document.body.appendChild(nav); }
  const cur = tabNow();
  nav.innerHTML = TABS.map(([k, i, t]) => `<button data-tab="${k}" class="${k === cur ? 'cur' : ''}"><b>${i}</b>${t}</button>`).join('');
  nav.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => tabGo(b.dataset.tab));
}
function tabGo(k) {
  $('#q').value = '';
  const cp = carPath(), last = LS.get('last', null);
  if (k === 'brands') {   // из марки/модели - на главную; из работы, ошибок, ТО - к своей модели
    const t = state.path[state.path.length - 1];
    return goPath(!t || ['brand', 'model', 'group'].includes(t.type) ? [] : cp);
  }
  if (k === 'work') {
    const w = (LS.get('recent', [])[0]) || (last && last.some(p => p.type === 'work') ? last : null);
    if (w) return goPath(w);
    return toast('Откройте работу во вкладке «Марки» - здесь будет последняя');
  }
  if (k === 'codes') return goPath(cp.concat({ type: 'codes' }));
  if (k === 'to') {
    if (!cp.length) return toast('Сначала выберите марку и модель во вкладке «Марки»');
    return goPath(cp.concat({ type: 'to' }));
  }
  if (k === 'add') return addSheet();
}
// «＋»: что добавить - как на автосервисе
function addSheet() {
  const c = ctx(), onWork = tabNow() === 'work';
  const b = [['case', '⚡ Быстрый случай', 'симптом, причина, артикул, фото'], ['qwork', '🔧 Быстрая работа', 'название с подсказками, пункты, нормо-часы']];
  if (c.brand && !onWork) b.push(['here', '🔧 Новая работа здесь', c.brand.name + (c.model ? ' ' + c.model.name : '')]);
  b.push(['code', '⚠️ Ошибка сканера', 'код и как устранили']);
  if (onWork) b.push(['photo', '📷 Фото к этой работе', ''], ['video', '🎬 Видео к этой работе', 'уходит на Яндекс.Диск']);
  b.push(['pdf', '📄 Загрузить инструкцию', 'PDF, фото листов или файл работы']);
  const m = modal(`<h3>Добавить</h3><div class="addl">${b.map(([k, t, s]) => `<button data-a="${k}"><span>${t}</span>${s ? `<small>${esc(s)}</small>` : ''}</button>`).join('')}</div>
    <div class="btns"><button data-a="x">Отмена</button></div>`);
  m.onclick = e => { if (e.target === m) m.remove(); };
  m.querySelectorAll('[data-a]').forEach(x => x.onclick = () => {
    const a = x.dataset.a; m.remove();
    if (a === 'case') quickCase();
    if (a === 'qwork') quickWork();
    if (a === 'here') addWork(c, c.groups.join(' / '));
    if (a === 'code') goPath(carPath().concat({ type: 'codes' }));
    if (a === 'photo') { const p = document.getElementById('aPhoto'); if (p) p.click(); }
    if (a === 'video') { const p = document.getElementById('aVideo'); if (p) p.click(); }
    if (a === 'pdf') importInstruction();
  });
}
// после каждой отрисовки - обновить вкладки
const _renderTabs = render;
render = function () { _renderTabs.apply(this, arguments); tabsDraw(); };
