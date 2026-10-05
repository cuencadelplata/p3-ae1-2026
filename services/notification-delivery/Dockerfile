FROM node:24-slim AS runtime

WORKDIR /app

COPY package.json ./
COPY src ./src

ENV NODE_ENV=production \
    PORT=3107

EXPOSE 3107

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3107)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

USER node

CMD ["node", "--experimental-strip-types", "src/http/server.ts"]
