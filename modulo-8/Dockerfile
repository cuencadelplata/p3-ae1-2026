FROM node:24-slim AS build

WORKDIR /workspace

RUN corepack enable && corepack prepare pnpm@10.33.0 --activate

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY services/notifications/package.json services/notifications/package.json
COPY services/qr/package.json services/qr/package.json
COPY services/receipts/package.json services/receipts/package.json
COPY services/support/package.json services/support/package.json
COPY services/shared/package.json services/shared/package.json
COPY services/notification-delivery/package.json services/notification-delivery/package.json

RUN pnpm install --frozen-lockfile

COPY tsconfig.json ./
COPY src ./src
COPY openapi ./openapi
COPY services ./services

RUN pnpm run build
RUN pnpm --filter @m8/workspace deploy --prod --legacy /opt/m8

FROM node:24-slim AS runtime

WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000

COPY --from=build --chown=node:node /opt/m8 ./

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

USER node

CMD ["node", "dist/server.js"]
