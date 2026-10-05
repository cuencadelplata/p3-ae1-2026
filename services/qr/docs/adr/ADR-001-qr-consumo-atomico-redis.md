# ADR-001: Consumo atómico del QR en Redis

**Estado:** aceptada (AE2, 2026-10-04). **Ámbito:** RF-8.2, servicio QR de M8.

## Contexto

En AE1 los QR vivían en un `Map` del proceso. Con más de una instancia el estado no se comparte:
un QR generado en una instancia no existe en otra. El uso único dependía de que la comprobación y
la marca ocurrieran en el mismo turno del event loop. AE2 exige Redis y uso único aun con
validaciones simultáneas en distintas instancias.

## Decisión

Una clave hash por QR, `m8:qr:<sha256 del token>`, y dos scripts Lua:

- **Guardado:** `DEL`, `HSET` y `PEXPIRE` en el mismo script.
- **Consumo:** comprueba existencia, viaje, uso y vencimiento con `TIME` de Redis, y marca `usedAt`.

Redis ejecuta cada script de forma atómica: bloquea cualquier otra actividad del servidor mientras
corre. node-redis invoca los scripts con `EVALSHA` y reintenta con `EVAL` ante `NOSCRIPT`. Usar
`TIME` en un script que escribe está permitido con la replicación por efectos (por defecto desde
Redis 5.0, único modo desde 7.0).

| Alternativa | Evaluación |
| --- | --- |
| Leer y después escribir (`HMGET` y `HSET`) | Entre los dos comandos se intercalan otras validaciones. Demostrado en las pruebas: 10 de 10 validaciones simultáneas aprobadas. |
| `WATCH` + `MULTI`/`EXEC` | Correcta: `EXEC` se aborta si la clave cambió. Pero cada aborto obliga al cliente a reintentar la lectura y la transacción, y necesita varias idas y vueltas por validación. |
| Lock con `SET NX` y TTL | Agrega una segunda clave con su vencimiento y su liberación, y nuevos casos de falla (lock vencido o no liberado), para proteger una sola escritura. |
| `GETDEL` (Redis 6.2) o `HGETDEL` (Redis 8.0) | Consumen borrando, de forma atómica, pero después del consumo la clave no existe: no se puede distinguir 409 ni 410 de 404. `GETDEL` sólo opera sobre strings. `HGETDEL` requiere Redis 8.0 y Compose usa Redis 7 (7.4.11). |
| **Script Lua (elegida)** | Una sola ida y vuelta, sin reintentos, con el mismo orden de decisión que AE1 y un resultado discriminado. Costo: parte de la lógica queda escrita en Lua, dentro del servicio. |

## Vencimiento: TTL exacto o con margen

Con un TTL igual al vencimiento, Redis borra la clave al vencer y un QR vencido no se distingue de
uno inexistente. Por eso la clave se conserva `QR_EXPIRED_GRACE_SECONDS` más (3600 por defecto):
durante ese margen la validación responde 410, y después 404. El vencimiento se decide con la
hora de Redis, pero `expiresAt` lo calcula Node: un desfase entre ambos relojes desplaza el
vencimiento en la misma medida.

## Otro viaje: 404

Un QR presentado con otro `tripId` responde 404, igual que un token inexistente, para no revelar
que el token existe. No lo consume. El motivo `TRIP_MISMATCH` sólo se registra en los logs, en
nivel warn.

## Fail-closed

Sin Redis no se emite ni se aprueba ningún QR: la respuesta es 503 `QR_STORE_UNAVAILABLE` con
`Retry-After: 5`. Fail-open, es decir aprobar sin poder consumir, permitiría usar dos veces el
mismo QR.

## Hallazgo: timeout de node-redis y ambigüedad 503 → 409

Los mensajes de los commits f6a0e77 y 4f7f70a afirmaban un timeout de comando de 2 s. En
node-redis 6.2.1 ese timeout se elimina al enviar el comando (`commands-queue.js`): con Redis
colgado, las solicitudes quedaban pendientes sin límite. Lo detectaron las pruebas de resiliencia
y se corrigió en 4f93950 con un tope propio por operación (2 s).

Cuando vence el tope, o se corta la conexión con el comando ya enviado, Redis pudo haberlo
ejecutado: la respuesta es 503 y un reintento puede recibir 409. Está demostrado con respuestas
perdidas en `qr.resilience.test.ts` y documentado en el contrato. No se implementó idempotencia
por solicitud.

## Pendientes

- **Varios QR activos por viaje.** Hoy cada `POST /qr` crea uno nuevo e independiente.
  Recomendación: no invalidar los anteriores en AE2. Hacerlo requiere un índice por viaje (una
  segunda estructura en Redis que hay que mantener consistente) y abre una carrera entre generar y
  validar. El riesgo es acotado: cada QR es de un solo uso, vence según `QR_TTL_SECONDS` (300 s por
  defecto) y el inicio del viaje lo decide M6. Revisar si M6 necesita un único QR vigente por viaje.
- **`maxLength` de `tripId` y `token`.** Hoy sólo los acota el límite de 100 kB del cuerpo; en los
  logs, `tripId` se recorta a 64 caracteres.
- **Formato del token** (43 caracteres base64url), para rechazar sin consultar Redis.
- **Rutas inexistentes:** responden 404 en HTML (Express), fuera del formato de error.
- **Cuerpo de más de 100 kB:** responde 500 en lugar de 413.
