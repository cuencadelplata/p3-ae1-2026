# Módulo 8 — Acuerdos intermodulares AE2

## 1. Objetivo

Este documento es la fuente de verdad humana para coordinar los acuerdos intermodulares que M8 necesita antes de congelar contratos AE2 e implementar RF8.1–RF8.7. No reemplaza OpenAPI ni futuros contratos ejecutables de eventos.

Las etiquetas son estrictas: **CONFIRMADO** tiene evidencia en código, OpenAPI o documentación; **PROPUESTA M8** requiere aceptación si afecta a otro módulo; **PENDIENTE DE ACUERDO** no tiene evidencia suficiente o presenta conflicto; **SIN DEPENDENCIA DEMOSTRADA** significa que se auditó la relación y no se halló integración necesaria.

## 2. Estado del documento

- Estado: **PROPUESTA M8 / PENDIENTE DE ACUERDO**.
- Base: auditoría AE2-0 y matriz AE1→AE2.
- Los contratos HTTP canónicos vigentes continúan en openapi/.
- Este documento no crea endpoints, schemas ni infraestructura.

## 3. Decisiones internas M8 congeladas (objetivo AE2)

Estas decisiones describen el objetivo común de M8. No reemplazan el estado
actual de cada RF: RF8.3 ya posee implementación AE2 propia que se conservará
hasta que la integración común se realice de forma mínima y explícita.

### Aplicación e infraestructura

- La entrega final tendrá una única aplicación/contenedor de M8; los siete RF
  conservarán responsabilidades internas separadas.
- M8 utilizará una CommunicationsDB física con ownership lógico —de
  preferencia schema por RF—, una instancia Redis compartida cuando exista una
  necesidad real y un RabbitMQ compartido.
- Redis es infraestructura interna para TTL, estado efímero, locks o datos
  temporales; no es una interfaz de integración entre módulos.
- Ningún RF de M8 consulta tablas, repositorios ni bases de otros módulos.
  La integración externa se realiza por REST/OpenAPI documentado o RabbitMQ.
- M6 conserva el lifecycle del viaje; M8 no ejecuta transiciones de viaje.

### Transporte y envelope

- RF8.6 es dueño técnico del transporte RabbitMQ: conexión, exchanges, queues,
  bindings, envelope, validación, Inbox, ACK/NACK, retry, DLQ, routing y
  adaptadores. Cada RF conserva su lógica, persistencia e idempotencia de
  negocio.
- El exchange común es `mobility.events` y el DLX es `mobility.events.dlx`.
- El envelope interno M8 usa `messageId`, `eventType`, `version`,
  `occurredAt`, `correlationId`, `producer` y `data`. Para flujos de viaje,
  la convención de esta AE2 es `correlationId = tripId`.
- `eventType` identifica el contrato semántico; la routing key AMQP define el
  enrutamiento. Por ejemplo, `PaymentConfirmed` se enruta como
  `payment.confirmed`, y `NotificationRequested` como
  `notification.requested`.

### Idempotencia, retry y delivery

- El Inbox técnico objetivo tiene `UNIQUE(consumerId, messageId)`: el mismo
  mensaje puede ser procesado legítimamente por consumidores diferentes. Se
  marca procesado sólo después de que el handler termina correctamente;
  después se realiza el ACK.
- Cada RF conserva además su idempotencia de negocio. Los índices concretos se
  definen con su implementación.
- La política común objetivo es un máximo de tres intentos y luego DLQ.
  RF8.3 mantiene por ahora su Inbox propio y una ruta particular para
  `dependency-unavailable`; ambos aspectos se alinearán al extraer la
  infraestructura compartida hacia RF8.6, sin falsear su estado actual.
- RF8.1 genera la notificación lógica y RF8.7 realiza la entrega. El flujo
  interno objetivo es `RF8.1 → NotificationRequested → RF8.7`; los campos del
  payload de delivery se cerrarán al implementarlo.

### Health y alcance

