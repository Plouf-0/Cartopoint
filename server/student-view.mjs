/**
 * Ce qu'un élève reçoit d'un cours (CRG-01). Tout passe par des listes de ce qui est gardé, et non de ce qui est retiré :
 * un champ ajouté un jour au contenu d'un cours ne part pas chez les élèves sans qu'on l'ait décidé.
 *
 * Le modèle de fiche dit le reste (CHP-04) : d'une fiche ne partent que les renseignements. Ce qui est révélé à la
 * correction n'arrive qu'avec elle (correctionOf), et la note de l'enseignant jamais, pas même sa définition.
 */
import { isHeading } from '../src/js/fields.js';
import { templateOf } from '../src/js/model.js';

const THEME_FIELDS = ['preset', 'accent', 'icon'];
const MAP_FIELDS = ['id', 'name', 'image'];
/** Ce que toute fiche garde, quel que soit son modèle. `name` : le titre de secours des fiches de format 2. */
const FICHE_FIELDS = ['id', 'ref', 'thumbnailId', 'name'];
const MEDIA_FIELDS = ['id', 'type', 'name', 'data'];
/**
 * Ce que l'élève a besoin de savoir d'un champ pour l'afficher et y répondre. Ni les variantes de titre du tableur, ni
 * l'exemple d'un renseignement, qui ne servent qu'à l'enseignant.
 */
const TEMPLATE_FIELDS = [
  'id',
  'type',
  'label',
  'icon',
  'help',
  'audience',
  'role',
  'list',
  'search',
  'unit',
  'keyboard',
  'choices',
  'multiple',
  'max',
  'symbol',
  'required',
  // Comment la question sera corrigée : la page annonce celles que l'enseignant corrigera plus tard (Q-O)
  'check'
];

const pick = (source, fields) => Object.fromEntries(fields.filter((field) => source[field] !== undefined).map((field) => [field, source[field]]));

/** Même règle que normalizeFiche() dans src/js/model.js : sans indication, une fiche est visible. */
const isVisible = (fiche) => fiche.visible ?? fiche.studentEnabled !== false;

/** Le modèle, tel que l'élève en a besoin : sans les notes de l'enseignant. L'exemple d'une question l'aide à répondre. */
const studentTemplate = (template) => ({
  fields: template.fields
    .filter((field) => field.audience !== 'teacher')
    .map((field) => pick(field, isHeading(field) || field.audience === 'question' ? [...TEMPLATE_FIELDS, 'placeholder'] : TEMPLATE_FIELDS))
});

/** @param content le contenu d'une version publiée */
export function studentCourse(content) {
  const template = templateOf(content);
  const values = template.fields.filter((field) => field.audience === 'info').map((field) => field.id);
  const studentFiche = (fiche) => ({
    ...pick(fiche, [...FICHE_FIELDS, ...values]),
    visible: true,
    media: (fiche.media ?? []).map((media) => pick(media, MEDIA_FIELDS))
  });
  return {
    format: content.format,
    version: content.version,
    title: content.title,
    theme: pick(content.theme ?? {}, THEME_FIELDS),
    template: studentTemplate(template),
    maps: content.maps.map((map) => ({ ...pick(map, MAP_FIELDS), fiches: (map.fiches ?? []).filter(isVisible).map(studentFiche) }))
  };
}
