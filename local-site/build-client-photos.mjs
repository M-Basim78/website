/**
 * Optimise the photos selected from client-assets/photos for the site.
 * Selections were made by eye from contact sheets of all 42 supplied images.
 * Portraits are cropped to a single 3:4 frame so the duality panels balance.
 */
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';

const SRC = path.resolve('..', 'client-assets', 'photos');
const OUT = path.resolve('rebuild', 'img');
fs.mkdirSync(OUT, { recursive: true });

// name, file, widths, crop mode
const JOBS = [
  // homepage duality, doctor side: her brand portrait, pink scrubs, arms crossed
  ['moss-doctor', 'IMG_9023.jpeg', [600, 1200], 'portrait'],
  // homepage duality, patient side: her as a patient. NEEDS CLIENT SIGN-OFF.
  ['moss-patient', 'IMG_0273.jpeg', [600, 1200], 'portrait'],
  // about page: navy scrubs, embroidered "Stephanie Moss, MD Psychiatry"
  ['moss-about', 'IMG_0894.jpeg', [600, 1200], 'portrait'],
  // about page secondary: graduation, Rush regalia
  ['moss-grad', 'DSC_2086.jpg', [800], 'portrait'],
  // podcast covers, already square-ish artwork, no crop
  ['pod-patient-doctor', '20260125000146_70497232.jpeg', [600], 'none'],
  ['pod-medical-school', 'Medical School with Dr. Moss.jpg', [600], 'none'],
  ['pod-residency-apps', 'Residency Applications with Dr. Moss.jpg', [600], 'none'],
  ['pod-psych-residency', 'Psychiatry Residency with Dr. Moss.jpg', [600], 'none'],
];

const manifest = {};
for (const [name, file, widths, mode] of JOBS) {
  const src = path.join(SRC, file);
  if (!fs.existsSync(src)) { console.log(`MISSING  ${file}`); continue; }

  for (const w of widths) {
    let img = sharp(src, { failOn: 'none' }).rotate();       // honour EXIF orientation
    const meta = await img.metadata();
    const W = meta.autoOrient?.width ?? meta.width;
    const H = meta.autoOrient?.height ?? meta.height;

    if (mode === 'portrait') {
      // centre crop to 3:4 without ever upscaling or squashing
      const targetRatio = 3 / 4;
      let cw = W, ch = Math.round(W / targetRatio);
      if (ch > H) { ch = H; cw = Math.round(H * targetRatio); }
      img = img.extract({
        left: Math.round((W - cw) / 2),
        top: Math.round((H - ch) / 6),                        // bias up: faces sit high
        width: cw,
        height: Math.min(ch, H - Math.round((H - ch) / 6)),
      });
    }

    const suffix = widths.length > 1 && w !== Math.max(...widths) ? `-${w}` : '';
    const out = path.join(OUT, `${name}${suffix}.webp`);
    const info = await img.resize({ width: w, withoutEnlargement: true })
      .webp({ quality: 82, effort: 6 }).toFile(out);
    if (!suffix) manifest[name] = { w: info.width, h: info.height, src: file };
    console.log(`${(name + suffix).padEnd(24)} ${W}x${H} -> ${info.width}x${info.height}  ${(info.size / 1024).toFixed(0)}KB  (${file})`);
  }
}
fs.writeFileSync(path.join(OUT, 'client-manifest.json'), JSON.stringify(manifest, null, 2));
