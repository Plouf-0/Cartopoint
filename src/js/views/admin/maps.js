/**
 * Onglet « Cartes » : plusieurs plans par projet, chacun avec ses fiches ; échelle.
 */
import { $, esc, num, toast, pickFile, errorText } from '../../util.js';
import { S, switchMap, changedMap, changedMeta, forgetFile, forgetMap, setMapImage } from '../../store.js';
import { normalizeMap, hasPlan, hasRef, emptyProgress } from '../../model.js';
import { render } from '../../render.js';

export function html() {
  const rows = S.project.maps
    .map((m) => {
      const current = m.id === S.map.id;
      return `
      <div class="map-row ${current ? 'current' : ''}">
        ${hasPlan(m) ? `<img src="${esc(m.image)}" alt="">` : '<div class="map-noplan">Liste</div>'}
        <div><h3>${esc(m.name)}</h3><small>${m.fiches.length} fiche(s)${hasPlan(m) ? '' : ' · sans plan, les élèves voient une liste'}${current ? ' · carte affichée' : ''}</small></div>
        <div class="actions">
          ${current ? '' : `<button type="button" class="btn soft sm" data-map-open="${esc(m.id)}">Afficher</button>`}
          <button type="button" class="btn ghost sm" data-map-rename="${esc(m.id)}">Renommer</button>
          <button type="button" class="btn ghost sm" data-map-image="${esc(m.id)}">${hasPlan(m) ? "Changer l'image" : 'Choisir une image du plan'}</button>
          ${hasPlan(m) ? `<button type="button" class="btn ghost sm" data-map-noplan="${esc(m.id)}">Retirer l'image</button>` : ''}
          ${S.project.maps.length > 1 ? `<button type="button" class="btn danger sm" data-map-del="${esc(m.id)}">Supprimer</button>` : ''}
        </div>
      </div>`;
    })
    .join('');
  return `
    <div class="inline spread"><h2 style="margin:0">Cartes</h2><span class="inline"><button type="button" class="btn sm" id="addMap">＋ Ajouter une carte</button><button type="button" class="btn ghost sm" id="addList">＋ Ajouter une liste sans plan</button></span></div>
    <p class="sub">Chaque carte garde ses propres fiches et positions. Une carte sans image du plan est une simple liste : les élèves y lisent les fiches et y répondent, sans rien placer.</p>
    <div class="rows">${rows}</div>
    ${
      hasPlan(S.map)
        ? `<div class="section">
      <h3>Échelle de « ${esc(S.map.name)} »</h3>
      <p>Facultatif : la largeur réelle du terrain représenté. Les écarts seront alors donnés en mètres.</p>
      <div class="inline"><div class="unit-input" style="flex:1"><input id="widthM" inputmode="decimal" value="${S.map.widthMeters ?? ''}" placeholder="ex. 180"><span>m</span></div><button type="button" class="btn soft sm" id="saveWidth">Enregistrer</button></div>
    </div>`
        : ''
    }`;
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
        try {
          await setMapImage(m, file);
        } catch (e) {
          return toast('⚠ Image impossible à enregistrer : ' + errorText(e));
        }
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
        await forgetMap(m.id);
        changedMeta();
        if (S.map === m) await switchMap(S.project.maps[0].id);
        render();
      })
  );
  panel.querySelectorAll('[data-map-noplan]').forEach(
    (b) =>
      (b.onclick = () => {
        const m = mapById(b.dataset.mapNoplan);
        const placed = m.fiches.filter(hasRef).length;
        const lost = placed ? `\n\nLes ${placed} position(s) réelle(s) de ses fiches seront effacées.` : '';
        if (!confirm(`Retirer l'image du plan de « ${m.name} » ? Les élèves y verront une simple liste de fiches.${lost}`)) return;
        m.image = '';
        m.ratio = null;
        m.fiches = m.fiches.map((f) => ({ ...f, refX: null, refY: null }));
        changedMap(m);
        render();
        toast(`« ${m.name} » est maintenant une liste`);
      })
  );
  $('#addList').onclick = async () => {
    const name = prompt('Nom de la liste :', 'Fiches sans plan')?.trim();
    if (!name) return;
    const m = normalizeMap({ name }, '', S.project.template);
    S.project.maps.push(m);
    S.progress[m.id] = emptyProgress();
    changedMap(m);
    changedMeta();
    await switchMap(m.id);
    render();
    toast(`Liste « ${name} » ajoutée`);
  };
  $('#addMap').onclick = async () => {
    const file = await pickFile('image/*');
    if (!file) return;
    const name = prompt('Nom de la carte :', file.name.replace(/\.[^.]+$/, '')) || 'Nouvelle carte';
    const m = normalizeMap({ name, image: '' }, '', S.project.template);
    try {
      await setMapImage(m, file);
    } catch (e) {
      return toast('⚠ Image impossible à enregistrer : ' + errorText(e));
    }
    S.project.maps.push(m);
    S.progress[m.id] = emptyProgress();
    changedMap(m);
    changedMeta();
    await switchMap(m.id);
    render();
    toast(`Carte « ${name} » ajoutée`);
  };
  $('#saveWidth')?.addEventListener('click', () => {
    S.map.widthMeters = num($('#widthM').value);
    changedMap();
    render();
    toast('Échelle enregistrée');
  });
}