El objetivo de health común es `GET /health/live`, `GET /health/ready` y
`GET /health` como alias de ready, con estados `ok`, `degraded` y
`unavailable`. Receipts ya posee una base de health que se integrará
posteriormente al health global.

RF8.1–RF8.6 aparecen en la consigna general original. RF8.7 fue incorporado
posteriormente por definición confirmada del profesor para Sprint 2 / AE2 y
forma parte confirmada del alcance actual; no es opcional.

## 4. Ownership de datos

| Dato | Owner | ¿M8 necesita leerlo? | ¿M8 necesita modificarlo? | Forma esperada de intercambio | Estado del acuerdo | Observaciones |
| --- | --- | --- | --- | --- | --- | --- |
| Usuario | M1/M2 no resuelto | Potencialmente | No | Identificador o snapshot | PENDIENTE DE ACUERDO | Ownership ambiguo. |
| Cliente | M1/M2 no resuelto | Sí, para destinatario/receipt | No | Snapshot o consulta acordada | PENDIENTE DE ACUERDO | No se infiere desde recipientId. |
| Conductor | M3 | Sí, para receipt | No | Snapshot o HTTP acordado | PENDIENTE DE ACUERDO | Sin consumo M8 probado. |
| Solicitud | M5 | No demostrado | No | Evento si se acuerda | SIN DEPENDENCIA DEMOSTRADA | No hay contrato M5→M8. |
| Oferta | M5 | No demostrado | No | Evento si se acuerda | SIN DEPENDENCIA DEMOSTRADA | Hecho potencial, no contrato. |
| Despacho | M5/M6 no resuelto | Potencialmente | No | Evento oficial | PENDIENTE DE ACUERDO | Debe aclararse el productor de asignación. |
| Viaje / estado | M6 | Sí, como contexto | No | Evento o snapshot | PENDIENTE DE ACUERDO | M6 conserva la transición. |
| Ubicación | M4 | No demostrado | No | — | SIN DEPENDENCIA DEMOSTRADA | No aparece en RF M8 actuales. |
| Pago / importe / moneda | M7 | Sí, para receipt | No | Evento, snapshot o HTTP acordado | PENDIENTE DE ACUERDO | No hay integración formal. |
| Reintegro | M7 | No demostrado | No | — | PENDIENTE DE ACUERDO | Relevante sólo si altera comprobante/entrega. |
| Comprobante | M8 Receipts | Sí | Sí | API M8 | CONFIRMADO | Ownership propio. |
| QR | M8 QR | Sí | Sí | API M8 | CONFIRMADO | Token, expiración y consumo son M8. |
| Ticket | M8 Support | Sí | Sí | API M8 | CONFIRMADO | viajeId es el contexto externo actual. |
| Notificación | M8 Notifications | Sí | Sí | API/contrato interno M8 | CONFIRMADO | Delivery final pendiente. |
| Device token PUSH | No determinado | Sí, para RF8.7 | Posiblemente | Contrato futuro | PENDIENTE DE ACUERDO | No hay owner evidenciado. |
| Estado entrega PUSH | M8 RF8.7 | Sí | Sí | Contrato interno M8 | PROPUESTA M8 | No implementado en AE1. |

## 5. Convenciones transversales pendientes

### IDs

**PENDIENTE DE ACUERDO.** En contratos relevados aparecen id, viajeId, tripId e idViaje. Debe acordarse nomenclatura en fronteras públicas, sin obligar a renombrar modelos internos.

### Fechas

**PROPUESTA M8:** ISO 8601 normalizado a UTC.

### Dinero

**PENDIENTE DE ACUERDO con M7:** representación, moneda y precisión. Se evaluarán integer en unidades menores o decimal serializado; M8 no elige unilateralmente.

### Enumeraciones

**PENDIENTE DE ACUERDO.** Estados de viaje, pago y notificación deben estar versionados y documentados. No se permiten equivalencias implícitas como FINISHED y COMPLETADO.

## 6. M1 ↔ M8

