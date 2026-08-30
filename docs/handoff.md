# MedPsycMoss rebuild: state of play and what to collect from Gator / Bluehost

Written for the session on the machine that has access to her HostGator
(Gator Website Builder) and Bluehost accounts. Everything below is either
**done and verified**, or **blocked on something only the builder admin can tell
us**. Nothing here is speculation about what the code does; it is all measured.

Branch to pull: **`homepage-rebuild`** on `github.com/M-Basim78/website`.
Run the site with `cd local-site && node serve.js`, then open
`http://localhost:8123/`. Any URL takes `?old=1` to serve the original archived
page instead, for side by side comparison.

---

## 1. What is built and passing

Eight pages, all on the shared shell, all on her maroon / navy / light pink /
white palette.

| Page | Slug | Status |
|---|---|---|
| Home | `/` | built |
| About | `/about-me` | built |
| Store | `/store` | built |
| Podcast | `/podcast` | built |
| Blog index | `/blog` | built |
| Resources hub | `/resources` | built |
| My Work | `/my-work` | built |
| Contact | `/contact` | built, **form has no backend, see section 3** |

### Verified, not claimed

| Check | Result |
|---|---|
| Lighthouse mobile, `/` `/store` `/about-me` `/resources` | 98 to 99 Performance, **100 / 100 / 100** on Accessibility, Best Practices, SEO |
| Em dashes and en dashes in rendered text | **0** across all 8 pages |
| Teal literals anywhere | **0** |
| `<h1>` per page | exactly 1 on all 8 |
| Unique title, description, canonical, OG, JSON-LD | present on all 8 |
| Header, footer and dock identical across all 8 | yes, after the fix in section 5 |
| WCAG AA on the palette | 19 colour pairs, 0 failures (`node contrast.mjs`) |
| Mobile sweep 360 to 1280 | 0 horizontal overflow, 0 tap targets under 44px |

Re-run any of it: `node audit.mjs`, `node qa.mjs <out>`, `node lh.mjs <url> <out>`,
`node check-dashes.mjs <url>`.

---

## 2. What is NOT built

These were in the original brief and are still outstanding. They are the reason
the site is not yet complete.

### 2a. Product pages (4)

`/products/residency-personal-statement`, `/products/mock-interviews`,
`/products/loa-guide`, `/products/usmle-accommodations`.

**Important:** these four slugs **return 404 on her live site right now**. They
are linked from her current footer and have been broken for some time. The store
links in the rebuild deliberately point at the working
`/store/p_XXXXXXX/...` URLs instead.

**To collect in Gator:** confirm whether she wants those four vanity slugs to
exist at all, or whether the store product URLs are the permanent home. If she
wants them, we need the intended content for each; the scrape has nothing under
those paths beyond the 404 page.

### 2b. Individual resource pages (10)

`/resources` is built and links to all ten, but each still serves the archived
original:

`/trauma-resources`, `/websites-for-trauma`, `/pelvic-pain-resources`,
`/mental-health-resources`, `/sexual-health-resources`, `/endometriosis-resources`,
`/infertility-resources`, `/menopause-resources`, `/disabilities-resources`,
`/lqbtqia-resources`

Note the last one is spelled `lqbtqia` in her real URL. That is her live slug and
the rebuild preserves it. **Ask her whether to keep the typo** (safe for existing
links and SEO) **or fix it and add a redirect.**

### 2c. Other pages

`/events`, `/interviews`, `/vlogs` are not built. They are not in the top nav.

### 2d. Site plumbing

`sitemap.xml` is not generated yet.

---

## 3. The contact form backend, and exactly what to look for

This is the highest value item to retrieve, and you are right that Gator will
have it. Here is what we already extracted from the archived page so you know
what you are looking at.

Her live contact form is a **native Gator / Webzai form widget**, not a third
party embed. From the archived `viewer.js`, the submit path is:

```
POST  {ServicesBasePath}/form/Submit
params: siteID, siteType, formID, formValues, formSource, captchaToken
```

Values recovered from the archived page:

| Key | Value |
|---|---|
| `siteID` | **787567** |
| `siteType` | **0** |
| `ServicesBasePath` | `""` (empty, so the endpoint is same origin: `https://medpsycmoss.com/form/Submit`) |
| `instanceId` (store) | `d84b636160b841679554fcd7b73fa228` |
| Google reCAPTCHA site key | **`6LfwJUwUAAAAAES2R4Y3mpZmYr4a7ur4A0kFXNDr`** |
| Form input element ids | `id1639797508526`, `id1639797508527` |

**Caveat on that reCAPTCHA key:** the archive contains two `6L...` strings. The
one above is the well formed site key; the other is a fragment of an unrelated
base64 blob. Confirm the real key in the builder rather than trusting this line.

### What to collect at the builder

1. **Where do form submissions actually go?** In Gator, open the contact page,
   select the form widget, and find the notification or recipient email setting.
   That address is the thing we must preserve.
2. **Is there a stored submissions inbox** in the Gator dashboard, and does she
   rely on it? If yes, moving off Gator loses that history unless exported.
