/* Справочник ремонта — фото: сжатие по назначению, подсказка, ⭐, экран «Память» */
'use strict';

// Назначение фото → максимальная сторона и качество JPEG
const PHOTO_KINDS = {
  params: { t: 'Параметры / экран / бирка', max: 3000, q: 0.88, hint: 'мелкие цифры читаются' },
  node:   { t: 'Узел / деталь',             max: 2000, q: 0.82, hint: 'видно детали' },
  view:   { t: 'Общий вид',                 max: 1280, q: 0.78, hint: 'экономно' }
};
const fmtMB = b => b >= 1048576 ? (b / 1048576).toFixed(1) + ' МБ' : Math.max(1, Math.round(b / 1024)) + ' КБ';
const urlCache = new Map();
async function photoUrl(id) {
  if (urlCache.has(id)) return urlCache.get(id);
  const b = await Store.get(id, 'photos'); if (!b) return '';
  const u = URL.createObjectURL(b); urlCache.set(id, u); return u;
}
function photoKeys() {
  return new Promise(res => {
    if (!Store.db) return res([]);
    const rq = Store.db.transaction('photos').objectStore('photos').getAllKeys();
    rq.onsuccess = () => res(rq.result || []); rq.onerror = () => res([]);
  });
}
async function photoSizes() {
  const out = [];
  for (const id of await photoKeys()) { const b = await Store.get(id, 'photos'); out.push({ id, size: b ? b.size : 0 }); }
  return out;
}
function delPhotoBlob(id) {
  return new Promise(res => {
    if (!Store.db) return res();
    const tx = Store.db.transaction('photos', 'readwrite'); tx.objectStore('photos').delete(id);
    tx.oncomplete = tx.onerror = () => { const u = urlCache.get(id); if (u) URL.revokeObjectURL(u); urlCache.delete(id); res(); };
  });
}
const blobToData = b => new Promise(res => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(b); });

// Все ссылки на фото в базе: id → [{work, meta}]
function photoRefs() {
  const m = new Map();
  const errs = Object.entries(DB.errNotes || {}).map(([c, n]) => ({ ...n, name: 'Ошибка ' + c })); // фото к «Моему решению» (из другой версии)
  for (const w of DB.templates.concat(DB.items, errs)) for (const p of (w.photos || [])) {
    if (!m.has(p.id)) m.set(p.id, []); m.get(p.id).push({ w, p });
  }
  return m;
}

