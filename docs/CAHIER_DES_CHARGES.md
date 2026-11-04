# Cahier des charges — Inventaire botanique

**Version 0.20** · 4 novembre 2026 · établie à partir du code (commit `fb3d952`)

Ce document est la **source de vérité des exigences** du projet : ce que l'application doit faire,
et ce qu'elle ne doit pas casser. Il décrit l'existant et accueille les demandes d'évolution.

**Sommaire**

1. [Mode d'emploi du document](#1-mode-demploi-du-document)
2. [Le produit](#2-le-produit)
3. [Principes à respecter](#3-principes-à-respecter)
4. [Espace élèves](#4-espace-élèves)
5. [Espace gestion](#5-espace-gestion)
6. [Projet et diffusion](#6-projet-et-diffusion)
7. [Serveur et déploiement](#7-serveur-et-déploiement)
8. [Exigences transverses](#8-exigences-transverses)
9. [Règles de calcul et valeurs de référence](#9-règles-de-calcul-et-valeurs-de-référence)
10. [Écarts constatés](#10-écarts-constatés)
11. [Décisions à prendre](#11-décisions-à-prendre)
12. [Fonctionnement cible](#12-fonctionnement-cible)
13. [Historique](#13-historique)

---

## 1. Mode d'emploi du document

**Proposer un changement**

Toutes les demandes passent par ce document, pas par messages : c'est ce qui permet d'en garder la
trace.

- **Nouvelle demande :** remplir une ligne du tableau ci-dessous, une seule demande par ligne, en
  disant ce qui est souhaité et pourquoi.
- **Modifier ou retirer une exigence :** écrire directement dans son texte. Dans Google Docs, le mode
  Suggestion garde le texte d'origine et affiche la proposition jusqu'à sa validation.
- **Répondre à une question de la section 11 :** écrire la réponse sous la question.
- **Faire une remarque :** ajouter un commentaire sur le passage concerné.
- **Où regarder :** les sections 4 à 6 décrivent ce que fait l'application, et la section 12 ce qu'elle
  doit devenir. Les sections 7 à 10 sont plus techniques.

**Demandes en cours**

| ID      | Date       | Demande : ce qui est souhaité, et pourquoi                                                                                                                                                   | Exigence concernée                       | Priorité | Statut et réponse                                                                      |
| ------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- | -------- | -------------------------------------------------------------------------------------- |
| Exemple | 01/11/2026 | Les élèves doivent pouvoir choisir leur carte, car une sortie peut couvrir plusieurs sites.                                                                                                  | E-01                                     | Haute    | Proposée                                                                               |
| EV-01   | 01/11/2026 | De vrais espaces enseignants : chaque enseignant a son propre espace, séparé de ceux des autres. L'admin distribue des liens pour créer les comptes.                                         | ACC-01, SRV-05, Q-09, Q-11               | Haute    | En cours. Voir 12.1                                                                    |
| EV-02   | 01/11/2026 | Préparer un cours, le publier quand il est prêt, le lancer et afficher un QR code que les élèves scannent pour le rejoindre, à la façon de Kahoot.                                           | PUB-01, DEM-01, MUL-01, Q-13, Q-14, Q-19 | Haute    | En cours : publier, lancer et le QR code sont faits. Voir 12.2 |
| EV-03   | 01/11/2026 | Pas de compte pour les élèves. Leur nom, leur prénom et leurs réponses restent dans l'historique du cours, pour l'enseignant.                                                                | PRI-04, Q-02, Q-17                       | Haute    | En cours : entrer sans compte et rendre sont faits ; l'enseignant verra le détail des réponses à l'étape 8. Voir 12.3 |
| EV-04   | 01/11/2026 | Revoir la publication des fiches, qui semble ne pas fonctionner.                                                                                                                             | PUB-01, DEM-02, E-02, E-16               | Moyenne  | En cours. Voir 12.9                                                                    |
| EV-05   | 01/11/2026 | Suivre le cours : voir les noms des élèves qui ont commencé, et s'ils ont fini ou non.                                                                                                       | Q-10                                     | Haute    | Fait : la liste montre qui a commencé et qui a fini, sans recharger. Voir 12.4 |
| EV-06   | 01/11/2026 | Travailler hors ligne une fois la page récupérée, avec l'avancement gardé dans le navigateur. La connexion ne sert qu'à rendre.                                                              | Q-04, Q-05, Q-15, E-06                   | Haute    | Fait, à essayer sur de vrais téléphones. Voir 12.5 |
| EV-07   | 01/11/2026 | Alléger le cours, en particulier les photos, sans les rendre illisibles.                                                                                                                     | E-05                                     | Moyenne  | En cours. Voir 12.7                                                                    |
| EV-08   | 01/11/2026 | Donner à l'élève la correction complète sur son téléphone quand l'enseignant termine le cours, s'il a du réseau et que sa page est toujours ouverte. Elle n'y reste que le temps de la page. | Q-03, Q-16, Q-20, VER-01                 | Haute    | Validée. Voir 12.6                                                                     |
| EV-09   | 01/11/2026 | Afficher sous le QR code un code court à taper, comme alternative.                                                                                                                           | COU-04                                   | Moyenne  | Fait. Voir 12.2 |
| EV-10   | 01/11/2026 | Ne plus dépendre de Google pour les polices.                                                                                                                                                 | E-08                                     | Basse    | Fait. Voir 12.5 |
| EV-11   | 01/11/2026 | Garder le fichier autonome comme export de secours.                                                                                                                                          | PRI-02, Q-12                             | Moyenne  | Validée. Voir 12.8                                                                     |
| EV-12   | 01/11/2026 | Carte collective anonyme : tous les placements, sans nom, sur l'écran de l'enseignant pour le débrief.                                                                                       |                                          | Basse    | Reportée                                                                               |
| EV-13   | 01/11/2026 | Avancement des élèves en direct.                                                                                                                                                             | Q-10                                     | Basse    | Reportée                                                                               |
| EV-14   | 01/11/2026 | Dupliquer un cours entre enseignants.                                                                                                                                                        |                                          | Basse    | Reportée, à revoir si le nombre d'utilisateurs le justifie                             |
| EV-15   | 01/11/2026 | Garder un historique de chaque cours : une ligne par élève avec son nom et ses résultats, et le détail de ses réponses en cliquant dessus.                                                   | Q-02                                     | Haute    | Validée. Voir 12.4                                                                     |
| EV-16   | 01/11/2026 | Tableau de bord de l'admin : voir les enseignants et des chiffres sur chacun, réinitialiser un mot de passe, désactiver un compte.                                                           | Q-18                                     | Moyenne  | En cours. Voir 12.1                                                                    |
| EV-17   | 01/11/2026 | Côté élève, un bouton Terminer notifie l'enseignant et envoie les réponses s'il y a du réseau.                                                                                               | Q-05, Q-20                               | Haute    | Fait. Voir 12.5 |
| EV-18   | 01/11/2026 | Sans réseau, permettre à l'élève de récupérer un fichier de réponses à donner à l'enseignant.                                                                                                | HOR-04                                   | Moyenne  | Validée. Voir 12.4 et 12.5                                                             |
| EV-19   | 01/11/2026 | Exporter un lancement de l'historique dans un tableur.                                                                                                                                       | Q-21, REN-03                             | Moyenne  | Validée. Voir 12.4                                                                     |
| EV-28   | 01/11/2026 | Ne pas négliger les tests, et arriver à une bonne couverture à la fin de la mise à jour. (Numéro choisi après EV-27 : les lignes EV-20 à EV-27 restent réservées dans la copie Google Docs.) | E-09, QUA-01                             | Haute    | Validée. Voir 12.12                                                                    |
| EV-29   | 02/11/2026 | Un enseignant dont le compte est désactivé doit l'apprendre en se connectant : « mot de passe incorrect » porte à confusion.                                                                 | ADM-06                                   | Moyenne  | En cours. Voir 12.1                                                                    |
| EV-30   | 02/11/2026 | Un bouton supprime un compte désactivé et ses cours, après avoir recopié un mot, pour ne pas le faire par erreur.                                                                            | ADM-10                                   | Moyenne  | En cours. Voir 12.1                                                                    |
| EV-31   | 02/11/2026 | Un compte supprimé reste restaurable un temps, dans un tableau à part, avec un bouton Restaurer. Souhait de confort, pas une priorité.                                                       | ADM-10                                   | Basse    | En cours. Voir 12.1                                                                    |
| EV-32   | 02/11/2026 | Le cadre des options, à droite de la page d'un cours, reste tout petit quand le plan est petit ou absent : il doit descendre plus bas. | EDI | Basse | Fait |
| EV-33   | 02/11/2026 | Enlever l'identification par IA des réglages d'un cours. | IAI-01 | Basse | Fait pour l'espace enseignant ; l'application d'origine la garde jusqu'à l'étape 10 |
| EV-34   | 02/11/2026 | Rendre le site générique : des valeurs par défaut liées à Cartopoint plutôt qu'à « Inventaire botanique », en gardant le vert comme couleur par défaut. | Q-01 | Moyenne | Fait pour le nom, les valeurs par défaut et les textes. Voir Q-01 |
| EV-35   | 02/11/2026 | Plus aucune donnée d'utilisateur sur GitHub à partir de maintenant. L'historique sera réécrit plus tard si besoin. | Dépôt | Haute | Fait dans la branche : plan d'exemple inventé, captures retirées, `tests/repo.test.js`. Ce qui est déjà public le reste |

- **Exigence concernée :** son identifiant (`PLA-03`, `E-01`…), ou rien pour un besoin nouveau.
- **Priorité :** Haute (empêche une séance), Moyenne (gêne réelle), Basse (confort).
- **Statut :** Proposée → Validée → En cours → Livrée. Une demande peut aussi être Reportée ou Refusée,
  avec la raison. Valentin tient cette colonne à jour. Une demande livrée devient une exigence dans les sections 4 à 8.

**Lire une exigence**

- Chaque exigence a un **identifiant stable** (`PLA-03`). On peut le citer dans un commit, un
  ticket ou une conversation. Un identifiant n'est jamais réutilisé, même si l'exigence disparaît.
- Une exigence est **en place et doit le rester**, sauf mention contraire. La section 12 décrit ce qui
  n'est pas encore en place.
- ⚠️ signale une exigence en place, mais avec un écart ou une question : voir sections
  [10](#10-écarts-constatés) et [11](#11-décisions-à-prendre).

**Rôle de chaque document**

| Document                                  | Répond à                                           |
| ----------------------------------------- | -------------------------------------------------- |
| `docs/CAHIER_DES_CHARGES.md` (celui-ci)   | Que doit faire l'application ?                     |
| Copie Google Docs                         | Quels changements sont proposés ? Où en sont-ils ? |
| [`docs/ARCHITECTURE.md`](ARCHITECTURE.md) | Comment c'est construit ? Quel format de données ? |
| [`docs/FEUILLE_DE_ROUTE.md`](FEUILLE_DE_ROUTE.md) | Comment et dans quel ordre appliquer la section 12 ? |
| [`docs/GUIDE.md`](GUIDE.md)               | Comment s'en servir ?                              |
| [`README.md`](../README.md)               | Comment l'installer et l'héberger ?                |

**Faire vivre le document**

- Toute modification du comportement de l'application met à jour ce document **dans le même
  commit**.
- La référence reste ce fichier. La copie Google Docs sert à proposer et à suivre les changements :
  ceux qui sont validés sont reportés ici.
- Si le code et ce document se contredisent, aucun des deux ne l'emporte d'office : on signale
  l'écart (section 10), puis on tranche.
- Ce document dit **quoi**, pas **comment** : les détails techniques restent dans
  `ARCHITECTURE.md`.

---

## 2. Le produit

**Objet.** Application web pour les sorties de terrain. L'enseignant prépare des fiches d'espèces
et leur position réelle sur un plan. Les élèves lisent les fiches, notent leurs mesures, placent
chaque espèce sur le plan, vérifient leurs placements et rendent un compte rendu.

**Utilisateurs**

| Rôle       | Ce qu'il fait                                                        | Compte ?             |
| ---------- | -------------------------------------------------------------------- | -------------------- |
| Élèves     | Consultent, mesurent, placent, vérifient, téléchargent leur rendu    | Non, un nom à saisir |
| Enseignant | Prépare le projet, le publie ou le distribue, gère la séance         | Non, un mot de passe |
| Hébergeur  | Installe le serveur, fournit le mot de passe de publication          | —                    |

**Parcours type**

1. L'enseignant crée les fiches (à la main ou par tableur), ajoute les photos et place les
   positions réelles.
2. Il diffuse le projet : publication en ligne, ou fichier `.html` à ouvrir d'un double-clic.
3. Sur le terrain, les élèves saisissent leurs noms, relèvent leurs mesures et placent les fiches.
4. Ils vérifient : les placements sont figés et la correction apparaît.
5. Ils téléchargent le compte rendu (JPG) et le rendu prof (CSV) et les transmettent eux-mêmes
   (ENT, mail…).

**Hors périmètre aujourd'hui**

Pas de comptes utilisateurs, de collecte centralisée du travail des élèves, de suivi de classe, de
notation automatique transmise à l'enseignant, ni de version dans une autre langue que le français.
Certains de ces points sont discutés en section [11](#11-décisions-à-prendre). Les comptes enseignants et un
historique des résultats par cours sont prévus : voir section [12](#12-fonctionnement-cible).

**Vocabulaire**

| Terme            | Sens                                                                                      |
| ---------------- | ----------------------------------------------------------------------------------------- |
| Projet           | L'ensemble préparé par l'enseignant : cartes, fiches, photos, positions réelles, thème    |
| Carte            | Un plan (image) et ses fiches. Un projet en contient au moins une                         |
| Fiche            | Une espèce : noms, besoins, description, photos, position réelle                          |
| Réf. photo       | Repère libre de l'enseignant (« 12b »), utilisé sur le terrain et sur les photos          |
| Numéro           | Numéro vu par les élèves, calculé automatiquement (différent de la réf. photo)            |
| Position réelle  | Emplacement exact d'une fiche, défini par l'enseignant (carré bleu)                       |
| Placement        | Emplacement choisi par les élèves (rond rouge)                                            |
| Mesures          | Température, hygrométrie et éclairement relevés pour une fiche                            |
| Progression      | Placements, mesures et état « vérifié » d'une carte, propres à un navigateur              |
| Séance           | Période de travail entre deux remises à zéro de la progression                            |
| Compte rendu     | Image JPG récapitulative rendue par les élèves                                            |
| Rendu prof       | Tableau CSV récapitulatif, destiné à l'enseignant                                         |
| Publication      | Envoi du projet sur le serveur par l'enseignant                                           |
| Version élèves   | Export du projet sans les fiches masquées                                                 |
| Fichier autonome | Un seul `.html` contenant l'application et un projet, utilisable sans serveur             |

---

## 3. Principes à respecter

Ce sont les choix de fond du projet. En revenir sur l'un d'eux est une décision à part entière, à
noter ici.

- **PRI-01 — Sans dépendance à l'exécution.** HTML, CSS et JavaScript (modules ES) écrits à la
  main, sans framework. `esbuild`, `prettier` et `playwright` ne servent qu'au développement. ⚠️ E-08
  _Exception : la bibliothèque de QR code de Project Nayuki (licence MIT), copiée dans `src/js/vendor/` avec sa licence._
- **PRI-02 — Deux modes d'utilisation.** La même application fonctionne en fichier autonome (sans
  serveur ni connexion) et hébergée (par une adresse). Le fichier autonome deviendra un export de
  secours (`EXP-01`).
- **PRI-03 — Projet et progression séparés.** Le projet appartient à l'enseignant et peut être
  remplacé. La progression appartient aux élèves et survit aux mises à jour du projet.
- **PRI-04 — Le travail des élèves reste dans leur navigateur.** Noms, placements et mesures ne
  sont jamais envoyés au serveur. Seul l'enseignant publie, et il publie le projet sans progression.
  **À faire évoluer :** le nom, l'état et le travail rendu des élèves seront conservés sur le serveur, pour
  l'enseignant (`ANO-05`, `HIS-01`).
- **PRI-05 — Hors ligne.** Le fichier autonome fonctionne sans connexion. La page élève aussi, une fois préparée (`HOR-01`, dans la
  branche de la refonte)
- **PRI-06 — Positions indépendantes de l'écran.** Toute position est enregistrée en % de l'image
  du plan (0–100).
- **PRI-07 — Rien ne se perd d'une version à l'autre.** Les projets et les données des versions
  précédentes restent lisibles (voir `COM`).

---

## 4. Espace élèves

### 4.1 Noms des élèves — `ELE`

Code : [`views/header.js`](../src/js/views/header.js), [`report.js`](../src/js/report.js)

- **ELE-01** Un champ « Élève(s) » en haut de page reçoit les prénoms et noms du groupe (texte
  libre, un seul champ).
- **ELE-02** Les noms sont retrouvés à la visite suivante, dans le même navigateur.
- **ELE-03** Les noms sont obligatoires pour télécharger le compte rendu et le rendu prof : sinon,
  un message s'affiche et le curseur va dans le champ. Ils restent facultatifs pour l'image du plan.
- **ELE-04** Le champ est masqué en mode gestion, où les noms ne sont jamais exigés.

### 4.2 Liste des fiches — `LIS`

Code : [`views/student-panel.js`](../src/js/views/student-panel.js),
[`views/header.js`](../src/js/views/header.js)

- **LIS-01** Le panneau « Fiches à placer » montre les seules fiches visibles, dans l'ordre choisi
  par l'enseignant : vignette, nom, nom scientifique, famille, numéro, état, cases de mesures.
- **LIS-02** La recherche porte sur la réf. photo, le nom commun, le nom scientifique et la
  famille, sans distinguer les majuscules.
- **LIS-03** Les filtres **Toutes / À placer / Placées** se combinent avec la recherche.
- **LIS-04** Un compteur au-dessus du plan indique « x / y fiche(s) placée(s) », et « exercice
  vérifié » le cas échéant.
- **LIS-05** Un message explicite s'affiche s'il n'y a aucune fiche ou si le filtre ne donne rien.

### 4.3 Consultation d'une fiche — `CON`

Code : [`views/reader.js`](../src/js/views/reader.js), [`views/viewer.js`](../src/js/views/viewer.js)

- **CON-01** Un clic sur une fiche de la liste, ou sur son repère, l'ouvre en grand : photo
  principale, numéro, noms, famille, date d'observation, besoins, mesures, description,
  observations, autres photos et vidéos. Les rubriques vides ne s'affichent pas.
- **CON-02** Les besoins sont : ☀️ exposition, 💧 arrosage, 🌱 sol, 🌡️ chaleur, ✂️ entretien.
- **CON-03** La fenêtre s'adapte à la forme de la photo (portrait ou paysage).
- **CON-04** Un clic sur une photo ou sur la vignette ouvre la visionneuse plein écran : photo
  précédente et suivante (boutons ou flèches ← →), compteur, fermeture par la croix ou un clic à
  côté.
- **CON-05** Les vidéos se lisent dans la fiche, avec leurs commandes. La visionneuse ne montre que
  les photos.
- **CON-06** La fiche propose « Placer sur le plan » tant qu'elle n'est pas placée et que
  l'exercice n'est pas vérifié. Après vérification, elle affiche le résultat et l'écart.

### 4.4 Mesures — `MES`

Code : [`views/cards.js`](../src/js/views/cards.js), [`views/reader.js`](../src/js/views/reader.js)

- **MES-01** Chaque fiche reçoit trois mesures : température (°C), hygrométrie (%), éclairement
  (lux).
- **MES-02** Elles se saisissent dans les cases de la liste ou dans la fiche ouverte ; les deux
  affichent la même valeur.
- **MES-03** L'enregistrement est automatique, sans bouton.
- **MES-04** La saisie est libre, sans contrôle : « nuageux » est accepté. Le clavier numérique
  s'ouvre sur mobile.
- **MES-05** Les mesures restent modifiables après la vérification. ⚠️ Q-05

### 4.5 Placement sur le plan — `PLA`

Code : [`views/map.js`](../src/js/views/map.js)

- **PLA-01** « Placer sur le plan » passe en mode placement : un bandeau indique la fiche, le
  prochain clic sur le plan la place. **Annuler** ou la touche Échap abandonne.
- **PLA-02** Une fiche non placée peut aussi être glissée de la liste vers le plan, à la souris.
- **PLA-03** Un placement apparaît sous la forme d'un rond rouge portant le numéro de la fiche.
- **PLA-04** Un rond se déplace à la souris ou au doigt. Un simple clic dessus ouvre la fiche (un
  déplacement de moins de 4 px compte comme un clic).
- **PLA-05** Un placement reste toujours à l'intérieur du plan.
- **PLA-06** Chaque placement est confirmé par un message et une brève animation du repère.
- **PLA-07** Un placement peut être déplacé, mais pas retiré par les élèves. Seule une nouvelle
  séance l'efface.

### 4.6 Vérification et résultats — `VER`

Code : [`views/results.js`](../src/js/views/results.js), [`model.js`](../src/js/model.js)

- **VER-01** « Vérifier mes placements » est disponible dès qu'une fiche est placée.
- **VER-02** Une confirmation indique le nombre de fiches non placées et prévient que les placements
  ne pourront plus être modifiés.
- **VER-03** Après vérification, les placements sont figés, et les positions réelles apparaissent
  (carrés bleus), reliées aux placements par des pointillés.
- **VER-04** Chaque fiche indique son résultat : **Bien placée**, **Proche**, **À revoir**,
  **Non placée** ou **Pas de position réelle**, avec l'écart (voir section 9). ⚠️ E-03, Q-06
- **VER-05** La fenêtre des résultats montre le score, un tableau (n°, fiche, résultat, écart) et
  le rappel des seuils.
- **VER-06** L'état « vérifié » est enregistré par carte et résiste au rechargement. Seul
  l'enseignant peut rouvrir l'exercice.

### 4.7 Rendus — `REN`

Code : [`report.js`](../src/js/report.js), [`spreadsheet.js`](../src/js/spreadsheet.js)

- **REN-01** **Image du plan (JPG)** : le plan à sa taille d'origine avec les repères, et les
  positions réelles si l'exercice est vérifié. Disponible avant la vérification.
- **REN-02** **Compte rendu (JPG)** : une seule image avec le titre, les élèves, la carte, la date
  et l'heure, le score, le plan, la légende, puis un tableau (n°, fiche, trois mesures, résultat et
  écart). Elle reprend les couleurs du thème. Côté élèves, disponible après la vérification.
- **REN-03** **Rendu prof (CSV)** : une ligne par fiche visible (élèves, n°, réf. photo, noms, trois
  mesures, résultat, écart), puis une ligne **Moyenne** (moyenne de chaque mesure numérique, écart
  moyen, score). Disponible depuis la fenêtre des résultats.
- **REN-04** Le rendu prof s'ouvre directement dans Excel (séparateur `;`, virgule décimale, UTF-8
  avec BOM). Les noms sont répétés sur chaque ligne pour pouvoir coller les rendus de plusieurs
  groupes. Une mesure non numérique est conservée telle quelle et exclue de la moyenne.
- **REN-05** Tous les rendus sont produits dans le navigateur, sans serveur. Leur transmission à
  l'enseignant est à la charge des élèves. ⚠️ Q-02

---

## 5. Espace gestion

### 5.1 Accès — `ACC`

Code : [`views/login.js`](../src/js/views/login.js), [`auth.js`](../src/js/auth.js),
[`views/admin/index.js`](../src/js/views/admin/index.js)

- **ACC-01** Le bouton **⚙ Gestion** demande un mot de passe. Une erreur s'affiche dans la fenêtre.
- **ACC-02** Sans mot de passe défini, c'est `admin`. Il se change dans Réglages (4 caractères au
  moins, à saisir deux fois). ⚠️ E-03
- **ACC-03** Le projet ne contient que l'empreinte du mot de passe (SHA-256), calculée même sur un
  site en `http://` simple.
- **ACC-04** La gestion comporte quatre onglets : **Fiches, Cartes, Projet, Réglages**. Une mention
  « Mode gestion » reste visible et **Revenir à la vue élèves** permet d'en sortir.
- **ACC-05** Recharger la page revient à la vue élèves.
- **ACC-06** Ce mot de passe évite les modifications accidentelles. Il **n'est pas une protection** :
  l'application le dit explicitement à l'enseignant. ⚠️ Q-03

### 5.2 Liste des fiches — `FIC`

Code : [`views/admin/fiches.js`](../src/js/views/admin/fiches.js)

- **FIC-01** La liste montre toutes les fiches, masquées comprises : vignette, numéro, noms, réf.
  photo, état de la position réelle, indication « placée par les élèves », cases de mesures.
- **FIC-02** **Nouvelle fiche** ouvre le formulaire d'édition. **Modifier** ou un clic sur la ligne
  ouvre une fiche existante.
- **FIC-03** Une case « élèves » montre ou masque chaque fiche. **Tout afficher aux élèves** et
  **Tout masquer** agissent d'un coup. Un compteur indique « x / y visible(s) ».
- **FIC-04** Les numéros sont automatiques : 1, 2, 3… dans l'ordre de la liste, en ne comptant que
  les fiches visibles. Une fiche masquée affiche « – ».
- **FIC-05** Les flèches ▲ ▼ changent l'ordre. **Ranger par réf. photo** trie dans l'ordre naturel
  (2, 5a, 5b, 10), les fiches sans réf. à la fin.
- **FIC-06** 🗑 supprime définitivement une fiche, ses photos et le travail des élèves associé,
  après confirmation. Le message rappelle qu'il suffit de décocher pour seulement masquer.
- **FIC-07** **Supprimer les fiches masquées** les retire d'un coup, après confirmation avec la liste
  des fiches concernées.
- **FIC-08** La recherche fonctionne comme côté élèves (`LIS-02`).

### 5.3 Édition d'une fiche — `EDI`

Code : [`views/editor.js`](../src/js/views/editor.js)

- **EDI-01** Champs : visible élèves, réf. photo, nom commun, nom scientifique, famille, date
  d'observation, les cinq besoins, les trois mesures, description, observations, photos et vidéos.
- **EDI-02** Rien n'est modifié avant **Enregistrer**. En cas d'annulation, les photos ajoutées sont
  retirées et les photos enlevées sont conservées.
- **EDI-03** Une fiche doit avoir au moins un nom (commun ou scientifique).
- **EDI-04** Une réf. photo déjà utilisée sur la carte demande une confirmation, sans interdire.
- **EDI-05** Une nouvelle fiche prend la date du jour.
- **EDI-06** Une barre de 24 émojis insère l'émoji choisi à l'emplacement du curseur, dans le dernier
  champ utilisé.
- **EDI-07** Les zones de texte s'agrandissent avec leur contenu.
- **EDI-08** Plusieurs photos et vidéos s'ajoutent en une fois. Chacune peut être retirée. ⚠️ E-05
- **EDI-09** On choisit la photo servant de vignette ; à défaut, c'est la première.
- **EDI-10** Les mesures saisies ici vont dans la progression de ce navigateur, pas dans la fiche :
  elles ne sont pas publiées.
- **EDI-11** **Supprimer la fiche** est disponible en bas du formulaire, après confirmation.

### 5.4 Positions réelles — `POS`

Code : [`views/map.js`](../src/js/views/map.js)

- **POS-01** **Placer / Replacer** puis un clic sur le plan définit la position réelle. On peut aussi
  glisser la ligne d'une fiche sur le plan.
- **POS-02** Une position réelle est un carré bleu numéroté, déplaçable à la souris ou au doigt.
- **POS-03** En gestion, le plan montre les positions réelles, les placements et les pointillés. Les
  placements n'y sont pas déplaçables. Un clic sur un repère ouvre l'édition.
- **POS-04** Un compteur indique le nombre de fiches et de positions réelles définies.

### 5.5 Import et export par tableur — `TAB`

Code : [`spreadsheet.js`](../src/js/spreadsheet.js), [`xlsx.js`](../src/js/xlsx.js)

- **TAB-01** L'import accepte `.xlsx` (première feuille uniquement) et `.csv`, vers la carte affichée.
- **TAB-02** Le CSV est lu souplement : séparateur `;`, `,` ou tabulation détecté, UTF-8 ou
  Windows-1252.
- **TAB-03** Les titres de colonnes sont reconnus sans tenir compte des accents ni des majuscules, avec
  des variantes (« N° photo », « Luminosité »…). Il faut au moins une colonne de nom.
- **TAB-04** Une confirmation résume l'import avant de l'appliquer : nouvelles fiches, fiches
  complétées, lignes sans nom ignorées, colonnes non reconnues.
- **TAB-05** Une fiche existante (même réf. photo, sinon même nom) est **complétée** au lieu d'être
  créée en double, même si une réf. est en double. Une cellule vide n'efface rien.
- **TAB-06** Les dates acceptent `JJ/MM/AAAA`, `AAAA-MM-JJ` et le format de série d'Excel. « non, no, n,
  0, false, faux » rendent la fiche invisible. Les positions sont ramenées entre 0 et 100, et ignorées si
  X ou Y manque.
- **TAB-07** Après l'import, les fiches sont rangées par réf. photo si au moins l'une en a une.
- **TAB-08** Les photos ne s'importent pas : elles s'ajoutent ensuite par **Modifier**.
- **TAB-09** **Télécharger le modèle** fournit un CSV d'exemple avec les 18 colonnes.
- **TAB-10** **Exporter les fiches (CSV)** produit le même format, masquées et mesures comprises, et se
  réimporte (positions arrondies à deux décimales, sans les photos). Il n'y a pas d'export `.xlsx`.

### 5.6 Séance en cours — `SEA`

Code : [`views/admin/fiches.js`](../src/js/views/admin/fiches.js)

- **SEA-01** Une ligne indique si l'exercice est vérifié ou ouvert aux élèves.
- **SEA-02** **Voir les écarts** ouvre la fenêtre des résultats, avec ses trois téléchargements. Elle ne
  concerne que le travail présent **sur ce navigateur**. ⚠️ Q-02
- **SEA-03** **Rouvrir l'exercice** permet de nouveau de déplacer les placements, après confirmation.
- **SEA-04** **Nouvelle séance** efface les placements et les mesures de la carte affichée et les noms
  des élèves, après confirmation. Les fiches et les positions réelles sont conservées. Elle agit sur
  un seul navigateur à la fois.

### 5.7 Cartes — `CAR`

Code : [`views/admin/maps.js`](../src/js/views/admin/maps.js)

- **CAR-01** Un projet contient une ou plusieurs cartes, chacune avec ses fiches, ses positions et sa
  progression. ⚠️ E-01
- **CAR-02** **Ajouter une carte** demande une image et un nom. **Renommer** et **Afficher** sont
  disponibles sur chaque carte.
- **CAR-03** **Changer l'image** prévient que les positions ne correspondront plus si le cadrage change.
- **CAR-04** **Supprimer** retire la carte et ses fiches, après confirmation. La dernière carte ne peut
  pas être supprimée.
- **CAR-05** **Échelle** (facultative) : la largeur réelle du terrain, en mètres. Les écarts sont alors
  donnés en mètres.
- **CAR-06** Une image de plan trop lourde est réduite automatiquement (voir section 9).

### 5.8 Apparence — `APP`

Code : [`themes.js`](../src/js/themes.js), [`views/admin/settings.js`](../src/js/views/admin/settings.js)

- **APP-01** Cinq thèmes (Végétal, Océan, Terre, Ardoise, Lavande), ou une couleur au choix dont
  l'application déduit toute la palette, en l'assombrissant si le texte blanc devient illisible.
- **APP-02** Six icônes : feuille, plante, montagne, vague, boussole, livre. L'icône sert aussi aux
  fiches sans photo.
- **APP-03** Le thème est enregistré dans le projet : les élèves le voient, et il s'applique au compte
  rendu.
- **APP-04** Les couleurs ayant un sens ne changent jamais : rouge pour les élèves, bleu pour la position
  réelle, couleurs des résultats.

### 5.9 Identification par IA (facultative) — `IAI`

Code : [`ai.js`](../src/js/ai.js)

- **IAI-01** L'enseignant règle l'adresse d'un service qu'il fournit lui-même. Sans adresse, le bouton
  n'apparaît pas.
  _Dans l'application d'origine seulement : un cours de l'espace enseignant n'a pas cette identification (EV-33)._
- **IAI-02** Le service reçoit jusqu'à 4 photos de la fiche et renvoie une proposition en JSON. Le
  contrat est décrit en tête de [`ai.js`](../src/js/ai.js).
- **IAI-03** Seuls les champs **vides** du formulaire sont remplis, et l'enseignant vérifie avant
  d'enregistrer.
- **IAI-04** Aucune clé d'API ne doit figurer dans l'application : l'adresse est visible par quiconque lit
  le projet.

---

## 6. Projet et diffusion

### 6.1 Cycle de vie du projet — `PRJ`

Code : [`views/admin/project.js`](../src/js/views/admin/project.js), [`project-io.js`](../src/js/project-io.js)

- **PRJ-01** Le nom du projet est modifiable et sert de titre à la page.
- **PRJ-02** L'onglet Projet indique s'il reste des modifications non enregistrées ou non publiées, ou
  la date du dernier enregistrement.
- **PRJ-03** **Ouvrir un projet** accepte un `.html` ou un `.json`, y compris des anciennes versions. Une
  confirmation résume le contenu et prévient si des modifications seraient perdues. La progression du
  fichier remplace celle du navigateur.
- **PRJ-04** **Nouveau projet vide** crée une carte avec le plan d'exemple, conserve le thème et le mot de
  passe, et efface les noms des élèves. Il mène à l'onglet Cartes.
- **PRJ-05** Chaque projet a un identifiant stable, qui le relie à la progression des élèves, et une
  révision qui change à chaque enregistrement ou publication.

### 6.2 Enregistrement en fichier — `FIL`

Code : [`project-io.js`](../src/js/project-io.js), [`store.js`](../src/js/store.js)

- **FIL-01** **Enregistrer le projet (.html)** crée un fichier autonome contenant l'application et tout le
  projet, photos et progression comprises. Disponible seulement dans la version construite.
- **FIL-02** **Données du projet (.json)** exporte le même contenu, sans l'application. ⚠️ E-07
- **FIL-03** Un enregistrement complet efface l'indication de modifications en attente.
- **FIL-04** **Version pour les élèves** exporte le projet sans les fiches masquées ni l'adresse de l'IA,
  avec l'état « vérifié » remis à zéro. ⚠️ E-14
- **FIL-05** La version élèves propose d'effacer les placements (coché par défaut) et les mesures (décoché
  par défaut).

### 6.3 Choix du projet au démarrage — `DEM`

Code : [`project-io.js`](../src/js/project-io.js)

- **DEM-01** Priorité : serveur (seulement en `http(s)://`) › projet intégré au fichier › projet du
  navigateur › données d'une ancienne version › nouveau projet avec le plan d'exemple.
- **DEM-02** Projet arrivant **identique** (même identifiant) à celui du navigateur : installé s'il est
  plus récent et sans modification locale, progression conservée. Sinon, la version du navigateur est
  gardée. ⚠️ E-16
- **DEM-03** Projet arrivant **différent** : installé directement, ou après confirmation si le navigateur
  contient des modifications. Un refus est mémorisé pour cette révision.
- **DEM-04** La progression existante n'est jamais écrasée par une nouvelle version du même projet.

### 6.4 Publication en ligne — `PUB`

Code : [`project-io.js`](../src/js/project-io.js)

- **PUB-01** **Publier les modifications** envoie le projet complet au serveur, sans la progression. Le
  bouton n'apparaît que si le projet vient du serveur. ⚠️ E-02
- **PUB-02** Le mot de passe de publication est demandé dans une fenêtre masquant la saisie, et conservé
  pour la session s'il est accepté.
- **PUB-03** Les élèves reçoivent la nouvelle version en rechargeant la page, sans perdre leur travail.
- **PUB-04** Tant que rien n'est publié, un bandeau en gestion rappelle que les modifications ne sont que
  dans ce navigateur, et propose **Publier** et **Reprendre la version en ligne**.
- **PUB-05** Sans publication possible (hébergement statique), le bandeau propose de télécharger
  `project.json` à déposer à la main. ⚠️ E-07
- **PUB-06** Le bandeau prévient si une autre version a été publiée depuis. ⚠️ E-10, E-13

### 6.5 Plusieurs projets — `MUL`

Code : [`project-io.js`](../src/js/project-io.js), [`routes/legacy.mjs`](../server/routes/legacy.mjs)

- **MUL-01** L'adresse `/?projet=nom` charge `projets/nom.json` et publie vers ce même fichier. Noms
  autorisés : lettres, chiffres et tirets (61 caractères au plus, sans tiret au début). ⚠️ E-12
- **MUL-02** Un navigateur affiche et stocke un seul projet à la fois. En changer remplace le précédent,
  mais la progression de chaque projet reste conservée.

---

## 7. Serveur et déploiement

### 7.1 Serveur — `SRV`

Code : [`server/`](../server/) · Tests : [`tests/`](../tests/) (`server`, `server-start`, `http`, `security`, `db`,
`routes-legacy`)

- **SRV-01** Node 24, sans dépendance. Il sert l'application, les projets et reçoit les
  publications.
- **SRV-02** Routes : `GET /config.json`, `GET /project.json`, `GET /projets/<nom>.json`,
  `PUT /api/project[?projet=nom]`, `GET /*` pour les fichiers de l'application. Les comptes ont leurs routes sous
  `/api/auth` et `/api/admin`, décrites dans [`ARCHITECTURE.md`](ARCHITECTURE.md).
- **SRV-03** Réglages : `PORT`, `ROOT`, `DATA_DIR`, `PUBLISH_PASSWORD`, `MAX_BODY_MB`, `TRUST_PROXY`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` (détail dans le
  [README](../README.md)).
- **SRV-04** Sans `PUBLISH_PASSWORD`, la publication est désactivée et l'application ne la propose pas.
- **SRV-05** Une publication exige le mot de passe (`Authorization: Bearer`), comparé à temps constant.
- **SRV-06** Les échecs répétés sont bloqués pour le client concerné (voir section 9). Derrière un proxy, il
  faut `TRUST_PROXY=1` pour que le serveur reconnaisse le client.
- **SRV-07** Le serveur refuse un contenu qui n'a pas le format d'un projet, ou trop volumineux : le client reçoit
  alors une réponse 413, sans que la connexion soit coupée.
- **SRV-08** L'écriture est atomique, et la version précédente est sauvegardée dans `backups/`, séparément pour
  chaque projet.
- **SRV-09** Le serveur refuse tout chemin sortant de `ROOT` et de `DATA_DIR`, et les noms de projet
  invalides. Les sauvegardes ne sont pas accessibles par une adresse.
- **SRV-10** Les pages, les scripts, les styles et les projets sont envoyés sans mise en cache durable, pour que
  les mises à jour arrivent tout de suite. Les autres fichiers sont mis en cache une heure.
- **SRV-15** Un fichier envoyé est contrôlé sur son contenu : JPEG, PNG, WebP, MP4 ou WebM. Le SVG et le HEIC sont
  refusés. Un même contenu n'occupe qu'un fichier, partagé entre les comptes qui l'utilisent.
- **SRV-16** Un fichier qu'aucun brouillon ni aucune version publiée de son compte ne cite est oublié après un jour.
  Il est effacé quand plus aucun compte ne l'utilise.
- **SRV-17** Les vidéos se lisent par plages d'octets : Safari ne les lit pas autrement.
- **SRV-11** Les fichiers et les réponses JSON portent un ETag : un navigateur qui a déjà la bonne version ne la
  retélécharge pas (réponse 304). Le texte de 1 Ko ou plus part compressé en gzip si le navigateur l'accepte.
- **SRV-12** Les données du serveur sont dans une base SQLite, `DATA_DIR/app.db`. Son schéma évolue par migrations
  numérotées, appliquées au démarrage, et le serveur refuse une base plus récente que son code.
- **SRV-13** Une copie de la base est faite chaque jour dans `backups/`. Les 14 dernières sont conservées, sans
  toucher aux sauvegardes des projets.
- **SRV-14** Le serveur s'arrête proprement à la demande (`docker stop`), en fermant la base.

### 7.2 Construction et déploiement — `DEP`

Code : [`scripts/`](../scripts/), [`Dockerfile`](../Dockerfile),
[`docker-compose.yml`](../docker-compose.yml)

- **DEP-01** `npm run build` produit `dist/index.html` : un seul fichier contenant le CSS, le JavaScript, les polices et
  le plan d'exemple. Il produit aussi les pages des espaces (`prof.html`, `admin.html`, `compte.html`), chacune d'un
  seul tenant et avec son seul code, en dehors des polices, servies par le site (`HOR-05`).
- **DEP-02** `scripts/build.mjs --embed <projet> --out <fichier>` produit un fichier autonome contenant un
  projet.
- **DEP-03** `npm run convert` convertit un ancien `.html` ou `.json` au format actuel.
- **DEP-04** L'image Docker construit l'application, puis la sert (Node 24 Alpine) sans outils de
  développement. Le volume `/data` contient la base, les projets et les sauvegardes.
- **DEP-05** Le dépôt et l'image ne contiennent aucun projet. Sur un volume `/data` vide, l'application démarre
  sur un nouveau projet local, et ne propose de publier qu'une fois un `project.json` déposé à la main.
- **DEP-06** `docker-compose.yml` fait tourner le conteneur en utilisateur non root (`1001:1001`), sans
  port publié, sur le réseau externe `traefik_network`. `PUBLISH_PASSWORD` vient du fichier `.env`,
  exclu de Git (modèle : `.env.example`), tout comme `TRUST_PROXY`. ⚠️ E-15
- **DEP-07** Le HTTPS est assuré par un proxy placé devant le serveur.
- **DEP-08** Un hébergement statique suffit, sans publication : `index.html`, `project.json` et, si
  besoin, `config.json`.

---

## 8. Exigences transverses

### 8.1 Enregistrement dans le navigateur — `STO`

Code : [`store.js`](../src/js/store.js), [`db.js`](../src/js/db.js)

- **STO-01** Tout est enregistré automatiquement dans le navigateur : projet, photos et vidéos,
  progression.
- **STO-02** Les écritures sont regroupées, et forcées quand on quitte ou masque l'onglet.
- **STO-03** Si une écriture échoue (disque plein…), un message l'indique.
- **STO-04** Si le stockage est indisponible (navigation privée…), un bandeau permanent le signale et
  l'application reste utilisable, sans rien conserver.

### 8.2 Sécurité et confidentialité — `SEC`

- **SEC-01** `project.json` est **public**, positions réelles et fiches masquées comprises : il ne doit
  rien contenir de confidentiel. ⚠️ Q-03
- **SEC-02** La seule protection réelle est le mot de passe de publication, vérifié par le serveur.
- **SEC-03** Aucun secret ne doit figurer dans le projet ni dans le code.
- **SEC-04** Tout texte venant d'un projet ou d'un utilisateur est échappé avant d'être affiché.
- **SEC-05** Aucune donnée personnelle des élèves n'arrive sur le serveur (`PRI-04`). E-08 est corrigé pour les polices dans la branche
  de la refonte

### 8.3 Interface — `INT`

Code : [`css/app.css`](../src/css/app.css), [`views/panel.js`](../src/js/views/panel.js)

- **INT-01** L'interface est entièrement en français.
- **INT-02** Sur grand écran : le plan à gauche, tenant dans la hauteur de la fenêtre, et un panneau de
  420 px à droite, défilant à la hauteur du plan.
- **INT-03** À 900 px de large ou moins : le plan au-dessus, la liste en dessous.
- **INT-04** La liste devient plus compacte quand les fiches sont nombreuses (voir section 9).
- **INT-05** Les repères se manipulent à la souris et au doigt. Sur écran tactile, le bouton « Placer sur
  le plan » remplace le glisser-déposer depuis la liste.
- **INT-06** Accessibilité : libellés pour les lecteurs d'écran, annonce des messages, respect de la
  réduction des animations, police Atkinson Hyperlegible. ⚠️ E-15, Q-08

### 8.4 Compatibilité avec les anciennes versions — `COM`

Code : [`model.js`](../src/js/model.js), [`db.js`](../src/js/db.js) · Tests :
[`tests/model.test.js`](../tests/model.test.js)

- **COM-01** Le format actuel des projets est la version 3 (décrite dans
  [`ARCHITECTURE.md`](ARCHITECTURE.md)). Les formats antérieurs sont convertis à l'ouverture.
- **COM-02** Lors de la conversion, l'identifiant du projet est déduit de la première carte (il reste donc
  stable d'un fichier à l'autre), et les placements sont extraits des fiches vers la progression.
- **COM-03** Les fichiers `.html` des anciennes versions restent ouvrables.
- **COM-04** Au premier lancement, les données laissées dans le navigateur par les versions de 2026 sont
  récupérées, sans que les anciennes bases soient supprimées.
- **COM-05** Les anciens mots de passe restent valables.

### 8.5 Qualité — `QUA`

- **QUA-01** `npm test` couvre le modèle, le tableur, les mots de passe, le serveur, la base et les comptes.
  `npm run test:e2e` vérifie les écrans de compte dans un vrai navigateur. `npm run test:coverage` lance le tout et
  mesure la couverture par fichier. Les chiffres à jour sont dans la
  [feuille de route](FEUILLE_DE_ROUTE.md#11-tests-et-couverture). ⚠️ E-09
- **QUA-02** Le code est formaté avec `prettier` (`npm run format`).
- **QUA-03** `npm run dev` sert `src/` directement, sans construction, avec ses données dans `.dev-data/`, jamais
  dans `data/`.

---

## 9. Règles de calcul et valeurs de référence

**Numérotation.** 1, 2, 3… dans l'ordre de la liste, en ne comptant que les fiches visibles. Le numéro
n'est pas stocké.

**Titre d'une fiche.** Le nom commun, sinon le nom scientifique, sinon « Fiche sans nom ».

**Écart.** Distance entre le placement et la position réelle, en % de la **largeur** du plan, en
corrigeant le rapport largeur / hauteur de l'image. Elle est convertie en mètres si l'échelle est connue
(une décimale sous 10 m, sinon un entier).

**Score.** `bien placées / fiches notées`. Les fiches notées sont les fiches visibles ayant une position
réelle, placées ou non. Les fiches « Proche » sont indiquées à part et ne comptent pas comme bien placées.

| Valeur                                  | Actuel                      | Défini dans                 |
| --------------------------------------- | --------------------------- | --------------------------- |
| Seuil « Bien placée »                   | écart ≤ 4 % de la largeur   | `model.js` (`THRESHOLDS`)   |
| Seuil « Proche »                        | écart ≤ 10 % de la largeur  | `model.js` (`THRESHOLDS`)   |
| Image de plan : réduction               | dès 2600 px ou 1,5 Mo       | `util.js` (`prepareImage`)  |
| Image de plan : compression             | JPEG, qualité 0,88          | `util.js` (`prepareImage`)  |
| Photos et vidéos de fiche               | gardées telles quelles      | `views/editor.js`           |
| Compte rendu                            | 1600 px de large, JPEG 0,9  | `report.js`                 |
| Regroupement des écritures              | 250 ms                      | `store.js`                  |
| Mot de passe de gestion                 | 4 caractères au moins       | `views/admin/settings.js`   |
| Photos envoyées à l'IA                  | 4 au plus                   | `ai.js`                     |
| Liste compacte                          | plus de 6 fiches            | `views/panel.js`            |
| Liste très compacte                     | plus de 14 fiches           | `views/panel.js`            |
| Taille maximale d'un projet publié      | 100 Mo (`MAX_BODY_MB`)      | `server/index.mjs`          |
| Sauvegardes conservées                  | 20 par projet               | `server/routes/legacy.mjs`  |
| Copies de la base conservées            | 14, une par jour            | `server/db.mjs`             |
| Blocage de la publication               | 10 échecs, 10 minutes       | `server/routes/legacy.mjs`  |
| Compression (gzip)                      | texte de 1 Ko ou plus       | `server/http.mjs`           |
| Mot de passe d'un compte                | 8 à 200 caractères          | `server/auth.mjs`           |
| Lien d'invitation                       | 7 jours, une seule fois     | `server/auth.mjs`           |
| Lien de réinitialisation                | 72 heures, une seule fois   | `server/auth.mjs`           |
| Session                                 | 30 jours                    | `server/auth.mjs`           |
| Blocage de la connexion                 | 10 échecs par compte et adresse IP, 50 par adresse IP, 10 minutes | `server/routes/auth.mjs` |

---

## 10. Écarts constatés

Différences entre ce que le projet annonce et ce qu'il fait réellement, relevées en écrivant ce document.
Elles ont été établies **à la lecture du code**, sauf E-05, E-16 et E-17 (constatés sur le serveur). Rien n'a été testé
dans un navigateur : E-01, E-02 et E-07 sont à confirmer en conditions réelles. E-04, E-11 et E-17 sont corrigés à ce
jour, E-05 et E-09 en partie.

### Priorité haute

- **E-01 — Les élèves ne peuvent pas changer de carte.** Le changement de carte n'existe que dans
  Gestion › Cartes. Les élèves restent sur la carte affichée par l'enseignant au moment de la
  publication : les autres sont inaccessibles. _Lié à `CAR-01`._
- **E-02 — « Ouvrir un projet puis Publier » n'aboutit pas.** Le README décrit ce parcours, mais ouvrir
  un fichier fait disparaître le bouton Publier (le projet n'est plus considéré comme venant du serveur).
  Au rechargement, le bouton ne revient que si le fichier est le même projet, en plus récent. Dans les
  autres cas sans modification locale, le projet ouvert est remplacé par la version du serveur. _Lié à
  `PUB-01`, `PRJ-03`._
- **E-03 — Le projet livré n'est pas prêt pour une séance.** Dans `data/project.json`, aucun mot de passe
  n'est défini : `admin` ouvre la gestion, où toutes les positions réelles sont visibles. Et seules 3 des
  13 fiches visibles ont une position réelle : le score porte donc sur 3 fiches. _Lié à `ACC-02`,
  `VER-04`._

### Priorité moyenne

- **E-04 — Le blocage des échecs de publication est commun à tout le monde derrière un proxy.** Le serveur
  compte les échecs par adresse IP, mais derrière Traefik il ne voit que celle du proxy. Dix erreurs, de
  n'importe qui, bloquent donc aussi l'enseignant pendant 10 minutes. Le README annonce « par IP ». _Lié à
  `SRV-06`._ **Corrigé :** avec `TRUST_PROXY=1`, le client est reconnu par la dernière valeur de
  `X-Forwarded-For`. Reste à le vérifier derrière le vrai proxy, à la mise en service.
- **E-05 — Le projet est retéléchargé en entier à chaque ouverture.** Le serveur envoie `project.json`
  sans compression ni `ETag` ou `Last-Modified` (vérifié sur le serveur Node, sans le proxy : 4,15 Mo à
  chaque chargement, pour chaque élève, et jusqu'à 100 Mo autorisés). Les photos et vidéos des fiches ne
  sont pas réduites et s'ajoutent au même fichier JSON. C'est coûteux sur le terrain, en réseau mobile.
  _Lié à `EDI-08`, `SRV-10`._ **Corrigé en partie :** compression et ETag sont en place (`SRV-11`). Réduire les
  photos et les sortir du JSON reste à faire (`LEG-01`, `LEG-02`).
- **E-06 — Le mode hébergé ne fonctionne pas sans réseau.** Il n'y a ni service worker ni manifeste :
  sans connexion, recharger la page échoue, alors que l'usage prévu est la sortie de terrain.
  `ARCHITECTURE.md` annonce « Tout fonctionne hors ligne », ce qui n'est vrai que pour le fichier autonome.
  _Lié à `PRI-05`, Q-04._ **Corrigé dans la branche, étape 6.**
- **E-07 — Un `project.json` déposé à la main contient la progression.** Contrairement à la publication,
  le téléchargement inclut placements, mesures et état « vérifié » de ce navigateur. Un nouvel élève en
  hérite à sa première ouverture. _Lié à `FIL-02`, `PUB-05`._
- **E-08 — Les polices viennent de Google.** La page charge Atkinson Hyperlegible et Fraunces depuis Google
  Fonts, y compris dans le fichier autonome. Ouvrir la page en ligne transmet donc l'adresse IP de
  l'élève à un tiers. C'est en tension avec `PRI-01` et `SEC-05`, et à regarder dans un contexte scolaire
  (RGPD). Hors ligne, les polices du système prennent le relais. **Corrigé dans la branche, étape 6 :** le site sert ses polices.
- **E-09 — La partie la plus risquée n'est pas testée.** Aucun test ne couvre le choix du projet au
  démarrage et la publication côté navigateur (`project-io.js`), le stockage (`store.js`), les rendus
  (`report.js`), la lecture `.xlsx` (`xlsx.js`) ni les vues. _Lié à `QUA-01`._ **Corrigé en partie :** le serveur est
  couvert et l'intégration continue en place. Le code du navigateur reste à couvrir (`QUA-07`).

### Priorité basse

- **E-10 — Publication : le dernier a raison.** Le serveur ne détecte pas qu'une autre version a été publiée
  entre-temps. Les sauvegardes permettent de récupérer une version écrasée, à la main.
- **E-11 — Sauvegardes mélangées entre projets aux noms proches.** Le tri se fait sur le début du nom : les
  sauvegardes de `rocaille-2` comptent dans les 20 de `rocaille`, et une sauvegarde de l'un peut être
  supprimée à la place de celle de l'autre. _Lié à `SRV-08`._ **Corrigé :** les noms sont comparés en entier. Il
  n'existe toujours aucune restauration dans l'application.
- **E-12 — Un projet nommé ne se crée pas depuis l'application.** Si `projets/nom.json` n'existe pas encore,
  le bouton Publier n'apparaît pas : il faut déposer le fichier à la main. Aucune liste des projets
  n'existe non plus. _Lié à `MUL-01`._
- **E-13 — L'alerte « une autre version a été publiée » n'arrive qu'au chargement de la page.** Elle ne
  détecte pas une publication faite pendant la session. _Lié à `PUB-06`._
- **E-14 — La version élèves garde plus que ce qui est annoncé.** Le code annonce « sans les réglages
  enseignant », mais le fichier contient encore l'empreinte du mot de passe et les positions réelles (ces
  dernières sont nécessaires à la vérification hors ligne). _Lié à `FIL-04`, Q-03._
- **E-15 — Écarts mineurs de documentation et d'accessibilité.**
  - Le README dit de changer `PUBLISH_PASSWORD` dans `docker-compose.yml`, or il vient du `.env`. Il ne
    mentionne ni Traefik ni le réseau externe. Le routage est défini hors du dépôt, dans la configuration de
    Traefik.
  - Placer une fiche exige un pointeur : il n'y a pas d'alternative au clavier.
  - La cible de construction annonce Firefox 100 et Safari 15.4, mais le compte rendu utilise
    `CanvasRenderingContext2D.roundRect`, disponible à partir de Firefox 112 et Safari 16.
- **E-16 — « Plus récent » dépend de l'horloge de l'appareil.** Le navigateur choisit la version à garder en
  comparant des dates produites par les appareils, pas par le serveur. Le 1er novembre, une publication
  portait l'heure 15 h 16 alors que le serveur l'a reçue à 15 h 04. Un appareil en avance peut donc refuser
  une version publiée ensuite par un autre. _Lié à `DEM-02`, EV-04._
- **E-17 — Les publications modifient un fichier suivi par Git.** `data/project.json` est à la fois le projet
  en service et un fichier du dépôt : chaque publication le fait apparaître comme modifié. Il peut alors
  partir dans un commit par erreur ou gêner un `git pull`. **Corrigé :** `data/` est sorti du dépôt, et le projet
  d'exemple de l'image. _Lié à `DEP-05`._

---

## 11. Décisions à prendre

Ces choix ne se déduisent pas du code. Les pistes sont des suggestions.

### Questions ouvertes

- **Q-01 — Outil botanique ou outil générique ?** Le dossier s'appelle Cartopoint, l'application Inventaire
  botanique. Les thèmes sont annoncés « pour d'autres sujets que les plantes », mais les besoins, les
  mesures, les libellés et la demande à l'IA restent botaniques et codés en dur. _À trancher en premier :
  ce choix conditionne le nom, le vocabulaire et le modèle de données. Piste : ne généraliser que s'il
  existe un vrai second usage._
  **Tranchée le 2 novembre 2026 pour le nom et les valeurs par défaut (EV-34) :** le site s'appelle Cartopoint. Un nouveau cours
  s'appelle Cartopoint, sa carte Plan, sa couleur reste le vert et son icône est un repère. **Reste botanique, faute de
  décision :** les champs d'une fiche (nom scientifique, famille, exposition, arrosage, sol, chaleur, entretien) et les
  mesures, car ils touchent le modèle de données et le travail du premier enseignant. L'utilisateur a reporté ce point le 2 novembre : « pour
  le moment il lui faut un truc qui fonctionne ».
  L'identifiant `inventaire-botanique` des fichiers et du stockage du navigateur ne change pas : les fichiers existants
  doivent continuer à s'ouvrir.
- **Q-06 — Les seuils de correction doivent-ils être réglables ?** Ils sont fixes (4 % et 10 %), quelle que
  soit la taille du terrain : sur 180 m de large, par exemple, cela fait environ 7 m et 18 m.
- **Q-07 — Sous quelle licence ?** `LICENSE` contient la GPL v3, alors que `package.json` indique
  `UNLICENSED`. Il faut choisir l'une des deux.
- **Q-08 — Quelles cibles officielles ?** Navigateurs et appareils pris en charge (voir E-15), et niveau
  d'accessibilité visé : le RGAA s'impose si l'application est diffusée par un établissement public.

### Décisions prises

Toutes le 1er novembre 2026.

- **Q-02 — L'enseignant doit-il recevoir le travail des élèves automatiquement ?** Oui. Le rendu envoie les
  réponses au serveur et l'enseignant les retrouve dans l'historique du cours (`HIS-01` à `HIS-04`).
- **Q-03 — Les réponses doivent-elles être protégées ?** Oui, jusqu'à la fin du cours. Les
  positions réelles ne sont plus envoyées avec le cours (`CRG-01`). Elles restent dans l'export de secours
  (`EXP-02`).
- **Q-04 — Le mode hébergé doit-il fonctionner hors ligne ?** Oui, une fois la page récupérée (`HOR-01`).
- **Q-05 — Les mesures doivent-elles être figées après la vérification ?** Oui : une fois le travail rendu, tout
  est figé, placements et mesures (`HOR-06`).
- **Q-09 — Un seul enseignant ou plusieurs ?** Plusieurs, chacun dans son espace (`ENS-03`).
- **Q-10 — Que voit l'enseignant pendant un lancement ?** Un bouton pour afficher le QR code, les noms des
  élèves qui ont commencé, et s'ils ont fini ou non (`SUI-01`). L'avancement en direct est reporté (EV-13).
- **Q-11 — Comment un enseignant obtient-il son compte ?** L'admin distribue des liens de création de compte,
  avec e-mail et mot de passe (`ADM-02`, `ADM-03`).
- **Q-12 — Que devient le fichier autonome ?** Il reste comme export de secours (`EXP-01`).
- **Q-13 — Un cours est-il le projet actuel ?** Oui, et il peut être relancé pour plusieurs classes (`COU-07`).
- **Q-14 — Comment se termine un lancement ?** L'enseignant le termine : le QR code, propre à chaque lancement,
  cesse alors de fonctionner (`COU-06`, `COU-08`).
- **Q-15 — Un élève peut-il rendre après la fin du cours ?** Oui. L'enseignant est prévenu s'il reste des élèves
  non finis (`COU-10`), et un rendu tardif est accepté et signalé (`HOR-07`).
- **Q-16 — Que devient le compte rendu JPG ?** On le garde pour le moment, avec les placements et le résultat de
  chaque fiche, sans les positions réelles (`CRG-10`).
- **Q-17 — Combien de temps garde-t-on les noms des élèves ?** Jusqu'à ce que l'enseignant supprime le lancement,
  et un an au plus (`HIS-05`).
- **Q-18 — Que fait l'admin, au-delà des liens ?** L'admin voit les enseignants et des chiffres sur chacun, peut
  provoquer une réinitialisation de mot de passe, désactiver un compte puis le supprimer, sans accéder au contenu
  des cours (`ADM-04` à `ADM-07`, `ADM-10`).
- **Q-19 — Peut-on modifier un cours pendant un lancement ?** Oui, mais un lancement garde la version publiée à
  son ouverture : les modifications valent pour le suivant (`COU-11`).
- **Q-20 — La correction arrive-t-elle dès le rendu, ou à la fin du cours ?** À la fin du cours. L'élève clique
  sur Terminer, ce qui notifie l'enseignant et envoie ses réponses s'il a du réseau (`HOR-08`). Il reçoit la
  correction quand l'enseignant clique sur « Terminer le cours », s'il a du réseau et que sa page est toujours
  ouverte (`CRG-02`, `CRG-06`).
- **Q-21 — L'enseignant peut-il exporter l'historique dans un tableur ?** Oui : un CSV par lancement, avec sa ligne
  de moyenne (`HIS-08`).

---

## 12. Fonctionnement cible

Ce qui suit **n'est pas encore en place**. Une fois livrées, ces exigences rejoignent les sections 4 à 8
et remplacent celles qu'elles contredisent. Les questions encore ouvertes (Q-06, Q-07 et Q-08) ne bloquent pas ce fonctionnement.

**Parcours visé**

1. Au premier lancement de l'application, l'admin se connecte et distribue des liens de création de compte
   aux enseignants.
2. L'enseignant crée son compte, prépare son cours dans son espace et le publie quand il est prêt.
3. Il lance le cours et affiche un QR code, avec un code court en dessous.
4. Les élèves scannent le QR code ou tapent le code, puis indiquent leur nom et prénom, sans créer de compte.
5. Une fois la page récupérée, ils travaillent sans connexion : leur avancement reste dans le navigateur.
6. Quand il a fini, l'élève clique sur Terminer : son travail est figé, ses réponses partent vers l'enseignant
   s'il a du réseau, sinon dès que le réseau revient. En cas de problème de réseau, il peut aussi récupérer un
   fichier de réponses à donner à l'enseignant.
7. Pendant le cours, l'enseignant voit qui a commencé et qui a fini.
8. L'enseignant clique sur « Terminer le cours » : le QR code et le code cessent de fonctionner.
9. Les élèves dont la page est toujours ouverte reçoivent alors la correction complète, s'ils ont du réseau.
   Elle ne reste sur le téléphone que le temps de la page.
10. L'enseignant garde un historique de chaque cours : une ligne par élève avec ses résultats, et le détail de
    ses réponses en cliquant dessus.

**Vocabulaire**

| Terme             | Sens                                                                                           |
| ----------------- | ---------------------------------------------------------------------------------------------- |
| Espace enseignant | Partie de l'application réservée à un enseignant, séparée de celles des autres                 |
| Cours             | Ce que l'enseignant prépare et diffuse : le projet actuel, avec cartes, fiches et photos       |
| Lancement         | Une utilisation d'un cours avec une classe, de son ouverture à la fin décidée par l'enseignant |
| Code court        | Code à taper pour rejoindre un lancement, en alternative au QR code                            |
| Rendre            | Cliquer sur Terminer côté élève : le travail est figé et les réponses partent vers l'enseignant |
| Historique        | Pour un cours, ses lancements passés, avec les élèves et leurs réponses                        |

### 12.1 Comptes et espaces enseignants — `ADM`, `ENS`

Demandes : EV-01, EV-16, EV-29, EV-30, EV-31

**État :** comptes, connexion, tableau de bord et cours sont en place dans la branche `refonte-espaces-profs`, pas encore
en production.

- **ADM-01** Au premier lancement de l'application, l'admin se connecte avec un accès prévu à l'installation :
  le premier visiteur venu ne peut pas prendre ce rôle.
- **ADM-02** L'admin crée des liens de création de compte et les transmet par ses propres moyens.
  L'application n'envoie pas d'e-mail.
- **ADM-03** Un lien permet de créer un compte enseignant, avec une adresse e-mail et un mot de passe. Il ne
  sert qu'une fois.
- **ADM-04** L'admin voit la liste des enseignants, avec pour chacun la place occupée, le nombre de cours, le
  nombre de fiches et d'autres chiffres d'usage (lancements, dernière connexion).
- **ADM-05** L'admin peut provoquer la réinitialisation d'un mot de passe, en générant un lien à transmettre.
- **ADM-06** L'admin peut désactiver un compte : l'enseignant ne peut plus se connecter, ses sessions sont fermées
  et ses cours conservés. Un lancement déjà ouvert reste joignable par les élèves déjà entrés, et aucun nouvel élève n'y
  entre. Avec le bon mot de
  passe, l'enseignant lit que son compte est désactivé. Avec un mauvais, il lit le message habituel : un inconnu
  ne peut donc pas savoir si un compte existe ni s'il est désactivé.
- **ADM-07** L'admin n'accède ni au contenu des cours ni aux résultats des élèves.
- **ADM-08** L'admin est un compte à part, sans cours : une personne qui administre et enseigne a aussi un compte
  enseignant.
- **ADM-09** Si l'admin perd son mot de passe, la personne qui héberge le site obtient un lien de réinitialisation
  depuis le serveur.
- **ADM-10** L'admin peut supprimer un compte, seulement après l'avoir désactivé. Il doit recopier le mot
  `SUPPRIMER`, que le serveur vérifie aussi. Pendant 14 jours, le compte reste désactivé, garde tout son contenu et
  apparaît en rouge dans un tableau à part, où l'admin peut le restaurer : il redevient alors désactivé. L'adresse reste
  prise pendant ce temps. Passé ce délai, le compte est effacé définitivement, avec ses cours, leur historique et les
  résultats des élèves. Les copies quotidiennes de la base (`SRV-13`) gardent ces données 14 jours de plus au maximum.
- **ENS-01** Chaque enseignant a un compte personnel, qui lui donne accès à son propre espace.
- **ENS-02** L'enseignant y prépare et y retrouve ses cours.
- **ENS-03** Les espaces sont séparés : un enseignant ne peut ni voir ni modifier les cours d'un autre.
- **ENS-04** Cette séparation est vérifiée par le serveur, pas seulement par l'interface.
- **ENS-05** L'enseignant peut changer son mot de passe. Ses autres sessions sont alors fermées.

### 12.2 Publication et lancement d'un cours — `COU`

Demandes : EV-02, EV-09

- **COU-01** Tant qu'un cours n'est pas publié, les élèves n'y ont pas accès.
- **COU-02** L'enseignant publie son cours quand il le juge prêt.
- **COU-03** L'enseignant lance un cours publié depuis son espace.
- **COU-04** Pendant le cours, un bouton affiche le QR code à la classe, avec un code court à taper en dessous.
- **COU-05** Un élève rejoint le cours en scannant ce QR code ou en tapant ce code, sans compte.
- **COU-06** Le QR code et le code court sont propres à chaque lancement.
- **COU-07** Un même cours peut être relancé, par exemple pour une autre classe.
- **COU-08** L'enseignant clique sur « Terminer le cours » : le QR code et le code cessent alors de fonctionner. Un lancement
  n'expire pas tout seul.
- **COU-09** Chaque lancement repart à zéro : l'avancement d'un élève est propre au lancement, y compris sur
  un appareil partagé.
- **COU-10** S'il reste des élèves non finis, l'enseignant en est prévenu avant de terminer le cours.
- **COU-11** Un lancement garde la version publiée à son ouverture : les modifications du cours valent pour le
  lancement suivant.
- **COU-12** Un lancement accepte 200 élèves ou groupes. Seuls les essais avec un code inconnu sont limités, par adresse : une
  classe entière partage souvent la même.
- **COU-13** Revenir sur le même QR code reprend le même élève et son travail. Sur un appareil partagé, « Ce n'est pas vous ? »
  laisse entrer quelqu'un d'autre, sans le travail du précédent.

### 12.3 Élèves sans compte — `ANO`

Demande : EV-03

- **ANO-04** Un élève n'a jamais de compte. Il indique seulement son nom et son prénom en rejoignant le cours.
- **ANO-05** Le serveur conserve, pour chaque lancement, les noms des élèves et leur état (commencé ou fini),
  pour l'enseignant, y compris une fois le cours terminé.
- **ANO-06** Les noms, les états et les réponses des élèves ne sont visibles que par l'enseignant du cours : ni
  par les autres enseignants, ni par l'admin.
- **ANO-08** L'application n'écrit rien sur les élèves dans ses journaux. Les journaux du proxy restent hors de
  ce périmètre.

### 12.4 Suivi et historique — `SUI`, `HIS`

Demandes : EV-05, EV-15

- **SUI-01** Pendant le cours, l'enseignant voit les noms des élèves qui ont commencé, et s'ils ont fini ou non.
- **SUI-02** Cette liste se met à jour sans recharger la page.
- **SUI-03** L'enseignant ne voit pas l'avancement détaillé d'un élève qui n'a pas rendu (reporté : EV-13).
- **SUI-04** Une fois le cours terminé, il retrouve cette liste dans l'historique.
- **SUI-05** Quand un élève termine, l'enseignant en est notifié : l'élève passe à « fini » dans sa liste dès que
  ses réponses arrivent.
- **HIS-01** Le rendu d'un élève envoie ses réponses au serveur : placements et mesures. Le serveur les conserve
  pour l'enseignant, avec le résultat calculé.
- **HIS-02** Pour chaque cours, l'enseignant garde l'historique de ses lancements, avec la liste des élèves de
  chacun.
- **HIS-03** Chaque élève y occupe une ligne : son nom, puis ses résultats de précision et les autres données
  utiles à la correction (score, écart moyen, fiches non placées, rendu tardif…).
- **HIS-04** Un clic sur un élève affiche ses réponses en détail, fiche par fiche : placement comparé à la
  position réelle, résultat, écart et mesures.
- **HIS-05** L'enseignant peut supprimer un lancement terminé à tout moment. Sinon, il est supprimé
  automatiquement au bout d'un an.
- **HIS-06** L'enseignant peut importer dans un lancement le fichier de réponses d'un élève (`HOR-09`), y compris
  après la fin du cours. Le résultat est calculé par le serveur, et l'élève est signalé comme rendu par fichier.
  Un fichier venant d'un autre lancement est refusé.
- **HIS-07** Si les réponses d'un élève arrivent à la fois par le réseau et par fichier, une seule version est
  gardée : la première reçue.
- **HIS-08** L'enseignant peut exporter un lancement en CSV, lisible par Excel : une ligne par élève et une ligne de
  moyenne, au format français du rendu prof (`REN-04`).

### 12.5 Travail hors ligne et rendu — `HOR`

Demandes : EV-06, EV-10

- **HOR-01** Une fois la page récupérée, l'élève travaille sans connexion, y compris s'il la recharge.
- **HOR-02** Tant que ses réponses ne sont pas envoyées, son avancement est gardé dans le navigateur, même si la
  page est fermée.
- **HOR-03** Une connexion n'est nécessaire que pour rejoindre le cours, envoyer ses réponses et recevoir la
  correction.
- **HOR-04** Un envoi impossible faute de réseau ne perd rien : les réponses partent dès que le réseau revient.
- **HOR-05** L'application n'a besoin d'aucun service tiers pour s'afficher : elle sert elle-même ses polices.
- **HOR-10** La page dit à l'élève où en est sa préparation : le décompte du téléchargement, puis « ✓ Prêt pour le terrain » une fois tout
  gardé, ou ce qui manque. L'enseignant est invité à attendre ce message avant de quitter le réseau.
- **HOR-11** Les vidéos ne sont pas gardées sur l'appareil (section 9 de la feuille de route). Sans réseau, la fiche l'explique.
- **HOR-06** Dès que l'élève clique sur Terminer, ses placements et ses mesures sont figés.
- **HOR-07** Un élève peut rendre après la fin du cours : son rendu est accepté et signalé à l'enseignant.
- **HOR-08** L'élève dispose d'un bouton Terminer : son clic notifie l'enseignant et envoie ses réponses s'il a du
  réseau.
- **HOR-09** En cas de problème de réseau, l'élève qui a terminé peut télécharger un fichier de réponses à donner à
  l'enseignant. Ce fichier contient ses réponses, pas la correction.

### 12.6 Correction — `CRG`

Demandes : EV-08

- **CRG-01** Le cours envoyé aux élèves ne contient ni les positions réelles ni les fiches masquées.
- **CRG-02** La correction n'est disponible qu'une fois que l'enseignant a cliqué sur « Terminer le cours ». C'est
  le serveur qui le vérifie.
- **CRG-03** Seuls les élèves ayant rejoint ce lancement peuvent la recevoir.
- **CRG-05** Rendre remplace la vérification actuelle (`VER-01` à `VER-06`) : un élève ne se corrige plus seul
  sur son appareil.
- **CRG-06** Une fois le cours terminé, l'élève reçoit sa correction complète sur son téléphone, s'il a du réseau
  et que sa page est toujours ouverte : score, et pour chaque fiche la position réelle, le résultat et l'écart.
- **CRG-07** Un élève ne rend qu'une fois, et le serveur le vérifie : il ne peut plus modifier ses réponses.
- **CRG-08** La correction reste sur le téléphone le temps de la page. Elle résiste à un rechargement, puis
  disparaît avec les données de l'élève quand il ferme ou supprime la page. Un élève qui a fermé la page avant la
  fin du cours ne reçoit pas la correction.
- **CRG-09** Le résultat est calculé par le serveur à partir des positions réelles, pas par l'appareil de l'élève.
  Les proportions du plan sont mesurées par le navigateur de l'enseignant à la publication, telles que les élèves le verront :
  le serveur n'ouvre pas les images. Publier est refusé si un plan ne se charge pas.
- **CRG-10** Le compte rendu JPG est disponible une fois la correction reçue, avec les placements et le résultat
  de chaque fiche, sans les positions réelles.
- **CRG-11** Un élève qui n'a pas cliqué sur Terminer à la fin du cours voit son travail figé et envoyé avant
  l'affichage de la correction, et l'enseignant en est averti.
- **CRG-12** La page ouverte reçoit la correction d'elle-même, sans action de l'élève, y compris si le réseau ne
  revient qu'après la fin du cours.

### 12.7 Cours plus léger — `LEG`

Demande : EV-07

- **LEG-01** Les photos sont réduites à l'ajout, en restant lisibles. Point de départ : 1280 px de côté, JPEG
  qualité 78. Essai sur le projet actuel : les 16 photos passent de 2,71 Mo à 1,55 Mo, sans différence visible
  sur la photo examinée. À confirmer sur davantage de photos.
- **LEG-02** Objectif : un cours comme le projet actuel passe de 4,15 Mo à environ 2 Mo. Ce calcul suppose des
  photos envoyées à part du fichier du cours, sans l'encodage qui les alourdit d'un tiers.
  **Mesuré le 2 novembre :** 2,28 Mo, dont 23 Ko de contenu. Une photo de moins de 150 Ko et de moins de 1280 px reste
  telle quelle.
- **LEG-03** Les vidéos ne sont pas réduites pour l'instant.

### 12.8 Export de secours — `EXP`

Demande : EV-11

- **EXP-01** Le fichier `.html` autonome reste disponible comme export de secours, et non comme parcours
  principal.
- **EXP-02** Il contient les positions réelles, sans quoi la vérification serait impossible sans serveur : les
  exigences de la section 12.6 ne s'y appliquent pas.

### 12.9 Publication des fiches

Demande : EV-04. L'ancienne publication a pu échouer avec un message illisible, qui cachait la vraie cause.

**À respecter par `COU-02` :** une erreur de publication ou d'enregistrement s'affiche toujours en clair, ne disparaît pas toute seule, et n'écrit jamais « undefined ».

### 12.10 Exigences actuelles à revoir

- `ACC-01` à `ACC-06` et `SRV-05`, `SRV-06` : le mot de passe de gestion et le mot de passe unique de
  publication laissent place aux comptes.
- `ELE-01` à `ELE-04` : le nom est demandé pour rejoindre le cours, plus seulement pour télécharger.
- `VER-01` à `VER-06` : rendre remplace la vérification, et la correction arrive à la fin du cours (`CRG-02`,
  `CRG-05`).
- `REN-01`, `REN-02` : gardés sans les positions réelles (`CRG-10`).
- `REN-03` à `REN-05` : le travail rendu arrive directement à l'enseignant, ou par fichier (`HIS-01`, `HIS-06`,
  `HIS-08`).
- `PUB-01` à `PUB-06`, `MUL-01`, `MUL-02`, `DEM-01` à `DEM-04` : publication par enseignant, et cours
  désigné par le QR code au lieu d'un projet unique dans le navigateur.
- `SEA-01` à `SEA-04` : les lancements remplacent les séances (`COU-08`, `COU-09`).
- `FIL-01` à `FIL-05` : l'enregistrement en fichier devient l'export de secours (`EXP-01`).
- `SEC-01` : le cours envoyé aux élèves ne contient plus les réponses (`CRG-01`).
- `SEC-05`, `PRI-04` : des données d'élèves arrivent désormais sur le serveur (`ANO-05`, `HIS-01`).
- `PRI-01` : les comptes demandent un stockage côté serveur. Ce principe est respecté : la base SQLite est celle
  fournie par Node (`SRV-12`).
- `PRI-07` : pas de reprise automatique du projet en service. Ses fiches ont été exportées en CSV, sans les photos
  ni le plan. Le projet complet pourra être réimporté depuis une copie de `data/project.json`.
- E-03, E-05, E-06, E-08, E-12 et E-14 : traités par ces évolutions.
- E-04 : à corriger avant d'ouvrir les connexions, car la protection contre les essais répétés en dépend.

### 12.11 Identifiants retirés

Ils ne sont pas réutilisés.

- **ANO-01** « Aucune donnée en base » : remplacée par `ANO-05` et `HIS-01`.
- **ANO-02** « Rejoindre ne crée aucun enregistrement » : rejoindre enregistre désormais le nom (`ANO-05`).
- **ANO-03** « Seules les données des enseignants sont conservées » : remplacée par `ANO-05` et `HIS-01`.
- **ANO-07** « Aucune autre donnée d'élève » : le serveur conserve aussi les réponses (`HIS-01`).
- **CRG-04** « Correction rechargée à chaque consultation » : remplacée par `CRG-08`.

### 12.12 Tests et couverture — `QUA`

Demande : EV-28

- **QUA-04** Chaque évolution arrive avec ses tests, dans le même commit. Un défaut corrigé garde un test qui le
  reproduit.
- **QUA-05** Chaque exigence de la section 12 est couverte par au moins un test automatique, dont le titre cite
  l'identifiant. Si l'automatisation est impossible, comme sur de vrais téléphones, un essai à la main est noté dans
  la feuille de route.
- **QUA-06** La couverture se mesure sur **tous** les fichiers : un fichier qu'aucun test ne charge compte pour 0 %.
  `npm run test:coverage` échoue sous un seuil, et les seuils ne baissent jamais.
- **QUA-07** Objectif à la mise en service : au moins 95 % des lignes et 90 % des branches du serveur, et au moins
  70 % des lignes du code du navigateur, grâce à des tests de parcours dans un vrai navigateur.
- **QUA-08** Le chiffre ne suffit pas : les parties sensibles (fuite des réponses, séparation des espaces, limites
  d'essais) sont vérifiées en cassant le code exprès, pour s'assurer qu'un test échoue.

---

## 13. Historique

| Version | Date              | Changement                                                                |
| ------- | ----------------- | ------------------------------------------------------------------------- |
| 0.1     | 1er novembre 2026 | Première version : description de l'existant, écarts, décisions à prendre |
| 0.2     | 1er novembre 2026 | Proposition et suivi des demandes en section 1 (ancienne section 12)      |
| 0.3     | 1er novembre 2026 | Fonctionnement cible : espaces enseignants, QR code, aucune trace d'élève |
| 0.4     | 1er novembre 2026 | Q-03, Q-04, Q-09 à Q-14 tranchées ; suivi, hors ligne, correction, rendu  |
| 0.5     | 1er novembre 2026 | Correction dès le rendu, historique enseignant, tableau de bord admin     |
| 0.6     | 1er novembre 2026 | Q-20 tranchée : bouton Terminer côté élève, correction à la fin du cours  |
| 0.7     | 1er novembre 2026 | Fichier de réponses en cas de problème de réseau, export CSV (Q-21)       |
| 0.8     | 1er novembre 2026 | Feuille de route ; constats sur la publication et le routage Traefik      |
| 0.9     | 1er novembre 2026 | Données en service supprimables : fiches exportées, pas de reprise automatique |
| 0.10    | 1er novembre 2026 | Étape 0 de la feuille de route : Node 24, `data/` hors du dépôt et de l'image (E-17) |
| 0.11    | 1er novembre 2026 | Étape 1 : base SQLite, ETag et gzip, E-04 et E-11 corrigés ; exigences sur les tests (EV-28) |
| 0.12    | 2 novembre 2026   | Étape 2 : comptes, connexion, tableau de bord ; durées de la section 9 de la feuille de route |
| 0.13    | 2 novembre 2026   | Message pour un compte désactivé, suppression d'un compte et de ses cours et restauration (EV-29 à EV-31) ; symptôme de EV-04 |
| 0.14    | 2 novembre 2026   | Étape 3 : cours, publication, fichiers, import ; cause de EV-04 en partie trouvée ; SRV-15 à SRV-17 |
| 0.15    | 2 novembre 2026   | EV-04 : fichiers du premier enseignant analysés et rejoués, erreur revenue sur deux navigateurs, correctif essayé sur une copie |
| 0.16    | 2 novembre 2026   | EV-32 à EV-35 : panneau plus haut, IA retirée des cours, site générique sous le nom de Cartopoint (Q-01), plus de données d'utilisateur sur GitHub |
| 0.17    | 2 novembre 2026   | Étape 4 : lancement, QR code, entrée des élèves et suivi ; COU-12, COU-13 ; exception à PRI-01 pour la bibliothèque de QR code |
| 0.18    | 3 novembre 2026   | Étape 5 : terminer, envoi et renvoi des réponses, résultat calculé par le serveur ; COU-10 fait en avance ; proportions du plan mesurées à la publication |
| 0.19    | 3 novembre 2026   | EV-04 : constats sur le poste du premier enseignant |
| 0.20    | 4 novembre 2026   | Étape 6 : page élève disponible sans réseau, polices servies par le site ; HOR-10, HOR-11 |
