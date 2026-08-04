# ─────────────────────────────────────────────────────────────────────────────
# MedPsycMoss — Stephanie Moss, MD
#
# 180 static pages rebuilt from a crawl of the client's Gator Website Builder
# site. Nothing to compile and no runtime: this image is nginx plus site/.
#
# site/ is committed rather than built here on purpose. Regenerating it needs the
# 2 GB crawl archive, a dev server and a headless browser, none of which belong
# in a production image. Source and build scripts live in the repo this branch
# was cut from; see README.md.
# ─────────────────────────────────────────────────────────────────────────────
FROM nginx:1.27-alpine

LABEL org.opencontainers.image.title="MedPsycMoss" \
      org.opencontainers.image.description="Static site for Stephanie Moss, MD (medpsycmoss.com)"

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY site/      /usr/share/nginx/html/

# Gzip once, here, rather than on every request. gzip_static then serves the .gz
# straight off disk. Text only; the WebP and woff2 are already compressed.
RUN find /usr/share/nginx/html \( -name '*.html' -o -name '*.css' -o -name '*.js' \
      -o -name '*.xml' -o -name '*.svg' -o -name '*.json' -o -name '*.txt' \) \
      -exec sh -c 'gzip -9 -c "$1" > "$1.gz"' _ {} \; \
 && echo "pages: $(find /usr/share/nginx/html -name index.html | wc -l)"

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1/healthz || exit 1
