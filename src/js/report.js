/**
 * Exports image : plan avec repères, et compte rendu complet des élèves en JPG
 * (noms, plan, résultats, mesures), facile à rendre sur l'ENT ou à imprimer.
 */
import { $, toast, download, safeFileName, loadImage } from './util.js';
import { S, verified, progress } from './store.js';
import { visibleFiches, numberOf, titleOf, hasRef, placedPos, evaluate, MEASURES } from './model.js';
import { paletteOf } from './themes.js';
import { studentNames } from './views/header.js';
import { buildTeacherCsv } from './spreadsheet.js';

const STUDENT = '#b3263e';
const TRUTH = '#1d5fa6';
const GRADE = { ok: ['#e1f1e6', '#2e7d4f'], near: ['#fbefd9', '#a46a12'], far: ['#fbe5e8', '#b3263e'], none: ['#eef0ec', '#55615a'] };
const SERIF = '"Fraunces", Georgia, "Times New Roman", serif';
const SANS = '"Atkinson Hyperlegible", Arial, sans-serif';

/* ------------------------------------------------------------------ */
/* Données                                                              */
/* ------------------------------------------------------------------ */

/** Une ligne par fiche visible : numéro, fiche, saisie de l'élève, évaluation. */
export function resultRows() {
  const p = progress();
  return visibleFiches(S.map).map((fiche) => ({
    n: numberOf(S.map, fiche),
    fiche,
    entry: p.entries[fiche.id] || {},
    ev: evaluate(fiche, p.entries[fiche.id], { ratio: S.ratio, widthMeters: S.map.widthMeters })
  }));
}

export function scoreOf(rows) {
  const scored = rows.filter((r) => r.ev.state !== 'noref');
  return { scored: scored.length, ok: scored.filter((r) => r.ev.state === 'ok').length, near: scored.filter((r) => r.ev.state === 'near').length };
}

/* ------------------------------------------------------------------ */
/* Dessin                                                               */
/* ------------------------------------------------------------------ */

/** Pastille numérotée : rond (élève) ou carré arrondi (position réelle). */
function drawTag(ctx, x, y, r, text, color, roundness) {
  ctx.font = `bold ${Math.round(r * 0.95)}px ${SANS}`;
  const w = Math.max(2 * r, ctx.measureText(text).width + r * 0.9);
  ctx.beginPath();
  ctx.roundRect(x - w / 2, y - r, w, 2 * r, r * roundness);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = r * 0.2;
  ctx.strokeStyle = '#fff';
  ctx.stroke();
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y + 1);
}

/** Le plan à sa taille réelle, avec les repères (et les positions réelles après vérification). */
async function drawPlan() {
  const img = await loadImage(S.map.image);
  const c = document.createElement('canvas');
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const W = c.width;
  const H = c.height;
  const r = Math.max(13, W * 0.014);
  const showRefs = S.admin || verified();
  const rows = resultRows();
  if (showRefs) {
    ctx.setLineDash([r * 0.5, r * 0.4]);
    ctx.lineWidth = Math.max(2, r * 0.15);
    ctx.strokeStyle = 'rgba(16,35,58,.8)';
    for (const { fiche, entry } of rows) {
      const p = placedPos(entry);
      if (!p || !hasRef(fiche)) continue;
      ctx.beginPath();
      ctx.moveTo((p.x / 100) * W, (p.y / 100) * H);
      ctx.lineTo((fiche.refX / 100) * W, (fiche.refY / 100) * H);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    for (const { n, fiche } of rows) if (hasRef(fiche)) drawTag(ctx, (fiche.refX / 100) * W, (fiche.refY / 100) * H, r * 0.95, n, TRUTH, 0.45);
  }
  for (const { n, entry } of rows) {
    const p = placedPos(entry);
    if (p) drawTag(ctx, (p.x / 100) * W, (p.y / 100) * H, r, n, STUDENT, 1);
  }
  return c;
}

/** Coupe un texte trop long avec « … ». */
function fit(ctx, text, maxWidth) {
  text = String(text ?? '');
  if (ctx.measureText(text).width <= maxWidth) return text;
  while (text && ctx.measureText(text + '…').width > maxWidth) text = text.slice(0, -1);
  return text + '…';
}

function pill(ctx, x, y, text, [bg, fg], size = 20) {
  ctx.font = `bold ${size}px ${SANS}`;
  const w = ctx.measureText(text).width + size * 1.1;
  const h = size * 1.6;
  ctx.beginPath();
  ctx.roundRect(x, y - h / 2, w, h, h / 2);
  ctx.fillStyle = bg;
  ctx.fill();
  ctx.fillStyle = fg;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x + size * 0.55, y + 1);
  return w;
}

