# M7: Tarifas, Pagos y Liquidaciones (AE2 Integrado)

Backend unificado que consolida todos los requerimientos funcionales del **Módulo 7**, orquestado con **Docker Compose** e implementando el patrón de diseño **Circuit Breaker** para resiliencia ante caídas de Backing Services.

---

## 📋 Requerimientos Cubiertos (RF-7.1 al RF-7.7)

| RF | Requerimiento | Endpoints / Eventos | Implementación |
|---|---|---|---|
| **RF-7.1** | Estimación de tarifa | `POST /tarifa/estimacion` | Cálculo según distancia, tiempo y tipo de vehículo (auto/moto). |
| **RF-7.2** | Registro de método de pago | `POST /metodo-pago`, `GET /metodo-pago/:viajeId` | Gestión de efectivo, tarjeta y transferencia en estado pendiente. |
| **RF-7.3** | Autorización de pago | `POST /metodo-pago/:viajeId/autorizar`, `rechazar` | Integración y autorización con mock de pasarela (Mercado Pago). |
| **RF-7.4** | Cargo por cancelación | `POST /cancelacion/cargo` | Reglas de gracia (120s), cancelación por conductor ($0) y penalizaciones. |
| **RF-7.5** | Prevención de pagos duplicados | `GET /pagos/:idOrden/duplicado` | Idempotencia rápida con Redis y persistencia de respaldo en PostgreSQL. |
| **RF-7.6** | Reintegro por viaje cancelado | `POST /reintegro`, Consumer RabbitMQ | Reintegro del 95% ante eventos de cancelación publicados por M6. |
| **RF-7.7** | Historial financiero | `GET /operations`, `POST /operations`, `PATCH /operations/:id/status` | Trazabilidad completa con persistencia en PostgreSQL / memoria. |

---

## 🛡️ Patrón de Diseño: Circuit Breaker (Disyuntor)

Para evitar sobrecargar servicios caídos o bloquear la aplicación con esperas infinitas, se implementó el patrón **Circuit Breaker** en `src/patrones/circuitBreaker.ts`:

1. **Estado CLOSED (Normal)**:
   - Las consultas a Redis o al servicio de cancelación se ejecutan normalmente.
2. **Estado OPEN (Disparado ante caídas)**:
   - Al detectar fallos consecutivos (por ejemplo si se ejecuta `docker stop redis`), el circuito se **abre inmediatamente** (*fail-fast*).
   - **Degradación elegante / Fallback**: No se bloquea la API con timeouts ni se bombardea el servicio con reintentos; el sistema desvía el flujo automáticamente a **PostgreSQL** o memoria.
   - En el endpoint `GET /health` se puede visualizar el estado en vivo de los circuitos (`OPEN` / `CLOSED`).
3. **Estado HALF-OPEN (Reconexión inteligente)**:
   - Tras un tiempo de enfriamiento (cooldown de 15s), el circuito permite una prueba. Si el servicio fue levantado (`docker start`), el circuito se **cierra** y regresa a operación normal.

---

## 🚀 Cómo Ejecutar con Docker Compose

Levanta la base de datos PostgreSQL, Redis, RabbitMQ y la aplicación completa en un solo comando:

```bash
docker compose up --build
```

- **API y Documentación interactiva (Scalar)**: `http://localhost:3000/docs`
- **Healthcheck y estado de Circuit Breakers**: `http://localhost:3000/health`
- **Panel de control de RabbitMQ**: `http://localhost:15672` (usuario: `guest`, contraseña: `guest`)
- **Base de datos PostgreSQL**: puerto `5432` (db: `historial`, user: `postgres`, pass: `postgres`)

Para detener los servicios:
```bash
docker compose down
```

---

## 🧪 Pruebas en Vivo para la Presentación

### 1. Demostración de Resiliencia y Circuit Breaker (Apagar Backing Services):

1. Con todo levantado, verifica la salud:
   ```bash
   curl http://localhost:3000/health
   # Respuesta: {"status":"ok", "circuitos":{"redis":"CLOSED", ...}}
   ```
2. Simular la caída de Redis:
   ```bash
   docker stop m7-redis
   ```
3. Consultar pagos duplicados o el healthcheck:
   - La API responde inmediatamente sin trabarse porque el Circuit Breaker entra en `OPEN` y consulta directo en PostgreSQL.
4. Volver a levantar Redis:
   ```bash
   docker start m7-redis
   ```
   - El circuito pasa a `HALF-OPEN` y luego regresa a `CLOSED` de forma transparente.

### 2. Ejecutar los tests automatizados:

```bash
# Tests unitarios y validación del Circuit Breaker (Vitest)
npm run test:unit

# Tests de integración y resiliencia completa (Playwright)
npm run test:e2e
```
