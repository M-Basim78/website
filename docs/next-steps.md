# Next steps and known flaws

Written on the machine with the backup archive but **no** Gator or Bluehost
access. Companion to `handoff.md` (the original state of play) and
`pages-built.md` (what the 83 new pages are and how they were generated).

Read the flaws section before showing this build to her. Some of it is visible
on screen.

---

## 1. Where the build stands

| | |
|---|---|
| pages | 90 (8 hand-built, 82 generated) |
| resource libraries | 17 (10 patient, 7 provider) |
| library child pages | 63 |
| resource links carried over | 743 |
| `sitemap.xml` | 90 urls |
| QA sweep, all 90 pages at 360 / 768 / 1280 | **0 problems** |
| Lighthouse mobile, one generated page | 99 / 100 / 100 / 100 |

Run it:

```bash
git checkout homepage-rebuild
cd local-site && node serve.js      # http://localhost:8123
```

`serve.js` needs the archive at `../medpsycmoss-backup-20260727/backup`. Unzip
`medpsycmoss-backup-20260727.zip` beside `local-site`, or point a directory
junction at an existing `backup/` folder. Without it only the 8 original pages
load. `local-site/archive/` is gitignored, which is why it is not in the repo.

---

## 2. Known flaws

### 2a. The shipped pages are stale, and it is visible. Fix first.

**This is the one that matters.** The extraction script contained a regex meant
to strip Gator's private-use-area icon-font characters. Written as literal
characters it degraded to `[-]`, a plain hyphen class, so it **deleted every
hyphen in every extracted label**.

The regex is fixed in the source (`extract-page.js`, `lib-pages.mjs`,
`build-resources.mjs` now use explicit `-` escapes). **The 82
generated HTML files were not regenerated afterwards**, so they still carry the
damage.

Measured across the 770 shipped link labels:

- only **28** contain a hyphen at all, which is far too few for this content
- **55** show the lower-to-upper merge signature, for example
  `Inflammation: The Common Pathway of StressRelated Diseases`
  (should be `Stress-Related`) and `Vaginismus, Vulvodynia Providers by
  SelfAdvocates` (should be `Self-Advocates`). Some of the 55 are legitimate
  camel case (`KevinMD.com`, `MedPsycMoss`, `TransCareBC`), so the true count
  needing repair is smaller, but it is not zero.
- **8** are raw URLs with every hyphen gone, for example
  `www.aclu.org/legislativeattacksonlgbtqrights`

The fix is one command, with the server running:

```bash
cd local-site
node serve.js &            # if not already up
node build-resources.mjs   # regenerates all 82 pages with hyphens intact
node build-sitemap.mjs
node qa-pages.mjs          # expect 0 problems
```

A side effect worth knowing: the `TERMS` map in `build-resources.mjs` (which
forces `Trauma-Informed`, `LGBTQIA`, `USMLE` and so on) was added while I still
believed Gator was welding the words together. That diagnosis was wrong, the
bug was mine. `TERMS` is still useful for casing acronyms consistently, but it
was masking a defect rather than fixing one. Keep it, do not rely on it.

### 2b. Three pages have URLs that will 404

The generator writes a slug containing a slash as a flat filename, so:

| written as | claims this URL | should be |
|---|---|---|
| `blog_tag_disability.html` | `/blog_tag_disability` | `/blog/tag/disability` |
| `blog_the-impact-of-caregiving-on-my-journey-to-become-a-physician.html` | `/blog_the-impact...` | `/blog/the-impact...` |
| `blog_transgender-health-and-gender-affirming-care.html` | `/blog_transgender...` | `/blog/transgender...` |

`sitemap.xml` currently advertises the underscore forms, which would be
submitted to Google and 404 on any real host. Either emit nested directories
(`blog/tag/disability/index.html`) or drop these three from the build and let
`/blog` own that content. They are blog posts, so the second is probably right.

### 2c. 73 of 743 links have no real name

Their only human-readable title lived inside a thumbnail image, so no parsing
recovers it. They fall back to a name derived from the URL, for example
`podcasts.apple.com/us/podcast/transforming-trauma/id1496190024` becomes
"Transforming Trauma". Mostly reasonable, occasionally clumsy. Worth a skim.
Per-link provenance is in `reports/resource-build.json` (`source` is one of
`text`, `card`, `near`, `none`).

### 2d. 11 pages ship an empty state

