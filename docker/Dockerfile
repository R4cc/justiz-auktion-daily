FROM node:22-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

COPY server.mjs ./
COPY src ./src
COPY seed ./seed
COPY dist ./dist
RUN mkdir /data-seed

FROM gcr.io/distroless/nodejs22-debian12:nonroot

ARG JG_BUILD_ID=local
ARG JG_VERSION=0.0.0

LABEL org.opencontainers.image.title="JUSTIZGUESSR" \
      org.opencontainers.image.description="Daily Justiz-Auktion price guessing game" \
      org.opencontainers.image.version="${JG_VERSION}" \
      org.opencontainers.image.revision="${JG_BUILD_ID}"

ENV NODE_ENV=production \
    NODE_OPTIONS="--disable-proto=throw --max-old-space-size=192" \
    PORT=3000 \
    DATA_DIR=/data \
    DISCOVERY_INTERVAL_HOURS=6 \
    COLLECT_MAX_PAGES=250 \
    FETCH_MIN_INTERVAL_MS=250 \
    FETCH_INITIAL_INTERVAL_MS=750 \
    FETCH_MAX_INTERVAL_MS=120000 \
    FETCH_IDLE_POLL_MS=30000

WORKDIR /app

COPY --from=build --chown=65532:65532 /app/server.mjs /app/server.mjs
COPY --from=build --chown=65532:65532 /app/src /app/src
COPY --from=build --chown=65532:65532 /app/seed /app/seed
COPY --from=build --chown=65532:65532 /app/dist /app/dist
COPY --from=build --chown=65532:65532 /data-seed /data

USER 65532:65532

VOLUME ["/data"]

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["/nodejs/bin/node", "-e", "fetch('http://127.0.0.1:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

ENTRYPOINT ["/nodejs/bin/node"]

CMD ["server.mjs"]