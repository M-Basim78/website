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

## 3. The six products

Verified against her live Gator store on 2026-08-19.

| Product | Price | After payment |
|---|---|---|
| Testing Accommodations: Workbook + Examples | $50 | download |
| Residency Mock Interview Course + Workbook | $50 | download |
| Advising with Dr. Moss, 30 min | $60 | booking |
| Advising with Dr. Moss, 1 hr | $100 | booking |
| Application or Personal Statement Editing | $100 (+$50 for 2 edits) | she emails |
| Mock Interview with Dr. Moss | $125 | booking |

### Our prices had gone stale

The site was advertising **the July prices**, and the live store had moved on:

- Advising 1 hr was listed at **$70**, actually **$100**
- Mock Interview at **$100**, actually **$125**
- Editing at **$60**, actually **$100**
- Two products she no longer sells were still on the page ($12 workbook, $30 ERAS)
- Two she does sell were missing (30 min advising, Mock Interview Course)

Undercharging by $30 to $40 on three products. All corrected, and the grid is now
generated from `products.json` by `build-store.mjs`, so it cannot drift again.

## 4. Still needed before it can take money

1. **Her three Stripe strings** (section 1)
2. **The two paid files.** Put them in `content/products/` under the names in
   `products.json`. Until they are there the order page does not offer a broken
   download; it tells the buyer she will email the file. Nothing is lost, but she
   has to send it by hand
3. **Booking links.** Set `booking_url` on each of the three booking products,
   from Cal.com or Calendly. Until then the order page says she will email to
   arrange a time
4. **Email.** There is no SMTP yet, so the buyer's only copy of a download link
   is the order page. Stripe sends its own receipt, which is proof of payment but
   carries no link. Worth adding once a mail provider is chosen

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
node cms/store.test.js                       # 17 unit tests, no server needed
node cms/store.e2e.js http://localhost:8184  # 26 tests against a running server
```

The e2e suite fakes Stripe, so it proves the parts that would cost real money
without touching an account:

- a forged product id, a forged option and a client-supplied price are all refused
- unsigned, wrongly signed, tampered and replayed webhooks are all rejected
- a genuine webhook records the order and mints a download link
- the same webhook twice does not create a second order
- download links are unguessable, expire after 30 days, cap at 8 uses, and
  cannot be walked out of the products folder
- with the file missing the page offers no dead download button

## 6. Known limits

- **Orders are files, not a database.** Fine at her volume; the token lookup is a
  linear scan and would want indexing if the shop ever got busy
- **No refund flow in the editor.** She refunds in Stripe, and the order record
  keeps its old status until someone looks
- **`content/orders/` holds customer emails** and `content/products/` holds the
  paid files. Both are gitignored and must stay that way: this repository is
  public. They live in the Docker volume and are covered by the backup button
- **One currency**, USD, set at the top of `products.json`
