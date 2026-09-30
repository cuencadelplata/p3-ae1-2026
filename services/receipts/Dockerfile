# syntax=docker/dockerfile:1
FROM node:22-slim AS build

WORKDIR /workspace

RUN corepack enable && corepack prepare pnpm@10.33.0 --activate

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY services/notifications/package.json services/notifications/package.json
COPY services/qr/package.json services/qr/package.json
COPY services/receipts/package.json services/receipts/package.json
COPY services/support/package.json services/support/package.json
COPY openapi/receipts.openapi.yaml openapi/receipts.openapi.yaml

RUN pnpm install --frozen-lockfile

COPY services/receipts/tsconfig.json services/receipts/tsconfig.json
COPY services/receipts/src services/receipts/src
COPY services/receipts/tests services/receipts/tests
COPY services/receipts/scripts services/receipts/scripts

RUN pnpm --filter m8-documentos run build
RUN pnpm --filter m8-documentos deploy --prod --legacy /opt/deploy

FROM node:22-slim AS runtime

WORKDIR /app

COPY --from=build /opt/deploy ./
COPY --from=build /workspace/services/receipts/dist ./dist
COPY --from=build /workspace/openapi/receipts.openapi.yaml ./openapi/receipts.openapi.yaml

USER node

ENV NODE_ENV=production \
    PORT=3008

EXPOSE 3008

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3008)+'/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/index.js"]
