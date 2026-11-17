FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
# Front de RF-6.4/6.7, servido por la fachada.
COPY --from=build /app/frontend-rf-6.4-6.7 ./frontend-rf-6.4-6.7
EXPOSE 3000
CMD ["node", "dist/src/rf-6.1-6.2-6.3/index.js"]