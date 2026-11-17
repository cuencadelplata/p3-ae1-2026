# Catálogo de eventos

Exchange durable `mobility.events`, tipo `topic`, JSON UTF-8. Colas durables, mensajes persistentes, `prefetch=8`, ack manual, publisher confirms. Versiones en el nombre; no cambiar la forma de v1 rompiendo consumidores.

| Evento/routing key | Productor | Consumidor / cola | Efecto |
|---|---|---|---|
| `TripCompleted.v1` | M6 | M2 worker / `m2.trip-completed` | Registra origen y destino recientes; suma usos una vez por viaje |
| `FavoriteAddressChanged.v1` | M2 outbox/worker | M8 demo / `m8.favorite-address-changed` | Un registro de bandeja por evento |

Envelope: `eventId` UUID, `type`, `occurredAt` fecha UTC ISO-8601, `correlationId` identificador, `data`. IDs de cliente/viaje admiten letras, números, guion y guion bajo, máximo 100. El esquema ejecutable completo está en `src/direcciones/domain.ts`.

## TripCompleted.v1

Ejemplo íntegro: [ejemplo-trip-completed.json](ejemplo-trip-completed.json). Data: `viajeId`, `clienteId`, `origen` y `destino`, cada punto con dirección (3–250 caracteres), latitud [-90,90] y longitud [-180,180]. M6 debe publicar sólo viajes realmente completados y reutilizar eventId/viajeId al reintentar. El productor real debería persistir su propio outbox; el simulador publica al broker con confirm y mantiene viajes en memoria.

M2 valida el contrato antes de procesar, registra Inbox, deduplica viajeId, actualiza los dos puntos y revisión dentro de una transacción. Usa la mayor fecha recibida para no retroceder último uso. Si cae antes del commit, se reintenta todo. Si cae después del commit pero antes del ack, se recibe otra vez sin repetir efectos.

## FavoriteAddressChanged.v1

```json
{
  "eventId": "22222222-2222-4222-8222-222222222222",
  "type": "FavoriteAddressChanged.v1",
  "occurredAt": "2026-10-05T14:00:00.000Z",
  "correlationId": "peticion-001",
  "data": {
    "clienteId": "cliente-123",
    "direccionId": "33333333-3333-4333-8333-333333333333",
    "accion": "CREADA",
    "version": 1
  }
}
```

Acciones: CREADA, ACTUALIZADA, ELIMINADA. Se emite al crear/promover una favorita, modificar su etiqueta/estado o eliminar una dirección mediante API. No contiene domicilio ni coordenadas. M8 simulado registra cada evento una sola vez, sin suponer orden de llegada; no mantiene una proyección de “estado actual”. Para un consumidor de estado, se debe comparar la versión, y al recrear una dirección cambia su ID.

## Fallos y reintentos

- JSON/esquema inválido → `<cola>.dlq` de inmediato.
- Error temporal → `<cola>.retry` con TTL 3000 ms y contador `x-retry`; hasta tres reintentos después del intento inicial.
- Agotados los reintentos → `<cola>.dlq`, para inspección; no descarte silencioso.
- El reenvío a retry/DLQ se confirma antes del ack del original. Si falla, se cierra canal sin ack para permitir redelivery.
- Caída RabbitMQ → worker reconecta cada 2 s; escrituras HTTP se acumulan en outbox.
- Los registros outbox se marcan sólo tras confirmación. Dos workers podrían publicar el mismo evento; consumidores deduplican.
- La cola retry usa DLX de RabbitMQ clásico. Ver limitación de fallos del broker en ADR-05. No se garantiza disponibilidad si se pierde el único nodo/disco.

Para reprocesar DLQ: corregir causa, tomar el cuerpo del mensaje y republicarlo en la routing key original conservando eventId, quitando el contador de reintento. Conservar evidencia y verificar deduplicación antes de retirar la copia de DLQ. El endpoint de demo de M6 permite repetir un TripCompleted válido con el mismo eventId.



## Reutilización RF-2.4 → RF-2.2 (v2.2.0)

Se comparte el cliente HTTP de M6, su URL y manejo de fallos. RF-2.2 conserva direcciones textuales y parejas de viajes propios completados; su endpoint de sugerencias propone B → A y permite usar cualquier dirección para ambos extremos. No requiere calificar ni inventa coordenadas. Los datos se guardan en CustomerDB para consulta sin M6/Internet. Ver INTEGRACION-M6.md para configuración, límites del contrato recibido y política de fechas.
