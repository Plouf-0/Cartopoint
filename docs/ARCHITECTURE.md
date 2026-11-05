# Architecture

## Principes

1. **Une page, sans framework.** Les vues produisent du HTML à partir de l'état, puis branchent
   leurs écouteurs. Après chaque modification, `render()` redessine l'en-tête, le plan et le
   panneau. L'application est petite : ce rafraîchissement complet reste instantané et évite
   toute une classe de bugs de synchronisation.
2. **Le projet et le travail des élèves sont séparés.**
   - Le **projet** (cartes, fiches, positions réelles, thème) est préparé par l'enseignant et
     peut être remplacé par une nouvelle version.
   - La **progression** (placements, mesures, exercice vérifié) appartient à l'élève, reste
     dans son navigateur et survit aux mises à jour du projet.
3. **Le terrain se passe de réseau.** La page élève fonctionne sans connexion une fois récupérée (voir « Hors ligne »), et le fichier
   de secours tient dans un seul fichier HTML, polices comprises.

## Flux de données

```
 backend (backends/*, prof/course-backend.js) ──▶ S (store.js)
                                                     │
                                                     ▼
 vues (views/*) ── lisent S, modifient les objets ── changedMap() / changedMeta() / changedProgress()
                                                     │  (regroupé, 250 ms)
                                                     ▼
      local : IndexedDB (db.js) · cours : serveur · élève : son navigateur, puis le serveur
```

