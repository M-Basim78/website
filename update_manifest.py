"""Fold the repair-pass assets into manifest.txt and refresh the on-disk counts."""

import io
import os
import re
import urllib.parse as up

import crawl

BASE = crawl.BASE
MANIFEST = os.path.join(BASE, "manifest.txt")
LINE_RE = re.compile(r"\]\s+(asset|linked-file)\s+::\s+(\S+)\s+::")

with io.open(MANIFEST, encoding="utf-8") as fh:
    text = fh.read()

# URLs the repair pass went after, that now exist on disk.
repaired = []
with io.open(os.path.join(BASE, "errors.log"), encoding="utf-8", errors="replace") as fh:
    for line in fh:
        m = LINE_RE.search(line)
        if m and m.group(2).startswith("http"):
            u = m.group(2)
            try:
                p = crawl.asset_path(u)
            except Exception:
                continue
            if os.path.exists(p) and os.path.getsize(p) > 0:
                repaired.append((u, p))
repaired = list(dict.fromkeys(repaired))

# Actual on-disk totals.
n_files, n_bytes, by_host = 0, 0, {}
for host in sorted(os.listdir(crawl.DIRS["assets"])):
    hdir = os.path.join(crawl.DIRS["assets"], host)
    if not os.path.isdir(hdir):
        continue
    c = 0
    for root, _d, files in os.walk(hdir):
        for f in files:
            c += 1
            n_files += 1
            try:
                n_bytes += os.path.getsize(os.path.join(root, f))
            except OSError:
                pass
    by_host[host] = c

extra = []
extra.append("")
extra.append("=" * 70)
extra.append("SECOND-PASS ASSET REPAIR")
extra.append("=" * 70)
extra.append("Assets whose bodies Chromium had evicted before the crawler could read")
extra.append("them, re-downloaded over plain HTTP: %d" % len(repaired))
extra.append("")
for u, p in sorted(repaired):
    extra.append("%s  ->  %s" % (u, os.path.relpath(p, BASE)))
extra.append("")
extra.append("=" * 70)
extra.append("FINAL ON-DISK ASSET TOTALS")
extra.append("=" * 70)
extra.append("total asset files: %d" % n_files)
extra.append("total asset bytes: %d" % n_bytes)
extra.append("")
for host, c in sorted(by_host.items(), key=lambda kv: -kv[1]):
    extra.append("  %-46s %5d files" % (host, c))

with io.open(MANIFEST, "w", encoding="utf-8", newline="\n") as fh:
    fh.write(text.rstrip("\n") + "\n" + "\n".join(extra) + "\n")

print("manifest updated: +%d repaired assets, %d asset files on disk across %d hosts"
      % (len(repaired), n_files, len(by_host)))
