# M8 — Matriz AE1 → AE2

## 1. Objetivo

Este documento fija el mapa trazable entre la base consolidada de AE1 y el alcance objetivo de AE2 para el Módulo 8. Es una fuente de planificación: no crea servicios, contratos ejecutables ni infraestructura.

Los estados usados son explícitos: **AE1 IMPLEMENTADO**, **AE1 REORGANIZADO Y VALIDADO**, **AE1 PARCIAL**, **AE1 MEZCLADO**, **MOCK / PARCIAL**, **PENDIENTE AE2** y **NO IMPLEMENTADO**.

## 2. Estado consolidado de AE1

- `apps/notifications-processing/`: RF8.1 reorganizado y validado independientemente; mantiene el contrato HTTP histórico y el mock PUSH temporal.
- `apps/qr/`: RF8.2 reorganizado y validado independientemente; mantiene el store `Map` en memoria.
- `m8-documentos/`: emisión, consulta, descarga PDF y reenvío simulado de comprobantes, todavía reunidos en una aplicación.
- `m8-soporte/`: tickets en memoria y consumer RabbitMQ parcial, todavía mezclados con mocks de documentos y notificaciones.
- Los contratos root, UI, OpenAPI y Docker históricos se preservan como evidencia de AE1; no describen por sí mismos la arquitectura objetivo de AE2.

## 3. Principios de AE2

1. Cada servicio es dueño exclusivo de sus datos; no habrá lecturas SQL, repositories, storage ni tablas de otro servicio.
2. REST y RabbitMQ son contratos explícitos, no imports entre aplicaciones ni accesos a persistencia ajena.
3. Redis, RabbitMQ, PostgreSQL/outbox/inbox y proveedores reales son **PLANIFICADO AE2** hasta contar con un contrato y un gate de implementación.
4. Los estados, reintentos, idempotencia y ACK/NACK se definen por responsabilidad, no se infieren del código parcial de AE1.
5. M8 no administra el ciclo de vida del viaje: M6 conserva esa decisión, incluida la transición a `EN_CURSO`.

## 4. Mapa RF8.1–RF8.7

| RF | Responsabilidad objetivo | Servicio objetivo | Estado actual | Alcance AE2 resumido |
| --- | --- | --- | --- | --- |
| RF8.1 | Notificaciones de viaje | Notifications Processing | AE1 REORGANIZADO Y VALIDADO | Procesar comandos/eventos, persistencia/estado lógico e idempotencia si se adopta; emitir solicitud interna de delivery. |
| RF8.2 | QR temporal | QR | AE1 REORGANIZADO Y VALIDADO | Redis, TTL distribuido y consumo atómico entre instancias; sin cambiar estado del viaje. |
| RF8.3 | Emisión de comprobantes PDF | Receipts Generation | AE1 IMPLEMENTADO / AE1 MEZCLADO | Separar ownership de receipt/PDF/storage y conservar emisión idempotente. |
| RF8.4 | Reenvío de comprobantes | Receipts Delivery | AE1 IMPLEMENTADO / AE1 MEZCLADO | Modelar solicitudes, intentos, canal y resultados sin poseer Receipt/PDF/storage. |
| RF8.5 | Soporte de viajes | Support | AE1 IMPLEMENTADO | Servicio independiente con ciclo de tickets y persistencia propia a definir. |
| RF8.6 | Integración asíncrona | Event Consumer | AE1 PARCIAL | Consumer externo con envelope, idempotencia, ACK durable, retry/DLQ y traducción a comandos internos. |
| RF8.7 | Entrega de notificaciones | Notifications Delivery | MOCK / PARCIAL | Consumir solicitudes de delivery, proveedor PUSH, intentos, resultados y observabilidad. |

## 5. RF8.1 — Notifications Processing

### Estado AE1

**AE1 REORGANIZADO Y VALIDADO.** `POST /notifications` valida `tripId`, `recipientId`, `eventType` y `channels`; genera un mensaje determinístico, UUID y `createdAt`; espera `PushProvider.send()` y responde `201` con `status: PROCESSED`. Solo admite `PUSH`. No hay persistencia, `eventId`, idempotencia, outbox ni RabbitMQ interno.

### Reutilización

