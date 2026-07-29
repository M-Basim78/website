# medpsycmoss.com — local mirror

Serves the 2026-07-27 archive in `../medpsycmoss-backup-20260727/backup` as a
running website on `http://localhost:8123`, so the current site can be inspected,
compared against the live one, and used as the baseline for a rebuild.

```
node serve.js                 # live fallback on  (recommended)
node serve.js --offline       # archive only, no network
node serve.js --port 9000
node serve.js --keep-analytics
```

| URL | what it is |
| --- | --- |
| `http://localhost:8123/` | the archived site — every route works (`/about-me`, `/blog`, `/store`, …) |
| `http://localhost:8123/new` | **the rebuilt homepage** (see below) |
| `http://localhost:8123/__compare?p=/blog` | archive mirror next to the crawler's screenshot of the live site |
| `http://localhost:8123/__shot/<page>.png` | a raw archived screenshot |

## The rebuilt homepage — `rebuild/`

A single self-contained page built on the `medpsycmoss-light.html` design system
with real content from the scrape. It links back into the archive mirror for
internal routes, so the whole site is navigable while only the homepage is new.

```
node build-images.mjs     # archive -> rebuild/img/*.webp (portrait + 5 covers, 2 widths each)
node build-fonts.mjs      # Google Fonts -> rebuild/fonts/*.woff2 (self-hosted, latin only)
node check-new.mjs <out>  # 360/390/768/1280 screenshots + console errors + link resolve check
node lh.mjs <url> <out>   # Lighthouse mobile, writes report.html
node measure.mjs 1920     # print the left/width/right of every section band
node tour-new.mjs 390 844 <out>   # section-by-section capture at a given viewport

node build-share.mjs      # -> share/medpsycmoss-homepage.html, one self-contained file
node check-share.mjs <out># proves it renders identically with zero network requests
node qa.mjs <out>         # 360/390/430/768/1024/1280: dashes, overflow, tap targets, dock overlap
node check-dashes.mjs <file|url>   # exits non-zero if any em/en dash reaches rendered text
node shot-pos.mjs 390 <out>        # viewport captures at the top and the very bottom
node shot-duality.mjs <out>        # duality panel plus its two halves' height balance
```

House style: **no em or en dashes in visible copy.** `check-dashes.mjs` enforces
it on both the served page and the share file; `qa.mjs` walks every text node at
every breakpoint. Hyphens in compound words are fine.

`share/medpsycmoss-homepage.html` is the client deliverable: fonts and images
embedded as data URIs, site links repointed at medpsycmoss.com, 541 KB, opens by
double-clicking with no server and no internet. `check-share.mjs` compares it
against the served page — same height, same images, 0 external requests.

Every band is capped at the same 1060px column. The duality panel and the
podcast band were full-bleed in the source template — at 1920px they ran the
whole viewport while every other section stopped at 1140px, which read as a
layout break. Both are now contained rounded panels inside `.wrap`. `measure.mjs`
is the check for this.

Lighthouse mobile: **Performance 99, Accessibility 100, Best Practices 100, SEO 100**
(FCP 1.0 s, LCP 2.0 s, TBT 0 ms, CLS 0). Total page weight 499 KB including all
image variants; the initial view loads ~180 KB.

Every checkout link is built from one constant, `STORE_BASE` in the page script —
change it to `https://store.medpsycmoss.com` at launch and nothing else moves.
The `href`s are already written out in the HTML so the page works without
JavaScript and is crawlable as-is.

`serve.js` gzips text responses. Without that a local Lighthouse run reports
"enable text compression" for a problem no real host would have.

## How the archive is wired back together

The crawler saved the **post-JavaScript DOM** of each page, but left every asset
reference as its original absolute URL, while the files themselves went to
`backup/assets/<host>/<path>`. Query strings were folded into the filename as
`<name>__q<md5(query)[:10]>` — `.../assets/t.js?brand=Gator&v=…` became
`assets.mywebsitebuilder.com/assets/t.js__qa96bc6b084.js`.

`serve.js` indexes all 1391 asset files at startup and rewrites HTML and CSS as
it serves them, so nothing on disk is modified:

