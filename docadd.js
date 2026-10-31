/* Справочник ремонта — добавление техдока (0.9.0): PDF → оглавление, заголовки страниц,
   модель, полка, название, год определяются сами; перед сохранением — окно проверки.
   Каталог своих документов: DB.docsUser; заголовки страниц: kv 'docpages'; файлы до 30 МБ: хранилище 'files'. */
'use strict';

const EMBED_MAX = 30 * 1048576;
const SH = { K: 'Коды конфигураций', B: 'Бюллетени и софт', Z: 'Замена блоков и прописка', TO: 'ТО и регламент', Q: 'Быстрый справочник (моменты затяжки)',
  MEH: 'Двигатель — механика', ESU: 'Двигатель — электронное управление', TR: 'Трансмиссия', AWD: 'Полный привод', CH: 'Шасси (подвеска, тормоза, рулевое)',
  KU: 'Кузов', KR: 'Кузовной ремонт', EL: 'Электрооборудование', SX: 'Электросхемы', TB: 'Телематика (T-Box)', DOP: 'Доп. оборудование' };
// [правило, полка, вес] — вес выше у признаков, которые почти не встречаются в чужих мануалах
// [правило, полка, вес, где искать явный признак: 0 — имя/заголовок/оглавление, 1 — только имя/заголовок] (как в sergsknarin Автосервис 0.33.23)
const SHELF_RULES = [
  [/коды конфигураций|kody[- _]konfigur/i, SH.K, 9, 1], [/сервисн\S* кампани|бюллетен|sdb-|прошивк|\bcbf\b|_asw\d|\btcu\s+\d/i, SH.B, 8, 1],
  [/замен\S* электронн\S* блок|сопоставлени\S* ecu|согласовани\S* .{0,20}блок|zamen\S*[- _]elektronn/i, SH.Z, 10, 0],
  [/монтажн\S* карт|wiring[- _]diagram|\bewd\b/i, SH.SX, 7, 2],
  [/руководство по техническому обслуживанию|rukovodstvo[- _]po[- _]tehnicheskomu|предметы техническ|\d+\s+техническ\S* обслуживани/i, SH.TO, 7, 0],
  [/torque specifications|моменты затяжки|сокращения модуля|quick[- _]reference/i, SH.Q, 6, 0],
  [/листов\S* металл|sheet metal|кузовн\S* ремонт|kuzovnoj[- _]remont|ремонт\S* пластиков/i, SH.KR, 6, 0],
  [/t-?box|телематич/i, SH.TB, 6, 0], [/starline|сигнализац|охранно-телемат/i, SH.DOP, 6, 0],
  [/управлени\S* двигател|электронн\S* систем\S* двигател|электронн\S* управлени|electronic[- _]control|эл\.? ?упр|el ypr/i, SH.ESU, 3, 0],
  [/механическ\S* систем\S* двигател|руководство по двигател|mechanical[- _]manual|meh[- _]sistema|mehanicheskaya|систем\S* смазки|систем\S* охлаждени/i, SH.MEH, 3, 0],
  [/4wd|полн\S* привод|раздаточн/i, SH.AWD, 3, 0],
  [/коробк\S* передач|трансмисси|\d{3}d[hb][a-z]|[67] ?dct|сцеплени|[56]mt|\d{3}aha|clutch/i, SH.TR, 2, 0],
  [/шасси|подвеск|тормозн|рулев|abs\/esp|chass|shassi/i, SH.CH, 2, 0],
  [/электрооборудовани|elektrooborud|electrical[- _]manual|электротехник/i, SH.EL, 6, 1], [/электрическая система|корпус электрическ/i, SH.EL, 3, 0],
  [/кузов|стекл|капот|сидени|интерьер|приборная панель|люк в крыше|engine hood|body|kuzov/i, SH.KU, 1, 0]
];
// границы слова: буквы/цифры (а «_» и «-» в именах файлов — разделители)
const NB = '(?<![a-zа-яё0-9])', NA = '(?![a-zа-яё0-9])';
const MODEL_RULES = [ // [regex, модель] — по имени файла, заголовку и первым страницам
  [new RegExp('x70\\s*plus|x70plus', 'i'), 'X70 Plus'], [new RegExp('x70\\s*fl|x70fl', 'i'), 'X70'], [new RegExp(NB + '[xх]\\s*70' + NA, 'i'), 'X70'],
  [new RegExp(NB + '(jt)?[xх]\\s*50' + NA, 'i'), 'X50'], [new RegExp(NB + '[xх]\\s*90', 'i'), 'X90 Plus'], [/dashing|дашинг/i, 'Dashing'],
  [new RegExp(NB + 'g700' + NA, 'i'), 'G700'], [new RegExp(NB + '[tт]\\s*1l?' + NA, 'i'), 'T1'], [new RegExp(NB + '[tт]\\s*2' + NA, 'i'), 'T2']
];
const MODEL_DIR = { 'T1': 'т 1', 'T2': 'т2', 'X50': 'х50', 'X70': 'х70', 'X70 Plus': 'х70', 'Dashing': 'дашинг', 'X90 Plus': 'х-90 +', 'G700': 'g700' };
const CODE_RX = /\b(SQR[A-Z0-9]{5,8}|F4J1[56]|F4J20|E4T15C|E4G15C|G4J15|\d{3}D[HB][A-Z]|\d{3}AHA|[67]DCT|6MT|5MF17J)\b/g;

