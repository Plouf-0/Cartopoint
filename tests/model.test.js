import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  meanGap,
  draftOf,
  normalizeProject,
  normalizeProgress,
  numberOf,
  evaluate,
  gradeOf,
  sortByRef,
  projectFromText,
  newProject,
  defaultTemplate,
  titleOf,
  missingRequired,
  matches,
  FORMAT,
  VERSION
} from '../src/js/model.js';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { ICONS, PRESETS, iconSVG, paletteOf } from '../src/js/themes.js';
import { BOTANIQUE } from '../src/js/templates/botanique.js';
import { COURS_FORMAT_3 } from './fixtures/cours-format-3.js';

/** Projet au format 2 (fichiers « Inventaire botanique N.html » de 2026). */
const legacy = {
  format: 'inventaire-botanique',
  version: 2,
  bundleId: 'rev-1',
  createdAt: '2026-10-08T10:00:00Z',
  title: 'Parc',
  maps: [
    {
      id: 'map-1',
      name: 'Plan',
      image: 'data:image/jpeg;base64,AAAA',
      exerciseVerified: true,
      locations: [
        {
          id: 'a',
          code: '2',
          common: 'Sauge',
          studentEnabled: true,
          placed: true,
          x: 10,
          y: 20,
          temperature: '21',
          media: [{ id: 'm', type: 'image', dataUrl: 'data:x' }]
        },
        { id: 'b', code: '10b', common: 'Chalef', studentEnabled: false, placed: false, x: null, y: null },
        { id: 'c', code: '5a', common: 'Cornouiller', refX: 50, refY: 50 }
      ]
    }
  ]
};

test('COM-02 : un projet v2 est converti au format actuel', () => {
  const p = normalizeProject(structuredClone(legacy));
  assert.equal(p.version, VERSION);
  assert.equal(p.id, 'proj-map-1', "l'identifiant est stable, déduit de la première carte");
  assert.equal(p.revision, 'rev-1');
  const [a, b] = p.maps[0].fiches;
  assert.equal(a.ref, '2');
  assert.equal(b.visible, false);
  assert.equal(a.media[0].data, 'data:x');
  assert.ok(!('x' in a), 'le placement élève ne reste pas dans la fiche');
});

test('COM-02 : la progression des élèves v2 est extraite à part', () => {
  const p = normalizeProject(structuredClone(legacy));
  const prog = p.progress['map-1'];
  assert.equal(prog.verified, true);
  assert.deepEqual(prog.entries.a, { x: 10, y: 20, temperature: '21', humidity: '', light: '' });
  assert.equal(prog.entries.b, undefined);
});

test('FIC-04 : les numéros ne comptent que les fiches visibles', () => {
  const map = normalizeProject(structuredClone(legacy)).maps[0];
  assert.deepEqual(
    map.fiches.map((f) => numberOf(map, f)),
    ['1', '–', '2']
  );
});

test('CAR-05 : évaluation : bien placée, proche, à revoir, en mètres si échelle', () => {
  const f = { refX: 50, refY: 50 };
  assert.equal(evaluate(f, { x: 52, y: 50 }).state, 'ok');
  assert.equal(evaluate(f, { x: 57, y: 50 }).state, 'near');
  assert.equal(evaluate(f, { x: 70, y: 50 }).state, 'far');
  assert.equal(evaluate(f, null).state, 'unplaced');
  assert.equal(evaluate({ refX: null, refY: null }, { x: 1, y: 1 }).state, 'noref');
  assert.equal(evaluate(f, { x: 60, y: 50 }, { widthMeters: 200 }).dist, '20 m');
});

test('FIC-05 : rangement naturel par réf. photo', () => {
  const sorted = sortByRef([{ ref: '10a' }, { ref: '' }, { ref: '2' }, { ref: '5b' }, { ref: '5a' }]);
  assert.deepEqual(
    sorted.map((f) => f.ref),
    ['2', '5a', '5b', '10a', '']
  );
});

test('COM-03 : lecture d’un projet intégré dans une page html (actuelle et ancienne)', () => {
  const json = JSON.stringify({ format: 'inventaire-botanique', maps: [] });
  assert.equal(projectFromText(`<script id="embedded-project" type="application/json">${json}</script>`).format, 'inventaire-botanique');
  assert.equal(projectFromText(`<script id="embeddedBundle" type="application/json">${json}</script>`).format, 'inventaire-botanique');
  assert.throws(() => projectFromText('<html></html>'));
});

