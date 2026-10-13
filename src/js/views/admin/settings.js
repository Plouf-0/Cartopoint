/**
 * Onglet « Réglages » : apparence (thème, icône), mot de passe, identification par IA.
 */
import { $, esc, toast } from '../../util.js';
import { S, changedMeta } from '../../store.js';
import { PRESETS, ICONS, iconSVG, applyTheme, paletteOf } from '../../themes.js';
import { hashPassword } from '../../auth.js';
import { render } from '../../render.js';

export function html() {
  const t = S.project.theme;
  const custom = paletteOf({ preset: 'custom', accent: t.accent || '#2e6e45' });
  const swatch = (key, p) =>
    `<button type="button" class="swatch" data-preset="${key}" aria-pressed="${t.preset === key}" style="--sw-accent:${p.accent};--sw-tint:${p.accentTint}"><i></i>${p.label}</button>`;
  return `
    <h2>Réglages</h2>
    <div class="section first">
      <h3>Apparence</h3>
      <p>Couleurs et icône de la page, pour adapter l'application à d'autres sujets que les plantes. Elles sont enregistrées avec le projet : les élèves les verront aussi.</p>
      <div class="swatches">
        ${Object.entries(PRESETS)
          .map(([k, p]) => swatch(k, p))
          .join('')}
        <label class="swatch" aria-pressed="${t.preset === 'custom'}" style="--sw-accent:${custom.accent};--sw-tint:${custom.accentTint}" title="Choisir une couleur">
          <input type="color" id="customColor" value="${esc(t.accent || '#2e6e45')}" aria-label="Couleur personnalisée">Autre…
        </label>
      </div>
      <p class="field-title">Icône</p>
      <div class="icon-choice">
        ${Object.entries(ICONS)
          .map(
            ([k, ic]) =>
              `<button type="button" data-icon="${k}" aria-pressed="${t.icon === k}" title="${ic.label}" aria-label="${ic.label}">${iconSVG(k, 22)}</button>`
          )
          .join('')}
      </div>
    </div>

    <div class="section">
      <h3>Mot de passe de gestion</h3>
      <p>Il évite les modifications accidentelles par les élèves. Ce n'est pas une vraie protection : une personne avertie peut lire le contenu du fichier. Mot de passe par défaut : <b>admin</b>.</p>
      <div class="field"><label for="pw1">Nouveau mot de passe</label><input id="pw1" type="password" autocomplete="new-password"></div>
      <div class="field"><label for="pw2">Confirmer</label><input id="pw2" type="password" autocomplete="new-password"></div>
      <button type="button" class="btn soft sm" id="savePw">Changer le mot de passe</button>
    </div>

    <div class="section">
      <h3>Identification par IA</h3>
      <p>Adresse d'un serveur qui reçoit les photos d'une fiche et renvoie une proposition (nom commun, nom scientifique, famille, besoins…). Laissez vide pour masquer le bouton. Ne mettez jamais de clé d'API dans ce champ : elle serait visible par tous.</p>
      <div class="inline"><input id="aiUrl" class="text-input" type="url" value="${esc(S.project.aiEndpoint)}" placeholder="https://…"><button type="button" class="btn soft sm" id="saveAi">Enregistrer</button></div>
    </div>`;
}

function setTheme(patch) {
  Object.assign(S.project.theme, patch);
  applyTheme(S.project.theme);
  changedMeta();
  render();
}

export function bind(panel) {
  panel.querySelectorAll('[data-preset]').forEach((b) => (b.onclick = () => setTheme({ preset: b.dataset.preset })));
  const color = $('#customColor');
  color.oninput = () => {
    S.project.theme.accent = color.value;
    S.project.theme.preset = 'custom';
    applyTheme(S.project.theme); // aperçu en direct, sans redessiner le panneau
  };
  color.onchange = () => setTheme({ preset: 'custom', accent: color.value });
  panel.querySelectorAll('[data-icon]').forEach((b) => (b.onclick = () => setTheme({ icon: b.dataset.icon })));

  $('#savePw').onclick = async () => {
    const a = $('#pw1').value;
    const b = $('#pw2').value;
    if (a.length < 4) return toast('Choisissez au moins 4 caractères');
    if (a !== b) return toast('Les deux mots de passe sont différents');
    S.project.passwordHash = await hashPassword(a);
    changedMeta();
    $('#pw1').value = $('#pw2').value = '';
    toast('Mot de passe changé');
  };
  $('#saveAi').onclick = () => {
    S.project.aiEndpoint = $('#aiUrl').value.trim();
    changedMeta();
    toast('Adresse enregistrée');
  };
}
