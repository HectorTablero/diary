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
# @playwright/test is a root devDependency (the e2e suite), and its `install` script downloads
# ~150 MB of browsers. This stage runs with lifecycle scripts enabled — it has to, for `prepare` —
# so without this every image build would pay for browsers the image never runs. The runtime stage
# below sidesteps it differently, with --ignore-scripts.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
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

# The node image ships an unprivileged `node` user; nothing here needs root. The app writes
# nothing to disk — state is in MongoDB — so read access to the files copied above is all it
# needs, and those are world-readable.
USER node

# /api/health is already the client's own reconnect probe (web/src/db/sync.ts), so this reuses
# the endpoint the app is defined by rather than inventing a second definition of "up".
#
# node -e rather than curl or wget: the image has neither, and adding one to answer a healthcheck
# would put a package in the runtime image purely for this. Node 24 has global fetch.
# 127.0.0.1 rather than localhost so the check cannot depend on how DNS resolves inside the
# container, and PORT is read the same way config.ts reads it.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/dist/index.js"]
