/**
 * The four /products/* vanity pages. These slugs 404 on her live site today and
 * are linked from the footer of every page, so they are built here from the real
 * store products only. Every price, inclusion and testimonial is sourced; nothing
 * is written that the scrape or data/testimonials.json does not support.
 *
 * /products/loa-guide has no paid product behind it. It is built as a guide page
 * pointing at her real free blog post rather than inventing something to sell.
 */
import fs from 'fs';
import path from 'path';

const R = path.resolve('rebuild');
const T = JSON.parse(fs.readFileSync(path.join(R, 'data', 'testimonials.json'), 'utf8'));
const all = [...T.featured, ...T.pool];
const byId = (id) => all.find(t => t.id === id);

const shell = fs.readFileSync(path.join(R, 'store.html'), 'utf8');
const HEADER = shell.match(/<header class="top">[\s\S]*?<\/header>/)[0];
const FOOTER = shell.match(/<footer>[\s\S]*?<\/footer>/)[0];
const DOCK = shell.match(/<nav class="dock"[\s\S]*?<\/nav>/)[0];

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const PRODUCTS = {
  'residency-personal-statement': {
    title: 'Residency Personal Statement Examples',
    desc: 'Her complete ERAS application and two real personal statements, plus a one pass edit of your own draft.',
    kicker: ['FORMAT: REAL EXAMPLE', 'CYCLE: 2026', 'LEVEL: RESIDENCY & FELLOWSHIP'],
    h1: 'Personal statement examples that actually matched',
    lede: 'See exactly what a successful application looks like, then have yours read by someone who received over 24 interviews dual applying to psychiatry and family medicine.',
    included: [
      'Her complete 2026 psychiatry fellowship submission',
      'All 10 activities, with the 3 most meaningful marked',
      'Updated publications and impactful experiences',
      'Geographic preference, written out',
      'Two full personal statements',
    ],
    buy: { p: 'p_3387065/2026-eras-and-ps-for-fellowship', price: '$30.00', label: 'See the real application', name: '2026 ERAS & PS for Fellowship' },
    also: { p: 'p_3291607/application-or-personal-statement-editing', price: '$60.00', label: 'Send your draft', name: 'Application or Personal Statement Editing' },
    quotes: ['ps-reshape-pds', 'ps-draft-comments', 'matched-psych-ps-help'],
    related: ['mock-interviews', 'usmle-accommodations'],
    cat: 'APPLICATIONS',
  },
  'mock-interviews': {
    title: 'Mock Interview Prep',
    desc: 'A realistic mock residency interview with personalised feedback, including how to answer for failures, health conditions and gaps.',
    kicker: ['FORMAT: LIVE SESSION', 'RECORDED: YES', 'LEVEL: RESIDENCY'],
    h1: 'Practise the interview before it counts',
    lede: 'A realistic mock residency interview with personalised feedback, including how to answer for academic failures, health conditions, red flags, gap years and leaves of absence.',
    included: [
      'A full mock interview in a realistic format',
      'Personalised feedback on your answers',
      'How to explain academic failures and red flags',
      'How to talk about health conditions and disability',
      'How to answer for gap years and a leave of absence',
      'A recording of the session to review afterwards',
    ],
    buy: { p: 'p_3313250/mock-interview-with-dr-moss', price: '$100.00', label: 'Book a mock interview', name: 'Mock Interview with Dr. Moss' },
    quotes: ['matched-mock-interviews', 'matched-top-im-mock', 'mock-recordings-helpful'],
    related: ['residency-personal-statement', 'usmle-accommodations'],
    cat: 'INTERVIEWS',
  },
  'usmle-accommodations': {
    title: 'USMLE Accommodations Help',
    desc: 'Her full approved accommodations application for Step 1, 2 and 3, with templates for your personal statement and your clinician letter.',
    kicker: ['FORMAT: WORKBOOK', 'COVERS: MCAT, USMLE, COMLEX', 'LEVEL: ALL'],
    h1: 'A complete accommodations request you can adapt',
    lede: 'Walk away with the whole request built. Her full approved application for Step 1, 2 and 3, the templates, and the criteria examiners look for.',
    included: [
      'Her full example accommodations application for USMLE Step 1, 2 and 3',
      'A template to build a personal statement for your individual need',
      'A template for your health professional, showing how to write a detailed supporting letter',
      'The most requested DSM-5 criteria for ADHD, MDD, GAD, panic and PTSD',
      'Workbook pages on how to disclose in applications and at school',
      'Bonus: an anonymous personal statement from a medical student with ADHD, MDD and GAD',
    ],
    buy: { p: 'p_3380308/testing-accommodations-workbook-mcat-usmle-comlex', price: '$50.00', label: 'Grab the workbook', name: 'Testing Accommodations Workbook: MCAT, USMLE, COMLEX' },
    quotes: ['accommodations-approved-no-history', 'accommodations-everything-and-more', 'failed-twice-matched-dream-location'],
    related: ['mock-interviews', 'loa-guide'],
    cat: 'USMLE ACCOMMODATIONS',
    free: { href: '/blog/accommodations-usmle', t: 'Guide to Applying for Accommodations for USMLE, COMLEX, MCAT', d: 'Her written walkthrough of the request, the documentation and the timeline.' },
  },
  'loa-guide': {
    title: 'Leave of Absence Guide',
    desc: 'What a leave of absence from medical school actually involves, from someone who took one and came back.',
    kicker: ['FORMAT: WRITTEN GUIDE', 'COST: FREE', 'LEVEL: MEDICAL SCHOOL'],
    h1: 'What a leave of absence actually involves',
    lede: 'Written by someone who took one and came back. The considerations before you go, what the paperwork asks of you, and what the return looks like.',
    // No paid product exists behind this slug. It points at her real free post.
    freeOnly: true,
    included: [
      'The considerations before taking a leave',
      'What she wishes she had known before hers',
      'How the leave interacted with Step 1 and accommodations',
      'What coming back looked like',
    ],
    free: { href: '/blog/leave-of-absence', t: 'Considerations Before Taking a Leave of Absence (LOA) from Medical School', d: 'Her full written guide. Free to read, no email required.' },
    quotes: ['matched-number-one-after-step1-loa', 'loa-op-ed-less-alone'],
    related: ['usmle-accommodations', 'mock-interviews'],
    cat: 'LEAVE OF ABSENCE',
  },
};