`S` (store.js) contient : `project`, `map` (carte affichée), `progress` (par carte),
`local` (modifications en attente, révision d'origine), `admin`, `ui`.

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

C'est le contenu d'un cours exporté en `.json`, et du bloc `<script id="embedded-project">` d'un fichier de secours.

```jsonc
{
  "format": "inventaire-botanique",
  "version": 3,
  "id": "proj-…",            // stable : relie un projet à la progression des élèves
  "revision": "…",           // change à chaque enregistrement
  "savedAt": "2026-10-12T15:04:59.952Z",
  "title": "Sortie au parc",
  "theme": { "preset": "vegetal", "accent": "", "icon": "leaf" },
  "passwordHash": "sha256:…",  // null = mot de passe « admin »
  "aiEndpoint": "",
  "currentMapId": "map-…",
  "maps": [
    {
      "id": "map-…",
      "name": "Plan",
      "image": "data:image/jpeg;base64,…",
      "widthMeters": 180,       // facultatif : écarts en mètres
      "fiches": [
        {
          "id": "loc-…",
          "ref": "12b",           // réf. photo / étiquette terrain (libre)
          "common": "Tamaris",
          "species": "Tamarix gallica",
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

## Fichier de secours : le choix du projet au démarrage

L'application d'origine, avec son backend `local`, est devenue la page du fichier de secours (`src/secours.html`, `js/main.js`). Elle ne connaît aucun serveur.

1. **Projet intégré** au fichier.
2. **Navigateur** (IndexedDB).
3. **Anciennes données** (2026), puis **nouveau projet** avec le plan d'exemple.

Quand le projet intégré arrive et qu'un projet de **même identifiant** est déjà dans le navigateur :

- version intégrée plus récente et pas de modification locale → installée, progression conservée ;
- sinon → la version du navigateur est gardée.

Projet **différent** : installé directement, sauf si le navigateur contient des modifications non enregistrées (confirmation).

`scripts/build.mjs` regroupe le JavaScript (esbuild, format IIFE), intègre le CSS, les polices et le plan d'exemple dans `secours.html`. Au démarrage, `captureTemplate()`
mémorise cette page : c'est elle que l'on recopie, avec le projet dans `<script id="embedded-project">`, pour **Enregistrer le projet (.html)** et la **version élèves**. En
développement (`src/`, modules séparés), seul l'export `.json` est proposé.

## Thèmes

`themes.js` remplit les variables CSS `--accent`, `--paper`, `--ink`… Une couleur personnalisée
génère toute la palette à partir de sa teinte (accent assombri si nécessaire pour garder un texte
blanc lisible). Les couleurs des repères (rouge élève, bleu position réelle) et des évaluations
sont fixes, pour garder le même sens d'un thème à l'autre.

## Ajouter un champ à une fiche

1. `model.normalizeFiche()` : ajouter la propriété (avec valeur par défaut) ;
2. `prof-cours.html` et `secours.html` : le champ dans le formulaire d'édition, et `views/editor.js` : `FIELDS` ;
3. `views/reader.js` : l'affichage côté élèves (ou l'ajouter à `NEEDS` dans `model.js` pour
   qu'il apparaisse avec les besoins) ;
4. `spreadsheet.js` : une entrée dans `COLUMNS` pour l'import / export.

## Serveur

| Fichier             | Rôle                                                                     |
| ------------------- | ------------------------------------------------------------------------ |
| `index.mjs`         | Démarrage : options, variables d'environnement, sauvegarde, arrêt propre |
| `app.mjs`           | Assemble la base, les routes et les fichiers statiques, sans rien lancer |
| `http.mjs`          | Routage, corps des requêtes, JSON, fichiers (ETag, 304, gzip), erreurs   |
| `db.mjs`            | SQLite, migrations, copies de la base. Seul à importer `node:sqlite`     |
| `security.mjs`      | IP du client (`TRUST_PROXY`), limites d'essais                           |
| `auth.mjs`          | Mots de passe, sessions, liens à usage unique, rôles                     |
| `admin-reset.mjs`   | Lien de réinitialisation pour l'admin, à lancer sur le serveur           |
| `routes/auth.mjs`   | Connexion, déconnexion, mot de passe, utilisation d'un lien (`/api/auth`) |
| `routes/admin.mjs`  | Tableau de bord de l'admin (`/api/admin`)                                |
| `routes/pages.mjs`  | Pages du site, dont l'accueil à la racine, `robots.txt`                  |

**Base de données.** `DATA_DIR/app.db`, SQLite, avec les clés étrangères actives, le mode WAL et
`synchronous = NORMAL`. `node:sqlite` est synchrone : une écriture bloque tout le serveur le temps
qu'elle dure, soit 50 ms avec le réglage par défaut et 0,13 ms ainsi (mesuré sur le serveur). La base ne
peut pas se corrompre, mais une coupure de courant peut perdre les toutes dernières écritures.

**Migrations.** Pour changer le schéma, ajouter `server/migrations/NNN-nom.sql` avec le numéro
suivant, sans trou. `PRAGMA user_version` garde la version de la base. Chaque fichier s'applique dans
une transaction, en entier ou pas du tout, et le serveur refuse une base plus récente que son code.
Ne jamais modifier une migration déjà livrée.

**Sauvegardes.** Au démarrage puis chaque heure, le serveur vérifie si la copie du jour existe :
`backups/app-AAAA-MM-JJ.db`, 14 conservées. Les fichiers de `media/` n'y sont pas : sauvegarder tout `data/` ailleurs.

**Mise en cache.** Tout fichier et toute réponse JSON portent un ETag, et le serveur répond 304 si le
client a déjà cette version. L'ETag d'un fichier vient de sa taille et de sa date, celui d'un JSON de
son contenu. Il est « faible » (`W/`), car il reste le même avec et sans compression. Le gzip vaut
pour le texte à partir de 1 Ko, jamais pour les images, déjà compressées.

**IP du client.** Derrière un proxy, seule la **dernière** valeur de `X-Forwarded-For` est sûre : c'est
celle que le proxy a ajoutée, les précédentes viennent du client. Elle n'est lue qu'avec `TRUST_PROXY=1`.

Cette dernière valeur est l'adresse qui s'est connectée au proxy. Derrière Cloudflare, c'est donc l'un de ses serveurs, partagé par
des inconnus, et le visiteur est dans `CF-Connecting-IP`. N'importe qui pourrait écrire cet en-tête en s'adressant au serveur sans passer par Cloudflare. `clientIp()` ne le croit donc que si la dernière valeur tombe dans les plages publiées par Cloudflare (`server/security.mjs`). Si cette liste vieillit, rien
ne s'ouvre : les visiteurs d'un nouveau serveur partagent seulement un compteur. En IPv6, la clé est le bloc `/64`, dont dispose tout abonné.

## Comptes

| Page                               | Fichier       | Contenu                                     |
| ---------------------------------- | ------------- | ------------------------------------------- |
| `/prof`                            | `prof.html`   | Connexion, puis espace de l'enseignant      |
| `/admin`                           | `admin.html`  | Connexion, puis tableau de bord de l'admin  |
| `/invitation`, `/reinitialisation` | `compte.html` | Créer son compte, choisir un mot de passe   |

**Mots de passe.** `crypto.scrypt`, avec un sel aléatoire. L'empreinte garde ses réglages (`scrypt$N$r$p$sel$clé`) : on
peut les durcir sans invalider les anciennes.

**Sessions.** Un jeton aléatoire dans un cookie `HttpOnly`, `SameSite=Lax`, `Path=/api`, et `Secure` si le proxy de
confiance annonce HTTPS. La base n'en garde que l'empreinte SHA-256 : une copie de la base ne permet pas de se connecter.

**Liens à usage unique.** Même principe. Le jeton voyage dans le fragment de l'adresse (`/invitation#jeton`), que ni le
serveur ni le proxy ne voient, puis dans le corps de la requête. La page le retire aussitôt de la barre d'adresse. Le lien
est utilisé dans une transaction : deux requêtes simultanées ne peuvent pas s'en servir toutes les deux.

**Écritures.** Toute écriture faite avec le cookie exige un en-tête `Origin` identique à `Host`, sans quoi elle reçoit
un 403 : un autre site ne peut pas agir à la place de la personne connectée.

**Rôles.** `admin` et `teacher`. Le serveur les vérifie sur chaque route. L'admin ne voit que les comptes, jamais les cours.

**Limites d'essais.** 10 échecs en 10 minutes par couple adresse IP et e-mail, 50 par adresse IP. L'échec est compté avant
le calcul du mot de passe, qui prend du temps, pour que des essais simultanés ne passent pas tous avant le premier échec.
Une adresse inconnue répond avec le même message et la même durée qu'un mauvais mot de passe. Un compte désactivé n'est
annoncé qu'à la personne qui donne le bon mot de passe.

**Suppression d'un compte.** Réservée à un compte déjà désactivé, avec le mot `SUPPRIMER`, que le serveur vérifie aussi.
`deleted_at` le met de côté : il garde tout et reste restaurable 14 jours. Le nettoyage horaire l'efface ensuite, et les
clés étrangères (`ON DELETE CASCADE`) emportent ses sessions, liens, médias, cours, versions, lancements et élèves.

**Écrans.** Ils construisent leur contenu avec `el()` et des nœuds de texte, jamais avec `innerHTML` : une adresse e-mail
ne peut pas injecter de code. Les pages construites sont d'un seul tenant (`scripts/build.mjs`).

## Tests

`npm test` lance `node:test` sur le modèle (migration v2, numérotation, évaluation), le tableur
(CSV, correspondance des colonnes, import avec réf. en double), le mot de passe (SHA-256 de
secours) et le serveur (`http`, `security`, `db`, routes, démarrage réel du processus).

`npm run test:e2e` vérifie les écrans dans Chromium, avec Playwright (`tests/e2e/`).

`npm run test:coverage` lance le tout en mesurant la couverture par fichier (`scripts/coverage.mjs`). Il
échoue sous les seuils. Contrairement au résumé de `node --test`, un fichier qu'aucun test ne charge y
compte pour 0 % de ses lignes.

`npm run test:mutants` casse le code exprès, une modification à la fois, sur une copie du projet, et
échoue si aucun test ne le remarque (`scripts/mutants.mjs`). Chaque comportement sensible y a sa ligne.

## Cours

| Page               | Fichier           | Contenu                                                     |
| ------------------ | ----------------- | ----------------------------------------------------------- |
| `/prof`            | `prof.html`       | Connexion, liste des cours, création, import                |
| `/prof/cours/<id>` | `prof-cours.html` | Un cours : les vues de gestion, enregistrées sur le serveur |

**Brouillon et versions.** Un cours a un brouillon, enregistré à chaque modification, et des versions figées à chaque
publication. Un lancement garde la sienne : modifier le cours ensuite ne la change pas. Le serveur attribue les révisions et
refuse un enregistrement parti d'une révision périmée (409) : un autre onglet n'est jamais écrasé.

**Fichiers.** Les photos et les plans ne sont pas dans le contenu du cours, mais dans `data/media/<sha256>.<ext>`, servis sous
`/media/` et cachés pour toujours, car leur nom dépend de leur contenu. Le navigateur réduit les photos avant l'envoi (1280 px,
qualité 78) et les plans (2600 px, qualité 88). Le serveur lit le type dans le contenu du fichier. Le nettoyage horaire oublie
ce qu'aucun brouillon ni version ne cite, après un jour de délai, car un fichier est envoyé avant le brouillon qui le cite.
Le serveur refuse un brouillon dont un plan ou une photo n'est pas l'un de ces fichiers, ou rien (`COU-14`). Une version déjà publiée n'est pas relue : à l'écran, tout
ce qui vient d'un cours reste échappé (`SEC-04`), y compris dans le fichier de secours, où aucun serveur ne filtre.

