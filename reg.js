/* Справочник ремонта — регламент ТО по пробегу (0.20.0), идея как в Autodata:
   операции с интервалом «каждые N км или M месяцев» -> карта ТО (15 / 30 / 45 тыс.) и ближайшее ТО по пробегу.
   DB.reg: [{ id, brand, model, engine, ops: [{ id, name, km, mo, note }] }]. Ищется: двигатель -> модель -> вся марка.
   Та же база - в программе для ПК (Справочник 1.2.0). */
'use strict';

const regAll = () => (DB.reg = DB.reg || []);
function regFor(c) {
  if (!c.brand) return null;
  const m = c.model ? c.model.id : null, e = c.engine || null;
  const f = (mm, ee) => regAll().find(r => r.brand === c.brand.id && (r.model || null) === mm && (r.engine || null) === ee);
  if (e) { const r = f(m, e); if (r) return { r, level: 'engine' }; }
  if (m) { const r = f(m, null); if (r) return { r, level: 'model' }; }
  const r = f(null, null); return r ? { r, level: 'brand' } : null;
}
const regLevelName = (c, lv) => lv === 'engine' ? '⚙ ' + (((c.model && c.model.engines) || []).find(e => e.id === c.engine) || {}).name
  : lv === 'model' ? c.model.name : 'вся марка ' + c.brand.name;
const kmTxt = n => Number(n).toLocaleString('ru-RU').replace(/ /g, ' ');
const regInt = o => [o.km ? 'каждые ' + kmTxt(o.km) + ' км' : '', o.mo ? (o.km ? 'или ' : 'каждые ') + o.mo + ' мес' : ''].filter(Boolean).join(' ');

// карта ТО: точки - все кратные интервалов по пробегу (10 000 и 15 000 -> 10, 15, 20, 30, 40, 45…)
function regPoints(ops, upTo) {
  const kms = [...new Set(ops.map(o => +o.km).filter(x => x > 0))];
  if (!kms.length) return [];
  const max = upTo || Math.min(240000, Math.max(120000, 2 * Math.max(...kms))), set = new Set();
  kms.forEach(k => { for (let p = k; p <= max; p += k) set.add(p); });
  return [...set].sort((a, b) => a - b).map(p => ({ km: p, ops: ops.filter(o => +o.km > 0 && p % +o.km === 0) }));
}
function regNext(ops, km) {
  const kms = ops.map(o => +o.km).filter(x => x > 0);
  if (!kms.length) return null;
  const p = Math.min(...kms.map(k => Math.ceil((km + 1) / k) * k));
  return { km: p, left: p - km, ops: ops.filter(o => +o.km > 0 && p % +o.km === 0), time: ops.filter(o => !(+o.km > 0) && +o.mo > 0) };
}

