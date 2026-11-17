# Demostración sugerida (10–15 minutos)

## Preparación

Ejecutar los pasos de README. Importar `openapi.json` en Postman, generar token y agregar Bearer. Para M4/M6/M8 usar `x-service-key` con `INTEGRATION_SECRET` del `.env`. No incluir tokens/claves/domicilios reales en capturas.

## Recorrido

1. Consultar `GET /health/ready`: database/redis/worker deben estar disponibles tras iniciar todo el stack.
2. Buscar `GET /api/v1/geocodificacion?q=Plaza` y usar sus coordenadas en POST `/api/v1/direcciones` con una clave de idempotencia nueva.
3. Guardar ID y ETag. Repetir el mismo POST con la misma clave: mismo ID, `Idempotency-Replayed: true`. Cambiar el cuerpo manteniendo clave: 409.
4. Consultar la lista dos veces: mostrar `X-Cache: MISS/HIT`. Para evidencia de expiración esperar más que el TTL (60 s por defecto) o configurar TTL=5 y recrear API/worker. La lista vuelve a MISS.
5. Editar con PATCH `{ "etiqueta": "Trabajo" }`, clave nueva e `If-Match` leído. Intentar otra edición con versión anterior: 412. Una edición válida cambia la revisión; el siguiente GET no sirve la lista anterior.
6. Enviar `docs/ejemplo-trip-completed.json` a `POST http://localhost:4000/demo/viajes/completados`. Consultar `GET /api/v1/direcciones?recientes=true`: aparecen dos puntos. Repetir evento y comprobar que `usos` no aumenta. Usar el mismo cliente del token, `cliente-123` en el ejemplo.
7. Consultar `GET http://localhost:4008/demo/notificaciones`: ver evento de favorita correlacionado. Esta bandeja es el efecto simulado, no un email real.
8. Mostrar RabbitMQ Management: exchange, las dos colas, retry/DLQ. Ejecutar `npm run test:stack` para el recorrido automático con IDs nuevos y mensaje inválido hacia DLQ.
9. Mostrar RF-2.4 heredado: POST `/api/v1/calificaciones` con `viajeId: "viaje-completado-1"`, puntuación 5. La repetición da 409. Para `viaje-en-curso-2` da 400. La identidad del token debe ser cliente-123.

## Fallo de Redis

```bash
docker compose stop redis
```

La API permanece operable, la lista pasa por PostgreSQL y health reporta degraded. Crear una dirección en ese estado. Luego:

```bash
docker compose start redis
```

La lista debe incluir la dirección nueva y nunca reutilizar una revisión antigua. Estas maniobras detienen únicamente los servicios de este Compose.

## Fallo de RabbitMQ

```bash
docker compose stop rabbitmq
```

Crear otra favorita. La escritura responde, `pendingEvents` aumenta y el heartbeat del worker expira. Luego:

```bash
docker compose start rabbitmq
```

Esperar reconexión, verificar que baja el outbox pendiente y M8 recibe la notificación. Reenviar un mismo evento no debe duplicar la bandeja. Conservar logs:

```bash
docker compose logs --since 10m api worker m6 m8
```

## Evidencia de concurrencia

`npm run test:integration` lanza 20 altas con la misma clave y 10 con claves distintas, y dos ediciones con la misma versión. Comprobar un único registro, un único evento por creación y conflicto controlado al editar. La versión actual también se verificó contra PostgreSQL 15 de Compose; ver PRUEBAS.md.

## Cierre

```bash
docker compose down
```

Conserva volúmenes. No usar `down -v` si se necesita mantener evidencia/datos.

## Sugerencia de regreso reutilizando M6

Con token de cliente-123, enviar POST `/api/v1/direcciones/desde-viaje` con `{ "viajeId": "viaje-completado-1" }`. El simulador devuelve origen y destino como texto. Consultar GET `/api/v1/direcciones/sugerencias`: propone Terminal como origen y Plaza como destino. No requiere calificar al conductor. Cambiar a token de otro cliente para comprobar aislamiento.

Después detener sólo el simulador M6 (`docker compose stop m6`): GET sugerencias sigue funcionando con datos locales; importar un viaje nuevo da 503. Volver a iniciarlo con `docker compose start m6`. Para el M6 de los compañeros usar INTEGRACION-M6.md; el contrato recibido no permite afirmar que esté probado ese servidor.
