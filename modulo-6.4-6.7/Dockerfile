FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
COPY service-server.ts ./
RUN npx tsc --project tsconfig.json && npx tsc service-server.ts --lib es2022 --module NodeNext --moduleResolution NodeNext --outDir dist
EXPOSE 3000
CMD ["node", "dist/service-server.js"]
