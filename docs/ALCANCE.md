# Alcance individual propuesto

**Escenario:** movilidad urbana tipo Uber. **Responsabilidad:** M2 Clientes, RF-2.2 Direcciones frecuentes. **Versión:** 2.2.0. **Fecha de preparación:** 5 de octubre de 2026.

La consigna AE2 describe RF-2.2 en página 27 y pide alcance acotado, integración, datos propios, contratos, Redis, mensajería, concurrencia, pruebas y evidencia individual (páginas 9–12). El ZIP aportado contiene RF-2.4, no RF-2.2. Se mantiene su tecnología y funcionalidad y se agrega RF-2.2 en el mismo servicio.

| Exigencia aplicable | Solución entregada | Evidencia |
|---|---|---|
| RF-2.2 favoritos y recientes | CRUD de favoritos, recepción de viajes, promoción de recientes | routes/service; tests/integration.test.cjs |
| Arquitectura y responsabilidades | API/worker M2 y simuladores M4/M6/M8 separados | ARQUITECTURA.md; Compose |
| RNF-03 contenedores | Dockerfile y Compose con migración inicial | Compose y recorrido local verificados |
| RNF-04 datos propios | CustomerDB exclusiva; referencias externas sin FK a tablas ajenas | Prisma; ADR-01 |
| RNF-05 contratos | OpenAPI de M2 e integraciones; catálogo de eventos | docs/openapi*.json; EVENTOS.md |
| RNF-06 Redis | Cache de lista por cliente, TTL e invalidación versionada | test cache/expiración |
| RNF-07 dos flujos RabbitMQ | Viaje completado y cambio de favorita | worker, mocks M6/M8; test:stack |
| RNF-08 idempotencia | Clave HTTP, inbox + viajeId, M8 por eventId | pruebas de repetición |
| RNF-09 carrera realista del alcance | Altas duplicadas y ediciones perdidas | unique + SERIALIZABLE + If-Match |
| RNF-10/11 identidad/configuración | Validaciones, aislamiento, credencial demo, variables | auth; setup; pruebas HTTP |
| RNF-13 correlación | Correlation ID HTTP → outbox → mensaje | logs JSON sin dirección/token |
| RNF-16 salud | liveness, readiness DB, Redis y heartbeat worker | app.ts |
| RNF-17 pruebas/regresión | Unitarias e integración; RF-2.4 conservado | PRUEBAS.md |
| Integración externa pertinente | Geocodificación HTTP simulada | M4 y prueba 503 |
| Git/Portafolio | Hash y manifiesto de base, matriz y plantillas | Completar con repo y evidencia personal |

## Límites explícitos

- No se implementan todos los RF de M2 ni los ocho módulos.
- No se implementan despacho, doble cobro ni finalización de viajes: son responsabilidades ajenas. La carrera elegida es creación simultánea de la misma favorita y actualización con versiones.
- No se generan QR, pagos ni PDF de viajes. Las páginas 35–36 describen esos elementos en el escenario general; la página 11 condiciona integraciones al alcance seleccionado. Esta interpretación necesita aprobación docente del alcance RF-2.2; no equivale a una aprobación ya concedida.
- M4, M6 y M8 son simuladores de contratos, no entregas completas de esos módulos. Tampoco se afirma que hayan sido aprobados por cátedra.
- RF-2.4 se conserva para demostrar evolución/regresión de la base, no como trabajo nuevo atribuible al alumno.
- Interfaz: API y clientes REST; no se incluyó una aplicación web de pasajeros.

**Por completar por el alumno:** nombre/DNI, repositorio y branch, referencia oficial de AE1 y constancia del alcance acordado con la cátedra.



## Reutilización RF-2.4 → RF-2.2 (v2.2.0)

Se comparte el cliente HTTP de M6, su URL y manejo de fallos. RF-2.2 conserva direcciones textuales y parejas de viajes propios completados; su endpoint de sugerencias propone B → A y permite usar cualquier dirección para ambos extremos. No requiere calificar ni inventa coordenadas. Los datos se guardan en CustomerDB para consulta sin M6/Internet. Ver INTEGRACION-M6.md para configuración, límites del contrato recibido y política de fechas.
