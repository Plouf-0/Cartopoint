-- Journal des problèmes vus dans les navigateurs (INC-01). Une ligne par problème : le même, sur le même navigateur, ne fait qu'augmenter
-- son compteur. Ni nom d'élève, ni réponse, ni contenu de cours, ni adresse IP (INC-03).

CREATE TABLE incidents (
  id INTEGER PRIMARY KEY,
  fingerprint TEXT NOT NULL UNIQUE,
  account_id TEXT REFERENCES accounts ON DELETE SET NULL,
  page TEXT NOT NULL,
  action TEXT NOT NULL,
  reason TEXT NOT NULL,
  details TEXT NOT NULL DEFAULT '',
  machine TEXT NOT NULL,
  first_at TEXT NOT NULL,
  last_at TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX incidents_by_date ON incidents (last_at);
