FROM node:22-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY tsconfig.json ./
COPY prisma ./prisma
COPY src ./src
RUN npm run db:generate
RUN npm run build
RUN npm prune --omit=dev --no-audit --no-fund && npm cache clean --force

FROM node:22-alpine AS production

WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY public ./public

EXPOSE 3000
USER node

CMD ["sh", "-c", "./node_modules/.bin/prisma migrate deploy && node dist/server.js"]
