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
function ydMark() { LS.set('ydDirty', Date.now()); if (ydTok() || vkS()) { clearTimeout(ydTimer); ydTimer = setTimeout(() => ydSync(), 5000); } }  // из save()
function ydState(t, cls) { const el = document.getElementById('ydState'); if (el) { el.textContent = t; el.className = 'yd ' + (cls || ''); } }

// 0.33.1: понятная причина вместо «Failed to fetch» - что именно и с каким адресом не связалось
async function ydFetch(url, opt, what) {
  try { return await fetch(url, opt); }
  catch (e) { let h = ''; try { h = new URL(url).host; } catch (x) { } throw new Error('Нет связи: ' + what + ' (' + h + ') - ' + e.message + (navigator.onLine ? '' : '. Телефон без интернета')); }
}
async function ydApi(path, opt = {}) {
  const r = await ydFetch(YD + path, { ...opt, headers: { Authorization: 'OAuth ' + ydTok(), ...(opt.headers || {}) } }, 'запрос к Яндекс.Диску ' + path.split('?')[0]);
  if (r.status === 401) { LS.set('ydToken', ''); throw new Error('Вход в Яндекс истёк — подключите Диск заново (⋮ → Яндекс.Диск)'); }
  return r;
}
async function ydMeta(p) { if (vkProxy()) return vkMeta(p); const r = await ydApi('/resources?path=' + encodeURIComponent(p) + '&fields=modified,md5,size'); return r.status === 404 ? null : r.ok ? r.json() : Promise.reject(new Error('Диск: ' + r.status)); }
async function ydGet(p) { if (vkProxy()) return vkGet(p); const r = await ydApi('/resources/download?path=' + encodeURIComponent(p)); if (!r.ok) throw new Error('Диск: скачивание ' + r.status); const { href } = await r.json(); const f = await ydFileGet(href, 'скачивание файла ' + p); if (!f.ok) throw new Error('Диск: файл ' + f.status); return f; }
async function ydPut(p, body) { if (vkProxy()) return vkPut(p, body); const r = await ydApi('/resources/upload?overwrite=true&path=' + encodeURIComponent(p)); if (!r.ok) throw new Error('Диск: загрузка ' + r.status); const { href } = await r.json(); const u = await ydFilePut(href, body, 'отправка файла ' + p); if (!u.ok && u.status !== 201 && u.status !== 202) throw new Error('Диск: запись ' + u.status); }
async function ydList(p) { if (vkProxy()) return vkList(p); const r = await ydApi('/resources?limit=100000&fields=_embedded.items.name&path=' + encodeURIComponent(p)); if (r.status === 404) return null; if (!r.ok) throw new Error('Диск: список ' + r.status); return ((await r.json())._embedded || { items: [] }).items.map(x => x.name); }
async function ydMkdir(p) { if (vkProxy()) return vkMkdir(p); await ydApi('/resources?path=' + encodeURIComponent(p), { method: 'PUT' }); }

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
  if (!ydTok() && !vkS()) return; if (ydBusy) { ydAgain = true; return; } if (!navigator.onLine) { ydState('☁ нет сети', 'warn'); return; }
  ydBusy = true; ydState('☁ …'); const started = Date.now();
  if (!ydTok() && vkRole() === 'friend') { await friendSync(manual, started); ydBusy = false; if (ydAgain) { ydAgain = false; setTimeout(() => ydSync(), 1500); } return; }
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