const card = (q) => q ? `      <figure class="qc">
        <span class="mark" aria-hidden="true">&ldquo;</span>
        <blockquote>${esc(q.quote)}</blockquote>
        <figcaption class="by">${esc(q.attribution)}${q.context ? ' &middot; ' + esc(q.context) : ''}</figcaption>
      </figure>` : '';

const relatedTile = (slug, i) => {
  const r = PRODUCTS[slug];
  return `      <a class="tile t${i + 3}" href="/products/${slug}">
        <span class="num"><span>ALSO</span><span class="cat">${r.cat}</span></span>
        <h3>${esc(r.title)}</h3>
        <p>${esc(r.desc)}</p>
        ${r.buy ? `<span class="price">${r.buy.price}</span>` : '<span class="price">Free</span>'}
        <span class="cta">Read more</span>
      </a>`;
};

let n = 0;
for (const [slug, p] of Object.entries(PRODUCTS)) {
  const url = `/products/${slug}`;
  const quotes = p.quotes.map(byId).filter(Boolean);

  const ld = {
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'Person', '@id': 'https://medpsycmoss.com/#person', name: 'Stephanie Moss', honorificSuffix: 'MD' },
      ...(p.buy ? [{
        '@type': 'Product',
        name: p.buy.name,
        description: p.desc,
        brand: { '@type': 'Brand', name: 'MedPsycMoss' },
        url: `https://medpsycmoss.com/store/${p.buy.p}`,
        offers: {
          '@type': 'Offer', price: p.buy.price.replace('$', ''), priceCurrency: 'USD',
          availability: 'https://schema.org/InStock',
          url: `https://medpsycmoss.com/store/${p.buy.p}`,
        },
      }] : []),
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Home', item: 'https://medpsycmoss.com/' },
          { '@type': 'ListItem', position: 2, name: 'Store', item: 'https://medpsycmoss.com/store' },
          { '@type': 'ListItem', position: 3, name: p.title, item: `https://medpsycmoss.com${url}` },
        ],
      },
    ],
  };

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">

<title>${esc(p.title)} | MedPsycMoss</title>
<meta name="description" content="${esc(p.desc)}">
<link rel="canonical" href="https://medpsycmoss.com${url}">
<meta name="author" content="Stephanie Moss, MD">
<meta name="theme-color" content="#6E1F35">
<link rel="icon" href="/new/favicon.svg" type="image/svg+xml">

