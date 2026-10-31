/* Справочник ремонта — ТО и жидкости (0.11.0): объёмы, марки масел, моменты, интервалы по моделям.
   Готовые карточки — data/to.js (TO_BASE), свои и распознанные — DB.toUser.
   «🔍 Распознать из PDF» — читает текст мануала и находит объёмы, жидкости, моменты затяжки, интервалы. */
'use strict';

const toUser = () => (DB.toUser = DB.toUser || []);
const TOB = () => window.TO_BASE || { cards: [] };
// item: [название, значение, id документа, страница, имя файла]
function toFor(c) {
  if (!c.brand) return [];
  const fit = x => norm(x.brand) === norm(c.brand.name) && (!c.model || !(x.models || []).length || x.models.some(m => norm(m) === norm(c.model.name)));
  const over = new Set(toUser().map(x => x.overrides).filter(Boolean));
  return TOB().cards.filter(x => !over.has(x.id)).concat(toUser()).filter(fit);
}
function toSub(c) {
  const n = toFor(c).length;
  return n ? 'объёмы, масла, моменты, интервалы · карточек: ' + n : 'пока пусто · можно распознать из PDF';
}
function toDoc(it) {
  if (it[2]) return docsAll().find(d => d.id === it[2]);
  const f = it[4] && norm(it[4]);
  return f && docsAll().find(d => [d.rel, d.embed, d.file, d.name].some(x => x && norm(x).split('/').pop() === f));
}
function toSrc(it, k) {
  if (!it[3]) return '';
  const d = toDoc(it), name = d ? d.title : it[4] || 'мануал';
  return d ? `<a href="#" class="tosrc" data-k="${k}">📄 ${esc(name)}, стр. ${it[3]}</a>` : `<span class="tosrc">📄 ${esc(name)}, стр. ${it[3]}</span>`;
}

/* ---------- Экран ---------- */
function renderTO(v, c) {
  const cards = toFor(c), S = TOB().schedule, links = {};
  let html = `<div class="adds"><button class="add" id="toRec">🔍 Распознать из PDF</button><button class="add" id="toNew">＋ Своя карточка</button></div>`;
  if (!cards.length) html += '<div class="empty">Для этой машины данных ТО пока нет.<br>Загрузите мануал — программа найдёт объёмы и моменты сама.</div>';
  cards.forEach((x, i) => {
    html += `<div class="card toc"><h3>${x.user ? '🆕 ' : ''}${esc(x.title)}</h3>` +
      (x.models && x.models.length ? `<div class="muted">${esc(x.models.join(', '))}</div>` : '') + '<table class="tot">' +
      x.items.map((it, j) => { links[i + '_' + j] = it; return `<tr><td>${esc(it[0])}</td><td><b>${esc(it[1])}</b>${it[3] ? '<br>' + toSrc(it, i + '_' + j) : ''}</td></tr>`; }).join('') +
      `</table><div class="btns"><button data-ed="${i}">Изменить</button>${x.user ? `<button class="danger" data-del="${i}">Удалить</button>` : ''}</div></div>`;
  });
  if (S && c.brand && norm(S.brand) === norm(c.brand.name)) {
    links.sch = [0, 0, S.doc, S.p];
    html += `<div class="card toc"><h3>Регламент ТО (карта обслуживания)</h3><div class="muted">${esc(S.note)}</div><table class="tot">` +
      S.rows.map(r => `<tr><td>${esc(r[0])}</td><td><b>${esc(r[1])}</b></td></tr>`).join('') + `</table>${toSrc(links.sch, 'sch')}</div>`;
  }
  v.innerHTML = html;
  v.querySelectorAll('a.tosrc').forEach(a => a.onclick = e => { e.preventDefault(); const it = links[a.dataset.k], d = toDoc(it); d && openDoc(d, it[3]); });
  v.querySelectorAll('[data-ed]').forEach(b => b.onclick = () => toEdit(c, cards[b.dataset.ed]));
  v.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
    const x = cards[b.dataset.del];
    if (!(await confirmBox(`Удалить карточку «${x.title}»?`, 'Удалить', 'danger'))) return;
    DB.toUser = toUser().filter(e => e !== x); await save(); render(); toast('Удалено');
  });
  $('#toRec').onclick = () => toRecognize(c);
  $('#toNew').onclick = () => toEdit(c, null);
}

