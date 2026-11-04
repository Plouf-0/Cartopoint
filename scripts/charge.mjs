/**
 * Test de charge : une classe entière sur un même cours (QUA-09). Chaque élève simulé fait les mêmes demandes que sa page : il ouvre le
 * QR code, entre, reçoit le cours, télécharge le plan et les photos, contrôle l'état, puis rend. Tous en même temps, ce qui est le pire cas :
 * en vrai, une classe arrive sur quelques dizaines de secondes.
 *
 *   npm run test:charge                          30, 50 puis 100 élèves, sur un serveur démarré pour l'occasion, avec une vraie base sur disque
 *   npm run test:charge -- --eleves=50
 *   npm run test:charge -- --eleves=50 --adresse=https://… avec CHARGE_EMAIL et CHARGE_MOT_DE_PASSE pour un compte enseignant existant
 *
 * Ce script mesure le serveur, pas le réseau de l'école : tout passe ici par la même machine.
 */
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateSync } from 'node:zlib';

const AT_ONCE = 4; // comme la page élève (eleve/offline.js)
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Une image de cette taille à peu près : du bruit, qui ne se compresse pas, comme une photo. */
function noisePng(bytes) {
  const side = Math.ceil(Math.sqrt(bytes / 3));
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(side, 0);
  header.writeUInt32BE(side, 4);
  header.set([8, 2, 0, 0, 0], 8);
  const rows = Array.from({ length: side }, () => Buffer.concat([Buffer.from([0]), randomBytes(side * 3)]));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.concat(rows), { level: 0 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

const percentile = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor((sorted.length * p) / 100))] ?? 0;

/** Ce que le navigateur demande quand tout un groupe de pages travaille en même temps : un seul point de mesure par sorte de demande. */
function createMeter(base) {
  const routes = new Map();
  const failures = [];
  async function call(route, target, { method = 'GET', headers = {}, body, ok = (status) => status < 400 } = {}) {
    const entry = routes.get(route) ?? { durations: [], errors: 0, bytes: 0 };
    routes.set(route, entry);
    const started = performance.now();
    try {
      const response = await fetch(base + target, {
        method,
        body,
        headers: {
          Origin: base,
          'User-Agent': 'Mozilla/5.0 (test de charge Cartopoint)',
          ...(typeof body === 'string' ? { 'Content-Type': 'application/json' } : {}),
          ...headers
        }
      });
      const buffer = Buffer.from(await response.arrayBuffer());
      entry.durations.push(performance.now() - started);
      entry.bytes += buffer.length;
      if (!ok(response.status)) {
        entry.errors++;
        failures.push(`${route} : ${response.status} ${buffer.toString('utf8', 0, 120)}`);
      }
      return { status: response.status, headers: response.headers, text: () => buffer.toString(), json: () => JSON.parse(buffer.toString()) };
    } catch (e) {
      entry.durations.push(performance.now() - started);
      entry.errors++;
      failures.push(`${route} : ${e.cause?.code ?? e.message}`);
      return { status: 0, headers: new Headers(), text: () => '', json: () => ({}) };
    }
  }
  const results = () =>
    [...routes].map(([route, { durations, errors, bytes }]) => {
      const sorted = [...durations].sort((a, b) => a - b);
      return { route, count: durations.length, errors, bytes, p50: percentile(sorted, 50), p95: percentile(sorted, 95), max: sorted.at(-1) ?? 0 };
    });
  return { call, results, failures };
}

/**
 * @returns les chiffres de chaque sorte de demande, la durée de chaque phase, et ce qui a été refusé ou perdu.
 * `participants` donne la liste vue par l'enseignant à la fin.
 */
