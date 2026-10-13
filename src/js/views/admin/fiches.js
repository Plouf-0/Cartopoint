/**
 * Onglet « Fiches » : liste, visibilité, ordre (donc numérotation), positions réelles,
 * import / export tableur, séance en cours.
 */
import { $, esc, prefs, toast, download, safeFileName } from '../../util.js';
import { S, fiches, byId, posOf, verified, progress, changedMap, changedProgress, deleteFiches } from '../../store.js';
import { numberOf, titleOf, hasRef, matches, sortByRef, emptyProgress } from '../../model.js';
import { render } from '../../render.js';
import { photoHTML, measuresHTML, bindMeasures, bindCards, bindSearch } from '../cards.js';
import { openEditor } from '../editor.js';
import { showResults } from '../results.js';
import { importSpreadsheet, buildCsv, templateCsv } from '../../spreadsheet.js';

export function html() {
  const all = fiches();
  const dense = all.length > 6;
  const shown = all.filter((f) => f.visible).length;
  const rows = all
    .filter((f) => matches(f, S.ui.adminQuery))
    .map((f) => {
      const i = all.indexOf(f);
      const place = hasRef(f) ? (dense ? 'Replacer' : 'Replacer la position réelle') : dense ? 'Placer' : 'Placer la position réelle';
      return `
      <div class="row ${f.visible ? '' : 'off'}" data-open="${esc(f.id)}" draggable="true" data-drag="${esc(f.id)}">
        <label class="vis" title="Visible pour les élèves"><input type="checkbox" data-vis="${esc(f.id)}" ${f.visible ? 'checked' : ''}>élèves</label>
        ${photoHTML(f)}
        <div style="min-width:0">
          <h3><span class="num ${f.visible ? 'on' : ''}" title="${f.visible ? 'Numéro vu par les élèves' : 'Fiche masquée : pas de numéro'}">${esc(numberOf(S.map, f))}</span>${esc(titleOf(f))}</h3>
          ${f.species && f.species !== titleOf(f) ? `<p class="sci" style="font-size:13px">${esc(f.species)}</p>` : ''}
          ${f.ref ? `<div class="ref-photo">Réf. photo : ${esc(f.ref)}</div>` : ''}
          <div class="ref-state ${hasRef(f) ? 'set' : ''}">${hasRef(f) ? '■ Position réelle placée' : 'Position réelle à placer'}${posOf(f) ? ' · placée par les élèves' : ''}</div>
        </div>
        <div class="actions">
          <span class="move">
            <button type="button" class="btn ghost sm" data-move="-1" data-id="${esc(f.id)}" aria-label="Monter" title="Monter dans la liste" ${i === 0 ? 'disabled' : ''}>▲</button>
            <button type="button" class="btn ghost sm" data-move="1" data-id="${esc(f.id)}" aria-label="Descendre" title="Descendre dans la liste" ${i === all.length - 1 ? 'disabled' : ''}>▼</button>
          </span>
          <button type="button" class="btn soft sm" data-edit="${esc(f.id)}">Modifier</button>
          <button type="button" class="btn ghost sm" data-place-ref="${esc(f.id)}">${place}</button>
          <button type="button" class="btn danger sm" data-del="${esc(f.id)}" title="Supprimer la fiche" aria-label="Supprimer « ${esc(titleOf(f))} »">🗑</button>
        </div>
        ${measuresHTML(f)}
      </div>`;
    })
    .join('');

  return `
    <div class="inline spread"><h2 style="margin:0">Fiches</h2><button type="button" class="btn sm" id="newFiche">＋ Nouvelle fiche</button></div>
    <p class="sub">${shown} / ${all.length} visible(s) par les élèves. Les numéros se mettent tout seuls : 1, 2, 3… dans l'ordre de la liste, en ne comptant que les fiches visibles. Changez l'ordre avec ▲ ▼. Cliquez sur « Placer » puis sur le plan pour la position réelle. 🗑 supprime une fiche.</p>
    <input class="search" id="adminSearch" type="search" placeholder="Rechercher…" value="${esc(S.ui.adminQuery)}">
    <div class="inline" style="margin-bottom:10px">
      <button type="button" class="btn ghost sm" id="visAll">Tout afficher aux élèves</button>
      <button type="button" class="btn ghost sm" id="visNone">Tout masquer</button>
      ${all.some((f) => f.ref) ? '<button type="button" class="btn ghost sm" id="sortRef">Ranger par réf. photo</button>' : ''}
      ${shown < all.length ? `<button type="button" class="btn danger sm" id="delHidden">Supprimer les fiches masquées (${all.length - shown})</button>` : ''}
    </div>
    <div class="rows">${rows || '<div class="empty-box">Aucune fiche. Commencez par « Nouvelle fiche » ou importez un tableau.</div>'}</div>

    <div class="section">
      <h3>Importer depuis un tableur</h3>
      <p>Remplissez le modèle dans Excel, LibreOffice ou Google Sheets, puis importez-le (.xlsx de préférence, pour garder les émojis, ou .csv). Les fiches sont ajoutées à la carte affichée ; une fiche qui existe déjà (même réf. photo, ou à défaut même nom) est complétée. Les photos s'ajoutent ensuite avec « Modifier ».</p>
      <div class="inline">
        <label class="btn soft sm file-btn">Importer un tableau<input type="file" id="sheetImport" accept=".xlsx,.csv,.txt,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"></label>
        <button type="button" class="btn ghost sm" id="sheetTemplate">Télécharger le modèle</button>
        <button type="button" class="btn ghost sm" id="sheetExport" ${all.length ? '' : 'disabled'}>Exporter les fiches (CSV)</button>
      </div>
    </div>

    <div class="section">
      <h3>Séance en cours</h3>
      <p>${verified() ? "L'exercice a été vérifié : les placements des élèves sont figés." : 'Les élèves peuvent placer les fiches.'} Placements et mesures sont enregistrés dans ce navigateur.</p>
      <div class="inline">
        <button type="button" class="btn soft sm" id="compare">Voir les écarts</button>
        ${verified() ? '<button type="button" class="btn soft sm" id="reopen">Rouvrir l\'exercice</button>' : ''}
        <button type="button" class="btn danger sm" id="newSession">Nouvelle séance</button>
      </div>
    </div>`;
}

