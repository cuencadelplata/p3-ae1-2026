# Stage 1: Build
FROM node:20-alpine AS builder

WORKDIR /app

# Copiar package files
COPY package*.json ./
COPY tsconfig.json ./

# Instalar dependencias
RUN npm ci

# Copiar código fuente
COPY src ./src

# Stage 2: Runtime
FROM node:20-alpine

WORKDIR /app

# Copiar dependencies del builder
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./

# Copiar código
COPY src ./src

# Expose puerto
EXPOSE 3000

# Comando por defecto
CMD ["npm", "run", "dev"]
