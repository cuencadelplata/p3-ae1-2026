# Gestión de riesgos

## Dependencias externas

| Escenario | Política implementada | Estado resultante |
| --- | --- | --- |
| M7 no responde al crear | Degradación controlada; la reserva se crea sin tarifa | `PROGRAMADA`, `tarifaEstimada = null` |
| M5 no responde después del reclamo | Se registra el fallo y no se vuelve a `PROGRAMADA` automáticamente | `FALLIDA` |
| Supabase falla | La API devuelve `ERROR_PERSISTENCIA`; el scheduler reporta el error | Sin transición confirmada |
| Dos workers reclaman la misma fila | `UPDATE` condicional atómico | Un solo worker pasa a `ACTIVANDO` |

Marcar `FALLIDA` ante error de M5 evita despachos duplicados causados por reintentos ciegos. Un flujo de reintentos futuro necesita primero un contrato idempotente con M5, usando el `id` de reserva como clave estable.

## Ventana `ACTIVANDO`

Si el proceso termina después de reclamar y antes de confirmar M5 o marcar `FALLIDA`, la fila puede quedar en `ACTIVANDO`. Esto no produce una doble solicitud automática, pero requiere observabilidad y recuperación. El backlog propone un reconciliador con timeout e idempotencia; no se implementa una reversión insegura.

## Seguridad

- `SUPABASE_KEY` es un secreto de backend; `.env` está ignorado y `.env.example` solo contiene placeholders.
- RLS permanece habilitado. El scheduler requiere una clave server-only porque no representa a un usuario autenticado.
- El alcance actual excluye autenticación HTTP. En consecuencia, un consumidor puede enviar cualquier `clienteId`; el servicio no debe exponerse a Internet sin gateway, autenticación y autorización.
- Helmet, validación estricta y respuestas sin detalles internos reducen exposición, pero no reemplazan Auth, rate limiting ni control de red.

## Esquema y rendimiento

- La ausencia de índice `(estado, fecha_hora_programada)` puede degradar el scheduler cuando crezca la tabla; debe medirse antes de migrar.
- Las reglas origen/destino y fecha futura viven en la aplicación, no como `CHECK`; accesos directos a la base podrían saltarlas.
- Los warnings actuales de advisors y sus remediaciones están registrados en `SUPABASE_SCHEMA.md`.