export async function simulateClass({ base, teacher, students = 50, photos = 34, photoBytes = 100e3, planBytes = 1e6, pollRounds = 3, pollEveryMs = 200 }) {
  const { call, results, failures } = createMeter(base);
  const login = await call('préparation', '/api/auth/login', { method: 'POST', body: JSON.stringify(teacher) });
  if (login.status !== 200) throw new Error(`Connexion de l'enseignant impossible : ${login.status}`);
  const cookie = { Cookie: login.headers.getSetCookie()[0].split(';')[0] };
  const asTeacher = (options = {}) => ({ ...options, headers: { ...cookie, ...options.headers } });
  const upload = async (bytes) =>
    (await call('préparation', '/api/media', asTeacher({ method: 'POST', headers: { 'Content-Type': 'image/png' }, body: noisePng(bytes) }))).json().url;

  const plan = await upload(planBytes);
  const pictures = [];
  for (let i = 0; i < photos; i++) pictures.push(await upload(photoBytes));
  const fiches = pictures.map((url, i) => ({
    id: `f${i}`,
    common: `Plante ${i}`,
    visible: true,
    refX: 10 + (i % 80),
    refY: 20,
    media: [{ id: `p${i}`, type: 'image', name: `p${i}.png`, data: url }]
  }));
  const draft = { format: 'inventaire-botanique', version: 3, title: 'Cours de charge', theme: {}, maps: [{ id: 'm1', name: 'Plan', image: plan, fiches }] };
  const course = (await call('préparation', '/api/courses', asTeacher({ method: 'POST', body: JSON.stringify({ draft }) }))).json();
  await call('préparation', `/api/courses/${course.id}/publish`, asTeacher({ method: 'POST', body: JSON.stringify({ revision: course.revision }) }));
  const launch = (await call('préparation', `/api/courses/${course.id}/launches`, asTeacher({ method: 'POST', body: '{}' }))).json();
  const files = [plan, ...pictures];
  const follow = () => call('enseignant : suivre la classe', `/api/launches/${launch.id}`, asTeacher());

  const asStudent = (token) => ({ headers: { Authorization: `Bearer ${token}` } });

  async function arrive(index) {
    await call('page élève', `/c/${launch.code}`);
    const worker = await call('service worker', '/c/sw.js');
    await call('page gardée', '/c/page');
    for (const font of worker.text().match(/\/assets\/fonts\/[\w-]+\.woff2/g) ?? []) await call('polices', font);
    await call('vérifier le code', `/api/join/${launch.code}`);
    const me = (await call('entrer', `/api/join/${launch.code}`, { method: 'POST', body: JSON.stringify({ names: `Élève ${index}` }) })).json();
    const received = await call('recevoir le cours', '/api/student/course', asStudent(me.token));
    if (received.status !== 200) return { ...me, index, course: null };
    const queue = [...files];
    await Promise.all(
      Array.from({ length: AT_ONCE }, async () => {
        while (queue.length) await call('plan et photos', queue.shift());
      })
    );
    return { ...me, index, course: received.json() };
  }

  const phases = {};
  const timedPhase = async (name, work) => {
    const started = performance.now();
    const result = await work();
    phases[name] = (performance.now() - started) / 1000;
    return result;
  };

  const everyone = await timedPhase('arrivée et téléchargement', () => Promise.all(Array.from({ length: students }, (_, index) => arrive(index))));
  await timedPhase('travail : contrôles', async () => {
    for (let round = 0; round < pollRounds; round++) {
      await Promise.all([follow(), ...everyone.map((me) => call('contrôler l’état', '/api/student/state', asStudent(me.token)))]);
      await sleep(pollEveryMs);
    }
  });
  await timedPhase('tous rendent en même temps', () =>
    Promise.all(
      everyone.map((me) => {
        const entries = Object.fromEntries(fiches.map((fiche) => [fiche.id, { x: 1 + (me.index % 98), y: 1, temperature: String(me.index) }]));
        return call('rendre', '/api/student/answers', { method: 'PUT', ...asStudent(me.token), body: JSON.stringify({ answers: { m1: entries } }) });
      })
    )
  );
  const states = await Promise.all(everyone.map((me) => call('contrôler l’état', '/api/student/state', asStudent(me.token))));
  const lost = states.filter((state) => state.json().received !== true).length;
  const participants = (await follow()).json().participants ?? [];
  await timedPhase('fin du cours', async () => {
    await call('enseignant : terminer', `/api/launches/${launch.id}/end`, asTeacher({ method: 'POST', body: '{}' }));
    await Promise.all(everyone.map((me) => call('contrôler l’état', '/api/student/state', asStudent(me.token))));
  });

  return {
    students,
    routes: results().filter(({ route }) => route !== 'préparation'),
    phases,
    failures,
    lost,
    participants,
    launch,
    courseBytes: planBytes + photos * photoBytes
  };
}

