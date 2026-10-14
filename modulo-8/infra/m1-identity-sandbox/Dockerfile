FROM node:22-alpine

WORKDIR /app
COPY server.mjs ./

USER node

ENV PORT=4011
EXPOSE 4011

CMD ["node", "server.mjs"]
