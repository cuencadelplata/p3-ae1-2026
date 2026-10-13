# Contrato de integración: documento registrado de M3 a M8

**Productor:** M3 — Conductores y documentos
**Consumidor técnico:** RF8.6 — Mensajería M8
**Consumidor de negocio:** RF8.1 — Notificaciones
**Estado:** acordado; la entrega PUSH queda condicionada a que M3 emita `driverId` como `userId` numérico canónico de M1.

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

## Pendiente de RF8.7

RF8.1 ya prepara `NotificationRequested` con
`data.eventType = DRIVER_DOCUMENT_REGISTERED` y sin `tripId`, porque el hecho
se refiere a un documento y no a un viaje. RF8.7 debe extender su validador y
su contrato interno para aceptar esa variante antes de habilitar la entrega
PUSH de este evento en un entorno integrado.
