/**
 * Visionneuse plein écran (flèches ← → pour passer d'une photo à l'autre).
 */
import { $ } from '../util.js';
import { mediaURL } from '../store.js';

let viewer = { list: [], i: 0 };

async function show() {
  const m = viewer.list[viewer.i];
  if (!m) return;
  $('#photoImg').src = await mediaURL(m);
  $('#photoCount').textContent = viewer.list.length > 1 ? `${viewer.i + 1} / ${viewer.list.length}` : '';
  $('#photoPrev').hidden = $('#photoNext').hidden = viewer.list.length < 2;
}

/** Ouvre la visionneuse sur la photo `index` de la liste `photos`. */
export function openPhoto(photos, index = 0) {
  viewer = { list: photos, i: Math.max(0, index) };
  show();
  const d = $('#dlgPhoto');
  if (!d.open) d.showModal();
}

export function bindViewer() {
  const d = $('#dlgPhoto');
  const step = (n) => {
    viewer.i = (viewer.i + n + viewer.list.length) % viewer.list.length;
    show();
  };
  $('#photoPrev').onclick = () => step(-1);
  $('#photoNext').onclick = () => step(1);
  $('#photoClose').onclick = () => d.close();
  d.addEventListener('click', (e) => {
    if (e.target === d || e.target.id === 'photoStage') d.close();
  });
  d.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') step(-1);
    if (e.key === 'ArrowRight') step(1);
  });
}
