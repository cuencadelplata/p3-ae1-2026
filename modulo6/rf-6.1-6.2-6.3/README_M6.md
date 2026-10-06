# RF-6.1/6.2/6.3: Solicitud y ciclo del viaje

Este grupo contiene la API central de Viajes, persistencia, asignación de conductor, arribo con QR y el inicio del viaje. Comparte la base TripDB, Redis y RabbitMQ del stack integrado.

Los comandos se ejecutan desde `modulo6`. La instalación, los comandos por RF y los puertos del stack están en [README.md](../README.md).

## Flujo principal

Solicitar un viaje:

```sh
curl -X POST http://localhost:3000/api/viajes \
  -H 'content-type: application/json' \
  -d '{"clienteId":"cliente-123","origen":"Calle A","destino":"Calle B"}'
```

Asignar el conductor usando el ID devuelto:

```sh
curl -X POST http://localhost:3000/api/viajes/<viajeId>/asignar \
  -H 'content-type: application/json' \
  -d '{"conductorId":"conductor-001"}'
```

Registrar el arribo genera el QR de verificación:

```sh
curl -X PUT http://localhost:3000/api/viajes/<viajeId>/arribo
```

La respuesta contiene `qr.token`, `qr.qrDataUrl` y `qr.expiresAt`. Si M8 no responde y el viaje ya quedó `ARRIBADO`, repetir `PUT /arribo` reintenta obtener el QR sin repetir la validación con M3 ni publicar de nuevo `viaje.arribado`.

Iniciar el viaje con el token recibido:

```sh
curl -X POST http://localhost:3000/api/viajes/<viajeId>/iniciar \
  -H 'content-type: application/json' \
  -d '{"codigoVerificacion":"<tokenQR>"}'
```

## Especificación y pruebas

- OpenAPI: [openapi.yaml](openapi.yaml)
- Unitarias: `npm run test:rf-6.1-6.2-6.3`
- E2E Docker: `npm run test:e2e:rf-6.1-6.2-6.3`