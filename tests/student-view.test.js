/**
 * CRG-01 : le test le plus important du projet. Un élève ne doit recevoir ni les positions réelles, ni les fiches masquées,
 * ni aucun réglage de l'enseignant. Tout ce qui est marqué SECRET ou porte une valeur de POSITION ne doit jamais ressortir.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { studentCourse } from '../server/student-view.mjs';
import { normalizeProject } from '../src/js/model.js';
import { BOTANIQUE } from '../src/js/templates/botanique.js';

const POSITIONS = [12.3456, 65.4321, 33.3333, 77.7777];

/** Un cours rempli de tout ce qui ne doit pas sortir. */
const course = () => ({
  format: 'inventaire-botanique',
  version: 3,
  id: 'proj-SECRET',
  revision: 'rev-SECRET',
  savedAt: '2026-01-01',
  title: 'Sortie au parc',
  theme: { preset: 'ocean', accent: '', icon: 'wave', extra: 'SECRET' },
  passwordHash: 'sha256:SECRET',
  aiEndpoint: 'https://SECRET.example.org',
  currentMapId: 'SECRET-map',
  progress: { m1: { verified: true, entries: { f1: { x: 1, y: 2, temperature: 'SECRET' } } } },
  maps: [
    {
      id: 'm1',
      name: 'Parc',
      image: '/media/plan.png',
      widthMeters: 987.654,
      extra: 'SECRET',
      fiches: [
        {
          id: 'f1',
          ref: '12b',
          common: 'Olivier',
          species: 'Olea europaea',
          family: 'Oleaceae',
          date: '2026-09-28',
          exposure: 'Soleil',
          watering: 'Peu',
          soil: 'Drainant',
          heat: 'Forte',
          care: 'Taille',
          description: 'Un arbre',
          notes: 'Près du banc',
          visible: true,
          refX: POSITIONS[0],
          refY: POSITIONS[1],
          thumbnailId: 'p1',
          secretField: 'SECRET',
          media: [{ id: 'p1', type: 'image', name: 'olivier.jpg', data: '/media/olivier.jpg', key: 'SECRET-key', extra: 'SECRET' }]
        },
        {
          id: 'SECRET-masquee',
          common: 'SECRET masquée',
          visible: false,
          refX: POSITIONS[2],
          refY: POSITIONS[3],
          media: [{ id: 'SECRET-m', data: '/media/SECRET.jpg' }]
        },
        { id: 'SECRET-ancienne', common: 'SECRET ancienne façon', studentEnabled: false, media: [] },
        { id: 'f3', common: 'Sans indication', media: [] }
      ]
    },
    { id: 'm2', name: 'Mer', image: '/media/mer.png', fiches: [] }
  ]
});

test('CRG-01 : aucune position réelle, aucune fiche masquée et aucun réglage dans ce que reçoit un élève', () => {
  const text = JSON.stringify(studentCourse(course()));
  assert.doesNotMatch(text, /SECRET/);
  assert.doesNotMatch(text, /refX|refY|passwordHash|aiEndpoint|progress|revision|widthMeters|savedAt|currentMapId/);
  for (const position of POSITIONS) assert.ok(!text.includes(String(position)), `position ${position}`);
  assert.ok(!text.includes('987.654'), 'la largeur réelle du terrain');
});

test('CRG-01 : le test échouerait bien si une position sortait', () => {
  // Copie de contrôle : les marques sont bien présentes dans le cours d'origine
  const text = JSON.stringify(course());
  assert.match(text, /SECRET/);
  for (const position of POSITIONS) assert.ok(text.includes(String(position)));
});

test('un élève garde tout ce qu’il faut pour lire les fiches et voir le plan', () => {
  const view = studentCourse(course());
  assert.equal(view.format, 'inventaire-botanique');
  assert.equal(view.version, 3);
  assert.equal(view.title, 'Sortie au parc');
  assert.deepEqual(view.theme, { preset: 'ocean', accent: '', icon: 'wave' });
  assert.deepEqual(
    view.maps.map((map) => [map.id, map.name, map.image]),
    [
      ['m1', 'Parc', '/media/plan.png'],
      ['m2', 'Mer', '/media/mer.png']
    ]
  );
  assert.deepEqual(view.maps[0].fiches[0], {
    id: 'f1',
    ref: '12b',
    common: 'Olivier',
    species: 'Olea europaea',
    family: 'Oleaceae',
    date: '2026-09-28',
    exposure: 'Soleil',
    watering: 'Peu',
    soil: 'Drainant',
    heat: 'Forte',
    care: 'Taille',
    description: 'Un arbre',
    notes: 'Près du banc',
    thumbnailId: 'p1',
    visible: true,
    media: [{ id: 'p1', type: 'image', name: 'olivier.jpg', data: '/media/olivier.jpg' }]
  });
});

test('comme dans l’application, une fiche sans indication est visible, et une ancienne fiche peut être masquée', () => {
  const ids = studentCourse(course()).maps[0].fiches.map((fiche) => fiche.id);
  assert.deepEqual(ids, ['f1', 'f3']);
  const source = normalizeProject(course())
    .maps[0].fiches.filter((fiche) => fiche.visible)
    .map((fiche) => fiche.id);
  assert.deepEqual(ids, source, 'même règle que normalizeFiche()');
});