// 0.22.0: друг (вход через ВК) - через функцию, видит без скрытого, отправляет только своё
async function friendSync(manual, started) {
  try {
    const { db, pushed } = await vkFriendSync(DB, { dirty: !!LS.get('ydDirty', false) && vkLS.get('vkMine', null) !== null });   // 0.32.0: первый вход на устройстве - только получить (не отправлять встроенную базу)
    if (!validDB(db)) throw new Error('функция вернула не базу справочника');
    const docs = DB.docsUser; DB = db; DB.docsUser = docs; await Store.set('db', DB); render();
    let down = 0, up = 0; const me = (vkS() || {}).vk;
    const sent = new Set(LS.get('vkUp', []));
    for (const w of ['templates', 'items', 'codes'].flatMap(k => DB[k] || []))
      for (const p of (w.photos || []).concat((w.sols || []).flatMap(s => s.photos || []))) {
        const local = await Store.get(p.id, 'photos');
        if (!local) { try { await Store.set(p.id, await vkPhotoGet(p.id), 'photos'); down++; } catch (e) { } }
        else if (String(w.vk) === String(me) && !sent.has(p.id)) { await vkPhotoPut(p.id, local); sent.add(p.id); up++; }
      }
    LS.set('vkUp', [...sent]);
    if ((LS.get('ydDirty', 0) || 0) <= started) LS.set('ydDirty', 0); else ydAgain = true;
    LS.set('ydLast', Date.now()); ydState('☁ ' + new Date().toTimeString().slice(0, 5), 'ok');
    if (manual || pushed || up || down) toast('Синхронизировано' + (pushed ? ', отправлено: ' + pushed : '') + (up ? ', фото отправлено ' + up : '') + (down ? ', фото получено ' + down : ''));
  } catch (e) { ydState('☁ ⚠', 'err'); if (manual) toast(e.message || 'Ошибка синхронизации'); }
}
// 0.22.0: экран «Вход через ВК» (⋮ → Вход через ВК)
async function vkScreen() {
  const s = vkS(), d = vkLS.get('vkDenied', null);
  if (!VK_ON()) return toast('Вход через ВК ещё не настроен');
  if (s) {
    const k = await ask((s.via === 'link' ? `Вы вошли по ссылке: ${s.name}.` : `Вы вошли через ВК: ${s.name} (id ${s.vk}).`) + `\nРоль: ${s.role === 'owner' ? 'владелец - видно всё' : 'друг - видно справочник без скрытого; правите только своё'}.`,
      [{ k: 'sync', t: 'Синхронизировать сейчас', cls: 'pri' }, { k: 'out', t: 'Выйти', cls: 'danger' }, { k: null, t: 'Закрыть' }]);
    if (k === 'sync') return ydSync(true);
    if (k === 'out') { vkLogout(); ydState(''); return toast('Вы вышли. Данные на этом устройстве остались.'); }
    return;
  }
  const k = await ask('Войти через ВКонтакте?' + (d && d.vk ? `\n\nПрошлая попытка: вашего ВК (id ${d.vk}) нет в списке доступа - перешлите этот номер владельцу.` : '\nВладелец увидит всё, друзья - справочник без скрытого.')
    + '\n\nДругу без ВК: попросите у владельца личную ссылку и откройте её - вход будет сразу.',
    [{ k: 'go', t: 'Войти через ВК', cls: 'pri' }, { k: null, t: 'Отмена' }]);
  if (k === 'go') try { await vkLogin(); } catch (e) { toast(e.message); }
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
  if (k === 'on') location.href = 'https://oauth.yandex.ru/authorize?response_type=token&force_confirm=yes&client_id=' + encodeURIComponent(ydCid()) + '&redirect_uri=' + encodeURIComponent(location.origin + location.pathname.replace(/[^/]*$/, ''));   // 0.34.1: всегда .../Remont/ (а не .../index.html) - иначе Яндекс: «redirect_uri не совпадает»
}
// Запуск: принять токен после входа, синхронизироваться, повторять при появлении сети и раз в 5 минут
function ydInit() {
  if (typeof vkCallback === 'function') vkCallback(toast).then(x => { if (x && vkS() && !ydTok()) ydSync(); });
  if (typeof keyCallback === 'function') keyCallback(toast).then(x => { if (x && vkS() && !ydTok()) { ydSync(); ydWatch(); } });   // 0.32.0: друг по ссылке
  const h = new URLSearchParams(location.hash.slice(1));
  if (h.get('access_token')) { LS.set('ydToken', h.get('access_token')); history.replaceState(history.state, '', location.pathname); toast('Яндекс.Диск подключён'); }
  else if (h.get('error')) { history.replaceState(history.state, '', location.pathname); toast('Яндекс: вход не выполнен (' + h.get('error') + ')'); }
  if (!ydTok() && !vkS()) return;
  ydSync(); ydWatch();
}
function ydWatch() {
  if (ydWatch.on) return; ydWatch.on = true;
  window.addEventListener('online', () => ydSync());
  setInterval(() => { if (document.visibilityState === 'visible') ydSync(); }, 300000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') ydSync(); });
}
// 0.32.0: владелец - «Друзья» (⋮): список доступа, личные ссылки. Файл app:/access.json - тот же, что в Справочнике на ПК
async function frLoad() { return (await ydMeta('app:/access.json')) ? await (await ydGet('app:/access.json')).json() : { friends: [] }; }
async function frSave(change) {   // берём свежий файл (его мог поменять ПК), меняем, пишем
  const a = await frLoad(); a.friends = a.friends || []; const r = change(a.friends);
  await ydPut('app:/access.json', JSON.stringify(a)); return r;
}
async function friendsScreen() {
  if (!isOwner()) return toast('Список друзей ведёт только владелец');
  if (!navigator.onLine) return toast('Нет интернета - список друзей хранится в облаке');
  let a; try { a = await frLoad(); } catch (e) { return toast('Не открылся список друзей: ' + e.message); }
  const fr = a.friends || [];
  const k = await ask(fr.length ? `Друзья (${fr.length}). Выберите, чтобы дать ссылку, отключить или удалить.` : 'Друзей пока нет. Добавьте - и отправьте ему личную ссылку.',
    fr.map((f, i) => ({ k: i, t: (f.name || 'без имени') + (f.off ? ' - отключён' : f.k ? ' 🔗' : f.vk ? ' (ВК)' : '') }))
      .concat([{ k: 'add', t: '+ Добавить друга', cls: 'pri' }, { k: null, t: 'Закрыть' }]));
  if (k === null) return;
  try {
    if (k === 'add') {
      const r = await formBox('Новый друг', [{ k: 'name', label: 'Имя (как подписывать его записи)' }]);
      if (!r || !r.name.trim()) return;
      const f = { id: 'f' + frRnd('abcdefghijkmnpqrstuvwxyz23456789', 6), name: r.name.trim(), k: frRnd(FR_ABC, 24) };
      await frSave(l => { l.push(f); });
      return friendLink(f, true);
    }
    return friendMenu(fr[k]);
  } catch (e) { toast('Не сохранилось: ' + e.message); }
}
const frSame = (a, b) => (a.id && a.id === b.id) || (!a.id && !b.id && a.vk && String(a.vk) === String(b.vk));
async function friendMenu(f) {
  const k = await ask(`${f.name || 'без имени'}${f.vk ? '\nВК: ' + f.vk : ''}\nСсылка: ${f.k ? 'есть' : 'нет'}${f.off ? '\nДоступ отключён' : ''}`,
    [{ k: 'link', t: f.k ? 'Ссылка: отправить / QR' : 'Создать ссылку', cls: 'pri' }].concat(f.k ? [{ k: 'new', t: 'Новая ссылка (старая перестанет работать)' }, { k: 'rev', t: 'Отозвать ссылку' }] : [])
      .concat([{ k: 'off', t: f.off ? 'Включить доступ' : 'Отключить доступ' }, { k: 'del', t: 'Удалить из списка', cls: 'danger' }, { k: null, t: 'Назад' }]));
  if (k === null) return friendsScreen();
  const upd = fn => frSave(l => { const x = l.find(y => frSame(y, f)); if (!x) throw new Error('друга уже нет в списке (удалён на ПК?)'); fn(x); Object.assign(f, x); });
  if (k === 'link' && f.k) return friendLink(f);
  if (k === 'link' || k === 'new') {
    if (k === 'new' && !await confirmBox('Выдать новую ссылку? Старая сразу перестанет работать на всех устройствах друга.', 'Новая ссылка')) return friendMenu(f);
    await upd(x => { if (!x.id) x.id = x.vk ? String(x.vk) : 'f' + frRnd('abcdefghijkmnpqrstuvwxyz23456789', 6); x.k = frRnd(FR_ABC, 24); });
    return friendLink(f, true);
  }
  if (k === 'rev') { if (!await confirmBox('Отозвать ссылку? Друг больше не сможет войти по ней.', 'Отозвать', 'danger')) return friendMenu(f); await upd(x => { delete x.k; }); toast('Ссылка отозвана'); return friendMenu(f); }
  if (k === 'off') { await upd(x => { if (x.off) delete x.off; else x.off = true; }); toast(f.off ? 'Доступ отключён' : 'Доступ включён'); return friendMenu(f); }
  if (k === 'del') {
    if (!await confirmBox(`Удалить ${f.name || 'друга'} из списка? Он больше не войдёт. Его записи в справочнике останутся.`, 'Удалить', 'danger')) return friendMenu(f);
    await frSave(l => { const i = l.findIndex(y => frSame(y, f)); if (i >= 0) l.splice(i, 1); }); toast('Удалён'); return friendsScreen();
  }
}
async function friendLink(f, fresh) {
  const url = frUrl(f.k), text = 'Справочник ремонта - вход для тебя (ссылка личная, не пересылай):';
  const k = await ask((fresh ? 'Ссылка готова и уже действует.\n' : '') + `${f.name}: откройте эту ссылку на его телефоне или отправьте ему.\n\n${url}`,
    (navigator.share ? [{ k: 'share', t: 'Отправить (WhatsApp, Telegram, СМС…)', cls: 'pri' }] : []).concat([{ k: 'copy', t: 'Копировать' }, { k: 'qr', t: 'Показать QR' }, { k: null, t: 'Готово' }]));
  if (k === 'share') { try { await navigator.share({ title: 'Справочник ремонта', text, url }); } catch (e) { } return friendLink(f); }
  if (k === 'copy') { try { await navigator.clipboard.writeText(url); toast('Скопировано'); } catch (e) { toast('Не скопировалось - выделите ссылку вручную'); } return friendLink(f); }
  if (k === 'qr') { location.href = 'my/qr.html#' + url; }
}