`apps/notifications-processing/` contiene validator, controller, service, tipos, puerto `PushProvider`, `mockPushProvider`, bootstrap HTTP y tests. El mock no acredita entrega real.

### Alcance AE2

- Aceptar comandos/eventos acordados de notificación.
- Validar y construir la notificación lógica.
- Definir persistencia propia, estado lógico e idempotencia por `eventId` si el contrato de entrada lo incorpora.
- Publicar una solicitud/comando interno para Notifications Delivery; usar outbox solo si se adopta formalmente.

### Contrato

El contrato histórico sigue siendo REST `POST /notifications`. El contrato asíncrono AE2 de entrada y el comando hacia Delivery son **CONTRATOS A ACORDAR**, con envelope, `eventId`, `correlationId`, `occurredAt`, destinatario, evento y canales definidos antes de implementarse.

### Ownership

Es dueño de la notificación lógica y, si se incorpora, de su persistencia/outbox. No es dueño de entrega real, intentos del proveedor ni estados de Delivery.

### Integraciones

No existe integración real con módulos externos en el código AE1. La documentación histórica prevé acontecimientos de viaje ya ocurridos; la fuente concreta desde M6 u otro productor queda **A ACORDAR EN AE2**.

### Persistencia

AE1: ninguna. AE2: base propia **A DEFINIR**; nunca compartida con Delivery ni con otros servicios.

### Concurrencia/idempotencia

AE1 no deduplica solicitudes. AE2 debe definir `eventId` e idempotencia antes de aceptar reprocesamientos.

### Fuera de alcance

No entrega PUSH directamente en la arquitectura objetivo, no administra viajes ni implementa EMAIL/SMS por inferencia.

### Criterios de aceptación

- El comando/evento válido genera una notificación lógica reproducible.
- Un mismo `eventId` no produce dos efectos lógicos.
- La solicitud interna de Delivery se emite bajo contrato acordado.
- El servicio no accede a datos de Delivery ni a datos de viajes ajenos.

### Pendientes

Persistencia, idempotencia, outbox, contrato de entrada, contrato Processing → Delivery y semántica definitiva de estados.

## 5.2 RF8.2 — QR

### Estado AE1

**AE1 REORGANIZADO Y VALIDADO.** `POST /qr` genera token opaco, hash SHA-256, PNG Data URL y vencimiento configurado; `POST /qr/validate` valida asociación con `tripId`, vigencia y uso único. El estado reside en un `Map` en memoria.

### Reutilización

`apps/qr/` conserva generator, store, service, controller, validator y tests propios.

### Alcance AE2

Redis para estado temporal con TTL distribuido y una operación de consumo atómica compatible con múltiples instancias. M8 continúa siendo dueño del QR; M6 decide cualquier transición de viaje.

### Contrato

Los endpoints REST históricos son la base: `POST /qr` y `POST /qr/validate`. Payloads y errores actuales están definidos en la OpenAPI histórica. Cualquier ajuste AE2 debe preservar explícitamente la separación QR/M6 antes de modificar el contrato.

### Ownership

QR es dueño de token opaco, hash, asociación mínima con `tripId`, expiración y consumo. No es dueño del viaje ni de su estado.

### Integraciones

La documentación funcional contempla a M6 como solicitante conceptual de generación/validación, pero no hay integración real implementada. El acuerdo REST externo es **A ACORDAR EN AE2**.

### Persistencia

AE1: `Map` en memoria. AE2: Redis para información temporal; SQL no está requerido inicialmente.

### Concurrencia/idempotencia

AE1 protege el uso único en una instancia. AE2 debe garantizar que dos validaciones concurrentes no consuman exitosamente el mismo token en múltiples instancias.

### Fuera de alcance

No contiene datos sensibles dentro del QR, no inicia viajes y no cambia estados de M6.

### Criterios de aceptación

- Token opaco y QR real para un `tripId` válido.
- TTL efectivo y rechazo de expirados.
- Asociación token/viaje obligatoria.
- Un solo consumo exitoso, también con instancias concurrentes.
- Sin transición de estado de viaje dentro de M8.

### Pendientes

Contrato externo M6, Redis, estrategia de atomicidad distribuida y decisión explícita sobre múltiples QR por viaje.

## 5.3 RF8.3 — Receipts Generation

### Estado AE1

