/**
 * Le modèle de fiche d'un cours : ses champs, leurs types, et ce qu'on peut y écrire (cahier des charges, section 5.12).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ANSWER_LIMITS,
  AUDIENCES,
  CHECKS,
  CHECK_LABELS,
  COMPATIBLE,
  TYPE_LABELS,
  checkOf,
  cleanField,
  LIMITS,
  RESERVED,
  TYPES,
  answersWord,
  columnTitle,
  emptyAnswers,
  ficheFields,
  fieldGroups,
  hasAnswers,
  isEmpty,
  isValidValue,
  listFields,
  maxLength,
  newFieldId,
  normalizeTemplate,
  normalizeValue,
  questionFields,
  questionNames,
  searchFields,
  subtitleField,
  templateProblems,
  titleField,
  valueText
} from '../src/js/fields.js';
import { BOTANIQUE } from '../src/js/templates/botanique.js';

const text = (id, more = {}) => ({ id, type: 'text', label: 'Un texte', audience: 'info', ...more });
const choice = (more = {}) => ({
  id: 'c-arbre',
  type: 'choice',
  label: 'Quel est cet arbre ?',
  audience: 'question',
  choices: [
    { id: 'chene', label: 'Chêne' },
    { id: 'hetre', label: 'Hêtre' }
  ],
  ...more
});
const withFields = (...fields) => ({ fields });
const problemsOf = (...fields) => templateProblems(withFields(...fields));

test('CHP-01 : un modèle complet, de chaque type et de chaque public, est accepté tel quel', () => {
  const template = {
    name: 'Patrimoine',
    source: { courseId: 'abc', title: 'Sortie 2026' },
    fields: [
      text('c-nom', { role: 'title', search: true, placeholder: 'Église Saint-Paul', aliases: ['nom'] }),
      { id: 'c-siecle', type: 'number', label: 'Siècle', audience: 'info', unit: 'e', keyboard: 'numeric', list: true },
      { id: 'c-visite', type: 'date', label: 'Visité le', audience: 'info' },
      { id: 'h-1', type: 'heading', label: 'À observer', help: 'Regardez la façade.' },
      { id: 'c-desc', type: 'longtext', label: 'Description', audience: 'info', search: true, icon: '🏛️' },
      choice({ multiple: true, required: true }),
      { id: 'c-ouvert', type: 'yesno', label: 'Est-il ouvert ?', audience: 'question' },
      { id: 'c-etat', type: 'scale', label: 'État', audience: 'question', max: 4, symbol: '⭐' },
      { id: 'c-age', type: 'text', label: 'Âge réel', audience: 'correction' },
      { id: 'c-note', type: 'longtext', label: 'Pour moi', audience: 'teacher' }
    ]
  };
  assert.deepEqual(templateProblems(template), []);
  assert.deepEqual(normalizeTemplate(template), template);
  assert.notEqual(normalizeTemplate(template), template, 'une copie, que l’on peut modifier sans toucher à l’original');
  assert.deepEqual(new Set(template.fields.map((field) => field.type)), new Set(TYPES));
  assert.deepEqual(new Set(template.fields.filter((field) => field.audience).map((field) => field.audience)), new Set(AUDIENCES));
});

test('CHP-01 : un modèle mal formé est refusé, avec la raison en clair', () => {
  for (const bad of [
    null,
    [],
    'modèle',
    { fields: 'non' },
    { fields: [], extra: 1 },
    { name: 'x'.repeat(LIMITS.name + 1), fields: [] },
    { source: 'x', fields: [] }
  ]) {
    assert.notDeepEqual(templateProblems(bad), [], JSON.stringify(bad)?.slice(0, 40));
  }
  assert.throws(
    () => normalizeTemplate({ fields: [{ id: 'x', type: 'photo', label: 'Photo', audience: 'info' }] }),
    /modèle de fiche invalide : champ 1 : type inconnu/
  );
  assert.deepEqual(templateProblems(withFields(...Array.from({ length: LIMITS.fields }, (_, i) => text(`c-${i}`)))), []);
  assert.match(templateProblems(withFields(...Array.from({ length: LIMITS.fields + 1 }, (_, i) => text(`c-${i}`))))[0], /60 champs au plus/);
});

test('CHP-01 : un champ ne peut pas prendre le nom d’une propriété de la fiche ou d’une réponse, ni un nom mal formé', () => {
  for (const id of [...RESERVED, '', 'A', '1a', 'a b', 'é', 'a'.repeat(LIMITS.id + 1), 12]) {
    assert.match(problemsOf(text(id)).join(), /identifiant invalide/, String(id));
  }
  assert.deepEqual(problemsOf(text('c-a'), text('c-b')), []);
  assert.match(problemsOf(text('c-a'), text('c-a')).join(), /même identifiant/);
});

test('CHP-01 : chaque réglage est contrôlé', () => {
  const cases = [
    [text('c-a', { label: '' }), /libellé/],
    [text('c-a', { label: '   ' }), /libellé/],
    [text('c-a', { label: 'x'.repeat(LIMITS.label + 1) }), /libellé/],
    [text('c-a', { audience: 'tous' }), /public inconnu/],
    [{ id: 'c-a', type: 'date', label: 'Quand ?', audience: 'question' }, /ne peut pas être une question/],
    [text('c-a', { icon: 'x'.repeat(LIMITS.icon + 1) }), /icône/],
    [text('c-a', { help: 'x'.repeat(LIMITS.help + 1) }), /aide/],
    [text('c-a', { placeholder: 'x'.repeat(LIMITS.placeholder + 1) }), /exemple/],
    [text('c-a', { list: 'oui' }), /réglage invalide/],
    [text('c-a', { search: true, audience: 'teacher' }), /recherche/],
    [{ id: 'c-a', type: 'number', label: 'N', audience: 'info', search: true }, /propriété inconnue/],
    [text('c-a', { required: true }), /obligatoire/],
    [text('c-a', { aliases: 'nom' }), /colonne/],
    [text('c-a', { aliases: Array(LIMITS.aliases + 1).fill('a') }), /colonne/],
    [text('c-a', { role: 'titre' }), /rôle/],
    [text('c-a', { role: 'title', audience: 'question' }), /rôle/],
    [{ id: 'c-a', type: 'longtext', label: 'L', audience: 'info', role: 'title' }, /propriété inconnue « role »/],
    [{ id: 'c-a', type: 'number', label: 'N', audience: 'question', unit: 'x'.repeat(LIMITS.unit + 1) }, /unité/],
    [{ id: 'c-a', type: 'number', label: 'N', audience: 'question', keyboard: 'tel' }, /clavier/],
    [{ id: 'c-a', type: 'scale', label: 'É', audience: 'question', max: 6 }, /échelle/],
    [{ id: 'c-a', type: 'scale', label: 'É', audience: 'question', max: 1 }, /échelle/],
    [{ id: 'c-a', type: 'scale', label: 'É', audience: 'question', symbol: 'x'.repeat(LIMITS.icon + 1) }, /symbole/],
    [{ id: 'h-a', type: 'heading', label: 'x'.repeat(LIMITS.label + 1) }, /intertitre/],
    [{ id: 'h-a', type: 'heading', label: 'Partie', audience: 'info' }, /propriété inconnue/],
    [{ id: 'h-a', type: 'heading', label: 'Partie', help: 'x'.repeat(LIMITS.help + 1) }, /aide/],
    [text('c-a', { onclick: 'alert(1)' }), /propriété inconnue « onclick »/],
    ['champ', /ce n'est pas un champ/]
  ];
  for (const [field, expected] of cases) assert.match(problemsOf(field).join(' | '), expected, JSON.stringify(field).slice(0, 80));
  assert.match(problemsOf(text('c-a', { role: 'title' }), text('c-b', { role: 'title' })).join(), /un seul champ peut servir de titre/);
  assert.match(problemsOf(text('c-a', { role: 'subtitle' }), text('c-b', { role: 'subtitle' })).join(), /sous-titre/);
  assert.deepEqual(problemsOf({ id: 'h-fin', type: 'heading', label: '' }), [], 'un intertitre sans libellé ferme un groupe');
});

test('CHP-01 : une question à choix propose de 2 à 30 réponses, chacune avec son identifiant et son libellé', () => {
  assert.deepEqual(problemsOf(choice()), []);
  const many = Array.from({ length: LIMITS.choices + 1 }, (_, i) => ({ id: `r${i}`, label: `Réponse ${i}` }));
  for (const choices of [undefined, [], [{ id: 'a', label: 'A' }], many]) assert.match(problemsOf(choice({ choices })).join(), /de 2 à 30/);
  for (const bad of [{ id: 'a' }, { id: 'A', label: 'A' }, { id: 'a', label: '' }, { id: 'a', label: 'A', correct: true }, 'a', null]) {
    assert.match(problemsOf(choice({ choices: [bad, { id: 'b', label: 'B' }] })).join(), /proposition invalide/, JSON.stringify(bad));
  }
  assert.match(
    problemsOf(
      choice({
        choices: [
          { id: 'a', label: 'A' },
          { id: 'a', label: 'B' }
        ]
      })
    ).join(),
    /même identifiant/
  );
  assert.match(problemsOf(choice({ multiple: 'oui' })).join(), /réglage invalide/);
});

test('CHP-01 : une valeur se lit selon le type de son champ, et ce qui ne correspond à rien devient vide', () => {
  assert.equal(normalizeValue(text('c-a'), 12), '12', 'du texte, comme en format 3');
  assert.equal(normalizeValue(text('c-a'), undefined), '');
  assert.equal(normalizeValue({ type: 'number' }, 'nuageux'), 'nuageux', 'MES-04 : la saisie reste libre');
  assert.equal(normalizeValue(choice(), 'hetre'), 'hetre');
  assert.equal(normalizeValue(choice(), 'erable'), '');
  assert.deepEqual(normalizeValue(choice({ multiple: true }), ['hetre', 'erable', 'chene', 'hetre']), ['hetre', 'chene']);
  assert.deepEqual(normalizeValue(choice({ multiple: true }), 'chene'), ['chene']);
  assert.deepEqual(normalizeValue(choice({ multiple: true }), undefined), []);
  assert.deepEqual(
    ['oui', 'non', true, false, 'peut-être', undefined].map((v) => normalizeValue({ type: 'yesno' }, v)),
    ['oui', 'non', 'oui', 'non', '', '']
  );
  assert.deepEqual(
    [1, '3', 4, 5, 0, 2.5, 'x'].map((v) => normalizeValue({ type: 'scale', max: 4 }, v)),
    [1, 3, 4, '', '', '', '']
  );
  assert.equal(normalizeValue({ type: 'scale' }, 5), 5, 'sans maximum, l’échelle va jusqu’à 5');
});

test('CHP-01 : les champs se trient par rôle : remplis par l’enseignant, questions, titre, recherche', () => {
  assert.deepEqual(
    ficheFields(BOTANIQUE).map((field) => field.id),
    ['common', 'species', 'family', 'date', 'exposure', 'watering', 'soil', 'heat', 'care', 'description', 'notes']
  );
  assert.deepEqual(
    questionFields(BOTANIQUE).map((field) => field.id),
    ['temperature', 'humidity', 'light']
  );
  assert.equal(titleField(BOTANIQUE).id, 'common');
  assert.equal(subtitleField(BOTANIQUE).id, 'species');
  assert.deepEqual(
    searchFields(BOTANIQUE).map((field) => field.id),
    ['common', 'species', 'family']
  );
});

test('CHP-01 : un nouveau champ reçoit un identifiant préfixé, qui ne croise jamais une propriété de la fiche', () => {
  const ids = new Set(Array.from({ length: 200 }, () => newFieldId()));
  assert.equal(ids.size, 200);
  for (const id of ids) {
    assert.match(id, /^c-[a-z0-9]{10}$/);
    assert.deepEqual(problemsOf(text(id)), []);
  }
  assert.match(newFieldId('h'), /^h-/);
});

test('CHP-01 : les champs se rangent sous leurs intertitres ; un intertitre sans libellé ferme le groupe', () => {
  assert.deepEqual(
    fieldGroups(BOTANIQUE).map(({ heading, fields }) => [heading?.label ?? null, fields.map((field) => field.id)]),
    [
      [null, ['common', 'species', 'family', 'date']],
      ['Besoins', ['exposure', 'watering', 'soil', 'heat', 'care']],
      ['Vos mesures', ['temperature', 'humidity', 'light']],
      [null, ['description', 'notes']]
    ]
  );
  const heading = { id: 'h-a', type: 'heading', label: 'Partie' };
  assert.deepEqual(fieldGroups(withFields(heading, text('c-a'))), [{ heading, fields: [text('c-a')] }], 'pas de groupe vide avant le premier intertitre');
  assert.deepEqual(fieldGroups(withFields({ id: 'h-a', type: 'heading', label: 'Seul' })), [], 'un intertitre sans champ ne fait pas de groupe');
  assert.deepEqual(
    listFields(BOTANIQUE).map((field) => field.id),
    ['family', 'temperature', 'humidity', 'light'],
    'le titre et le sous-titre ont leur place à part'
  );
});

test('CHP-01 : une valeur se lit en clair, selon son type', () => {
  const multiple = choice({ multiple: true });
  assert.equal(valueText(choice(), 'hetre'), 'Hêtre');
  assert.equal(valueText(multiple, ['hetre', 'chene']), 'Hêtre, Chêne');
  assert.equal(valueText(multiple, ['inconnu']), '');
  assert.equal(valueText({ type: 'yesno' }, 'oui'), 'Oui');
  assert.equal(valueText({ type: 'yesno' }, 'non'), 'Non');
  assert.equal(valueText({ type: 'scale', symbol: '☀️' }, 3), '☀️☀️☀️');
  assert.equal(valueText({ type: 'scale', max: 4 }, 3), '3 / 4');
  assert.equal(valueText({ type: 'scale' }, 2), '2 / 5');
  assert.match(valueText({ type: 'date' }, '2026-09-28'), /28\/09\/2026/);
  assert.equal(valueText({ type: 'date' }, 'au printemps'), 'au printemps');
  assert.equal(valueText({ type: 'number', unit: '°C' }, '21'), '21');
  assert.equal(valueText({ type: 'number', unit: '°C' }, '21', { unit: true }), '21 °C');
  assert.equal(valueText({ type: 'number' }, '21', { unit: true }), '21');
  assert.equal(valueText(text('c-a'), 'Un mot'), 'Un mot');
  for (const empty of ['', null, undefined, []]) {
    assert.ok(isEmpty(empty));
    assert.equal(valueText(text('c-a'), empty), '');
  }
  assert.ok(!isEmpty(0) && !isEmpty('non') && !isEmpty(['a']));
  assert.equal(columnTitle({ label: 'Température', unit: '°C' }), 'Température (°C)');
  assert.equal(columnTitle({ label: 'Nom' }), 'Nom');
});

test('CHP-01 : les réponses d’une fiche partent vides, chacune selon sa question', () => {
  assert.deepEqual(emptyAnswers(BOTANIQUE), { temperature: '', humidity: '', light: '' }, 'comme avant la version 2.0.0');
  const quiz = withFields(text('c-info'), choice({ multiple: true }), { id: 'c-ok', type: 'yesno', label: 'Ouvert ?', audience: 'question' });
  assert.deepEqual(emptyAnswers(quiz), { 'c-arbre': [], 'c-ok': '' });
  assert.ok(!hasAnswers(emptyAnswers(quiz), quiz));
  assert.ok(!hasAnswers(null, quiz));
  assert.ok(!hasAnswers({ 'c-info': 'une valeur de la fiche, pas une réponse' }, quiz));
  assert.ok(hasAnswers({ 'c-arbre': ['chene'] }, quiz));
  assert.ok(hasAnswers({ 'c-ok': 'non' }, quiz));
});

test('CHP-01 : ce que notent les élèves se nomme d’après les questions', () => {
  assert.equal(answersWord(BOTANIQUE), 'mesures');
  assert.equal(questionNames(BOTANIQUE), 'température, hygrométrie, éclairement');
  const quiz = withFields(choice(), { id: 'c-adn', type: 'text', label: 'ADN observé', audience: 'question' });
  assert.equal(answersWord(quiz), 'réponses');
  assert.equal(questionNames(quiz), 'quel est cet arbre ?, ADN observé', 'un sigle garde ses majuscules');
  assert.equal(answersWord(withFields(text('c-a'))), 'réponses', 'sans question, ce ne sont pas des mesures');
});

test('CHP-07 : un texte a sa longueur permise, plus courte pour la réponse d’un élève, et un texte trop long est coupé à la lecture', () => {
  assert.equal(maxLength(text('c-a')), 300);
  assert.equal(maxLength({ type: 'longtext' }), 10000);
  assert.equal(maxLength({ type: 'number' }), 300);
  assert.equal(maxLength({ type: 'date' }), 300);
  assert.deepEqual(
    ['text', 'longtext', 'number'].map((type) => maxLength({ type }, { answer: true })),
    [300, 2000, 50]
  );
  assert.equal(ANSWER_LIMITS.number, 50, 'comme les mesures avant la version 2.0.0');
  assert.equal(normalizeValue({ type: 'longtext' }, 'x'.repeat(10001)).length, 10000);
  assert.equal(normalizeValue({ type: 'number' }, 'x'.repeat(60), { answer: true }).length, 50);
  assert.equal(normalizeValue({ type: 'number' }, 'x'.repeat(60)).length, 60);
});

test('CHP-07 : une valeur valable est déjà dans sa forme normale ; le reste est refusé tel quel, sans être réparé', () => {
  const multiple = choice({ multiple: true });
  const valid = [
    [text('c-a'), ''],
    [text('c-a'), 'x'.repeat(300)],
    [{ type: 'longtext' }, 'x'.repeat(10000)],
    [choice(), ''],
    [choice(), 'chene'],
    [multiple, []],
    [multiple, ['hetre', 'chene']],
    [{ type: 'yesno' }, 'non'],
    [{ type: 'scale', max: 3 }, 3],
    [{ type: 'scale' }, '']
  ];
  for (const [field, value] of valid) {
    assert.ok(isValidValue(field, value), JSON.stringify(value).slice(0, 30));
    assert.deepEqual(normalizeValue(field, value), value, 'déjà normale');
  }
  const invalid = [
    [text('c-a'), 'x'.repeat(301)],
    [text('c-a'), 12],
    [text('c-a'), null],
    [{ type: 'longtext' }, 'x'.repeat(10001)],
    [choice(), 'erable'],
    [choice(), ['chene']],
    [multiple, 'chene'],
    [multiple, ['chene', 'chene']],
    [multiple, ['erable']],
    [{ type: 'yesno' }, true],
    [{ type: 'scale', max: 3 }, 4],
    [{ type: 'scale' }, '2'],
    [{ type: 'scale' }, 1.5]
  ];
  for (const [field, value] of invalid) assert.ok(!isValidValue(field, value), JSON.stringify(value).slice(0, 30));
  assert.ok(isValidValue({ type: 'number' }, 'x'.repeat(50), { answer: true }));
  assert.ok(!isValidValue({ type: 'number' }, 'x'.repeat(51), { answer: true }));
  assert.ok(!isValidValue({ type: 'longtext' }, 'x'.repeat(2001), { answer: true }));
});

test('CHP-08 : une question dit comment elle est corrigée ; sans réglage, son type en décide, et les mesures restent non corrigées', () => {
  assert.deepEqual(questionFields(BOTANIQUE).map(checkOf), ['none', 'none', 'none'], 'le modèle botanique, figé, sans réglage');
  assert.deepEqual(
    ['text', 'longtext', 'number', 'choice', 'yesno', 'scale'].map((type) => checkOf({ type, audience: 'question' })),
    ['teacher', 'teacher', 'none', 'auto', 'auto', 'auto']
  );
  assert.equal(checkOf({ type: 'number', audience: 'question', check: 'auto' }), 'auto');
  assert.equal(checkOf(text('c-a')), undefined, 'un renseignement ne se corrige pas');
  assert.deepEqual(Object.keys(CHECK_LABELS), ['auto', 'teacher', 'none']);
  for (const [type, checks] of Object.entries(CHECKS)) {
    for (const check of ['auto', 'teacher', 'none']) {
      const field = { id: 'c-q', type, label: 'Q', audience: 'question', check, ...(type === 'choice' ? { choices: choice().choices } : {}) };
      assert.equal(problemsOf(field).length === 0, checks.includes(check), `${type} ${check}`);
    }
  }
  assert.match(problemsOf(text('c-a', { check: 'teacher' })).join(), /correction impossible/, 'seule une question se corrige');
  assert.match(
    problemsOf({ id: 'c-a', type: 'longtext', label: 'L', audience: 'question', check: 'auto' }).join(),
    /correction impossible/,
    'un texte long ne se corrige pas tout seul'
  );
});

test('MOD-03 : l’éditeur enregistre un champ réduit à ce qui a un sens pour son type et son public', () => {
  const draft = {
    id: 'c-a',
    type: 'text',
    label: '  Monument  ',
    audience: 'question',
    role: 'title',
    search: true,
    list: false,
    icon: '',
    help: ' Regardez la plaque. ',
    required: true,
    check: 'teacher',
    choices: [{ id: 'x', label: 'X' }],
    unit: 'm',
    max: 4
  };
  assert.deepEqual(cleanField(draft), {
    id: 'c-a',
    type: 'text',
    label: 'Monument',
    help: 'Regardez la plaque.',
    audience: 'question',
    required: true,
    check: 'teacher'
  });
  assert.deepEqual(cleanField({ ...draft, audience: 'info' }), {
    id: 'c-a',
    type: 'text',
    label: 'Monument',
    help: 'Regardez la plaque.',
    audience: 'info',
    role: 'title',
    search: true
  });
  assert.deepEqual(
    cleanField({ id: 'h-a', type: 'heading', label: '  ', audience: 'info', help: '' }),
    { id: 'h-a', type: 'heading', label: '' },
    'un intertitre vide ferme un groupe'
  );
  assert.deepEqual(
    cleanField({
      ...choice(),
      choices: [
        { id: 'a', label: ' A ', extra: 1 },
        { id: 'b', label: 'B' }
      ],
      multiple: false
    }).choices,
    [
      { id: 'a', label: 'A' },
      { id: 'b', label: 'B' }
    ]
  );
  for (const type of Object.keys(TYPE_LABELS)) {
    const field = cleanField({
      ...draft,
      type,
      ...(type === 'choice' ? { choices: choice().choices } : {}),
      audience: type === 'date' || type === 'heading' ? 'info' : 'question'
    });
    if (type === 'heading') delete field.help;
    assert.deepEqual(problemsOf(field), [], type);
  }
});

test('MOD-03 : un champ déjà rempli ne change de type que vers un type qui garde ses valeurs', () => {
  for (const [type, targets] of Object.entries(COMPATIBLE)) {
    assert.equal(targets[0], type, 'son propre type d’abord');
    for (const target of targets) {
      const field = { type, choices: choice().choices, max: 5 };
      const value = { text: 'Un mot', longtext: 'Un mot', number: '12', date: '2026-10-02', choice: 'chene', yesno: 'oui', scale: 3, heading: '' }[type];
      assert.deepEqual(normalizeValue({ ...field, type: target }, normalizeValue(field, value)), value, `${type} → ${target}`);
    }
  }
});
