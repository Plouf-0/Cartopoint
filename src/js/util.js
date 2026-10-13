/**
 * Petits outils génériques, sans dépendance au reste de l'application.
 */

/** Premier élément correspondant au sélecteur CSS. */
export const $ = (sel, root = document) => root.querySelector(sel);
/** Tous les éléments correspondant au sélecteur CSS, sous forme de tableau. */
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** Identifiant unique (UUID quand le navigateur le permet). */
export const uid = () => globalThis.crypto?.randomUUID?.() ?? Date.now().toString(36) + Math.random().toString(36).slice(2, 10);

/** Échappe une valeur pour l'insérer dans du HTML. */
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** Nombre fini ou `null` (accepte aussi les chaînes « 12,5 »). */
export const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};

/** Chaîne (les valeurs absentes deviennent ''). */
export const str = (v) => (v === null || v === undefined ? '' : String(v));

/** Comparaison « naturelle » : 2 < 5a < 5b < 10. */
export const natural = (a, b) => String(a).localeCompare(String(b), 'fr', { numeric: true, sensitivity: 'base' });

/** Clé de comparaison souple : sans accents, minuscules, sans ponctuation ni parenthèses. */
export const normKey = (s) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** Nom de fichier sans caractères interdits. */
export const safeFileName = (s) =>
  String(s ?? '')
    .replace(/[\\/:*?"<>|]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100);

/** Date du jour au format AAAA-MM-JJ. */
export const today = () => new Date().toISOString().slice(0, 10);

/** Date AAAA-MM-JJ affichée à la française (les autres formats sont rendus tels quels). */
export const frDate = (d) => (/^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(d + 'T12:00').toLocaleDateString('fr-FR') : str(d));

/** Fait télécharger un contenu (texte ou Blob) au navigateur. */
export function download(content, filename, type) {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

export const blobToDataURL = (blob) =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });

export function dataURLToBlob(url) {
  const [head, data] = url.split(',');
  const mime = head.match(/data:([^;]+)/)?.[1] || 'application/octet-stream';
  const bin = atob(data);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

export const loadImage = (src) =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image illisible'));
    img.src = src;
  });

/**
 * Réduit une image trop lourde (côté max 2600 px, JPEG) pour garder le projet léger.
 * Renvoie une URL data:.
 */
export async function prepareImage(file, max = 2600) {
  const src = await blobToDataURL(file);
  try {
    const img = await loadImage(src);
    if (img.naturalWidth <= max && img.naturalHeight <= max && file.size < 1.5e6) return src;
    const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * k);
    c.height = Math.round(img.naturalHeight * k);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.88);
  } catch {
    return src;
  }
}

/** Ouvre le sélecteur de fichiers et renvoie le premier fichier choisi (ou null). */
export function pickFile(accept) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = () => resolve(input.files[0] || null);
    input.click();
  });
}

/**
 * Préférences locales (localStorage) protégées : en navigation privée ou si le
 * stockage est bloqué, les lectures renvoient la valeur par défaut sans erreur.
 */
export const prefs = {
  get(key, fallback = null) {
    try {
      const v = localStorage.getItem(key);
      return v === null ? fallback : v;
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* stockage indisponible */
    }
  },
  del(key) {
    try {
      localStorage.removeItem(key);
    } catch {
      /* stockage indisponible */
    }
  }
};

/** Petite notification en bas de l'écran. */
let toastTimer;
export function toast(message) {
  const el = $('#toast');
  if (!el) return;
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2800);
}

/** Bandeau d'erreur permanent en haut de la page. */
export function fatal(message) {
  const el = $('#fatal');
  el.textContent = message;
  el.hidden = false;
}

/** Retarde l'appel de `fn` tant qu'il est redemandé (regroupe les enregistrements). */
export function debounce(fn, ms) {
  let t;
  const wrapped = (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
  wrapped.flush = (...args) => {
    clearTimeout(t);
    return fn(...args);
  };
  return wrapped;
}
