/* Справочник ремонта — напоминание о резервной копии (0.13.0).
   Считает изменения после последней копии. На главной — строка «💾 Сохранить копию», если есть несохранённое.
   Сохранение: на ПК (Chrome/Edge) — окно «Сохранить как» (можно сразу на флешку, папку запомнит браузер),
   на iPhone — меню «Поделиться» → «Сохранить в Файлы» (флешка видна там же). */
'use strict';

function bkMark() { // вызывается из save()
  try { LS.set('bkChanges', (LS.get('bkChanges', 0) || 0) + 1); if (!LS.get('bkFirstChange', 0)) LS.set('bkFirstChange', Date.now()); } catch (e) {}
}
function bkDone() { LS.set('bkChanges', 0); LS.set('bkFirstChange', 0); LS.set('bkLast', Date.now()); }
const bkAgo = t => { if (!t) return 'ещё не было'; const m = Math.round((Date.now() - t) / 60000); return m < 60 ? m + ' мин назад' : m < 1440 ? Math.round(m / 60) + ' ч назад' : Math.round(m / 1440) + ' дн. назад'; };
// Строка на главной: есть изменения — всегда видна; если копии нет больше суток — выделена
function backupHtml(h) {
  const n = LS.get('bkChanges', 0) || 0; if (!n) return '';
  const first = LS.get('bkFirstChange', 0), last = LS.get('bkLast', 0), old = first && Date.now() - first > 864e5;
  h.qbk = exportBackup;
  return '<div class="' + (old ? 'bkwarn' : '') + '">' + rowsHtml([{ k: 'qbk', t: '💾 Сохранить резервную копию', s: 'изменений после копии: ' + n + ' · последняя копия: ' + bkAgo(last) }]) + '</div>';
}
// Отдать файл: iPhone/Android — «Поделиться», ПК — «Сохранить как», иначе — обычное скачивание
async function deliverFile(blob, name) {
  const mobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
  try {
    if (mobile && navigator.canShare) {
      const f = new File([blob], name, { type: blob.type || 'application/json' });
      if (navigator.canShare({ files: [f] })) { await navigator.share({ files: [f], title: name }); return true; }
    }
    if (!mobile && window.showSaveFilePicker) {
      const fh = await showSaveFilePicker({ suggestedName: name, id: 'backup', types: [{ description: 'Резервная копия', accept: { 'application/json': ['.json'] } }] });
      const w = await fh.createWritable(); await w.write(blob); await w.close(); return true;
    }
  } catch (e) { if (e && e.name === 'AbortError') return false; }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  return true;
}
