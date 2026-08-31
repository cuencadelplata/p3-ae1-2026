# Instrucciones de desarrollo

## Contexto del proyecto

Este repositorio corresponde al proyecto AE1 de Paradigmas III.

Antes de realizar cambios, consultar la documentación disponible en `/docs`.

El documento oficial de la cátedra ubicado en `/docs/references` tiene prioridad ante cualquier contradicción.

## Alcance actual

El trabajo actual corresponde al Módulo 8 — Notificaciones, Documentos y Soporte.

Grupo 6:

- RF-8.1 — Notificaciones de viaje.
- RF-8.2 — QR de verificación.

En la branch `feature/m8-r81-notifications-grupo6` trabajar únicamente sobre RF-8.1.

No modificar funcionalidades correspondientes a otros módulos o grupos.

No realizar cambios ni commits directamente sobre `main`.

## Forma de trabajo

Antes de implementar una funcionalidad:

1. Analizar el requerimiento.
2. Revisar la documentación relacionada.
3. Verificar el contrato de API.
4. Identificar responsabilidades y límites.
5. Implementar solamente lo necesario.
6. Crear o actualizar las pruebas correspondientes.
7. Ejecutar las verificaciones disponibles.
8. Revisar que el cambio no introduzca funcionalidades fuera de alcance.

## Diseño

Aplicar buenas prácticas de diseño de software.

Priorizar:

- responsabilidad única;
- alta cohesión;
- bajo acoplamiento;
- separación entre HTTP y lógica de negocio;
- dependencias claras;
- nombres descriptivos;
- código simple y legible.

Aplicar principios SOLID cuando sean pertinentes.

No introducir patrones de diseño únicamente para demostrar su uso.

Utilizar un patrón solamente cuando resuelva un problema concreto y simplifique la evolución del sistema.

Evitar:

- sobrearquitectura;
- abstracciones prematuras;
- clases o interfaces innecesarias;
- duplicación de lógica;
- archivos excesivamente grandes;
- lógica de negocio dentro de controllers;
- dependencias entre módulos que no estén justificadas.

## API

Trabajar con enfoque Design-First / Contract-First.

La especificación OpenAPI es el contrato de la API.

No implementar un endpoint que contradiga el contrato aprobado.

Si el contrato necesita modificarse, explicar primero el motivo antes de cambiarlo.

Mantener:

- códigos HTTP apropiados;
- validación de entradas;
- respuestas consistentes;
- manejo uniforme de errores.

## Arquitectura

M8 no administra viajes, usuarios ni pagos.

No incorporar responsabilidades correspondientes a otros módulos.

Durante esta etapa utilizar mocks únicamente para representar información externa todavía no integrada.

Los mocks no deben reemplazar la lógica propia de M8.

## Calidad

Todo cambio debe considerar:

- mantenibilidad;
- extensibilidad;
- testabilidad;
- seguridad;
- rendimiento razonable;
- manejo de errores;
- claridad del código.

No optimizar prematuramente.

## Pruebas

Toda lógica de negocio nueva debe tener pruebas cuando corresponda.

Priorizar:

- pruebas unitarias para lógica de negocio;
- pruebas de integración para endpoints y componentes relacionados.

Agregar pruebas E2E solamente cuando aporten valor al flujo que se está implementando.

Antes de considerar una tarea terminada:

- ejecutar las pruebas disponibles;
- verificar lint si existe;
- verificar compilación/typecheck si existe;
- informar cualquier prueba que no pueda ejecutarse.

Nunca eliminar o debilitar una prueba únicamente para hacer que el código pase.

## Seguridad

No exponer:

- contraseñas;
- tokens;
- secretos;
- credenciales;
- información sensible.

No hardcodear secretos.

Validar todos los datos externos antes de utilizarlos.

## Git

No cambiar de branch sin indicación.

No realizar commits automáticamente salvo que se solicite explícitamente.

No hacer push automáticamente salvo que se solicite explícitamente.

No modificar `main`.

No modificar branches pertenecientes a otros grupos.

Antes de realizar cambios verificar la branch actual.

## Principio general

Preferir la solución más simple que cumpla correctamente el requerimiento y permita evolucionar posteriormente.

No agregar funcionalidades que no hayan sido solicitadas o justificadas por los requerimientos.