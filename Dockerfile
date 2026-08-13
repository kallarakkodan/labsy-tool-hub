# syntax=docker/dockerfile:1
#
# Labsy Tool Hub — Docker image.
#
# Three stages: install once with dev dependencies (needed for `next build`
# and, at runtime, the `prisma` CLI for schema sync — see the "why not a
# leaner prod-only stage" note below), build, then a slim runtime layer.
#
# Deliberately NOT `output: "standalone"` (next.config.ts): standalone mode's
# file tracing has known rough edges with native addons, and this app has
# one — better-sqlite3's compiled `.node` binding, via
# @prisma/adapter-better-sqlite3. Shipping the full `node_modules` is bigger
# but predictable, and it is the exact same `node_modules/.bin/next start`
# invocation already verified against a real systemd deployment.

ARG NODE_VERSION=26
ARG PNPM_VERSION=11.21.0

# ---- deps: installed once, with dev dependencies ----------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS deps
ARG PNPM_VERSION
# Not `corepack enable`: corepack is unbundled from Node 25+ (same note PRD
# §12.2's own bare-metal provisioning makes) — the binary does not exist on
# this image, so `corepack enable` fails with "not found".
RUN npm install -g pnpm@${PNPM_VERSION}
# Prisma's engine postinstall step detects OpenSSL and warns loudly (falling
# back to a guessed version) if it is not present — harmless on this driver
# (better-sqlite3, not Prisma's own query engine) but noisy without it.
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
# `postinstall` runs `prisma generate`, which needs the schema — and Prisma 7
# moved the datasource URL into prisma.config.ts, which the CLI also loads.
# Manifests-only would cache better, but `pnpm install` fails without these.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml* prisma.config.ts ./
COPY prisma ./prisma
RUN pnpm install --frozen-lockfile

# ---- builder: compiles the production build ----------------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS builder
ARG PNPM_VERSION
RUN npm install -g pnpm@${PNPM_VERSION}
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# `src/generated/` is gitignored *and* dockerignored (build output, not
# source — postinstall's `prisma generate` regenerates it), so `COPY . .`
# above does not bring it in. Reuse the deps stage's copy rather than
# regenerating it a second time.
COPY --from=deps /app/src/generated ./src/generated

# Dummy values so `next build`'s boot-time env validation (lib/env.ts) and
# static generation succeed at build time. Real values come from the
# container's actual environment at runtime — see docker-compose.yml /
# DOCKER.md. None of these are used once the container is running.
ENV DATABASE_URL=file:/tmp/build.db \
    STORAGE_ROOT=/tmp \
    ADMIN_PASSWORD_HASH="scrypt\$16384\$8\$1\$AAAAAAAAAAAAAAAAAAAAAA==\$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=" \
    AUTH_SECRET=build-time-placeholder-not-used-at-runtime-0000000000

RUN pnpm build

# ---- runner: the image that actually ships -----------------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS runner

# sqlite3 CLI is not required by the app itself (Prisma talks to SQLite via
# the native driver adapter), but it is what deploy/backup.sh needs if it is
# ever run inside this image (docker compose exec) rather than only from the
# systemd-based deployment. openssl is for the same reason as the deps
# stage's copy: entrypoint.sh's `prisma db push` runs here, at container
# start, not just at build time.
RUN apt-get update && apt-get install -y --no-install-recommends sqlite3 openssl \
    && rm -rf /var/lib/apt/lists/*

RUN groupadd --system labsy && useradd --system --gid labsy --home-dir /app --shell /usr/sbin/nologin labsy

WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/next.config.ts ./next.config.ts
COPY --from=builder /app/prisma.config.ts ./prisma.config.ts
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/src/generated ./src/generated
COPY deploy/docker/entrypoint.sh /usr/local/bin/entrypoint.sh
COPY deploy/docker/gen-hash.cjs /app/deploy/docker/gen-hash.cjs
COPY deploy/backup.sh /app/deploy/backup.sh
RUN chmod +x /usr/local/bin/entrypoint.sh /app/deploy/backup.sh

# Sensible container-native defaults. ADMIN_PASSWORD_HASH and AUTH_SECRET have
# no default on purpose — lib/env.ts refuses to boot without them, which is
# the point (CONTEXT §3's "fail loudly at start"). COOKIE_SECURE defaults true
# because NODE_ENV=production; set it false only if this container is not
# behind TLS anywhere (see DOCKER.md).
ENV NODE_ENV=production \
    STORAGE_ROOT=/srv/downloads \
    DATABASE_URL=file:/data/db.sqlite \
    UPLOAD_SUBDIR=uploads \
    CHUNK_SIZE=16777216 \
    UPLOAD_TTL_HOURS=24 \
    SESSION_TTL_HOURS=8 \
    COOKIE_SECURE=true \
    USE_X_ACCEL=false

RUN mkdir -p /srv/downloads/.uploads /data \
    && chown -R labsy:labsy /srv/downloads /data /app

VOLUME ["/srv/downloads", "/data"]
EXPOSE 3000
USER labsy

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
# The executable directly, not `node <this>`: pnpm installs `.bin/next` as a
# POSIX shell shim, not a JS file — found the hard way deploying the systemd
# unit (deploy/labsy-hub.service's own comment tells the same story).
CMD ["node_modules/.bin/next", "start", "-p", "3000", "-H", "0.0.0.0"]