/* ---------- Хранилище своих документов ---------- */
const userDocs = () => (DB.docsUser = DB.docsUser || []);
let userPages = null;
async function userDocPages() { if (!userPages) userPages = (await Store.get('docpages')) || {}; return userPages; }
async function saveUserPages() { await Store.set('docpages', userPages || {}); }

/* ---------- Чтение PDF ---------- */
async function readDocPdf(file) {
  const lib = await pdfLib();
  const pdf = await lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  let title = ''; try { const md = await pdf.getMetadata(); title = (md.info && md.info.Title || '').trim(); } catch (e) {}
  const toc = [];
  try {
    const walk = async (items, dep) => {
      for (const it of items || []) {
        let p = null;
        try { const dest = typeof it.dest === 'string' ? await pdf.getDestination(it.dest) : it.dest; if (dest && dest[0]) p = (await pdf.getPageIndex(dest[0])) + 1; } catch (e) {}
        if (it.title && it.title.trim() && it.title.trim() !== 'Пустая страница' && p) toc.push([dep, it.title.trim().slice(0, 120), p]);
        if (toc.length < 400) await walk(it.items, dep + 1);
      }
    };
    await walk(await pdf.getOutline(), 0);
  } catch (e) {}
  const lines = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    if (i % 20 === 1) busy(`Читаю «${file.name}»: страница ${i} из ${pdf.numPages}`);
    try { lines.push(pageLines(await (await pdf.getPage(i)).getTextContent())); } catch (e) { lines.push([]); }
  }
  const freq = new Map(); lines.forEach(ls => new Set(ls.slice(0, 6).concat(ls.slice(-4))).forEach(l => freq.set(l, (freq.get(l) || 0) + 1)));
  const rep = l => lines.length > 6 && freq.get(l) > lines.length * 0.3;
  const heads = lines.map(ls => ls.filter(l => !rep(l) && !/^[\d\s\-–./]+$/.test(l) && l.length > 3).slice(0, 3).join(' | ').slice(0, 140));
  return { pages: pdf.numPages, title, toc, heads, first: lines.slice(0, 3).flat().join(' ').slice(0, 3000), early: lines.slice(0, 40).flat().join(' ') };
}

