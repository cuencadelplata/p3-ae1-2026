# syntax=docker/dockerfile:1
FROM node:22-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
COPY tests ./tests
COPY scripts ./scripts
RUN npm run build

RUN mkdir -p /app/storage/receipts/metadata /app/storage/receipts/pdf \
    && chown -R node:node /app/storage

VOLUME ["/app/storage"]

USER node

ENV NODE_ENV=production \
    PORT=3008 \
    STORAGE_DIR=/app/storage/receipts

EXPOSE 3008

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3008)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/index.js"]
