FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run db:generate
CMD ["sh", "-c", "npm run db:migrate:deploy && npm run test:infrastructure:only"]
