/**
 * Les résultats d'un lancement, sur sa page (HIS-03 à HIS-09) : une ligne par élève, son détail, son compte rendu, et pour tous ensemble l'archive des
 * comptes rendus et le fichier Excel. Tout texte passe par des nœuds de texte : un nom d'élève ne peut pas injecter de code.
 */
import { api } from '../api.js';
import { el, errorLine, showError } from '../compte/ui.js';
import { MEASURES, numberOf, titleOf, visibleFiches } from '../model.js';
import { download, errorText, safeFileName } from '../util.js';
import { workbookBlob } from '../xlsx-write.js';
import { resultsWorkbook, stateText } from './results-workbook.js';
import { allReportsZip, readSheets, studentPlan, studentReports } from './student-reports.js';

const GRADES = {
  ok: ['Bien placée', 'ok'],
  near: ['Proche', 'near'],
  far: ['À revoir', 'far'],
  unplaced: ['Non placée', 'none'],
  noref: ['Pas de position réelle', 'none']
};
const frNumber = (value) => (value === null || value === undefined ? '—' : value.toLocaleString('fr-FR', { maximumFractionDigits: 1 }));
const scoredCount = ({ ok, near, far, unplaced }) => ok + near + far + unplaced;

function button(label, className, onClick) {
  const node = el('button', { className, type: 'button' }, label);
  node.addEventListener('click', onClick);
  return node;
}

function detailDialog(project, participant) {
  const close = button('×', 'x', () => dialog.close());
  close.setAttribute('aria-label', 'Fermer');
  const body = el('div', { className: 'dlg-body' });
  const dialog = el(
    'dialog',
    { className: 'detail-dialog', 'aria-label': `Réponses de ${participant.names}` },
    el(
      'div',
      { className: 'dlg' },
      el(
        'div',
        { className: 'dlg-head' },
        el('div', { style: 'flex:1' }, el('h2', {}, participant.names), el('p', { className: 'state' }, stateText(participant))),
        close
      ),
      body
    )
  );
  dialog.addEventListener('close', () => dialog.remove());

  for (const map of project.maps) {
    const rows = visibleFiches(map).map((fiche) => {
      const entry = participant.answers?.[map.id]?.[fiche.id] ?? {};
      const result = participant.results.maps[map.id]?.fiches[fiche.id] ?? { state: 'unplaced' };
      const [label, look] = GRADES[result.state];
      return el(
        'tr',
        {},
        el('td', { className: 'n' }, String(numberOf(map, fiche))),
        el('td', {}, titleOf(fiche)),
        el('td', {}, el('span', { className: `grade ${look}` }, label)),
        el('td', {}, result.dist ?? '—'),
        ...MEASURES.map(([key]) => el('td', {}, entry[key] || '—'))
      );
    });
    const image = el('img', { className: 'detail-plan', alt: `Plan « ${map.name} » de ${participant.names}` });
    body.append(
      el('h3', { className: 'mini-h' }, map.name),
      image,
      el(
        'div',
        { className: 'table-wrap' },
        el(
          'table',
          { className: 'results' },
          el(
            'thead',
            {},
            el(
              'tr',
              {},
              ...['N°', 'Fiche', 'Résultat', 'Écart', ...MEASURES.map(([, , unit, label]) => `${label} (${unit})`)].map((title) => el('th', {}, title))
            )
          ),
          el('tbody', {}, ...rows)
        )
      )
    );
    studentPlan(project, participant, map).then(
      (blob) => (image.src = URL.createObjectURL(blob)),
      () => image.remove()
    );
  }
  document.body.append(dialog);
  dialog.showModal();
  return dialog;
}

/**
 * @param launchId le lancement affiché
 * @param onChange à appeler quand la liste a changé : un fichier importé, par exemple
 */