**`store.js` et ses backends.** Les vues appellent `changedMap()`, `storeFile()` et `storeMapImage()` sans savoir où vont les
données. Le backend `local` écrit dans IndexedDB ; celui de `prof/course-backend.js` écrit sur le serveur. Une écriture à la
fois : la suivante part de la révision donnée par la précédente. Si l'écriture échoue, rien n'est perdu : tout reste à écrire,
et le reste de l'application continue de fonctionner à partir de ce qui est en mémoire.

## Lancements et élèves

| Page                     | Fichier               | Contenu                                                  |
| ------------------------ | --------------------- | -------------------------------------------------------- |
| `/prof/lancements/<id>`  | `prof-lancement.html` | QR code, code à taper, liste des élèves, fin du cours    |
| `/`                      | `accueil.html`        | Taper un code, ou aller vers l'espace enseignant         |
| `/c/<CODE>`              | `eleve.html`          | Entrer avec ses noms, lire les fiches, les placer        |

- **Un lancement** (`server/launches.mjs`) fige la dernière version publiée et reçoit un code de 6 caractères, sans O, 0, I ni 1. Le QR
  code contient l'adresse `/c/<CODE>` : il n'y a qu'un seul mécanisme, par QR code ou au clavier.
- **Ce qu'un élève reçoit** passe toujours par `studentCourse()` (`server/student-view.mjs`), qui garde une liste de champs : ni position
  réelle, ni fiche masquée, ni réglage de l'enseignant.
