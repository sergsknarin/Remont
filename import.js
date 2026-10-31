/* Справочник ремонта — загрузка инструкций (0.7.0): PDF, фото, файл работы → работа с пунктами и фото,
   марка/модель/раздел подбираются сами, перед сохранением можно поправить */
'use strict';

/* ---------- PDF-библиотека (pdf.js, лежит в lib/, работает без интернета) ---------- */
function loadScript(src) {
  return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('не загрузился ' + src)); document.head.appendChild(s); });
}
async function pdfLib() {
  if (!window.pdfjsWorker) await loadScript('lib/pdf.worker.js'); // обработчик в основном потоке — работает и с диска
  if (!window.pdfjsLib) await loadScript('lib/pdf.js');
  return window.pdfjsLib;
}
function busy(msg) {
  let m = document.querySelector('.modal.busy');
  if (!msg) { m && m.remove(); return; }
  if (!m) { m = modal('<p class="bm"></p>'); m.classList.add('busy'); }
  m.querySelector('.bm').textContent = msg;
}

/* ---------- Чтение файлов в «черновик» ---------- */
// draft: { name, brandName, modelName, group, instr, note, codes[], steps:[{text, img:Blob|null, rot:0}] , files[] }
const canvasBlob = (cv, q = 0.85) => new Promise(r => cv.toBlob(r, 'image/jpeg', q));
function pageLines(tc) {
  const rows = [];
  for (const it of tc.items) {
    if (!it.str || !it.str.trim()) continue;
    const y = Math.round(it.transform[5]), x = it.transform[4];
    let r = rows.find(r => Math.abs(r.y - y) <= 3);
    if (!r) rows.push(r = { y, parts: [] });
    r.parts.push({ x, s: it.str });
  }
  return rows.sort((a, b) => b.y - a.y).map(r => r.parts.sort((a, b) => a.x - b.x).map(p => p.s).join(' ').replace(/\s+/g, ' ').trim()).filter(Boolean);
}
// Строки → пункты: новая строка начинает пункт, если предыдущая закончилась точкой, двоеточием, кавычкой и т.п.
function linesToSteps(lines) {
  const out = []; let cur = '';
  lines.forEach((l, i) => {
    cur = cur ? cur + ' ' + l : l;
    const next = lines[i + 1] || '';
    // конец пункта: знак препинания в конце, или следующая строка начинается с заглавной/цифры/«, а эта — не с запятой/дефисом
    if (/[.!?:;»")]$/.test(l) || cur.length > 260 || (/^[A-ZА-ЯЁ0-9«"•\-–]/.test(next) && !/[,\-–(]$/.test(l))) { out.push(cur); cur = ''; }
  });
  if (cur) out.push(cur);
  return out;
}
async function readPdf(file, draft, n0) {
  busy('Открываю PDF…');
  const lib = await pdfLib();
  const pdf = await lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const pages = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    busy(`Читаю «${file.name}»: страница ${i} из ${pdf.numPages}`);
    const pg = await pdf.getPage(i), v1 = pg.getViewport({ scale: 1 });
    const vp = pg.getViewport({ scale: Math.min(3, 1600 / v1.width) });
    const cv = document.createElement('canvas'); cv.width = Math.round(vp.width); cv.height = Math.round(vp.height);
    const cx = cv.getContext('2d'); cx.fillStyle = '#fff'; cx.fillRect(0, 0, cv.width, cv.height);
    await pg.render({ canvasContext: cx, viewport: vp }).promise;
    pages.push({ lines: pageLines(await pg.getTextContent()), img: await canvasBlob(cv) });
  }
  // строки, которые есть почти на каждой странице (водяные знаки, колонтитулы), и e-mail/сайты — убрать
  const freq = new Map(); pages.forEach(p => new Set(p.lines).forEach(l => freq.set(l, (freq.get(l) || 0) + 1)));
  const junk = l => (pages.length > 2 && freq.get(l) > pages.length / 2) || /\S+@\S+\.\S+|https?:\/\/|www\./i.test(l) || /^\d{1,3}$/.test(l);
  pages.forEach((p, i) => {
    const lines = p.lines.filter(l => !junk(l)); draft.text += ' ' + lines.join(' ');
    // первая строка документа без точки в конце — заголовок, это название работы
    if (i === 0 && !draft.name && lines.length > 1 && lines[0].length <= 90 && !/[.:;,]$/.test(lines[0])) draft.name = lines.shift();
    const st = linesToSteps(lines);
    if (!st.length) draft.steps.push({ text: `Страница ${i + 1}`, img: p.img, rot: 0 });
    else st.forEach((t, j) => draft.steps.push({ text: t, img: j === 0 ? p.img : null, rot: 0 }));
  });
  draft.instr += (draft.instr ? '\n' : '') + `Загружено из «${file.name}» (${pdf.numPages} стр.)`;
}
const dataToBlob = async d => (await fetch(d)).blob();
async function readWorkFile(file, draft) {
  const d = JSON.parse(await file.text());
  if (d.format !== 'repair-ref-work') throw new Error('«' + file.name + '» — это не файл работы. Резервная копия базы загружается через ⋮ → «Загрузить резервную копию».');
  const imgs = await Promise.all((d.photos || []).map(p => dataToBlob(p.data)));
  Object.assign(draft, { name: d.name || draft.name, brandName: d.brand || '', modelName: d.model || '', group: d.group || '', fixed: true });
  draft.instr = d.instr || ''; draft.note = d.note || ''; draft.codes = d.codes || [];
  draft.text += ' ' + (d.name || '') + ' ' + (d.instr || '');
  (d.steps || []).forEach(s => draft.steps.push({ text: s.text || '', img: s.photo != null ? imgs[s.photo] : null, rot: 0, cap: s.photo != null && d.photos[s.photo].cap || '' }));
}

