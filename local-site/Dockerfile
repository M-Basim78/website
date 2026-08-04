# MedPsycMoss, static site.
#
# dist/ is committed rather than built here on purpose: regenerating it needs the
# 2 GB crawl archive, a running dev server and a headless browser, none of which
# belong in a production image. Rebuild it locally with:
#
#   node build-resources.mjs && node build-products.mjs && node build-static.mjs
#
# The image is then just nginx plus 2.8 MB of static files.

FROM nginx:1.27-alpine

RUN rm -f /etc/nginx/conf.d/default.conf
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY dist/ /usr/share/nginx/html/

# Unprivileged: nginx:alpine ships an `nginx` user, and the conf listens on 8080
# so no capability to bind a low port is needed.
RUN chown -R nginx:nginx /usr/share/nginx/html \
 && touch /var/run/nginx.pid && chown nginx:nginx /var/run/nginx.pid \
 && chown -R nginx:nginx /var/cache/nginx
USER nginx

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/ >/dev/null 2>&1 || exit 1

CMD ["nginx", "-g", "daemon off;"]
