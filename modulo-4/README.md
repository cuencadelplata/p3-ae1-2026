# M4 - Ubicacion y Disponibilidad

Microservicio REST de AE1 implementado con Node.js, TypeScript y Express. Mantiene ubicaciones en memoria para evitar agregar infraestructura innecesaria en esta etapa. Redis queda previsto para AE2, cuando pasa a ser obligatorio.

## Requisitos cubiertos

- RF-4.1: actualizacion de ubicacion con marca temporal.
- RF-4.2: busqueda por cercania, disponibilidad y tipo AUTO/MOTO.
- RF-4.3: vencimiento automatico mediante TTL.
- RF-4.4: geocodificador simulado para direcciones de demostracion.
- RF-4.5: distancia Haversine y ETA urbana aproximada.

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

## Ejemplo rapido

```bash
curl -X PUT http://localhost:3004/api/v1/drivers/driver-1/location \
  -H "Content-Type: application/json" \
  -d '{"latitude":-27.4692,"longitude":-58.8306,"vehicleType":"AUTO","available":true}'

curl "http://localhost:3004/api/v1/drivers/nearby?latitude=-27.4693&longitude=-58.8307&vehicleType=AUTO&radiusKm=5"
```

La especificacion completa esta en `openapi/openapi-m4.yaml`.
