# MedPsycMoss design system

Every page reads this file first. The homepage (`rebuild/index.html`) is the
reference implementation. When this document and the homepage disagree, the
homepage wins and this file gets fixed.

## Non-negotiables

1. **Never invent content.** Every fact, price, product name, episode title,
   resource name and quote comes from `../medpsycmoss-backup-20260727/backup/content/*.md`,
   `backup/pages/*.html`, or `rebuild/data/*.json`. If a page has thin source
   content, ship it short and clean. Do not pad.
2. **Statistics come only from `rebuild/data/stats.json`.** No other numbers.
3. **Testimonials come only from `rebuild/data/testimonials.json`.** Verbatim.
   Do not edit, merge or improve them. The `_excluded` list stays excluded.
4. **No em dashes or en dashes in visible copy.** Split the sentence, or use a
   comma, colon or full stop. Hyphens in compound words are fine
   (`trauma-informed`, `Patient-Doctor`). `check-dashes.mjs` enforces this.
5. **Keep the existing URL slug** for every page. Do not invent new routes.

## Files

| Path | Purpose |
|---|---|
| `rebuild/css/site.css` | All tokens and component styles. **Never fork per page.** Add new components here. |
| `rebuild/js/site.js` | Store links, ECG sweep, marquee, scroll reveals, dock state. Every block is guarded, so a page can omit any component. |
| `rebuild/partials/head.html` | Head boilerplate. Replace `TITLE`, `DESCRIPTION`, `SLUG`. |
| `rebuild/partials/header.html` | Sticky top bar. Copy verbatim, change only which nav item is current. |
| `rebuild/partials/footer.html` | Footer. Copy verbatim. |
| `rebuild/partials/dock.html` | Mobile dock. Copy verbatim. |
| `rebuild/data/stats.json` | The only permitted statistics. |
| `rebuild/data/testimonials.json` | 6 `featured`, 23 in `pool` tagged by topic. |

## Palette

Her brand: maroon (her favourite), light pink, white, navy (her scrub colour).
Every pair below was checked for WCAG AA on its intended background by
`contrast.mjs`. **19 pairs, zero failures.** There is no teal anywhere.

```
--base       #FFFFFF   page background
--tint       #FBF1F4   light pink, section backgrounds
--tint-deep  #F7E8EC   light pink, cards and the patient panel
--navy-tint  #EFF1F7   the doctor panel
--ink        #1B2A4A   navy, body copy and hero type      14.22:1 on white
--muted      #55607D   navy grey, secondary copy           6.26:1 on white
--primary    #6E1F35   deep maroon, buttons, links        10.99:1 on white
--primary-hi #8C2A45   hover
--accent     #A63A57   ECG trace, vital dots, quote marks  6.24:1 on white
--chip       #F3C6D2   pill background
--chip-ink   #4A1424   text on a pill                      9.75:1 on chip
--on-dark    #F7D9E2   pink text on dark panels           10.82:1 on navy
--dark-a     #4A1526   dark panel gradient start (maroon)
--dark-b     #1B2A4A   dark panel gradient end (navy)
--line       rgba(27,42,74,0.14)
--line-soft  rgba(27,42,74,0.08)
```

Legacy aliases (`--pulse`, `--pulse-ink`, `--bg`, `--bg-2`, `--coral`, `--blue`)
still resolve to the new tokens so old rules keep working. **Use the new names in
new code.**

If you add a colour, run `node contrast.mjs` first. A pair below 4.5:1 for normal
text does not ship.

## Type

```
--display  'Bricolage Grotesque'   h1, h2, h3, .fr .t, .foot-logo
--body     'Inter'                 everything else
--mono     'JetBrains Mono'        .vital, .kicker, .num, .cat, .m, .disc, .stat .l
```

Self-hosted from `rebuild/fonts/`, latin subset, `font-display:swap`. Do not add
a Google Fonts link; it costs a render-blocking third-party round trip.

## Layout

