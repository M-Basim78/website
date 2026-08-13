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
| **Upload and place pictures** | Pictures | any post |
| **Restore anything she deleted** | Bin | that page |
| **Download a copy of everything** | Bin | nothing, it is a backup |

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

## 7. Pictures

**Pictures** tab. She picks a file, it uploads, and she presses **Copy**, which
puts this on her clipboard:

```
![Describe this picture](/uploads/her-file.jpg)
```

Pasted into a post on its own line, that becomes a captioned, lazy-loaded,
rounded figure. The alt text is whatever she writes in the square brackets, so
it stays accessible.

- JPG, PNG, WEBP and GIF, up to 8 MB
- **SVG is refused.** It can carry script, and nothing here needs it
- filenames are lowercased and stripped to letters, numbers and hyphens, and a
  clash appends `-2` rather than overwriting
- they live in `content/uploads`, inside the volume, so they survive redeploys
- served straight from the volume, so a new picture is live immediately; the
  build also copies them into `dist/` so the folder is a complete site on its own

## 8. Nothing is lost by accident

**Deleting is not deletion.** A deleted post or picture moves to `content/.trash`
and appears under the **Bin** tab with the date, where **Restore** puts it back.

**Every edit keeps the previous version.** Saving a post first copies the old one
into `content/.history/<post>/`, keeping the last 10. Reverting is itself
undoable, because the revert keeps a version too.

**Download a copy of everything** in the Bin tab produces a single `.tar` of
`content/`: every post, product, number, testimonial and picture. Written with a
small ustar writer so it needs no dependency, and it opens with `tar xf` or any
desktop archiver.

That is the answer to "the volume is the only copy". It no longer is, as long as
she or you press that button now and then. A scheduled job on the host is still
worth having:

```bash
docker run --rm -v <vol>:/c -v $PWD:/b alpine tar czf /b/content.tgz /c
```

## 9. Known limits, stated plainly

- **One user.** There is no multi-user support and no audit trail of who changed
  what. For a solo author this is right; if that changes it needs revisiting.
- **No preview.** She publishes and looks at the site. A draft mode would need a
  second build target.
- **The bin is never emptied automatically.** It grows. Not a problem at this
  scale, but somebody should clear it out once a year.
- **Pictures are not resized.** An 8 MB photo is served at 8 MB. The existing
  site images were optimised by `build-images.mjs`; hers are not put through it.
  Worth adding if she starts uploading straight off a phone.
