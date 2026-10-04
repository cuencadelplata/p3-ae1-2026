FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npx tsc --project tsconfig.json
EXPOSE 3001
CMD ["node", "dist/src/m6-rf6.5-rf6.6/service-server.js"]
