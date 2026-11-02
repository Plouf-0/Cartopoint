-- Un compte supprimé reste restaurable 14 jours : voir ADM-10 dans le cahier des charges.

ALTER TABLE accounts ADD COLUMN deleted_at TEXT;
