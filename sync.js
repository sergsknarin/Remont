/* Справочник ремонта — синхронизация с Яндекс.Диском (0.17.0).
   База (db.json) и фото лежат в папке приложения на Диске владельца: «Приложения/<имя приложения>».
   Вход — один раз на каждом устройстве (OAuth Яндекса). Без интернета всё работает, изменения уйдут, когда сеть появится.
   На Диск не отправляются только документы техдока (официальные источники, docsUser).
   Данные от людей по Jetour (карточки ТО, работы, случаи, фото) отправляются — решение владельца 08.11.2026;
   для официальных материалов Jetour будет отдельная программа. */
'use strict';

const YD = 'https://cloud-api.yandex.net/v1/disk';
const ydTok = () => LS.get('ydToken', '');
const YD_CLIENT = 'd1fa202c088a4900a9f5b356a5e0c8f1'; // приложение «для авторизации пользователей» на oauth.yandex.ru (не секрет), 0.17.2
const YD_OLD = 'cf8f5ded89f24b56b2b12d3f4c1ebe90';   // прежнее приложение «Ремонт» (только API) - вход на сайт через него не работает
const ydCid = () => { const c = LS.get('ydClient', ''); return c && c !== YD_OLD ? c : YD_CLIENT; };
let ydBusy = false, ydTimer = 0, ydAgain = false;
function ydMark() { LS.set('ydDirty', Date.now()); if (ydTok()) { clearTimeout(ydTimer); ydTimer = setTimeout(() => ydSync(), 5000); } }  // из save()
function ydState(t, cls) { const el = document.getElementById('ydState'); if (el) { el.textContent = t; el.className = 'yd ' + (cls || ''); } }

async function ydApi(path, opt = {}) {
  const r = await fetch(YD + path, { ...opt, headers: { Authorization: 'OAuth ' + ydTok(), ...(opt.headers || {}) } });
  if (r.status === 401) { LS.set('ydToken', ''); throw new Error('Вход в Яндекс истёк — подключите Диск заново (⋮ → Яндекс.Диск)'); }
  return r;
}
async function ydMeta(p) { const r = await ydApi('/resources?path=' + encodeURIComponent(p) + '&fields=modified,md5,size'); return r.status === 404 ? null : r.ok ? r.json() : Promise.reject(new Error('Диск: ' + r.status)); }
async function ydGet(p) { const r = await ydApi('/resources/download?path=' + encodeURIComponent(p)); if (!r.ok) throw new Error('Диск: скачивание ' + r.status); const { href } = await r.json(); const f = await fetch(href); if (!f.ok) throw new Error('Диск: файл ' + f.status); return f; }
async function ydPut(p, body) { const r = await ydApi('/resources/upload?overwrite=true&path=' + encodeURIComponent(p)); if (!r.ok) throw new Error('Диск: загрузка ' + r.status); const { href } = await r.json(); const u = await fetch(href, { method: 'PUT', body }); if (!u.ok && u.status !== 201 && u.status !== 202) throw new Error('Диск: запись ' + u.status); }
async function ydList(p) { const r = await ydApi('/resources?limit=100000&fields=_embedded.items.name&path=' + encodeURIComponent(p)); if (r.status === 404) return null; if (!r.ok) throw new Error('Диск: список ' + r.status); return ((await r.json())._embedded || { items: [] }).items.map(x => x.name); }
async function ydMkdir(p) { await ydApi('/resources?path=' + encodeURIComponent(p), { method: 'PUT' }); }

// Что отправляем: всё, кроме документов техдока (официальные источники)
function ydOut(db) {
  const o = structuredClone(db); delete o.docsUser;
  return o;
}
// Слияние двух баз: списки объектов с id объединяются, при совпадении id побеждает эта (local) копия
function ydMergeList(a = [], b = [], nested) {
  const m = new Map(b.map(x => [x.id, x]));
  for (const x of a) { const y = m.get(x.id); m.set(x.id, y && nested ? { ...y, ...x, [nested]: ydMergeList(x[nested], y[nested]) } : x); }
  return [...m.values()];
}
function ydMerge(local, remote) {
  const o = { ...remote, ...local };
  o.brands = ydMergeList(local.brands, remote.brands, 'models');
  o.templates = ydMergeList(local.templates, remote.templates);
  o.items = ydMergeList(local.items, remote.items);
  o.codes = ydMergeList(local.codes, remote.codes, 'sols');
  o.toUser = ydMergeList(local.toUser, remote.toUser);
  o.reg = ydMergeList(local.reg, remote.reg);   // регламент ТО (0.20.0)
  return o;
}
const photoIds = db => new Set(db.templates.concat(db.items, db.codes || []).flatMap(w => (w.photos || []).concat((w.sols || []).flatMap(s => s.photos || []))).map(p => p.id));

