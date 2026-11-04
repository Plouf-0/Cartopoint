-- L'heure des réponses (CRG-13) : combien ont été faites après la fin du cours, et quand l'élève a fini, sur l'horloge du serveur.

ALTER TABLE participants ADD COLUMN answers_after_end INTEGER NOT NULL DEFAULT 0;
ALTER TABLE participants ADD COLUMN finished_at TEXT;