- **Un élève n'a pas de compte.** `POST /api/join/:code` lui donne un jeton, gardé par son navigateur sous `cartopoint.eleve.<CODE>`, et envoyé
  dans un en-tête pour ne figurer dans aucun journal. La base ne garde que son empreinte.
- **Son travail** reste dans IndexedDB, sous `<identifiant du participant>/<carte>` : il repart donc à zéro à chaque lancement.
- **Fin du cours :** le code cesse de fonctionner (410) et le jeton continue. Un élève déjà entré garde son accès, jusqu'à ce que le
  lancement soit supprimé. Son navigateur lui annonce la fin, en interrogeant `GET /api/student/state` toutes les 20 secondes si l'onglet
  est visible. La page de l'enseignant interroge `GET /api/launches/:id` toutes les 5 secondes.
- **Limites :** 200 élèves par lancement. 200 essais de code inconnu par adresse en 15 minutes : une réussite ne compte pas, et une classe de 50 qui partage une adresse doit pouvoir se tromper.

## Rendre son travail

- **Côté élève :** « Terminer » fige le travail (`S.finished`, testé par `locked()` dans les vues), le garde dans IndexedDB sous
  `rendu/<participant>`, puis l'envoie. Sans réseau, le travail est figé quand même et l'envoi se réessaie. La page contrôle
  `GET /api/student/state` et renvoie le rendu si le serveur ne l'a pas, y compris s'il l'a perdu après l'avoir confirmé.
