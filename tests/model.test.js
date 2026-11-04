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
  FORMAT,
  VERSION
} from '../src/js/model.js';
import { ICONS, PRESETS, iconSVG, paletteOf } from '../src/js/themes.js';

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

test('un projet v2 est converti au format actuel', () => {
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

test('la progression des élèves v2 est extraite à part', () => {
  const p = normalizeProject(structuredClone(legacy));
  const prog = p.progress['map-1'];
  assert.equal(prog.verified, true);
  assert.deepEqual(prog.entries.a, { x: 10, y: 20, temperature: '21', humidity: '', light: '' });
  assert.equal(prog.entries.b, undefined);
});

test('les numéros ne comptent que les fiches visibles', () => {
  const map = normalizeProject(structuredClone(legacy)).maps[0];
  assert.deepEqual(
    map.fiches.map((f) => numberOf(map, f)),
    ['1', '–', '2']
  );
});

test('évaluation : bien placée, proche, à revoir, en mètres si échelle', () => {
  const f = { refX: 50, refY: 50 };
  assert.equal(evaluate(f, { x: 52, y: 50 }).state, 'ok');
  assert.equal(evaluate(f, { x: 57, y: 50 }).state, 'near');
  assert.equal(evaluate(f, { x: 70, y: 50 }).state, 'far');
  assert.equal(evaluate(f, null).state, 'unplaced');
  assert.equal(evaluate({ refX: null, refY: null }, { x: 1, y: 1 }).state, 'noref');
  assert.equal(evaluate(f, { x: 60, y: 50 }, { widthMeters: 200 }).dist, '20 m');
});

test('rangement naturel par réf. photo', () => {
  const sorted = sortByRef([{ ref: '10a' }, { ref: '' }, { ref: '2' }, { ref: '5b' }, { ref: '5a' }]);
  assert.deepEqual(
    sorted.map((f) => f.ref),
    ['2', '5a', '5b', '10a', '']
  );
});

test('lecture d’un projet intégré dans une page html (actuelle et ancienne)', () => {
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
  assert.deepEqual(Object.keys(draft).sort(), ['format', 'maps', 'theme', 'title', 'version']);
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
  const { entries } = normalizeProgress({ entries: { a: { x: 1, y: 2, at: 1000 }, b: { x: 1, y: 2, at: 'hier' }, c: { x: 1, y: 2 } } });
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