**AE1 IMPLEMENTADO / AE1 MEZCLADO** en `m8-documentos/`. Expone emisión, consulta y descarga: `POST /api/v1/receipts`, `GET /api/v1/receipts/{tripId}` y `GET /api/v1/receipts/{tripId}/pdf`. Genera PDF con `pdfkit`, guarda metadata JSON y PDF en filesystem, y mantiene tests unitarios, integración y concurrencia.

La emisión es idempotente por `tripId`: candado en proceso y creación exclusiva de metadata con `wx`; devuelve `201` al crear y `200` si el receipt ya existe.

### Reutilización

Modelo Receipt, validator, service de emisión, renderer PDF, repository filesystem, controladores y pruebas son base reutilizable, pero no deben interpretarse como servicios separados ya extraídos.

### Alcance AE2

Receipts Generation será dueño de emisión, Receipt, metadata, PDF, storage, consulta, descarga e idempotencia de generación. Debe preservar una interfaz de dominio que permita sustituir el filesystem por persistencia propia y object storage cuando se acuerde.

### Contrato

El REST AE1 existente recibe datos de viaje, cliente/conductor, tarifa y pago. Comentarios y documentación identifican esos datos como provenientes conceptualmente de M6 y M7; el contrato inter-módulo formal sigue **A ACORDAR EN AE2**.

### Ownership

Dueño exclusivo de Receipt, metadata, PDF y referencia de storage. Receipts Delivery no puede consultar su DB, repository ni storage interno.

### Integraciones

No se detectó acceso a DB externa. La entrada desde M6/M7 es un contrato de datos recibido por REST en AE1, no una integración formal versionada entre módulos.

### Persistencia

AE1: filesystem local (`metadata/*.json`, `pdf/*.pdf`) y volumen Docker. AE2: DB propia y object storage **A DEFINIR**; CommunicationsDB aparece como intención histórica, no como implementación.

### Concurrencia/idempotencia

Ya existe protección AE1 por `tripId`. AE2 debe mantener una garantía durable equivalente, incluyendo la carrera entre instancias y coherencia entre metadata y objeto PDF.

### Fuera de alcance

No entrega por canal ni administra intentos/retries de reenvío; no consulta DB de viajes ni pagos.

### Criterios de aceptación

- Un viaje no genera dos receipts distintos.
- Receipt, metadata y PDF pertenecen a Generation.
- Consulta y descarga se realizan por contrato del dueño.
- Fallos de almacenamiento no dejan un PDF huérfano visible.

### Pendientes

Extracción física, persistencia AE2, object storage, contrato M6/M7 y contrato controlado hacia Delivery.

## 5.4 RF8.4 — Receipts Delivery

### Estado AE1

**AE1 IMPLEMENTADO / AE1 MEZCLADO** dentro de `m8-documentos/`: `POST /api/v1/receipts/{tripId}/resend` acepta canal/destino, agrega un `DeliveryRecord` al Receipt y responde `202`. El envío es simulado; no hay proveedor real, intento independiente ni retry.

### Reutilización

La validación de canal/destino y la evidencia de reenvío son referencia funcional, pero el código actual mezcla actualización de Receipt con la responsabilidad de delivery.

### Alcance AE2

Receipts Delivery será dueño de `DeliveryRequest`, `DeliveryAttempt`, canal, proveedor, intentos y resultados. No será dueño de Receipt, PDF, metadata ni storage principal.

### Contrato

`GET /internal/receipts/{receiptId}/delivery-reference` es un contrato interno **PLANIFICADO AE2 — NO IMPLEMENTADO**: Generation podrá devolver una referencia temporal/firmada o un stream controlado. `POST /m8/receipts/{tripId}/resend` es un contrato público objetivo **PLANIFICADO AE2** si se mantiene como decisión aprobada; no existe hoy.

### Ownership

Delivery posee sus solicitudes e intentos; Generation conserva el documento y la referencia de almacenamiento. La relación se resuelve por REST/evento explícito, nunca leyendo repositorios o tablas ajenas.

### Integraciones

El supuesto de publicación RabbitMQ hacia notificaciones aparece solo como comentario/documentación futura de AE1. El contrato y productor/consumidor concreto son **A ACORDAR**.

### Persistencia

AE1: `deliveries` embebido en metadata filesystem del Receipt. AE2: persistencia propia de Delivery **A DEFINIR**.