- **`PUT /api/student/answers`** (`server/answers.mjs`) : positions entre 0 et 100, mesures de 50 caractères au plus, fiches visibles
  de la version du lancement, 256 Ko au total. Tout écart est refusé (400). Le premier envoi fait foi, et les suivants reçoivent la même
  réponse. Un rendu reçu après la fin du cours est marqué `late`.
- **Le résultat** est calculé par le serveur avec `evaluate()` (`src/js/model.js`, partagé avec le navigateur), à partir de la version du
  lancement, des proportions et de l'échelle de chaque carte. Il reste en base : la réponse à l'élève ne contient ni résultat ni position.
- **Les proportions du plan** (`map.ratio`) sont mesurées par le navigateur de l'enseignant à la publication.

## Hors ligne

Une fois sa page préparée, un élève n'a plus besoin du réseau que pour entrer et rendre (`HOR-01`, `HOR-03`). Cela ne concerne que `/c/`.

| Quoi                               | Où                                                  | Écrit par                   |
| ---------------------------------- | --------------------------------------------------- | --------------------------- |
| La page et les polices             | Cache Storage, `cartopoint-page-<version>`          | le service worker           |
| Les plans et les photos            | Cache Storage, `cartopoint-media`                   | `src/js/eleve/offline.js`   |
| Le cours, sans réponses            | IndexedDB, `cours/<participant>`                    | `src/js/eleve/main.js`      |
| Le travail et le rendu             | IndexedDB, `<participant>/<carte>`, `rendu/<participant>` | `store.js`, `main.js` |

- **Le service worker** (`src/sw.js`, servi en `/c/sw.js`) ne voit que `/c/`. Il sert d'abord ce qu'il a gardé : sur le terrain, attendre
  un réseau faible serait pire que de ne pas en avoir. Il n'écrit jamais rien en passant : tout ce qu'il garde est décidé à l'avance.
- **`/api/` ne passe jamais par lui,** les vidéos non plus : `Range` et Safari ne s'entendent pas avec un service worker. Rien de ce que le
  serveur répond à un élève ne peut donc rester dans un cache, ce qui compte pour la correction de l'étape 7.
- **Sa version** vient du serveur : `GET /c/sw.js` remplace `__VERSION__` par une empreinte du service worker et de `eleve.html`, où tout
  le code de la page est écrit. Une page qui change déclenche donc la mise à jour chez les élèves. Une mise à jour ne s'active qu'une fois
  tout récupéré : si elle échoue, l'ancienne version reste en place. Les photos, nommées par leur contenu, ne changent jamais et survivent.
- **Tous les codes partagent une page,** gardée sous l'adresse `/c/page`, qui n'est jamais un code : ceux-ci ont 6 caractères.
- **Le cours n'est demandé qu'une fois :** la version d'un lancement est figée (`COU-11`). Pour la même raison, un fichier déjà gardé n'est
  jamais redemandé. Si le cours a été effacé, `GET /api/student/state` répond 401 : la page le dit, garde le travail à l'écran et oublie le
  nom de l'élève.
- **L'icône du réseau** (`eleve/network-icon.js`) montre tout cela sans bandeau : en ligne ou non, et où en est la préparation. Le texte reste
  dans `#offlineStatus`, invisible, pour les lecteurs d'écran. « Hors ligne » vient de `navigator.onLine` **et** de la dernière réponse du
  serveur : un téléphone peut annoncer un réseau qui ne répond pas.
