# ADR-002: Arquitectura Orientada a Eventos Asíncronos con RabbitMQ

- **Estado:** Aprobado / Implementado
- **Fecha:** 2026-10-05
- **Autor:** Matias Costantini
- **Módulo:** Módulo 5 (Solicitud y Despacho)
- **Requerimientos asociados:** RF-5.5, RNF-07, RNF-08

---

## 1. Contexto y Problema

Cuando una solicitud de viaje es aceptada y asignada a un conductor, múltiples subsistemas deben ser notificados sin acoplar temporalmente ni bloquear la respuesta HTTP del conductor:
- **Módulo 8 (Notificaciones):** Requiere enviar push/email/SMS al cliente informando que el conductor viene en camino.
- **Otros módulos consumidores:** Auditoría, analítica y monitoreo en tiempo real.

Una comunicación síncrona HTTP directa generaría un acoplamiento fuerte, lentitud en la respuesta al conductor y propagación de errores si los servicios de notificación estuvieran temporalmente sobrecargados.

---

## 2. Alternativas Evaluadas

### Alternativa A: Llamadas HTTP Síncronas en Cadena
- **Contras:** Aumenta la latencia percibida por el conductor, riesgo de fallos en cascada y fuerte acoplamiento temporal.

### Alternativa B: Cola Punto a Punto Simple (`dispatch.assigned`)
- **Contras:** Limita el consumo a un único destinatario; agregar nuevos consumidores requeriría modificar el código de M5.

### Alternativa C: Exchange Topic (`mobility.events`) con Envelope Estándar de Evento — *Seleccionada*
- **Pros:**
  - Desacoplamiento total entre productores y consumidores mediante el patrón *Publish/Subscribe*.
  - Módulo 8 y cualquier futuro consumidor pueden enlazar sus propias colas utilizando routing keys temáticas (`driver.offer.accepted`, `trip.assigned`).
  - Payload estandarizado con metadatos de trazabilidad (`messageId`, `correlationId`, `occurredAt`, `producer: "m5"`).

---

## 3. Decisión Adoptada

Se configuró en [`RabbitMqService`](file:///c:/Users/matia/OneDrive/Documentos/Facultad/3er%20a%C3%B1o/Paradigmas%20III/Proyectos/AE2/p3-ae1-2026/modulo-5/src/services/rabbitmq.service.ts):

1. **Exchange:** `mobility.events` de tipo `topic` (durable).
2. **Routing Key:** `driver.offer.accepted`.
3. **Envelope Estándar:**
   ```json
   {
     "messageId": "msg_...",
     "eventType": "driver.offer.accepted",
     "version": "1.0",
     "occurredAt": "2026-10-05T10:00:00.000Z",
     "correlationId": "req_...",
     "producer": "m5",
     "data": {
       "rideRequestId": "req_...",
       "offerId": "offer_...",
       "clientUserId": 123,
       "driverUserId": 456,
       "origin": { "latitude": -27.45, "longitude": -58.98, "address": "Av. Costanera 1234" },
       "destination": { "latitude": -27.47, "longitude": -58.99, "address": "San Juan 500" },
       "vehicleType": "AUTO",
       "fare": { "amount": 2500, "currency": "ARS" }
     }
   }
   ```
4. **Resiliencia:** Almacén en memoria con eventos en buffer ante desconexión temporal del broker RabbitMQ.

---

## 4. Consecuencias

- **Positivas:**
  - Latencia de respuesta en la aceptación de ofertas menor a 15ms.
  - M8 puede escalar sus trabajadores de notificación de forma totalmente independiente.
- **Compromisos:**
  - Los consumidores deben implementar procesamiento idempotente basándose en `messageId` o `rideRequestId`.
