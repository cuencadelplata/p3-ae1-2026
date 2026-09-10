
1. Mostrar imágenes en Docker Hub / Local
- powershell
docker image ls matsir/m1-identidad-acceso

*Se verifica las etiquetas disponibles (ej. `latest`, `2`, `1.0.0`).*


2. Ejecutar la imagen publicada en Docker
- powershell
docker run --rm -d --name m1-demo-final -p 3001:3001 matsir/m1-identidad-acceso:v1
Start-Sleep -Seconds 3
docker ps --filter "name=m1-demo-final"

se espera: `0.0.0.0:3001->3001/tcp`


3. Verificar estado del servidor (Healthcheck)
- powershell
Invoke-WebRequest http://localhost:3001/health -UseBasicParsing

se espera:
StatusCode: `200` y  JSON:
{"status":"OK","modulo":"M1 - Identidad y Acceso"}


4. Documentación OpenAPI y Swagger
- Documentación Interactive Swagger UI: [http://localhost:3001/docs]

- Especificación OpenAPI (YAML): [http://localhost:3001/openapi.yaml]


5. Ejecutar las pruebas del Backend

entrar a la carpeta del backend:
cd modulo-1-identidad-acceso

npm test

npm run test:integration

- Correr tests e2e contra contenedor:
docker run --rm -d --name m1-demo-final -p 3001:3001 -e JWT_SECRET=clave-local-desarrollo-m1-cambiar-en-produccion matsir/m1-identidad-acceso:v1

npm run test:e2e
6. UI


cd modulo-1-identidad-acceso-ui
npm install
npm run dev

Abrir en navegador: [http://localhost:5173]


7. Detener el contenedor de demostración

-powershell
docker stop m1-demo-final

