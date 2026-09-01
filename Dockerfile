FROM node:24-bookworm-slim AS compilacion

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
COPY test ./test
COPY scripts ./scripts

RUN npm run build


FROM compilacion AS pruebas

CMD ["npm", "test"]


FROM node:24-bookworm-slim AS ejecucion

WORKDIR /app

ENV NODE_ENV=production
ENV DB_PATH=/app/data/customer.sqlite

COPY package*.json ./

RUN npm ci --omit=dev && npm cache clean --force

COPY --from=compilacion /app/dist ./dist

RUN mkdir -p /app/data && chown node:node /app/data

USER node

EXPOSE 3000

CMD ["node", "dist/src/server.js"]