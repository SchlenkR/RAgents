# Der fremde Rechner des Prüfläufers: Node 22 unter Linux mit dem Host-Paket aus diesem Checkout.
# VARIANT=browser legt Chromium dazu; die Schicht liegt vor dem Paket und bleibt deshalb im Cache.
ARG VARIANT=plain

FROM node:22-bookworm-slim AS plain
ENV NPM_CONFIG_UPDATE_NOTIFIER=false NPM_CONFIG_FUND=false NPM_CONFIG_AUDIT=false
# /private/tmp nimmt den Ordner auf, den --shared-path unter demselben Pfad wie auf dem Mac anlegt.
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

# Erst die Abhängigkeiten aus dem Paketmanifest, damit diese Schicht bei unveränderten Fassungen aus dem Cache kommt.
COPY --chown=node:node dependencies/package.json ./package.json
RUN npm install --omit=dev --no-package-lock

COPY --chown=node:node package/ ./
RUN chmod +x scripts/package/ragents.mjs \
    && node --input-type=module -e 'const { ensureHostLinks } = await import("/opt/ragents/scripts/package/host-links.mjs"); ensureHostLinks("/opt/ragents");'

WORKDIR /work/project
