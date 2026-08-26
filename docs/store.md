# The shop

Built into the site. Stripe Checkout takes the payment, her Stripe account
receives it, and Gator is not involved at any point.

---

## 1. What you need from her

Three strings. Nothing else, and no password.

| What | Where she gets it | Looks like |
|---|---|---|
| **Publishable key** | Stripe dashboard, Developers, API keys | `pk_live_51...` |
| **Secret key** | same page, "Reveal live key" (shown **once**) | `sk_live_51...` |
| **Webhook signing secret** | Developers, Webhooks, Add endpoint | `whsec_...` |

**Test mode must be OFF** or the keys take pretend money.

The webhook is a two-step, because the endpoint has to exist before she can
point at it:

1. Deploy, with HTTPS working
2. Give her the URL: `https://medpsycmoss.com/api/store/webhook`
3. She creates the endpoint and ticks **`checkout.session.completed`**, plus
   `charge.refunded` and `charge.dispute.created`
4. She sends the `whsec_`, you set it and restart

Do not tick "select all events". The endpoint must return 200 to everything
Stripe sends, and select-all buries real failures in noise until Stripe disables
the endpoint.

**Send the secret key through a one-time link or a password manager, never
email.** It can move money and issue refunds.

### Also worth setting in her Stripe account

- **Statement descriptor** to `MEDPSYCMOSS`. It probably still says Gator, and an
  unrecognised name on a card statement is the top cause of chargebacks
- **Business website** to medpsycmoss.com
- **Payout bank account** is current
- After launch: **Settings, Connected apps, revoke Gator.** Cancelling the
  subscription does not remove its API access

## 2. How it works

```
buyer clicks Buy
  -> POST /api/store/checkout   { productId }        price is NOT sent
  -> server looks the price up in content/products.json
  -> Stripe Checkout session created, buyer redirected to Stripe
  -> buyer pays on Stripe's page, card details never touch us
  -> Stripe POSTs /api/store/webhook, signature verified
  -> order written to content/orders/, download token minted
  -> buyer lands on /order/<session id>
```

### Four decisions worth knowing

**The price never comes from the browser.** The client posts a product id and
nothing else. Otherwise anyone could edit the page and buy a $125 session for a
dollar. The amount is read server side from `content/products.json`.

**`content/products.json` is the only place a price exists.** She changes it in
the editor and the checkout charges the new amount immediately. This is the
thing that made leaving Gator worth doing: there is no second copy to keep in
step, and no way for the site to advertise one price while checkout takes
another.

**Fulfilment happens on the webhook, not the redirect.** A buyer can close the
tab the instant they pay. Stripe calls the server directly and retries; the
redirect is only there to show them something.

**No dependencies.** Stripe's REST API is form-encoded and its webhook signature
is an HMAC, both of which Node does natively, so the container still installs
nothing.

## 3. The ten products

Reconciled product by product against her Gator admin on 2026-08-26, from the
full product editor rather than from the storefront. That distinction turned out
to matter, twice.

| Product | Price | After payment | File |
|---|---|---|---|
| Medical School Application Workbook | $10 | download | `medical-school-application-workbook.pdf` |
| Residency Application Workbook | $12 | download | `residency-application-workbook.pdf` |
| Full ERAS & PS Residency Application | $30 | download | `full-residency-eras-application.pdf` |
| 2026 ERAS & PS for Fellowship | $30 | download | `eras-ps-fellowship-2026.pdf` |
| Testing Accommodations: Workbook + Examples | $50 | **she emails it** | too large to serve |
| Residency Mock Interview Course + Workbook | $50 | download | `residency-mock-interview-course.pdf` |
| Advising with Dr. Moss, 30 min | $60 | booking | none |
| Advising with Dr. Moss, 1 hr | $100 | booking **+ file** | `advising-appointment-instructions.pdf` |
| Application or Personal Statement Editing | $100 (+$50 for 2 edits) | customer sends a draft | none |
| Mock Interview with Dr. Moss | $125 | booking **+ file** | `mock-interview-instructions.pdf` |

The Medical School Application Workbook is `visible: false`, matching what Gator
has hidden today. It is fully working; unhiding it is a one word edit.

**Not included: the FULL Package for Residency, $500.** It is hidden in Gator, so
it was never served publicly, so the crawl never saw it. There is no product id,
no images and no archived description. It needs her to unhide it or to send the
details by hand. It is a bundle of things she already sells individually, priced
at $500 against a stated $700 of value, so it is worth asking whether it was
paused deliberately.

### Correction: two products were not delisted, they were invisible

An earlier version of this document said the $12 workbook and the $30 ERAS
application were "products she no longer sells". That was wrong, and the mistake
came from reading her storefront instead of her admin.