- `https://<host>/<path>?<query>` → `/_a/<host>/<path>` when the file was archived
- `/x/cdn/?<url>` (the site's own image proxy) → the matching `x/cdn/index__q…` file
- `https://medpsycmoss.com/<page>` → a local route, so navigation stays local
- anything not archived is left alone, so real outbound links still work

Four behaviours are deliberate:

- **Live fallback.** Assets the crawler missed — most notably the ~270 webfont
  files on `wzuk.blob.core.windows.net` — are still routed through the server
  when they sit on a host the archive already knows and look like static files
  (`PROXYABLE_EXT`), so they get fetched from origin once and cached in
  `.cache/`. Without it the typography falls back to system fonts. `--offline`
  disables the fetch and leaves those URLs pointing at the real internet.
- **reCAPTCHA is never served locally.** The archived `www.google.com/recaptcha/api.js`
  loads but never defines `grecaptcha.render`; the uncaught `TypeError` aborts
  `viewer.js` mid-render and collapses `/contact` to an empty page. Those two
  paths (`NEVER_LOCAL`) always go to Google.
- **API passthrough.** The page widgets `POST` to same-origin JSON endpoints
  (`/services/lists/fetchContent`, `/appmarket/getElements`). Those are forwarded
  verbatim to medpsycmoss.com; answering them from the archive hands the widget
  HTML where it expects JSON and it then erases its own content.
- **Analytics blocked by default.** GTM, Segment, DoubleClick, CookieYes,
  Datadog and Convert are served as empty scripts so a local copy never writes
  into the real site's analytics. `--keep-analytics` restores them.

## Verification tooling

```
node verify.mjs <out-dir> [concurrency]   # render every page, diff height vs. archived screenshot
node shot.mjs   <out-dir> /path /path …   # screenshot specific pages
node diff.mjs   <shots> <out> index blog  # side-by-side local vs. archive
node diff3.mjs  <local.png> <live.png> <name> <out.png>
node trace.mjs      /blog                 # network + console log for a local page
node trace-live.mjs /blog                 # same, against the real site
```

These use the Chromium already present at
`%LOCALAPPDATA%\ms-playwright\chromium-1187`; `npm i` only pulls `playwright`
itself (`PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`).

## Fidelity

`verify.mjs` renders every page at 1440px and compares full-page height with the
crawler's screenshot of the live site. **128 of the 132 non-blog pages are
pixel-identical**; the four that are not were each checked against medpsycmoss.com
as it stands today and match *the live site* rather than the two-day-old archive.

### The blog is broken on the live site right now

`POST /services/lists/fetchContent` and `POST /appmarket/getElements` both return
a 404 HTML page on medpsycmoss.com. The blog widget therefore erases its own
server-rendered content, so the post list, featured posts, tag cloud **and the
body of every individual post** render empty. Verified directly:

| | local mirror | medpsycmoss.com today | archive 2026-07-27 |
| --- | --- | --- | --- |
| `/blog` | 2887px | 2887px | 2887px (with posts) |
| `/blog/taboos` | 4016px | 4016px | 14061px |

The mirror reproduces this exactly, because it is a production fault, not an
archive gap. That accounts for all ~120 blog routes flagged by `verify.mjs`.
**The archive is currently the only complete copy of the blog content** —
rendered DOM in `backup/pages/blog_*.html`, plain text in `backup/content/*.md`.

### Smaller, benign differences

- `app-gateway.mywebsitebuilder.com/store-shop/v1.0/{session,settings}` fail CORS
  on the live site too; the store still renders because its data is inlined.
- The homepage embeds `components.mywebsitebuilder.com/extern/embed-html/…`,
  which rejects a `localhost` referrer — worth ~29px of height on `/`.
- `/about-me` (-11px) and `/my-work` (-28px) match the live site exactly; the
  archive is simply two days stale.
- Seven archived URLs are the site's own 404 page (`/about`, `/product-page`,
  `/products/*`); they are served as-is rather than routed.

## Notes for the rebuild

- The pages are a fixed 1440px canvas from a WYSIWYG builder: absolutely
  positioned elements with inline `left`/`top`/`width` pixel values, and
  `<meta name="viewport" content="width=1024">` — there is no responsive layout
  to adapt, so responsiveness means re-authoring, not patching.
- The footer is unstyled on the live site (a bare list of links); that is
  faithfully reproduced, not a mirror bug.
- Content is available in two forms: the rendered DOM under `backup/pages/` and
  clean markdown under `backup/content/` (294 files) — the latter is the better
  source for a rebuild.
