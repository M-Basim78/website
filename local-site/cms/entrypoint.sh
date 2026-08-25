#!/bin/sh
# Reconcile developer changes with her changes at every start.
#
# content/ is a volume: her words survive redeploys.
# rebuild/ and dist/ come from the image: template, layout and code changes land.
#
# The build then combines the two, so a deploy never discards her writing and her
# writing never blocks a code update. If content/ is empty (first ever run) the
# copy seeds it from the image.
set -e

if [ -z "$(ls -A /app/content 2>/dev/null)" ]; then
  echo "content/ is empty, seeding it from the image"
  cp -r /app/content-seed/. /app/content/
fi

echo "rebuilding the site from content/"
node /app/build-store.mjs
node /app/build-from-content.mjs
node /app/build-static.mjs

exec "$@"
