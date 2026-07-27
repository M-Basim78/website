"""
Second pass: re-download assets whose bodies Chromium had already evicted from its
cache when the crawler tried to read them ("No resource with given identifier").

Reads the URLs straight out of backup/errors.log and fetches them over plain HTTP.
"""

import io
import os
import re
import sys
import time
import urllib.error
import urllib.request

import crawl

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/120.0 Safari/537.36")

LINE_RE = re.compile(r"\]\s+(asset|linked-file)\s+::\s+(\S+)\s+::")


def main():
    log = os.path.join(crawl.BASE, "errors.log")
    if not os.path.exists(log):
        print("no errors.log; nothing to repair")
        return 0

    with io.open(log, encoding="utf-8", errors="replace") as fh:
        urls = []
        for line in fh:
            m = LINE_RE.search(line)
            if m and m.group(2).startswith("http"):
                urls.append(m.group(2))
    urls = list(dict.fromkeys(urls))
    print("candidate URLs to repair: %d" % len(urls))

    ok, skipped, failed = 0, 0, []
    for i, u in enumerate(urls, 1):
        try:
            path = crawl.asset_path(u)
        except Exception as exc:
            failed.append((u, "path: %s" % exc))
            continue
        if os.path.exists(path) and os.path.getsize(path) > 0:
            skipped += 1
            continue
        try:
            req = urllib.request.Request(u, headers={
                "User-Agent": UA,
                "Accept": "*/*",
                "Referer": "https://medpsycmoss.com/",
            })
            with urllib.request.urlopen(req, timeout=45) as resp:
                if resp.status != 200:
                    failed.append((u, "status %s" % resp.status))
                    continue
                body = resp.read()
            if not body:
                failed.append((u, "empty body"))
                continue
            crawl.write_bytes(path, body)
            ok += 1
            print("  [%3d/%d] + %-9s %s" % (i, len(urls), len(body), u[:110]), flush=True)
        except Exception as exc:
            failed.append((u, str(exc)[:120]))
        time.sleep(0.15)

    print()
    print("repaired: %d   already present: %d   still failing: %d" % (ok, skipped, len(failed)))
    if failed:
        print("still failing:")
        for u, why in failed:
            print("  %-100s  %s" % (u[:100], why))
    with io.open(os.path.join(crawl.BASE, "asset-repair.log"), "w",
                 encoding="utf-8", newline="\n") as fh:
        fh.write("repaired=%d skipped=%d failed=%d\n\n" % (ok, skipped, len(failed)))
        for u, why in failed:
            fh.write("FAIL %s :: %s\n" % (u, why))
    return 0


if __name__ == "__main__":
    sys.exit(main())
