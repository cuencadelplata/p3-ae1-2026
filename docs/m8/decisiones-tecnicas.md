# Decisiones técnicas - M8 Grupo 6

## API REST

El Módulo 8 se implementa como un servicio que expone una API REST. La misma API podrá incorporar los requerimientos del módulo, aunque esta branch implementa únicamente RF-8.1.

## Stack

- Node.js 24 LTS.
- TypeScript con una configuración estricta y simple.
- Express.
- pnpm 10.33.0 como único gestor de paquetes y `pnpm-lock.yaml` como único lockfile.

TypeScript aporta tipado estático, mantenibilidad y una evolución más segura, sin introducir abstracciones no necesarias para el alcance actual.

## Contract-First y OpenAPI

OpenAPI es la fuente de verdad del contrato de RF-8.1. El contrato se revisa antes de implementar el endpoint y está definido en `docs/api/openapi.yaml`.

También se expone el mismo archivo mediante `GET /openapi.yaml`. No se agregó Swagger UI: el contrato OpenAPI existente es suficiente para AE1 y no se justifican dependencias adicionales únicamente para visualizarlo.

## Organización y límites

Se separan HTTP, validación y lógica de notificación. M8 no administra viajes, usuarios ni pagos, ni consulta datos de otros servicios. En AE1 las dependencias externas se representan con mocks, sin reemplazar la lógica propia de M8.

Para RF-8.1, `PUSH` es el canal actual. M8 valida, reconoce el evento, genera el mensaje, asigna identificador y fecha y procesa el canal. `MockPushProvider` sustituye solo al proveedor PUSH externo; `PROCESSED` indica procesamiento correcto de M8, no entrega real al dispositivo. La abstracción permite incorporar EMAIL y SMS posteriormente sin alterar la lógica central.

## Interfaz de usuario

Para RF-8.1 se utiliza HTML, CSS y JavaScript vanilla, servidos por el mismo Express. La interfaz es pequeña y demuestra el endpoint real, por lo que un frontend separado agregaría complejidad innecesaria para este alcance: un segundo servidor, configuración CORS, dependencias frontend adicionales y un framework sin necesidad concreta. Esta es una decisión acotada a AE1, no una afirmación general sobre tecnologías frontend.

## Infraestructura de la entrega

La imagen se construye con un Dockerfile multi-stage basado en `node:24-alpine` y pnpm 10.33.0. El runtime instala dependencias de producción, usa `NODE_ENV=production`, se ejecuta como el usuario no privilegiado `node` y lee un `PORT` configurable.

La imagen incluye `dist/`, `public/` y `docs/api/openapi.yaml`, por lo que sirve API, UI y contrato. No hay despliegue cloud en esta etapa.

## Testing implementado

Vitest 4.1.11 define los proyectos `unit`, `integration` y `e2e`. Actualmente hay 53 pruebas unitarias, 38 de integración y 21 E2E Docker, para un total de 112.

- Unit: componentes aislados.
- Integration: Express y los componentes trabajando juntos.
- E2E: imagen Docker real consumida mediante HTTP.

Los E2E usan `globalSetup` para construir y ejecutar Docker, fijan `PORT=3100` dentro del contenedor, obtienen un puerto de host dinámico, esperan disponibilidad HTTP y comparten la URL mediante `project.provide` e `inject`. El teardown elimina únicamente el contenedor creado por esa ejecución.

`tests/tsconfig.json` permite que los archivos de pruebas se asocien correctamente al proyecto TypeScript usado para testing y por el editor.

La cobertura de unit e integration es 100% en statements, branches, functions y lines del código ejecutable incluido. `src/server.ts` se valida conductualmente mediante E2E Docker. `public/app.js` se valida mediante integración HTTP, E2E HTTP y revisión manual, no mediante el coverage V8 del backend.

## Alcance diferido

RabbitMQ, Redis, Firebase real, email, SMS, persistencia, observabilidad avanzada, alta disponibilidad, CI/CD de producción y despliegue cloud no se implementan en esta branch ni en AE1 para RF-8.1, salvo requerimiento posterior explícito.

## Git

El trabajo de RF-8.1 se realiza únicamente en `feature/m8-r81-notifications-grupo6`. No se realizan commits directamente sobre `main` ni se modifican branches de otros grupos.
