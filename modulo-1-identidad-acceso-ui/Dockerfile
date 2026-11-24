# Interfaz de M1 (React + Vite) servida por nginx.
#
# Etapa 1: compila la interfaz. Vite incrusta VITE_API_URL en el JavaScript al compilar,
# por eso se pasa como argumento de build y no como variable de entorno en ejecución.
# Es la URL con la que el NAVEGADOR llega a M1 (en el stack integrado: http://localhost:10000).
FROM node:24-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

ARG VITE_API_URL=http://localhost:10000
ENV VITE_API_URL=${VITE_API_URL}

RUN npm run build


# Etapa 2: solo los archivos estáticos compilados, servidos por nginx.
FROM nginx:1.27-alpine AS production

RUN rm /etc/nginx/conf.d/default.conf
COPY nginx.conf /etc/nginx/conf.d/m1-ui.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=10s --timeout=3s --retries=5 \
    CMD wget -q -O /dev/null http://127.0.0.1/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
