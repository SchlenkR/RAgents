# The check runner's foreign machine: Node 22 on Linux with the host package from this checkout.
# VARIANT=browser adds Chromium; the layer comes before the package and therefore stays in the cache.
ARG VARIANT=plain

FROM node:22-bookworm-slim AS plain
ENV NPM_CONFIG_UPDATE_NOTIFIER=false NPM_CONFIG_FUND=false NPM_CONFIG_AUDIT=false
# /private/tmp holds the folder that --shared-path creates under the same path as on the Mac.
RUN mkdir -p /opt/ragents /work/project /private/tmp \
    && chown -R node:node /opt/ragents /work \
    && chmod 1777 /private/tmp \
    && ln -s /opt/ragents/scripts/package/ragents.mjs /usr/local/bin/ragents

FROM plain AS browser
RUN apt-get update \
    && apt-get install --yes --no-install-recommends chromium fonts-liberation \
    && rm -rf /var/lib/apt/lists/*

FROM ${VARIANT} AS host
USER node
WORKDIR /opt/ragents

# First the dependencies from the package manifest, so this layer comes from the cache when versions are unchanged.
COPY --chown=node:node dependencies/package.json ./package.json
RUN npm install --omit=dev --no-package-lock

COPY --chown=node:node package/ ./
RUN chmod +x scripts/package/ragents.mjs \
    && node --input-type=module -e 'const { ensureHostLinks } = await import("/opt/ragents/scripts/package/host-links.mjs"); ensureHostLinks("/opt/ragents");'

WORKDIR /work/project
