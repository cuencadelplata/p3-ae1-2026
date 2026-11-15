# Datos que administra el Módulo 5 y justificación de su persistencia

Alcance: RF-5.1 (Solicitud de viaje). Referencias de la consigna: AE2 p.11, RNF-04.
Principio: M5 solo guarda **sus propios datos**. De los demás módulos conserva a lo sumo un
identificador o una copia de lo que ellos le respondieron; **nunca consulta tablas de otros servicios**.

## 1. Datos propios de M5

| Dato | Qué es | Dónde vive | Duración | Por qué ahí |
| :--- | :--- | :--- | :--- | :--- |
| **Solicitud de viaje** (`RideRequest`) | `id`, `clientId`, origen, destino, `vehicleType`, `status`, tarifa estimada (copia), `assignedDriverId`, `idempotencyKey`, `createdAt/updatedAt/expiresAt`, datos de cancelación | Memoria del proceso (`Map`) + persistencia en Redis (`m5:request:<id>`) | 24 h en Redis / memoria en runtime | Es el dato central del negocio de M5. Se persiste en Redis para sobrevivir reinicios (CP-5.1-14) |
| **Registro de idempotencia** | Clave opaca (hash de `clientId + Idempotency-Key`) → solicitud creada | Redis (`m5:idempotency:<hash>`) | 24 h (TTL) | Es temporal: solo sirve mientras el cliente pueda reintentar. Redis expira solo y se comparte entre réplicas |
| **Candado de cliente activo** | `clientId` → id de su solicitud en curso | Redis (`m5:active_client:<clientId>`), `SET NX EX 180` | 180 s (TTL) o hasta cancelar/asignar | Debe ser atómico y rápido para evitar dos solicitudes simultáneas del mismo cliente |
| **Caché de tarifa** | Respuesta de M7 para un mismo origen/destino/vehículo | Redis (`m5:fare_cache:*`) | 60 s (TTL) | Evita consultar a M7 por cada reintento; si se pierde no pasa nada |
| **Evento `ride.requested`** | Aviso de solicitud creada | RabbitMQ, exchange `mobility.events` | Hasta que se consume | Comunicación asíncrona: M5 publica y no depende de quién escuche |

## 2. Lo que M5 NO administra

| Dato | Dueño | Cómo lo usa M5 |
| :--- | :--- | :--- |
| Usuarios, credenciales, roles | M1 (Identidad) | Solo recibe el identificador del usuario dentro del token (`sub`). No lee la base de M1 |
| Reglas y cálculo de tarifas | M7 | Pide una estimación por HTTP (`POST /tarifa/estimacion`) y guarda **una copia** de la respuesta dentro de la solicitud |
| Posición y disponibilidad de conductores | M4 | Lo consulta por API (RF-5.2); no guarda posiciones |
| Viaje en curso, finalizado, cobro | M6 / M7 | Fuera del alcance de RF-5.1 |
| Notificaciones y comprobantes | M8 | Solo se les publica el evento; M5 no accede a sus datos |

`clientId` y `assignedDriverId` son **referencias por id** a entidades de otros módulos, sin claves
foráneas ni joins entre servicios.

## 3. Persistencia: justificación de la arquitectura elegida

1. **Persistencia efímera y de estado activo (Redis):**
   - Para el ciclo de vida de la solicitud activa, la idempotencia y el candado atómico (`SET NX EX`), Redis opera en memoria con submilisegundos de latencia.
   - En Docker Compose cuenta con persistencia y volumen montado, lo que asegura que ante reinicios del contenedor M5 las solicitudes (`m5:request:<id>`) se recuperen limpiamente cumpliendo **CP-5.1-14**.

2. **Persistencia transaccional e histórica (PostgreSQL):**
   - Para el almacenamiento a largo plazo de viajes finalizados y auditoría inmutable (RNF-04), el módulo cuenta con PostgreSQL (`dispatch_db`).
   - M5 mantiene bases desacopladas por servicio: ningún otro módulo accede a las tablas de M5 directamente.
