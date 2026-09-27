# Instrucciones de desarrollo

## Contexto del proyecto

Este repositorio corresponde al proyecto AE1 de Paradigmas III.

Antes de realizar cualquier cambio, consultar la documentación disponible en `/docs`.
El documento oficial de la cátedra ubicado en `/docs/references` tiene prioridad ante cualquier contradicción.

Orden de prioridad documental:

1. `docs/references/ISI-Paradigmas3-AE1-Escenario-MovilidadUrbana-2026.pdf`
2. `docs/references/Sprint1-AE1-30_08.pdf`
3. `docs/m8/alcance-m8.md`
4. `docs/m8/decisiones-tecnicas.md`
5. `docs/m8/rf81-notificaciones.md` y `docs/m8/rf82-qr.md`
6. `docs/api/openapi.yaml`

## Alcance actual

El trabajo corresponde al **Módulo 8 — Notificaciones, Documentos y Soporte**, Grupo 6.

La branch final de trabajo es:

`M8-Notificaciones-QR`

Contiene:

- RF-8.1 — Notificaciones de viaje;
- RF-8.2 — QR de verificación.

No modificar funcionalidades de otros módulos o grupos ni realizar cambios directamente sobre `main`.

M8 no administra el ciclo de vida del viaje. M6 decide y ejecuta cualquier transición de estado, incluida `EN_CURSO`.

## API y diseño

Trabajar con enfoque Design-First / Contract-First. La fuente de verdad del contrato HTTP es `docs/api/openapi.yaml`.

La aplicación M8 es única y debe conservar:

- `POST /notifications` para RF-8.1;
- `POST /qr` y `POST /qr/validate` para RF-8.2;
- un manejo compartido y uniforme de errores;
- separación entre HTTP y lógica de negocio.

Priorizar responsabilidad única, alta cohesión, bajo acoplamiento, código simple y pruebas mantenibles. No introducir patrones, clases o capas únicamente por costumbre.

## Límites funcionales

RF-8.1 procesa eventos de viaje ya ocurridos. Genera el mensaje y usa un proveedor PUSH mock durante AE1; no implementa historial, persistencia de notificaciones, EMAIL ni SMS.

RF-8.2 genera y valida QR temporales asociados a un `tripId`. El QR contiene únicamente un token opaco; M8 controla expiración, asociación y uso único, pero no inicia el viaje ni conserva información completa de este.

No incorporar para estos RF en AE1:

- Redis;
- RabbitMQ;
- bases de datos adicionales;
- autenticación propia;
- responsabilidades de M6, usuarios, pagos o viajes.

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

Las pruebas E2E usan un contenedor Docker temporal, único y con puerto host dinámico. Nunca eliminar ni debilitar una prueba solamente para hacer pasar el pipeline.

## Git

Antes de modificar, verificar la branch actual. No cambiar de branch, hacer rebase, reescribir historial, commit o push sin autorización explícita.

No modificar `main` ni branches de otros grupos.
