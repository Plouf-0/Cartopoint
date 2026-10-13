/**
 * Identification par IA (facultative).
 *
 * L'application envoie les photos de la fiche à l'adresse réglée dans Gestion › Réglages.
 * Ce service (à fournir par vos soins) doit répondre en JSON, par exemple :
 *   { "common": "Olivier", "scientific": "Olea europaea", "family": "Oleaceae",
 *     "exposure": "☀️☀️☀️ Plein soleil", "watering": "💧 Faible", "soil": "…",
 *     "heat": "…", "care": "…", "description": "…", "notes": "…" }
 * Seuls les champs encore vides du formulaire sont remplis.
 */
import { $, blobToDataURL } from './util.js';
import { S } from './store.js';
import { Files } from './db.js';

const FORM = {
  eCommon: 'common',
  eSpecies: 'scientific',
  eFamily: 'family',
  eExposure: 'exposure',
  eWatering: 'watering',
  eSoil: 'soil',
  eHeat: 'heat',
  eCare: 'care',
  eDesc: 'description',
  eNotes: 'notes'
};

export async function identifyWithAI(draft, statusEl) {
  const photos = draft.media.filter((m) => m.type === 'image').slice(0, 4);
  if (!photos.length) {
    statusEl.textContent = "Ajoutez d'abord au moins une photo.";
    return;
  }
  statusEl.textContent = 'Analyse en cours…';
  try {
    const images = [];
    for (const m of photos) {
      if (m.data) images.push(m.data);
      else if (m.key) {
        const blob = await Files.get(m.key);
        if (blob) images.push(await blobToDataURL(blob));
      }
    }
    const resp = await fetch(S.project.aiEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ images, task: 'identifier une plante et proposer une fiche botanique en français', fields: Object.values(FORM) })
    });
    if (!resp.ok) throw new Error('le serveur a répondu ' + resp.status);
    const data = await resp.json();
    const result = data.result || data;
    let n = 0;
    for (const [field, key] of Object.entries(FORM)) {
      const el = $('#' + field);
      if (result[key] && !el.value.trim()) {
        el.value = result[key];
        n++;
      }
    }
    statusEl.textContent = n ? `${n} champ(s) rempli(s). Vérifiez-les avant d'enregistrer.` : 'Aucun champ vide à compléter.';
  } catch (e) {
    statusEl.textContent = "L'analyse a échoué : " + e.message + ". Vérifiez l'adresse dans Réglages.";
  }
}