### Concurrencia/idempotencia

AE1 serializa reenvíos por `tripId`, pero no modela solicitudes duplicadas ni intentos. AE2 debe definir idempotencia de reenvío y correlación de intentos antes de agregar retries.

### Fuera de alcance

No genera PDF, no altera metadata principal de Receipt y no accede a storage de Generation directamente.

### Criterios de aceptación

- Un reenvío crea/rastrea una solicitud de Delivery bajo su ownership.
- Generation entrega una referencia mediante contrato, no acceso interno.
- Los intentos y resultados son observables.
- Duplicados y reintentos tienen semántica acordada.

### Pendientes

Extracción física, modelo de Delivery, contrato con Generation, proveedor y política de retry.

## 5.5 RF8.5 — Support

### Estado AE1

**AE1 IMPLEMENTADO** en `m8-soporte/`. Expone tickets por REST: creación, consulta, listado y cambio de estado (`ABIERTO`, `EN_PROCESO`, `RESUELTO`). El repositorio es un arreglo en memoria; hay tests de controller y modelo.

### Reutilización

Modelo Ticket, controlador y rutas son base funcional. La aplicación actual también contiene Swagger y conexión RabbitMQ, por lo que no es todavía el Support objetivo aislado.

### Alcance AE2

Servicio independiente con ciclo de atención, persistencia propia, estados y contratos externos claramente definidos.

### Contrato

La API REST AE1 `/tickets` existe. No se detectó un contrato formal con M1, M2, M5, M6 o M7; el único dato externo usado es `viajeId`. Cualquier contrato de contexto del viaje queda **A ACORDAR EN AE2**.

### Ownership

Support es dueño de Ticket y su ciclo de atención. No puede leer DB de viajes, pagos, QR, receipts ni delivery ajenos.

### Integraciones

Los mocks de documentos/notificaciones del consumer no son integraciones válidas entre servicios. Deben reemplazarse por contratos explícitos si el caso de uso se aprueba.

### Persistencia

AE1: memoria. AE2: base propia **A DEFINIR**.

### Concurrencia/idempotencia

AE1 no define control de concurrencia ni deduplicación. AE2 debe evaluar concurrencia de cambios de estado y deduplicación de comandos/eventos que creen tickets.

### Fuera de alcance

No lee DB de otros módulos ni incorpora generación QR/PDF o envío PUSH como lógica de tickets.

### Criterios de aceptación

- Tickets persistidos bajo ownership de Support.
- Cambios de estado validados y trazables.
- Integraciones externas mediante contrato, no mocks ni DB compartida.

### Pendientes

Extracción, persistencia, reglas del ciclo de atención y contratos de contexto de viaje.

## 5.6 RF8.6 — Event Consumer / RabbitMQ

### Estado AE1

**AE1 PARCIAL** en `m8-soporte/src/rabbitmq/consumer.ts`. Existe conexión AMQP, exchange `viajes_exchange`, cola `m8_async_events`, bindings `viaje.#` y `ticket.#`, `prefetch(1)`, publicación y consumo. El consumer interpreta routing keys y llama mocks de documentos/notificaciones; confirma `ack` incluso ante excepciones y solo reintenta conexión de manera básica.

### Reutilización

La evidencia de conexión/bindings es reutilizable como referencia, no como Event Consumer final. No hay envelope estándar, `eventId`, `correlationId`, inbox, retry durable ni DLQ.

### Alcance AE2

Consumir eventos externos, validar envelope, deduplicar por `eventId`, persistir inbox si corresponde, ACK solo tras procesamiento durable, aplicar retry/DLQ acordados y traducir eventos externos a comandos internos.

### Contrato

El broker y routing keys actuales constituyen una implementación AE1 parcial. Los eventos externos de M1/M2/M5/M6/M7 y su schema son **A ACORDAR EN AE2**. No se deben considerar los mocks actuales como contrato.

### Ownership

Event Consumer es dueño de recepción, validación, deduplicación/inbox y traducción. No contiene lógica de QR, PDF, tickets ni PUSH.

### Integraciones

RabbitMQ AE1 existe solo dentro de Support y con routing keys demostrativas. El productor externo real no está definido en este repositorio.

### Persistencia

