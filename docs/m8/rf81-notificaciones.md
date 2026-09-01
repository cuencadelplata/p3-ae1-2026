# RF-8.1 - Notificaciones de viaje

## Objetivo

Procesar notificaciones asociadas a los principales acontecimientos de un viaje. M8 recibe el acontecimiento ya ocurrido; no decide ni modifica el estado del viaje.

Responsable: Juan Martin Invaldi (Grupo 6). Branch: `feature/m8-r81-notifications-grupo6`.

## Endpoint

`POST /notifications`

Procesa una notificación de viaje para el destinatario indicado. No existe `GET /notifications` en AE1: RF-8.1 no implementa bandeja, historial ni consulta de notificaciones.

## Eventos soportados

- `TRIP_REQUESTED`
- `DRIVER_ASSIGNED`
- `DRIVER_ARRIVED`
- `TRIP_STARTED`
- `TRIP_CANCELLED`
- `TRIP_COMPLETED`

## Canal actual

El único canal admitido en AE1 es `PUSH`.

M8 procesa realmente el evento, valida los datos, genera el mensaje, asigna identificador y fecha, e invoca el proveedor del canal. Durante AE1 ese proveedor es `MockPushProvider`; no existe integración real con Firebase ni con otro proveedor externo. Por ello, `PROCESSED` no confirma la entrega real en un dispositivo.

## Request

El cuerpo debe enviarse como `application/json` e incluye:

- `tripId`: identificador del viaje.
- `recipientId`: identificador del destinatario.
- `eventType`: uno de los seis eventos soportados.
- `channels`: arreglo no vacío y sin duplicados; actualmente solo admite `PUSH`.

`message` no se recibe desde el cliente. M8 lo genera de forma determinística a partir de `eventType`.

```json
{
  "tripId": "trip-001",
  "recipientId": "user-001",
  "eventType": "DRIVER_ASSIGNED",
  "channels": ["PUSH"]
}
```

## Response 201

Cuando el proveedor PUSH completa correctamente su procesamiento, el servicio responde `201 Created` con:

- `notificationId`
- `tripId`
- `recipientId`
- `eventType`
- `channels`
- `message`
- `status`
- `createdAt`

El único estado actual es `PROCESSED`: M8 validó el evento, generó la notificación y procesó correctamente el canal configurado. En AE1 el canal usa un mock, por lo que no acredita una entrega real al dispositivo.

## Errores

Las respuestas de error utilizan el formato uniforme `error.code`, `error.message` y, cuando corresponde, `error.details`.

| HTTP | Código | Situación |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` | El JSON es inválido o no respeta el esquema del request. |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | El `Content-Type` no es `application/json`. |
| 500 | `NOTIFICATION_PROCESSING_ERROR` | No fue posible completar el procesamiento de la notificación. |

## UI

`GET /` sirve una interfaz para ejecutar visualmente RF-8.1 contra el backend real. Está construida con HTML, CSS y JavaScript vanilla; permite seleccionar el evento, enviar la solicitud y mostrar estados de carga, éxito y error.

## OpenAPI

La fuente única del contrato es [`docs/api/openapi.yaml`](../api/openapi.yaml). El mismo archivo se expone por HTTP en `GET /openapi.yaml`.

No existe un contrato duplicado para la UI ni para la API.

## Persistencia

RF-8.1 en AE1 no persiste notificaciones. No hay base de datos, historial ni almacenamiento permanente.

## Fuera del alcance actual

- RabbitMQ y Redis.
- Email y SMS.
- Firebase real u otro proveedor PUSH real.
- Autenticación.
- Persistencia de notificaciones.
- Integraciones reales con otros módulos.

RF-8.2 y sus funcionalidades no forman parte de este documento.
