# Verificación v2.2.0

Fecha: 5 de octubre de 2026. La verificación actual reemplaza la limitación anterior de PGlite: fue posible ejecutar Docker con PostgreSQL, Redis y RabbitMQ reales. Los servidores M6/M4/M8 usados para probar son simuladores o fixtures HTTP locales; no el servidor de los compañeros.

| Verificación | Resultado |
|---|---|
| Prisma generate + TypeScript estricto | Aprobado |
| Tres migraciones versionadas | Aplicadas en PostgreSQL 15 |
| Unitarias | **10/10 aprobadas** |
| Integración HTTP + PostgreSQL/Redis reales | **22/22 aprobadas** |
| Dos recorridos RabbitMQ, deduplicación y DLQ | **1/1 prueba integral aprobada** |
| Red Docker sin salida pública | **2/2 pruebas aprobadas** |
| OpenAPI M2 e integraciones | Ambos validados con Swagger Parser |
| Compose normal, offline y conexión M6 real | Configuraciones válidas |
| Servidor M6 de los compañeros | No verificado; falta URL accesible y confirmar GET heredado |

## Qué se probó

Las pruebas incluyen 20 altas concurrentes con misma clave, 10 con claves distintas, edición simultánea con If-Match, aislamiento entre clientes, expiración e invalidación de caché, rollback de escritura y evento, retención, duplicados REST + eventos, regresión RF-2.4 y fallo HTTP de M6.

La ampliación RF-2.2 verifica origen/destino como texto, coordenadas opcionales, favoritos sin geocoding, listas para ambos extremos, regreso B → A sin calificar, orden de viajes, eliminación de sugerencias al borrar una dirección y continuidad de sugerencias cuando M6 se detiene. La prueba de regresión comprueba que RF-2.4 sigue calificando viajes completados y rechaza duplicados, viajes activos y lecturas ajenas.

## Evidencias

- [Unitarias](evidencias/unitarias.txt).
- [Integración sobre PostgreSQL](evidencias/integracion.txt).
- [Stack con RabbitMQ](evidencias/stack.txt).
- [Recorrido sin salida a Internet](evidencias/sin-internet.txt).

La red `ae2-rf22_default` se recreó con `Internal=true` y se arrancó sin construir ni descargar imágenes. La prueba comprobó que no podía abrir una conexión TCP a una IP pública, mientras funcionaban el token local, mapas locales, consulta REST a M6, consumo y publicación RabbitMQ. No se cortó el Wi-Fi del equipo; se aisló la red de los contenedores.

En integración, un caso simula la caída de Redis mediante un adaptador fallido; el resto usa Redis real. La DB es PostgreSQL nativo dentro de Docker. La caída HTTP de M6 se prueba cerrando el servidor fixture. La prueba completa de RabbitMQ utiliza los simuladores de M6 y M8, con intercambio AMQP real.

## Límites importantes

El texto de M6 aportado declara direcciones como strings, pero no define el GET que ya emplea el código de RF-2.4. Se reutilizó esa ruta y se probó su adaptador con una respuesta equivalente a ViajeResponse; eso no acredita disponibilidad ni compatibilidad del servidor de los compañeros. Los nombres de eventos de su RabbitMQ tampoco fueron proporcionados. Ver INTEGRACION-M6.md.

La primera instalación requiere imágenes disponibles. Con Docker e imágenes preparadas, el stack local funciona sin Internet. Un M6 inaccesible por un corte de LAN o alojado solamente en la nube no puede proporcionar viajes nuevos; se conservan las sugerencias ya guardadas.

## Reproducir

```bash
node scripts/setup.cjs
node scripts/offline.cjs prepare
docker compose up --no-build --pull never -d
npm ci
npm test
npm run test:integration
npm run test:stack
docker compose down
node scripts/offline.cjs start
node scripts/offline.cjs test
```

No ejecutar npm ci sin conexión; para las pruebas offline todas las dependencias ya están en la imagen. Los tests generan clientes/viajes de prueba con IDs únicos y no truncan tablas. Conservar .env y volúmenes de la carpeta existente. Para ejecutar una copia completamente independiente puede usarse otro COMPOSE_PROJECT_NAME; no mezclar credenciales recién generadas con un volumen PostgreSQL inicializado con otra contraseña.
