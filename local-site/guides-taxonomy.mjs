/**
 * The Free Guides taxonomy she asked for, mapped onto content that exists.
 *
 *   Premed              -> College, Applying, MCAT
 *   Medical School      -> Pre-Clinical, Clinical, Leave of Absence
 *   USMLE Exams         -> Step 1, Step 2, Step 3, Failure
 *   Disabilities        -> Accommodations
 *   Residency           -> Prepare Application, Interviews, Rank
 *   Psychiatry
 *
 * Assignment is by her own post tags first, because those are her editorial
 * decisions. Her tags do not split Step 1/2/3, Interviews or Rank, so those
 * subgroups fall back to keywords in the post title and slug. Every assignment
 * is reported by source (`tag` or `keyword`) so she can check the guesses.
 */

import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.slice(1)));
const BACKUP = path.resolve(ROOT, '..', 'medpsycmoss-backup-20260727', 'backup');
const REBUILD = path.join(ROOT, 'rebuild');

const unslug = s => decodeURIComponent(String(s).replace(/-20/g, '%20'));

/** post slug -> Set(tag), read from her archived tag pages. */
export function postTags() {
  const map = new Map();
  const dir = path.join(BACKUP, 'content');
  for (const f of fs.readdirSync(dir)) {
    if (!f.startsWith('blog_tag_') || !f.endsWith('.md')) continue;
    const tag = unslug(f.slice('blog_tag_'.length, -3).replace(/_page_\d+$/, ''))
      .replace(/%20/g, ' ').trim();
    const txt = fs.readFileSync(path.join(dir, f), 'utf8');
    const body = txt.includes('## Link map') ? txt.split('## Link map')[1] : txt;
    for (const m of body.matchAll(/medpsycmoss\.com\/blog\/([^)\s/]+)\)/g)) {
      const slug = decodeURIComponent(m[1]);
      if (slug.startsWith('tag')) continue;
      if (!map.has(slug)) map.set(slug, new Set());
      map.get(slug).add(tag);
    }
  }
  return map;
}

/**
 * Turn HTML entities back into characters.
 *
 * Titles and descriptions are read out of built HTML, so they arrive holding
 * "&amp;". Escaping that again on output produced "&amp;amp;", which is what a
 * reader actually saw: "ERAS &amp; PS Guide". Decode on the way in, escape on
 * the way out, once each.
 */
export const decode = s => String(s || '')
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
  .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&nbsp;/g, ' ')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&amp;/g, '&');            // last, or it would double-decode

