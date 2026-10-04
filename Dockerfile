FROM node:22-bookworm-slim AS build
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app/apps/web
COPY apps/web/package.json apps/web/package-lock.json ./
RUN npm ci
COPY apps/web/ ./
RUN npm run build && rm -rf .next/cache

FROM node:22-bookworm-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
WORKDIR /app/apps/web
COPY apps/web/package.json apps/web/package-lock.json ./
RUN npm ci --omit=dev

FROM node:22-bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates gosu && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 \
    RUNTIME_ROOT=/app/runtime DATA_DIR=/app/runtime/feature_store \
    PROJECT_DB_PATH=/app/runtime/projects/projects.sqlite
WORKDIR /app
COPY --from=dependencies /app/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY scripts/lib/ ./scripts/lib/
COPY scripts/restore-runtime-data.mjs scripts/verify-deployment.mjs scripts/restore_runtime_data.sh scripts/start_railway.sh ./scripts/
WORKDIR /app/apps/web
COPY --from=dependencies /app/apps/web/node_modules ./node_modules
COPY --chown=node:node --from=build /app/apps/web/.next ./.next
COPY --from=build /app/apps/web/public ./public
COPY apps/web/package.json apps/web/next.config.mjs ./
WORKDIR /app
EXPOSE 3000
CMD ["sh", "/app/scripts/start_railway.sh"]
