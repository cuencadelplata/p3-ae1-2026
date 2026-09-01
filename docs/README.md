# Documentación del proyecto

Esta carpeta contiene la documentación utilizada para el desarrollo del proyecto AE1 de Paradigmas III.

## Prioridad de documentación

En caso de existir diferencias entre documentos, utilizar el siguiente orden de prioridad:

1. `references/ISI-Paradigmas3-AE1-Escenario-MovilidadUrbana-2026.pdf`
   Documento oficial de la cátedra y principal fuente de requerimientos.

2. `references/Sprint1-AE1-30_08.pdf`
   Contiene las decisiones actuales tomadas para el desarrollo del Módulo 8.

3. `m8/alcance-m8.md`
   Define el alcance actual del Módulo 8 y del Grupo 6.

4. `m8/entrega-ae1.md`
   Define los entregables y evidencias requeridas para la entrega actual.

5. `m8/decisiones-tecnicas.md`
   Registra las decisiones técnicas adoptadas para la implementación.

6. `m8/rf81-notificaciones.md`
   Define específicamente el alcance y contrato de RF-8.1.

Los demás documentos ubicados en `references/` se utilizan como material complementario e histórico.

## Módulo actual

M8 — Notificaciones, Documentos y Soporte.

Grupo 6:

- RF-8.1 — Notificaciones de viaje.
- RF-8.2 — QR de verificación.

Responsables:

- Juan Martin Invaldi — RF-8.1.
- Goya Bautista — RF-8.2.

## Branches de trabajo

RF-8.1:

`feature/m8-r81-notifications-grupo6`

RF-8.2:

`feature/m8-r82-qr-grupo6`

Cada requerimiento deberá desarrollarse únicamente dentro de su branch correspondiente.

No realizar cambios ni commits directamente sobre `main`.

## Forma de trabajo

El desarrollo seguirá un enfoque Design-First / Contract-First.

Primero se definirán y revisarán los contratos de la API mediante OpenAPI.

Luego se realizará la implementación respetando dichos contratos.

Antes de realizar cambios en el proyecto también deberán consultarse las instrucciones definidas en:

`AGENTS.md`

## Índice operativo

- [Alcance de M8](m8/alcance-m8.md)
- [Decisiones técnicas](m8/decisiones-tecnicas.md)
- [RF-8.1 - Notificaciones](m8/rf81-notificaciones.md)
- [Guía de entrega AE1](m8/entrega-ae1.md)
- [Contrato OpenAPI de M8](api/openapi.yaml)
