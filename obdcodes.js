/* Справочник ремонта — общие коды OBD-II (0.15.0): описание по-русски и «что проверить» по группам.
   База — data/obd.js (window.OBD), стандартные коды для всех марок. Заводские P1/B1/C1/U1 — записывать самому. */
'use strict';

const OBDC = () => (window.OBD && OBD.c) || {};
const obdDesc = code => (OBDC()[code] || [])[0] || '';
// Список в «Ошибках сканера»: по коду (P0300, 0300, 03) или по словам описания
function obdListHtml(raw, cq, h, max = 60) {
  if (!window.OBD || !raw) return '';
  const C = OBDC(), out = [];
  if (/^[PCBU]?[0-9][0-9A-F]{0,4}$/.test(cq)) {
    for (const code in C) if ((/^[PCBU]/.test(cq) ? code.startsWith(cq) : code.slice(1).startsWith(cq)) && !findCode(code)) { out.push(code); if (out.length >= max) break; }
  } else if (raw.length >= 3) {
    const ws = raw.toLowerCase().split(/\s+/).filter(w => w.length > 1).map(qVariants);
    for (const code in C) if (!findCode(code) && ws.every(vs => hasAny(vs, C[code][0] + ' ' + OBD.g[C[code][1]].n))) { out.push(code); if (out.length >= max) break; }
  }
  if (!out.length) return '';
  out.sort();
  return '<h2>Общие коды OBD-II: ' + out.length + (out.length >= max ? '+' : '') + '</h2>' + rowsHtml(out.map(code => {
    h['obd' + code] = () => go({ type: 'code', id: 'dtc:' + code });
    return { k: 'obd' + code, t: '<b>' + esc(code) + '</b> ' + esc(C[code][0]), s: esc(OBD.g[C[code][1]].n) };
  }));
}
// В карточке кода: что означает и что проверить
function obdCardHtml(code) {
  const r = OBDC()[code]; if (!r) return '';
  const g = OBD.g[r[1]];
  return `<div class="card obd"><div class="meta"><span class="tag">OBD-II</span> ${esc(g.n)}</div><h3>${esc(r[0])}</h3>
    <details open><summary>Что проверить и что делать</summary><ol>${g.k.map(t => '<li>' + esc(t) + '</li>').join('')}</ol></details>
    <div class="muted">Общие рекомендации для всех марок. Как устранили на этой машине — запишите в «+ Решение».</div></div>`;
}
