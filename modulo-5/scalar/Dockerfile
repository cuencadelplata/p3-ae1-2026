FROM nginx:alpine

# Copiar configuración personalizada de Nginx
COPY scalar/nginx.conf /etc/nginx/conf.d/default.conf

# Copiar el HTML de Scalar y la especificación OpenAPI
COPY scalar/index.html /usr/share/nginx/html/index.html
COPY openapi/ /usr/share/nginx/html/openapi/

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
