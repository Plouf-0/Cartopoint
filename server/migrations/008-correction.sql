-- Corrections de l'enseignant sur les réponses d'un élève (QST-04) : { [carte]: { [fiche]: { [question]: { verdict, comment } } } }
ALTER TABLE participants ADD COLUMN reviews TEXT;
-- Notation propre à ce lancement (QST-05), si l'enseignant l'a changée après l'ouverture ; sinon celle de la version du cours
ALTER TABLE launches ADD COLUMN grading TEXT;