/* ---------- Правка карточки: строки «Название = значение = стр.» ---------- */
const toLines = x => (x ? x.items : []).map(it => [it[0], it[1], it[3] || ''].join(' = ').replace(/ = $/, '')).join('\n');
async function toEdit(c, x) {
  const r = await formBox(x ? 'Изменить карточку ТО' : 'Новая карточка ТО', [
    { k: 'title', label: 'Название (узел): Двигатель F4J20, КПП 7DCT…' },
    { k: 'models', label: 'Модели через запятую (пусто — вся марка)' },
    { k: 'lines', label: 'Строки: Название = значение = стр. (стр. можно не писать)', type: 'area' }
  ], { title: x ? x.title : '', models: x ? (x.models || []).join(', ') : c.model ? c.model.name : '', lines: toLines(x) });
  if (!r) return;
  const old = x ? x.items : [];
  const items = r.lines.split('\n').map(l => l.split('=').map(s => s.trim())).filter(p => p[0]).map(p => {
    const o = old.find(it => it[0] === p[0]) || [], pg = parseInt(p[2], 10) || null;
    return [p[0], p[1] || '', pg && pg === o[3] ? o[2] || null : o[2] && pg ? o[2] : null, pg, o[4] || null];
  });
  const card = { id: x && x.user ? x.id : newId('to'), brand: c.brand.name, models: r.models.split(',').map(s => s.trim()).filter(Boolean), title: r.title, items, user: true };
  if (x && !x.user) card.overrides = x.id; // правка готовой карточки — своя копия на её месте
  if (x && x.user) Object.assign(x, card); else toUser().push(card);
  await save(); render(); toast('Сохранено');
}