/** Every blog post page that actually exists in rebuild/, with its article text. */
export function builtPosts() {
  const out = [];
  for (const f of fs.readdirSync(REBUILD)) {
    if (!f.startsWith('blog_') || !f.endsWith('.html')) continue;
    if (/^blog_tag_/.test(f)) continue;
    const slug = f.slice('blog_'.length, -5);
    const html = fs.readFileSync(path.join(REBUILD, f), 'utf8');
    const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/);
    const title = decode((h1 ? h1[1] : '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim());

    // Article text only. <main> excludes the header, footer and dock, so the
    // shared chrome cannot make every post match every keyword.
    const main = html.match(/<main[^>]*>([\s\S]*?)<\/main>/);
    const body = (main ? main[1] : '')
      .replace(/<script[\s\S]*?<\/script>/g, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&[a-z]+;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    const desc = html.match(/<meta name="description" content="([^"]*)"/);
    out.push({
      slug, file: f, url: '/blog/' + slug, title, body,
      desc: decode(desc ? desc[1] : ''),
    });
  }
  return out;
}

/**
 * tags:     any of these tags puts the post in this subgroup
 * any:      keyword regex against "title slug", used where no tag exists
 * not:      excludes a post even if the above matched
 */
export const TAXONOMY = [
  {
    key: 'premed', name: 'Premed', blurb:
      'Getting into medical school: undergrad, the application, and the MCAT.',
    children: [
      { key: 'college', name: 'College', tags: ['pre-med'],
        any: /\b(college|undergrad|gap year|post-?bacc)\b/i,
        blurb: 'Undergrad years, choosing a path, and getting ready to apply.' },
      { key: 'applying', name: 'Applying', tags: ['medical school app'],
        any: /\b(amcas|primary application|secondar(y|ies)|apply(ing)? to medical school|personal statement)\b/i,
        blurb: 'The medical school application itself, start to finish.' },
      { key: 'mcat', name: 'MCAT', tags: ['mcat'], any: /\bmcat\b/i,
        blurb: 'Studying for the MCAT, and what to do about a low score.' },
    ],
  },
  {
    key: 'medical-school', name: 'Medical School', blurb:
      'Pre-clinical years, clinical rotations, and taking a leave of absence.',
    children: [
      { key: 'pre-clinical', name: 'Pre-Clinical', tags: ['pre-clinical'],
        any: /\b(m1|m2|pre-?clinical|first year|second year)\b/i,
        blurb: 'The classroom years, M1 and M2.' },
      { key: 'clinical', name: 'Clinical', tags: ['ms3'],
        any: /\b(ms3|m3|clinical rotation|clerkship|third year|sub-?i)\b/i,
        blurb: 'Rotations, the wards, and third year.' },
      { key: 'leave-of-absence', name: 'Leave of Absence', tags: ['loa'],
        any: /\b(leave of absence|\bloa\b|taking time off)\b/i,
        blurb: 'Taking a leave of absence, and coming back from one.' },
    ],
  },
  {
    key: 'usmle', name: 'USMLE Exams', blurb:
      'Step 1, Step 2 and Step 3, and what to do when an exam does not go your way.',
    children: [
      { key: 'step-1', name: 'Step 1', any: /\bstep\s?1\b/i,
        blurb: 'Preparing for and sitting Step 1.' },
      { key: 'step-2', name: 'Step 2', any: /\bstep\s?2\b|\bck\b/i,
        blurb: 'Step 2 CK, and how it fits the residency application.' },
      { key: 'step-3', name: 'Step 3', any: /\bstep\s?3\b/i,
        blurb: 'Step 3, usually taken during residency.' },
      { key: 'failure', name: 'Failure', tags: ['failure'],
        any: /\bfail(ed|ing|ure)?\b|\bremediat/i,
        blurb: 'Failing an exam, and building a way forward from it.' },
    ],
  },
  {
    key: 'disabilities', name: 'Disabilities', blurb:
      'Studying and practising medicine with a disability, and getting accommodations.',
    children: [
      { key: 'accommodations', name: 'Accommodations',
        any: /\baccommodat/i,
        blurb: 'Requesting testing and clinical accommodations, with real examples.' },
      { key: 'disability-in-medicine', name: 'Disability in Medicine', tags: ['disability'],
        any: /\bdisabilit|\bchronic illness\b|\baccessib/i,
        blurb: 'Being a medical student, resident or physician with a disability.' },
    ],
  },
  {
    key: 'residency', name: 'Residency Applications', blurb:
      'Preparing the application, interview season, and the rank list.',
    children: [
      { key: 'prepare-application', name: 'Prepare Application',
        tags: ['residency app'],
        any: /\beras\b|\bpersonal statement\b|residency application|\bdual appl/i,
        blurb: 'ERAS, the personal statement, and putting the application together.' },
      { key: 'interviews', name: 'Interviews', any: /\binterview/i,
        blurb: 'Interview season, preparation and what gets asked.' },
      { key: 'rank', name: 'Rank', any: /\brank\b|\bnrmp\b|\bthe match\b|\bmatch (list|day|week)\b|\bsoap\b/i,
        blurb: 'Building the rank list, and Match week.' },
    ],
  },
  {
    key: 'psychiatry', name: 'Psychiatry', blurb:
      'Choosing psychiatry, and life as a psychiatry resident.',
    children: [
      { key: 'psychiatry-residency', name: 'Psychiatry', tags: ['psychiatry'],
        any: /\bpsychiatr/i,
        blurb: 'The specialty, residency, and the work itself.' },
    ],
  },
];

/** Assign posts to subgroups. Returns {groups, unassigned}. */
export function assign() {
  const tags = postTags();
  const posts = builtPosts();

  for (const p of posts) {
    p.tags = [...(tags.get(p.slug) || [])];
    p.head = (p.title + ' ' + p.slug.replace(/[-_]/g, ' ') + ' ' + p.desc).toLowerCase();
    p.text = p.body.toLowerCase();
  }

  const groups = TAXONOMY.map(g => ({
    ...g,
    children: g.children.map(c => ({ ...c, posts: [] })),
  }));

  const count = (re, s) => {
    const m = s.match(new RegExp(re.source, re.flags.replace('g', '') + 'g'));
    return m ? m.length : 0;
  };

  for (const p of posts) {
    for (const g of groups) {
      for (const c of g.children) {
        if (c.not && (c.not.test(p.head) || c.not.test(p.text))) continue;

        // Her own tag is the strongest signal, then the title, then the body.
        // A body match needs to be repeated, so one passing mention of
        // "interview" does not file a post under Interviews.
        let why = null;
        if ((c.tags || []).some(t => p.tags.includes(t))) why = 'tag';
        else if (c.any && c.any.test(p.head)) why = 'title';
        else if (c.any && count(c.any, p.text) >= 3) why = 'body';

        if (why) c.posts.push({ ...p, why });
      }
    }
  }

  // Strongest signal first, then alphabetical, so pages are stable between builds.
  const rank = { tag: 0, title: 1, body: 2 };
  for (const g of groups) {
    for (const c of g.children) {
      c.posts.sort((a, b) => rank[a.why] - rank[b.why] || a.title.localeCompare(b.title));
    }
    // The group page shows everything beneath it, deduplicated.
    const seen = new Set();
    g.posts = [];
    for (const c of g.children) {
      for (const p of c.posts) {
        if (seen.has(p.slug)) continue;
        seen.add(p.slug);
        g.posts.push(p);
      }
    }
  }

  const placed = new Set();
  for (const g of groups) for (const c of g.children) for (const p of c.posts) placed.add(p.slug);
  const unassigned = posts.filter(p => !placed.has(p.slug));

  return { groups, unassigned, posts };
}
