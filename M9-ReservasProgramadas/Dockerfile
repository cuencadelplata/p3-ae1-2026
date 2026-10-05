FROM node:22-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund --fetch-retries=5 --fetch-retry-mintimeout=20000 --fetch-retry-maxtimeout=120000

COPY tsconfig.json ./
COPY prisma ./prisma
COPY src ./src
RUN npx prisma generate --schema=./prisma/schema.prisma
RUN npm run build

FROM build AS migrate
CMD ["npx", "prisma", "migrate", "deploy", "--schema=./prisma/schema.prisma"]

FROM build AS production-dependencies
RUN npm prune --omit=dev && npm cache clean --force

FROM node:22-alpine AS production

WORKDIR /app
ENV NODE_ENV=production

COPY --from=production-dependencies /app/package.json /app/package-lock.json ./
COPY --from=production-dependencies /app/node_modules ./node_modules
COPY --from=production-dependencies /app/dist ./dist
COPY public ./public

EXPOSE 3000
USER node

CMD ["node", "dist/server.js"]
