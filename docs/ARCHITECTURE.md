# Architecture

## Principes

1. **Une page, sans framework.** Les vues produisent du HTML à partir de l'état, puis branchent
   leurs écouteurs. Après chaque modification, `render()` redessine l'en-tête, le plan et le
   panneau. L'application est petite : ce rafraîchissement complet reste instantané et évite
   toute une classe de bugs de synchronisation.
2. **Le projet et le travail des élèves sont séparés.**
   - Le **projet** (cartes, fiches, positions réelles, thème) est préparé par l'enseignant et
     peut être remplacé par une nouvelle version (fichier ou publication).
   - La **progression** (placements, mesures, exercice vérifié) appartient à l'élève, reste
     dans son navigateur et survit aux mises à jour du projet.
3. **Tout fonctionne hors ligne.** La version construite tient dans un seul fichier HTML ; le
   serveur n'est qu'une option pour diffuser le projet par une adresse.

## Flux de données

```
                             ┌────────────── démarrage (project-io.js) ──────────────┐
project.json ──▶│ serveur › projet intégré au .html › navigateur                                                  │──▶ S (store.js)
        (ou .html)     │ › anciennes données (2026) › nouveau projet vide                                         │      │
                 └───────────────────────────────────────────────────────┘      │
                                                                                ▼
   vues (views/*) ── lisent S, modifient les objets ── changedMap() / changedMeta() / changedProgress()
                                                                                │  (regroupé, 250 ms)
                                                                                ▼
                                                                  IndexedDB (db.js)
```

