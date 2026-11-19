/**
 * Un cours de format 3, inventé pour les tests : deux cartes, tous les champs botaniques, des valeurs absentes ou d'un autre
 * type, des clés inconnues et de la progression. Rien ne vient des données d'un site en service.
 */
export const COURS_FORMAT_3 = {
  format: 'inventaire-botanique',
  version: 3,
  id: 'proj-essai',
  revision: 'rev-7',
  savedAt: '2026-10-12T15:04:59.952Z',
  title: 'Sortie au parc',
  theme: { preset: 'ocean', accent: '', icon: 'leaf' },
  passwordHash: null,
  aiEndpoint: 'https://exemple.invalid/ia',
  currentMapId: 'map-b',
  maps: [
    {
      id: 'map-a',
      name: 'Jardin',
      image: '/media/0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef.jpg',
      widthMeters: 180,
      ratio: 1.25,
      fiches: [
        {
          id: 'f1',
          ref: '12b',
          common: 'Tamaris',
          species: 'Tamarix gallica',
          family: 'Tamaricaceae',
          date: '2026-09-28',
          exposure: '☀️☀️☀️ Plein soleil',
          watering: '💧💧 Modéré',
          soil: 'Sableux',
          heat: 'Très bonne tolérance',
          care: 'Taille après floraison',
          description: 'Arbuste des bords de mer.',
          notes: 'Près du portail',
          visible: true,
          refX: 8.204,
          refY: 39.858,
          thumbnailId: 'm1',
          media: [{ id: 'm1', type: 'image', name: 'tamaris.jpg', data: '/media/aaaa.jpg' }]
        },
        { id: 'f2', ref: '3', common: '', species: 'Olea europaea', family: 'Oleaceae', visible: false, refX: 50, refY: 50, media: [] },
        { id: 'f3', code: '5a', common: 'Chêne vert', exposure: 12, heat: null, studentEnabled: true, foo: 'inconnu', refX: '20', refY: 'x' },
        { id: 'f4', name: 'Ancien emplacement', visible: true }
      ]
    },
    {
      id: 'map-b',
      name: 'Bord de mer',
      image: '',
      fiches: [{ id: 'f5', ref: '1', common: 'Euphorbe', species: 'Euphorbia characias', visible: true, refX: 70, refY: 10 }]
    }
  ],
  progress: {
    'map-a': {
      verified: true,
      entries: {
        f1: { x: 10, y: 41, at: 1762300000000, temperature: '21', humidity: '', light: 'nuageux', junk: 'x' },
        f3: { x: 5, y: null, temperature: 19 }
      }
    }
  }
};