async function ydSync(manual) {
  if (!ydTok()) return; if (ydBusy) { ydAgain = true; return; } if (!navigator.onLine) { ydState('☁ нет сети', 'warn'); return; }
  ydBusy = true; ydState('☁ …'); const started = Date.now();
  if (!LS.get('ydJetour1', false)) { LS.set('ydDirty', Date.now()); LS.set('ydJetour1', true); }   // 0.17.3: один раз - отправить карточки ТО Jetour, что раньше не уходили
  try {
    const meta = await ydMeta('app:/db.json');
    const remoteChanged = meta && meta.modified !== LS.get('ydRemoteMod', ''), localChanged = !!LS.get('ydDirty', false) || !meta;
    let push = false;
    if (remoteChanged) {
      const remote = await (await ydGet('app:/db.json')).json();
      if (!validDB(remote)) throw new Error('на Диске не база справочника');
      if (localChanged) { DB = ydMerge(DB, remote); push = true; }
      else { const docs = DB.docsUser; DB = remote; DB.docsUser = docs; }
      await Store.set('db', DB); render();
    } else if (localChanged) push = true;
    // фото: отправить недостающие, скачать отсутствующие
    let names = await ydList('app:/photos'); if (!names) { await ydMkdir('app:/photos'); names = []; }
    const have = new Set(names.map(n => n.replace(/\.jpg$/, ''))), need = photoIds(DB);
    let up = 0, down = 0;
    for (const id of need) {
      const local = await Store.get(id, 'photos');
      if (local && !have.has(id)) { await ydPut('app:/photos/' + id + '.jpg', local); up++; }
      else if (!local && have.has(id)) { await Store.set(id, await (await ydGet('app:/photos/' + id + '.jpg')).blob(), 'photos'); down++; }
    }
    // запись с проверкой: если в ту же секунду писало другое устройство — объединить ещё раз (до 3 попыток)
    let base = meta ? meta.modified : '';
    for (let t = 0; push && t < 3; t++) {
      const cur = await ydMeta('app:/db.json');   // перед записью: не поменялась ли база на Диске, пока мы работали
      if (cur && cur.modified !== base) { DB = ydMerge(DB, await (await ydGet('app:/db.json')).json()); await Store.set('db', DB); render(); base = cur.modified; }
      const rev = newId('r');
      await ydPut('app:/db.json', new Blob([JSON.stringify({ ...ydOut(DB), _rev: rev, exported: new Date().toISOString(), appVersion: APP_VERSION })], { type: 'application/json' }));
      await new Promise(r => setTimeout(r, 1200 + Math.random() * 1500));
      const back = await (await ydGet('app:/db.json')).json();
      if (back._rev === rev) { const m2 = await ydMeta('app:/db.json'); LS.set('ydRemoteMod', m2 ? m2.modified : ''); push = false; }
      else { DB = ydMerge(DB, back); await Store.set('db', DB); render(); base = ''; }
    }
    if (push) throw new Error('Диск занят другим устройством — повторю позже');
    if (!LS.get('ydRemoteMod', '') && meta) LS.set('ydRemoteMod', meta.modified);
    if (meta && !remoteChanged && !localChanged) LS.set('ydRemoteMod', meta.modified);
    if ((LS.get('ydDirty', 0) || 0) <= started) LS.set('ydDirty', 0); else ydAgain = true; // правка во время синхронизации — ещё круг
    LS.set('ydLast', Date.now());
    const hm = new Date().toTimeString().slice(0, 5);
    ydState('☁ ' + hm, 'ok');
    if (manual || up || down || remoteChanged) toast('Яндекс.Диск: синхронизировано' + (remoteChanged ? ', получены изменения' : '') + (up ? ', фото отправлено ' + up : '') + (down ? ', фото получено ' + down : ''));
  } catch (e) { ydState('☁ ⚠', 'err'); if (manual) toast(e.message || 'Ошибка синхронизации'); }
  ydBusy = false;
  if (ydAgain) { ydAgain = false; setTimeout(() => ydSync(), 1500); }
}

// Экран настройки (⋮ → Яндекс.Диск)
async function ydScreen() {
  const on = !!ydTok(), last = LS.get('ydLast', 0);
  const k = await ask(on ? `Яндекс.Диск подключён.\nПоследняя синхронизация: ${last ? new Date(last).toLocaleString('ru-RU') : 'ещё не было'}.\nДанные лежат на вашем Диске: «Приложения» → папка программы.\nДокументы техдока туда не отправляются.`
    : 'Подключить Яндекс.Диск? Записи и фото будут храниться на ВАШЕМ Диске и совпадать на телефоне и ПК.\nДокументы техдока на Диск не отправляются.',
    on ? [{ k: 'sync', t: 'Синхронизировать сейчас', cls: 'pri' }, { k: 'off', t: 'Отключить на этом устройстве', cls: 'danger' }, { k: null, t: 'Закрыть' }]
       : [{ k: 'on', t: 'Подключить', cls: 'pri' }, { k: 'cid', t: 'ClientID приложения' }, { k: null, t: 'Отмена' }]);
  if (k === 'sync') return ydSync(true);
  if (k === 'off') { LS.set('ydToken', ''); ydState(''); return toast('Диск отключён на этом устройстве. Данные на Диске остались.'); }
  if (k === 'cid' || (k === 'on' && !ydCid())) {
    const r = await formBox('ClientID приложения Яндекса', [{ k: 'cid', label: 'ClientID (из oauth.yandex.ru → ваше приложение)' }], { cid: ydCid() });
    if (!r) return; LS.set('ydClient', r.cid.trim()); if (k === 'cid') return toast('ClientID сохранён');
  }
  if (k === 'on') location.href = 'https://oauth.yandex.ru/authorize?response_type=token&force_confirm=yes&client_id=' + encodeURIComponent(ydCid()) + '&redirect_uri=' + encodeURIComponent(location.origin + location.pathname);
}
// Запуск: принять токен после входа, синхронизироваться, повторять при появлении сети и раз в 5 минут
function ydInit() {
  const h = new URLSearchParams(location.hash.slice(1));
  if (h.get('access_token')) { LS.set('ydToken', h.get('access_token')); history.replaceState(history.state, '', location.pathname); toast('Яндекс.Диск подключён'); }
  else if (h.get('error')) { history.replaceState(history.state, '', location.pathname); toast('Яндекс: вход не выполнен (' + h.get('error') + ')'); }
  if (!ydTok()) return;
  ydSync();
  window.addEventListener('online', () => ydSync());
  setInterval(() => { if (document.visibilityState === 'visible') ydSync(); }, 300000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') ydSync(); });
}
