# -------------------------------------------------
# Stage 1: Build
# -------------------------------------------------
FROM node:20-alpine AS builder

WORKDIR /app

# Copiar manifiestos primero (aprovecha cache de capas)
COPY package*.json ./
RUN npm ci

# Copiar fuentes y compilar TypeScript
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# -------------------------------------------------
# Stage 2: Production
# -------------------------------------------------
FROM node:20-alpine AS production

WORKDIR /app

ENV NODE_ENV=production

# Solo dependencias de produccion
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copiar artefactos compilados + assets estaticos
COPY --from=builder /app/dist ./dist
COPY openapi/ ./openapi/
COPY public/  ./public/

EXPOSE 3005

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3005/health || exit 1

CMD ["node", "dist/index.js"]