export function bind(panel) {
  bindSearch($('#adminSearch'), (q) => {
    S.ui.adminQuery = q;
    render();
  });
  bindCards(panel);
  bindMeasures(panel);
  panel.querySelectorAll('[data-edit]').forEach((b) => (b.onclick = (e) => (e.stopPropagation(), openEditor(b.dataset.edit))));
  panel.querySelectorAll('[data-vis]').forEach(
    (c) =>
      (c.onchange = () => {
        byId(c.dataset.vis).visible = c.checked;
        changedMap();
        render();
      })
  );
  panel.querySelectorAll('[data-move]').forEach(
    (b) =>
      (b.onclick = (e) => {
        e.stopPropagation();
        const arr = fiches();
        const i = arr.findIndex((f) => f.id === b.dataset.id);
        const j = i + Number(b.dataset.move);
        if (i < 0 || j < 0 || j >= arr.length) return;
        [arr[i], arr[j]] = [arr[j], arr[i]];
        changedMap();
        render();
      })
  );
  panel.querySelectorAll('[data-del]').forEach(
    (b) =>
      (b.onclick = async (e) => {
        e.stopPropagation();
        const f = byId(b.dataset.del);
        const photos = f.media.length ? ` et ses ${f.media.length} photo(s)` : '';
        if (
          !confirm(`Supprimer définitivement « ${titleOf(f)} »${photos} ?\n\nPour la retirer seulement de l'espace élèves, décochez plutôt la case « élèves ».`)
        )
          return;
        await deleteFiches([f]);
        render();
        toast('Fiche supprimée');
      })
  );
  $('#delHidden')?.addEventListener('click', async () => {
    const hidden = fiches().filter((f) => !f.visible);
    const names =
      hidden
        .slice(0, 12)
        .map((f) => '• ' + titleOf(f))
        .join('\n') + (hidden.length > 12 ? `\n… et ${hidden.length - 12} autre(s)` : '');
    if (!confirm(`Supprimer définitivement les ${hidden.length} fiche(s) masquée(s) et leurs photos ?\n\n${names}`)) return;
    await deleteFiches(hidden);
    render();
    toast(`${hidden.length} fiche(s) supprimée(s)`);
  });
  const setAll = (v) => {
    fiches().forEach((f) => (f.visible = v));
    changedMap();
    render();
  };
  $('#visAll').onclick = () => setAll(true);
  $('#visNone').onclick = () => setAll(false);
  $('#newFiche').onclick = () => openEditor(null);
  $('#sortRef')?.addEventListener('click', () => {
    S.map.fiches = sortByRef(fiches());
    changedMap();
    render();
    toast('Fiches rangées par réf. photo');
  });

  $('#sheetImport').onchange = async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (file) await importSpreadsheet(file);
  };
  $('#sheetTemplate').onclick = () => download(templateCsv(), 'Modèle fiches botaniques.csv', 'text/csv;charset=utf-8');
  $('#sheetExport').onclick = () => download(buildCsv(fiches(), progress()), safeFileName(`Fiches - ${S.map.name}`) + '.csv', 'text/csv;charset=utf-8');

  $('#compare').onclick = showResults;
  $('#reopen')?.addEventListener('click', () => {
    if (!confirm("Rouvrir l'exercice ? Les élèves pourront de nouveau déplacer leurs points.")) return;
    progress().verified = false;
    changedProgress();
    render();
    toast('Exercice rouvert');
  });
  $('#newSession').onclick = () => {
    if (
      !confirm(
        'Commencer une nouvelle séance ?\n\nLes placements des élèves, leurs mesures (température, hygrométrie, éclairement) et leurs noms seront effacés de ce navigateur. Les fiches et les positions réelles sont conservées.'
      )
    )
      return;
    S.progress[S.map.id] = emptyProgress();
    changedProgress();
    prefs.del('ib.studentNames');
    $('#studentNames').value = '';
    render();
    toast('Nouvelle séance prête');
  };
}
