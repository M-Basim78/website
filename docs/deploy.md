# Deploying MedPsycMoss

The site is static. The container is nginx plus 4.4 MB of files, and needs
nothing else on the box: no database, no Node, and **not** the 2 GB crawl archive.

## Deploy on the VPS

```bash
git clone -b homepage-rebuild https://github.com/M-Basim78/website.git
cd website/local-site
docker compose up -d --build
```

That publishes on `127.0.0.1:8080`. It binds to loopback on purpose: put your
existing reverse proxy (Caddy, Traefik, nginx) or Cloudflare in front of it for
TLS. **Do not expose 8080 to the internet directly.**

Check it:

```bash
docker compose ps          # expect healthy
curl -I localhost:8080/    # expect 200
```

Minimal Caddy in front:

```
medpsycmoss.com {
    reverse_proxy 127.0.0.1:8080
}
```

## Rebuilding the site

`dist/` is committed on purpose. Regenerating it needs the crawl archive, a
running dev server and a headless browser, none of which belong in a production
image. To rebuild after editing content, on a machine that has the archive at
`../medpsycmoss-backup-20260727/backup`:

```bash
npm i
node serve.js &            # build-resources.mjs renders through it
node build-resources.mjs   # 82 resource library pages
node build-posts.mjs       # blog posts, interviews, vlogs
node build-products.mjs    # the four /products/* pages
node build-static.mjs      # -> dist/, sitemap.xml, robots.txt, 404.html
node audit-dist.mjs http://localhost:8099   # expect 0 problems
```

Then `docker compose up -d --build`.

## What the container does

| | |
|---|---|
| base | `nginx:1.27-alpine`, 83.8 MB image |
| user | unprivileged `nginx`, `no-new-privileges` |
| filesystem | read only, with tmpfs for cache and run |
| port | 8080 inside, bound to `127.0.0.1:8080` outside |
| health | `wget` against `/` every 30s |
| logs | json-file, capped at 3 x 10 MB |

### The nginx detail that matters

`try_files $uri $uri/index.html $uri/ =404;` puts the index file **before** the
directory. Matching the directory first makes nginx emit a 301 to the trailing
slash form, and it builds that `Location` from its own listen port. Behind a
reverse proxy that sends every visitor to `:8080`, which is not reachable. Every
page 404ed the first time this was tested. `absolute_redirect off` is set as a
second guard.

## Before the domain moves

1. **The contact form has no backend.** It renders and validates but submits
   nowhere. Get the recipient address and reCAPTCHA secret from Gator first, see
   `handoff.md` section 3. Do not point DNS at this until that is resolved, or
   student enquiries will vanish silently.
2. **Store stays on Gator.** `store.medpsycmoss.com` keeps checkout, Stripe and
   product delivery working untouched. Repointing is one line, `STORE_BASE` in
   `rebuild/js/site.js`.
3. **Do not reuse the Gator form endpoint after the move.** It is origin and
   cookie bound, so it cannot answer for a different host.

## Verified on the container

| check | result |
|---|---|
| pages served | **180 / 180** return 200 |
| internal links | **161, zero broken** |
| em and en dashes in our copy | 0 |
| teal literals | 0 |
| unrewritten `/new/` dev paths | 0 |
| one `h1` per page | yes |
| canonical matches served URL | all 180 |
| images without alt | 0 |
| Lighthouse mobile, `/` `/store` `/trauma-resources` `/blog/mcat` | 99 / 100 / 100 / 100 |
| Lighthouse mobile, `/products/*` | **88** performance, see below |

### Known issue: CLS on the four product pages

`/products/*` scores 88 on performance because cumulative layout shift is 0.23.
Every other page measures 0. FCP, LCP and blocking time are all fine, so this is
purely a shift. These four pages are the only ones with no image above the fold,
which points at the web font swapping in and reflowing the large display heading
with nothing else on the page to anchor it.

It is cosmetic and does not affect the other 176 pages, but it should be fixed
before launch. The likely fix is a `size-adjust` fallback face so the pre-swap
metrics match Bricolage Grotesque. I have not verified that, so it is written
here as a diagnosis rather than a conclusion.
