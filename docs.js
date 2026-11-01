/* Справочник ремонта — документация (0.8.0): техдок по моделям, полки, оглавление, поиск до страницы.
   Каталог — data/docs.js (window.DOCS), заголовки страниц для поиска — data/docs-pages.js (грузится по запросу).
   Большие PDF лежат на диске (папка задаётся в настройках), маленькие — внутри программы (папка docs/). */
'use strict';

const DOCS_BASE_DEFAULT = 'file:///F:/Jetour/1 Мануалы/техдок 18,08,2026/'; // с 0.12.1 — после раскладки флешки
const docsBase = () => { let b = LS.get('docsBase', '') || (window.DOCS && DOCS.base) || DOCS_BASE_DEFAULT; return b.endsWith('/') ? b : b + '/'; };
const docsAll = () => ((window.DOCS && DOCS.docs) || []).concat((typeof DB !== 'undefined' && DB && DB.docsUser) || []); // свои документы — docadd.js
// Документы для марки/модели: у документа brand и models[] (пусто — вся марка)
function docsFor(c) {
  if (!c.brand) return [];
  return docsAll().filter(d => norm(d.brand) === norm(c.brand.name) && (!c.model || !d.models.length || d.models.some(m => norm(m) === norm(c.model.name))));
}
const encPath = p => p.split('/').map(encodeURIComponent).join('/');
function docUrl(d, page) {
  const u = d.embed ? 'docs/' + encPath(d.embed) : docsBase() + encPath(d.rel);
  return u + (page ? '#page=' + page : '');
}
function openDoc(d, page) {
  if (d.blob) return openUserDoc(d, page);
  const a = document.createElement('a'); a.href = docUrl(d, page); a.target = '_blank'; a.rel = 'noopener';
  document.body.appendChild(a); a.click(); a.remove();
  if (!d.embed) toast('Открываю: ' + d.title + (page ? ', стр. ' + page : '') + '. Не открылось — проверьте папку техдока (⚙ в Документации).');
}
let pagesLoading = null;
function docPages() {
  const base = window.DOCS_PAGES ? Promise.resolve(window.DOCS_PAGES) : (pagesLoading = pagesLoading || loadScript('data/docs-pages.js').then(() => window.DOCS_PAGES || {}));
  return Promise.all([base, userDocPages()]).then(([a, b]) => Object.assign({}, a, b));
}
const fmtSize = b => b >= 1048576 ? (b / 1048576).toFixed(0) + ' МБ' : Math.max(1, Math.round(b / 1024)) + ' КБ';
const docRowText = d => (d.embed || d.blob ? '📎 ' : '') + (d.user ? '🆕 ' : '') + esc(d.title);
const docSub = d => [d.models.length ? d.models.join(', ') : 'все модели', d.year, d.pages ? d.pages + ' стр.' : '', fmtSize(d.size), d.embed || d.blob ? 'внутри программы' : ''].filter(Boolean).join(' · ');

