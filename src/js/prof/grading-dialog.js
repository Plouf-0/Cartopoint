/**
 * La notation d'un lancement (QST-05) : celle de sa version, que l'enseignant peut changer après coup. Les notes de ce
 * lancement se recalculent ; celles des autres lancements ne bougent pas.
 */
import { api } from '../api.js';
import { button, el } from '../compte/ui.js';
import { errorText } from '../util.js';
import { GRADING_LABELS, GRADING_MODES, gradedQuestions, normalizeGrading } from '../verdicts.js';

/**
 * @param sheets ce que répond GET /launches/:id/sheets, le cours étant déjà normalisé (readSheets)
 * @param onChange à appeler une fois la notation changée : la liste recompte les notes
 */
export function openGrading(launchId, sheets, onChange) {
  const { project } = sheets;
  const questions = gradedQuestions(project.template);
  const hasPlan = project.maps.some((map) => map.image);
  let grading = structuredClone(sheets.grading);
  const body = el('div', { className: 'dlg-body' });
  const error = el('p', { className: 'form-error', role: 'alert', hidden: true });
  const close = button('×', 'x', () => dialog.close());
  close.setAttribute('aria-label', 'Fermer');
  const save = button('Enregistrer', 'btn', async () => {
    error.hidden = true;
    try {
      await api('PUT', `/launches/${launchId}/grading`, { grading: normalizeGrading(read(), project.template) });
      dialog.close();
      onChange();
    } catch (e) {
      error.textContent = `Notation impossible : ${errorText(e)}`;
      error.hidden = false;
    }
  });
  const dialog = el(
    'dialog',
    { className: 'field-dialog grading-dialog', 'aria-label': 'Notation de ce lancement' },
    el(
      'div',
      { className: 'dlg' },
      el('div', { className: 'dlg-head' }, el('h2', {}, 'Notation de ce lancement'), close),
      body,
      el(
        'div',
        { className: 'dlg-foot' },
        error,
        button('Annuler', 'btn ghost', () => dialog.close()),
        save
      )
    )
  );
  dialog.addEventListener('close', () => dialog.remove());

  const number = (id, value, label) =>
    el(
      'div',
      { className: 'field grading-points' },
      el('label', { htmlFor: id }, label),
      el('input', { id, className: 'text-input', inputMode: 'decimal', value: String(value).replace('.', ',') })
    );

  /** La notation telle que la fenêtre la montre. */
  function read() {
    const value = (id) => body.querySelector(`#${id}`)?.value;
    if (grading.mode === 'points')
      return {
        mode: 'points',
        points: Object.fromEntries(questions.map((field) => [field.id, value(`lpoints-${field.id}`)])),
        placement: value('lpointsPlacement') ?? grading.placement
      };
    if (grading.mode === 'auto') return { mode: 'auto', max: value('lgradingMax'), placement: body.querySelector('#lgradingPlacement')?.checked ?? false };
    return { mode: 'none' };
  }

  function build() {
    const modes = GRADING_MODES.map((mode) => {
      const radio = el('input', { type: 'radio', name: 'launchGrading', value: mode, checked: grading.mode === mode });
      radio.addEventListener('change', () => {
        grading = normalizeGrading({ mode, placement: mode === 'auto' ? hasPlan : 1 }, project.template);
        build();
      });
      return el('label', { className: 'check' }, radio, ` ${GRADING_LABELS[mode]}`);
    });
    const settings = [];
    if (grading.mode === 'points') {
      settings.push(...questions.map((field) => number(`lpoints-${field.id}`, grading.points[field.id] ?? 1, `${field.label} : points par fiche`)));
      if (hasPlan) settings.push(number('lpointsPlacement', grading.placement, 'Placement : points par fiche'));
    }
    if (grading.mode === 'auto') {
      settings.push(number('lgradingMax', grading.max, 'Note maximale'));
      if (hasPlan)
        settings.push(
          el(
            'label',
            { className: 'check' },
            el('input', { type: 'checkbox', id: 'lgradingPlacement', checked: grading.placement }),
            ' Compter le placement dans la note'
          )
        );
    }
    body.replaceChildren(
      el('p', {}, 'Les notes de ce lancement se recalculent ; la notation du cours et des autres lancements ne change pas.'),
      ...modes,
      ...settings
    );
  }

  build();
  document.body.append(dialog);
  dialog.showModal();
}
