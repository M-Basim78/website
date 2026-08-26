# Traffic

## Why this exists

Her Bluehost stats are produced by the server that hosts the site. **They stop
the day the domain moves**, and they cannot be exported afterwards. This replaces
the part of them she actually reads: how many people came, and what they looked
at.

It is not a Google Analytics replacement and is not trying to be. It answers one
question well.

## What she sees

**A card, on every tab of the editor.** Visits in the last 30 days, the change
against the 30 days before, the number of visitors, and a 30 day sparkline. It is
the first thing on screen after signing in, so the answer to "is anyone reading
this" needs no clicking.

**A Visitors tab** for the detail: a daily chart over 7, 30 or 90 days, the most
read pages, and where people came from.

"Direct" in that last list means they typed the address, used a bookmark, or
followed a link from an app that does not pass a referrer. Instagram in-app links
land there, which is worth knowing given where most of her audience is.

## What it records, and what it deliberately does not

One JSON file per day in `content/analytics/YYYY-MM-DD.json`, inside the volume,
so history survives a redeploy exactly like her posts do:

```json
{ "date": "2026-08-26", "views": 38, "visitors": 11,
  "pages": { "/": 16, "/store": 16 },
  "referrers": { "direct": 16, "google.com": 16 },
  "seen": ["a41f0c9e2b77", "..."] }
```

**No cookies. No third party. No IP address or user agent on disk.** A visitor is
a 12 character hash of address and user agent, salted with a server secret *and
with the date*. Tomorrow the same person hashes to something else, so the file
cannot be used to follow anyone across days and nothing identifying is written
down. This is the approach the cookieless analytics products use, and it is why
the site needs no cookie banner for it.

`seen` is kept only so a container restart does not count the same person twice
in one day.

Not counted, on purpose:

- **Bots.** Around 40 signatures, from Googlebot to GPTBot to uptime monitors.
  On a small site bots are most of the raw hits, and counting them makes every
  number a lie
- **Assets** — CSS, fonts, images. Only HTML pages that returned 200
- **The editor, the API, `/healthz`, and order pages.** An order URL carries a
  Stripe session id, which has no business in a traffic file
- **404s**

## How it behaves

Counting happens in memory and is flushed to disk every 15 seconds, and on
`SIGTERM` so a redeploy does not lose the day. A failed write is swallowed: a
lost count is never worth failing someone's page load over.

Files older than 400 days are pruned at boot.

`visitors` over a window is summed per day, so someone who visits on three days
counts three times. Over a month that is the honest figure, and the card says
"visits" rather than "people".

## Where it lives

| | |
|---|---|
| `cms/analytics.js` | the whole thing, no dependencies |
| `cms/analytics.test.js` | 29 tests |
| `GET /admin/api/analytics?days=30` | the summary, signed in only |
| `cms/public/app.js` | `loadGlance()` and `loadVisitors()` |

```bash
node cms/analytics.test.js
```

The tests worth knowing about: bots do not inflate the numbers, one person
reading five pages is one visitor, a restart does not double count, and neither
the IP address nor the user agent appears anywhere in the written file.

## Limits worth stating plainly

- **It starts at zero on launch day.** There is no history to import, because the
  Bluehost figures cannot be exported. Screenshot her last 12 months before the
  DNS moves
- **A shared network counts as one visitor.** A hospital or a university behind
  one address will undercount
- **Someone on a phone and a laptop is two visitors.** There is no cross-device
  identity, by design
- **It counts server side**, so it sees people with JavaScript off and ad
  blockers on. Its numbers will read higher than a Google Analytics figure for
  the same period. Neither is wrong; they measure different things