**CONFIRMADO:** M1 tiene OpenAPI de identidad, autenticación, roles y endpoints bearer. **PENDIENTE DE ACUERDO:** ID global de usuario, significado de recipientId, JWT en M8, autorización de receipts/QR/tickets y credenciales service-to-service.

Para RF8.7 también quedan pendientes owner, alta, actualización, revocación y protección del device token PUSH. No hay evidencia para atribuirlo a M1.

## 7. M2 ↔ M8

**PENDIENTE DE ACUERDO:** la auditoría no resolvió si M2 es owner del perfil de cliente ni detectó contrato HTTP de M2. Antes de que Notifications o Receipts consulten datos se debe acordar ID, datos mínimos y si llegan como snapshot o HTTP. No se crea dependencia sin evidencia.

## 8. M3 ↔ M8

**CONFIRMADO:** M3 tiene OpenAPI de conductores y es la mejor evidencia disponible de su ownership funcional. **PENDIENTE DE ACUERDO:** ID canónico y datos mínimos de conductor para receipt.

Se compararán sin decidir aún: snapshot emitido por el productor del hecho frente a lookup HTTP a M3. El snapshot preserva el dato histórico; el lookup reduce copia pero puede variar tras cambios de perfil. M8 no debe copiar datos innecesarios.

## 9. M4 ↔ M8

M4 expone ubicación y disponibilidad. No se encontró consumo de esos datos por QR, Notifications, Receipts o Support. Estado: **SIN DEPENDENCIA DEMOSTRADA**. No debe crearse una integración por cercanía conceptual.

## 10. M5 ↔ M8

M5 expone solicitudes, candidatos y ofertas, pero no existe contrato formal M5↔M8 ni RabbitMQ asociado. Estado: **PENDIENTE DE ACUERDO**.

1. Qué hechos de solicitud, oferta, aceptación, rechazo, conductor encontrado o no encontrado requieren una notificación M8.
2. Si la asignación oficial la produce M5 o M6.
3. Qué IDs garantiza M5: solicitudId, viajeId, clienteId y conductorId.
4. Si M5 publica hechos de negocio o llama a Notifications. M8 propone hechos de negocio, sujeto a acuerdo.
5. Qué endpoints M5 son canónicos: el código incluye listados globales y por conductor no documentados en OpenAPI.

## 11. M6 ↔ M8

### Estado crítico

**PENDIENTE CRÍTICO:** hay dos OpenAPI incompatibles. origin/M6-Viajes declara OpenAPI 3.0.0 con crear/asignar/arribo/iniciar y parámetro id. origin/Grupo10-M6-Mordka-Mortola declara OpenAPI 3.0.3 con finalización, cancelaciones, historial y viajeId. M6 debe declarar el contrato canónico antes de congelar fronteras AE2.

### Identificación y lifecycle

M6 debe confirmar formato y nombre del ID, IDs de cliente/conductor, owner, precondición, resultado y productor de evento de creación, solicitud, asignación, arribo, inicio, cancelación y finalización. M8 no asume nombres ni estados definitivos.

### Eventos

El consumer AE1 de Support reconoce viaje.asignado, viaje.iniciado y viaje.completado, pero no demuestra productor ni contrato M6. Para esos hechos y una posible cancelación faltan routing key, productor, momento, payload, obligatorios, versión e idempotencia. Estado: **PENDIENTE DE ACUERDO**.

### QR RF8.2

**CONFIRMADO:** M8 genera y valida QR; M8 no modifica viajes. **PENDIENTE DE ACUERDO:** quién solicita generación, quién recibe/presenta/valida el token y qué acción posterior realiza M6. Si una validación habilita transición, sólo M6 la ejecuta mediante contrato explícito.

El mock histórico de M6 simula /qr y /qr/validate con codigo y valido; difiere del qr.openapi.yaml canónico. Es un stub, no un motivo para adaptar M8.

### Receipts

M6 debe acordar el snapshot de viaje que puede entregar a RF8.3. M8 no puede leer la DB de M6.

## 12. M7 ↔ M8

