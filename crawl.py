"""
Backup crawler for https://medpsycmoss.com/ (HostGator "Gator" builder, client-side rendered).

Every page is rendered in headless Chromium before anything is saved, because the
server-side HTML for this site contains only the footer.

Outputs:
  backup/pages/<slug>.html        fully rendered DOM
  backup/screenshots/<slug>.png   full-page screenshot
  backup/content/<slug>.md        readable content extraction (rebuild source)
  backup/assets/<host>/<path>     every asset response (incl. third-party CDNs)
  backup/errors.log               anything that failed
  backup/manifest.txt             everything saved, with counts
"""

import hashlib
import json
import os
import re
import sys
import time
import traceback
import urllib.parse as up
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime

from playwright.sync_api import sync_playwright

# ----------------------------------------------------------------------------- config

ROOT = "https://medpsycmoss.com"
DOMAINS = {"medpsycmoss.com", "www.medpsycmoss.com"}
MAX_PAGES = 300
PAGE_DELAY = 2.0          # polite pause between pages (live client site)
SETTLE_MS = 1500          # extra settle after networkidle
NAV_TIMEOUT = 60000

BASE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "backup")
DIRS = {k: os.path.join(BASE, k) for k in ("pages", "screenshots", "content", "assets")}
ERROR_LOG = os.path.join(BASE, "errors.log")

SEEDS = [
    "/", "/about", "/about-me", "/store", "/podcast", "/blog", "/contact",
    "/events", "/my-work", "/interviews", "/vlogs", "/trauma-resources",
    "/websites-for-trauma", "/resources", "/pelvic-pain-resources",
    "/products/residency-personal-statement", "/products/mock-interviews",
    "/products/loa-guide", "/products/usmle-accommodations",
    "/residency-app", "/failure-identity", "/clinical-rotations",
]

ASSET_CT = (
    "image/", "text/css", "javascript", "font/", "application/pdf",
    "audio/", "video/", "application/font", "application/x-font",
    "application/octet-stream",
)
SKIP_SCHEMES = ("mailto:", "tel:", "javascript:", "data:", "sms:", "#")

# Extensions that are files, not pages -> fetched as assets rather than rendered.
FILE_EXT = re.compile(
    r"\.(pdf|jpe?g|png|gif|webp|svg|ico|css|js|mjs|woff2?|ttf|eot|otf|mp[34]|m4a|wav|mov|webm|zip|docx?|xlsx?|csv)$",
    re.I,
)

# ----------------------------------------------------------------------------- helpers

errors = []


def log_error(kind, target, exc):
    msg = "[%s] %s :: %s :: %s" % (
        datetime.now().strftime("%H:%M:%S"), kind, target,
        (str(exc) or exc.__class__.__name__).replace("\n", " ")[:400],
    )
    errors.append(msg)
    print("   ! " + msg, flush=True)
    try:
        with open(ERROR_LOG, "a", encoding="utf-8") as fh:
            fh.write(msg + "\n")
    except Exception:
        pass


def normalize(url):
    """Canonical form of a page URL, or None if it is not a crawlable same-domain page."""
    if not url:
        return None
    url = url.strip()
    if any(url.lower().startswith(s) for s in SKIP_SCHEMES):
        return None
    try:
        p = up.urlsplit(url)
    except Exception:
        return None
    if p.scheme not in ("http", "https"):
        return None
    if p.hostname is None or p.hostname.lower() not in DOMAINS:
        return None
    path = re.sub(r"/{2,}", "/", p.path or "/")
    if len(path) > 1:
        path = path.rstrip("/")
    if not path:
        path = "/"
    query = p.query
    # Gator uses ?product= / ?post= style params on some collection pages; keep them.
    return up.urlunsplit(("https", "medpsycmoss.com", path, query, ""))


def slug_for(url):
    p = up.urlsplit(url)
    slug = (p.path or "/").strip("/")
    if not slug:
        slug = "index"
    slug = slug.replace("/", "_")
    if p.query:
        slug += "_" + re.sub(r"[^A-Za-z0-9]+", "-", p.query)[:40]
    slug = re.sub(r"[^A-Za-z0-9._-]+", "-", slug).strip("-._") or "page"
    if len(slug) > 90:
        slug = slug[:80] + "-" + hashlib.md5(url.encode()).hexdigest()[:8]
    return slug


