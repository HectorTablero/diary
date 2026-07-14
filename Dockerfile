# check=skip=SecretsUsedInArgOrEnv
# ^ Parser directives must be the first line, so the reason goes here: the Better Stack ingest
# token below is deliberately public. Vite inlines it into the web bundle, so anyone running the
# app already has it, and it is write-only (it can send logs, not read them). Having it in the
# image history adds no exposure.

FROM node:24-alpine AS build
WORKDIR /app
COPY package*.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY web/package.json web/
# The `prepare` lifecycle script runs during `npm ci`, so it has to exist before the install —
# this stage installs deps ahead of the full COPY to keep the layer cached. It no-ops here
# anyway: .git is .dockerignore'd, and there are no hooks to install in an image.
COPY scripts/ scripts/
RUN npm ci --no-audit --no-fund
COPY . .
# Vite inlines these into the web bundle, so they have to be present at build time, not runtime.
# Both are safe to expose: the token is a write-only Better Stack ingest key. Leave them unset and
# the web app simply runs without telemetry.
ARG VITE_BETTERSTACK_SOURCE_TOKEN
ARG VITE_BETTERSTACK_INGEST_URL
RUN npm run build

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
COPY shared/package.json shared/
COPY server/package.json server/
RUN npm ci --omit=dev --no-audit --no-fund -w server --ignore-scripts
COPY --from=build /app/server/dist server/dist
COPY --from=build /app/web/dist web/dist
EXPOSE 3000
CMD ["node", "server/dist/index.js"]