**CONFIRMADO:** M7 es la fuente evidenciada de pago e importe. Sus OpenAPI son parciales frente a rutas efectivas y mantiene dos copias exactas de cargo de cancelación. No hay contrato M7↔M8. Estado: **PENDIENTE CRÍTICO**.

M7 debe confirmar paymentId, asociación con tripId/viajeId, estados de pago, importe definitivo, moneda, descuentos, tasas, reintegros y cargos por cancelación. Debe acordarse qué habilita RF8.3: pago confirmado, viaje completado, ambos u otro hecho.

Se evaluarán sin decidir: evento pago.confirmado, consulta HTTP o snapshot combinado. RF8.4 sólo debe depender de M7 si se confirma requisito financiero o de autorización.

## 13. M9 ↔ M8

M9 tiene contratos de reservas programadas y un stub M5. No se encontró integración directa con M8. Una reserva puede llegar indirectamente por M5/M6. Estado: **SIN DEPENDENCIA DEMOSTRADA**.

## 14. Contratos internos entre servicios M8

| Relación | Necesidad conceptual | Estado |
| --- | --- | --- |
| RF8.6 Event Consumer → RF8.1 Notifications | Envelope común con `messageId`, 6 eventos de viaje, correlación, `tripId`, `recipientId`, queue `m8.notifications.trip-events`, deduplicación Inbox | **CONGELADO Y CONFIRMADO** (Ver catálogo v1 sección 5.4) |
| RF8.6 Event Consumer → RF8.3 Receipts | Snapshot suficiente sin consultas a DB ajena | PENDIENTE DE ACUERDO INTERNO |
| RF8.1 Notifications → RF8.7 Delivery | `NotificationRequested` via Outbox Relay (`outbox_deliveries`) publicado por RF8.6 tras `published_at` | **CONGELADO Y CONFIRMADO** (Ver catálogo v1 sección 5.3) |

RF8.1 genera la notificación lógica y persiste la orden de entrega en su Outbox. RF8.6 procesa la cola de Outbox, publica en RabbitMQ (`notification.requested`) y marca `published_at = NOW()` al recibir confirmación. RF8.7 es el responsable final del proveedor real/sandbox, reintentos e idempotencia de delivery.


## 15. HTTP / OpenAPI

**CONFIRMADO:** los contratos HTTP canónicos actuales de M8 están centralizados en openapi/ por servicio. m8-openapi.yaml es un índice y omite el reenvío de receipt; no debe interpretarse como contrato completo hasta resolverlo.

**PENDIENTE DE ACUERDO:** consumidores autorizados, autenticación y contratos M6/M7 que alimentan QR y Receipts. Esta fase no crea endpoints.

## 16. RabbitMQ / eventos

Como evidencia histórica, AE1 utilizó `viajes_exchange`, `m8_async_events`,
bindings `viaje.#` y `ticket.#`. No constituyen el contrato interno AE2.

El contrato interno M8 congelado para AE2 es el del catálogo de eventos:
`mobility.events`, `mobility.events.dlx`, envelope con `messageId`,
`eventType`, `version`, `occurredAt`, `correlationId`, `producer` y `data`, y
retry objetivo de tres intentos seguido de DLQ. RF8.6 será su owner técnico.

Esto no elimina los pendientes externos: cada productor externo debe adoptar
el contrato o ser adaptado por RF8.6. Si un módulo externo conserva nombres
históricos como `eventId`, `eventVersion` o `payload`, se documentará como
frontera externa pendiente, no como el contrato interno de M8.

## 17. Idempotencia y duplicados

| Interacción | Acuerdo necesario |
| --- | --- |
| HTTP | Definir cuándo se exige Idempotency-Key y qué POST puede duplicar efectos. |
| RF8.2 | Mantener consumo único atómico del QR. |
| RF8.3 | Una repetición no debe producir dos comprobantes. |
| RF8.6 | Inbox técnico objetivo con `UNIQUE(consumerId, messageId)` ante redelivery; cada RF conserva su idempotencia de negocio. |
| RF8.7 | Evitar PUSH duplicados y modelar ambigüedad del proveedor. |

