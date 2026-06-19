# Hackathon simulation image for the EHL app (see docs/SIM.md).
#
# Testers only need Docker — no local Node/pnpm required:
#   docker compose --env-file .env.sim up --build
#
# NEXT_PUBLIC_* values are passed as build args (baked into the browser bundle
# at build time). Server-side vars are injected at runtime via env_file.
# The heap is capped at 2 GiB so the build doesn't OOM on low-memory Docker VMs.

FROM node:22-slim AS deps
WORKDIR /app
RUN npm install -g pnpm@11.3.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

FROM node:22-slim AS builder
WORKDIR /app
RUN npm install -g pnpm@11.3.0
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_SITE_URL
ARG NEXT_PUBLIC_TURNSTILE_SITE_KEY
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL
ENV NEXT_PUBLIC_TURNSTILE_SITE_KEY=$NEXT_PUBLIC_TURNSTILE_SITE_KEY
# Call next build directly — bypasses the package.json script which hardcodes
# --max-old-space-size=4096. DOCKER_BUILD=true skips the tsc and ESLint workers
# (too large for 3.84 GiB Docker VMs alongside the compiler). No --turbopack:
# Turbopack's Rust allocator ignores NODE_OPTIONS and OOMs the VM.
RUN DOCKER_BUILD=true NODE_OPTIONS='--max-old-space-size=2048' pnpm exec next build

FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3001 \
    HOSTNAME=0.0.0.0
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
EXPOSE 3001
CMD ["node", "server.js"]