- `.wrap` caps content at **1140px** with 20px padding (40px above 780px).
- Every band, including tinted and dark panels, sits **inside** `.wrap`. Nothing
  is full-bleed. All bands measure 1060px at desktop. Verify with `measure.mjs`.
- Mobile first. Base styles are the phone; one media query at `min-width:780px`
  scales up.
- `section{padding:68px 0}`, 96px above 780px.

## Components

| Class | Use |
|---|---|
| `.vital` | Mono section label with the pulsing dot. One per section head. |
| `.head` | `.vital` + `h2` + optional `p` intro. |
| `.btn` / `.btn.dark` | Primary maroon, and outline. Min height 50px. |
| `.ecg` | The chart-paper strip with the looping sweep. Hero only. |
| `.marquee` | Scrolling topic strip. `aria-hidden`, decorative. |
| `.bento` + `.tile` | Product grid. `.feature` spans 4 of 6, `.t2` spans 2, `.t3` to `.t6` span 3. `.has-chip` reserves corner space for `.chip`. |
| `.stats-panel` + `.stat` | Credibility strip. Values from `stats.json` only. |
| `.free-list` + `.fr` | Free resource rows: `.cat` category, `.t` title, `.d` blurb, `.tagm` FREE pill. |
| `.quotes` + `.qc` | Testimonial cards. `.qc.long` spans two rows on desktop. |
| `.dual-panel` + `.half.pt` / `.half.dr` | Patient (pink) and doctor (navy) panels inside one rounded card, plus `.dual-quote`. |
| `.pod-in` + `.pod-shelf` + `.epi` | Podcast band and snap-scrolling episode cards with the waveform. |
| `.sub-box` | Dark email-capture band. |
| `.reveal` | Scroll-in animation. Add to top-level blocks, not to every child. |

## Copy rules

- **Action-verb CTAs.** "Grab the workbook", "Book a session", "Start here free",
  "Browse the store", "Send your draft". Professional. She is a physician, not an
  influencer.
- **Benefit-led first sentence** on product cards: what the student walks away
  with. Supporting detail after. Never a claim the scrape does not support.
- **Category tags** use the words a student would search: `USMLE ACCOMMODATIONS`,
  `RESIDENCY`, `INTERVIEWS`, `APPLICATIONS`, `LEAVE OF ABSENCE`, `ERAS & FELLOWSHIP`,
  `MED SCHOOL`, `TRAUMA-INFORMED CARE`, `PELVIC PAIN`, `SEXUAL HEALTH`.
- **Her disclaimer is verbatim** in the footer, typos corrected only:
  *All thoughts are my own, not representative of any organization (including my
  employer), and are not medical, psychiatric, nor financial advice.*
  Resource pages must also carry an education-not-medical-advice note in her wording.

## Store links

Every checkout link is built from one constant in `js/site.js`:

```js
var STORE_BASE = 'https://medpsycmoss.com/store';   // becomes store.medpsycmoss.com at launch
```

Write the real `href` in the HTML **and** a `data-p="p_XXXXXXX/slug"` attribute.
The script rewrites the href from `STORE_BASE`. This keeps the page working with
JavaScript disabled and crawlable.

## Accessibility and mobile floor

Every page must pass, at 360, 390, 430, 768, 1024 and 1280:

- zero horizontal scrolling
- every tap target at least 44px on mobile
- the fixed dock never covers content; `body` carries
  `padding-bottom:calc(var(--dock-h) + var(--dock-gap) + 24px + env(safe-area-inset-bottom))`
  below 780px, and the dock itself uses `env(safe-area-inset-bottom)`
- exactly one `h1`, logical `h2`/`h3` order, semantic landmarks, skip link
- images have `width`/`height`, `loading="lazy"` below the fold, descriptive `alt`
- all animation respects `prefers-reduced-motion`

Run `node qa.mjs <out>` to check all of it at once. Zero problems is the bar.

## Per-page SEO

Unique `<title>` and meta description, canonical on the real slug, OG and Twitter
tags, and JSON-LD: `Person` sitewide, plus `Product` with real prices on product
pages. Lighthouse mobile 90+ on all four categories (`node lh.mjs <url> <out>`).
