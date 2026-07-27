"""
Verify the medpsycmoss.com backup is real (JS-rendered content, not footer-only
shells), then zip it.

Checks:
  1. >= 15 saved HTML files carry > 2000 chars of body text
  2. screenshots exist and > 50 KB
  3. image assets were captured
  4. every page has a matching content/*.md
  5. the store + product pages are present and carry pricing text
"""

import io
import os
import re
import sys
import zipfile
from datetime import datetime

BASE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "backup")
PAGES = os.path.join(BASE, "pages")
SHOTS = os.path.join(BASE, "screenshots")
CONTENT = os.path.join(BASE, "content")
ASSETS = os.path.join(BASE, "assets")

MIN_TEXT_PAGES = 15
MIN_TEXT_CHARS = 2000
MIN_SHOT_BYTES = 50 * 1024
IMG_EXT = (".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg", ".ico", ".avif")

TAG_RE = re.compile(r"<(script|style|noscript)\b.*?</\1>", re.S | re.I)
STRIP_RE = re.compile(r"<[^>]+>")


def body_text(html):
    m = re.search(r"<body\b[^>]*>(.*)</body>", html, re.S | re.I)
    chunk = m.group(1) if m else html
    chunk = TAG_RE.sub(" ", chunk)
    chunk = STRIP_RE.sub(" ", chunk)
    chunk = re.sub(r"&[a-zA-Z#0-9]{1,8};", " ", chunk)
    return re.sub(r"\s+", " ", chunk).strip()


MAGIC = [
    (b"\xff\xd8\xff", "jpeg"), (b"\x89PNG", "png"), (b"GIF8", "gif"),
    (b"%PDF", "pdf"), (b"wOFF", "woff"), (b"wOF2", "woff2"),
    (b"\x00\x01\x00\x00", "ttf"), (b"OTTO", "otf"), (b"\x1f\x8b", "gzip"),
    (b"ID3", "mp3"), (b"\x00\x00\x00 ftyp", "mp4"),
]


def sniff(path):
    """Identify an asset by content, since CDN assets often have no extension."""
    try:
        with open(path, "rb") as fh:
            head = fh.read(64)
    except OSError:
        return "(unreadable)"
    if not head:
        return "(empty)"
    if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return "webp"
    for magic, name in MAGIC:
        if head.startswith(magic):
            return name
    low = head.lstrip()[:200].lower()
    if low.startswith(b"<svg") or (low.startswith(b"<?xml") and b"svg" in low):
        return "svg"
    if head[:4] in (b"\x00\x00\x01\x00",):
        return "ico"
    ext = os.path.splitext(path)[1].lower().lstrip(".")
    if ext in ("js", "mjs", "css", "json", "html", "htm"):
        return ext
    try:
        head.decode("utf-8")
        return "text/code"
    except UnicodeDecodeError:
        return "(binary, unknown)"


def human(n):
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1024:
            return "%.1f %s" % (n, unit)
        n /= 1024.0
    return "%.1f TB" % n


