/**
 * Le plan : affichage des repères, placement au clic ou par glisser-déposer,
 * déplacement des repères à la souris ou au doigt.
 *
 * Les positions sont enregistrées en % de l'image (0–100), donc indépendantes
 * de la taille de l'écran.
 */
import { $, toast } from '../util.js';
import { S, listed, byId, verified, posOf, entryOf, changedMap, changedProgress } from '../store.js';
import { hasRef, numberOf, titleOf } from '../model.js';
import { render } from '../render.js';
import { openFiche } from './fiche.js';

/** Redessine les repères et le bandeau de placement. */
export function renderMap() {
  const frame = $('#mapFrame');
  const img = $('#plan');
  if (img.getAttribute('src') !== S.map.image) img.src = S.map.image;
  frame.querySelectorAll('.pin').forEach((n) => n.remove());
  const lines = $('#mapLines');
  lines.innerHTML = '';
  const showRefs = S.admin || verified();
  const studentCanMove = !S.admin && !verified();

  for (const f of listed()) {
    const n = numberOf(S.map, f);
    const p = posOf(f);
    if (showRefs && p && hasRef(f)) {
      const ln = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      ln.setAttribute('x1', p.x);
      ln.setAttribute('y1', p.y);
      ln.setAttribute('x2', f.refX);
      ln.setAttribute('y2', f.refY);
      lines.appendChild(ln);
    }
    if (showRefs && hasRef(f)) frame.appendChild(makePin(f, n, 'ref', S.admin));
    if (p) frame.appendChild(makePin(f, n, 'student', studentCanMove));
  }

  frame.classList.toggle('placing', !!S.ui.placing);
  $('#placeHint').hidden = !S.ui.placing;
  if (S.ui.placing) {
    const f = byId(S.ui.placing.id);
    $('#placeHintText').textContent = f
      ? `Cliquez sur le plan pour placer ${S.ui.placing.kind === 'ref' ? 'la position réelle de ' : ''}« ${titleOf(f)} »`
      : '';
  }
}

/** Un repère : rond (élève) ou carré (position réelle), déplaçable si `draggable`. */
function makePin(f, n, kind, draggable) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'pin' + (kind === 'ref' ? ' ref' : '') + (draggable ? ' draggable' : '');
  const p = kind === 'ref' ? { x: f.refX, y: f.refY } : posOf(f);
  b.style.left = p.x + '%';
  b.style.top = p.y + '%';
  b.textContent = n;
  b.dataset.id = f.id;
  b.dataset.kind = kind;
  b.title = (kind === 'ref' ? 'Position réelle — ' : '') + `${n}. ${titleOf(f)}`;
  b.setAttribute('aria-label', b.title);

  let start = null;
  let moved = false;
  b.addEventListener('pointerdown', (e) => {
    if (S.ui.placing || !draggable) return;
    e.preventDefault();
    start = { x: e.clientX, y: e.clientY };
    moved = false;
    b.setPointerCapture(e.pointerId);
  });
  b.addEventListener('pointermove', (e) => {
    if (!start) return;
    if (!moved && Math.hypot(e.clientX - start.x, e.clientY - start.y) < 4) return; // petit tremblement = clic
    moved = true;
    b.classList.add('dragging');
    const q = pointFromClient(e.clientX, e.clientY);
    if (q) {
      b.style.left = q.x + '%';
      b.style.top = q.y + '%';
    }
  });
  b.addEventListener('pointerup', (e) => {
    if (!start) return;
    const wasMoved = moved;
    start = null;
    b.classList.remove('dragging');
    if (!wasMoved) return openFiche(f.id);
    const q = pointFromClient(e.clientX, e.clientY);
    if (q) setPosition(f, kind, q);
  });
  b.addEventListener('pointercancel', () => {
    start = null;
    renderMap();
  });
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!draggable && !S.ui.placing) openFiche(f.id);
  });
  return b;
}

/** Coordonnées écran → position en % de l'image. */
export function pointFromClient(cx, cy) {
  const r = $('#plan').getBoundingClientRect();
  if (!r.width || !r.height) return null;
  const clamp = (v) => Math.max(0, Math.min(100, v));
  return { x: clamp(((cx - r.left) / r.width) * 100), y: clamp(((cy - r.top) / r.height) * 100) };
}

/** Enregistre un placement élève (`student`) ou une position réelle (`ref`). */
export function setPosition(f, kind, p) {
  const x = +p.x.toFixed(3);
  const y = +p.y.toFixed(3);
  if (kind === 'ref') {
    f.refX = x;
    f.refY = y;
    changedMap();
    toast(`✓ Position réelle de « ${titleOf(f)} » enregistrée`);
  } else {
    if (verified() && !S.admin) return;
    Object.assign(entryOf(f, true), { x, y });
    changedProgress();
    toast(`✓ « ${titleOf(f)} » placée`);
  }
  S.ui.placing = null;
  render();
  const pin = document.querySelector(`.pin[data-id="${CSS.escape(f.id)}"][data-kind="${kind}"]`);
  if (pin) {
    pin.classList.add('flash');
    setTimeout(() => pin.classList.remove('flash'), 900);
  }
}

/** Passe en mode placement : le prochain clic sur le plan place la fiche. */
export function startPlacing(id, kind) {
  if (kind === 'student' && verified() && !S.admin) return;
  S.ui.placing = { id, kind };
  render();
  $('#mapFrame').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

export function cancelPlacing() {
  if (!S.ui.placing) return;
  S.ui.placing = null;
  render();
}

/** Écouteurs posés une seule fois au démarrage. */
export function bindMap() {
  const frame = $('#mapFrame');
  const img = $('#plan');
  img.addEventListener('load', () => {
    S.ratio = img.naturalWidth / img.naturalHeight || 1.16;
    $('#stageInner').style.setProperty('--ratio', S.ratio);
  });
  frame.addEventListener('click', (e) => {
    if (!S.ui.placing || e.target.closest('.pin, .place-hint')) return;
    const f = byId(S.ui.placing.id);
    const p = pointFromClient(e.clientX, e.clientY);
    if (f && p) setPosition(f, S.ui.placing.kind, p);
  });
  frame.addEventListener('dragover', (e) => {
    e.preventDefault();
    frame.classList.add('drop-over');
  });
  frame.addEventListener('dragleave', () => frame.classList.remove('drop-over'));
  frame.addEventListener('drop', (e) => {
    e.preventDefault();
    frame.classList.remove('drop-over');
    const f = byId(e.dataTransfer.getData('text/plain'));
    const p = pointFromClient(e.clientX, e.clientY);
    if (f && p) setPosition(f, S.admin ? 'ref' : 'student', p);
  });
  $('#placeCancel').onclick = (e) => {
    e.stopPropagation();
    cancelPlacing();
  };
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && S.ui.placing && !document.querySelector('dialog[open]')) cancelPlacing();
  });
}
