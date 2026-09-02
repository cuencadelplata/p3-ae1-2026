FROM node:22-alpine

WORKDIR /app

# Copiar configuración y manifiestos de dependencias
COPY package.json pnpm-lock.yaml ./

# Instalación de dependencias del proyecto
RUN npm install

# Copiar archivos de configuración, OpenAPI y código fuente
COPY tsconfig.json openapi.yaml ./
COPY src/ ./src/

# Exponer el puerto predeterminado del servicio
EXPOSE 3000

# Comando para ejecutar la aplicación
CMD ["npm", "run", "dev"]
