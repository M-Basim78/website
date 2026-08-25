# What to export from Gator before anything moves

Written for someone sitting in her Gator and Bluehost accounts with a checklist.

**The short version:** her *content* is already safe. I crawled and archived all
164 pages, 87 blog posts and 1,391 assets in July, and I re-checked the live
sitemap today: **164 urls, byte for byte identical, nothing added or removed.**

So the only things worth your time are the ones that live behind the admin login
and cannot be crawled. There are fewer than you would think, and two of them
really matter.

---

## Tier 1: irreplaceable. Do these first.

If the account lapses or the password changes, these are gone permanently.

### 1. The digital product files

The actual PDFs and workbooks she sells. They sit behind checkout, so no crawler
can reach them and I do not have them.

**Store, Products, open each one, download every attached file.**

Do this for **all 20 products**, not just the 6 currently for sale. The archive
shows 15 more that she has delisted:

```
p_3287163  Medical School Hidden Curriculum Workbook
p_3287196  Medical School Workbook
p_3288428  Dr Moss Personal Statements for Residency
p_3288429  Dr Moss Full 2023 Residency ERAS Application
p_3288536  Accommodations Request USMLE
p_3291739  Advising Session 1 Hour
p_3291868  Residency Application Workbook
p_3292498  Navigating Medical School Hidden Curriculum
p_3302643  ERAS Editing
p_3302656  Virtual Mock Interview
p_3308550  Dr S Moss Interview and Match List
p_3309866  Rank List Neurology
p_3353076  USMLE Accommodations Request Workbook
p_3377397  Medical School Application Workbook
p_3387065  2026 ERAS and PS for Fellowship
```

Some are superseded drafts. Several are years of her own work. **People bought
these**, and a past customer may still ask for their file. Download the lot; sort
them out later.

Name them to match `content/products.json` and drop them in `content/products/`
and the new store serves them automatically.

### 2. Sales and customer records

**Store, Orders, export to CSV** if the option exists. If it does not, screenshot
or copy the list.

You need: date, customer name, email, product, amount, and order status. This is
her business history, it is what proves who is entitled to what, and once the
subscription ends there is no way back to it.

### 3. The contact form recipient address

**Pages, Contact, select the form widget, notification or recipient email.**

The new contact page is built but not connected. Without this address, student
enquiries silently vanish the moment DNS moves. This is the single item blocking
launch.

While you are there: **is there a stored submissions inbox**, and does she rely
on it? If yes, export it, because it does not travel.

---

## Tier 2: needed to finish the migration

### 4. Stripe

Already partly done, but confirm in her Stripe dashboard, not Gator's:

- **Secret key** `sk_live_...` (Developers, API keys). The last paste was the
  publishable key by mistake
- **Webhook** endpoint exists with **`checkout.session.completed`** ticked
- **Payout bank account** is current
- **Statement descriptor** set to `MEDPSYCMOSS`, not Gator's
- **Business website** updated to medpsycmoss.com
- **After launch:** Settings, Connected apps, **revoke Gator**. Cancelling the
  subscription does not remove its API access

### 5. reCAPTCHA secret key

The site key is public and I already have it from the archive
(`6LfwJUwUAAAAAES2R4Y3mpZmYr4a7ur4A0kFXNDr`). The **secret** half lives on the
Gator side and is needed if the new contact form uses the same keypair. If you
would rather generate a fresh pair, skip this.

### 6. Store settings worth copying down

Not files, just settings you would otherwise have to guess:

- **Coupon or discount codes** in use, and their terms
- **Tax settings**: is she collecting sales tax, and where
- **Any product options** beyond the one I found (Application Editing has
  "1 Edit / 2 Edits", +$50)
- **How the three services are scheduled today**: inside Gator, or by email

### 7. Redirects

Any redirects configured in Gator. If there are none, say so, because then the
only ones that matter are the ones we write ourselves.

---

## Tier 3: worth having, not urgent

### 8. Traffic history

Her stats panel shows roughly 8,800 visits a month. Those numbers are generated
by the server that hosts her site, so **they stop the day DNS moves** and cannot
be reconstructed.

Export or screenshot the last 12 months before cutover, and set up Google
Analytics and Search Console on the new site beforehand so there is no blind gap.

### 9. Drafts and unpublished pages

Anything not published is not in my archive, because it was never public. Worth a
glance at the page list for drafts she wants to keep.

### 10. Other platforms holding her data

None of these are Gator, but they surfaced in the crawl and someone should know
they exist:

| Platform | What it holds | Action |
|---|---|---|
| **AWeber** | her email subscriber list | confirm she has the login; export the list |
| **Transistor / Spotify / Apple** | podcast audio and RSS | nothing to do, they are the system of record |
| **YouTube** | her videos | nothing to do |
| **Bookshop.org** | her book list | nothing to do |
| **Amazon** | author storefront | nothing to do |
| **PayPal** | second payment method | confirm Business account; revoke Gator's access after launch |
| **The "YouTube store"** she mentioned | unknown | ask her for the link so we do not disturb it |

---

## What you can safely ignore

Because it is already archived and verified:

- every page, blog post, resource library and interview
- all 1,391 images, PDFs and assets, including third-party CDN files
- the sitemap and robots.txt
- product names, prices, descriptions and badges for the live 6

The full backup is `medpsycmoss-backup-20260727.zip`, 946 MB, CRC verified, and
the rebuilt site already runs from it.

---

## Do it in this order

1. **Download every product file** (all 20 products)
2. **Export orders and customers**
3. **Copy the contact form recipient address**
4. Screenshot 12 months of traffic stats
5. The Stripe items in section 4
6. Everything else

The first three are the ones that cannot be redone. The rest is recoverable with
effort or a phone call.
