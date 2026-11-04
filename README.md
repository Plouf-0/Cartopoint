# Cartopoint

Application web pour les sorties de terrain. L'enseignant prépare des **fiches** (photos, description) et leur **position réelle sur un plan**, puis lance
le cours avec un **QR code**. Les élèves rejoignent sans compte, lisent les fiches, notent leurs **mesures** (température, hygrométrie, éclairement) et
**placent** chaque point sur le plan, même sans réseau. À la fin du cours, chacun reçoit sa **correction** et son **compte rendu en JPG**. L'enseignant
garde les résultats de la classe : un **Excel** et le compte rendu de chaque élève.

- Guide d'utilisation (enseignant et élèves) : [docs/GUIDE.md](docs/GUIDE.md)
- Fonctionnement interne, format des données : [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- Exigences du projet (source de vérité) : [docs/CAHIER_DES_CHARGES.md](docs/CAHIER_DES_CHARGES.md)
- Suivi de la grande mise à jour : [docs/FEUILLE_DE_ROUTE.md](docs/FEUILLE_DE_ROUTE.md)

## En bref

- **Aucune dépendance à l'exécution** : HTML, CSS et JavaScript (modules ES) écrits à la main, serveur Node sans paquet, base SQLite fournie par Node.
  `esbuild`, `prettier` et `playwright` ne servent qu'au développement.
- **Des comptes pour les enseignants, aucun pour les élèves.** L'admin distribue des liens de création de compte. L'application n'envoie aucun e-mail.
- **Le serveur fait foi** : les cours, les réponses et les résultats des élèves y sont conservés, un an au plus (voir « Données d'élèves »).
- **Le terrain se passe de réseau** : une fois la page élève préparée, elle fonctionne sans connexion et envoie les réponses quand le réseau revient.
- **Un fichier de secours** : chaque cours peut se télécharger en un seul `.html`, qui marche d'un double-clic si le site est en panne.
- **Thèmes** de couleurs et icône réglables, pour d'autres sujets que les plantes.

## Démarrer

Prérequis : Node.js 24 (`nvm use` lit le fichier `.nvmrc`).

```bash
npm install            # outils de développement
npm run dev            # http://localhost:8080 — sert src/ sans construction, données dans .dev-data/
npm test               # tests sans navigateur
npm run test:e2e       # parcours dans un vrai navigateur (une fois : npx playwright install chromium-headless-shell)
npm run test:coverage  # les deux, avec la couverture par fichier et ses seuils (environ 13 minutes sur 2 cœurs)
npm run test:mutants   # casse le code exprès et vérifie que les tests le voient (plusieurs heures en entier)
npm run test:charge    # simule une classe qui rejoint et travaille en même temps
npm run build          # dist/ : les pages du site, chacune en un seul fichier
npm start              # sert dist/ et data/ comme en production
```

Pour avoir un compte admin en développement :

```bash
ADMIN_EMAIL=moi@example.org ADMIN_PASSWORD='un-mot-de-passe' npm run dev
```

En développement, les pages chargent `src/js/` en modules ES : modifiez un fichier et rechargez. Le fichier de secours ne se télécharge qu'après
`npm run build`, servi avec `npm start`.

## Numéro de version

`x.y.z` dans `package.json` : `x` pour un changement rétro-incompatible, `y` pour un ajout de fonctionnalité, `z` pour une correction. Les versions `0.y.z`
sont celles d'avant les espaces enseignants. Chaque page affiche le numéro puis le commit en bas de l'écran.

## Héberger

Il faut un proxy **HTTPS** devant le serveur : le service worker de la page élève et le cookie de session en ont besoin. L'image Docker écoute sur le port 8080.

```bash
cp .env.example .env     # puis remplissez-le
APP_VERSION=$(git rev-parse --short HEAD) docker compose up -d --build
```

`docker-compose.yml` rejoint le réseau externe `traefik_network`, sans publier de port. Le routage se règle hors du dépôt, dans la configuration de Traefik, qui
vise le service par son nom : `http://inventaire:8080`. Avec un autre proxy, publiez le port et retirez ce réseau.

| Variable                        | Rôle                                                                                               | Défaut |
| ------------------------------- | -------------------------------------------------------------------------------------------------- | ------ |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | créent le compte admin au premier démarrage, s'il n'existe pas ; sans elles, il n'y a pas d'admin  | —      |
| `TRUST_PROXY`                   | `1` si un proxy est placé devant. Voir ci-dessous. Sans proxy, ne pas le définir                   | —      |
| `PORT`                          | port d'écoute                                                                                      | `8080` |
| `ROOT`                          | dossier de l'application construite                                                                | `dist` |
| `DATA_DIR`                      | dossier des données                                                                                | `data` |
| `MAX_BODY_MB`                   | taille maximale d'un fichier envoyé par un enseignant                                              | `100`  |

**`TRUST_PROXY=1`** fait lire l'adresse du client dans la dernière valeur de `X-Forwarded-For`, et porter `Secure` au cookie de session. Derrière Cloudflare, cette
valeur est l'un de ses serveurs : le visiteur est alors lu dans `CF-Connecting-IP`, seulement si la requête vient bien des plages publiées par Cloudflare, relevées dans
`server/security.mjs`. Sans proxy, n'importe qui pourrait choisir son adresse.

### Données

`data/` est un volume, hors du dépôt : il ne doit jamais y entrer. Il contient :

- `app.db` : la base, avec les comptes, les cours, les réponses et le journal des problèmes ;
- `media/` : les plans et les photos des cours ;
- `backups/` : une copie de la base par jour, 14 conservées. Les fichiers de `media/` n'y sont pas : **sauvegardez tout `data/`** ailleurs.

Le schéma évolue par les migrations de `server/migrations/`. Le serveur refuse de démarrer sur une base plus récente que son code.

### Comptes

L'espace enseignant est à l'adresse `/prof`, le tableau de bord de l'admin à `/admin`. L'admin crée un lien de création de compte et le transmet lui-même.

Mot de passe de l'admin perdu : lancez cette commande sur le serveur, puis ouvrez le lien affiché après l'adresse du site.

```bash
docker compose exec inventaire node server/admin-reset.mjs
```

### Récupérer un projet existant

Dans l'espace enseignant, **Importer un projet** accepte un `.json` et un `.html` enregistré par une ancienne version, photos comprises. Pour sortir le projet d'un
ancien `.html` sans l'importer :

```bash
npm run convert -- "Ancien projet.html" projet.json
```

## Sécurité et données d'élèves

- Les mots de passe sont hachés avec scrypt. Le cookie de session est `HttpOnly`, et les écritures vérifient l'origine de la requête.
- Les échecs de connexion sont limités par compte et par adresse, ceux d'un code de cours par adresse. En IPv6, tout un bloc `/64` compte pour un seul client.
- Le cours envoyé aux élèves ne contient pas les positions réelles, qui n'arrivent qu'avec la correction. Le **fichier de secours les contient**, puisqu'il corrige seul
  sans serveur : son mot de passe de gestion évite les accès par hasard, sans résister à une personne déterminée.
- Le serveur refuse les chemins sortant de `ROOT`, et ne sert rien de `DATA_DIR` hors des photos des cours. Les SVG ne sont pas acceptés.
- L'identification par IA (facultative) appelle une adresse fournie par l'enseignant : ne mettez jamais de clé d'API dans l'application, passez par votre propre service.

**Données d'élèves.** Le serveur conserve le nom que l'élève a saisi et ses réponses, jusqu'à ce que l'enseignant supprime le lancement, et un an au plus. Le journal des
problèmes note des informations techniques sur l'appareil, sans le nom de l'élève, 90 jours au plus. Ce sont des données personnelles : l'établissement doit en être
informé. Rien de cela n'est écrit dans les journaux du serveur.

## Organisation du code

```
src/
  accueil.html  prof*.html  admin.html  compte.html  eleve.html   les pages du site
  secours.html          la page du fichier de secours
  sw.js                 service worker de la page élève
  css/app.css           toute la mise en forme (variables de thème en tête)
  assets/               polices, plan d'exemple
  js/
    accueil.js          la page d'accueil : taper le code d'un cours
    eleve/              rejoindre, travailler sans réseau, rendre, correction
    prof/               espace enseignant : cours, lancement, QR code, résultats, Excel, fichier de secours
    admin/              tableau de bord, journal des problèmes
    compte/             écrans de compte, liens à usage unique
    views/              en-tête, plan, panneaux, fenêtres, partagés avec l'éditeur et le fichier de secours
    main.js             démarrage du fichier de secours
    project-io.js       ses fichiers : enregistrer, ouvrir, version élèves
    model.js            format des données, calculs (pur, partagé avec le serveur)
    store.js            état de l'application
    report.js           plan et compte rendu en JPG
    xlsx-write.js  zip.js       écriture d'un vrai .xlsx, sans dépendance
    spreadsheet.js      import / export tableur des fiches
    incident.js         signalement des problèmes au serveur
server/
  index.mjs             démarrage : options, sauvegarde quotidienne, arrêt propre
  app.mjs               assemble la base, les routes et les fichiers statiques
  http.mjs              routage, corps des requêtes, JSON, fichiers (ETag, gzip)
  db.mjs                SQLite, migrations (migrations/*.sql), copies de la base
  security.mjs          adresse du client, limites d'essais
  auth.mjs  courses.mjs  launches.mjs  answers.mjs  media.mjs  incidents.mjs
  admin-reset.mjs       lien de réinitialisation pour l'admin, à lancer sur le serveur
  routes/               une famille de routes par fichier
scripts/                construction, conversion, couverture, mutants, charge
tests/                  tests node:test ; e2e/ pour les parcours dans le navigateur
```

Détails dans [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