/* ---------- Куда положить: марка, модель, раздел, название ---------- */
const GROUP_HINTS = [
  [/конфигурац|кодиров|прописк|прошив|блок[аи]? управ|gateway|cgw/i, 'Электрооборудование / Кодирование и прописка'],
  [/сажев|dpf|fap|egr|егр|прожиг/i, 'Двигатель / Выпуск и сажевый фильтр'],
  [/адаптац|сброс|обучени/i, 'Электрооборудование / Адаптации и сбросы'],
  [/тормоз|колодк|abs/i, 'Тормозная система'], [/подвеск|амортиз|рычаг|сайлент/i, 'Подвеска'], [/рулев/i, 'Рулевое управление'],
  [/кондиц|отопит|климат|фреон/i, 'Кондиционер и отопитель'], [/акпп|мкпп|вариатор|коробк|трансмис|сцеплен/i, 'Трансмиссия'],
  [/грм|свеч|форсун|двигател|турбин/i, 'Двигатель'], [/кузов|стекл|двер|салон|пластик/i, 'Кузов и стёкла'],
  [/масл|фильтр|то-?\d|обслуживан/i, 'Техническое обслуживание']
];
const wordRx = w => new RegExp('(^|[^a-zа-яё0-9])' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '($|[^a-zа-яё0-9])', 'i');
function guessShelf(draft, c) {
  const t = norm(draft.name + ' ' + draft.text + ' ' + draft.files.join(' '));
  let best = null, bestLen = 0;
  if (!draft.brandName) for (const b of DB.brands) for (const w of [b.name].concat(akaOf(b).split(',')).map(x => norm(x).trim()).filter(x => x.length >= 2))
    if (w.length > bestLen && wordRx(w).test(t)) { best = b; bestLen = w.length; }
  if (!draft.brandName) draft.brandName = best ? best.name : c.brand ? c.brand.name : '';
  const b = DB.brands.find(x => norm(x.name) === norm(draft.brandName));
  if (b && !draft.modelName) {
    let m = null;
    for (const x of b.models) if (wordRx(norm(x.name)).test(t) && (!m || x.name.length > m.name.length)) m = x;
    if (!m) { // модели нет в базе — взять слово после марки («Mitsubishi L200» → L200), будет создана
      const mm = t.match(new RegExp(norm(b.name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s+([a-z]{0,4}[\\-]?\\d{1,4}[a-z]{0,3})', 'i'));
      if (mm) { const raw = (draft.name + ' ' + draft.text).match(new RegExp(mm[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')); m = { name: raw ? raw[0].toUpperCase() : mm[1].toUpperCase() }; }
    }
    draft.modelName = m ? m.name : (c.brand === b && c.model ? c.model.name : '');
  }
  if (!draft.group) { const g = GROUP_HINTS.find(([rx]) => rx.test(t)); draft.group = g ? g[1] : (c.groups.length ? c.groups.join(' / ') : 'Прочее'); }
  if (!draft.codes.length) draft.codes = [...new Set((draft.text.toUpperCase().match(/\b[PCBU][0-9][0-9A-F]{3}\b/g) || []))];
  const longs = [...new Set((draft.text.match(/\b\d{20,}\b/g) || []))];
  if (longs.length && !draft.fixed) draft.note = (draft.note ? draft.note + '\n' : '') + 'Коды из документа (сверить): ' + longs.join(', ');
}
function defaultName(draft) {
  const f = draft.files[0] || '', base = f.replace(/\.[^.]+$/, '');
  if (base && !/^(img|image|photo|scan|dsc|pxl|снимок|фото|документ)?[\s_\-]*[\d\s_\-()]*$/i.test(base)) return base.replace(/[_]+/g, ' ');
  const s = draft.steps.find(s => s.text && s.text.length >= 8 && !/^Страница|^Шаг/.test(s.text));
  return s ? s.text.slice(0, 70).replace(/[.:]$/, '') : 'Инструкция от ' + new Date().toLocaleDateString('ru-RU');
}

/* ---------- Окно проверки перед сохранением ---------- */
function reviewDraft(draft) {
  return new Promise(res => {
    const brands = DB.brands.map(b => b.name);
    const b0 = DB.brands.find(x => norm(x.name) === norm(draft.brandName));
    const groups = b0 ? allGroups(worksFor(b0.id, null)) : [];
    const urls = draft.steps.map(s => s.img ? URL.createObjectURL(s.img) : '');
    const m = modal(`<h3>Новая работа из файла</h3>
      <div class="hint">Программа сама подобрала, куда положить. Проверьте и поправьте.</div>
      <label for="d_name">Название работы</label><input id="d_name" value="${esc(draft.name)}" autocomplete="off">
      <label for="d_brand">Марка</label><input id="d_brand" value="${esc(draft.brandName)}" list="d_bl" autocomplete="off"><datalist id="d_bl">${brands.map(x => `<option value="${esc(x)}">`).join('')}</datalist>
      <label for="d_model">Модель (пусто — для всех моделей марки)</label><input id="d_model" value="${esc(draft.modelName)}" list="d_ml" autocomplete="off"><datalist id="d_ml">${b0 ? b0.models.map(x => `<option value="${esc(x.name)}">`).join('') : ''}</datalist>
      <label for="d_group">Раздел (через « / »)</label><input id="d_group" value="${esc(draft.group)}" list="d_gl" autocomplete="off"><datalist id="d_gl">${groups.map(x => `<option value="${esc(x)}">`).join('')}</datalist>
      ${draft.codes.length ? `<div class="hint">Найдены коды ошибок: ${esc(draft.codes.join(', '))} — привяжутся к работе.</div>` : ''}
      <h3>Пункты (${draft.steps.length})</h3>
      <div class="hint">⟳ — повернуть фото, ✕ — убрать пункт. Текст можно поправить.</div>
      <div class="dsteps">${draft.steps.map((s, i) => `<div class="dstep" data-i="${i}">
        ${s.img ? `<div class="dimg"><img src="${urls[i]}" alt="" style="transform:rotate(${s.rot}deg)"></div>` : ''}
        <div class="dtx"><b>${i + 1}.</b><textarea rows="2" data-t="${i}">${esc(s.text)}</textarea>
        <div class="dbt">${s.img ? `<button class="mini" data-rot="${i}" aria-label="Повернуть">⟳</button>` : ''}<button class="mini del" data-x="${i}" aria-label="Убрать">✕</button></div></div></div>`).join('')}</div>
      <div class="btns"><button class="pri" data-ok="1">Сохранить в справочник</button><button data-c="1">Отмена</button></div>`);
    const done = r => { urls.forEach(u => u && URL.revokeObjectURL(u)); m.remove(); res(r); };
    m.querySelectorAll('[data-rot]').forEach(b => b.onclick = () => { const s = draft.steps[b.dataset.rot]; s.rot = (s.rot + 90) % 360; m.querySelector(`.dstep[data-i="${b.dataset.rot}"] img`).style.transform = `rotate(${s.rot}deg)`; });
    m.querySelectorAll('[data-x]').forEach(b => b.onclick = () => { draft.steps[b.dataset.x].gone = true; m.querySelector(`.dstep[data-i="${b.dataset.x}"]`).remove(); });
    m.querySelector('[data-c]').onclick = () => done(null);
    m.querySelector('[data-ok]').onclick = () => {
      const val = id => m.querySelector(id).value.trim();
      if (!val('#d_name')) return m.querySelector('#d_name').focus();
      if (!val('#d_brand')) return m.querySelector('#d_brand').focus();
      m.querySelectorAll('[data-t]').forEach(t => draft.steps[t.dataset.t].text = t.value.trim());
      Object.assign(draft, { name: val('#d_name'), brandName: val('#d_brand'), modelName: val('#d_model'), group: val('#d_group') || 'Прочее' });
      done(draft);
    };
  });
}

/* ---------- Сохранение ---------- */
async function rotatedPhoto(blob, rot) {
  const img = await loadImage(blob), K = PHOTO_KINDS.params;
  const k = Math.min(1, K.max / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.round(img.naturalWidth * k), h = Math.round(img.naturalHeight * k), side = rot % 180 !== 0;
  const cv = document.createElement('canvas'); cv.width = side ? h : w; cv.height = side ? w : h;
  const cx = cv.getContext('2d'); cx.translate(cv.width / 2, cv.height / 2); cx.rotate(rot * Math.PI / 180); cx.drawImage(img, -w / 2, -h / 2, w, h);
  return { blob: await canvasBlob(cv, K.q), w: cv.width, h: cv.height };
}
async function saveDraft(d) {
  let b = DB.brands.find(x => norm(x.name) === norm(d.brandName));
  if (!b) { b = { id: newId('b'), name: d.brandName, models: [] }; DB.brands.push(b); }
  let m = null;
  if (d.modelName) { m = b.models.find(x => norm(x.name) === norm(d.modelName)); if (!m) { m = { id: newId('m'), name: d.modelName }; b.models.push(m); } }
  const steps = [], photos = [], list = d.steps.filter(s => !s.gone);
  for (let i = 0; i < list.length; i++) {
    const s = list[i], st = { id: newId('s'), text: s.text || 'Шаг ' + (i + 1), sub: [] };
    if (s.img) {
      busy(`Сохраняю фото ${i + 1} из ${list.length}`);
      const r = await rotatedPhoto(s.img, s.rot), id = newId('ph');
      await Store.set(id, r.blob, 'photos');
      photos.push({ id, kind: 'params', star: false, cap: s.cap || ('Пункт ' + (i + 1) + ': ' + st.text).slice(0, 80), w: r.w, h: r.h, size: r.blob.size, orig: s.img.size, added: new Date().toISOString() });
      st.photo = id;
    }
    steps.push(st);
  }
  const w = { id: newId('w'), brand: b.id, model: m ? m.id : null, name: d.name, group: d.group, hours: null, price: null,
    note: d.note, instr: d.instr, steps, params: [], photos, codes: d.codes };
  DB.items.push(w); await save(); busy();
  try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch (e) {}
  goPath([{ type: 'brand', id: b.id }].concat(b.models.length ? [{ type: 'model', id: m ? m.id : null }] : []).concat({ type: 'work', id: w.id }));
  toast(`Работа сохранена: ${steps.length} пунктов, ${photos.length} фото`);
}

/* ---------- Точка входа: выбрать файлы ---------- */
function importInstruction() {
  const inp = document.createElement('input');
  inp.type = 'file'; inp.multiple = true; inp.accept = '.pdf,application/pdf,image/*,.json,application/json';
  inp.hidden = true; document.body.appendChild(inp); // без этого браузер может «потерять» выбор файла
  inp.onchange = async () => {
    const files = [...inp.files]; inp.remove(); if (!files.length) return;
    const c = ctx(), draft = { name: '', brandName: '', modelName: '', group: '', instr: '', note: '', codes: [], steps: [], text: '', files: files.map(f => f.name) };
    try {
      // фото — по времени съёмки, PDF и файлы работ — по порядку выбора
      const imgs = files.filter(f => f.type.startsWith('image/')).sort((a, b) => a.lastModified - b.lastModified);
      for (const f of files) {
        if (/\.json$/i.test(f.name) || f.type === 'application/json') await readWorkFile(f, draft);
        else if (/\.pdf$/i.test(f.name) || f.type === 'application/pdf') await readPdf(f, draft);
      }
      imgs.forEach((f, i) => draft.steps.push({ text: 'Шаг ' + (draft.steps.length + 1), img: f, rot: 0 }));
      busy();
      if (!draft.steps.length) return toast('В файлах не нашлось ни текста, ни фото');
      guessShelf(draft, c); if (!draft.name) draft.name = defaultName(draft);
      const r = await reviewDraft(draft); if (!r) return;
      await saveDraft(r);
    } catch (e) { busy(); ask('Не удалось загрузить: ' + e.message, [{ k: 1, t: 'Понятно' }]); }
  };
  inp.click();
}
