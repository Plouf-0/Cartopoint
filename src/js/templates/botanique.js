/**
 * Le modèle des cours enregistrés avant la version 2.0.0 : les fiches botaniques, champ pour champ, avec les identifiants
 * qu'elles ont toujours eus (MOD-02).
 *
 * NE JAMAIS LE MODIFIER. Tout contenu publié sans modèle se lit avec lui, versions publiées et rendus d'élèves compris : le
 * changer changerait ce qu'on relit d'un lancement passé. Pour d'autres fiches, l'enseignant modifie la copie de son cours.
 * tests/model.test.js le fige.
 *
 * Les titres de colonne sont ceux que l'import par tableur reconnaissait déjà (TAB-03), sans accents ni majuscules.
 */
const deepFreeze = (value) => {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
};

export const BOTANIQUE = deepFreeze({
  name: 'Inventaire botanique',
  fields: [
    {
      id: 'common',
      type: 'text',
      label: 'Nom commun',
      audience: 'info',
      role: 'title',
      search: true,
      placeholder: 'Olivier',
      aliases: ['nom commun', 'nom', 'nom francais', 'nom vernaculaire', 'common']
    },
    {
      id: 'species',
      type: 'text',
      label: 'Nom scientifique',
      audience: 'info',
      role: 'subtitle',
      list: true,
      search: true,
      placeholder: 'Olea europaea',
      aliases: ['nom scientifique', 'espece', 'nom latin', 'species', 'scientific']
    },
    {
      id: 'family',
      type: 'text',
      label: 'Famille',
      audience: 'info',
      list: true,
      search: true,
      placeholder: 'Oleaceae',
      aliases: ['famille', 'famille botanique', 'family']
    },
    { id: 'date', type: 'date', label: "Date d'observation", audience: 'info', aliases: ['date', 'date d observation', 'date observation'] },
    { id: 'h-needs', type: 'heading', label: 'Besoins' },
    {
      id: 'exposure',
      type: 'longtext',
      label: 'Exposition',
      icon: '☀️',
      audience: 'info',
      placeholder: '☀️☀️☀️ Plein soleil',
      aliases: ['exposition', 'soleil', 'ensoleillement', 'exposure']
    },
    {
      id: 'watering',
      type: 'longtext',
      label: 'Arrosage',
      icon: '💧',
      audience: 'info',
      placeholder: '💧 Faible une fois installé',
      aliases: ['arrosage', 'eau', 'besoin en eau', 'watering']
    },
    { id: 'soil', type: 'longtext', label: 'Sol', icon: '🌱', audience: 'info', placeholder: 'Léger, bien drainé', aliases: ['sol', 'terre', 'soil'] },
    {
      id: 'heat',
      type: 'longtext',
      label: 'Chaleur',
      icon: '🌡️',
      audience: 'info',
      placeholder: "Très bonne tolérance · ❄️ jusqu'à -10 °C",
      aliases: ['chaleur', 'climat', 'rusticite', 'heat']
    },
    {
      id: 'care',
      type: 'longtext',
      label: 'Entretien',
      icon: '✂️',
      audience: 'info',
      placeholder: 'Taille légère après floraison',
      aliases: ['entretien', 'taille', 'care']
    },
    { id: 'h-measures', type: 'heading', label: 'Vos mesures', help: "Notez ce que vous mesurez sur place. C'est enregistré automatiquement." },
    {
      id: 'temperature',
      type: 'number',
      label: 'Température',
      icon: '🌡',
      unit: '°C',
      keyboard: 'decimal',
      audience: 'question',
      list: true,
      aliases: ['temperature', 'temp']
    },
    {
      id: 'humidity',
      type: 'number',
      label: 'Hygrométrie',
      icon: '💧',
      unit: '%',
      keyboard: 'decimal',
      audience: 'question',
      list: true,
      aliases: ['hygrometrie', 'humidite', 'humidity']
    },
    {
      id: 'light',
      type: 'number',
      label: 'Éclairement',
      icon: '☀️',
      unit: 'lux',
      keyboard: 'numeric',
      audience: 'question',
      list: true,
      aliases: ['eclairement', 'luminosite', 'lumiere', 'lux', 'light']
    },
    // Un intertitre sans libellé ferme le groupe des mesures : la description et les observations n'en font pas partie
    { id: 'h-end', type: 'heading', label: '' },
    { id: 'description', type: 'longtext', label: 'Description', audience: 'info', aliases: ['description', 'description de l espece'] },
    {
      id: 'notes',
      type: 'longtext',
      label: 'Observations',
      audience: 'info',
      aliases: ['observations', 'observations de terrain', 'notes', 'commentaires', 'remarques']
    }
  ]
});
