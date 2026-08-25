# MedPsycMoss: the public site and the editor, in one container.
#
# Node serves dist/ and hosts the editor at /admin. Saving writes to content/,
# and Publish runs the same build scripts a developer would, so she can change
# the site without anyone's help and without a GitHub account.
#
# No nginx: the editor has to write content and re-run the build, so one process
# that can do both beats two containers sharing a volume.

FROM node:22-alpine

LABEL org.opencontainers.image.title="MedPsycMoss" \
      org.opencontainers.image.description="Static site for Stephanie Moss, MD, with a built-in editor"

WORKDIR /app

# No npm install: the CMS has no dependencies and the build scripts are plain Node.
COPY cms/                   ./cms/
COPY rebuild/               ./rebuild/
COPY dist/                  ./dist/
COPY build-from-content.mjs build-static.mjs build-store.mjs ./

# content/ ships as a seed, not as the live directory. At boot the entrypoint
# copies it in only if the volume is empty, so a redeploy never overwrites her
# writing, while rebuild/ and dist/ still come fresh from the image and pick up
# template and code changes.
COPY content/               ./content-seed/
RUN mkdir -p /app/content

RUN addgroup -S app && adduser -S app -G app \
 && chmod +x /app/cms/entrypoint.sh \
 && chown -R app:app /app/content /app/rebuild /app/dist
USER app

ENV PORT=8080 NODE_ENV=production
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1

ENTRYPOINT ["/app/cms/entrypoint.sh"]
CMD ["node", "cms/server.js"]
