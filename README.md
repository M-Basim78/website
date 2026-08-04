# MedPsycMoss

Static site for **Stephanie Moss, MD** ([medpsycmoss.com](https://medpsycmoss.com)),
rebuilt from a crawl of her Gator Website Builder site.

180 pages, 4.4 MB. No database, no runtime, no build step at deploy time.

## Deploy

Coolify, **Dockerfile** build pack, this branch. Nothing else to configure. That
is the simplest path: it ignores the compose files entirely.

If you use the **Docker Compose** build pack instead, check the compose file path
in the application settings. Coolify stores that path per application and its
default differs between versions, so `docker-compose.yml` and
`docker-compose.yaml` are both committed here, byte identical, and either will
resolve. A path pointing at a file that does not exist fails early and unhelpfully:

```
Deployment failed: Symfony\Component\Yaml\Yaml::parse():
Argument #1 ($input) must be of type string, null given
```

That message means the file was not found, not that the YAML is malformed.

Locally:

```bash
docker compose up --build
# uncomment the ports line in the compose file, then http://localhost:8080
```

## Layout

| path | what |
|---|---|
| `site/` | the built site, exactly as nginx serves it |
| `nginx.conf` | clean URLs, caching, gzip_static, security headers, `/healthz` |
| `Dockerfile` | nginx:1.27-alpine plus `site/`, pre-gzipped at build time |
| `docs/` | handoff notes, deployment detail, design system, open questions |

`site/` is committed on purpose. Regenerating it needs the 2 GB crawl archive, a
dev server and a headless browser, none of which belong in a production image.
The build scripts and page sources live in the repo this branch was cut from.

## The nginx detail that matters

`try_files $uri $uri/index.html $uri/ =404;` puts the index file **before** the
directory. Matching the directory first makes nginx emit a 301 to the trailing
slash form, and it builds that `Location` from its own listen port, so behind a
proxy every visitor is sent somewhere unreachable. Every page 404ed the first
time this was containerised. `absolute_redirect off` is a second guard.

## Verified against the running container

| check | result |
|---|---|
| pages served | **180 / 180** return 200 |
| internal links | **161, zero broken** |
| teal literals, unrewritten dev paths | 0, 0 |
| one `h1` per page, canonical matches served URL | all 180 |
| images without alt text | 0 |
| Lighthouse mobile: `/`, `/store`, `/trauma-resources`, `/blog/mcat` | **99 / 100 / 100 / 100** |
| Lighthouse mobile: `/products/*` | 88 performance, see below |

## Open items

Read `docs/handoff.md` and `docs/deploy.md` before pointing a domain at this.

1. **The contact form has no backend.** It renders and validates but submits
   nowhere. The original was a Gator widget, cookie bound to her origin, so it
   cannot be proxied and has to be replaced. **Do not move DNS until this is
   done**, or student enquiries vanish silently.
2. **The store stays on Gator.** `store.medpsycmoss.com` keeps checkout, Stripe
   and product delivery. Repointing is one line, `STORE_BASE` in
   `site/js/site.js`.
3. **CLS on the four `/products/*` pages** is 0.23 where every other page is 0,
   costing about 11 performance points. They are the only pages with no image
   above the fold, which points at the font swap reflowing the display heading.
   That is a diagnosis, not a verified conclusion.
4. Four `/products/*` slugs **404 on her live site today** and are linked from
   her current footer. They are built here; whether she wants them is still an
   open question for her.
