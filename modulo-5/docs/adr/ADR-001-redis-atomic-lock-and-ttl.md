# ADR-001: Gestión de Ofertas Efímeras con TTL y Lock Distribuido Atómico en Redis

- **Estado:** Aprobado / Implementado
- **Fecha:** 2026-10-05
- **Autor:** Matias Costantini
- **Módulo:** Módulo 5 (Solicitud y Despacho)
- **Requerimientos asociados:** RF-5.3, RF-5.4, RF-5.5, RNF-06, RNF-09

---

## 1. Contexto y Problema

En el flujo de despacho de movilidad urbana, una solicitud de viaje puede ser ofertada simultáneamente a múltiples conductores candidatos. Esto introduce dos problemas críticos:

1. **Estado Efímero y Caducidad (TTL):** Las ofertas tienen una vigencia finita (por ejemplo, 30 a 60 segundos). Si un conductor no responde en ese lapso, la oferta debe invalidarse automáticamente sin requerir barridos lentos de base de datos.
2. **Condiciones de Carrera (Race Conditions) y Asignación Única:** Dos o más conductores pueden intentar presionar "Aceptar" exactamente al mismo milisegundo. Solo **uno** debe adjudicarse el viaje, evitando la doble asignación (*double assignment problem*).

---

## 2. Alternativas Evaluadas

### Alternativa A: Bloqueo Pesimista en Base de Datos Relacional (`SELECT ... FOR UPDATE`)
- **Pros:** Transaccionalidad nativa en SQL.
- **Contras:** Alto overhead de I/O a disco en escenarios de alta concurrencia, riesgo de contención de bloqueos y saturación del pool de conexiones PostgreSQL.

### Alternativa B: Control de Concurrencia Optimista con Versiones (`version` column)
- **Pros:** No bloquea conexiones de base de datos.
- **Contras:** Requiere reintentos costosos a nivel de aplicación y no resuelve eficientemente la caducidad por TTL en memoria.

### Alternativa C: Redis con Claves con TTL y Bloqueo Distribuido Atómico (`SET NX EX`) — *Seleccionada*
- **Pros:**
  - Operaciones en memoria con latencias sub-milisegundo.
  - Expiración nativa con TTL en Redis para las ofertas (`dispatch:offer:{offerId}`).
  - Bloqueo de exclusión mutua atómico con `SET dispatch:lock:request:{requestId} {driverId} NX EX {lockTtl}`.
  - Garantiza que solo la primera solicitud en adquirir el lock procede con la asignación; las subsecuentes fallan inmediatamente con `409 Conflict`.

---

## 3. Decisión Adoptada

Se implementó el servicio [`RedisService`](file:///c:/Users/matia/OneDrive/Documentos/Facultad/3er%20a%C3%B1o/Paradigmas%20III/Proyectos/AE2/p3-ae1-2026/modulo-5/src/services/redis.service.ts) con las siguientes características:

1. **Persistencia de ofertas efímeras:** Clave `dispatch:offer:{offerId}` con TTL automático en segundos.
2. **Lock de asignación atómico:** `acquireAssignmentLock(requestId, driverId, ttlSeconds)` ejecutando `SET key value NX EX`.
3. **Liberación e invalidación:** Una vez asignado el viaje, se invalida el resto de las ofertas del viaje y se limpia el estado efímero.
4. **Fallback resiliente:** Si Redis no está disponible en entornos de test local, `RedisService` conmuta automáticamente a un almacén en memoria con temporizadores activos sin interrumpir la ejecución.

---

## 4. Consecuencias

- **Positivas:**
  - Resolución 100% libre de colisiones concurrentes (verificado en pruebas unitarias e integración con múltiples hilos asíncronos).
  - Alivio sustancial de carga sobre la base de datos relacional PostgreSQL.
- **Compromisos (Trade-offs):**
  - Requiere mantener Redis como backing service en alta disponibilidad para entornos productivos.