test('un fichier qui n’est pas un projet est refusé', () => {
  assert.throws(() => normalizeProject({ hello: 1 }));
});

test('nouveau projet : une carte, aucune fiche', () => {
  const p = newProject('Test', 'data:img');
  assert.equal(p.maps.length, 1);
  assert.equal(p.maps[0].fiches.length, 0);
  assert.equal(p.maps[0].image, 'data:img');
});

test('COU-02 : le contenu d’un cours ne garde ni progression, ni carte affichée, ni mot de passe de gestion', () => {
  const project = normalizeProject({
    format: 'inventaire-botanique',
    version: 3,
    id: 'p',
    revision: 'r',
    title: 'Cours',
    passwordHash: 'empreinte',
    currentMapId: 'm2',
    maps: [
      { id: 'm1', name: 'A', fiches: [] },
      { id: 'm2', name: 'B', fiches: [] }
    ],
    progress: { m1: { verified: true, entries: {} } }
  });
  const draft = draftOf(project);
  assert.deepEqual(
    Object.keys(draft).sort(),
    ['format', 'grading', 'maps', 'template', 'theme', 'title', 'version'],
    'MOD-01 : le modèle et la notation partent avec le cours'
  );
  assert.equal(draft.maps.length, 2);
  assert.doesNotThrow(() => normalizeProject(draft), 'il se relit');
});

test('EV-34 : un nouveau projet s’appelle Cartopoint, avec une carte « Plan », le vert et un repère', () => {
  const project = newProject();
  assert.equal(project.title, 'Cartopoint');
  assert.equal(project.maps[0].name, 'Plan');
  assert.deepEqual(project.theme, { preset: 'vegetal', accent: '', icon: 'pin' });
  assert.equal(paletteOf(project.theme).accent, '#2e6e45');
  assert.equal(PRESETS.vegetal.label, 'Vert');
  assert.equal(iconSVG('inconnue'), iconSVG('pin'), 'une icône inconnue devient un repère');
});

test('EV-34 : les fichiers existants gardent leur nom, leur thème et leur icône', () => {
  assert.equal(FORMAT, 'inventaire-botanique', 'les fichiers déjà enregistrés portent cet identifiant');
  const project = normalizeProject({
    format: FORMAT,
    version: VERSION,
    title: 'Sortie',
    theme: { preset: 'vegetal', icon: 'leaf' },
    maps: [{ name: 'Plan du parc' }]
  });
  assert.equal(project.title, 'Sortie');
  assert.equal(project.maps[0].name, 'Plan du parc');
  assert.equal(project.theme.icon, 'leaf');
  assert.ok(ICONS.leaf, 'l’icône reste au choix');
});

test('CRG-13 : l’heure d’une réponse survit à la relecture, et seul un vrai nombre compte', () => {
  const { entries } = normalizeProgress({ entries: { a: { x: 1, y: 2, at: 1000 }, b: { x: 1, y: 2, at: 'hier' }, c: { x: 1, y: 2 } } }, defaultTemplate());
  assert.equal(entries.a.at, 1000);
  assert.equal(entries.b.at, undefined);
  assert.equal('at' in entries.c, false);
});

test('CRG-09 : un résultat se présente pareil, calculé ici ou reçu du serveur', () => {
  const fiche = { refX: 50, refY: 50 };
  for (const [entry, state] of [
    [{ x: 50, y: 50 }, 'ok'],
    [{ x: 57, y: 50 }, 'near'],
    [{ x: 90, y: 50 }, 'far'],
    [{ x: null, y: null }, 'unplaced']
  ]) {
    const result = evaluate(fiche, entry);
    assert.equal(result.state, state);
    assert.equal(result.label, gradeOf(state).label);
    assert.equal(result.cls, gradeOf(state).cls);
  }
  assert.equal(evaluate({ refX: null, refY: null }, { x: 1, y: 1 }).label, gradeOf('noref').label);
});

