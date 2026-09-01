# Documentación del proyecto

Esta carpeta contiene la documentación utilizada para el desarrollo del proyecto AE1 de Paradigmas III.

## Prioridad de documentación

En caso de existir diferencias entre documentos, utilizar el siguiente orden de prioridad:

1. `references/ISI-Paradigmas3-AE1-Escenario-MovilidadUrbana-2026.pdf`
   - Documento oficial de la cátedra.
   - Principal fuente de requerimientos funcionales y no funcionales.

2. `references/Sprint1-AE1-30_08.pdf`
   - Contiene las decisiones tomadas por el Grupo 6 para M8 durante Sprint 1.

3. `m8/alcance-m8.md`
   - Define los límites y responsabilidades del Módulo 8 y del Grupo 6.

4. `m8/decisiones-tecnicas.md`
   - Registra las decisiones técnicas adoptadas para el desarrollo.

5. `m8/rf82-qr.md`
   - Especifica el comportamiento esperado de RF-8.2.

6. `api/openapi.yaml`
   - Contrato REST que deberá respetar la implementación.

7. `m8/entrega-ae1.md`
   - Guía de verificación y evidencias para la entrega.

Los demás documentos dentro de `references/` se consideran material complementario o histórico.

## Módulo seleccionado

M8 — Notificaciones, Documentos y Soporte.

## Grupo 6

Requerimientos asignados:

- RF-8.1 — Notificaciones de viaje.
- RF-8.2 — QR de verificación.

## Trabajo actual

El trabajo de esta branch corresponde exclusivamente a:

**RF-8.2 — QR de verificación.**

Branch:

`feature/m8-r82-qr-grupo6`

RF-8.1 se desarrolla independientemente y posteriormente ambas funcionalidades deberán integrarse como parte del mismo servicio M8.

## Regla principal

M8 no administra directamente:

- viajes;
- clientes;
- conductores;
- tarifas;
- pagos.

M8 recibe información proveniente de otros servicios y ejecuta únicamente las responsabilidades propias de Notificaciones, Documentos y Soporte.

Para RF-8.2, M8 genera y valida el mecanismo de verificación.

M6 continúa siendo responsable de decidir y ejecutar el inicio del viaje.