3. **The reCAPTCHA key pair.** The site key is public and above; the **secret key**
   lives in the Gator/HostGator side and is what any replacement backend needs.
4. **In Bluehost:** whether email for `@medpsycmoss.com` is hosted there, and
   whether there is SMTP available we can post through. That decides between
   reusing Gator's endpoint and standing up our own.
5. **DNS and hosting.** Where the domain currently points, and where the rebuilt
   static site will be served from. This also decides the `store.medpsycmoss.com`
   subdomain question below.

### Decision that follows

- **Reuse her Gator endpoint:** cheapest, but ties the new site to Gator staying
  active, and the endpoint expects Gator's own session and captcha token.
- **Replace it:** a small form handler posting to her email. Needs the recipient
  address from step 1 and the reCAPTCHA secret from step 3.

Until one of those is chosen, `/contact` renders a correct, accessible, labelled
form that **submits nowhere**. It is the only thing on the site that would
silently fail a real student, and it should not go live as is.

---

## 4. Other questions only she or the builder can answer

| # | Question | Why it matters |
|---|---|---|
| 1 | ~~**YouTube handle.**~~ **RESOLVED 2026-08-30.** Her live site used two: `@StephMossMD` on About, `@doctormoss` in the footer and homepage. She confirmed `@doctormoss` is somebody else. The whole site now uses `https://www.youtube.com/@stephmossmd`, which also matches her Instagram handle. | Closed. |
| 2 | **Dead link.** The chicago.gov CHHRGE PDF returns **404**. It is dead on her live site too. | Needs a replacement URL or removal from `/about-me` and `/my-work`. |
| 3 | **Store subdomain.** Plan is `store.medpsycmoss.com`. | Every checkout link is built from one constant, `STORE_BASE` in `rebuild/js/site.js`. Changing that one line repoints the entire site. Nothing else moves. |
| 4 | **Two statistics were dropped.** An "about 80%" insurance coverage figure and a "1 in 4 female physicians" infertility statistic appear in her prose but are not in `stats.json`. | We only publish numbers she supplied. If she wants these, she needs to confirm them and give a source. |
| 5 | **Quote sign off.** See `reports/quote-options.md`, already sent. Also confirm the "Business Story of the Week" cards carry no usage restriction from whoever produced them. | Her own quote now replaces the Gabor Maté line on the homepage. |
| 6 | **Patient photo.** `IMG_0273`, her masked in a treatment chair, is live on the homepage patient panel. Approved verbally. | Worth one final look in context before launch. |
| 7 | **Blog is broken in production.** `POST /services/lists/fetchContent` returns a 404 HTML page on her live site, so the post list, tag cloud and every post body render empty. | The archive is currently the only complete copy of her blog. Worth telling her regardless of this project. |

---

## 5. Fixes made during the audit, for the record

- **Shell drift, all 7 sub-pages.** Each page agent produced a slightly different
  header and dock. Root cause was that the homepage nav still used in-page
  anchors (`#store`, `#free`) from when it was the only page; once Store and
  Podcast became real pages those anchors were simply wrong. Header and dock are
  now written identically into all 8 pages and into `rebuild/partials/`, using
  real slugs, with `aria-current` set from each page's own slug. Took the audit
  from 23 problems to 9.
- **Local slug routing.** `serve.js` now serves a rebuilt page at its real slug
  when one exists, so the local build previews the new site rather than the old
  scrape. `?old=1` forces the archive.
- **Palette.** Derived, checked for AA, then applied through an explicit 32
  mapping table rather than find and replace, then scanned. Zero teal survives,
  including the favicon and `theme-color`.

### The 9 audit items that remain

Eight are **403 responses to automated requests** from publishers that block
bots: KevinMD ×4, JAMA Network, MedPage Today, Psychiatry Online, Bookshop,
Spotify. Verified this pattern directly with Spotify: 403 to the checker, 200 in
a real browser. These are her real published work and the URLs are correct.

The ninth is the chicago.gov 404 in section 4.

---

## 6. Known weakness in my own checking

`audit.mjs` reports **81 CSS selectors declared more than once**. That number is
noisy: it does not distinguish a genuine redeclaration from a legitimate
`@media` override, and the base stylesheet has always had both. The seven page
agents appended roughly 460 lines to `rebuild/css/site.css` concurrently. I have
**not** verified there are no real conflicts in what they added. That deserves a
proper pass before launch, and is the most likely place for a subtle visual bug
to be hiding.

---

## 7. Suggested order on the other machine

1. Pull `homepage-rebuild`, run `node serve.js`, click through all 8 pages.
2. In Gator: contact form recipient, reCAPTCHA secret, submissions inbox.
3. In Bluehost: DNS, email hosting, SMTP.
4. Ask her sections 4.1, 4.2, 4.4, and the `lqbtqia` slug question.
5. Then build: the 10 resource pages, the 4 product pages if she wants them,
   `sitemap.xml`, and the CSS conflict pass.