Lo anterior es **PROPUESTA M8** hasta definir storage y semántica de reintento.

## 18. Errores, retry y DLQ

**CONFIRMADO como estado AE1:** se hacía ACK incluso ante excepción y no había
retry ni DLQ durables. **OBJETIVO AE2:** RF8.6 aplica la política común de
máximo tres intentos y luego DLQ. RF8.3 ya posee retry/DLQ, pero su camino
`dependency-unavailable` debe alinearse a esa política al extraer la
infraestructura común; no se afirma aquí que ya lo cumpla en todos los casos.

## 19. Seguridad y autorización

Decisiones **PENDIENTES DE ACUERDO**: JWT, credenciales service-to-service, roles/scopes, API keys si aplican, autorización de QR, receipts y tickets, permisos RabbitMQ, secretos y device tokens. M1 debe aclarar identidad y autorización reutilizables; este documento no presupone un mecanismo.

## 20. Observabilidad y correlación

**PROPUESTA M8:** `requestId` identifica una solicitud HTTP, `messageId` una
entrega de evento y `correlationId` recorre solicitud → viaje → pago →
comprobante → notificación. No se implementa tracing distribuido todavía.

## 21. Testing intermodular

Para desarrollar independientemente se necesitarán OpenAPI estable, schemas de eventos, fixtures, mocks/stubs contractuales, pruebas de producer/consumer y E2E final. Un mock contractual reproduce un acuerdo; un mock inventado no habilita integración. Los tests M8 no deben codificar interpretaciones libres de contratos ajenos.

## 22. Compatibilidad y versionado

**PENDIENTE DE ACUERDO:** versión OpenAPI común, prefijo /api/v1 cuando
corresponda, compatibilidad backward, deprecación y breaking changes. En el
envelope interno M8 la evolución se expresa con `version`; no se migra aquí
ningún contrato externo.

## 23. Decisiones bloqueantes para iniciar implementación

| ID | Módulo | Decisión | Por qué bloquea | RF afectados | Responsable externo | Estado |
| --- | --- | --- | --- | --- | --- | --- |
| B-01 | M6 | OpenAPI canónico e ID de viaje | Evita integrar dos lifecycles incompatibles | 8.1, 8.2, 8.3, 8.6 | Equipo M6 | BLOQUEANTE |
| B-02 | M6 | Productor, momento y payload de eventos | Event Consumer no puede extraerse sin contrato | 8.1, 8.2, 8.3, 8.6 | Equipo M6 | BLOQUEANTE |
| B-03 | M7 | Pago definitivo, importe y activación receipt | RF8.3 no recibe datos fiables | 8.3, 8.4, 8.6 | Equipo M7 | BLOQUEANTE |
| B-04 | M1/M2 | Owner de usuario/cliente y recipientId | Falta destinatario/autorización | 8.1, 8.3, 8.5, 8.7 | Equipos M1/M2 | BLOQUEANTE |
| B-05 | M8 | Implementación de Processing→Delivery | RF8.7 está confirmado, pero faltan su implementación y campos de delivery | 8.1, 8.7 | Equipo M8 | BLOQUEANTE DE IMPLEMENTACIÓN |
| B-06 | Transversal | Adopción o adaptación de envelope RabbitMQ por productores externos | El contrato interno M8 ya está definido; falta su adopción externa o adaptación mediante RF8.6 | 8.6, 8.7 | M5/M6/M7/M8 | BLOQUEANTE EXTERNO |
| I-01 | M5 | Hechos notificables y owner de asignación | Define alcance de Notifications | 8.1, 8.6 | Equipos M5/M6 | IMPORTANTE |
| N-01 | M4/M9 | Confirmar ausencia directa | Evita dependencias artificiales | — | Equipos M4/M9 | NO BLOQUEANTE |

## 24. Checklist para otros grupos

### Equipo M1

- Motivo: identidad/autorización. RF: 8.1, 8.3, 8.5, 8.7. Decisión: ID global, claims/roles y auth service-to-service.
- Motivo: delivery PUSH. RF: 8.7. Decisión: confirmar si M1 posee device tokens; si no, delimitar responsabilidad.

