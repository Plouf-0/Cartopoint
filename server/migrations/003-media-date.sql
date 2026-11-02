-- Date d'envoi : le nettoyage laisse un jour à un fichier avant que le brouillon qui le cite soit enregistré.

ALTER TABLE media ADD COLUMN created_at TEXT NOT NULL DEFAULT '';