`podcasts-lgbtqia-health`, `podcasts-on-endometriosis`, `podcasts-on-infertility`,
`podcasts-on-pelvic-pain`, `podcasts-sexual-health`, `posts-black-and-brown-patients`,
`posts-endometriosis`, `posts-mental-health`, `posts-trauma-informed-care`,
`providers-lgbtqia`, `videos-for-trauma-informed-care`

In the archive these contain only header and footer chrome. Their content comes
from Gator's list widget, whose `fetchContent` endpoint returns 404 in
production. This narrows handoff section 4.7: individual blog posts render fine
(154 are archived with full bodies), it is the **collection** widget that is
broken. Filling these needs the lists exported from her Gator account.

### 2e. Breadcrumbs pick the wrong parent for shared pages

Several child pages belong to more than one library. `providers-pelvic-pain` is
linked from both `endometriosis-resources` and `pelvic-pain-resources`, and the
breadcrumb currently reads "Endometriosis Resources" because the last hub to
claim the page wins. Harmless but wrong. Either pick the best-matching parent by
slug similarity, or drop the parent crumb for shared pages.

### 2f. Link categories are coarse

Grouping is inferred from the destination host, so `support-groups-endometriosis`
puts 27 of its 32 links under a single "INSTAGRAM" heading. Accurate, not
especially useful. A hand-tuned grouping per page would read better.

### 2g. Not fully verified

- Lighthouse was run on **one** generated page, not all 82. The QA sweep covered
  all 90, but Lighthouse did not.
- The CSS conflict pass from handoff section 6 is still outstanding. My
  additions are appended and scoped to new class names (`.crumbs`, plus
  `overflow-wrap` on existing `.fr` children), so they should not add to that
  risk, but the roughly 460 lines the seven page agents appended concurrently
  still deserve a read.
- Nobody has clicked through 82 pages by hand. Automated checks pass; that is
  not the same thing.

---

## 3. Still blocked on Gator and Bluehost

Unchanged from `handoff.md` section 3. Nothing here was touched because the
account is not accessible from this machine.

1. **Contact form recipient address.** In Gator: contact page, select the form
   widget, find the notification or recipient email setting. Highest value item.
2. **Stored submissions inbox.** Does she rely on the history? It is lost on
   migration unless exported.
3. **reCAPTCHA secret key.** The site key is public and confirmed
   (`6LfwJUwUAAAAAES2R4Y3mpZmYr4a7ur4A0kFXNDr`, 40 chars, present in 289
   archived pages). The secret lives on the Gator side.
4. **Bluehost:** is email for `@medpsycmoss.com` hosted there, and is SMTP
   available.
5. **DNS:** where the domain points now.
6. **The list exports** that would fill the 11 empty pages in 2d.

Confirmed from `viewer.js` in the archive: the submit path is
`{ServicesBasePath}/form` with action `Submit`, parameters
`siteID, siteType, formID, formValues, formSource, captchaToken`, sent with
`ajaxJasonWithCredentials`. That last detail is the important one: the call is
cookie-authenticated against her origin, so it **cannot** be reused from a
different host. The form has to be replaced, not proxied.

---

## 4. Deployment plan

The rebuild is static, so hosting is free and the moving parts are few.

| what | where | note |
|---|---|---|
| `medpsycmoss.com` | Cloudflare Pages | unlimited bandwidth, free SSL, global CDN |
| `store.medpsycmoss.com` | stays on Gator | checkout, Stripe and product delivery keep working untouched |
| contact form | Cloudflare Pages Function | free tier, 100k requests/day, emails her |

Repointing the store is one line, `STORE_BASE` in `rebuild/js/site.js`. Every
checkout link is built from it, and the real `href` is also written into the
HTML so the page works with JavaScript disabled and stays crawlable.

Do **not** try to keep the Gator form endpoint after moving DNS. Gator stops
answering on the hostname, and the endpoint is origin and cookie bound anyway.

Pasting the rebuild back into Gator is not a real option either: Gator stores
pages as positioned widget objects, not HTML. You would lose the shared shell,
the CSS system, the semantics and the scores, and keep the platform you are
leaving.

---

## 5. Suggested order

1. **Regenerate the pages** (2a). One command, fixes 700-plus labels.
2. **Fix or drop the three slash-slug pages** (2b) before any sitemap is
   submitted.
3. Skim the 73 URL-derived names (2c).
4. When Gator access is back: form recipient, reCAPTCHA secret, list exports.
5. Ask her the open questions in `handoff.md` section 4, including whether the
   four `/products/*` vanity slugs should exist at all. They 404 on her live
   site today and are linked from the footer of every page.
6. CSS conflict pass, then a manual click-through.