AE1: ninguna para eventos. AE2: inbox/registro propio **A DEFINIR**, sin DB compartida.

### Concurrencia/idempotencia

AE1 usa `prefetch(1)` pero no evita reprocesamiento. AE2 debe resolver redeliveries, duplicados, ACK/NACK, retry y DLQ conforme a contratos durables.

### Fuera de alcance

No implementa dominio QR, receipts, tickets ni delivery.

### Criterios de aceptación

- Envelope validado antes de traducirlo.
- Duplicados por `eventId` no causan doble efecto.
- ACK ocurre solo tras efecto durable o respuesta idempotente.
- Fallos siguen una política retry/DLQ documentada.

### Pendientes

Extracción, esquema de eventos, inbox, ACK/NACK, retries, DLQ y contratos con productores.

## 5.7 RF8.7 — Notifications Delivery

### Estado AE1

**MOCK / PARCIAL.** Solo existen `PushProvider` y `mockPushProvider` dentro de Notifications Processing. El mock resuelve sin I/O y no conserva intentos, resultados ni entrega a dispositivo.

### Reutilización

El puerto es una frontera técnica reutilizable; el mock es evidencia de AE1, no un Delivery implementado.

### Alcance AE2

Consumir solicitud/comando de entrega, integrar proveedor PUSH, registrar intentos/resultados, aplicar retries específicos y exponer observabilidad de delivery si corresponde.

### Contrato

El comando Processing → Delivery es **PLANIFICADO AE2**. Debe acordar identificador, destinatario, mensaje/canal, correlación, idempotencia y resultado. No existe servicio ni carpeta Delivery hoy.

### Ownership

Delivery será dueño de intentos, resultados, proveedor y su persistencia propia. No será dueño de la notificación lógica de Processing.

### Integraciones

No existe proveedor externo ni RabbitMQ interno implementado.

### Persistencia

AE1: ninguna. AE2: propia **A DEFINIR**.

### Concurrencia/idempotencia

AE1 no modela intentos. AE2 debe deduplicar solicitudes de delivery y definir retries sin duplicar entregas cuando el proveedor sea ambiguo.

### Fuera de alcance

No valida eventos de viaje ni construye mensajes de negocio en la arquitectura objetivo.

### Criterios de aceptación

- Consume un comando acordado sin importar código de Processing.
- Registra resultados/intententos bajo ownership propio.
- Maneja duplicados y retry conforme a contrato.
- No accede a datos de Processing directamente.

### Pendientes

Diseño del servicio, contrato interno, proveedor, persistencia, idempotencia y observabilidad.

## 6. Matriz maestra

| RF | Servicio objetivo | Ubicación actual | Reutilizable | Entrada / salida | Persistencia AE2 | Integración | Concurrencia / idempotencia | Estado |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 8.1 | Notifications Processing | `apps/notifications-processing` | Validator, service, puerto PUSH | HTTP histórico / comando Delivery futuro | Propia, a definir | REST actual; eventos futuros a acordar | `eventId` futuro | AE1 REORGANIZADO Y VALIDADO |
| 8.2 | QR | `apps/qr` | Token, hash, validator, store | REST QR / resultado a solicitante | Redis temporal | REST con M6 a acordar | Consumo único atómico | AE1 REORGANIZADO Y VALIDADO |
| 8.3 | Receipts Generation | `m8-documentos` | Receipt, PDF, repository, locks | REST receipt / PDF-referencia futura | Propia + object storage, a definir | REST M6/M7 a acordar | Idempotencia por viaje | AE1 IMPLEMENTADO / AE1 MEZCLADO |
| 8.4 | Receipts Delivery | `m8-documentos` | Validación de reenvío | Reenvío / resultado delivery | Propia, a definir | Contrato Generation futuro | Solicitud/intento futuro | AE1 IMPLEMENTADO / AE1 MEZCLADO |
| 8.5 | Support | `m8-soporte` | Ticket/controller | REST tickets / ticket | Propia, a definir | Contexto viaje a acordar | Evaluar comandos repetidos | AE1 IMPLEMENTADO |
| 8.6 | Event Consumer | `m8-soporte/rabbitmq` | AMQP/bindings como referencia | Evento externo / comando interno | Inbox propia, a definir | RabbitMQ a acordar | Dedupe, ACK/NACK, retry/DLQ | AE1 PARCIAL |
| 8.7 | Notifications Delivery | No existe | Puerto/mock como referencia | Comando Processing / resultado proveedor | Propia, a definir | RabbitMQ o REST a acordar | Dedupe de delivery/retry | MOCK / PARCIAL |

