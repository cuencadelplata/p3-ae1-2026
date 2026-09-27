FROM node:22-alpine AS build

WORKDIR /workspace

RUN corepack enable && corepack prepare pnpm@10.33.0 --activate

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY services/notifications/package.json services/notifications/package.json
COPY services/qr/package.json services/qr/package.json
COPY services/receipts/package.json services/receipts/package.json
COPY services/support/package.json services/support/package.json

RUN pnpm install --frozen-lockfile

COPY services/support/tsconfig.json services/support/tsconfig.json
COPY services/support/openapi.yaml services/support/openapi.yaml
COPY services/support/src services/support/src

RUN pnpm --filter m8-soporte run build
RUN pnpm --filter m8-soporte deploy --prod --legacy /opt/deploy

FROM node:22-alpine AS runtime

WORKDIR /app

COPY --from=build /opt/deploy ./
COPY --from=build /workspace/services/support/dist ./dist
COPY --from=build /workspace/services/support/openapi.yaml ./openapi.yaml

ENV NODE_ENV=production \
    PORT=3000

EXPOSE 3000

CMD ["node", "dist/index.js"]
