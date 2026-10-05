# Nota de contrato: QR de verificación (M8) para M6

**Para:** responsables del cliente QR de M6 en `origin/M6-Viajes`. **De:** M8, RF-8.2.
Describe lo que M8 hace hoy. El contrato completo es
[`openapi/qr.openapi.yaml`](../../../openapi/qr.openapi.yaml) (2.0.0). Los puntos marcados como
sugerencia son una propuesta, a acordar con M6.

## Qué hace M8

- `POST /qr` con `{ "tripId": "..." }` responde 201 con `{ token, qrDataUrl, expiresAt }`. El QR
  codifica sólo el token.
- `POST /qr/validate` con `{ "tripId": "...", "token": "..." }` responde 200 `{ "valid": true }`
  y consume el QR. Los rechazos son códigos HTTP con cuerpo `{ "error": { code, message } }`:

| HTTP | `code` | Significado | Sugerencia para M6 |
| --- | --- | --- | --- |
| 404 | `QR_NOT_FOUND` | Token inexistente, de otro viaje, o vencido hace más del margen | No iniciar |
| 409 | `QR_ALREADY_USED` | El QR ya se consumió | No iniciar (ver ambigüedad) |
| 410 | `QR_EXPIRED` | El QR venció | No iniciar; pedir un QR nuevo |
| 400 / 415 | `VALIDATION_ERROR` / `UNSUPPORTED_MEDIA_TYPE` | Solicitud mal formada | Corregir el cliente |
| 503 | `QR_STORE_UNAVAILABLE` | M8 no pudo confirmar el resultado; incluye `Retry-After` | Reintentar después de `Retry-After` |

- **Ambigüedad:** si la conexión con el almacenamiento se corta después de consumir el QR, M8
  responde 503 y un reintento recibe 409. Un 409 posterior a un 503 puede corresponder a la propia
  validación.
- M8 no inicia ni modifica el viaje. En Compose, el servicio se publica en el puerto `3103`. No hay
  autenticación entre servicios: está pendiente en los acuerdos intermodulares.

## Discrepancias observadas en `origin/M6-Viajes` (commit `3690390`)

- `m6_viajes/src/services/qr.service.ts` espera `{ codigo }` en la respuesta de `POST /qr` y envía
  `{ tripId, codigo }` a `/qr/validate`. M8 devuelve y espera `token`. Con `codigo`, M8 responde
  400: `token` es requerido y `codigo` es una propiedad no permitida.
- El mismo archivo espera siempre `{ valido, motivo? }`. M8 responde `{ valid: true }` sólo en el
  éxito y usa 4xx para los rechazos.
- El cliente usa axios: cualquier respuesta que no sea 2xx lanza un error y el código la convierte
  en `M8_NO_DISPONIBLE`. Un QR vencido o ya usado se informaría como M8 caído. Lo usa
  `m6_viajes/src/controllers/viajes.controller.ts`.
- `M8_URL` tiene por defecto `http://localhost:4001`; el Compose de M8 publica el QR en `3103`.
- `m6_viajes/mock-m8/server.js` simula una versión anterior (`codigo`, `valido`, `motivo`, siempre
  200, código generado con `Math.random`) que no corresponde al contrato actual.