## 7. Matriz de contratos

| Productor / cliente | Consumidor | Tipo | Contrato | Estado | Observaciones |
| --- | --- | --- | --- | --- | --- |
| Cliente técnico | Notifications Processing | REST | `POST /notifications` | EXISTENTE AE1 | Histórico; no hay productor M6 real integrado. |
| Cliente técnico | QR | REST | `POST /qr`, `POST /qr/validate` | EXISTENTE AE1 | M6 es relación conceptual, no integración implementada. |
| Cliente técnico | Receipts Generation | REST | Emisión, consulta y descarga `/api/v1/receipts` | EXISTENTE AE1 | Datos atribuidos conceptualmente a M6/M7; acuerdo formal pendiente. |
| Cliente técnico | Receipts Delivery mezclado | REST | `POST /api/v1/receipts/{tripId}/resend` | EXISTENTE AE1 | Simula entrega; no es Delivery independiente. |
| Cliente técnico | Support | REST | `/tickets` y cambios de estado | EXISTENTE AE1 | No hay contrato externo de contexto de viaje. |
| Support parcial | RabbitMQ | RabbitMQ | `viajes_exchange`, `m8_async_events`, `viaje.#`, `ticket.#` | PARCIAL | Sin schema/envelope durable ni idempotencia. |
| Notifications Processing | Notifications Delivery | REST o RabbitMQ | Comando de delivery | PLANIFICADO AE2 | Transporte y schema a acordar. |
| Receipts Delivery | Receipts Generation | REST | `GET /internal/receipts/{receiptId}/delivery-reference` | PLANIFICADO AE2 | No implementado. |
| Cliente técnico | Receipts Delivery | REST | `POST /m8/receipts/{tripId}/resend` | PLANIFICADO AE2 | Requiere decisión final de exposición pública. |

## 8. Matriz de ownership

| Servicio | Recurso / dato propio | Persistencia actual | Persistencia AE2 | No puede leer directamente |
| --- | --- | --- | --- | --- |
| Notifications Processing | Notificación lógica | Ninguna | Propia, a definir | Delivery, viajes, pagos, tickets, receipts |
| Notifications Delivery | Solicitud, intento y resultado de delivery | No existe | Propia, a definir | Notificación lógica y DB de Processing |
| QR | Token hash, `tripId`, expiración, uso | `Map` en memoria | Redis temporal | Estado de viaje de M6 |
| Receipts Generation | Receipt, metadata, PDF, storage reference | Filesystem | Propia + object storage, a definir | DB de M6/M7 y Delivery |
| Receipts Delivery | DeliveryRequest, DeliveryAttempt, resultado | Embebido en Receipt AE1 | Propia, a definir | Receipt/PDF/storage de Generation |
| Support | Ticket y ciclo de atención | Memoria | Propia, a definir | DB de viajes, QR, receipts, pagos |
| Event Consumer | Envelope, recepción, inbox/dedupe | Ninguna | Inbox propia, a definir | Datos de dominio de los consumidores |

## 9. Matriz de infraestructura

| Servicio | HTTP | RabbitMQ | Redis | SQL | Files / object storage | Estado actual | Estado AE2 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Notifications Processing | Sí | No | No | No | No | HTTP + mock | Eventos/REST acordados; persistencia/outbox a definir |
| Notifications Delivery | No existe | No existe | No | No | No | Mock dentro de Processing | Transporte/proveedor/persistencia a definir |
| QR | Sí | No | No | No inicialmente | No | REST + `Map` | Redis temporal distribuido |
| Receipts Generation | Sí | No | No | No | Filesystem/PDF | App mezclada | DB propia y object storage a definir |
| Receipts Delivery | Mezclado | No | No | No | No propio | Reenvío simulado | Servicio/persistencia/proveedor a definir |
| Support | Sí | Parcial | No | No | No | Memoria + RabbitMQ parcial | DB propia y contratos acordados |
| Event Consumer | No necesariamente público | Parcial | No | No | No | Dentro de Support | RabbitMQ durable + inbox/retry/DLQ a definir |

