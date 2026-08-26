"""Pull the product gallery images out of the archive and name them by product.

The crawler saved every image under a hash of its query string, which is correct
for fidelity and useless for a human. This walks the manifest back to the
original URL, works out which product page each image appears on, and writes a
readable copy. Originals are untouched.
"""
import os, re, shutil

os.chdir(r"c:\Users\Basim\Documents\mtf-worker\medpsycmoss.com")
OUT = "product-images"

url2path = {}
for line in open("backup/manifest.txt", encoding="utf-8", errors="replace"):
    if "  ->  " in line:
        u, p = line.split("  ->  ", 1)
        url2path[u.strip()] = p.strip().replace("\\", "/")

saved = {}
for u, p in url2path.items():
    for h in re.findall(r"[0-9a-f]{32}", u):
        full = os.path.join("backup", p)
        if os.path.exists(full):
            saved.setdefault(h, full)

def ext(path):
    b = open(path, "rb").read(12)
    if b[:3] == b"\xff\xd8\xff": return ".jpg"
    if b[:8] == b"\x89PNG\r\n\x1a\n": return ".png"
    if b[:4] == b"RIFF" and b[8:12] == b"WEBP": return ".webp"
    if b[:6] in (b"GIF87a", b"GIF89a"): return ".gif"
    return ".bin"

PROD = re.compile(r"production-gator-v1-0-0(?:%2F|/)000(?:%2F|/)1170000(?:%2F|/)Xlwz0WqW(?:%2F|/)([0-9a-f]{32})")

if os.path.isdir(OUT): shutil.rmtree(OUT)
total = 0
for fn in sorted(os.listdir("backup/pages")):
    if not fn.startswith("store_p_"): continue
    src = open(os.path.join("backup/pages", fn), encoding="utf-8", errors="replace").read()
    # order matters: the first image is the one shown on the tile
    seen, order = set(), []
    for h in PROD.findall(src):
        if h not in seen:
            seen.add(h); order.append(h)
    if not order: continue
    name = fn.replace("store_p_", "").replace(".html", "")
    d = os.path.join(OUT, name)
    os.makedirs(d, exist_ok=True)
    for i, h in enumerate(order, 1):
        if h not in saved: continue
        dst = os.path.join(d, "%02d%s" % (i, ext(saved[h])))
        shutil.copy2(saved[h], dst)
        total += 1
    print("  %-58s %2d images" % (name[:58], len(order)))

mb = sum(os.path.getsize(os.path.join(r, f))
         for r, _, fs in os.walk(OUT) for f in fs) / 1048576
print("\n%d images written to %s/  (%.1f MB)" % (total, OUT, mb))
