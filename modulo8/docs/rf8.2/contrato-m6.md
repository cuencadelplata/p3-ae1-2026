# Contrato QR entre M6 y M8

M6 solicita el QR al registrar el arribo y lo valida antes de decidir si el
viaje pasa a `EN_CURSO`. M8 sólo genera, valida y consume el QR; no cambia el
estado del viaje. La especificación completa de cuerpos y errores es el
[OpenAPI de QR](../../openapi/qr.openapi.yaml).

En el Compose común, M6 llamará a `http://m8-app:3000`. El nombre del servicio
debe confirmarse al armar ese Compose. En el Compose local de M8, la API se
consulta en `http://localhost:8000`.

| Operación | Pedido de M6 | Respuesta exitosa de M8 |
| --- | --- | --- |
| `POST /qr` | `{ "tripId": "..." }` | `201` con `{ token, qrDataUrl, expiresAt }` |
| `POST /qr/validate` | `{ "tripId": "...", "token": "..." }` | `200` con `{ "valid": true }` |

Ambas rutas requieren `x-api-key`: M8 lee `QR_INTERNAL_API_KEY` y M6 debe usar
el mismo valor en `M8_QR_API_KEY`, compartido fuera de Git. Para validar, M6
envía un UUID en `Idempotency-Key` y **conserva la misma clave al reintentar la
misma operación**. Si M8 consumió el QR pero se perdió la respuesta, ese
reintento devuelve el resultado anterior. Otra operación sobre el QR ya usado
recibe `409`.

M6 debe distinguir `404` (QR inexistente), `409` (usado o conflicto de
idempotencia), `410` (vencido) y `503` (Redis no disponible). Un `503` no
autoriza iniciar el viaje. Los `400`, `401` y `415` indican un pedido o una
configuración que debe corregirse; no se resuelven regenerando QR.

La prueba conjunta con M6 real se hará en la rama común. Debe cubrir QR válido,
vencido, reutilizado, respuesta perdida, validaciones simultáneas y Redis caído.
