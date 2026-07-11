# GHGFlix Server — zero npm dependencies, so the build is just: copy + run.
FROM node:24-alpine

RUN apk add --no-cache ffmpeg tini

WORKDIR /app
COPY package.json ./
COPY src ./src
COPY web ./web

ENV NODE_ENV=production \
    PORT=8484 \
    DATA_DIR=/data \
    SHOWS_DIRS=/media/shows \
    MOVIES_DIRS=/media/movies

VOLUME ["/data"]
EXPOSE 8484

HEALTHCHECK --interval=60s --timeout=5s --start-period=20s \
  CMD wget -qO- http://127.0.0.1:8484/api/ping || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "src/index.js"]
