FROM node:24-slim AS build

WORKDIR /workspace

RUN corepack enable && corepack prepare pnpm@10.33.0 --activate

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY services/notifications/package.json services/notifications/package.json
COPY services/qr/package.json services/qr/package.json
COPY services/receipts/package.json services/receipts/package.json
COPY services/support/package.json services/support/package.json

RUN pnpm install --frozen-lockfile

COPY services/qr/tsconfig.json services/qr/tsconfig.json
COPY services/qr/src services/qr/src

RUN pnpm --filter @m8/qr run build
RUN pnpm --filter @m8/qr deploy --prod --legacy /opt/deploy

FROM node:24-slim AS runtime

WORKDIR /app

COPY --from=build /opt/deploy ./
COPY --from=build /workspace/services/qr/dist ./dist

ENV NODE_ENV=production \
    PORT=3000

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

USER node

CMD ["node", "dist/server.js"]
