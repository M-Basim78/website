# medpsycmoss.com — pre-migration backup crawler

Tooling and content archive for **https://medpsycmoss.com/**, captured **2026-07-27**,
before any migration work began.

The site runs on the HostGator "Gator" website builder and is **client-side rendered** —
the HTML the server returns contains only the footer, and every bit of real content is
painted by JavaScript afterwards. A `wget`/`requests` mirror of this site captures empty
shells. Everything here renders each page in headless Chromium (Playwright) before saving.

## Results

| | |
|---|---|
| URLs crawled | 295 (queue drained naturally, under the 300 cap) |
| Pages saved | 294 rendered HTML + 294 screenshots + 294 markdown |
| Assets saved | 1,391 across 57 hosts (869 images, 32 PDFs, 23 fonts) |
| Failed pages | 0 |
| Archive | `medpsycmoss-backup-20260727.zip` — 946 MB, CRC verified |

All six verification checks passed. Median rendered page carries 2,983 characters of body
text and the largest carries 53,248 — proof the JS rendering worked rather than saving
footer-only shells.

## Scripts

| File | Purpose |
|---|---|
| `crawl.py` | The crawler. Seeds from a known URL list + `sitemap.xml`, then BFS-crawls every same-domain link found on rendered pages. Saves DOM, full-page screenshot, markdown extraction, and every asset response including third-party CDNs. |
| `repair_assets.py` | Second pass. Re-downloads assets whose bodies Chromium evicted from its cache before the crawler could read them (124 recovered on this run). |
| `update_manifest.py` | Folds repaired assets into `manifest.txt` and refreshes on-disk counts. |
| `verify.py` | Six-check verification, then zips the backup. Identifies assets by magic bytes, since Gator's CDN serves images with no file extension. |

### Running it

```bash
python -m venv venv
venv/Scripts/python -m pip install playwright
venv/Scripts/python -m playwright install chromium

venv/Scripts/python crawl.py           # ~35 min, 2s polite delay between pages
venv/Scripts/python repair_assets.py   # recover cache-evicted assets
venv/Scripts/python update_manifest.py
venv/Scripts/python verify.py          # verifies, then writes the zip
```

## What is in this repo

- The four scripts above
- `backup/content/` — **294 markdown files**, the practical rebuild source. Each holds
  title, meta/OG tags, prices, ordered headings and body copy, full image URL list,
  complete link map, and JSON-LD where present.
- `backup/manifest.txt` — every URL mapped to its saved file, with character counts
- `backup/verification-report.txt` — full six-check output
- `backup/errors.log`, `backup/asset-repair.log` — audit trail
- `backup/sitemap.xml`, `backup/robots.txt`
- `session/` — the Claude Code session transcript that produced all of this
  (`.jsonl` raw, `.json` formatted)

## What is NOT in this repo

Excluded via `.gitignore` because they total **1.1 GB** and exceed GitHub's practical
limits. They live in `medpsycmoss-backup-20260727.zip`:

- `backup/pages/` (145 MB) — rendered DOM snapshots
- `backup/screenshots/` (350 MB) — full-page PNGs
- `backup/assets/` (648 MB) — mirrored images, PDFs, fonts, CSS/JS
- `venv/`

## Known gaps in the backup

This is a complete capture of the **public-facing site**. It is a reconstruction source,
not a restore point — there is no Gator site-definition export here, so it cannot be
re-uploaded to bring the site back.

- **No audio or video** (verified: 0 files). The podcast embeds Spotify, Apple Podcasts,
  YouTube and Transistor players, which stream on interaction. Only 54 YouTube thumbnails
  were captured. Those platforms remain the system of record.
- **Paid products not included.** The 32 captured PDFs are public links from blog posts.
  The workbooks selling for $12–$100 are gated behind checkout; titles, prices,
  descriptions and sales pages are captured, but not the deliverable files.
- **Not a browsable offline mirror.** Saved HTML still references the live CDNs — no link
  rewriting pass has been run, so pages will render blank once the site is torn down.
- **Nothing behind the admin login** — orders, customers, Stripe config, AWeber
  subscribers, drafts, form submissions, analytics history, DNS/email/redirect config.

### Broken links found on the live site

Worth fixing during migration. Five URLs return the site's real 404 page, and **four are
linked from the footer of every page**:

- `/products/residency-personal-statement`
- `/products/mock-interviews`
- `/products/loa-guide`
- `/products/usmle-accommodations`
- `/about` — also footer-linked; the real page is `/about-me`

The live products actually live at `/store/p_XXXXXXX/...`.

### Before cutover

Pull these from the admin panels while they still exist:

1. Export the paid product files from the Gator store — revenue-critical and
   unrecoverable from outside
2. Export orders and customers; note the Stripe connection
3. Export the AWeber subscriber list
4. Record DNS, email routing, and any redirects