test('HIS-03 : la précision moyenne passe en mètres selon l’échelle de la carte, sans compter les fiches non placées', () => {
  const results = { maps: { m1: { fiches: { a: { d: 10 }, b: { d: 5 }, c: { state: 'unplaced' } } } } };
  assert.equal(meanGap({ maps: [{ id: 'm1', widthMeters: 200 }] }, results), 15, 'écarts de 20 et de 10 mètres');
  assert.equal(meanGap({ maps: [{ id: 'm1', widthMeters: null }] }, results), 7.5, 'sans échelle, en % du plan');
  assert.equal(meanGap({ maps: [{ id: 'm1', widthMeters: 200 }] }, { maps: {} }), null, 'rien de placé, pas de précision');
});

/** Ce que la version 1.3.7 lisait de COURS_FORMAT_3 : le projet, puis pour chaque fiche son titre, son numéro, sa recherche et son évaluation. */
const LU_EN_137 = JSON.parse(readFileSync(new URL('./fixtures/cours-format-3.lu-en-1.3.7.json', import.meta.url), 'utf8'));
const QUERIES = ['', 'tama', 'OLEA', 'oleaceae', '12B', 'chêne', 'emplacement', 'sableux'];
const plain = (value) => JSON.parse(JSON.stringify(value));
/** Ce que la version 2.0.0 ajoute : le modèle de fiche (MOD-01) et la notation (QST-05). */
const withoutVersion = ({ version, template, grading, ...rest }) => rest;

test('MOD-02 : un cours de format 3 se lit avec le modèle botanique, exactement comme en 1.3.7', () => {
  const project = normalizeProject(structuredClone(COURS_FORMAT_3));
  assert.equal(project.version, 4);
  assert.deepEqual(project.template, defaultTemplate());
  assert.deepEqual(plain(withoutVersion(project)), withoutVersion(LU_EN_137.project), 'fiches, valeurs, positions, progression et mesures');
  const views = project.maps.map((map) =>
    map.fiches.map((fiche) => ({
      id: fiche.id,
      title: titleOf(fiche, project.template),
      number: numberOf(map, fiche),
      found: QUERIES.filter((query) => matches(fiche, query, project.template)),
      ev: evaluate(fiche, project.progress[map.id]?.entries[fiche.id], { ratio: map.ratio || 1, widthMeters: map.widthMeters })
    }))
  );
  assert.deepEqual(plain(views), LU_EN_137.views, 'titres, numéros, recherche et évaluations');
  assert.deepEqual(plain(withoutVersion(draftOf(project))), withoutVersion(LU_EN_137.draft), 'le contenu enregistré ne diffère que par son modèle');
  assert.deepEqual(draftOf(project).template, defaultTemplate());
});

test('MOD-02 : un projet de format 2 reçoit lui aussi le modèle botanique', () => {
  assert.deepEqual(normalizeProject(structuredClone(legacy)).template, defaultTemplate());
});

test('MOD-02 : le modèle botanique intégré ne change jamais : tout ce qui a été publié sans modèle se relit avec lui', () => {
  const frozen = 'e109aaaaabbe44cb8a073d4a1f063763af857c371854509e2ae6eceadb44a2db';
  assert.equal(
    createHash('sha256').update(JSON.stringify(BOTANIQUE)).digest('hex'),
    frozen,
    'Ne pas modifier src/js/templates/botanique.js : les versions publiées et les rendus d’avant la 2.0.0 se lisent avec lui.'
  );
  assert.ok(Object.isFrozen(BOTANIQUE) && Object.isFrozen(BOTANIQUE.fields[0]) && Object.isFrozen(BOTANIQUE.fields[0].aliases));
  const copy = defaultTemplate();
  copy.fields[0].label = 'Nom';
  assert.equal(BOTANIQUE.fields[0].label, 'Nom commun', 'chaque cours reçoit une copie, qu’il peut modifier');
  assert.equal(normalizeProject(structuredClone(COURS_FORMAT_3)).template.fields[0].label, 'Nom commun');
});

/** Un cours de format 4 dont le modèle n'a rien de botanique. */
const PATRIMOINE = {
  name: 'Patrimoine',
  fields: [
    { id: 'c-nom', type: 'text', label: 'Monument', audience: 'info', role: 'title', search: true },
    {
      id: 'c-style',
      type: 'choice',
      label: 'Style',
      audience: 'info',
      search: undefined,
      choices: [
        { id: 'roman', label: 'Roman' },
        { id: 'gothique', label: 'Gothique' }
      ]
    },
    { id: 'c-age', type: 'text', label: 'Construit en', audience: 'correction' },
    { id: 'c-cle', type: 'text', label: 'Clé', audience: 'teacher' },
    { id: 'c-siecle', type: 'number', label: 'Siècle ?', audience: 'question' },
    { id: 'c-ouvert', type: 'yesno', label: 'Ouvert ?', audience: 'question' }
  ]
};
delete PATRIMOINE.fields[1].search;

