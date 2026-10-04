# Instrucciones de desarrollo

## Contexto del proyecto

Este repositorio corresponde al proyecto de Paradigmas III. La AE1 constituye
el antecedente trazable de esta etapa AE2.

Antes de realizar cualquier cambio, consultar la documentación disponible en
`modulo-8/docs/`, `modulo-8/openapi/` y `modulo-8/contracts/`. El documento
oficial de la cátedra ubicado en `docs/references/` tiene prioridad ante
cualquier contradicción.

## Alcance actual

El trabajo corresponde al **Módulo 8 — Notificaciones, Documentos y Soporte**, Grupo 6.

La branch compartida de trabajo es:

`M8-Notifications-QR-Receipts-Support`

El alcance actual confirmado para AE2 contiene:

- RF8.1 — Notificaciones de viaje;
- RF8.2 — QR de verificación;
- RF8.3 — Comprobante PDF;
- RF8.4 — Reenvío de comprobante;
- RF8.5 — Soporte asociado a viaje;
- RF8.6 — Consumo asíncrono / RabbitMQ;
- RF8.7 — Entrega de notificaciones.

RF8.1–RF8.6 aparecen en la consigna general original. RF8.7 fue incorporado
posteriormente por definición confirmada del profesor para Sprint 2 / AE2 y
forma parte real de esta entrega; no es opcional.

No modificar funcionalidades de otros módulos o grupos ni realizar cambios directamente sobre `main`.

M8 no administra el ciclo de vida del viaje. M6 decide y ejecuta cualquier transición de estado, incluida `EN_CURSO`.

## API y diseño

Trabajar con enfoque Design-First / Contract-First. Los contratos HTTP actuales
de M8 se encuentran en `modulo-8/openapi/`.

La entrega final tendrá una única aplicación/contenedor de M8. Los RF deben
mantener separación interna de responsabilidades, con bootstrap único, módulos
y rutas registrados en una app común, sin reescrituras innecesarias.

Priorizar responsabilidad única, alta cohesión, bajo acoplamiento, código simple y pruebas mantenibles. No introducir patrones, clases o capas únicamente por costumbre.

## Límites funcionales e infraestructura AE2

M8 no modifica el lifecycle de M6. En particular, M8 no inicia viajes ni los
pasa a `EN_CURSO`.

- RF8.1 interpreta hechos notificables, genera y persiste la notificación
  lógica, conserva idempotencia de negocio y prepara/publica la solicitud de
  entrega; no es dueño del transporte AMQP ni de la entrega PUSH real.
- RF8.2 administra QR temporales asociados a `tripId`, TTL, expiración,
  consumo atómico y single-use. Redis es obligatorio cuando esa necesidad
  técnica exista; no es un mecanismo de integración intermodular.
- RF8.3 conserva su lógica de comprobante, metadata, PDF, idempotencia de
  negocio y publicación `ReceiptIssued` mediante Outbox.
- RF8.4 gestiona reenvíos y referencias de entrega, sin regenerar el PDF.
- RF8.5 gestiona tickets de soporte, su historial y persistencia.
- RF8.6 es dueño técnico del RabbitMQ compartido: conexión, exchanges,
  queues, bindings, envelope, Inbox, ACK/NACK, retry, DLQ, routing y
  adaptadores. Los demás RF mantienen el significado y las reglas de negocio.
- RF8.7 recibe solicitudes de entrega originadas en RF8.1 y es dueño del
  proveedor real/sandbox, intentos, resultados, retry e idempotencia de
  delivery; no interpreta el lifecycle ni genera el texto de negocio.

La infraestructura compartida contempla una CommunicationsDB física, un Redis
y un RabbitMQ. Cada RF conserva ownership lógico —preferentemente un schema
propio— y no puede acceder directamente a datos de otros módulos externos.
Los servicios de infraestructura pueden ejecutarse mediante Compose; no forman
parte del proceso Node ni del único contenedor de aplicación M8.

La integración externa se realiza únicamente mediante REST/OpenAPI documentado
o RabbitMQ. RF8.6 es el dueño técnico de la topología común
`mobility.events` y su DLX `mobility.events.dlx`.

El objetivo de health común es `GET /health/live`, `GET /health/ready` y
`GET /health` como alias de ready, con estados `ok`, `degraded` o
`unavailable`.

## Tecnología y configuración

Utilizar:

- Node.js 24;
- TypeScript;
- Express;
- pnpm 10.33.0;
- Vitest y Supertest;
- Docker con una única imagen multi-stage del servicio M8.

El proyecto utiliza pnpm como único gestor de paquetes. No usar npm, yarn ni otros gestores, y no mantener lockfiles distintos de `pnpm-lock.yaml`.

La configuración se realiza externamente. En particular, RF-8.2 utiliza `QR_TTL_SECONDS`; no hardcodear secretos, tokens ni configuraciones sensibles.

## Calidad y pruebas

Toda lógica nueva debe tener pruebas proporcionales. Ejecutar, según corresponda:

`pnpm typecheck`

`pnpm typecheck:test`

`pnpm build`

`pnpm test`

`pnpm test:coverage`

`pnpm test:e2e`

Las pruebas deben ser proporcionales y mantenibles. Nunca eliminar ni debilitar
una prueba solamente para hacer pasar el pipeline.

## Git

Antes de modificar, verificar la branch actual. Mantener commits pequeños y
temáticos y trazabilidad individual. No cambiar de branch, hacer rebase,
reescribir historial, commit o push sin autorización explícita. No hacer
squash, amend de commits ya compartidos, force push ni reset destructivo.

No modificar `main` ni branches de otros grupos.
