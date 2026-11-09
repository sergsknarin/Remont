/* Справочник ремонта — видео к работе (0.18.0). Файлы лежат на Яндекс.Диске: «app:/videos/<id>.mp4»
   (так же, как в программе для ПК; на ПК видео сжимается ffmpeg). На телефоне видео смотрится с Диска
   и добавляется с камеры/галереи - iPhone при выборе сам предлагает сжатие. Нужен подключённый Яндекс.Диск. */
'use strict';

function videosHtml(w) {
  const vs = w.videos || [];
  return `<div class="sec"><h2>Видео ${vs.length || ''}</h2></div>
    <div class="vids">${vs.map(x => `<button class="vid" data-vd="${esc(x.id)}">▶ ${esc(x.cap || 'Видео')}<span>${x.size ? fmtMB(x.size) : ''}</span></button>`).join('') || '<div class="muted">Видео нет</div>'}</div>
    <button class="add" id="aVideo">+ Видео</button>
    <button class="add" id="aToAuto">🔧 В запись Автосервиса</button>`;
}
function bindVideos(v, w, mut) {
  v.querySelectorAll('[data-vd]').forEach(b => b.onclick = () => playVideo(w, (w.videos || []).find(x => x.id === b.dataset.vd), mut));
  const a = v.querySelector('#aVideo'); if (a) a.onclick = () => addVideo(mut);
  // связь с Автосервисом (0.21.0): та же страница-сайт, переход с работой - там выбрать запись
  const t = v.querySelector('#aToAuto'); if (t) t.onclick = () => { location.href = 'autoservice/?work=' + encodeURIComponent(w.name) + (w.hours ? '&h=' + encodeURIComponent(w.hours) : ''); };
}
async function playVideo(w, x, mut) {
  if (!x) return;
  if (!ydTok()) { toast('Видео лежат на Яндекс.Диске - подключите его: ⋮ → Яндекс.Диск'); return; }
  const m = modal(`<h3>${esc(x.cap || 'Видео')}</h3><div class="vbox"><div class="muted">Загрузка с Диска${x.size ? ' (' + fmtMB(x.size) + ')' : ''}…</div></div>
    <div class="btns"><button data-a="cap">Подпись</button><button data-a="del" class="danger">Убрать из работы</button><button data-a="x">Закрыть</button></div>`);
  let url = '';
  const close = () => { if (url) URL.revokeObjectURL(url); m.remove(); };
  m.querySelector('[data-a=x]').onclick = close;
  m.querySelector('[data-a=cap]').onclick = async () => { const r = await formBox('Подпись к видео', [{ k: 'cap', label: 'Подпись' }], x); if (r) { close(); await mut(o => { const y = (o.videos || []).find(z => z.id === x.id); if (y) y.cap = r.cap; }); } };
  m.querySelector('[data-a=del]').onclick = async () => { if (await confirmBox('Убрать видео из работы?', 'Убрать', 'danger')) { close(); await mut(o => { o.videos = (o.videos || []).filter(z => z.id !== x.id); }); } };
  try {
    const r = await ydGet('app:/videos/' + x.id + '.mp4');
    url = URL.createObjectURL(await r.blob());
    const box = m.querySelector('.vbox'); if (!box) return;
    box.innerHTML = `<video controls playsinline src="${url}"></video>`;
  } catch (e) {
    const box = m.querySelector('.vbox');
    if (box) box.innerHTML = `<div class="muted">Не удалось загрузить: ${esc(e.message)}.<br>Файл на Диске: Приложения → папка программы → videos → ${esc(x.id)}.mp4. Если видео добавили на ПК - подождите, пока Яндекс.Диск его отправит.</div>`;
  }
}
function addVideo(mut) {
  if (!ydTok()) { toast('Видео сохраняются на Яндекс.Диск - сначала подключите его: ⋮ → Яндекс.Диск'); return; }
  if (!navigator.onLine) { toast('Нет сети - видео загружается сразу на Диск'); return; }
  const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'video/*';
  inp.onchange = async () => {
    const f = inp.files[0]; if (!f) return;
    if (f.size > 300 * 1048576 && !await confirmBox(`Видео большое: ${fmtMB(f.size)}. Загрузка займёт время и место на Диске. Продолжить?`, 'Загрузить')) return;
    const id = newId('vd'), cap = f.name.replace(/\.[^.]+$/, '');
    toast('Загрузка видео на Диск: ' + fmtMB(f.size) + '…');
    try {
      await ydMkdir('app:/videos').catch(() => {});
      await ydPut('app:/videos/' + id + '.mp4', f);
      await mut(o => { o.videos = (o.videos || []).concat([{ id, cap, size: f.size, added: new Date().toISOString().slice(0, 10) }]); });
      toast('Видео добавлено: ' + fmtMB(f.size));
    } catch (e) { toast('Видео не загрузилось: ' + e.message); }
  };
  inp.click();
}