test('le navigateur de l’élève relit ce cours sans erreur, sans position ni fiche masquée', () => {
  const project = normalizeProject(studentCourse(course()));
  assert.equal(project.maps.length, 2);
  assert.equal(project.maps[0].fiches[0].refX, null);
  assert.equal(project.maps[0].fiches[0].refY, null);
  assert.equal(project.maps[0].fiches[0].media[0].data, '/media/olivier.jpg');
  assert.equal(project.passwordHash, null);
});

test('un contenu réduit au minimum passe sans erreur', () => {
  const view = studentCourse({ format: 'inventaire-botanique', version: 3, title: 'T', maps: [{ id: 'm1' }, { id: 'm2', fiches: [{ id: 'f1' }] }] });
  assert.deepEqual(view.theme, {});
  assert.deepEqual(view.maps[0].fiches, []);
  assert.deepEqual(view.maps[1].fiches[0], { id: 'f1', visible: true, media: [] });
});

/** Un cours d'une autre matière : tout ce qui n'est pas un renseignement, et la note de l'enseignant tout entière, sont des SECRET. */
const quizCourse = () => ({
  ...course(),
  version: 4,
  template: {
    name: 'SECRET-nom-du-modèle',
    source: { courseId: 'SECRET-origine', title: 'SECRET-origine' },
    fields: [
      { id: 'c-nom', type: 'text', label: 'Monument', audience: 'info', role: 'title', aliases: ['SECRET-variante'], placeholder: 'SECRET-exemple' },
      { id: 'c-siecle', type: 'number', label: 'Siècle', audience: 'info', list: true },
      { id: 'h-q', type: 'heading', label: 'Questions', help: 'Répondez sur place.' },
      { id: 'c-age', type: 'text', label: 'Âge', audience: 'question', placeholder: 'en années', aliases: ['SECRET-variante'] },
      { id: 'c-architecte', type: 'text', label: 'Architecte', audience: 'correction' },
      { id: 'c-note', type: 'longtext', label: 'SECRET-libellé', help: 'SECRET-aide', audience: 'teacher' }
    ]
  },
  maps: [
    {
      id: 'm1',
      name: 'Centre',
      image: '/media/plan.png',
      fiches: [
        {
          id: 'f1',
          'c-nom': 'Beffroi',
          'c-siecle': '14',
          'c-age': 'SECRET-une-réponse-dans-la-fiche',
          'c-architecte': 'SECRET-révélé-à-la-fin',
          'c-note': 'SECRET-note',
          expected: { 'c-age': ['SECRET-bonne-réponse'] },
          common: 'SECRET-champ-botanique',
          visible: true,
          refX: POSITIONS[0],
          refY: POSITIONS[1],
          media: []
        }
      ]
    }
  ]
});

test('CRG-01, CHP-04, QST-01 : d’une fiche ne partent que les renseignements ; ni ce qui est révélé à la correction, ni la note de l’enseignant, ni une bonne réponse', () => {
  const view = studentCourse(quizCourse());
  assert.doesNotMatch(JSON.stringify(view), /SECRET/);
  for (const position of POSITIONS.slice(0, 2)) assert.ok(!JSON.stringify(view).includes(String(position)));
  assert.deepEqual(view.maps[0].fiches[0], { id: 'f1', 'c-nom': 'Beffroi', 'c-siecle': '14', visible: true, media: [] });
  assert.match(JSON.stringify(quizCourse()), /SECRET-note/, 'contrôle : les marques sont bien dans le cours');
});

test('CHP-04 : le modèle part sans la note de l’enseignant, sans variantes de tableur, avec l’exemple des seules questions', () => {
  const { template } = studentCourse(quizCourse());
  assert.deepEqual(
    template.fields.map((field) => field.id),
    ['c-nom', 'c-siecle', 'h-q', 'c-age', 'c-architecte'],
    'ce qui est révélé à la correction garde sa place, sans sa valeur'
  );
  assert.deepEqual(template.fields[3], { id: 'c-age', type: 'text', label: 'Âge', audience: 'question', placeholder: 'en années' });
  assert.deepEqual(template.fields[2], { id: 'h-q', type: 'heading', label: 'Questions', help: 'Répondez sur place.' });
  const project = normalizeProject(studentCourse(quizCourse()));
  assert.equal(project.template.fields.length, 5, 'un modèle que le navigateur de l’élève accepte');
  assert.equal(project.maps[0].fiches[0]['c-nom'], 'Beffroi');
});

test('MOD-02, CHP-04 : un cours sans modèle part avec le modèle botanique, sans ce qui ne sert qu’à l’enseignant', () => {
  const { template } = studentCourse(course());
  assert.deepEqual(
    template.fields.map((field) => field.id),
    BOTANIQUE.fields.map((field) => field.id)
  );
  assert.doesNotMatch(JSON.stringify(template), /aliases|Olivier|Oleaceae/, 'ni variantes, ni exemples de l’enseignant');
  assert.deepEqual(
    template.fields.find((field) => field.id === 'temperature'),
    {
      id: 'temperature',
      type: 'number',
      label: 'Température',
      icon: '🌡',
      audience: 'question',
      list: true,
      unit: '°C',
      keyboard: 'decimal'
    }
  );
});
