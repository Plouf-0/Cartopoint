/**
 * Le QR code d'un lancement, en SVG : il reste net quelle que soit sa taille à l'écran ou au projecteur.
 */
import qrcodegen from '../vendor/qrcodegen.js';

const { QrCode } = qrcodegen;
/** La marge blanche que la norme demande autour du code : sans elle, certains téléphones ne le lisent pas. */
const QUIET_ZONE = 4;
const SVG = 'http://www.w3.org/2000/svg';

function svgElement(name, attributes) {
  const node = document.createElementNS(SVG, name);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
  return node;
}

export function qrSvg(text) {
  const code = QrCode.encodeText(text, QrCode.Ecc.MEDIUM);
  const side = code.size + 2 * QUIET_ZONE;
  let modules = '';
  for (let y = 0; y < code.size; y++) {
    for (let x = 0; x < code.size; x++) {
      if (code.getModule(x, y)) modules += `M${x + QUIET_ZONE},${y + QUIET_ZONE}h1v1h-1z`;
    }
  }
  const svg = svgElement('svg', { viewBox: `0 0 ${side} ${side}`, role: 'img', 'aria-label': `QR code vers ${text}`, 'shape-rendering': 'crispEdges' });
  svg.append(svgElement('rect', { width: side, height: side, fill: '#fff' }), svgElement('path', { d: modules, fill: '#000' }));
  return svg;
}