Her Gator admin lists **nine visible products**. Her live storefront renders
**six**. Three products she believes are on sale have not been appearing:

- Full ERAS & PS Residency Application, $30
- 2026 ERAS & PS for Fellowship, $30
- Residency Application Workbook, $12

They have been building the store from what the storefront showed, which is why
they were dropped. All three are on the new store. Worth telling her, because on
Gator they are still invisible and still not selling.

### A fulfilment mode is not a file

`fulfilment` says how the product is delivered; `file` says whether there is
something to hand over. They are independent, and conflating them was a real bug:

- **`download`** — signed link on the order page, 30 days, 8 uses
- **`booking`** — she sends a calendar link. Two of these *also* ship an
  instructions PDF, and while the download was keyed off `fulfilment === 'download'`
  those buyers paid $100 and $125 and were shown nothing at all
- **`email-file`** — she emails the file herself. The accommodations workbook is
  too large to serve, and her own product copy says she sends it within 12 to 24
  hours. It had been configured as a `download` pointing at a file that does not
  exist and never will, so the site would have taken $50 and offered a dead link
- **`send-draft`** — the customer emails their document in. (`email` is the old
  spelling and is still honoured, so orders taken before the rename still read
  correctly)

### Our prices had gone stale

The site was advertising **the July prices**, and the live store had moved on:

- Advising 1 hr was listed at **$70**, actually **$100**
- Mock Interview at **$100**, actually **$125**
- Editing at **$60**, actually **$100**

Undercharging by $30 to $40 on three products. All corrected, and the grid is now
generated from `products.json` by `build-store.mjs`, so it cannot drift again.
`check-prices.mjs` asserts every displayed price equals what checkout charges.

## 4. Still needed before it can take money

1. **Her three Stripe strings** (section 1)
2. **Booking links.** Set `booking_url` on each of the three booking products,
   from Cal.com or Calendly. Until then the order page says she will email to
   arrange a time
3. **Email.** There is no SMTP yet, so the buyer's only copy of a download link
   is the order page. Stripe sends its own receipt, which is proof of payment but
   carries no link. Worth adding once a mail provider is chosen
4. **A decision on the $500 package** (section 3)

The paid files are **done**: all seven are exported and in `content/products/`.
They are gitignored and excluded from the Docker image, so they reach the server
by `docker cp` once. See step 6 of the deploy runbook.

## 5. Running it

```bash
export STRIPE_SECRET_KEY=sk_test_...        # test keys are fine to develop with
export STRIPE_WEBHOOK_SECRET=whsec_...
export SITE_ORIGIN=http://localhost:8184
node cms/server.js
```

Do not wait on her to build. The Stripe CLI forwards real test events:

```bash
stripe listen --forward-to localhost:8184/api/store/webhook
```

It prints a temporary `whsec_`. Build and test the whole flow in test mode, then
swap in her live values at the end.

### Tests

```bash
node cms/store.test.js                       # 18 unit tests, no server needed
node cms/store.e2e.js http://localhost:8184  # 31 tests against a running server
node cms/analytics.test.js                   # 29 tests, see reports/traffic.md
```

The e2e suite needs a server with `STRIPE_WEBHOOK_SECRET` set, or every webhook
test fails on the signature check:

```bash
PORT=8184 CMS_PASSWORD=x SESSION_SECRET=x   STRIPE_WEBHOOK_SECRET=whsec_e2e_secret_for_testing node cms/server.js
```

The e2e suite fakes Stripe, so it proves the parts that would cost real money
without touching an account:

- a forged product id, a forged option and a client-supplied price are all refused
- unsigned, wrongly signed, tampered and replayed webhooks are all rejected
- a genuine webhook records the order and mints a download link
- the same webhook twice does not create a second order
- download links are unguessable, expire after 30 days, cap at 8 uses, and
  cannot be walked out of the products folder
- with the file missing the page says 503, not a broken link
- a booking that carries an instructions sheet offers **both** the calendar
  link and the download, and one that carries no file offers neither
- every product in the real catalogue is deliverable: nothing declares a
  file that is not on disk, and nothing is a `download` with no file

## 6. Known limits

- **Orders are files, not a database.** Fine at her volume; the token lookup is a
  linear scan and would want indexing if the shop ever got busy
- **No refund flow in the editor.** She refunds in Stripe, and the order record
  keeps its old status until someone looks
- **`content/orders/` holds customer emails** and `content/products/` holds the
  paid files. Both are gitignored and must stay that way: this repository is
  public. They live in the Docker volume and are covered by the backup button
- **One currency**, USD, set at the top of `products.json`
- **A catalogue change in git does not reach a running server.** `content/`
  is a volume and the entrypoint never overwrites a file that is already
  there, because her edits must win. Pushing one is a deliberate
  `docker cp`: step 6 of the deploy runbook