### Equipo M2

- Motivo: ownership de cliente ambiguo. RF: 8.1, 8.3, 8.5. Decisión: confirmar owner de perfil, ID y datos disponibles por snapshot/HTTP.

### Equipo M3

- Motivo: conductor histórico en comprobante. RF: 8.3. Decisión: ID, campos mínimos y mecanismo snapshot o HTTP.

### Equipo M4

- Motivo: confirmar ausencia de consumo M8. RF: ninguno. Decisión: validar que ubicación/disponibilidad no integran RF M8 AE2.

### Equipo M5

- Motivo: hechos notificables. RF: 8.1, 8.6. Decisión: listar hechos e IDs garantizados.
- Motivo: asignación. RF: 8.1, 8.6. Decisión: confirmar si M5 o M6 es productor oficial.
- Motivo: OpenAPI inconsistente. RF: indirecto. Decisión: identificar endpoints canónicos frente a rutas implementadas no documentadas.

### Equipo M6

- Motivo: dos OpenAPI incompatibles. RF: 8.1, 8.2, 8.3, 8.6. Decisión: contrato canónico, ID y lifecycle.
- Motivo: eventos de viaje. RF: 8.1, 8.2, 8.3, 8.6. Decisión: productor, routing key, momento, payload, versión e idempotencia.
- Motivo: QR no cambia viajes. RF: 8.2. Decisión: solicitante/validador QR y transición posterior exclusivamente M6.
- Motivo: snapshot de receipt. RF: 8.3. Decisión: campos que M6 puede entregar sin DB compartida.

### Equipo M7

- Motivo: emisión de comprobante. RF: 8.3, 8.4, 8.6. Decisión: paymentId, importe/moneda definitivos, estados y hecho habilitante.
- Motivo: transporte. RF: 8.3. Decisión: evento, HTTP o snapshot combinado.
- Motivo: reenvío. RF: 8.4. Decisión: confirmar si hay dependencia financiera/autorización o si permanece interno a M8.

### Equipo M9

- Motivo: reservas programadas potencialmente indirectas. RF: 8.1, 8.2. Decisión: confirmar si M9 llega directamente a M8 o sólo por M5/M6.

### Tabla resumen final

| Módulo | Relación con M8 | Directa/Indirecta/Ninguna | HTTP | RabbitMQ | Dato compartido | Decisiones pendientes | ¿Bloquea AE2? |
| --- | --- | --- | --- | --- | --- | --- | --- |
| M1 | Identidad/autorización posible | Directa potencial | PENDIENTE | PENDIENTE | usuario, recipient | ID, auth, tokens | Sí |
| M2 | Perfil cliente posible | Directa potencial | PENDIENTE | PENDIENTE | cliente | ownership, snapshot | Sí |
| M3 | Conductor para receipt | Directa potencial | PENDIENTE | PENDIENTE | conductor | campos/intercambio | Sí, RF8.3 |
| M4 | Ubicación/disponibilidad | Ninguna demostrada | No | No | — | confirmar ausencia | No |
| M5 | Solicitud/despacho | Directa potencial | PENDIENTE | PENDIENTE | solicitud/oferta | hechos, producer | Importante |
| M6 | Viaje/lifecycle | Directa | PENDIENTE | PENDIENTE | viaje/estado | contrato, eventos, QR | Sí |
| M7 | Pago/importe | Directa | PENDIENTE | PENDIENTE | pago/importe | hecho, snapshot | Sí |
| M9 | Reservas | Indirecta potencial | No | No | — | confirmar recorrido | No |

## 25. Historial de acuerdos

| Fecha | Hito | Estado |
| --- | --- | --- |
| 2026-09-27 | AE2-0: auditoría contractual global | CONFIRMADO como relevamiento |
| 2026-09-27 | AE2-1A: creación de este documento | PROPUESTA M8 / PENDIENTE DE ACUERDO |
