# Self-host image (PRD US-022): one Node process serves the API and the built
# SPA from the same commit that runs on Vercel. The server TypeScript is
# compiled to JS with tsc in the build stage (tsconfig.docker.json) so the final
# image carries zero dev dependencies and no tsx runtime — only the compiled
# output plus the production dependency tree.

FROM node:24-bookworm AS builder
WORKDIR /build
ENV CI=true
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN corepack enable && corepack prepare --activate
RUN pnpm install --frozen-lockfile
COPY . .
# Server TS -> dist/server, SPA -> dist/web (both under the gitignored dist/).
# The final `touch` stamps the bundle as the newest artifact: the dist-freshness
# guard compares dist/web against the (compiled) contract/client sources by
# mtime and COPY preserves builder mtimes, so in a sealed per-commit image (where
# the bundle is always current) this keeps a false STALE BUNDLE warning off boot.
RUN pnpm exec tsc -p tsconfig.docker.json \
  && pnpm run build:web \
  && find dist/web -exec touch {} +

# Production dependency tree only — the honest --prod install. pnpm's strict
# layout exposes only DECLARED dependencies, so @opentelemetry/sdk-trace-base
# is a production dependency in its own right: under npm it resolved here only
# because hoisting flattened it out of @opentelemetry/sdk-trace-node.
FROM node:24-bookworm AS prod-deps
WORKDIR /build
ENV CI=true
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN corepack enable && corepack prepare --activate
RUN pnpm install --frozen-lockfile --prod

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production \
    PORT=47100 \
    WEB_DIST_DIR=dist/web
WORKDIR /app

# Compiled JS mirrors the source layout so the package.json "imports" map
# (#core/* -> ./core/*, #adapters/* -> ./adapters/*) and version.ts's
# ../../../package.json read both resolve exactly as they do from source.
COPY --from=prod-deps /build/node_modules ./node_modules
COPY --from=builder /build/dist/server/ ./
COPY --from=builder /build/dist/web ./dist/web
COPY --from=builder /build/drizzle ./drizzle
COPY package.json ./package.json
COPY docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh && chown -R node:node /app

USER node
EXPOSE 47100

HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||47100)+'/api/health/live').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["./docker-entrypoint.sh"]
