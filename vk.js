/* Вход через ВК (VK ID) и работа через облачную функцию-посредник (0.22.0).
   Владелец: всё как с Яндекс.Диском, но запросы идут через функцию (ключ Диска только у неё).
   Друг: видит справочник без скрытого (private), добавляет своё, правит/удаляет только своё.
   Пока VK_APP или FN_URL пустые - кнопки входа через ВК нет, всё работает как раньше. */
'use strict';
const VK_APP = '54887685';                       // ID приложения VK ID (не секрет)
const FN_URL = 'https://functions.yandexcloud.net/d4e873cpnkojebsnnmti';                       // «Ссылка для вызова» функции https://functions.yandexcloud.net/...
const VK_ON = () => !!(VK_APP && FN_URL);
const VK_REDIRECT = () => location.origin + location.pathname.replace(/autoservice\/.*$/, '').replace(/[^/]*$/, '');   // .../Remont/
const vkLS = { get(k, d) { try { const v = localStorage.getItem('rr_' + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('rr_' + k, JSON.stringify(v)); } catch (e) { } } };
const vkS = () => vkLS.get('vkS', null);              // {s, vk, name, role}
const vkRole = () => (vkS() || {}).role || '';
const vkProxy = () => !vkLS.get('ydToken', '') && vkRole() === 'owner';   // владелец без токена Яндекса - Диск через функцию
const isOwner = () => !!vkLS.get('ydToken', '') || vkRole() === 'owner';

async function fnCall(body) {
  if (!FN_URL) throw new Error('Не задан адрес функции (FN_URL в vk.js)');
  let r;
  try { r = await fetch(FN_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(body) }); }
  catch (e) { throw new Error('Функция не отвечает (' + FN_URL.replace(/^https:\/\//, '') + '): ' + e.message + '. Проверьте интернет.'); }
  let j; try { j = await r.json(); } catch (e) { throw new Error('Функция ответила не JSON (код ' + r.status + ') - проверьте «Публичная функция» в Облаке'); }
  if (r.status === 401) { vkLS.set('vkS', null); throw new Error(j.error || 'Войдите через ВК заново'); }
  if (!j.ok && !j.denied) throw new Error(j.error || ('Ошибка функции, код ' + r.status));
  return j;
}
const fnS = b => fnCall({ ...b, s: (vkS() || {}).s });

// ---------- вход ----------
const b64url = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const rnd = n => b64url(crypto.getRandomValues(new Uint8Array(n)));
async function vkLogin() {
  if (!VK_ON()) throw new Error('Вход через ВК ещё не настроен (vk.js: VK_APP, FN_URL)');
  const v = rnd(48), state = rnd(16);
  const ch = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(v)));
  vkLS.set('vkPkce', { v, state, back: location.href.split('#')[0] });
  location.href = 'https://id.vk.ru/authorize?' + new URLSearchParams({ response_type: 'code', client_id: VK_APP, redirect_uri: VK_REDIRECT(), state,
    code_challenge: ch, code_challenge_method: 'S256', scope: 'vkid.personal_info' });
}
// после возврата из VK ID: ?code=...&state=...&device_id=...  (или ?payload={...})
async function vkCallback(say) {
  const q = new URLSearchParams(location.search);
  let p = { code: q.get('code'), state: q.get('state'), device_id: q.get('device_id') };
  if (q.get('payload')) try { p = { ...p, ...JSON.parse(q.get('payload')) }; } catch (e) { }
  if (!p.code && !q.get('error')) return false;
  const pk = vkLS.get('vkPkce', null); vkLS.set('vkPkce', null);
  history.replaceState(history.state, '', location.pathname);
  if (q.get('error')) { say('ВК: вход не выполнен (' + (q.get('error_description') || q.get('error')) + ')'); return true; }
  if (!pk || pk.state !== p.state) { say('ВК: вход не завершён - устарела попытка входа. Нажмите «Войти через ВК» ещё раз.'); return true; }
  try {
    const j = await fnCall({ a: 'vk_login', code: p.code, device_id: p.device_id, state: p.state, code_verifier: pk.v, redirect_uri: VK_REDIRECT() });
    if (!j.ok) { vkLS.set('vkDenied', { vk: j.vk, name: j.name }); say(j.error); return true; }
    vkLS.set('vkS', { s: j.s, vk: j.vk, name: j.name, role: j.role }); vkLS.set('vkDenied', null);
    say('Вход через ВК: ' + j.name + (j.role === 'owner' ? ' (владелец)' : ' (друг)'));
    if (pk.back && pk.back.split('?')[0] !== location.href.split('?')[0]) { location.href = pk.back; return true; }
  } catch (e) { say(e.message); }
  return true;
}
function vkLogout() { vkLS.set('vkS', null); vkLS.set('vkMine', null); vkLS.set('vkUp', null); }

// ---------- владелец: Диск через функцию ----------
async function vkMeta(p) { return (await fnS({ a: 'yd', op: 'meta', path: p })).meta; }
async function vkGet(p) { const { href } = await fnS({ a: 'yd', op: 'download', path: p }); if (!href) throw new Error('Диск: нет файла ' + p); const f = await fetch(href); if (!f.ok) throw new Error('Диск: файл ' + f.status); return f; }
async function vkPut(p, body) { const { href } = await fnS({ a: 'yd', op: 'upload', path: p }); const u = await fetch(href, { method: 'PUT', body }); if (!u.ok && u.status !== 201 && u.status !== 202) throw new Error('Диск: запись ' + u.status); }
async function vkList(p) { return (await fnS({ a: 'yd', op: 'list', path: p })).items; }
async function vkMkdir(p) { await fnS({ a: 'yd', op: 'mkdir', path: p }); }

// ---------- друг: синхронизация справочника ----------
const VK_LISTS = ['templates', 'items', 'codes', 'toUser', 'reg'];
const VK_NEST = { brands: 'models', codes: 'sols' };
function vkMineIds(db, me) {   // id моих записей (и вложенных моделей/решений)
  const ids = [];
  for (const k of ['brands', ...VK_LISTS]) for (const x of db[k] || []) {
    if (String(x.vk) === String(me)) ids.push(k + ':' + x.id);
    const n = VK_NEST[k]; if (n) for (const s of x[n] || []) if (String(s.vk) === String(me)) ids.push(k + ':' + x.id + ':' + s.id);
  }
  return ids;
}
async function vkFriendSync(DBref, opt) {
  const me = (vkS() || {}).vk, mine = new Set(vkLS.get('vkMine', []));
  let pushed = 0;
  if (opt.dirty) {
    const inc = {};
    for (const k of ['brands', ...VK_LISTS]) if (Array.isArray(DBref[k])) inc[k] = structuredClone(DBref[k]);
    // удалённые у себя: были моими на сервере, а локально их нет
    const have = new Set(vkMineIds(DBref, me).concat(['brands', ...VK_LISTS].flatMap(k => (DBref[k] || []).map(x => k + ':' + x.id))));
    for (const key of mine) {
      if (have.has(key)) continue;
      const [k, id, sub] = key.split(':');
      if (!inc[k]) inc[k] = [];
      if (!sub) inc[k].push({ id, _del: true });
      else { const parent = inc[k].find(x => x.id === id); if (parent) (parent[VK_NEST[k]] = parent[VK_NEST[k]] || []).push({ id: sub, _del: true }); }
    }
    pushed = (await fnS({ a: 'sprav_put', db: inc })).changed;
  }
  const j = await fnS({ a: 'sprav_get' });
  vkLS.set('vkMine', vkMineIds(j.db, me));
  return { db: j.db, pushed };
}
async function vkPhotoGet(id) { const { href } = await fnS({ a: 'photo_get', id }); const f = await fetch(href); if (!f.ok) throw new Error('Фото ' + f.status); return f.blob(); }
async function vkPhotoPut(id, blob) { const j = await fnS({ a: 'photo_put', id }); if (j.href) { const u = await fetch(j.href, { method: 'PUT', body: blob }); if (!u.ok && u.status !== 201 && u.status !== 202) throw new Error('Фото: запись ' + u.status); } }