`S` (store.js) contient : `project`, `map` (carte affichée), `progress` (par carte),
`local` (modifications en attente, révision d'origine), `admin`, `ui`, `source`.

## Stockage dans le navigateur

Base IndexedDB `inventaire-botanique` :

| Magasin    | Clé                     | Contenu                                                 |
| ---------- | ----------------------- | ------------------------------------------------------- |
| `meta`     | `'project'`             | métadonnées du projet + ordre des cartes + suivi local  |
| `maps`     | `map.id`                | une carte et ses fiches                                  |
| `files`    | `media.key`             | photos et vidéos (Blob)                                  |
| `progress` | `projectId/mapId`       | progression des élèves pour une carte                    |

Préférences légères dans `localStorage` (préfixe `ib.`) : noms des élèves, refus d'ouverture.

Au premier lancement, si la base est vide, `db.readLegacyProject()` relit les données laissées
par les versions de 2026 (bases `botMapMapsV37` et `BotanicalMapDB`, clés `botMap…`) : rien
n'est perdu en passant à cette version. Les anciennes bases ne sont pas supprimées.

## Format d'un projet (version 3)

C'est le contenu de `project.json`, et du bloc `<script id="embedded-project">` des fichiers
autonomes.

```jsonc
{
  "format": "inventaire-botanique",
  "version": 3,
  "id": "proj-…",            // stable : relie un projet à la progression des élèves
  "revision": "…",           // change à chaque enregistrement / publication
  "savedAt": "2026-10-12T15:04:59.952Z",
  "title": "Inventaire botanique Parc ouest nice",
  "theme": { "preset": "vegetal", "accent": "", "icon": "leaf" },
  "passwordHash": "sha256:…",  // null = mot de passe « admin »
  "aiEndpoint": "",
  "currentMapId": "map-…",
  "maps": [
    {
      "id": "map-…",
      "name": "Plan du parc",
      "image": "data:image/jpeg;base64,…",
      "widthMeters": 180,       // facultatif : écarts en mètres
      "fiches": [
        {
          "id": "loc-…",
          "ref": "12b",           // réf. photo / étiquette terrain (libre)
          "common": "Sauge de Graham",
          "species": "Salvia microphylla",
          "family": "Lamiaceae",
          "date": "2026-09-28",
          "exposure": "☀️☀️☀️ Plein soleil", "watering": "💧💧 Modéré…",
          "soil": "…", "heat": "…", "care": "…",
          "description": "…", "notes": "…",
          "visible": true,        // montrée aux élèves
          "refX": 8.204, "refY": 39.858,   // position réelle, en % de l'image
          "thumbnailId": "…",
          "media": [{ "id": "…", "type": "image", "name": "photo.jpg", "data": "data:image/jpeg;base64,…" }]
        }
      ]
    }
  ],
  "progress": {               // facultatif (enregistrement complet de l'enseignant)
    "map-…": { "verified": false, "entries": { "loc-…": { "x": 10.2, "y": 41, "temperature": "21", "humidity": "", "light": "" } } }
  }
}
```

- Les **numéros** vus par les élèves ne sont pas stockés : 1, 2, 3… dans l'ordre de la liste,
  en ne comptant que les fiches visibles (`model.numberOf`).
- Les positions sont en **% de l'image** (0–100) : indépendantes de l'écran.
- L'**évaluation** (`model.evaluate`) mesure l'écart en % de la largeur du plan (en corrigeant le
  rapport largeur/hauteur), converti en mètres si `widthMeters` est connu. Seuils : 4 % « bien
  placée », 10 % « proche » (`THRESHOLDS`).
- `normalizeProject()` accepte aussi le format 2 (`locations`, `code`, `studentEnabled`, placements
  dans les fiches) et le convertit.

## Choix du projet au démarrage

1. **Serveur** : `config.json` (facultatif) puis `project.json` (ou `projets/<nom>.json` avec
   `?projet=nom`). Seulement en `http(s)://`.
2. **Projet intégré** à la page (fichier autonome enregistré depuis l'application).
3. **Navigateur** (IndexedDB).
4. **Anciennes données** (2026), puis **nouveau projet** avec le plan d'exemple.

Quand un projet arrive (1 ou 2) et qu'un projet de **même identifiant** est déjà dans le navigateur :
- version entrante plus récente et pas de modification locale → installée, progression conservée ;
- sinon → la version du navigateur est gardée (cas de l'enseignant qui n'a pas encore publié ;
  un bandeau lui propose de publier ou de reprendre la version en ligne).

Projet **différent** : installé directement, sauf si le navigateur contient des modifications
non enregistrées (confirmation).

## Publication

`project-io.publish()` envoie le projet complet (sans progression) en `PUT` avec
`Authorization: Bearer <mot de passe>` vers `publishUrl` (fourni par `config.json`, donc par le
serveur quand `PUBLISH_PASSWORD` est défini). Le serveur vérifie le mot de passe, le format,
sauvegarde l'ancienne version puis écrit le fichier de façon atomique.

## Version autonome

`scripts/build.mjs` regroupe le JavaScript (esbuild, format IIFE), intègre le CSS et le plan
d'exemple dans `index.html`. Au démarrage, `captureTemplate()` mémorise cette page : c'est elle
que l'on recopie, avec le projet dans `<script id="embedded-project">`, pour **Enregistrer le
projet (.html)** et la **version élèves**. En développement (`src/`, modules séparés), seul
l'export `.json` est proposé.

## Thèmes

`themes.js` remplit les variables CSS `--accent`, `--paper`, `--ink`… Une couleur personnalisée
génère toute la palette à partir de sa teinte (accent assombri si nécessaire pour garder un texte
blanc lisible). Les couleurs des repères (rouge élève, bleu position réelle) et des évaluations
sont fixes, pour garder le même sens d'un thème à l'autre.

## Ajouter un champ à une fiche

1. `model.normalizeFiche()` : ajouter la propriété (avec valeur par défaut) ;
2. `index.html` : le champ dans le formulaire d'édition, et `views/editor.js` : `FIELDS` ;
3. `views/reader.js` : l'affichage côté élèves (ou l'ajouter à `NEEDS` dans `model.js` pour
   qu'il apparaisse avec les besoins) ;
4. `spreadsheet.js` : une entrée dans `COLUMNS` pour l'import / export.

## Tests

`npm test` lance `node:test` sur le modèle (migration v2, numérotation, évaluation), le tableur
(CSV, correspondance des colonnes, import avec réf. en double), le mot de passe (SHA-256 de
secours) et le serveur (chemins, publication, sauvegardes).