export function resultsSection(launchId, onChange) {
  const error = errorLine();
  const status = el('p', { className: 'hint', role: 'status' });
  let handedIn = false;
  const loadSheets = async () => readSheets(await api('GET', `/launches/${launchId}/sheets`));

  /** Un seul travail à la fois : pendant ce temps, les boutons ne repartent pas. */
  async function task(buttonNode, work) {
    error.hidden = true;
    buttonNode.disabled = true;
    try {
      await work();
    } catch (e) {
      showError(error, { message: errorText(e) });
    } finally {
      buttonNode.disabled = false;
    }
  }

  const saveAll = button('Tout télécharger (JPG)', 'btn', () =>
    task(saveAll, async () => {
      const { project, participants, title, openedAt } = await loadSheets();
      const blob = await allReportsZip(
        project,
        participants.filter((participant) => participant.results),
        openedAt,
        (done, total) => (status.textContent = `Préparation des comptes rendus… ${done} / ${total}`)
      );
      download(blob, `Comptes rendus - ${safeFileName(title)}.zip`);
      status.textContent = '✓ Comptes rendus téléchargés';
    })
  );

  const saveExcel = button('Télécharger l’Excel', 'btn soft', () =>
    task(saveExcel, async () => {
      const sheets = await loadSheets();
      download(workbookBlob(resultsWorkbook(sheets)), `Résultats - ${safeFileName(sheets.title)}.xlsx`);
      status.textContent = '✓ Excel téléchargé';
    })
  );

  const fileInput = el('input', { type: 'file', accept: '.json,application/json', hidden: true, id: 'answersFile' });
  fileInput.addEventListener('change', async () => {
    const [file] = fileInput.files;
    fileInput.value = '';
    if (!file) return;
    error.hidden = true;
    try {
      let content;
      try {
        content = JSON.parse(await file.text());
      } catch {
        throw new Error("Ce n'est pas un fichier de réponses.");
      }
      const { names, alreadyReceived } = await api('POST', `/launches/${launchId}/answers-file`, content);
      status.textContent = alreadyReceived
        ? `Les réponses de ${names} étaient déjà arrivées : la première version reste.`
        : `✓ Réponses de ${names} importées.`;
      await onChange();
    } catch (e) {
      showError(error, { message: errorText(e) });
    }
  });
  const importFile = button('Importer un fichier de réponses', 'btn ghost', () => fileInput.click());

  const remove = button('Supprimer ce lancement', 'btn danger', async () => {
    if (!confirm('Supprimer ce lancement ?\n\nLa liste des élèves et leurs réponses seront effacées pour de bon.')) return;
    await task(remove, async () => {
      await api('DELETE', `/launches/${launchId}`);
      location.href = remove.dataset.back;
    });
  });

  const bulk = el('div', { className: 'row-actions results-actions' }, saveAll, saveExcel, importFile, fileInput);
  const section = el('div', { className: 'results-section' }, status, error, bulk, remove);

  return {
    section,
    /** Les boutons d'un élève. Le détail et le compte rendu lisent les réponses seulement à la demande : la liste, elle, se recharge toutes les 5 secondes. */
    rowActions(participant) {
      if (!participant.submittedAt) return null;
      const openDetail = button('Détail', 'btn ghost sm', () =>
        task(openDetail, async () => {
          const { project, participants } = await loadSheets();
          detailDialog(
            project,
            participants.find(({ id }) => id === participant.id)
          );
        })
      );
      const saveOne = button('JPG', 'btn soft sm', () =>
        task(saveOne, async () => {
          const { project, participants, openedAt } = await loadSheets();
          const student = participants.find(({ id }) => id === participant.id);
          const reports = await studentReports(project, student, openedAt);
          // Plusieurs cartes, donc plusieurs fichiers : un navigateur en bloque souvent les suivants
          if (reports.length === 1) download(reports[0].blob, reports[0].name);
          else download(await allReportsZip(project, [student], openedAt), `Compte rendu - ${safeFileName(student.names)}.zip`);
          status.textContent = `✓ Compte rendu de ${participant.names} téléchargé`;
        })
      );
      return el('span', { className: 'row-actions' }, openDetail, saveOne);
    },
    scoreLine(participant, gapUnit) {
      if (!participant.score) return null;
      return el(
        'span',
        { className: 'participant-score' },
        `${participant.score.ok} / ${scoredCount(participant.score)} bien placée(s) · écart moyen ${frNumber(participant.meanGap)} ${gapUnit}`
      );
    },
    update(launch, backHref) {
      handedIn = launch.participants.some((participant) => participant.submittedAt);
      saveAll.hidden = saveExcel.hidden = !handedIn;
      remove.hidden = !launch.endedAt;
      remove.dataset.back = backHref;
    }
  };
}
