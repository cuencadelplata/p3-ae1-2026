# syntax=docker/dockerfile:1

# ---------- Etapa de compilacion ----------
# Se usa la imagen basada en Debian porque el compilador de TypeScript 7
# distribuye binarios nativos enlazados contra glibc.
FROM node:22-slim AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build


# ---------- Etapa de ejecucion ----------
FROM node:22-alpine AS runtime

ENV NODE_ENV=production \
    PORT=3008 \
    STORAGE_DIR=/app/storage/receipts

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist
COPY --from=build /app/src/openapi ./src/openapi

RUN mkdir -p /app/storage/receipts/metadata /app/storage/receipts/pdf \
    && chown -R node:node /app/storage

# Los comprobantes emitidos sobreviven al ciclo de vida del contenedor.
VOLUME ["/app/storage"]

USER node

EXPOSE 3008

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3008)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/index.js"]
