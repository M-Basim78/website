# The contact form, the mailing list, and email

## What was wrong

The contact page rendered perfectly and posted to `/api/contact`, which did not
exist. Neither did `/api/subscribe`. Both fell through to the static handler and
returned **404**, so every enquiry a student sent went nowhere, silently, and the
sender saw no error.

This had nothing to do with Stripe, DNS or the domain move. The routes were never
written, and they would have 404'd on the apex in exactly the same way.

## The decision that shapes everything else: disk first, email second

A student writing about a failed exam is not a notification, it is a record.

Every submission is written to `content/` **before** anything is emailed, and a
mail failure is logged and swallowed. So:

- The form works **completely** with no SMTP configured at all
- An expired app password costs a notification, never an enquiry
- She reads everything in the editor either way

That is why this shipped without waiting for a mailbox to be set up.

## Sending mail needs no DNS

Worth stating plainly, because it drove the design and it is widely misunderstood:

**MX records are for RECEIVING mail at a domain.** `medpsycmoss.com` has no MX,
no SPF and no DMARC, and needs none of them. Sending logs into an *existing*
mailbox and sends as that account. Nothing is added to the domain.

For her that means a Gmail app password and nothing else:

> Google Account → **Security** → turn on 2-Step Verification →
> **App passwords** → create one

```
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465          # 465 implicit TLS, or 587 STARTTLS
SMTP_USER=medpsycmoss@gmail.com
SMTP_PASS=<the 16 character app password, never her real one>
MAIL_FROM=medpsycmoss@gmail.com
MAIL_TO=medpsycmoss@gmail.com
```

Then `docker compose up -d`. Leave `SMTP_HOST` blank and everything still works,
minus the emails.

If she later wants mail to come *from* her own domain, that is when a provider
like Resend or Postmark is worth it, and that is when SPF and DKIM records get
added. Not before.

## What it does

| | |
|---|---|
| **Contact form** | saved to `content/messages/`, shown under **Messages** in the editor, and emailed to `MAIL_TO` with `Reply-To` set to the student so replying reaches them |
| **Mailing list** | saved to `content/subscribers.json`, listed in the editor, downloadable as CSV for whichever mailing tool she picks |
| **Order confirmation** | the buyer gets their download link by email. Previously the order page was the only copy, so closing the tab lost it |

A card appears at the top of the editor when anything is unread, and disappears
when nothing is.

## Both submission paths work

**With JavaScript** the form posts JSON, stays on the page, and shows the result
in the live region the page already had.

**Without JavaScript** the browser posts normally and the server renders a real
thank-you page. The first version redirected to `/contact/?sent=1`, which was
wrong: that page is static, so the only thing that could have turned the query
into a confirmation was the JavaScript the visitor does not have. They would have
landed back on an empty form with no sign it worked, and sent it again.

## What stops abuse

- **A honeypot** on both forms, already in the markup. A hit is accepted and
  silently dropped: telling a bot it was caught only teaches whoever wrote it to
  leave the field alone next time
- **A throttle**, five writes per source per ten minutes. It counts only
  submissions that actually write something, so someone who mistypes their
  address three times and then gets it right is not charged for the mistakes.
  Charging for mistakes is how a contact form ends up refusing the person it
  exists for
- **Header injection is impossible.** A newline in a subject line is stripped
  rather than encoded, and addresses are validated against a pattern that rejects
  CRLF. There is a test for both
- **No IP addresses on disk.** The source is a hash, only enough to spot a flood

## Where it lives

| | |
|---|---|
| `cms/mail.js` | the SMTP client, no dependencies |
| `cms/inbox.js` | messages and the mailing list |
| `cms/inbox.test.js` | 50 tests |
| `rebuild/js/site.js` | the progressive enhancement |
| `POST /api/contact`, `POST /api/subscribe` | public |
| `/admin/api/messages`, `/admin/api/subscribers[.csv]` | signed in only |

```bash
node cms/inbox.test.js
```

The SMTP half runs against a **fake SMTP server** that speaks the real protocol
and captures what arrives, so the client is proven before her app password ever
touches it. It asserts the wire format: `EHLO`, `AUTH LOGIN` with the credentials
base64 encoded, bare addresses in `MAIL FROM` and `RCPT TO`, `Reply-To` set to
the student, an accented subject encoded as RFC 2047, and a base64 body that
decodes back to exactly what was sent.

`send()` takes an optional connect function purely so those tests can use
cleartext. Production never passes it, so only the encrypted paths can run in the
container.

## Limits worth stating

- **Gmail sends around 500 messages a day.** Far above her volume, but it is a
  ceiling, and it is her personal account's ceiling
- **Mail arrives from gmail.com**, not from her domain. Fine for replies to
  students; less good if she ever sends a real newsletter from the site
- **There is no unsubscribe link**, because nothing here sends bulk mail. The
  field exists in the data so a mailing tool can honour it after import
- **Messages are files, not a database.** Fine at her volume; the unread count
  reads the directory