/* ---------- Анализ: похоже на текст/цифры? размыто? ---------- */
async function loadImage(blob) {
  const u = URL.createObjectURL(blob);
  try {
    const img = new Image(); img.src = u; await img.decode(); return img;
  } finally { setTimeout(() => URL.revokeObjectURL(u), 1000); }
}
function analyze(img) {
  const S = 512, k = Math.min(1, S / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(8, Math.round(img.naturalWidth * k)), h = Math.max(8, Math.round(img.naturalHeight * k));
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const cx = cv.getContext('2d', { willReadFrequently: true }); cx.drawImage(img, 0, 0, w, h);
  const d = cx.getImageData(0, 0, w, h).data, g = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) g[i] = d[i * 4] * 0.299 + d[i * 4 + 1] * 0.587 + d[i * 4 + 2] * 0.114;
  let edges = 0, n = 0, sum = 0, sum2 = 0;
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x;
    const gr = Math.abs(g[i + 1] - g[i - 1]) + Math.abs(g[i + w] - g[i - w]);
    if (gr > 60) edges++;
    const lap = g[i - 1] + g[i + 1] + g[i - w] + g[i + w] - 4 * g[i];
    sum += lap; sum2 += lap * lap; n++;
  }
  const edgeFrac = edges / n, lapVar = sum2 / n - (sum / n) ** 2;
  const kind = edgeFrac > 0.10 ? 'params' : edgeFrac > 0.035 ? 'node' : 'view';
  return { kind, blurry: lapVar < 40, edgeFrac, lapVar };
}
async function compress(img, kind) {
  const K = PHOTO_KINDS[kind], k = Math.min(1, K.max / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.round(img.naturalWidth * k), h = Math.round(img.naturalHeight * k);
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  cv.getContext('2d').drawImage(img, 0, 0, w, h);
  const blob = await new Promise(r => cv.toBlob(r, 'image/jpeg', K.q));
  return { blob, w, h };
}

/* ---------- Окно добавления одного фото ---------- */
function choosePhoto(file, img, an, idx, total) {
  return new Promise(res => {
    const u = URL.createObjectURL(file);
    const est = kind => { const K = PHOTO_KINDS[kind], s = Math.min(1, K.max / Math.max(img.naturalWidth, img.naturalHeight)); return Math.round(img.naturalWidth * s) + '×' + Math.round(img.naturalHeight * s); };
    const m = modal(`<h3>Фото ${idx} из ${total}</h3>
      <img class="pv" src="${u}" alt="">
      <div class="muted">Исходное: ${img.naturalWidth}×${img.naturalHeight}, ${fmtMB(file.size)}</div>
      <div class="hint">Подсказка: ${an.kind === 'params' ? 'много мелких линий — похоже на цифры или текст' : an.kind === 'node' ? 'похоже на узел или деталь' : 'мало мелких деталей — общий вид'}${an.blurry ? '<br><b>Фото нечёткое — может, переснять?</b>' : ''}</div>
      <div class="kinds">${Object.entries(PHOTO_KINDS).map(([k, K]) => `<button data-k="${k}" class="${k === an.kind ? 'sel' : ''}"><b>${K.t}</b><span>${est(k)} · ${K.hint}</span></button>`).join('')}</div>
      <label for="pCap">Подпись</label><input id="pCap" autocomplete="off" placeholder="например: параметры до прожига">
      <label class="star"><input type="checkbox" id="pStar"> ⭐ Важное — не сжимать дальше</label>
      <div class="btns"><button class="pri" data-ok="1">Сохранить</button><button data-skip="1">Пропустить</button></div>`);
    let kind = an.kind;
    m.querySelectorAll('[data-k]').forEach(b => b.onclick = () => { kind = b.dataset.k; m.querySelectorAll('[data-k]').forEach(x => x.classList.toggle('sel', x === b)); });
    const done = r => { URL.revokeObjectURL(u); m.remove(); res(r); };
    m.querySelector('[data-ok]').onclick = () => done({ kind, cap: m.querySelector('#pCap').value.trim(), star: m.querySelector('#pStar').checked });
    m.querySelector('[data-skip]').onclick = () => done(null);
  });
}

async function addPhotos(files, mut) {
  const added = [];
  let i = 0;
  for (const f of files) {
    i++;
    let img;
    try { img = await loadImage(f); } catch (e) { toast('Не удалось открыть «' + f.name + '». Формат не поддерживается этим браузером.'); continue; }
    const r = await choosePhoto(f, img, analyze(img), i, files.length); if (!r) continue;
    const c = await compress(img, r.kind), id = newId('ph');
    await Store.set(id, c.blob, 'photos');
    added.push({ id, kind: r.kind, star: r.star, cap: r.cap, w: c.w, h: c.h, size: c.blob.size, orig: f.size, added: new Date().toISOString() });
  }
  if (!added.length) return;
  try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch (e) {}
  let ok = false;
  await mut(o => { ok = true; o.photos = (o.photos || []).concat(added); });
  if (!ok) { for (const p of added) await delPhotoBlob(p.id); return; } // отменили выбор «для марки / для всех»
  const was = added.reduce((a, p) => a + p.orig, 0), now = added.reduce((a, p) => a + p.size, 0);
  toast(`Добавлено фото: ${added.length}. ${fmtMB(was)} → ${fmtMB(now)}`);
}

/* ---------- В карточке работы ---------- */
function photosHtml(w) {
  const ph = w.photos || [];
  return `<div class="sec"><h2>Фото ${ph.length || ''}</h2></div>
    <div class="gallery">${ph.map(p => `<button class="th" data-ph="${p.id}" aria-label="${esc(p.cap || 'Фото')}"><img data-src="${p.id}" alt="">${p.star ? '<i>⭐</i>' : ''}<span>${fmtMB(p.size)}</span></button>`).join('')}</div>
    <button class="add" id="aPhoto">+ Фото</button>`;
}
function bindPhotos(v, w, c, mut) {
  v.querySelectorAll('img[data-src]').forEach(async im => { im.src = await photoUrl(im.dataset.src); });
  const inp = $('#photoIn');
  $('#aPhoto').onclick = () => { inp.onchange = async () => { const fs = [...inp.files]; inp.value = ''; if (fs.length) await addPhotos(fs, mut); }; inp.click(); };
  v.querySelectorAll('[data-ph]').forEach(b => b.onclick = () => viewPhoto(w, (w.photos || []).findIndex(p => p.id === b.dataset.ph), mut));
}

/* ---------- Просмотр: увеличение, ⭐, сжать, удалить ---------- */
async function viewPhoto(w, idx, mut) {
  const list = w.photos || [], p = list[idx]; if (!p) return;
  const m = document.createElement('div'); m.className = 'viewer';
  m.innerHTML = `<div class="vbar"><button data-a="close" aria-label="Закрыть">✕</button><span>${idx + 1} / ${list.length} · ${PHOTO_KINDS[p.kind].t} · ${p.w}×${p.h} · ${fmtMB(p.size)}</span></div>
    <div class="vimg"><img src="${await photoUrl(p.id)}" alt=""></div>
    ${p.cap ? `<div class="vcap">${esc(p.cap)}</div>` : ''}
    <div class="vbtns"><button data-a="prev">‹</button><button data-a="star">${p.star ? '⭐ Важное' : '☆ Отметить важным'}</button>
    ${p.kind !== 'view' && !p.star ? '<button data-a="shrink">Сжать</button>' : ''}<button data-a="cap">Подпись</button><button data-a="del" class="danger">Удалить</button><button data-a="next">›</button></div>`;
  document.body.appendChild(m);
  const box = m.querySelector('.vimg'), im = box.querySelector('img');
  // двойное нажатие — реальный размер (можно водить пальцем), ещё раз — по экрану
  box.ondblclick = () => box.classList.toggle('full');
  let zoom = 1, d0 = 0;
  box.addEventListener('touchstart', e => { if (e.touches.length === 2) d0 = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY) / zoom; }, { passive: true });
  box.addEventListener('touchmove', e => {
    if (e.touches.length !== 2 || !d0) return; e.preventDefault();
    zoom = Math.min(6, Math.max(1, Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY) / d0));
    im.style.width = (zoom * 100) + '%'; box.classList.toggle('zoomed', zoom > 1);
  }, { passive: false });
  const close = () => m.remove();
  m.onclick = async e => {
    const a = e.target.dataset.a; if (!a) return;
    if (a === 'close') return close();
    if (a === 'prev' || a === 'next') { const j = (idx + (a === 'next' ? 1 : -1) + list.length) % list.length; close(); return viewPhoto(w, j, mut); }
    if (a === 'star') { close(); await mut(o => { o.photos.find(x => x.id === p.id).star = !p.star; }); return; }
    if (a === 'cap') { const r = await formBox('Подпись к фото', [{ k: 'cap', label: 'Подпись' }], p); if (r) { close(); await mut(o => { o.photos.find(x => x.id === p.id).cap = r.cap; }); } return; }
    if (a === 'shrink') {
      if (!await confirmBox(`Сжать до «Общий вид» (1280 px)? Сейчас ${fmtMB(p.size)}. Мелкие детали станут хуже видны.`, 'Сжать')) return;
      const r = await shrinkPhoto(p); close(); await mut(o => Object.assign(o.photos.find(x => x.id === p.id), r)); return;
    }
    if (a === 'del') {
      if (!await confirmBox('Удалить это фото?', 'Удалить', 'danger')) return;
      close(); await mut(o => { o.photos = o.photos.filter(x => x.id !== p.id); });
      if (!photoRefs().has(p.id)) await delPhotoBlob(p.id); // файл удаляем, только если фото больше нигде не используется
    }
  };
}
async function shrinkPhoto(p) {
  const img = await loadImage(await Store.get(p.id, 'photos'));
  const c = await compress(img, 'view');
  if (c.blob.size >= p.size) return { kind: 'view' };
  await Store.set(p.id, c.blob, 'photos');
  const u = urlCache.get(p.id); if (u) URL.revokeObjectURL(u); urlCache.delete(p.id);
  return { kind: 'view', w: c.w, h: c.h, size: c.blob.size };
}

