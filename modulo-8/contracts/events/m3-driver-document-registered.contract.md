# Contrato de integración: documento registrado de M3 a M8

**Productor:** M3 — Conductores y documentos
**Consumidor técnico:** RF8.6 — Mensajería M8
**Consumidor de negocio:** RF8.1 — Notificaciones
**Estado:** M3 ya publicó el envelope con `driverId` numérico; falta demostrar que el número corresponde al conductor autenticado en M1 y ejecutar la prueba conjunta con M8.

## Propósito

Cuando M3 registra un documento de un conductor, publica el hecho. M8 lo
consume, evita duplicados y RF8.1 crea una notificación lógica destinada al
conductor. RF8.7 realiza la entrega PUSH mediante el flujo interno habitual.

M8 no consulta la base de datos, Redis ni tablas de M3 para resolver la
identidad del conductor.

## Transporte

| Elemento | Valor |
| --- | --- |
| Exchange externo | `m3.eventos` |
| Tipo | `topic`, durable |
| Routing key | `documento.registrado` |
| Cola administrada por M8 | `m8.notificaciones.documento-registrado` |

RF8.6 declara el exchange externo, su propia cola y el binding. La URL de
RabbitMQ y sus credenciales se configuran por variables de entorno; no se
incluyen en el código ni en este contrato.

## Envelope

```json
{
  "messageId": "uuid-unico-del-evento",
  "eventType": "DriverDocumentRegistered",
  "version": 1,
  "occurredAt": "2026-10-11T23:04:00.000Z",
  "correlationId": "uuid-del-documento",
  "producer": "m3-conductores",
  "data": {
    "documentId": "uuid-del-documento",
    "driverId": 42,
    "tipoDocumento": "LICENCIA"
  }
}
```

| Campo | Regla |
| --- | --- |
| `messageId` | UUID único por evento; se usa para Inbox e idempotencia. |
| `eventType` | Literal `DriverDocumentRegistered`. |
| `version` | Entero `1`. |
| `occurredAt` | Fecha ISO 8601. |
| `correlationId` | Debe coincidir con `data.documentId`. |
| `producer` | `m3-conductores`. |
| `data.documentId` | Identificador del documento registrado. |
| `data.driverId` | `userId` numérico canónico de M1 del conductor destinatario. |
| `data.tipoDocumento` | Tipo del documento; RF8.1 lo valida, pero no lo incluye en el PUSH. |

## Límites y flujo

`driverId` no puede ser un UUID interno de M3 para completar la entrega PUSH.
Hasta que M3 integre identidad con M1 y emita el identificador numérico, M8
puede preparar la infraestructura y validar el contrato, pero no debe entregar
una notificación a un destinatario no verificable.

Una vez disponible el identificador canónico, el flujo será:

```text
M3 publica documento.registrado
→ RF8.6 recibe, deduplica y enruta
→ RF8.1 persiste la notificación y su Outbox
→ RF8.6 publica NotificationRequested
→ RF8.7 intenta la entrega PUSH al conductor
```

## Estado de RF8.7

RF8.1 ya prepara `NotificationRequested` con
`data.eventType = DRIVER_DOCUMENT_REGISTERED` y sin `tripId`, porque el hecho
se refiere a un documento y no a un viaje. RF8.7 acepta esta variante y usa
el `recipientId` numérico para resolver el device token. La entrega mediante
el proveedor sandbox se verificó con un productor M3 simulado y RabbitMQ y
PostgreSQL reales; sigue pendiente verificar al productor M3 real y su relación
`driverId` ↔ `userId` de M1.

## Auditoría del productor M3 publicado

Revisión de solo lectura de `m3-Conductores--Vehículos` en el commit
`3ee6c94388e9576a69235a046e09a16d4c191403` y de `integration/m1-ae2`
en `970f4332e82efbdb6970fbdadf42c5aa464f28ff`:

- M3 declara `m3.eventos` como exchange `topic` durable, usa
  `documento.registrado` y lee `RABBITMQ_URL` del entorno. Esa topología
  coincide con el contrato.
- `documents.events.ts` publica un JSON plano con `documentId`, `driverId`,
  `tipoDocumento` y `timestamp`. Faltan `messageId`, `eventType`, `version`,
  `occurredAt`, `correlationId`, `producer` y el objeto `data`.
- El `driverId` sale de `:driverId` en la ruta HTTP de M3, se almacena como
  `string` y se publica sin convertirlo ni comprobar su vínculo con M1. Sus
  pruebas usan valores como `driver-test-...`. M1 identifica al usuario con
  `userId` numérico en el token y en su contrato HTTP.

Ese commit anterior no superaba la validación de RF8.6. La prueba integrada
con un productor simulado acredita el flujo de M8, pero no sustituye una
prueba conjunta con el servicio M3 real.

### Actualización del publicador M3

La referencia remota `m3-Conductores--Vehículos` en `b11a471` contiene un
publicador actualizado. El equipo M3 mostró un mensaje real en RabbitMQ con
`messageId` también en las propiedades AMQP, `driverId: 101` numérico,
`correlationId` igual a `data.documentId`, `delivery_mode: 2`, exchange
`m3.eventos` y routing key `documento.registrado`. El valor
`tipoDocumento: LICENCIA_CONDUCIR` es válido para M8: el contrato exige texto
no vacío, sin restringirlo a `LICENCIA`.

El código publicado genera `messageId` con `randomUUID()` y construye el
envelope acordado. El evento mostrado supera las validaciones de RF8.6 y
RF8.1. Aún no demuestra que `101` sea el `userId` del conductor autenticado
en M1: M3 toma `driverId` del parámetro de la ruta y comprueba que sea
numérico, sin verificar su vínculo con M1 en esa ruta. Tampoco hay evidencia
de que M8 haya consumido ese `messageId`, creado una notificación e intentado
el PUSH para un token del conductor.

La publicación actual se inicia después de guardar el documento; si falla,
M3 registra el error y devuelve el documento sin un mecanismo visible de
republicación. Esto se debe probar y resolver para no perder avisos cuando
RabbitMQ esté caído. No se modifica M3 desde M8.
