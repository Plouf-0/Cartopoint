/**
 * Ce qu'un élève reçoit d'un cours (CRG-01). Tout passe par des listes de ce qui est gardé, et non de ce qui est retiré :
 * un champ ajouté un jour au contenu d'un cours ne part pas chez les élèves sans qu'on l'ait décidé.
 */
const THEME_FIELDS = ['preset', 'accent', 'icon'];
const MAP_FIELDS = ['id', 'name', 'image'];
const FICHE_FIELDS = [
  'id',
  'ref',
  'common',
  'species',
  'family',
  'date',
  'exposure',
  'watering',
  'soil',
  'heat',
  'care',
  'description',
  'notes',
  'thumbnailId',
  'name'
];
const MEDIA_FIELDS = ['id', 'type', 'name', 'data'];

const pick = (source, fields) => Object.fromEntries(fields.filter((field) => source[field] !== undefined).map((field) => [field, source[field]]));

/** Même règle que normalizeFiche() dans src/js/model.js : sans indication, une fiche est visible. */
const isVisible = (fiche) => fiche.visible ?? fiche.studentEnabled !== false;

const studentFiche = (fiche) => ({
  ...pick(fiche, FICHE_FIELDS),
  visible: true,
  media: (fiche.media ?? []).map((media) => pick(media, MEDIA_FIELDS))
});

/** @param content le contenu d'une version publiée */
export function studentCourse(content) {
  return {
    format: content.format,
    version: content.version,
    title: content.title,
    theme: pick(content.theme ?? {}, THEME_FIELDS),
    maps: content.maps.map((map) => ({ ...pick(map, MAP_FIELDS), fiches: (map.fiches ?? []).filter(isVisible).map(studentFiche) }))
  };
}
