/**
 * Le lecteur de QR code des tests et la bibliothèque du site, l'un contre l'autre : ils ont été écrits séparément. S'ils
 * s'accordent sur toutes ces adresses, avec des niveaux et des masques différents, ni l'un ni l'autre ne se trompe.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import qrcodegen from '../src/js/vendor/qrcodegen.js';
import { decodeModules } from './e2e/qr-reader.js';

const { QrCode } = qrcodegen;
const modulesOf = (code) => Array.from({ length: code.size }, (_, y) => Array.from({ length: code.size }, (_, x) => code.getModule(x, y)));

test('COU-04 : un QR code se relit à l’identique, quels que soient sa taille et son masque', () => {
  const seen = new Set();
  for (const host of ['a.fr', 'cartopoint.fr', 'cartopoint.example.org', '127.0.0.1:43123']) {
    for (const code of ['ABC234', 'ZZZZZZ', 'HJKMNP', '234567', 'QRSTUV', 'WXYZ23']) {
      const text = `https://${host}/c/${code}`;
      const qr = QrCode.encodeText(text, QrCode.Ecc.MEDIUM);
      seen.add(qr.mask);
      assert.equal(decodeModules(modulesOf(qr)), text);
    }
  }
  assert.ok(seen.size >= 4, `masques essayés : ${[...seen]}`);
});

test('le lecteur ne valide pas n’importe quoi : un module changé donne une erreur ou un autre texte', () => {
  const text = 'https://cartopoint.example.org/c/ABC234';
  const modules = modulesOf(QrCode.encodeText(text, QrCode.Ecc.MEDIUM));
  // La lecture commence en bas à droite : ces modules portent le début de l'adresse
  const row = modules.length - 12;
  const last = modules.length - 1;
  modules[row][last] = !modules[row][last];
  assert.notEqual(decodeModules(modules), text);
});

test('l’adresse du site tient dans un code assez simple pour être lu de loin', () => {
  const qr = QrCode.encodeText('https://cartopoint.example.org/c/ABC234', QrCode.Ecc.MEDIUM);
  assert.ok(qr.version <= 3, `version ${qr.version}`);
});
