/**
 * Onglet « Cartes » : plusieurs plans par projet, chacun avec ses fiches ; échelle.
 */
import { $, esc, num, toast, prepareImage, pickFile } from '../../util.js';
import { S, switchMap, changedMap, changedMeta, forgetFile } from '../../store.js';
import { normalizeMap, hasRef, emptyProgress } from '../../model.js';
import { Maps } from '../../db.js';
import { render } from '../../render.js';

export function html() {
  const rows = S.project.maps
    .map((m) => {
      const current = m.id === S.map.id;
      return `
      <div class="map-row ${current ? 'current' : ''}">
        <img src="${m.image}" alt="">
        <div><h3>${esc(m.name)}</h3><small>${m.fiches.length} fiche(s)${current ? ' · carte affichée' : ''}</small></div>
        <div class="actions">
          ${current ? '' : `<button type="button" class="btn soft sm" data-map-open="${esc(m.id)}">Afficher</button>`}
          <button type="button" class="btn ghost sm" data-map-rename="${esc(m.id)}">Renommer</button>
          <button type="button" class="btn ghost sm" data-map-image="${esc(m.id)}">Changer l'image</button>
          ${S.project.maps.length > 1 ? `<button type="button" class="btn danger sm" data-map-del="${esc(m.id)}">Supprimer</button>` : ''}
        </div>
      </div>`;
    })
    .join('');
  return `
    <div class="inline spread"><h2 style="margin:0">Cartes</h2><button type="button" class="btn sm" id="addMap">＋ Ajouter une carte</button></div>
    <p class="sub">Chaque carte garde ses propres fiches et positions.</p>
    <div class="rows">${rows}</div>
    <div class="section">
      <h3>Échelle de « ${esc(S.map.name)} »</h3>
      <p>Facultatif : la largeur réelle du terrain représenté. Les écarts seront alors donnés en mètres.</p>
      <div class="inline"><div class="unit-input" style="flex:1"><input id="widthM" inputmode="decimal" value="${S.map.widthMeters ?? ''}" placeholder="ex. 180"><span>m</span></div><button type="button" class="btn soft sm" id="saveWidth">Enregistrer</button></div>
    </div>`;
}

const mapById = (id) => S.project.maps.find((m) => m.id === id);

export function bind(panel) {
  panel.querySelectorAll('[data-map-open]').forEach((b) => (b.onclick = async () => (await switchMap(b.dataset.mapOpen), render())));
  panel.querySelectorAll('[data-map-rename]').forEach(
    (b) =>
      (b.onclick = () => {
        const m = mapById(b.dataset.mapRename);
        const name = prompt('Nom de la carte :', m.name);
        if (!name?.trim()) return;
        m.name = name.trim();
        changedMap(m);
        render();
      })
  );
  panel.querySelectorAll('[data-map-image]').forEach(
    (b) =>
      (b.onclick = async () => {
        const file = await pickFile('image/*');
        if (!file) return;
        const m = mapById(b.dataset.mapImage);
        if (
          m.fiches.some(hasRef) &&
          !confirm(
            "Les positions sont enregistrées en proportion de l'image. Elles ne correspondront plus si le nouveau plan est cadré différemment. Continuer ?"
          )
        )
          return;
        m.image = await prepareImage(file);
        changedMap(m);
        render();
        toast('Image de la carte remplacée');
      })
  );
  panel.querySelectorAll('[data-map-del]').forEach(
    (b) =>
      (b.onclick = async () => {
        const m = mapById(b.dataset.mapDel);
        if (!confirm(`Supprimer la carte « ${m.name} » et ses ${m.fiches.length} fiche(s) ? Cette action est définitive.`)) return;
        for (const f of m.fiches) for (const md of f.media) await forgetFile(md.key);
        S.project.maps = S.project.maps.filter((x) => x !== m);
        delete S.progress[m.id];
        await Maps.del(m.id);
        changedMeta();
        if (S.map === m) await switchMap(S.project.maps[0].id);
        render();
      })
  );
  $('#addMap').onclick = async () => {
    const file = await pickFile('image/*');
    if (!file) return;
    const name = prompt('Nom de la carte :', file.name.replace(/\.[^.]+$/, '')) || 'Nouvelle carte';
    const m = normalizeMap({ name, image: await prepareImage(file) });
    S.project.maps.push(m);
    S.progress[m.id] = emptyProgress();
    changedMap(m);
    changedMeta();
    await switchMap(m.id);
    render();
    toast(`Carte « ${name} » ajoutée`);
  };
  $('#saveWidth').onclick = () => {
    S.map.widthMeters = num($('#widthM').value);
    changedMap();
    render();
    toast('Échelle enregistrée');
  };
}
