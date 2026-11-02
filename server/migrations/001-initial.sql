-- Comptes, cours, lancements et élèves. Voir docs/FEUILLE_DE_ROUTE.md, section 5.

CREATE TABLE accounts (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT,
  role TEXT NOT NULL CHECK (role IN ('admin', 'teacher')),
  disabled_at TEXT,
  created_at TEXT NOT NULL,
  last_login_at TEXT
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts ON DELETE CASCADE,
  expires_at TEXT NOT NULL
);
CREATE INDEX sessions_account ON sessions (account_id);

-- Invitations et réinitialisations (usage unique)
CREATE TABLE links (
  token_hash TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('invite', 'reset')),
  account_id TEXT REFERENCES accounts ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX links_account ON links (account_id);

-- Le fichier est partagé si le contenu est identique
CREATE TABLE media (
  hash TEXT NOT NULL,
  account_id TEXT NOT NULL REFERENCES accounts ON DELETE CASCADE,
  ext TEXT NOT NULL,
  size INTEGER NOT NULL,
  PRIMARY KEY (hash, account_id)
);
CREATE INDEX media_account ON media (account_id);

CREATE TABLE courses (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts ON DELETE CASCADE,
  title TEXT NOT NULL,
  draft TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);
CREATE INDEX courses_account ON courses (account_id);

-- Instantané figé à chaque publication (COU-11)
CREATE TABLE course_versions (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL REFERENCES courses ON DELETE CASCADE,
  number INTEGER NOT NULL,
  content TEXT NOT NULL,
  published_at TEXT NOT NULL,
  UNIQUE (course_id, number)
);

CREATE TABLE launches (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL REFERENCES courses ON DELETE CASCADE,
  version_id TEXT NOT NULL REFERENCES course_versions,
  code TEXT NOT NULL UNIQUE,
  opened_at TEXT NOT NULL,
  ended_at TEXT
);
CREATE INDEX launches_course ON launches (course_id);
CREATE INDEX launches_version ON launches (version_id);

CREATE TABLE participants (
  id TEXT PRIMARY KEY,
  launch_id TEXT NOT NULL REFERENCES launches ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  names TEXT NOT NULL,
  joined_at TEXT NOT NULL,
  submitted_at TEXT,
  late INTEGER NOT NULL DEFAULT 0,
  by_file INTEGER NOT NULL DEFAULT 0,
  auto_closed INTEGER NOT NULL DEFAULT 0, -- figé à la fin du cours sans clic sur Terminer (CRG-11)
  answers TEXT,
  results TEXT
);
CREATE INDEX participants_launch ON participants (launch_id);
