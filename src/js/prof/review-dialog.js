/**
 * Corriger les réponses d'un lancement (QST-04) : question par question pour toute la classe, ce qui va plus vite pour
 * trente copies, ou élève par élève. Chaque verdict part aussitôt au serveur ; celui de l'enseignant l'emporte sur celui du
 * serveur, et s'efface pour le lui rendre. Tout texte d'élève passe par des nœuds de texte (SEC-04).
 */
import { api } from '../api.js';
import { button, el } from '../compte/ui.js';
import { checkOf, questionFields, valueText } from '../fields.js';
import { numberOf, titleOf, visibleFiches } from '../model.js';
import { errorText } from '../util.js';
import { MAX_COMMENT, VERDICTS, VERDICT_LABELS, expectedText } from '../verdicts.js';

/**
 * @param sheets ce que répond GET /launches/:id/sheets, le cours étant déjà normalisé (readSheets)
 * @param onChange à appeler après chaque correction : la liste des élèves recompte
 */
export function openReviews(launchId, sheets, onChange) {
  const { project } = sheets;
  const students = sheets.participants.filter((participant) => participant.results);
  const questions = questionFields(project.template).filter((field) => checkOf(field) !== 'none');
  const state = { by: 'question', question: questions[0]?.id, student: students[0]?.id, todo: true };

  const close = button('×', 'x', () => dialog.close());
  close.setAttribute('aria-label', 'Fermer');
  const error = el('p', { className: 'form-error', role: 'alert', hidden: true });
  const list = el('div', { className: 'review-list' });
  const choose = el('div', { className: 'review-choose' });
  const dialog = el(
    'dialog',
    { className: 'detail-dialog review-dialog', 'aria-label': 'Corriger les réponses' },
    el(
      'div',
      { className: 'dlg' },
      el(
        'div',
        { className: 'dlg-head' },
        el(
          'div',
          { style: 'flex:1' },
          el('h2', {}, 'Corriger les réponses'),
          el('p', { className: 'state' }, 'Votre verdict remplace celui du serveur, et s’enregistre aussitôt.')
        ),
        close
      ),
      el('div', { className: 'dlg-body' }, choose, error, list)
    )
  );
  dialog.addEventListener('close', () => dialog.remove());

  /** Le verdict d'une réponse : celui de l'enseignant s'il y en a un, sinon celui du serveur. */
  const verdictOf = (student, mapId, ficheId, questionId) => {
    const review = student.reviews?.[mapId]?.[ficheId]?.[questionId];
    return { review, verdict: review?.verdict ?? student.results.maps[mapId]?.fiches[ficheId]?.questions?.[questionId] };
  };

  async function save(student, mapId, ficheId, questionId, verdict, comment = '') {
    error.hidden = true;
    try {
      const { reviews } = await api('PUT', `/launches/${launchId}/participants/${student.id}/reviews`, {
        map: mapId,
        fiche: ficheId,
        question: questionId,
        verdict,
        comment
      });
      student.reviews = reviews;
      draw();
      onChange();
    } catch (e) {
      error.textContent = `Correction impossible : ${errorText(e)}`;
      error.hidden = false;
    }
  }

  /** Une réponse : qui, quelle fiche, ce qu'il a écrit, la bonne réponse, le verdict, et de quoi le changer. */
  function row(student, map, fiche, field) {
    const { review, verdict } = verdictOf(student, map.id, fiche.id, field.id);
    const answer = valueText(field, student.answers?.[map.id]?.[fiche.id]?.[field.id], { unit: true });
    const expected = fiche.expected?.[field.id];
    const where =
      state.by === 'question'
        ? `${student.names} · ${numberOf(map, fiche)}. ${titleOf(fiche, project.template)}`
        : `${numberOf(map, fiche)}. ${titleOf(fiche, project.template)} · ${field.label}`;
    const comment = el('input', {
      className: 'text-input',
      value: review?.comment ?? '',
      maxLength: MAX_COMMENT,
      placeholder: 'Commentaire (facultatif)',
      'aria-label': `Commentaire : ${where}`,
      disabled: !review
    });
    comment.addEventListener('change', () => save(student, map.id, fiche.id, field.id, review.verdict, comment.value));
    const buttons = VERDICTS.map((choice) => {
      const node = button(VERDICT_LABELS[choice], `btn sm verdict-${choice}`, () => save(student, map.id, fiche.id, field.id, choice, comment.value));
      node.setAttribute('aria-pressed', String(review?.verdict === choice));
      return node;
    });
    const restore = review ? [button('Rendre au serveur', 'btn ghost sm', () => save(student, map.id, fiche.id, field.id, null))] : [];
    return el(
      'div',
      { className: `review-row ${verdict}` },
      el('p', { className: 'review-where' }, where),
      el('p', { className: 'review-answer' }, answer || '(sans réponse)'),
      ...(expected !== undefined ? [el('p', { className: 'hint' }, `Bonne réponse : ${expectedText(field, expected)}`)] : []),
      el('p', { className: `verdict ${verdict}` }, `${VERDICT_LABELS[verdict]}${review ? ' · par vous' : verdict === 'pending' ? '' : ' · par le serveur'}`),
      el('div', { className: 'row-actions' }, ...buttons, ...restore),
      comment
    );
  }

  function rows() {
    const out = [];
    for (const map of project.maps) {
      for (const fiche of visibleFiches(map)) {
        const pairs =
          state.by === 'question'
            ? students.map((student) => [student, questions.find((field) => field.id === state.question)])
            : questions.map((field) => [students.find((student) => student.id === state.student), field]);
        for (const [student, field] of pairs) {
          if (!student || !field) continue;
          if (state.todo && verdictOf(student, map.id, fiche.id, field.id).verdict !== 'pending') continue;
          out.push(row(student, map, fiche, field));
        }
      }
    }
    return out;
  }

  function draw() {
    const mode = (by, label) => {
      const node = button(label, 'chip', () => {
        state.by = by;
        draw();
      });
      node.setAttribute('aria-pressed', String(state.by === by));
      return node;
    };
    const picker =
      state.by === 'question'
        ? el(
            'select',
            { id: 'reviewQuestion', 'aria-label': 'Question' },
            ...questions.map((field) => el('option', { value: field.id, selected: field.id === state.question }, field.label))
          )
        : el(
            'select',
            { id: 'reviewStudent', 'aria-label': 'Élève' },
            ...students.map((student) => el('option', { value: student.id, selected: student.id === state.student }, student.names))
          );
    picker.addEventListener('change', () => {
      state[state.by === 'question' ? 'question' : 'student'] = picker.value;
      draw();
    });
    const todo = el('input', { type: 'checkbox', id: 'reviewTodo', checked: state.todo });
    todo.addEventListener('change', () => {
      state.todo = todo.checked;
      draw();
    });
    choose.replaceChildren(
      el('div', { className: 'chips' }, mode('question', 'Par question'), mode('student', 'Par élève')),
      picker,
      el('label', { className: 'check' }, todo, ' Seulement ce qui reste à corriger')
    );
    const found = rows();
    list.replaceChildren(...(found.length ? found : [el('div', { className: 'empty-box' }, state.todo ? 'Plus rien à corriger ici.' : 'Aucune réponse ici.')]));
  }

  if (!questions.length || !students.length) {
    list.replaceChildren(el('div', { className: 'empty-box' }, questions.length ? 'Personne n’a encore rendu.' : 'Ce cours n’a pas de question à corriger.'));
  } else draw();
  document.body.append(dialog);
  dialog.showModal();
}