/* ---------- Экран «Память» ---------- */
async function memoryScreen() {
  const sizes = await photoSizes(), refs = photoRefs();
  const total = sizes.reduce((a, x) => a + x.size, 0);
  const orphans = sizes.filter(x => !refs.has(x.id));
  const cand = sizes.filter(x => { const r = refs.get(x.id); return r && r.every(z => !z.p.star && z.p.kind !== 'view'); });
  const save = cand.reduce((a, x) => { const p = refs.get(x.id)[0].p, k = Math.min(1, 1280 / Math.max(p.w, p.h)); return a + x.size * (1 - k * k * 0.8); }, 0);
  let est = ''; try { const e = await navigator.storage.estimate(); est = `Браузер: занято ${fmtMB(e.usage || 0)} из доступных ${fmtMB(e.quota || 0)}`; } catch (e) {}
  let persist = ''; try { persist = (await navigator.storage.persisted()) ? 'Хранилище постоянное — iPhone не сотрёт данные.' : 'Хранилище временное. На iPhone добавьте программу на экран «Домой».'; } catch (e) {}
  const top = sizes.filter(x => refs.has(x.id)).sort((a, b) => b.size - a.size).slice(0, 30);
  const m = modal(`<h3>Память</h3>
    <p>Фото: <b>${sizes.length}</b>, всего <b>${fmtMB(total)}</b></p>
    <div class="muted">${est}<br>${persist}</div>
    <h2>Самые тяжёлые</h2>
    <div class="memlist">${top.map(x => { const r = refs.get(x.id)[0]; return `<div class="memrow"><img data-src="${x.id}" alt=""><div><b>${fmtMB(x.size)}</b> ${r.p.star ? '⭐' : ''}<div class="s">${esc(r.w.name)} · ${PHOTO_KINDS[r.p.kind].t}</div></div></div>`; }).join('') || '<div class="muted">Фото пока нет</div>'}</div>
    <div class="btns">
      ${cand.length ? `<button class="pri" data-a="shrink">Сжать неважные (${cand.length} шт., освободится ≈ ${fmtMB(save)})</button>` : ''}
      ${orphans.length ? `<button data-a="orph">Удалить фото без работы (${orphans.length} шт., ${fmtMB(orphans.reduce((a, x) => a + x.size, 0))})</button>` : ''}
      <button data-a="close">Закрыть</button></div>`);
  m.querySelectorAll('img[data-src]').forEach(async im => { im.src = await photoUrl(im.dataset.src); });
  m.onclick = async e => {
    const a = e.target.dataset.a; if (!a && e.target !== m) return;
    if (!a || a === 'close') return m.remove();
    m.remove();
    if (a === 'shrink') {
      if (!await confirmBox(`Сжать ${cand.length} фото без ⭐ до «Общий вид» (1280 px)? Мелкие детали на них станут хуже видны. Отменить нельзя — сначала можно сохранить резервную копию с фото.`, 'Сжать')) return;
      let freed = 0;
      for (const x of cand) {
        const r = await shrinkPhoto(refs.get(x.id)[0].p);
        for (const z of refs.get(x.id)) Object.assign(z.p, r);
        freed += x.size - (r.size || x.size);
      }
      await save_(); toast('Освобождено ' + fmtMB(freed));
    }
    if (a === 'orph') { for (const x of orphans) await delPhotoBlob(x.id); toast('Удалено фото: ' + orphans.length); }
  };
}
async function save_() { await save(); render(); }
