-- La note que l'enseignant donne à un élève, s'il en donne une : elle apparaît sur le compte rendu et dans le fichier Excel (HIS-09).

ALTER TABLE participants ADD COLUMN note TEXT NOT NULL DEFAULT '';