test('MOD-01 : un cours garde son modèle, et chaque fiche la valeur de chacun des champs que remplit l’enseignant', () => {
  const project = normalizeProject({
    format: FORMAT,
    version: 4,
    title: 'Vieille ville',
    template: PATRIMOINE,
    maps: [
      {
        id: 'm1',
        fiches: [
          {
            id: 'a',
            ref: '1',
            'c-nom': 'Église',
            'c-style': 'gothique',
            'c-age': '1250',
            'c-cle': 'mairie',
            common: 'Reste du format 3',
            'c-siecle': '13',
            visible: true
          },
          { id: 'b', 'c-style': 'baroque' }
        ]
      }
    ],
    progress: { m1: { entries: { a: { x: 10, y: 20, 'c-siecle': 13, 'c-ouvert': 'oui', temperature: '21' } } } }
  });
  assert.deepEqual(project.template, PATRIMOINE);
  const [a, b] = project.maps[0].fiches;
  assert.equal(a['c-nom'], 'Église');
  assert.equal(a['c-style'], 'gothique');
  assert.equal(a['c-age'], '1250', 'révélé à la correction : rangé dans la fiche, comme le reste');
  assert.equal(a['c-cle'], 'mairie');
  assert.equal('common' in a, false, 'un champ que le modèle ne connaît pas disparaît');
  assert.equal('c-siecle' in a, false, 'une question n’a pas de valeur dans la fiche : c’est l’élève qui répond');
  assert.equal(b['c-style'], '', 'un choix qui n’est pas proposé ne compte pas');
  assert.deepEqual(
    project.progress.m1.entries.a,
    { x: 10, y: 20, 'c-siecle': '13', 'c-ouvert': 'oui' },
    'les réponses aux questions du modèle, et elles seules'
  );
  assert.equal(titleOf(a, project.template), 'Église');
  assert.equal(titleOf(b, project.template), 'Fiche sans nom');
  assert.ok(matches(a, 'égl', project.template));
  assert.ok(!matches(a, 'mairie', project.template), 'une note de l’enseignant ne sert pas à la recherche');
  assert.deepEqual(normalizeProject(draftOf(project)).template, PATRIMOINE, 'le modèle part avec le contenu du cours et se relit');
});

test('MOD-01 : un modèle invalide rend le fichier illisible, avec la raison', () => {
  const broken = { format: FORMAT, version: 4, template: { fields: [{ id: 'visible', type: 'text', label: 'Piège', audience: 'info' }] }, maps: [] };
  assert.throws(() => normalizeProject(broken), /modèle de fiche invalide : champ 1 : identifiant invalide/);
});

test('QST-06 : on compte les réponses obligatoires qui manquent, sur les fiches visibles seulement', () => {
  const template = {
    fields: [
      { id: 'a', type: 'text', label: 'A', audience: 'question', required: true },
      {
        id: 'b',
        type: 'choice',
        label: 'B',
        audience: 'question',
        required: true,
        multiple: true,
        choices: [
          { id: 'x', label: 'X' },
          { id: 'y', label: 'Y' }
        ]
      },
      { id: 'c', type: 'text', label: 'C', audience: 'question' }
    ]
  };
  const project = {
    template,
    maps: [
      {
        id: 'm1',
        fiches: [
          { id: 'f1', visible: true },
          { id: 'f2', visible: true },
          { id: 'cachee', visible: false }
        ]
      }
    ]
  };
  assert.equal(missingRequired(project, {}), 4);
  assert.equal(missingRequired(project, { m1: { entries: { f1: { a: 'oui', b: [] }, f2: { a: '', b: ['x'], c: '' } } } }), 2, 'un choix vide manque aussi');
  assert.equal(missingRequired(project, { m1: { entries: { f1: { a: 'oui', b: ['y'] }, f2: { a: 'non', b: ['x'] } } } }), 0);
  assert.equal(missingRequired(normalizeProject(structuredClone(COURS_FORMAT_3)), {}), 0, 'les mesures ne sont pas obligatoires');
});