- **« ✓ Prêt pour le terrain »** ne s'affiche que si le cours est gardé, le service worker actif et tous les fichiers présents. Sinon la page
  dit ce qui manque : elle propose de réessayer, reprend au retour du réseau, ou prévient que ce navigateur ne peut pas garder le cours. Un
  service worker dont l'installation échoue ne prévient de rien : au bout de 20 secondes, la page considère que c'est le cas.
- **Sans réseau, les réponses attendent** dans `rendu/<participant>`. Elles partent quand la page est ouverte avec du réseau : à l'événement
  `online`, au retour sur l'onglet et toutes les 20 secondes. Il n'y a pas de Background Sync : Safari ne le connaît pas.
- **En développement,** `npm run dev` sert `src/`, dont les modules ne sont pas gardés : recharger sans réseau ne marche que sur les pages
  construites, comme `tests/e2e/offline.test.js` et la préproduction.

**Polices :** `src/assets/fonts/`, avec leurs licences. Toutes les pages les demandent à `/assets/fonts/` ; le fichier autonome, qui n'a pas de
serveur, les contient. Aucune page ne demande plus rien à un autre site (`HOR-05`).

## Journal des problèmes

Ce qui échoue dans un navigateur arrive tout seul à l'admin, avec la machine et la raison (`INC-01` à `INC-07`).

- **Côté navigateur, `incident.js`.** Il écoute les erreurs du programme et les promesses perdues. `api.js` lui signale les erreurs du serveur et
  les écritures perdues. `util.js` lui signale les messages d'erreur affichés, par `onProblem()`, car ce fichier sert aussi au serveur et ne peut
  pas l'importer. Le reste appelle `reportIncident(action, erreur)`. **Ne jamais y mettre de nom, de réponse ou de contenu de cours.**
- **Sans réseau,** le message attend dans `localStorage`, sous `cartopoint.incidents`. Il n'emploie pas `api()` : un signalement raté ne se
  signale pas lui-même.
- **Côté serveur, `server/incidents.mjs`.** `POST /api/incidents` est ouverte à tous, puisqu'un problème peut arriver avant toute connexion :
  seuls les champs prévus entrent, et le nombre de lignes et d'envois est limité. La limite vaut pour tout le site et non par adresse : derrière
  Cloudflare, des inconnus partagent la même adresse (section 10 de la feuille de route). `GET /api/admin/incidents` et
  `POST /api/admin/incidents/clear` sont réservées à l'admin. La purge passe par `app.purge()`, chaque heure.
- **Pour lire le journal depuis le serveur,** sans passer par la page : la table `incidents` de `app.db`.

## Fin du cours

Dès que la page apprend la fin du cours, par `GET /api/student/state`, elle fige le travail et l'envoie, sans lui demander (`CRG-11`). Sans réseau, elle ne peut rien savoir : l'élève continue, et chaque réponse garde son heure (`CRG-13`).

- **La correction** vient de `GET /api/student/correction`, seulement 30 secondes après la fin du cours (`CRG-14`) et une fois les réponses reçues : positions réelles, résultats et score du serveur, en `no-store`. Les vues ne recalculent rien : `evaluationOf()` (`store.js`) lit le résultat reçu.
- **Elle reste le temps de la page** (`eleve/correction.js`). Elle n'existe que dans `sessionStorage`, qui survit à un rechargement et disparaît avec l'onglet, et en mémoire pour les positions réelles : jamais dans IndexedDB ni dans un cache. Rien ne s'exécute de façon fiable à la fermeture : le cours est marqué `efface/<participant>` dès que c'est fini, puis effacé au prochain chargement d'une page qui n'a plus son onglet. Les fichiers qui servent à un autre cours de l'appareil restent.
- **Une page fermée avant la fin** ne reçoit pas la correction. `beforeEnd`, dans `sessionStorage`, dit si cet onglet a vu le cours en marche. Le serveur ne peut pas le savoir : c'est une règle de la page, pas une protection.
- **L'heure des réponses :** `entries[fiche].at`, noté par `stamped()` sur la page d'un élève seulement. À l'envoi, l'appareil donne son heure (`sentAt`) : le serveur en déduit l'écart avec la sienne, remet les heures à la sienne, et compte dans `answers_after_end` celles d'après la fin, au-delà de 30 secondes. Elles comptent dans le score.
- **Ce que voit l'enseignant :** « A fini », « Figé à la fin du cours », « A fini avant la fin, reçu après » ou « A fini après la fin du cours », puis le nombre de réponses faites après la fin. Ces mentions reposent sur ce que déclare l'appareil. Pas « reçu après l'envoi des corrections » (`afterCorrection`) : elle compare l'heure du rendu et celle de la fin, toutes deux du serveur. C'est elle qui rend visible un second nom qui lirait les réponses pour le premier (`CRG-14`).
- **Le compte rendu d'un élève** (`report.js`) garde ses placements et ses résultats, jamais les positions réelles (`CRG-10`). `report.js` ne dépend plus du code de gestion : `views/report-actions.js` garde ce qui n'existe que dans l'application d'origine.

