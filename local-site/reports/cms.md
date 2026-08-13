# The editor

She signs in at **`/admin`** with a username and password. No GitHub account, no
OAuth, no third party service, nothing to install.

Before this, every word on the site was baked into HTML by scripts that needed
the 2 GB crawl archive, so she could not change anything without a developer.

---

## 1. What she can change herself

| She can | Where | Affects |
|---|---|---|
| Write a **new blog post** | Blog posts, Write a new post | new page, listed on `/blog` |
| **Edit or delete** any of the **90** posts and interviews | Blog posts | that page |
| Change a **product name, price, description, badge, button text** | Products | `/store`, `/products/*`, homepage |
| Change the **homepage numbers** | Numbers | homepage, About |
| Add, edit, reorder **testimonials** | Testimonials | homepage, product pages |
| Change **homepage headings, intros, the opening paragraph** | Homepage wording | homepage |
| Change the **footer bio and disclaimer** | Homepage wording | every page |

She writes in plain text boxes. Blank line between paragraphs, `##` at the start
of a line for a subheading. She never sees HTML, YAML or git.

**Nothing is live until she presses Publish.** That button runs the real build and
takes a few seconds, then her change is on the site.

## 2. What still needs a developer

- new page types, layout, navigation, the header, footer and mobile dock
- the 17 resource libraries and the Free Guides sections. These regenerate from
  her tags when she publishes a post, so they stay current, but their structure
  is not editable in the UI
- the contact form, which still has no backend (see `handoff.md`)
- anything on Gator: checkout, orders, Stripe

## 3. Setting it up

```bash
node cms/hash-password.js "the password you choose"
```

Put the output in the environment, never the plain password:

```bash
CMS_USER=stephanie
CMS_PASSWORD_HASH=<the output above>
SESSION_SECRET=<any long random string>
```

Then `docker compose up -d --build`. In Coolify, set those three as environment
variables on the application.

`SESSION_SECRET` must be stable. Changing it signs her out. If it is unset the
server generates one at boot, which means every restart logs her out.

## 4. How it holds together

```
she edits  ->  content/  ->  Publish  ->  build  ->  dist/  ->  the live site
```

| file | drives |
|---|---|
| `content/blog/*.md` | 90 article pages |
| `content/products.json` | store tiles and product pages |
| `content/stats.json` | the credibility strip |
| `content/testimonials.json` | testimonial cards |
| `content/site.json` | homepage wording and the footer |

### The volume rule, which matters

**`content/` is a Docker volume. `rebuild/` and `dist/` deliberately are not.**

Her words live in the volume and survive every redeploy. The templates and code
come fresh from the image, so your changes land. The entrypoint rebuilds from
both at every start.

Making `rebuild/` or `dist/` volumes too would look sensible and would quietly
break the project: the volume would shadow the image forever and no template,
layout or code change you deployed would ever appear again.

On first run the volume is empty, so the entrypoint seeds it from the image.

## 5. What was verified, end to end

Ten checks against the running server:

- wrong password rejected, correct password issues a session
- 90 posts listed, a post edit saved
- a price edit saved
- **Publish ran the real build and the change appeared on the public site**
- the edited title appeared on `/blog/mcat`, the new price on `/store`
- reverted cleanly
- signing out revoked access immediately
- unauthenticated requests to the API return 401

And the handover question, tested properly by deploying twice with a template
change in between:

- **her edit survived the redeploy** and was still live
- **the developer's template change also landed** in the same deploy

### A crash found and fixed on re-verification

Saving a post with a malformed request body **killed the whole server**, and
because this process serves the public site as well as the editor, the entire
website went down until the container restarted.

The cause was one missing keyword. `api()` is async and was called as
`return api(...)` instead of `return await api(...)`, so a rejection inside it
escaped the surrounding `try/catch` as an unhandled rejection and Node ended the
process. The login route never had the bug because its parse sits directly in the
awaited try block, which is why signing in with bad input returned a clean error
while saving a post did not.

Three changes:

- `return await api(...)`, so the existing handler catches it
- malformed bodies now return **400** with a readable message instead of a 500
- `unhandledRejection` and `uncaughtException` are logged rather than fatal, so
  no future mistake in the editor can take the public site offline

Re-verified after the fix: valid save returns 200 and appears on the live page,
malformed save returns 400, and the server and the public site both stay up.

## 6. Two things to tell her

**The price here must match Gator.** This controls what the website advertises;
Gator takes the actual payment. The Products screen says so, but say it once out
loud. It is also the strongest argument for eventually moving the store off Gator.

**The disclaimer is a professional requirement.** It is editable because she may
need to update it, and the field carries a warning.

## 7. Known limits, stated plainly

- **One user.** There is no multi-user support and no audit trail of who changed
  what. For a solo author this is right; if that changes it needs revisiting.
- **No undo in the UI.** A deleted post is gone from `content/`. The volume is
  the only copy, so **back it up**: `docker run --rm -v <vol>:/c -v $PWD:/b alpine tar czf /b/content.tgz /c`.
  Worth a scheduled job.
- **No image upload yet.** She can change words, not pictures. Adding an upload
  screen is a contained piece of work if she wants it.
- **No preview.** She publishes and looks at the site. A draft mode would need a
  second build target.