def safe_segment(seg):
    seg = up.unquote(seg)
    seg = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", seg).strip(" .")
    return seg or "_"


def asset_path(url):
    """backup/assets/<host>/<mirrored path>, made Windows-safe."""
    p = up.urlsplit(url)
    host = safe_segment(p.hostname or "unknown-host")
    segs = [safe_segment(s) for s in (p.path or "/").split("/") if s]
    if not segs or (p.path or "/").endswith("/"):
        segs.append("index")
    name = segs[-1]
    if p.query:
        name += "__q" + hashlib.md5(p.query.encode()).hexdigest()[:10]
        # keep an extension if the original had one, so the file stays openable
        m = re.search(r"(\.[A-Za-z0-9]{1,5})$", segs[-1])
        if m:
            name += m.group(1)
    segs = [s[:60] for s in segs[:-1]] + [name[:80]]
    full = os.path.join(DIRS["assets"], host, *segs)
    if len(full) > 240:  # Windows MAX_PATH headroom
        ext = os.path.splitext(name)[1][:6]
        full = os.path.join(
            DIRS["assets"], host, hashlib.md5(url.encode()).hexdigest() + ext
        )
    return full


def write_bytes(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as fh:
        fh.write(data)


def write_text(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(text)


# ----------------------------------------------------------------------------- extraction JS

EXTRACT_JS = r"""
() => {
  // Gator pads text with zero-width spaces and uses private-use-area icon fonts;
  // strip both so the markdown is usable as a rebuild source.
  const clean = s => (s || '')
    .replace(/[​-‏﻿⁠]/g, '')
    .replace(/[-]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const SKIP = new Set(['SCRIPT','STYLE','NOSCRIPT','SVG','PATH','IFRAME','HEAD','META','LINK']);

  // Ordered content blocks: outermost element that owns direct text.
  const blocks = [];
  const seen = new Set();
  const walk = el => {
    if (!el || SKIP.has(el.tagName)) return;
    let own = '';
    for (const n of el.childNodes) {
      if (n.nodeType === 3) own += ' ' + n.nodeValue;
    }
    own = clean(own);
    if (own) {
      const key = el.tagName + '|' + own;
      if (!seen.has(key)) {
        seen.add(key);
        const st = window.getComputedStyle(el);
        blocks.push({
          tag: el.tagName.toLowerCase(),
          text: own,
          hidden: st.display === 'none' || st.visibility === 'hidden',
          size: parseFloat(st.fontSize) || 0,
          weight: st.fontWeight,
          href: el.tagName === 'A' ? el.href : null,
        });
      }
    }
    for (const c of el.children) walk(c);
  };
  walk(document.body);

  const images = [];
  const imgSeen = new Set();
  const addImg = (src, alt) => {
    if (!src || src.startsWith('data:')) return;
    if (imgSeen.has(src)) return;
    imgSeen.add(src);
    images.push({ src, alt: clean(alt) });
  };
  document.querySelectorAll('img').forEach(i => addImg(i.currentSrc || i.src, i.alt));
  document.querySelectorAll('*').forEach(e => {
    const bg = window.getComputedStyle(e).backgroundImage;
    if (bg && bg !== 'none') {
      const m = bg.match(/url\(["']?(.*?)["']?\)/);
      if (m && m[1]) addImg(m[1], 'background image');
    }
  });

  const links = [];
  const linkSeen = new Set();
  document.querySelectorAll('a[href]').forEach(a => {
    const k = a.href + '|' + clean(a.textContent);
    if (linkSeen.has(k)) return;
    linkSeen.add(k);
    links.push({ href: a.href, text: clean(a.textContent) });
  });

  const jsonld = [];
  document.querySelectorAll('script[type="application/ld+json"]').forEach(s => {
    jsonld.push(s.textContent);
  });

  const metas = {};
  document.querySelectorAll('meta[name], meta[property]').forEach(m => {
    const k = m.getAttribute('name') || m.getAttribute('property');
    if (k && m.content) metas[k] = m.content;
  });

  return {
    title: document.title,
    metas, blocks, images, links, jsonld,
    bodyText: clean(document.body ? document.body.innerText : ''),
    headings: [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')]
      .map(h => ({ level: +h.tagName[1], text: clean(h.textContent) }))
      .filter(h => h.text),
  };
}
"""

PRICE_RE = re.compile(r"(?:^|\s)(?:US)?\$\s?\d[\d,]*(?:\.\d{2})?|\b\d+\.\d{2}\s?(?:USD)\b", re.I)


def to_markdown(url, data):
    """Render the extracted structure as clean markdown."""
    out = []
    title = (data.get("title") or "").strip()
    out.append("# %s" % (title or url))
    out.append("")
    out.append("- **URL:** %s" % url)
    out.append("- **Captured:** %s" % datetime.now().isoformat(timespec="seconds"))
    metas = data.get("metas") or {}
    for key in ("description", "og:title", "og:description", "og:image", "keywords"):
        if metas.get(key):
            out.append("- **%s:** %s" % (key, metas[key]))
    out.append("")

    prices = []
    for b in data.get("blocks", []):
        if not b.get("hidden") and PRICE_RE.search(b["text"]):
            t = b["text"].strip()
            if t not in prices and len(t) < 200:
                prices.append(t)
    if prices:
        out.append("## Prices / commerce text found on page")
        out.append("")
        for p in prices:
            out.append("- `%s`" % p)
        out.append("")

    out.append("## Content")
    out.append("")
    heading_texts = {h["text"] for h in data.get("headings", [])}
    prev = None
    for b in data.get("blocks", []):
        if b.get("hidden"):
            continue
        text = b["text"].strip()
        if not text or text == prev:
            continue
        prev = text
        tag = b["tag"]
        if tag in ("h1", "h2", "h3", "h4", "h5", "h6"):
            out.append("%s %s" % ("#" * min(int(tag[1]) + 1, 6), text))
        elif text in heading_texts:
            out.append("### %s" % text)
        elif tag == "li":
            out.append("- %s" % text)
        elif tag == "a" and b.get("href"):
            out.append("[%s](%s)" % (text, b["href"]))
        elif tag == "button":
            out.append("`[button] %s`" % text)
        elif tag in ("span", "div", "strong", "em", "b", "i") and (b.get("size") or 0) >= 24:
            out.append("### %s" % text)
        else:
            out.append(text)
        out.append("")

    imgs = data.get("images", [])
    out.append("## Images (%d)" % len(imgs))
    out.append("")
    for im in imgs:
        out.append("- ![%s](%s)" % (im.get("alt") or "", im["src"]))
    out.append("")

    links = data.get("links", [])
    out.append("## Link map (%d)" % len(links))
    out.append("")
    for ln in links:
        out.append("- [%s](%s)" % (ln.get("text") or "(no text)", ln["href"]))
    out.append("")

    jl = [j for j in (data.get("jsonld") or []) if j and j.strip()]
    if jl:
        out.append("## Structured data (JSON-LD)")
        out.append("")
        for j in jl:
            try:
                j = json.dumps(json.loads(j), indent=2, ensure_ascii=False)
            except Exception:
                pass
            out.append("```json")
            out.append(j.strip()[:20000])
            out.append("```")
            out.append("")

    return "\n".join(out)


# ----------------------------------------------------------------------------- crawl

def fetch_sitemap_urls():
    urls = []
    for name in ("sitemap.xml", "robots.txt"):
        target = "%s/%s" % (ROOT, name)
        try:
            req = urllib.request.Request(target, headers={"User-Agent": "Mozilla/5.0 backup-crawler"})
            raw = urllib.request.urlopen(req, timeout=30).read()
            write_bytes(os.path.join(BASE, name), raw)
            print("   saved %s (%d bytes)" % (name, len(raw)), flush=True)
            if name.endswith(".xml"):
                root = ET.fromstring(raw)
                for loc in root.iter():
                    if loc.tag.endswith("loc") and loc.text:
                        urls.append(loc.text.strip())
        except Exception as exc:
            log_error("seed-fetch", target, exc)
    return urls


def main():
    for d in DIRS.values():
        os.makedirs(d, exist_ok=True)
    os.makedirs(BASE, exist_ok=True)
    open(ERROR_LOG, "w", encoding="utf-8").close()

    print("== seeding ==", flush=True)
    sitemap_urls = fetch_sitemap_urls()
    print("   sitemap contributed %d urls" % len(sitemap_urls), flush=True)

    queue, queued = [], set()

    def enqueue(u):
        n = normalize(u)
        if n and n not in queued:
            queued.add(n)
            queue.append(n)
            return True
        return False

    for s in SEEDS:
        enqueue(ROOT + s)
    for u in sitemap_urls:
        enqueue(u)
    print("   queue starts with %d urls\n" % len(queue), flush=True)

    saved_assets = {}      # url -> local path
    asset_urls_seen = set()
    pending_files = []     # same-domain non-page files linked from pages
    pages_done = []        # (url, slug, body_chars, is_404)
    failed = []
    notfound = []          # URLs that rendered the Gator 404 page

    with sync_playwright() as pw:
        browser = pw.chromium.launch(args=["--disable-dev-shm-usage"])
        context = browser.new_context(
            viewport={"width": 1440, "height": 1000},
            user_agent=("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                        "(KHTML, like Gecko) Chrome/120.0 Safari/537.36"),
            ignore_https_errors=True,
        )
        page = context.new_page()
        page.set_default_timeout(NAV_TIMEOUT)

        collected = []  # Response objects for the current page

        def on_response(resp):
            try:
                ct = (resp.headers or {}).get("content-type", "").lower()
                if resp.status != 200:
                    return
                if resp.url in asset_urls_seen:
                    return
                if any(t in ct for t in ASSET_CT):
                    asset_urls_seen.add(resp.url)
                    collected.append(resp)
            except Exception:
                pass

        page.on("response", on_response)

        def drain_assets():
            """Persist bodies of the responses collected for the page just rendered."""
            n = 0
            for resp in collected:
                try:
                    body = resp.body()
                    if not body:
                        continue
                    path = asset_path(resp.url)
                    if not os.path.exists(path):
                        write_bytes(path, body)
                    saved_assets[resp.url] = path
                    n += 1
                except Exception as exc:
                    log_error("asset", resp.url, exc)
            collected.clear()
            return n

        idx = 0
        while queue and len(pages_done) < MAX_PAGES:
            url = queue.pop(0)
            idx += 1
            slug = slug_for(url)
            print("[%3d/%d] %s" % (idx, min(len(queued), MAX_PAGES), url), flush=True)
            collected.clear()
            try:
                try:
                    page.goto(url, wait_until="networkidle", timeout=NAV_TIMEOUT)
                except Exception:
                    # networkidle can time out on pages with long-poll/analytics sockets
                    page.goto(url, wait_until="domcontentloaded", timeout=NAV_TIMEOUT)
                page.wait_for_timeout(SETTLE_MS)

                # Scroll through the page so lazy-loaded images/sections render.
                try:
                    page.evaluate(
                        """async () => {
                            const step = Math.round(window.innerHeight * 0.8);
                            for (let y = 0; y < document.body.scrollHeight; y += step) {
                                window.scrollTo(0, y);
                                await new Promise(r => setTimeout(r, 250));
                            }
                            window.scrollTo(0, 0);
                            await new Promise(r => setTimeout(r, 400));
                        }"""
                    )
                    page.wait_for_load_state("networkidle", timeout=15000)
                except Exception:
                    pass
                page.wait_for_timeout(500)

                html = page.content()
                write_text(os.path.join(DIRS["pages"], slug + ".html"), html)

                try:
                    page.screenshot(
                        path=os.path.join(DIRS["screenshots"], slug + ".png"),
                        full_page=True, timeout=45000,
                    )
                except Exception as exc:
                    log_error("screenshot", url, exc)
                    try:
                        page.screenshot(path=os.path.join(DIRS["screenshots"], slug + ".png"))
                    except Exception as exc2:
                        log_error("screenshot-fallback", url, exc2)

                data = page.evaluate(EXTRACT_JS)
                write_text(os.path.join(DIRS["content"], slug + ".md"), to_markdown(url, data))
                body_chars = len(data.get("bodyText") or "")

                n_assets = drain_assets()

                added = 0
                for ln in data.get("links", []):
                    href = ln.get("href") or ""
                    if FILE_EXT.search(up.urlsplit(href).path or ""):
                        if href not in asset_urls_seen and href.startswith("http"):
                            pending_files.append(href)
                        continue
                    if len(queued) < MAX_PAGES * 3 and enqueue(href):
                        added += 1

                is404 = ("404" in (data.get("title") or "")
                         or "Page Not Found" in (data.get("bodyText") or "")[:400])
                if is404:
                    notfound.append(url)
                pages_done.append((url, slug, body_chars, is404))
                print("        ok  text=%d chars, assets+%d, new links+%d%s" %
                      (body_chars, n_assets, added, "  [404 PAGE]" if is404 else ""),
                      flush=True)
            except Exception as exc:
                failed.append(url)
                log_error("page", url, "%s | %s" % (exc, traceback.format_exc(limit=1)))
            time.sleep(PAGE_DELAY)

        # ---- linked files (PDFs etc.) that never appeared as a network response
        extra = [u for u in dict.fromkeys(pending_files) if u not in saved_assets]
        if extra:
            print("\n== fetching %d linked files (pdf/media) ==" % len(extra), flush=True)
            for u in extra[:200]:
                try:
                    r = context.request.get(u, timeout=45000)
                    if r.status == 200:
                        body = r.body()
                        if body:
                            path = asset_path(u)
                            if not os.path.exists(path):
                                write_bytes(path, body)
                            saved_assets[u] = path
                            print("   + %s" % u, flush=True)
                except Exception as exc:
                    log_error("linked-file", u, exc)
                time.sleep(0.3)

        browser.close()

    # ---- manifest
    lines = []
    lines.append("medpsycmoss.com backup manifest")
    lines.append("generated: %s" % datetime.now().isoformat(timespec="seconds"))
    lines.append("")
    lines.append("PAGES SAVED: %d  (of which %d rendered the site's 404 page)"
                 % (len(pages_done), len(notfound)))
    lines.append("=" * 70)
    for u, s, n, is404 in pages_done:
        lines.append("%-60s  %-45s  %6d chars%s"
                     % (u, s + ".html", n, "  [404]" if is404 else ""))
    lines.append("")
    lines.append("ASSETS SAVED: %d" % len(saved_assets))
    lines.append("=" * 70)
    by_host = {}
    for u, p in sorted(saved_assets.items()):
        host = up.urlsplit(u).hostname or "?"
        by_host.setdefault(host, []).append((u, p))
    for host, items in sorted(by_host.items(), key=lambda kv: -len(kv[1])):
        lines.append("")
        lines.append("--- %s (%d) ---" % (host, len(items)))
        for u, p in items:
            lines.append("%s  ->  %s" % (u, os.path.relpath(p, BASE)))
    lines.append("")
    lines.append("FAILED PAGES: %d" % len(failed))
    for u in failed:
        lines.append("  " + u)
    lines.append("")
    lines.append("URLS THAT RETURNED THE 404 PAGE: %d" % len(notfound))
    for u in notfound:
        lines.append("  " + u)
    lines.append("")
    lines.append("ERRORS LOGGED: %d (see errors.log)" % len(errors))
    write_text(os.path.join(BASE, "manifest.txt"), "\n".join(lines))

    print("\n== crawl complete ==")
    print("pages=%d assets=%d failed=%d 404s=%d errors=%d" %
          (len(pages_done), len(saved_assets), len(failed), len(notfound), len(errors)))
    if failed:
        print("failed urls:")
        for u in failed:
            print("  " + u)
    if notfound:
        print("urls serving the 404 page:")
        for u in notfound:
            print("  " + u)
    return 0


if __name__ == "__main__":
    sys.exit(main())
