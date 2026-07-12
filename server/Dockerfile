# ============================================================================
# GHGFlix Server — now ships the REAL desktop UI (the same React app as the
# Windows app), built for the browser. Multi-stage: build the frontend from
# the repo root, then copy it next to the zero-dependency Node server.
# Build context = repo ROOT:  docker build -f server/Dockerfile .
# ============================================================================

# ── Stage 1: build the web app (desktop UI → browser bundle) ──
FROM node:24-alpine AS webbuild
WORKDIR /build
COPY package.json package-lock.json ./
# tauri-cli/sharp are desktop-only devDependencies — drop them so the image
# build stays small and works on every architecture
RUN npm pkg delete "devDependencies.@tauri-apps/cli" "devDependencies.sharp" \
 && npm install --no-audit --no-fund
COPY index.html tsconfig.json tsconfig.node.json vite.config.ts ./
COPY public ./public
COPY src ./src
RUN npx vite build --base ./ --outDir /out/webapp --emptyOutDir

# ── Stage 2: the server (zero npm dependencies: copy + run) ──
FROM node:24-alpine

RUN apk add --no-cache ffmpeg tini

WORKDIR /app
COPY server/package.json ./
COPY server/src ./src
COPY server/web ./web
COPY --from=webbuild /out/webapp ./webapp

ENV NODE_ENV=production \
    PORT=8484 \
    DATA_DIR=/data

VOLUME ["/data"]
EXPOSE 8484

HEALTHCHECK --interval=60s --timeout=5s --start-period=20s \
  CMD wget -qO- http://127.0.0.1:8484/api/ping || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "src/index.js"]