<meta property="og:type" content="website">
<meta property="og:site_name" content="MedPsycMoss | Stephanie Moss, MD">
<meta property="og:url" content="https://medpsycmoss.com${url}">
<meta property="og:title" content="${esc(p.title)} | MedPsycMoss">
<meta property="og:description" content="${esc(p.desc)}">
<meta property="og:image" content="https://medpsycmoss.com/img/moss-doctor.webp">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="1600">
<meta property="og:image:alt" content="Stephanie Moss, MD.">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(p.title)} | MedPsycMoss">
<meta name="twitter:description" content="${esc(p.desc)}">
<meta name="twitter:image" content="https://medpsycmoss.com/img/moss-doctor.webp">

<link rel="preload" href="/new/fonts/bricolage-grotesque-300-800.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/new/fonts/inter-400-600.woff2" as="font" type="font/woff2" crossorigin>
<script>document.documentElement.classList.add("js")</script>
<link rel="stylesheet" href="/new/css/site.css">
<script src="/new/js/site.js" defer></script>
</head>
<body>

<a class="skip" href="#main">Skip to content</a>

${HEADER}

<main id="main">

<section class="hero" aria-labelledby="p-title">
  <div class="mesh"></div>
  <div class="wrap">
    <p class="kicker reveal in">${p.kicker.map(k => `<span>${esc(k)}</span>`).join('')}</p>
    <h1 id="p-title">${esc(p.h1)}</h1>
    <p class="sub">${esc(p.lede)}</p>
    <div class="hero-cta">
      ${p.buy
      ? `<a class="btn" data-p="${p.buy.p}" href="https://medpsycmoss.com/store/${p.buy.p}">${esc(p.buy.label)} &middot; ${p.buy.price}</a>
      <a class="btn dark" href="/store">Browse the store</a>`
      : `<a class="btn" href="${p.free.href}">Read the guide free</a>
      <a class="btn dark" href="/store">Browse the store</a>`}
    </div>
  </div>
</section>

<section aria-labelledby="inc-title">
  <div class="wrap">
    <div class="head reveal">
      <span class="vital">What is included</span>
      <h2 id="inc-title">Everything in <span class="hl">${esc(p.title)}</span></h2>
    </div>
    <div class="free-list reveal">
${p.included.map(i => `      <div class="fr"><span><span class="t">${esc(i)}</span></span></div>`).join('\n')}
    </div>
${p.buy ? `    <div class="store-more reveal"><a class="btn" data-p="${p.buy.p}" href="https://medpsycmoss.com/store/${p.buy.p}">${esc(p.buy.label)} &middot; ${p.buy.price}</a></div>` : ''}
  </div>
</section>
${p.free ? `
<section aria-labelledby="free-title">
  <div class="wrap">
    <div class="head reveal">
      <span class="vital">Free resource</span>
      <h2 id="free-title">Start here. <span class="hl">No cost, no catch.</span></h2>
    </div>
    <div class="free-list reveal">
      <a href="${p.free.href}" class="fr">
        <span><span class="cat">${esc(p.cat)}</span><span class="t">${esc(p.free.t)}</span><span class="d">${esc(p.free.d)}</span></span>
        <span class="tagm">FREE</span>
      </a>
    </div>
  </div>
</section>` : ''}
${quotes.length ? `
<section aria-labelledby="say-title">
  <div class="wrap">
    <div class="head reveal">
      <span class="vital">In their words</span>
      <h2 id="say-title">What students <span class="hl">say about this</span></h2>
    </div>
    <div class="quotes reveal">
${quotes.map(card).join('\n')}
    </div>
  </div>
</section>` : ''}

<section aria-labelledby="rel-title">
  <div class="wrap">
    <div class="head reveal">
      <span class="vital">Related</span>
      <h2 id="rel-title">Students who needed this <span class="hl">also needed</span></h2>
    </div>
    <div class="bento reveal">
${p.related.map(relatedTile).join('\n')}
${p.also ? `      <a class="tile t5" data-p="${p.also.p}" href="https://medpsycmoss.com/store/${p.also.p}">
        <span class="num"><span>ALSO</span><span class="cat">EDITING</span></span>
        <h3>${esc(p.also.name)}</h3>
        <p>One pass across all 10 activities, your 3 most meaningful, publications and impactful experience.</p>
        <span class="price">${p.also.price}</span>
        <span class="cta">${esc(p.also.label)}</span>
      </a>` : ''}
    </div>
  </div>
</section>

</main>

${FOOTER}

${DOCK}

<script type="application/ld+json">
${JSON.stringify(ld, null, 2)}
</script>
</body>
</html>
`;

  fs.writeFileSync(path.join(R, `products_${slug}.html`), html);
  console.log(`products_${slug}.html`.padEnd(46) + `${url}   quotes:${quotes.length}  ${p.buy ? p.buy.price : 'free'}`);
  n++;
}
console.log(`\n${n} product pages written`);