/* ---------- Распознавание PDF ---------- */
const TO_CATS = [
  ['Двигатель', /моторн|двигател|масляного фильтра|поддон|(?<!\d)[05]W-?\d0|ACEA/i],
  ['КПП', /коробк|КПП|трансмисс|ATF|DCTF|CVTF|DCT|AHA|DHA|DHB|MF\d/i],
  ['Задний мост', /дифференц|мост|редуктор|75W-?90/i],
  ['Муфта 4WD / раздатка', /муфт|4WD|раздат|PTU|HALBOT/i],
  ['Охлаждение', /охлаждающ|антифриз|ОЖ\b/i],
  ['Тормоза', /тормозн\w* жидк|DOT\s?\d/i],
  ['Кондиционер', /хладаг|R-?1234|R-?134|кондиционер/i],
  ['Колёса и шины', /крепления колес|колесн|запасного колес|(?<!рулевого )колес[оа]\b|\bшин/i],
  ['Свечи', /свеч/i]
];
// узел — по ближайшему к значению слову (последнее совпадение в тексте перед ним)
function toCat(s) {
  let best = 'Другое', pos = -1;
  for (const [n, re] of TO_CATS) { const g = new RegExp(re.source, 'gi'); let m; while ((m = g.exec(s))) if (m.index >= pos) { pos = m.index; best = n; } }
  return best;
}
const NUM = '\\d+(?:[,.]\\d+)?';
const TO_RULES = [
  // объём: 4,4 ± 0,1 л, 3,8 - 4,1 Л, 671 ± 20 мл
  { kind: 'vol', re: new RegExp(`(${NUM}(?:\\s*(?:±|\\+/-)\\s*${NUM}|\\s*[-–]\\s*${NUM})?)\\s*(мл|л|Л)(?![а-яёa-z])`, 'g'),
    need: /масл|жидкост|антифриз|охлажд|ATF|DCTF|хладаг|[её]мкост|объ[её]м|заправ|залив|долить|долив/i, val: m => m[1].replace(/\s+/g, ' ') + ' ' + m[2].toLowerCase() },
  // марка жидкости
  { kind: 'spec', re: /\b(?:ACEA[- ]?)?C[2-5]\s+\d{1,2}W-?\d{2}\b|\b\d{1,2}W-\d{2,3}\b|\b(?:DCTF|ATF|CVTF)(?:[- ][A-Z0-9][A-Z0-9-]*)?\b|\bDOT\s?[345](?:\.1)?\b|\bR-?1234yf\b|\bR-?134a\b/g,
    val: m => m[0].replace(/\s+/g, ' ') },
  // момент затяжки важных пробок/болтов: «Сливная пробка … 35 ± 3», «Момент затяжки: 25 - 40 Н·м»
  { kind: 'torq', re: new RegExp(`(${NUM}(?:\\s*±\\s*${NUM}|\\s*[-–]\\s*${NUM})?)\\s*(Н\\s*[·.•∙]?\\s*м)`, 'g'),
    need: /сливн|заливн|контрольн|переливн|пробк|колес|свеч|масляного фильтра|фильтр масл/i, val: m => m[1].replace(/\s+/g, ' ') + ' Н·м', near: 70 },
  { kind: 'torq', re: new RegExp(`((?:Сливн|Заливн|Переливн|Контрольн)\\S*\\s+пробк\\S*[^\\d]{0,40}|Пробк\\S*\\s*\\([^)]{0,30}\\)|Болт крепления колеса|Колесн\\S* (?:болт|гайк)\\S*|Свеча зажигания|Крышк\\S* масляного фильтра)\\s+(?:\\d{1,2}\\s+)?(${NUM}\\s*±\\s*${NUM})(?!\\s*(?:мм|л|мл|°))`, 'gi'),
    val: m => m[2].replace(/\s+/g, ' ') + ' Н·м', label: m => m[1] },
  // интервал: каждые 60 000 км или 5 лет, каждые 2 года
  { kind: 'int', re: /(?:каждые|кажд\S*|через)\s+(?:\d[\d\s]{2,}\d\s*км(?:\s*(?:или|\/)\s*\d+\s*(?:лет|года?|мес\S*))?|\d+\s*(?:лет|года?|мес\S*)(?:\s*или\s*\d[\d\s]{2,}\d\s*км)?)/gi,
    need: /масл|жидкост|фильтр|свеч|замен/i, val: m => m[0].replace(/\s+/g, ' ') }
];
const TO_KIND = { vol: 'объём', spec: 'марка', torq: 'момент', int: 'интервал' };
function toScanPage(text, p, out) {
  for (const r of TO_RULES) {
    r.re.lastIndex = 0; let m;
    while ((m = r.re.exec(text))) {
      const before = text.slice(Math.max(0, m.index - (r.near || 140)), m.index), after = text.slice(m.index + m[0].length, m.index + m[0].length + 40);
      if (r.need && !r.need.test(before + ' ' + m[0] + ' ' + after.slice(0, 15))) continue;
      const val = r.val(m), cat = toCat(before.slice(-90) + ' ' + m[0]);
      let lab = r.label ? r.label(m) : before.replace(/\s+/g, ' ').split(/[.;!?•]\s|\d+\.\s/).pop();
      // «…Затяните сливную пробку. Момент затяжки: 44 ± 5» — подпись из предыдущего предложения
      if (r.kind === 'torq' && !r.label && (/^\s*момент/i.test(lab) || lab.length < 12)) {
        const sent = before.replace(/\s+/g, ' ').split(/[.;!?]\s/).reverse().find(t => /пробк|болт|гайк|свеч|фильтр/i.test(t));
        if (sent) lab = sent.replace(/^\s*\d+\s*/, '');
      }
      lab = lab.slice(-70).replace(/^\S*\s/, s => lab.length > 70 ? '' : s).replace(/^[^A-Za-zА-Яа-яЁё]+/, '').replace(/[\s:–-]+$/, '').trim() || cat;
      const key = r.kind + '|' + val.toLowerCase();
      const ex = out.find(x => x.key === key && x.cat === cat);
      if (ex) { ex.n++; continue; }
      out.push({ key, kind: r.kind, cat, label: lab, val, p, n: 1, ctx: (before.slice(-90) + ' [' + m[0] + '] ' + after).replace(/\s+/g, ' ') });
    }
  }
}
async function toReadPdf(file, out) {
  const lib = await pdfLib();
  const pdf = await lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const n00 = out.length; let head = file.name; // узел по умолчанию — по названию и первым страницам (мануал КПП → «КПП»)
  for (let i = 1; i <= pdf.numPages; i++) {
    if (i % 10 === 1) busy(`Распознаю «${file.name}»: страница ${i} из ${pdf.numPages}`);
    let text = ''; try { text = pageLines(await (await pdf.getPage(i)).getTextContent()).join('  '); } catch (e) {}
    const n0 = out.length; toScanPage(text, i, out);
    for (let k = n0; k < out.length; k++) out[k].file = file.name;
    if (i <= 3) head += ' ' + text.slice(0, 1500);
  }
  const dc = toCat(head);
  if (dc !== 'Другое') for (let k = n00; k < out.length; k++) if (out[k].cat === 'Другое') out[k].cat = dc;
  return pdf.numPages;
}
function toRecognize(c) {
  const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.pdf,application/pdf'; inp.multiple = true; inp.hidden = true;
  document.body.appendChild(inp); // на iPhone выбор файла работает только у поля на странице
  inp.onchange = async () => {
    const files = [...inp.files]; inp.remove(); if (!files.length) return;
    const found = []; let pages = 0;
    try { for (const f of files) pages += await toReadPdf(f, found); }
    catch (e) { busy(); toast('Не удалось прочитать PDF: ' + e.message); return; }
    busy();
    if (!found.length) { toast(`Прочитано ${pages} стр. — объёмов и моментов не нашёл. Возможно, текст в PDF картинкой.`); return; }
    toReview(c, files, found, pages);
  };
  inp.click();
}
// Окно проверки: галочки, правка названия и значения, группировка по узлам
function toReview(c, files, found, pages) {
  const order = TO_CATS.map(x => x[0]).concat('Другое'), kOrd = ['vol', 'spec', 'torq', 'int'];
  found.sort((a, b) => order.indexOf(a.cat) - order.indexOf(b.cat) || kOrd.indexOf(a.kind) - kOrd.indexOf(b.kind) || b.n - a.n);
  const list = found.slice(0, 200), def = x => x.cat !== 'Другое' && (x.kind !== 'torq' || /сливн|заливн|переливн|контрольн|пробк|крепления колес|колесн|свеч|масляного фильтра/i.test(x.label));
  const title = files.map(f => f.name.replace(/\.pdf$/i, '')).join(', ').slice(0, 80);
  let html = `<h3>Найдено в PDF: ${found.length}</h3><div class="muted">Прочитано страниц: ${pages}. Снимите галочки с лишнего, поправьте текст. Нажмите на строку-подсказку, чтобы увидеть, откуда взято.</div>
    <label>Название карточки</label><input id="toT" value="${esc(title)}">
    <label>Модели через запятую (пусто — вся марка ${esc(c.brand.name)})</label><input id="toM" value="${esc(c.model ? c.model.name : '')}"><div class="torev">`;
  let cat = '';
  list.forEach((x, i) => {
    if (x.cat !== cat) { cat = x.cat; html += `<h4>${esc(cat)}</h4>`; }
    html += `<div class="tori"><input type="checkbox" data-i="${i}" ${def(x) ? 'checked' : ''}><div><input class="tl" data-l="${i}" value="${esc(x.label)}"><input class="tv" data-v="${i}" value="${esc(x.val)}">
      <div class="s" data-x="${i}">${TO_KIND[x.kind]} · стр. ${x.p}${x.n > 1 ? ' · встречается ' + x.n + ' раз' : ''}${files.length > 1 ? ' · ' + esc(x.file) : ''} ▾</div><div class="s ctx" hidden>${esc(x.ctx)}</div></div></div>`;
  });
  html += `</div><div class="btns"><button class="pri" id="toOk">Сохранить карточку</button><button id="toNo">Отмена</button></div>`;
  const m = modal(html);
  m.querySelectorAll('[data-x]').forEach(s => s.onclick = () => { const cx = s.nextElementSibling; cx.hidden = !cx.hidden; });
  m.querySelector('#toNo').onclick = () => m.remove();
  m.querySelector('#toOk').onclick = async () => {
    const items = [];
    m.querySelectorAll('input[type=checkbox]').forEach(cb => {
      if (!cb.checked) return; const i = +cb.dataset.i, x = list[i];
      const lab = m.querySelector(`[data-l="${i}"]`).value.trim(), val = m.querySelector(`[data-v="${i}"]`).value.trim();
      items.push([x.cat !== 'Другое' && !norm(lab).includes(norm(x.cat).split(' ')[0]) ? x.cat + ': ' + lab : lab, val, null, x.p, x.file]);
    });
    if (!items.length) { toast('Ничего не отмечено'); return; }
    toUser().push({ id: newId('to'), brand: c.brand.name, models: m.querySelector('#toM').value.split(',').map(s => s.trim()).filter(Boolean),
      title: m.querySelector('#toT').value.trim() || 'Из PDF', items, user: true, from: files.map(f => f.name) });
    m.remove(); await save(); render(); toast('Сохранено: ' + items.length + ' строк');
  };
}
