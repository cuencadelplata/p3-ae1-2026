FROM node:22-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm install

COPY tsconfig.json ./
COPY prisma ./prisma
COPY src ./src
RUN npx prisma generate --schema=./prisma/schema.prisma
RUN npm run build
RUN npm prune --omit=dev && npm cache clean --force

FROM node:22-alpine AS production

WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY public ./public

EXPOSE 3000
USER node

CMD ["node", "dist/server.js"]