## Version affichée

Chaque page montre sa version en bas à gauche (`version.js`) : le numéro de `package.json` et le commit, gravés par `scripts/build.mjs`, le commit suivi de « + » s'il restait des modifications. Par exemple `version 1.0.0 (f401778)`. C'est celle que le navigateur a vraiment, y compris une page gardée par le service worker. Une page servie depuis `src/` affiche « dev ». Une image Docker n'a pas de dépôt git : `docker build --build-arg APP_VERSION=$(git rev-parse --short HEAD) .`, sans quoi elle affiche « inconnue ». Le journal des problèmes note cette version.

## Historique

La page d'un lancement (`prof/launch.js`, `prof/launch-results.js`) reste celle de son suivi : une fois le cours fini, c'est aussi son historique.

- **La liste** vient de `GET /api/launches/:id`, toutes les 5 secondes : état, score et précision moyenne de chacun. Elle ne se redessine que si quelque chose a changé.
- **Le reste** vient de `GET /api/launches/:id/sheets`, à la demande : le cours avec ses positions réelles, et les réponses de chacun. Un autre enseignant reçoit 404 (`ANO-06`).
- **Les comptes rendus** (`prof/student-reports.js`) réutilisent `report.js`, qui dessine à partir de l'état commun : cette page y met tour à tour chaque élève. `S.admin` y fait apparaître les positions réelles et les écarts. Plusieurs fichiers partent dans un `.zip` (`zip.js`, sans compression : les JPG ne se compressent plus), car un navigateur bloque les téléchargements multiples.
- **L'Excel** (`prof/results-workbook.js` pour le contenu, `xlsx-write.js` pour le fichier, tous deux sans écran, donc testés sans navigateur). `xlsx.js` reste le lecteur. Un texte y est toujours écrit comme du texte : aucune formule possible. La précision moyenne vient de `meanGap()` (`model.js`), partagée avec le serveur.
- **Le fichier de réponses** (`format: cartopoint-reponses`) est proposé à l'élève quand l'envoi n'aboutit pas. `POST /api/launches/:id/answers-file` suit le même chemin qu'un envoi : le premier rendu reçu fait foi (`HIS-07`). Sans signature : un enseignant qui importe un fichier fait confiance à celui qui le lui donne.
- **La purge** (`launches.purge()`, chaque heure, avant celle des fichiers) efface un lancement un an après sa fin ou, s'il n'a jamais été terminé, après sa dernière activité.

## Fichier de secours

`scripts/build.mjs` produit `secours.html` : la page de l'application d'origine, construite avec `__FALLBACK__`, qui ne cherche aucun serveur. `prof/fallback-file.js` la télécharge, y écrit le cours (photos en base64, sans les fiches masquées) et le mot de passe de gestion choisi par l'enseignant, puis donne le tout à enregistrer. Le fichier est ensuite autonome : le travail reste dans le navigateur, et c'est la page qui corrige (`EXP-02`).

