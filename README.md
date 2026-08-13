# MedPsycMoss

Site for **Stephanie Moss, MD** ([medpsycmoss.com](https://medpsycmoss.com)),
rebuilt from a crawl of her Gator Website Builder site.

203 pages, plus a built-in editor so she can change it herself.

## Deploy

Coolify, **Dockerfile** build pack, this branch.

Set three environment variables on the application:

```
CMS_USER=stephanie
CMS_PASSWORD_HASH=<node cms/hash-password.js "her password">
SESSION_SECRET=<any long random string>
```

Mount a volume at **`/app/content`**. That is where her writing lives and it is
the only thing that must survive a redeploy.

Locally:

```bash
docker compose up --build      # http://localhost:8080
```

## The editor

She signs in at **`/admin`** with a username and password. No GitHub account, no
OAuth, no third party, nothing to install.

She can write and edit blog posts and interviews, change product names, prices
and descriptions, edit the homepage numbers, manage testimonials, and change the
homepage wording and footer. **Publish** runs the real build and puts it live.

Full detail, including what still needs a developer, is in `docs/cms.md`.

## Layout

| path | what |
|---|---|
| `dist/` | the built site, what visitors get |
| `content/` | her words: markdown posts and JSON. The editor writes here |
| `rebuild/` | page templates the build patches |
| `cms/` | the editor: server, UI, password tool |
| `build-from-content.mjs` | content, then templates, then pages |
| `build-static.mjs` | pages, then `dist/` with real nested slugs |
| `docs/` | handoff notes, deployment, design system, open questions |

## The volume rule

**`content/` is a volume. `rebuild/` and `dist/` deliberately are not.**

Her words live in the volume and survive redeploys. Templates and code come fresh
from the image, so your changes land. The entrypoint rebuilds from both at every
start.

Making `rebuild/` or `dist/` volumes too looks sensible and quietly breaks the
project: the volume shadows the image forever and no template or code change you
deploy ever appears again.

## Verified against the running container

| check | result |
|---|---|
| pages served | **203 / 203** return 200 |
| internal links | **194, zero broken** |
| editor | login, edit, publish, revert, sign out all pass |
| her edit survives a redeploy | yes, tested with a template change in between |
| developer changes still land | yes, same deploy |
| image | 266 MB, healthy |

## Open items

Read `docs/handoff.md` before pointing a domain here.

1. **The contact form has no backend.** It renders and validates but submits
   nowhere. The original was a Gator widget, cookie bound to her origin, so it
   cannot be proxied and must be replaced. **Do not move DNS until this is done**,
   or student enquiries vanish silently.
2. **The store stays on Gator.** `store.medpsycmoss.com` keeps checkout, Stripe
   and delivery. Repointing is one constant, `STORE_BASE` in `dist/js/site.js`.
   Prices in the editor must match Gator, because Gator takes the payment.
3. **Back up the content volume.** It is the only copy of her writing, and the
   editor has no undo.
4. **`/products/*` scores 88** on Lighthouse against 99 elsewhere, from a 0.23
   layout shift. Diagnosed as the font swap, not verified.
