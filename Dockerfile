# syntax=docker/dockerfile:1

# ---- Stage 1: install dependencies (incl. dev deps for the build) ----------
FROM node:22-alpine AS deps
WORKDIR /app
# libc6-compat keeps some native Node addons happy on Alpine.
RUN apk add --no-cache libc6-compat
# Enable pnpm via Corepack — pinned via packageManager in package.json.
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/web/package.json apps/web/package.json
RUN pnpm install --frozen-lockfile

# ---- Stage 2: build the Next.js standalone output --------------------------
FROM node:22-alpine AS builder
WORKDIR /app
RUN apk add --no-cache libc6-compat && corepack enable
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/web/node_modules ./apps/web/node_modules
COPY . .
# Telemetry off for reproducible CI builds. No secrets are needed at build time;
# OPENAI_API_KEY is supplied at runtime only.
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter @verric/web build

# ---- Stage 3: minimal runtime image ---------------------------------------
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# Run as a non-root user.
RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

# Copy the standalone server, static assets, and (if present) public files.
# Next 16 standalone output for a workspace lives at apps/web/.next/standalone
# and includes the workspace's own node_modules at the appropriate paths.
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static

USER nextjs
EXPOSE 3000

# server.js is produced by Next's standalone output and honors PORT/HOSTNAME.
CMD ["node", "apps/web/server.js"]
