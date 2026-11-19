/**
 * Le modèle de fiche d'un cours : ses champs, leurs types, et ce qu'on peut y écrire (cahier des charges, section 5.12).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AUDIENCES,
  LIMITS,
  RESERVED,
  TYPES,
  ficheFields,
  newFieldId,
  normalizeTemplate,
  normalizeValue,
  questionFields,
  searchFields,
  subtitleField,
  templateProblems,
  titleField
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
