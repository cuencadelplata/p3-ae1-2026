# ── Etapa 1: build ──────────────────────────────────────────────────────────
# Debian (no Alpine): Prisma necesita OpenSSL.
FROM node:22-bookworm-slim AS builder
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
COPY prisma ./prisma
RUN npm ci

# Compilar TypeScript → dist/ (incluye prisma generate)
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# ── Etapa 2: runtime ─────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS runtime
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*

# Solo dependencias de producción (prisma CLI se conserva para `migrate deploy`)
COPY package*.json ./
COPY prisma ./prisma
RUN npm ci --omit=dev && npm install --no-save prisma@5 && npx prisma generate

COPY --from=builder /app/dist ./dist
# docs/openapi.json: contrato de RF-2.2 / RF-2.4 que se une al de M2 en /openapi.json
COPY docs/openapi.json ./docs/openapi.json
RUN mkdir -p /tmp/m8-notifications && chown node:node /tmp/m8-notifications
USER node

EXPOSE 3000
CMD ["node", "dist/server.js"]