/* ---------- Распознать: полка, модель, название, год ---------- */
function classifyDoc(file, info, c) {
  const toc0 = info.toc.filter(x => x[0] <= 2).slice(0, 80).map(x => x[1]).join(' ');
  const name = [file.webkitRelativePath || '', file.name.replace(/[_]+/g, ' '), info.title].join(' ');
  const top = name + ' ' + toc0;
  const small = info.pages <= 40 ? ' ' + info.first : ''; // у больших мануалов первые страницы — «Содержание» со всеми системами
  const cnt = (r, t) => (t.match(r) || []).length;
  let best = null, bestScore = 0, sure = null, sureScore = 0;
  for (const [rx, shelf, w, scope] of SHELF_RULES) {
    const r = new RegExp(rx.source, 'gi'), r1 = new RegExp(rx.source, 'i');
    const st = cnt(r, (scope === 1 ? name : top) + (scope === 2 ? ' ' + info.first : small)); // 2 — признак и на первых страницах любого файла
    if (w >= 6 && st && st * w > sureScore) { sure = shelf; sureScore = st * w; }
    const s = scope === 1 ? cnt(r, name) * 8 * w : (cnt(r, top) * 8 + cnt(r, info.first) * 2 + Math.min(25, info.heads.filter(h => r1.test(h)).length)) * w;
    if (s > bestScore) { best = shelf; bestScore = s; }
  }
  if (sure) best = sure;
  const mScore = new Map();
  const nameText = ((file.webkitRelativePath || '') + ' ' + file.name + ' ' + info.title).replace(/[_]+/g, ' ');
  for (const [rx, m] of MODEL_RULES) {
    const r = new RegExp(rx.source, 'gi');
    const s = (nameText.match(r) || []).length * 10 + (info.first.match(r) || []).length * 2 + Math.min(4, ((info.early || '').match(r) || []).length);
    if (s) mScore.set(m, (mScore.get(m) || 0) + s);
  }
  const fl = /x70\s*fl/i.test(nameText + ' ' + (info.early || ''));
  if (mScore.get('X70 Plus') && !fl && mScore.get('X70')) { mScore.set('X70 Plus', mScore.get('X70 Plus') + mScore.get('X70')); mScore.delete('X70'); } // есть «PLUS» и нет «FL» — X70 Plus
  const ctxModel = c.model ? c.model.name : '';
  // модель из файла важнее той, в которой сейчас открыта документация; если в файле ничего нет — берём открытую
  let models = [...mScore].filter(([, s]) => s >= 2).sort((a, b) => b[1] - a[1]).map(x => x[0]).slice(0, 1);
  if (ctxModel && (!models.length || (mScore.get(ctxModel) || 0) >= (mScore.get(models[0]) || 0))) models = [ctxModel];
  if (best === SH.K && models.length === 1 && /^X70/.test(models[0]) && /x70\s*plus/i.test(info.first)) models = ['X70', 'X70 Plus'];
  if (best === SH.TO || best === SH.Z) models = [];
  const codes = {}; ((info.title + ' ' + info.toc.map(x => x[1]).join(' ') + ' ' + info.heads.join(' ')).toUpperCase().match(CODE_RX) || []).forEach(k => codes[k] = (codes[k] || 0) + 1);
  const code = Object.entries(codes).sort((a, b) => b[1] - a[1]).map(x => x[0])[0] || '';
  const base = { [SH.ESU]: 'ЭСУД', [SH.MEH]: 'Двигатель — механика', [SH.TR]: 'КПП', [SH.SX]: 'Электросхемы', [SH.KU]: 'Кузов', [SH.CH]: 'Шасси',
    [SH.EL]: 'Электрооборудование', [SH.KR]: 'Кузовной ремонт', [SH.TB]: 'Телематическая система T-Box', [SH.AWD]: 'Система 4WD', [SH.TO]: 'Руководство по техническому обслуживанию', [SH.Q]: 'Быстрый справочник: моменты затяжки, данные' }[best];
  const nice = (info.title && !/main book title|^t\d|^[\d\s]+$/i.test(info.title)) ? info.title : file.name.replace(/\.pdf$/i, '').replace(/[_]+/g, ' ');
  let title = base ? base + ([SH.ESU, SH.MEH, SH.TR].includes(best) && code ? ' ' + code : '') : nice;
  if (best === SH.K && models[0]) title = 'Коды конфигураций ' + models[0];
  const y = (file.name.match(/20[12]\d/) || info.title.match(/20[12]\d/) || info.first.match(/\b(20[12]\d)\s*MY\b/i) || [])[0] || '';
  return { shelf: best || SH.DOP, models, title, year: y ? y.slice(0, 4) : '' };
}

/* ---------- Окно проверки ---------- */
function reviewDoc(file, info, g, dup) {
  return new Promise(res => {
    const shelves = (window.DOCS && DOCS.shelves) || Object.values(SH);
    const brand = ctx().brand, allModels = brand ? brand.models.map(m => m.name) : [];
    const big = file.size > EMBED_MAX, path = (g.models[0] && MODEL_DIR[g.models[0]] ? MODEL_DIR[g.models[0]] + '/' : '') + file.name;
    const m = modal(`<h3>Новый документ</h3>
      <div class="hint">«${esc(file.name)}» · ${info.pages} стр. · ${fmtSize(file.size)} · в оглавлении ${info.toc.length} пунктов.<br>Программа сама определила, куда положить. Проверьте.</div>
      ${dup ? `<div class="hint"><b>Похоже, такой уже есть:</b> ${esc(dup.title)} (${esc(dup.models.join(', ') || 'все')}).</div>` : ''}
      <label for="n_title">Название</label><input id="n_title" value="${esc(g.title)}" autocomplete="off">
      <label for="n_shelf">Полка</label><input id="n_shelf" value="${esc(g.shelf)}" list="n_sl" autocomplete="off"><datalist id="n_sl">${shelves.map(s => `<option value="${esc(s)}">`).join('')}</datalist>
      <label for="n_models">Модели через запятую (пусто — все модели марки)</label><input id="n_models" value="${esc(g.models.join(', '))}" list="n_ml" autocomplete="off"><datalist id="n_ml">${allModels.map(s => `<option value="${esc(s)}">`).join('')}</datalist>
      <label for="n_year">Год</label><input id="n_year" value="${esc(g.year)}" inputmode="numeric" autocomplete="off">
      <label class="star"><input type="checkbox" id="n_emb" ${big ? '' : 'checked'}> Хранить внутри программы (откроется и на телефоне)${big ? ' — файл большой, лучше ссылкой' : ''}</label>
      <label for="n_path">Если ссылкой — где файл в папке техдока</label><input id="n_path" value="${esc(path)}" autocomplete="off">
      <div class="btns"><button class="pri" data-ok="1">Добавить</button><button data-skip="1">Пропустить</button></div>`);
    const v = id => m.querySelector(id).value.trim();
    m.querySelector('[data-skip]').onclick = () => { m.remove(); res(null); };
    m.querySelector('[data-ok]').onclick = () => {
      if (!v('#n_title')) return m.querySelector('#n_title').focus();
      const r = { title: v('#n_title'), shelf: v('#n_shelf') || SH.DOP, models: v('#n_models').split(',').map(s => s.trim()).filter(Boolean), year: v('#n_year'), embed: m.querySelector('#n_emb').checked, rel: v('#n_path').replace(/\\/g, '/') };
      m.remove(); res(r);
    };
  });
}