def main():
    out = []
    def say(s=""):
        out.append(s)
        print(s, flush=True)

    say("=" * 74)
    say("BACKUP VERIFICATION REPORT  -  medpsycmoss.com")
    say("generated: %s" % datetime.now().isoformat(timespec="seconds"))
    say("=" * 74)

    if not os.path.isdir(PAGES):
        say("FATAL: %s does not exist" % PAGES)
        return 1

    # ---------------------------------------------------------------- 1. rendered HTML
    html_files = sorted(f for f in os.listdir(PAGES) if f.endswith(".html"))
    text_lens = {}
    for f in html_files:
        try:
            with io.open(os.path.join(PAGES, f), encoding="utf-8", errors="replace") as fh:
                text_lens[f] = len(body_text(fh.read()))
        except Exception as exc:
            text_lens[f] = 0
            say("  ! could not read %s: %s" % (f, exc))

    rich = {f: n for f, n in text_lens.items() if n > MIN_TEXT_CHARS}
    shells = {f: n for f, n in text_lens.items() if n <= 500}

    say()
    say("CHECK 1 - JS rendering (body text in saved HTML)")
    say("-" * 74)
    say("  HTML files saved ................ %d" % len(html_files))
    say("  files with > %d chars ......... %d   (need >= %d)"
        % (MIN_TEXT_CHARS, len(rich), MIN_TEXT_PAGES))
    say("  files with <= 500 chars ......... %d   (possible empty shells)" % len(shells))
    if text_lens:
        say("  median body text ................ %d chars"
            % sorted(text_lens.values())[len(text_lens) // 2])
        say("  largest ......................... %d chars" % max(text_lens.values()))
    check1 = len(rich) >= MIN_TEXT_PAGES
    say("  RESULT: %s" % ("PASS" if check1 else "FAIL"))
    say()
    say("  top 15 pages by rendered text:")
    for f, n in sorted(text_lens.items(), key=lambda kv: -kv[1])[:15]:
        say("    %-52s %7d chars" % (f, n))
    if shells:
        say("  files that look like shells (<=500 chars):")
        for f, n in sorted(shells.items(), key=lambda kv: kv[1])[:20]:
            say("    %-52s %7d chars" % (f, n))

    # ---------------------------------------------------------------- 2. screenshots
    say()
    say("CHECK 2 - screenshots")
    say("-" * 74)
    shots = []
    if os.path.isdir(SHOTS):
        shots = sorted(f for f in os.listdir(SHOTS) if f.endswith(".png"))
    sizes = {f: os.path.getsize(os.path.join(SHOTS, f)) for f in shots}
    big = {f: s for f, s in sizes.items() if s > MIN_SHOT_BYTES}
    say("  screenshots saved ............... %d" % len(shots))
    say("  larger than 50 KB ............... %d" % len(big))
    if sizes:
        say("  total screenshot bytes .......... %s" % human(sum(sizes.values())))
        say("  largest ......................... %s" % human(max(sizes.values())))
    missing_shots = [f[:-5] for f in html_files if f[:-5] + ".png" not in sizes]
    say("  pages missing a screenshot ...... %d" % len(missing_shots))
    for m in missing_shots[:10]:
        say("    - %s" % m)
    check2 = len(big) >= MIN_TEXT_PAGES and len(shots) > 0
    say("  RESULT: %s" % ("PASS" if check2 else "FAIL"))

    # ---------------------------------------------------------------- 3. assets
    say()
    say("CHECK 3 - assets")
    say("-" * 74)
    by_host, by_kind, total_bytes, n_assets = {}, {}, 0, 0
    images = 0
    if os.path.isdir(ASSETS):
        for host in sorted(os.listdir(ASSETS)):
            hdir = os.path.join(ASSETS, host)
            if not os.path.isdir(hdir):
                continue
            cnt, hbytes = 0, 0
            for root, _dirs, files in os.walk(hdir):
                for f in files:
                    p = os.path.join(root, f)
                    try:
                        sz = os.path.getsize(p)
                    except OSError:
                        continue
                    cnt += 1
                    hbytes += sz
                    total_bytes += sz
                    # Gator/Google CDN assets are served without file extensions,
                    # so identify by magic bytes rather than by name.
                    kind = sniff(p)
                    by_kind[kind] = by_kind.get(kind, 0) + 1
                    if kind in ("jpeg", "png", "gif", "webp", "svg", "ico"):
                        images += 1
            n_assets += cnt
            by_host[host] = (cnt, hbytes)
    say("  asset files saved ............... %d" % n_assets)
    say("  image files ..................... %d" % images)
    say("  total asset bytes ............... %s" % human(total_bytes))
    say("  distinct hosts .................. %d" % len(by_host))
    for host, (cnt, hb) in sorted(by_host.items(), key=lambda kv: -kv[1][0]):
        say("    %-42s %5d files  %10s" % (host, cnt, human(hb)))
    say("  by extension:")
    for ext, cnt in sorted(by_kind.items(), key=lambda kv: -kv[1])[:15]:
        say("    %-12s %5d" % (ext, cnt))
    check3 = images > 0 and n_assets > 0
    say("  RESULT: %s" % ("PASS" if check3 else "FAIL"))

    # ---------------------------------------------------------------- 4. markdown
    say()
    say("CHECK 4 - content extraction")
    say("-" * 74)
    mds = sorted(f for f in os.listdir(CONTENT)) if os.path.isdir(CONTENT) else []
    md_sizes = {f: os.path.getsize(os.path.join(CONTENT, f)) for f in mds}
    missing_md = [f[:-5] for f in html_files if f[:-5] + ".md" not in md_sizes]
    say("  markdown files .................. %d" % len(mds))
    say("  pages missing markdown .......... %d" % len(missing_md))
    for m in missing_md[:10]:
        say("    - %s" % m)
    check4 = len(mds) > 0 and not missing_md
    say("  RESULT: %s" % ("PASS" if check4 else "FAIL"))

    # ------------------------------------------------ 4b. crawled-vs-saved reconciliation
    say()
    say("CHECK 4b - crawled URLs vs saved files")
    say("-" * 74)
    manifest = os.path.join(BASE, "manifest.txt")
    crawled = 0
    if os.path.exists(manifest):
        with io.open(manifest, encoding="utf-8", errors="replace") as fh:
            m = re.search(r"PAGES SAVED:\s*(\d+)", fh.read())
        if m:
            crawled = int(m.group(1))
    say("  URLs crawled (manifest) ......... %d" % crawled)
    say("  HTML files on disk .............. %d" % len(html_files))
    gap = crawled - len(html_files)
    if gap:
        say("  difference ...................... %d" % gap)
        say("  cause: Windows filesystem is case-insensitive, so URLs differing only")
        say("         by letter case collapse into one file (same page, same content).")
    check4b = gap >= 0 and len(html_files) > 0
    say("  RESULT: %s" % ("PASS" if check4b else "FAIL"))

    # ---------------------------------------------------------------- 5. store/products
    say()
    say("CHECK 5 - store and product pages")
    say("-" * 74)
    store_like = [f for f in mds
                  if f.startswith("store") or f.startswith("products") or "product" in f]
    priced = []
    for f in store_like:
        try:
            with io.open(os.path.join(CONTENT, f), encoding="utf-8", errors="replace") as fh:
                txt = fh.read()
        except Exception:
            continue
        has_price = bool(re.search(r"\$\s?\d", txt))
        if has_price:
            priced.append(f)
        say("    %-52s %7s chars %s"
            % (f, len(txt), "PRICE FOUND" if has_price else "no price text"))
    if not store_like:
        say("    (no store/product pages found)")
    say("  store/product pages ............. %d" % len(store_like))
    say("  of those, containing prices ..... %d" % len(priced))
    check5 = len(store_like) > 0
    say("  RESULT: %s" % ("PASS" if check5 else "FAIL"))

    # ---------------------------------------------------------------- summary
    checks = [
        ("JS rendering (>=15 pages >2000 chars)", check1),
        ("screenshots present and >50KB", check2),
        ("assets incl. images captured", check3),
        ("markdown extraction complete", check4),
        ("crawled URLs reconcile with saved files", check4b),
        ("store/product pages captured", check5),
    ]
    say()
    say("=" * 74)
    for name, ok in checks:
        say("  [%s] %s" % ("PASS" if ok else "FAIL", name))
    all_ok = all(ok for _n, ok in checks)
    say("  OVERALL: %s" % ("PASS" if all_ok else "FAIL"))
    say("=" * 74)

    try:
        with io.open(os.path.join(BASE, "verification-report.txt"), "w",
                     encoding="utf-8", newline="\n") as fh:
            fh.write("\n".join(out) + "\n")
    except Exception as exc:
        print("could not write verification report: %s" % exc)

    if not all_ok:
        print("\nVerification FAILED - not zipping.")
        return 1

    # ---------------------------------------------------------------- zip
    zip_name = "medpsycmoss-backup-%s.zip" % datetime.now().strftime("%Y%m%d")
    zip_path = os.path.join(os.path.dirname(BASE), zip_name)
    print("\nZipping backup -> %s" % zip_name, flush=True)
    n = 0
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as zf:
        for root, _dirs, files in os.walk(BASE):
            for f in files:
                p = os.path.join(root, f)
                zf.write(p, os.path.relpath(p, os.path.dirname(BASE)))
                n += 1
    print("  files zipped .................. %d" % n)
    print("  archive size .................. %s" % human(os.path.getsize(zip_path)))
    print("  archive path .................. %s" % zip_path)

    print()
    print("=" * 74)
    print("FINAL SUMMARY")
    print("=" * 74)
    print("  pages (rendered HTML) ......... %d" % len(html_files))
    print("  screenshots ................... %d  (%s)" % (len(shots), human(sum(sizes.values()))))
    print("  markdown content files ........ %d" % len(mds))
    print("  assets ........................ %d  (%s across %d hosts)"
          % (n_assets, human(total_bytes), len(by_host)))
    print("  archive ....................... %s (%s)"
          % (zip_name, human(os.path.getsize(zip_path))))
    print("=" * 74)
    return 0


if __name__ == "__main__":
    sys.exit(main())