const size = (bytes) => (bytes >= 1e6 ? `${(bytes / 1e6).toFixed(0)} Mo` : `${Math.ceil(bytes / 1e3)} Ko`);

function printReport(outcome) {
  const { students, routes, phases, failures, lost, participants, courseBytes } = outcome;
  console.log(`\n=== ${students} élèves, cours de ${size(courseBytes)} ===`);
  console.log(
    `${'demande'.padEnd(32)}${'nombre'.padStart(7)}${'erreurs'.padStart(9)}${'médiane'.padStart(10)}${'95 %'.padStart(10)}${'pire'.padStart(10)}${'volume'.padStart(10)}`
  );
  for (const route of routes) {
    const ms = (value) => `${Math.round(value)} ms`;
    console.log(
      `${route.route.padEnd(32)}${String(route.count).padStart(7)}${String(route.errors).padStart(9)}${ms(route.p50).padStart(10)}${ms(route.p95).padStart(10)}${ms(route.max).padStart(10)}${size(route.bytes).padStart(10)}`
    );
  }
  for (const [phase, seconds] of Object.entries(phases)) console.log(`${phase.padEnd(32)}${seconds.toFixed(1)} s`);
  const finished = participants.filter((participant) => participant.submittedAt).length;
  console.log(`vu par l'enseignant : ${participants.length} élèves entrés, ${finished} ont rendu ; réponses perdues : ${lost}`);
  if (failures.length) console.log(`REFUS OU PANNES : ${failures.length}\n  ${[...new Set(failures)].slice(0, 8).join('\n  ')}`);
  return failures.length === 0 && lost === 0 && finished === students;
}

const freePort = () =>
  new Promise((resolve) => {
    const probe = net.createServer().listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });

async function runLocally(counts) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const project = path.join(here, '..');
  const work = await mkdtemp(path.join(tmpdir(), 'ib-charge-'));
  const dist = path.join(work, 'dist');
  const data = path.join(work, 'data');
  const built = spawnSync(process.execPath, ['scripts/build.mjs', '--outdir', dist], { cwd: project, encoding: 'utf8' });
  if (built.status !== 0) throw new Error(built.stderr);

  const { openDatabase } = await import('../server/db.mjs');
  const { addAccount, cheapHash } = await import('../tests/helpers.js');
  const { mkdirSync } = await import('node:fs');
  mkdirSync(data, { recursive: true });
  const teacher = { email: 'charge@example.org', password: 'mot-de-passe-charge' };
  const db = openDatabase(path.join(data, 'app.db'));
  addAccount(db, { email: teacher.email, hash: cheapHash(teacher.password) });
  db.close();

  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, ['server/index.mjs', '--root', dist, '--data', data, '--port', String(port)], {
    cwd: project,
    stdio: ['ignore', 'ignore', 'inherit']
  });
  try {
    for (let tries = 0; tries < 100; tries++) {
      if (
        await fetch(`${base}/`).then(
          (r) => r.ok,
          () => false
        )
      )
        break;
      await sleep(100);
    }
    let allGood = true;
    for (const students of counts) {
      allGood = printReport(await simulateClass({ base, teacher, students })) && allGood;
      const [rss, cpu] = execFileSync('ps', ['-o', 'rss=,cputimes=', '-p', String(server.pid)], { encoding: 'utf8' })
        .trim()
        .split(/\s+/);
      console.log(`serveur depuis son démarrage : ${Math.round(rss / 1024)} Mo de mémoire, ${cpu} s de calcul`);
    }
    return allGood;
  } finally {
    server.kill();
    await rm(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const option = (name) =>
    process.argv
      .find((arg) => arg.startsWith(`--${name}=`))
      ?.split('=')
      .slice(1)
      .join('=');
  const counts = (option('eleves') ?? '30,50,100').split(',').map(Number);
  const address = option('adresse');
  let good;
  if (address) {
    const teacher = { email: process.env.CHARGE_EMAIL, password: process.env.CHARGE_MOT_DE_PASSE };
    good = true;
    for (const students of counts) good = printReport(await simulateClass({ base: address, teacher, students })) && good;
  } else good = await runLocally(counts);
  process.exit(good ? 0 : 1);
}