/* ---------- Добавить ---------- */
function addDocs() {
  const c = ctx();
  if (!c.brand) return toast('Сначала откройте марку');
  const inp = document.createElement('input'); inp.type = 'file'; inp.multiple = true; inp.accept = '.pdf,application/pdf'; inp.hidden = true;
  document.body.appendChild(inp);
  inp.onchange = async () => {
    const files = [...inp.files]; inp.remove(); let added = 0;
    for (const f of files) {
      try {
        busy('Открываю «' + f.name + '»…');
        const info = await readDocPdf(f); busy();
        const g = classifyDoc(f, info, c);
        const dup = docsAll().find(d => d.size === f.size && d.pages === info.pages);
        if (dup) Object.assign(g, { shelf: dup.shelf, models: dup.models.slice(), title: dup.title, year: dup.year }); // такой уже есть — подставить, как он разложен
        const r = await reviewDoc(f, info, g, dup); if (!r) continue;
        const id = newId('u');
        const d = { id, brand: c.brand.name, models: r.models, shelf: r.shelf, title: r.title, year: r.year, rel: r.embed ? f.name : r.rel, pages: info.pages, size: f.size, toc: info.toc, user: true, added: new Date().toISOString() };
        if (r.embed) { d.blob = true; if (!await Store.set('docf_' + id, f, 'files')) { toast('Не удалось сохранить файл'); continue; } }
        const P = await userDocPages(); P[id] = info.heads; await saveUserPages();
        userDocs().push(d); await save(); added++;
      } catch (e) { busy(); ask('Не удалось прочитать «' + f.name + '»: ' + e.message, [{ k: 1, t: 'Понятно' }]); }
    }
    busy(); if (added) { render(); toast('Добавлено документов: ' + added); }
  };
  inp.click();
}
async function removeUserDoc(d) {
  if (!await confirmBox(`Удалить «${d.title}» из документации?` + (d.blob ? '\nФайл внутри программы тоже удалится.' : '\nФайл на диске останется.'), 'Удалить', 'danger')) return;
  DB.docsUser = userDocs().filter(x => x.id !== d.id); await save();
  const P = await userDocPages(); delete P[d.id]; await saveUserPages();
  if (d.blob) await delFileBlob('docf_' + d.id);
  history.back(); toast('Удалено');
}
async function editUserDoc(d) {
  const r = await formBox('Документ', [{ k: 'title', label: 'Название' }, { k: 'shelf', label: 'Полка', list: (window.DOCS && DOCS.shelves) || Object.values(SH) },
    { k: 'models', label: 'Модели через запятую (пусто — все)' }, { k: 'year', label: 'Год' }], { ...d, models: d.models.join(', ') });
  if (!r) return;
  Object.assign(d, { title: r.title, shelf: r.shelf, models: r.models.split(',').map(s => s.trim()).filter(Boolean), year: r.year }); await save(); render();
}
function delFileBlob(key) {
  return new Promise(res => { if (!Store.db) return res(); const tx = Store.db.transaction('files', 'readwrite'); tx.objectStore('files').delete(key); tx.oncomplete = tx.onerror = () => res(); });
}
async function openUserDoc(d, page) {
  const b = await Store.get('docf_' + d.id, 'files'); if (!b) return toast('Файл не найден в программе');
  const u = URL.createObjectURL(b.type ? b : new Blob([b], { type: 'application/pdf' }));
  window.open(u + (page ? '#page=' + page : ''), '_blank'); setTimeout(() => URL.revokeObjectURL(u), 600000);
}
