# ADR-004: Patrón de Integración Resiliente y Fallback Local para Servicios Externos

- **Estado:** Aprobado / Implementado
- **Fecha:** 2026-10-05
- **Autor:** Matias Costantini
- **Módulo:** Módulo 5 (Solicitud y Despacho)
- **Requerimientos asociados:** RF-5.1, RF-5.5, RNF-14, RNF-16

---

## 1. Contexto y Problema

En un ecosistema distribuido de microservicios (M1, M4, M5, M6, M7, M8), los servicios externos pueden experimentar caídas temporales, latencias de red o estar apagados durante pruebas unitarias locales. M5 no debe quedar bloqueado indefinidamente ni fallar de manera catastrófica (*cascading failure*).

---

## 2. Decisión Adoptada

Para cada integración síncrona HTTP externa se aplicó un patrón unificado de **Timeout Explícito + Fallback Resiliente**:

### 1. Integración con M7 (Estimación de Tarifas - `fetchEstimatedFareFromM7`)
- **Llamada:** `POST ${M7_SERVICE_URL}/tarifa/estimacion`
- **Timeout:** 3.000 ms (`AbortSignal.timeout(3000)`).
- **Fallback:** Si M7 no responde o arroja error, se aplica una estimación algorítmica local basada en la distancia euclidiana/Haversine y tarifas base por tipo de vehículo (`AUTO` vs `MOTO`), logueando advertencia sin interrumpir la creación de la solicitud.

### 2. Integración con M6 (Gestión de Viajes - `notifyM6TripAssigned`)
- **Llamada:** `POST ${M6_SERVICE_URL}/api/viajes` seguido de `POST /api/viajes/:id/asignar`.
- **Timeout:** 3.000 ms.
- **Fallback:** Si M6 no está disponible en el entorno local, se registra el evento en PostgreSQL y se continúa con el flujo interno de M5.

### 3. Integración con M4 (Conductores Cercanos - `fetchNearbyDriversFromM4`)
- **Llamada:** Stub local determinista con conductores candidatos por tipo de vehículo (`AUTO` / `MOTO`), listo para conectarse al endpoint HTTP de M4 una vez publicado.

---

## 3. Consecuencias

- **Positivas:**
  - Tolerancia a fallos: M5 puede funcionar tanto en modo completamente integrado como en modo autónomo / offline.
  - Reproducibilidad garantizada: Los 87 tests unitarios ejecutan en cualquier máquina sin necesidad de levantar los 8 contenedores simultáneamente.
- **Compromisos:**
  - El fallback genera estimaciones heurísticas cuando el servicio tarifario especializado no está en línea.
