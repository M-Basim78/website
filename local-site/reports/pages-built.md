# Remaining pages: built

Follow-on to `handoff.md`. Written on the machine that has the backup archive
but **no** access to her Gator or Bluehost accounts, so nothing in section 3 of
the handoff (contact form backend) was touched. That is still the blocker.

## What changed

The site went from **8 pages to 90**. All 90 pass the accessibility and mobile
bar, and a generated page scores the same as the hand-built ones.

| | before | after |
|---|---:|---:|
| pages | 8 | 90 |
| resource libraries | 0 | 17 |
| library child pages | 0 | 63 |
| other pages | 0 | 3 (`/events`, `/interviews`, `/vlogs`) |
| `sitemap.xml` | not generated | 90 urls |
| resource links carried over | 0 | 743 |

### The scope was larger than the handoff recorded

`handoff.md` section 2b lists **10** resource pages. There are actually **17**
libraries: the 10 patient libraries plus 7 provider libraries that `/resources`
links as `.fr` rows rather than `.tile` cards (`/trauma-informed-care`,
`/pelvic-pain-patients`, `/older-adult-patients`, `/patients-with-disabilities`,
`/black-and-brown-patients`, `/lgbtqia-individuals`,
`/podcasts-for-healthcare-providers`).

Each library is a hub, not a leaf. Beneath the 17 sit **63 more pages** holding
the actual links. Total build: 83 new pages.

## Verified, not claimed

| Check | Result |
|---|---|
| `node qa-pages.mjs` across all 90 pages, widths 360 / 768 / 1280 | **0 problems** |
| exactly one `h1`, unique title, description and canonical | all 90 |
| em or en dashes in rendered text | 0 |
| horizontal overflow at any width | 0 |
| tap targets under 44px on mobile | 0 |
| Lighthouse mobile, `/support-groups-endometriosis` | **99 / 100 / 100 / 100** |

`qa-pages.mjs` applies the same rule `qa.mjs` applies to the homepage, including
its exclusions for `.marquee` and the skip link.

## How the pages were built

`build-resources.mjs` reads the archived DOM through a headless browser and
renders it onto the shared shell. Nothing is written by hand, so a re-run picks
up a fresh crawl.

The one non-obvious part: **Gator is an absolutely-positioned canvas**. A
resource card is a bare overlay `<a>` with no text, and its title lives in an
unrelated sibling `div` that merely happens to be painted on top of it. DOM
structure cannot pair the two. `extract-page.js` pairs them geometrically, by
which text is painted inside the link's own box, which is how a reader pairs
them. That is why this runs in a browser rather than with a parser.

Label provenance across the 743 links:

| source | count |
|---|---:|
| the link's own text | 272 |
| text painted inside the card | 57 |
| nearest text above the card | 76 |
| **no name anywhere in the archive** | **73** |

Those 73 fall back to a name derived from the URL, for example
`podcasts.apple.com/us/podcast/transforming-trauma/id1496190024` becomes
"Transforming Trauma". They are the cases where the only human-readable title
was baked into the thumbnail image, so no amount of parsing recovers it. Worth
a skim before launch. Full detail in `reports/resource-build.json`.

## 11 pages ship with an empty state

These render a short "this list is not available" panel instead of links:

`podcasts-lgbtqia-health`, `podcasts-on-endometriosis`, `podcasts-on-infertility`,
`podcasts-on-pelvic-pain`, `podcasts-sexual-health`, `posts-black-and-brown-patients`,
`posts-endometriosis`, `posts-mental-health`, `posts-trauma-informed-care`,
`providers-lgbtqia`, `videos-for-trauma-informed-care`

In the archive these pages contain **only** header and footer chrome. Their
content is drawn by Gator's list widget, and that widget's endpoint
(`{ServicesBasePath}/lists` action `fetchContent`) returns 404 in production.
This corroborates handoff section 4.7 and narrows it: **individual blog posts
render fine** (154 of them are in the archive with full bodies) and it is the
*collection* widget that is broken. So the tag pages, post lists and these 11
pages are the affected set.

To fill them we need the underlying lists exported from her Gator account. That
is a section 3 item, for the machine that can log in.

## Fixes made to the existing tooling

- **19 scripts could not run on any machine but the original.** They hardcoded
  `...\ms-playwright\chromium-1187\chrome-win\chrome.exe`, a build that does not
  exist here. The option is removed so Playwright resolves its own browser, and
  `lh.mjs` now asks Playwright for the path. This is why the tooling appeared
  broken when the branch was first pulled.
- **`serve.js` needs the archive** at `../medpsycmoss-backup-20260727/backup`,
  but `local-site/archive/` is gitignored and was never pushed. Unzip
  `medpsycmoss-backup-20260727.zip` beside `local-site`, or point a junction at
  an existing `backup/` folder.
- **New CSS component `.crumbs`** in `site.css` (breadcrumbs, with the 44px tap
  floor on mobile), plus `overflow-wrap:anywhere` on `.fr .t` / `.fr .d` because
  third-party titles and bare URLs are long single tokens that were forcing a
  horizontal scrollbar at 360px. No per-page CSS was forked.

## Still not built

- The **4 product pages** (`/products/*`). Unchanged from handoff 2a: these
  return 404 on her live site and are footer-linked from every page. They need
  her decision on whether the vanity slugs should exist at all, and content if
  they should. Nothing was invented for them.
- The **contact form backend**. Handoff section 3, unchanged.
- The **CSS conflict pass** flagged in handoff section 6. My additions are
  appended and scoped to new class names, so they do not add to that risk, but
  the ~460 lines the seven page agents appended concurrently still deserve a
  read.