/* ---------- Список: полки ---------- */
function renderDocs(v, c) {
  const list = docsFor(c), shelves = new Map();
  (window.DOCS && DOCS.shelves || []).forEach(s => shelves.set(s, []));
  list.forEach(d => { if (!shelves.has(d.shelf)) shelves.set(d.shelf, []); shelves.get(d.shelf).push(d); });
  const h = {};
  let html = `<div class="codein"><input id="docQ" placeholder="Найти в документации: сцепление, P0300, CGW…" autocomplete="off"><button id="docSet" aria-label="Папка техдока" title="Где лежит техдок">⚙</button></div><div id="docRes"></div><div id="docShelves"><button class="add" id="docAdd">＋ Добавить документ (PDF) — разложится сам</button>`;
  if (!list.length) html += '<div class="empty">Для этой машины документации пока нет</div>';
  for (const [s, ds] of shelves) {
    if (!ds.length) continue;
    html += `<h2>${esc(s)} ${ds.length}</h2>` + rowsHtml(ds.map(d => { h[d.id] = () => go({ type: 'doc', id: d.id }); return { k: d.id, t: docRowText(d), s: docSub(d) }; }));
  }
  v.innerHTML = html + '</div>';
  bindRows($('#docShelves'), h);
  $('#docSet').onclick = docsSettings;
  $('#docAdd').onclick = addDocs;
  const q = $('#docQ'); let t;
  q.oninput = () => { clearTimeout(t); t = setTimeout(() => docSearch(q.value.trim(), list, $('#docRes'), $('#docShelves')), 250); };
}
async function docSearch(raw, list, box, shelvesEl) {
  shelvesEl.hidden = !!raw; if (!raw) { box.innerHTML = ''; return; }
  const vs = qVariants(raw.toLowerCase());
  box.innerHTML = '<div class="muted">Ищу…</div>';
  const P = await docPages(), hits = [];
  for (const d of list) {
    (d.toc || []).forEach(([dep, t, p]) => { if (hasAny(vs, t)) hits.push({ d, p, t, w: 3 }); });
    if (hasAny(vs, d.title)) hits.push({ d, p: 1, t: d.title, w: 4 });
    (P[d.id] || []).forEach((t, i) => { if (t && hasAny(vs, t)) hits.push({ d, p: i + 1, t, w: 1 }); });
  }
  // по одной строке на страницу документа, сначала оглавление
  const seen = new Set(), out = hits.sort((a, b) => b.w - a.w).filter(x => { const k = x.d.id + ':' + x.p; if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 150);
  const h = {};
  box.innerHTML = out.length ? `<h2>Найдено: ${out.length}${out.length === 150 ? '+' : ''}</h2>` + rowsHtml(out.map((x, i) => {
    h['r' + i] = () => openDoc(x.d, x.p);
    return { k: 'r' + i, t: esc(x.t.split(' | ').slice(0, 2).join(' — ').slice(0, 120)), s: esc(x.d.title) + (x.d.models.length ? ' (' + esc(x.d.models.join(', ')) + ')' : '') + ' · стр. ' + x.p + (x.w >= 3 ? ' · оглавление' : '') };
  })) : '<div class="empty">Ничего не найдено</div>';
  bindRows(box, h);
}
async function docsSettings() {
  const r = await formBox('Где лежит техдок на этом устройстве', [{ k: 'base', label: 'Папка (на ПК, например F:/Jetur/техдок 18,08,2026)' }],
    { base: decodeURI(docsBase()).replace(/^file:\/\/\//, '') });
  if (!r) return;
  let b = r.base.replace(/\\/g, '/').trim();
  if (b && !/^[a-z]+:\/\//i.test(b)) b = 'file:///' + b.replace(/^\/+/, '');
  LS.set('docsBase', b ? encodeURI(decodeURI(b)) : ''); toast('Папка техдока сохранена');
}

/* ---------- Документ: оглавление ---------- */
function renderDoc(v, c, id) {
  const d = docsAll().find(x => x.id === id);
  if (!d) { v.innerHTML = '<div class="empty">Документ не найден</div>'; return; }
  const h = {};
  v.innerHTML = `<div class="card"><h1>${esc(d.title)}</h1>
    <div class="meta">${esc(d.shelf)} · ${esc(docSub(d))}</div>
    ${d.note ? `<div class="note">${esc(d.note)}</div>` : ''}
    <div class="meta">Файл: ${esc(d.rel)}${d.blob ? ' (внутри программы)' : ''}</div>
    <div class="btns"><button class="pri" id="dOpen">Открыть PDF</button>${d.user ? '<button id="dEdit">Изменить</button><button id="dDel" class="danger">Удалить</button>' : ''}</div>
    <div class="codein" style="margin-top:12px"><input id="dQ" placeholder="Найти в этом документе" autocomplete="off"></div><div id="dRes"></div>
    ${d.toc && d.toc.length ? '<div class="sec"><h2>Оглавление</h2></div><div id="dToc"></div>' : ''}</div>`;
  $('#dOpen').onclick = () => openDoc(d);
  if (d.user) { $('#dEdit').onclick = () => editUserDoc(d); $('#dDel').onclick = () => removeUserDoc(d); }
  if (d.toc && d.toc.length) {
    $('#dToc').innerHTML = rowsHtml(d.toc.map(([dep, t, p], i) => { h['t' + i] = () => openDoc(d, p); return { k: 't' + i, t: '<span style="padding-left:' + Math.min(dep, 4) * 14 + 'px">' + esc(t) + '</span>', n: p ? 'стр. ' + p : null }; }));
    bindRows($('#dToc'), h);
  }
  const q = $('#dQ'); let t;
  q.oninput = () => { clearTimeout(t); t = setTimeout(() => docSearch(q.value.trim(), [d], $('#dRes'), $('#dToc') || document.createElement('div')), 250); };
}
