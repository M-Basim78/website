/**
 * Pull the real images out of the archive and emit optimised WebP for the
 * rebuilt homepage.  Source URLs come straight from the scraped markdown, so
 * every asset here is one the live site actually uses.
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import sharp from 'sharp';

const BK = path.resolve('..', 'medpsycmoss-backup-20260727', 'backup');
const CDN = path.join(BK, 'assets', 'medpsycmoss.com', 'x', 'cdn');
const OUT = path.resolve('rebuild', 'img');
fs.mkdirSync(OUT, { recursive: true });

const cdnFile = (url) =>
  path.join(CDN, 'index__q' + crypto.createHash('md5').update(url).digest('hex').slice(0, 10));

const G0 = 'https://storage.googleapis.com/production-gator-v1-0-0/000/1170000/Xlwz0WqW/';
const G4 = 'https://storage.googleapis.com/production-gator-v1-0-4/134/1819134/o4vX20jy/';
const BSVC = (id) =>
  `https://images.builderservices.io/s/cdn/v1.0/i/m?url=https%3A%2F%2Fstorage.googleapis.com%2Fproduction-gator-v1-0-0%2F000%2F1170000%2FXlwz0WqW%2F${id}&methods=resize%2C450%2C5000`;

// name, source url, max width.  Ceilings from the brief are portrait ≤1200 /
// tiles ≤800, but covers only ever render at 120–140 CSS px, so the 800w copy
// is pure waste — 300w covers 2x and 450w covers 3x displays.
const COVERS = {
  advising:   BSVC('d48cdc98b18a43f682cde6583473678e'),
  fellowship: G0 + 'f65ec049a1e1439e82e3a1960a82505d',
  workbook:   G0 + '3d48ca8d6901465581fe623f98339cb7',
  accommod:   BSVC('bbca3e80d90745ce9bd15cdd676d23cc'),
  mock:       G0 + '2247331888734dea8b2cb19cddd79218',
  // Added when the four products Gator was hiding came across. Every product
  // gallery puts its cover at index 4; the first three are site chrome.
  'eras-full': G0 + '7728fb4e62e149498fec37ca42395be2',
  medschool:  G0 + '5c9f87fe27e1428bb0ea43af1f961ba1',
};

// The patient-side portrait is published on her leave-of-absence and Step 1
// posts — the two events that half of the page is about.  It is a 3:2 landscape
// original, so it is cropped to the same 3:4 frame as the doctor-side portrait.
// She sits just right of centre, hence the 1394px left offset.
const PT = G0 + '47fd3dce44a340eb9e0ac12aeac2c361';
const PT_CROP = { left: 1394, top: 0, width: 2586, height: 3448 };

const JOBS = [
  ['portrait',     G4 + '7bde2b2e185d468693147e7aa76f0477', 1200],
  ['portrait-600', G4 + '7bde2b2e185d468693147e7aa76f0477', 600],   // srcset for phones
  ['portrait-pt',     PT, 1200, PT_CROP],
  ['portrait-pt-600', PT, 600,  PT_CROP],
  ...Object.entries(COVERS).flatMap(([n, u]) => [[`${n}-300`, u, 300], [n, u, 450]]),
];

const manifest = {};
for (const [name, url, maxW, crop] of JOBS) {
  const src = cdnFile(url);
  if (!fs.existsSync(src)) { console.log(`MISSING  ${name}`); continue; }
  const input = sharp(src, { failOn: 'none' });
  const meta = await input.metadata();
  if (crop) input.extract(crop);
  const width = Math.min(maxW, crop ? crop.width : meta.width);
  const out = path.join(OUT, `${name}.webp`);
  const info = await input.resize({ width, withoutEnlargement: true })
    .webp({ quality: 82, effort: 6 })
    .toFile(out);
  manifest[name] = { w: info.width, h: info.height, bytes: info.size };
  console.log(
    `${name.padEnd(12)} ${meta.width}x${meta.height} ${(fs.statSync(src).size / 1024).toFixed(0)}KB` +
    `  ->  ${info.width}x${info.height} ${(info.size / 1024).toFixed(0)}KB`
  );
}
fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));
