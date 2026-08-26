#!/bin/sh
# Reconcile developer changes with her changes at every start.
#
# content/ is a volume: her words survive redeploys.
# rebuild/ and dist/ come from the image: template, layout and code changes land.
#
# The build then combines the two, so a deploy never discards her writing and her
# writing never blocks a code update.
set -e

if [ -z "$(ls -A /app/content 2>/dev/null)" ]; then
  echo "content/ is empty, seeding it from the image"
  cp -r /app/content-seed/. /app/content/
else
  # The volume already exists, so her edits are authoritative and nothing here
  # overwrites them. But a file the developer ADDS to content/ used to never
  # arrive at all: the seed only ran on a first-ever boot, so a new data file
  # shipped in an image sat unused behind an existing volume forever. Copy
  # across only what is genuinely missing.
  cd /app/content-seed
  find . -type f | while read -r f; do
    if [ ! -e "/app/content/$f" ]; then
      mkdir -p "/app/content/$(dirname "$f")"
      cp "$f" "/app/content/$f"
      echo "  seeded new file: $f"
    fi
  done
  cd /app
fi

# NOTE: a file that already exists in the volume is never replaced, products.json
# included. That is correct, because she edits products in the editor. It also
# means a catalogue change made in git does NOT reach a running server on its
# own. To push one deliberately:
#
#   docker cp content/products.json medpsycmoss-site:/app/content/products.json
#   docker compose restart
#
# See reports/deploy-runbook.md.

echo "rebuilding the site from content/"
node /app/build-store.mjs
node /app/build-from-content.mjs
node /app/build-static.mjs

exec "$@"