async function fontsReady() {
  try {
    await Promise.all([document.fonts.load(`600 40px ${SERIF}`), document.fonts.load(`bold 20px ${SANS}`), document.fonts.load(`20px ${SANS}`)]);
  } catch {
    /* polices du système à défaut */
  }
}

/**
 * Compte rendu complet sur une seule image :
 *   titre, élèves, carte, date, score · plan avec repères · tableau des fiches et mesures.
 */
async function drawReport(names) {
  await fontsReady();
  const pal = paletteOf(S.project.theme);
  const rows = resultRows();
  const showEv = S.admin || verified();
  const { ok, near, scored } = scoreOf(rows);
  const plan = await drawPlan();

  const W = 1600;
  const P = 64;
  const CW = W - 2 * P;
  const planH = Math.round((plan.height / plan.width) * CW);
  const ROW = 76;
  const headerH = 230;
  const H = headerH + planH + 70 + 90 + ROW * (rows.length + 1) + 90;

  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = pal.accent;
  ctx.fillRect(0, 0, W, 14);

  // En-tête
  let y = P + 30;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = pal.ink;
  ctx.font = `600 52px ${SERIF}`;
  ctx.fillText(fit(ctx, S.project.title, CW - (showEv && scored ? 360 : 0)), P, y + 20);
  ctx.font = `26px ${SANS}`;
  ctx.fillStyle = pal.inkSoft;
  ctx.fillText(fit(ctx, `Élève(s) : ${names || '—'}`, CW - 380), P, y + 74);
  ctx.fillText(fit(ctx, `${S.map.name} · ${new Date().toLocaleString('fr-FR', { dateStyle: 'long', timeStyle: 'short' })}`, CW - 380), P, y + 112);
  if (showEv && scored) {
    ctx.textAlign = 'right';
    ctx.fillStyle = pal.ink;
    ctx.font = `600 76px ${SERIF}`;
    ctx.fillText(`${ok} / ${scored}`, W - P, y + 40);
    ctx.font = `24px ${SANS}`;
    ctx.fillStyle = pal.inkSoft;
    ctx.fillText(`bien placée(s)${near ? ` · ${near} proche(s)` : ''}`, W - P, y + 80);
    ctx.textAlign = 'left';
  }

  // Plan
  y = headerH;
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(P, y, CW, planH, 14);
  ctx.clip();
  ctx.drawImage(plan, P, y, CW, planH);
  ctx.restore();
  ctx.beginPath();
  ctx.roundRect(P, y, CW, planH, 14);
  ctx.lineWidth = 2;
  ctx.strokeStyle = pal.line;
  ctx.stroke();
  y += planH + 44;

  // Légende
  ctx.font = `22px ${SANS}`;
  ctx.textBaseline = 'middle';
  let x = P;
  const legend = (draw, label) => {
    draw(x + 12, y);
    ctx.fillStyle = pal.inkSoft;
    ctx.textAlign = 'left';
    ctx.font = `22px ${SANS}`;
    ctx.fillText(label, x + 34, y + 1);
    x += 34 + ctx.measureText(label).width + 40;
  };
  legend((cx, cy) => drawTag(ctx, cx, cy, 12, '', STUDENT, 1), 'Placement des élèves');
  if (showEv) {
    legend((cx, cy) => drawTag(ctx, cx, cy, 12, '', TRUTH, 0.45), 'Position réelle');
    legend((cx, cy) => {
      ctx.setLineDash([7, 6]);
      ctx.strokeStyle = '#10233a';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(cx - 12, cy);
      ctx.lineTo(cx + 14, cy);
      ctx.stroke();
      ctx.setLineDash([]);
    }, 'Écart');
  }
  y += 60;

  // Tableau
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = pal.ink;
  ctx.font = `600 34px ${SERIF}`;
  ctx.fillText('Fiches et mesures', P, y + 10);
  y += 40;
  const cols = showEv
    ? [['N°', 80], ['Fiche', 520], ...MEASURES.map(([, , unit, label]) => [label, 200]), ['Placement', 272]]
    : [['N°', 80], ['Fiche', 792], ...MEASURES.map(([, , unit, label]) => [label, 200])];
  ctx.fillStyle = pal.sandSoft;
  ctx.fillRect(P, y, CW, ROW * 0.7);
  ctx.font = `bold 20px ${SANS}`;
  ctx.fillStyle = pal.inkSoft;
  ctx.textBaseline = 'middle';
  x = P;
  for (const [label, w] of cols) {
    ctx.fillText(label, x + 14, y + ROW * 0.35);
    x += w;
  }
  y += ROW * 0.7;

  rows.forEach((r, i) => {
    const mid = y + ROW / 2;
    if (i % 2) {
      ctx.fillStyle = pal.paper;
      ctx.fillRect(P, y, CW, ROW);
    }
    x = P;
    const placed = !!placedPos(r.entry);
    if (placed) drawTag(ctx, x + 32, mid, 17, r.n, STUDENT, 1);
    else {
      ctx.setLineDash([5, 4]);
      ctx.strokeStyle = pal.line;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(x + 32, mid, 16, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = pal.inkSoft;
      ctx.font = `bold 16px ${SANS}`;
      ctx.textAlign = 'center';
      ctx.fillText(r.n, x + 32, mid + 1);
    }
    x += cols[0][1];
    ctx.textAlign = 'left';
    const nameW = cols[1][1] - 24;
    const sci = r.fiche.species && r.fiche.species !== titleOf(r.fiche) ? r.fiche.species : '';
    ctx.fillStyle = pal.ink;
    ctx.font = `bold 23px ${SANS}`;
    ctx.fillText(fit(ctx, titleOf(r.fiche), nameW), x + 14, sci ? mid - 12 : mid);
    if (sci) {
      ctx.fillStyle = pal.inkSoft;
      ctx.font = `italic 20px ${SERIF}`;
      ctx.fillText(fit(ctx, sci, nameW), x + 14, mid + 16);
    }
    x += cols[1][1];
    ctx.font = `23px ${SANS}`;
    MEASURES.forEach(([k, , unit], j) => {
      const v = r.entry[k];
      ctx.fillStyle = v ? pal.ink : pal.line;
      ctx.fillText(v ? `${v} ${unit}` : '—', x + 14, mid);
      x += cols[2 + j][1];
    });
    if (showEv) {
      pill(ctx, x + 14, r.ev.dist ? mid - 12 : mid, r.ev.label, GRADE[r.ev.cls] || GRADE.none, 18);
      if (r.ev.dist) {
        ctx.fillStyle = pal.inkSoft;
        ctx.font = `18px ${SANS}`;
        ctx.textAlign = 'left';
        ctx.fillText('écart ' + r.ev.dist, x + 14, mid + 20);
      }
    }
    ctx.strokeStyle = pal.line;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(P, y + ROW);
    ctx.lineTo(P + CW, y + ROW);
    ctx.stroke();
    y += ROW;
  });

  ctx.fillStyle = pal.inkSoft;
  ctx.font = `18px ${SANS}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(`${S.project.title} — compte rendu des élèves`, P, H - 36);
  return c;
}

const toJpeg = (canvas) => new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));

/* ------------------------------------------------------------------ */
/* Téléchargements                                                      */
/* ------------------------------------------------------------------ */

export async function downloadPlanImage() {
  try {
    const names = studentNames();
    const blob = await toJpeg(await drawPlan());
    download(blob, safeFileName(`Plan - ${S.map.name}${names ? ' - ' + names : ''}`) + '.jpg');
  } catch (e) {
    toast('⚠ Image impossible à créer : ' + e.message);
  }
}

/** Noms des élèves, ou null (avec un message) s'ils manquent hors gestion. */
function requireNames() {
  const names = studentNames();
  if (!names && !S.admin) {
    $('#dlgResults').open && $('#dlgResults').close();
    toast('Indiquez vos noms en haut de la page avant de télécharger');
    $('#studentNames').focus();
    return null;
  }
  return names;
}

export async function downloadReport() {
  const names = requireNames();
  if (names === null) return;
  try {
    toast('Préparation du compte rendu…');
    const blob = await toJpeg(await drawReport(names));
    download(blob, safeFileName(`Compte rendu - ${names || S.map.name}`) + '.jpg');
    toast('✓ Compte rendu téléchargé');
  } catch (e) {
    toast('⚠ Compte rendu impossible à créer : ' + e.message);
  }
}

export function downloadTeacherCsv() {
  const names = requireNames();
  if (names === null) return;
  const csv = buildTeacherCsv(resultRows(), { names, widthMeters: S.map.widthMeters });
  download(csv, safeFileName(`Rendu prof - ${names || S.map.name}`) + '.csv', 'text/csv;charset=utf-8');
  toast('✓ Rendu prof téléchargé');
}
