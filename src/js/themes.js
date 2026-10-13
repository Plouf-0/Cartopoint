/**
 * Thèmes de couleurs et icône de l'application.
 *
 * Un thème remplit les variables CSS définies dans css/app.css (--accent, --paper…).
 * Il est enregistré dans le projet : les élèves voient donc le thème choisi par
 * l'enseignant. Les couleurs des repères (rouge = élève, bleu = position réelle)
 * ne changent pas d'un thème à l'autre pour rester reconnaissables.
 */

export const PRESETS = {
  vegetal: {
    label: 'Végétal',
    accent: '#2e6e45',
    accentDark: '#24573a',
    accentTint: '#e3edda',
    paper: '#f2f5ec',
    sand: '#eadcc0',
    sandSoft: '#f6efe0',
    ink: '#1e3426',
    inkSoft: '#4f6455',
    line: '#cbd6c4'
  },
  ocean: {
    label: 'Océan',
    accent: '#1f5f8b',
    accentDark: '#174a6d',
    accentTint: '#dceaf4',
    paper: '#eef4f8',
    sand: '#cfe0ea',
    sandSoft: '#e8f1f6',
    ink: '#13293a',
    inkSoft: '#4a6072',
    line: '#c4d4e0'
  },
  terre: {
    label: 'Terre',
    accent: '#9a4a1f',
    accentDark: '#7a3a17',
    accentTint: '#f3e2d4',
    paper: '#f7f1ea',
    sand: '#e8d3bb',
    sandSoft: '#f5ebdf',
    ink: '#33241a',
    inkSoft: '#6b5546',
    line: '#dccab8'
  },
  ardoise: {
    label: 'Ardoise',
    accent: '#3f4f5f',
    accentDark: '#2f3d4a',
    accentTint: '#e2e7ec',
    paper: '#f1f3f5',
    sand: '#dde3e9',
    sandSoft: '#eef1f4',
    ink: '#1d252d',
    inkSoft: '#56636f',
    line: '#cdd4db'
  },
  lavande: {
    label: 'Lavande',
    accent: '#6a4c93',
    accentDark: '#553a7a',
    accentTint: '#ebe3f4',
    paper: '#f5f2f9',
    sand: '#e2d8ee',
    sandSoft: '#f1ecf7',
    ink: '#261c33',
    inkSoft: '#5f5270',
    line: '#d6cce3'
  }
};

/** Icônes possibles pour l'en-tête et les fiches sans photo (tracés SVG 24×24). */
export const ICONS = {
  leaf: { label: 'Feuille', path: '<path d="M5 19c0-8 5-13 14-14-1 9-6 14-14 14z"/><path d="M5 19l8-8"/>' },
  flower: {
    label: 'Plante',
    path: '<circle cx="12" cy="9" r="1.8"/><path d="M12 7.2C10 4 14 4 12 7.2M13.7 8.4c3-1.6 3.6 2 .2 1.5M13.1 10.6c1.6 3-2 3.6-1.1.3M10.9 10.6c-1.6 3 2 3.6 1.1.3M10.3 8.4c-3-1.6-3.6 2-.2 1.5"/><path d="M12 11v10M12 17c-1.5-2-3.5-2.5-5-1.5M12 18.5c1.5-2 3.5-2.5 5-1.5"/>'
  },
  mountain: { label: 'Montagne', path: '<path d="M3 19l6-10 4 6 2-3 6 7z"/><path d="M8 11.5l1 1 1.5-1.5"/>' },
  wave: {
    label: 'Vague',
    path: '<path d="M3 9c2-2 4-2 6 0s4 2 6 0 4-2 6 0"/><path d="M3 14c2-2 4-2 6 0s4 2 6 0 4-2 6 0"/><path d="M3 19c2-2 4-2 6 0s4 2 6 0 4-2 6 0"/>'
  },
  compass: { label: 'Boussole', path: '<circle cx="12" cy="12" r="8.5"/><path d="M15.5 8.5l-2 5-5 2 2-5z"/>' },
  book: { label: 'Livre', path: '<path d="M4 5.5C6.5 4.5 9 4.5 12 6.5c3-2 5.5-2 8-1V19c-2.5-1-5-1-8 1-3-2-5.5-2-8-1z"/><path d="M12 6.5V20"/>' }
};

export function iconSVG(name, size = 22) {
  const icon = ICONS[name] || ICONS.leaf;
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icon.path}</svg>`;
}

/* --- Couleur personnalisée : on dérive toute la palette d'une seule teinte --- */

function hexToHsl(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return null;
  const n = parseInt(m[1], 16);
  const r = ((n >> 16) & 255) / 255,
    g = ((n >> 8) & 255) / 255,
    b = (n & 255) / 255;
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b),
    l = (max + min) / 2;
  let h = 0,
    s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h *= 60;
  }
  return { h, s: s * 100, l: l * 100 };
}
// Syntaxe à virgules : comprise aussi par le dessin sur canvas des anciens navigateurs.
const hsl = (h, s, l) => `hsl(${h.toFixed(0)}, ${Math.max(0, Math.min(100, s)).toFixed(0)}%, ${Math.max(0, Math.min(100, l)).toFixed(0)}%)`;

/** Palette complète à partir d'une couleur d'accent (assombrie si trop claire pour du texte blanc). */
export function paletteFromAccent(hex) {
  const c = hexToHsl(hex);
  if (!c) return PRESETS.vegetal;
  const l = Math.min(c.l, 38);
  return {
    label: 'Personnalisé',
    accent: hsl(c.h, c.s, l),
    accentDark: hsl(c.h, c.s, l - 8),
    accentTint: hsl(c.h, c.s * 0.45, 91),
    paper: hsl(c.h, c.s * 0.25, 96),
    sand: hsl(c.h, c.s * 0.3, 87),
    sandSoft: hsl(c.h, c.s * 0.3, 94),
    ink: hsl(c.h, c.s * 0.35, 14),
    inkSoft: hsl(c.h, c.s * 0.15, 36),
    line: hsl(c.h, c.s * 0.2, 82)
  };
}

export function paletteOf(theme) {
  if (theme?.preset === 'custom') return paletteFromAccent(theme.accent);
  return PRESETS[theme?.preset] || PRESETS.vegetal;
}

const VARS = {
  accent: '--accent',
  accentDark: '--accent-dark',
  accentTint: '--accent-tint',
  paper: '--paper',
  sand: '--sand',
  sandSoft: '--sand-soft',
  ink: '--ink',
  inkSoft: '--ink-soft',
  line: '--line'
};

/** Applique un thème à la page. */
export function applyTheme(theme) {
  const p = paletteOf(theme);
  const root = document.documentElement.style;
  for (const [k, v] of Object.entries(VARS)) root.setProperty(v, p[k]);
  document.querySelectorAll('[data-brand-icon]').forEach((el) => (el.innerHTML = iconSVG(theme?.icon)));
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', p.accent);
}
