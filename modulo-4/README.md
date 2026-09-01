# M4 - Ubicacion y Disponibilidad

Microservicio REST de AE1 implementado con Node.js, TypeScript y Express. Mantiene ubicaciones en memoria para evitar agregar infraestructura innecesaria en esta etapa. Redis queda previsto para AE2, cuando pasa a ser obligatorio.

Version actual: `1.1.0`.

## Requisitos cubiertos

- RF-4.1: actualizacion de ubicacion con marca temporal.
- RF-4.2: busqueda por cercania, disponibilidad y tipo AUTO/MOTO.
- RF-4.3: vencimiento automatico mediante TTL.
- RF-4.4: geocodificador simulado para direcciones de demostracion.
- RF-4.5: distancia Haversine y ETA urbana aproximada.
- RF-4.6: eliminacion explicita de ubicacion (`DELETE`) para cierre de sesion del conductor.

## Ejecutar

```bash
npm install
npm run dev
```

El servicio queda disponible en `http://localhost:3004` y el health check en `GET /health`.

Para compilar y probar:

```bash
npm run build
npm test
```

El TTL predeterminado es de 60 segundos y se puede cambiar con `LOCATION_TTL_SECONDS`.

## Docker

Construir y ejecutar directamente:

```bash
docker build -t p3-m4-ubicacion .
docker run --rm -p 3004:3004 p3-m4-ubicacion
```

También se puede iniciar con Compose:

```bash
docker compose up --build
```

La imagen incluye un healthcheck que consulta `GET /health`. La versión publicada se encuentra en `segocodee/p3-m4-ubicacion`.

## Ejemplo rapido

```bash
curl -X PUT http://localhost:3004/api/v1/drivers/driver-1/location \
  -H "Content-Type: application/json" \
  -d '{"latitude":-27.4692,"longitude":-58.8306,"vehicleType":"AUTO","available":true}'

curl "http://localhost:3004/api/v1/drivers/nearby?latitude=-27.4693&longitude=-58.8307&vehicleType=AUTO&radiusKm=5"

curl -X DELETE http://localhost:3004/api/v1/drivers/driver-1/location
```

La busqueda acepta `maxCandidates` (nombre usado por M5) y conserva `limit` como alias compatible.

La especificacion completa esta en `openapi/openapi-m4.yaml`.
