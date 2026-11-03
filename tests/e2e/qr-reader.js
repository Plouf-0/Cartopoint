/**
 * Lit un QR code affiché à l'écran, à partir de ses pixels, comme le ferait un téléphone, sans bibliothèque : ce décodeur
 * ne partage rien avec celui qui a dessiné le code. Il se limite à ce que le site produit ici : versions 1 à 3, en mode
 * octets, sans correction d'erreurs. Une erreur de placement ou de masque donne donc un texte faux au lieu d'être rattrapée.
 */
import { Buffer } from 'node:buffer';

const MASKS = [
  (x, y) => (x + y) % 2 === 0,
  (x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0
];
/** Masque que la norme applique aux 15 bits de format. */
const FORMAT_MASK = 0x5412;
const QUIET_ZONE = 4;
/** Niveau de correction, lu dans le format : la bibliothèque le monte d'elle-même quand la place le permet. */
const LEVELS = { 0b01: 'L', 0b00: 'M', 0b11: 'Q', 0b10: 'H' };
/** Octets de données par version et par niveau, et nombre de blocs entre lesquels ils sont répartis (norme, tableau 9). */
const CAPACITY = {
  1: { L: [19, 1], M: [16, 1], Q: [13, 1], H: [9, 1] },
  2: { L: [34, 1], M: [28, 1], Q: [22, 1], H: [16, 1] },
  3: { L: [55, 1], M: [44, 1], Q: [34, 2], H: [26, 2] }
};

/** Noir ou blanc, au centre de chaque module, d'après une capture de l'élément à l'écran. */
async function modulesFromPixels(page, locator) {
  const image = (await locator.screenshot()).toString('base64');
  const { width, data } = await page.evaluate(async (image) => {
    const picture = new Image();
    picture.src = `data:image/png;base64,${image}`;
    await picture.decode();
    const canvas = document.createElement('canvas');
    canvas.width = picture.naturalWidth;
    canvas.height = picture.naturalHeight;
    const context = canvas.getContext('2d');
    context.drawImage(picture, 0, 0);
    return { width: canvas.width, data: [...context.getImageData(0, 0, canvas.width, canvas.height).data] };
  }, image);
  const dark = (x, y) => data[(Math.round(y) * width + Math.round(x)) * 4] < 128;

  // La marge blanche, puis le premier repère : sa largeur donne celle d'un module
  let left = 0;
  while (left < width && !dark(left, left)) left++;
  let right = left;
  while (right < width && dark(right, left)) right++;
  const moduleSize = (right - left) / 7;
  const side = Math.round(width / moduleSize);
  const size = side - 2 * QUIET_ZONE;
  const at = (index) => (index + QUIET_ZONE + 0.5) * (width / side);
  if (Math.abs(left - QUIET_ZONE * (width / side)) > width / side / 2) throw new Error(`marge blanche de ${left} px, trop petite`);
  return Array.from({ length: size }, (_, y) => Array.from({ length: size }, (_, x) => dark(at(x), at(y))));
}

/** Les modules réservés : repères, lignes de synchronisation, format, et repère d'alignement dès la version 2. */
function isFunctionModule(x, y, size) {
  const finder = (x < 9 && y < 9) || (x >= size - 8 && y < 9) || (x < 9 && y >= size - 8);
  const timing = x === 6 || y === 6;
  const a = size - 7;
  const alignment = size > 21 && Math.abs(x - a) <= 2 && Math.abs(y - a) <= 2;
  return finder || timing || alignment;
}

export function decodeModules(modules) {
  const size = modules.length;
  let format = 0;
  for (const [x, y] of [
    [0, 8],
    [1, 8],
    [2, 8],
    [3, 8],
    [4, 8]
  ]) {
    format = (format << 1) | (modules[y][x] ? 1 : 0);
  }
  const fields = format ^ (FORMAT_MASK >> 10);
  const mask = MASKS[fields & 7];
  const version = (size - 17) / 4;
  if (!CAPACITY[version]) throw new Error(`version ${version} : ce lecteur s'arrête à la version 3`);
  const [dataLength, blocks] = CAPACITY[version][LEVELS[fields >> 3]];

  // Lecture en zigzag, de droite à gauche, deux colonnes à la fois
  const bits = [];
  let upward = true;
  for (let right = size - 1; right > 0; right -= 2) {
    if (right === 6) right--;
    for (let step = 0; step < size; step++) {
      const y = upward ? size - 1 - step : step;
      for (const x of [right, right - 1]) {
        if (!isFunctionModule(x, y, size)) bits.push(modules[y][x] !== mask(x, y) ? 1 : 0);
      }
    }
    upward = !upward;
  }
  const byteAt = (index) => bits.slice(index * 8, index * 8 + 8).reduce((value, bit) => value * 2 + bit, 0);
  // Les blocs sont entrelacés : un octet de chacun, à tour de rôle
  const blockLength = dataLength / blocks;
  const ordered = [];
  for (let block = 0; block < blocks; block++) {
    for (let index = 0; index < blockLength; index++) ordered.push(byteAt(index * blocks + block));
  }
  const stream = ordered.flatMap((byte) => Array.from({ length: 8 }, (_, bit) => (byte >> (7 - bit)) & 1));
  const read = (start, length) => stream.slice(start, start + length).reduce((value, bit) => value * 2 + bit, 0);
  if (read(0, 4) !== 0b0100) throw new Error('ce lecteur ne connaît que le mode octets');
  const length = read(4, 8);
  return Buffer.from(Array.from({ length }, (_, index) => read(12 + index * 8, 8))).toString('utf8');
}

export async function readQr(page, locator) {
  return decodeModules(await modulesFromPixels(page, locator));
}