function regHtml(c) {
  const f = regFor(c);
  let h = `<div class="card toc reg"><h3>📅 Регламент ТО по пробегу</h3>`;
  if (!f) return h + `<div class="muted">Для ${esc(c.brand.name)}${c.model ? ' ' + esc(c.model.name) : ''} регламента пока нет.</div>
    <div class="btns"><button id="regNew">＋ Заполнить</button><button id="regTpl">Типовой шаблон</button></div></div>`;
  const ops = f.r.ops || [], pts = regPoints(ops), last = LS.get('regKm', '');
  h += `<div class="muted">${f.level === 'brand' ? 'общий для марки' : 'для ' + esc(regLevelName(c, f.level))}${f.r.author ? ' · ' + esc(f.r.author) : ''}</div>
    <table class="tot">${ops.map(o => `<tr><td>${esc(o.name)}${o.note ? `<br><span class="muted">${esc(o.note)}</span>` : ''}</td><td><b>${esc(regInt(o))}</b></td></tr>`).join('')}</table>
    <div class="regkm"><label for="regKm">Пробег сейчас</label><input id="regKm" inputmode="numeric" placeholder="км" value="${esc(last)}"><button id="regCalc">Что на ближайшем ТО</button></div>
    <div id="regOut"></div>`;
  if (pts.length) h += `<details><summary>Карта ТО до ${kmTxt(pts[pts.length - 1].km)} км</summary><table class="tot">${pts.map(p => `<tr><td><b>${kmTxt(p.km)}</b></td><td>${p.ops.map(o => esc(o.name)).join(', ')}</td></tr>`).join('')}</table></details>`;
  return h + `<div class="btns"><button id="regEd">Изменить регламент</button></div></div>`;
}
function bindReg(v, c) {
  const f = regFor(c), q = s => v.querySelector(s);
  if (q('#regNew')) q('#regNew').onclick = () => regEdit(c, null);
  if (q('#regTpl')) q('#regTpl').onclick = () => regEdit(c, null, REG_TPL);
  if (q('#regEd')) q('#regEd').onclick = () => regEdit(c, f);
  const calc = () => {
    const km = parseInt(String(q('#regKm').value).replace(/\D/g, ''), 10);
    if (!(km >= 0)) { q('#regOut').innerHTML = '<div class="muted">Впишите пробег числом</div>'; return; }
    LS.set('regKm', String(km));
    const n = regNext(f.r.ops || [], km);
    q('#regOut').innerHTML = !n ? '<div class="muted">В регламенте нет интервалов по пробегу</div>'
      : `<div class="note"><b>Ближайшее ТО: ${kmTxt(n.km)} км</b> (через ${kmTxt(n.left)} км)<br>${n.ops.map(o => '• ' + esc(o.name)).join('<br>')}` +
        (n.time.length ? `<br><span class="muted">По времени (проверить даты): ${n.time.map(o => esc(o.name) + ' - ' + o.mo + ' мес').join(', ')}</span>` : '') + '</div>';
  };
  if (q('#regCalc')) { q('#regCalc').onclick = calc; if (q('#regKm').value) calc(); }
}

// Типовой шаблон - для начала; проверить по мануалу конкретной машины
const REG_TPL = [['Масло ДВС и масляный фильтр', 10000, 12], ['Фильтр салона', 15000, 12], ['Воздушный фильтр', 30000, 24],
  ['Свечи зажигания', 30000, 36], ['Тормозная жидкость', 0, 24], ['Масло КПП (DCT/вариатор)', 60000, 48], ['Антифриз', 60000, 48],
  ['Ремень/цепь ГРМ - проверка', 60000, 0], ['Топливный фильтр', 40000, 0]].map(([name, km, mo]) => ({ name, km, mo }));

// правка: строки «Название = км = мес = примечание»
async function regEdit(c, f, tpl) {
  const ops = tpl || (f ? f.r.ops : []);
  const lines = ops.map(o => [o.name, o.km || '', o.mo || '', o.note || ''].join(' = ').replace(/( = )+$/, '')).join('\n');
  const lv = c.engine ? 'engine' : c.model ? 'model' : 'brand';
  const r = await formBox('Регламент ТО · ' + regLevelName(c, lv), [{ k: 't', label: 'Строка = операция: «Название = км = месяцев = примечание». Пусто - нет интервала. Пример: «Масло ДВС = 10000 = 12»', type: 'area' }], { t: lines });
  if (!r) return;
  const out = [], bad = [];
  r.t.split('\n').map(s => s.trim()).filter(Boolean).forEach(s => {
    const [name, km, mo, ...note] = s.split('=').map(x => x.trim());
    const k = km ? parseInt(km.replace(/\D/g, ''), 10) : 0, m = mo ? parseInt(mo.replace(/\D/g, ''), 10) : 0;
    if (!name || (km && !(k > 0)) || (mo && !(m > 0))) { bad.push(s); return; }
    out.push({ id: newId('ro'), name, km: k || null, mo: m || null, note: note.join(' = ') });
  });
  if (bad.length) { toast('Не понял строки: ' + bad.join('; ')); return; }
  const mm = c.model ? c.model.id : null, ee = c.engine || null;
  let x = regAll().find(e => e.brand === c.brand.id && (e.model || null) === mm && (e.engine || null) === ee);
  if (!x) { x = { id: newId('rg'), brand: c.brand.id, model: mm, engine: ee, added: new Date().toISOString().slice(0, 10) }; regAll().push(x); }
  x.ops = out;
  if (!out.length) DB.reg = regAll().filter(e => e !== x);
  await save(); render(); toast(out.length ? 'Регламент сохранён' : 'Регламент удалён');
}
