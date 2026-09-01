# Backlog M9

## Alcance implementado

- [x] Inicializar TypeScript + Node.js 22, Express y Docker.
- [x] Conectar el proyecto Supabase existente.
- [x] Auditar tabla, columnas, tipos, constraints, índices, enums, funciones, triggers, grants y RLS.
- [x] Generar tipos TypeScript desde el esquema real.
- [x] Implementar repositorio Supabase y mapeo de dominio.
- [x] Implementar POST, GET listado, GET por ID, PATCH y DELETE lógico.
- [x] Validar UUID, origen/destino, vehículo, fecha futura y DTOs estrictos con Zod.
- [x] Restringir modificación/cancelación a `PROGRAMADA`.
- [x] Crear M7 stub e integrar tarifa con degradación controlada.
- [x] Implementar scheduler basado en filas persistidas.
- [x] Proteger `PROGRAMADA → ACTIVANDO` con update atómico condicionado.
- [x] Crear M5 stub e integrar activación.
- [x] Implementar estado `FALLIDA` ante error M5.
- [x] Agregar pruebas de API, servicios, repositorio, stubs, scheduler y concurrencia.
- [x] Documentar OpenAPI, arquitectura, fechas, riesgos y esquema real.
- [x] Completar Compose con M9 + M5 stub + M7 stub.

## Mejoras no bloqueantes

- [ ] Integrar autenticación HTTP y derivar `clienteId` de una identidad confiable.
- [ ] Revocar `EXECUTE` de `public.rls_auto_enable()` para `anon`/`authenticated` si no es intencional.
- [ ] Optimizar políticas RLS usando `(select auth.uid())`.
- [ ] Medir y, si corresponde, migrar un índice `(estado, fecha_hora_programada)`.
- [ ] Diseñar reconciliación de reservas detenidas en `ACTIVANDO`.
- [ ] Acordar idempotencia con M5 antes de agregar reintentos automáticos.
- [ ] Incorporar métricas, trazas, logs estructurados y alertas para el scheduler.
- [ ] Ejecutar la suite live en CI con secretos aislados y proyecto de pruebas.
- [ ] Preparar evidencias finales AE1.

Los cambios de esquema pendientes requieren una migración revisada por el equipo; no se aplicaron durante esta implementación.