## 10. Matriz de concurrencia e idempotencia

| RF | Riesgo | Mecanismo objetivo | Estado actual | Pendiente AE2 |
| --- | --- | --- | --- | --- |
| 8.1 | Evento/comando duplicado | `eventId` e idempotencia durable | No existe | Definir contrato y storage |
| 8.2 | Dos consumos del mismo QR | Operación atómica en Redis | Atómico solo en una instancia `Map` | Atomicidad distribuida |
| 8.3 | Dos emisiones para un viaje | Restricción durable por viaje + flujo consistente PDF/metadata | Lock local + `wx` filesystem | Equivalente durable al separar storage |
| 8.4 | Reenvíos duplicados / retries | Idempotency key y DeliveryAttempt | No modelado | Definir semántica y persistencia |
| 8.5 | Creación/cambio concurrente de tickets | Reglas y versionado/commands a definir | Memoria sin control | Evaluación de ciclo y concurrencia |
| 8.6 | Redelivery y fallo de consumer | Inbox por `eventId`, ACK durable, retry/DLQ | `prefetch(1)`, ACK incluso ante error | Envelope, ACK/NACK, retry/DLQ |
| 8.7 | Delivery duplicado/resultado ambiguo | Dedupe de solicitud y política proveedor | Mock sin efectos | Diseñar intentos y retry |

## 11. Dependencias externas pendientes de acuerdo

- M6: contrato de eventos/comandos de notificación y REST QR; M6 conserva el estado de viaje.
- M6 y M7: contrato de datos para emisión de comprobantes; la atribución existe en documentación AE1, no como contrato versionado inter-módulo.
- M1, M2 y M5: no se detectó contrato implementado en el repositorio; cualquier productor/consumidor de eventos debe acordarse antes de codificar.
- Proveedor PUSH y canal de delivery: no existe proveedor real ni SLA/semántica de resultado.
- RabbitMQ: envelope, routing keys, versionado, `eventId`, `correlationId`, `occurredAt`, ACK/NACK, retry y DLQ.

## 12. Implementado vs planificado

| Implementado / reorganizado AE1 | Planificado AE2 — no implementado |
| --- | --- |
| Notifications HTTP con mock PUSH | Notifications Delivery, eventos, outbox, idempotencia y persistencia |
| QR REST con `Map`, TTL y single-use | Redis distribuido y contrato M6 formal |
| Receipt PDF/filesystem/idempotencia por viaje | Separación Generation/Delivery, DB/object storage y contratos internos |
| Tickets REST en memoria | Support independiente con persistencia propia |
| RabbitMQ dentro de Support con mocks | Event Consumer final, envelope, inbox, ACK durable, retry/DLQ |

## 13. Orden recomendado de implementación AE2

1. Consolidar contratos públicos, internos y de eventos; resolver acuerdos externos.
2. Definir ownership, esquemas de persistencia e idempotencia por servicio.
3. Evolucionar QR a Redis manteniendo el contrato y single-use.
4. Separar Generation y Delivery de Receipts bajo contratos explícitos.
5. Extraer Support y Event Consumer, retirando mocks de dominio del consumer.
6. Diseñar e implementar Notifications Delivery solo después de acordar el comando de delivery.

Este orden es de planificación; no autoriza implementación automática.

## 14. Riesgos

- Confundir mocks o RabbitMQ parcial de AE1 con servicios AE2 completos.
- Romper contratos/UI/Docker históricos antes de validar reemplazos.
- Duplicar efectos ante redelivery, retries o múltiples instancias sin idempotencia durable.
- Permitir que Delivery lea storage o persistencia de Generation.
- Convertir Event Consumer en un mega-servicio con lógica de QR, PDFs, tickets o PUSH.
- Alterar el límite M8/M6 y hacer que QR o Processing cambien el estado de un viaje.

## 15. Criterio de cierre del diseño AE2

El diseño estará listo para implementación cuando cada RF tenga: owner claro, estado actual verificable, contrato versionado, productor/consumidor identificado, persistencia propia definida, política de concurrencia/idempotencia, infraestructura justificada, fuera de alcance y criterios de aceptación convertibles en tests, smokes, E2E y contract tests.
