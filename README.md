# p3-ae1-2026
Paradigmas 3 AE1 2026 - Grupo 5 - M2

## M2: Clientes

Implementación del módulo M2 para los requisitos RF-2.1, RF-2.3 y RF-2.5:

- **RF-2.1 Perfil de cliente:** alta (asociada al `userId` de M1 vía token JWT), consulta y actualización de preferencias. El nombre, teléfono y correo pertenecen a M1 y no se duplican en M2.
- **RF-2.3 Historial de viajes:** consulta del listado de viajes consumiendo la API de M6 por `userId`, reenviando el token del usuario, sin acceso directo a su base de datos. Respuesta degradada vacía si M6 no está disponible.
- **RF-2.5 Estado de cuenta:** consulta con recálculo automático de bloqueos según penalizaciones vigentes de Soporte; cambio manual por el dueño del perfil. Los clientes nunca se eliminan: la baja se registra con el estado `INACTIVO`.

---

## Imágenes Docker Hub

Las imágenes publicadas están disponibles en:

- [Backend M2](https://hub.docker.com/r/leangau/m2-perfilhistorialestado/tags?name=api)
- [Frontend M2](https://hub.docker.com/r/leangau/m2-perfilhistorialestado/tags?name=client)

```bash
docker pull leangau/m2-perfilhistorialestado:api
docker pull leangau/m2-perfilhistorialestado:client
docker image ls leangau/m2-perfilhistorialestado
```

---

## Ejecutar los tests

### Paso 1 — Clonar el repositorio

Presione F1 en VS Code, escriba `Git: Clone`, pegue:

```
https://github.com/cuencadelplata/p3-ae1-2026.git
```

Cambie a la rama `M2-PerfilHistorialEstado`.

### Paso 2 — Tests unitarios (sin Docker)

```bash
npm install
npm test
npm run build
```

### Paso 3 — Tests E2E (requiere Docker)

```bash
docker compose up -d
npx playwright install chromium
npm run test:e2e
docker compose down
```

La suite unitaria e integración no requiere Docker. Los tests E2E requieren que la API, PostgreSQL, Redis y el cliente estén disponibles. La definición actual de Compose descarga las imágenes publicadas; `npm run build` valida el código local.

---

## Variables de entorno

Los valores siguientes son los defaults de desarrollo; las credenciales reales deben inyectarse fuera del repositorio.

| Variable | Default de desarrollo | Uso |
| --- | --- | --- |
| `PORT` | `3000` | Puerto HTTP de M2. |
| `DB_HOST` / `DB_PORT` | `localhost` / `5433` fuera de Docker; `db-profiles` / `5432` dentro | PostgreSQL de perfiles. |
| `DB_USER` / `DB_PASSWORD` / `DB_NAME` | `postgres` / `postgres` / `profiles` | Credenciales de PostgreSQL local. |
| `DB_CONNECTION_TIMEOUT_MS` | `2000` | Límite para abrir una conexión. |
| `DB_QUERY_TIMEOUT_MS` / `DB_STATEMENT_TIMEOUT_MS` | `3000` / `3000` | Límite de consultas y sentencias. |
| `DB_IDLE_TIMEOUT_MS` | `30000` | Tiempo de inactividad del pool. |
| `REDIS_URL` | `redis://localhost:6379` | Redis para caché de perfiles y validación de tokens. |
| `CUSTOMER_CACHE_TTL_SECONDS` | `300` | TTL de la caché del perfil consultado por ID. |
| `M1_SERVICE_URL` | `http://localhost:3000/__stubs/m1` (con stubs) | URL del validador de identidad de M1. |
| `SOPORTE_SERVICE_URL` | `http://localhost:3000/__stubs/soporte` (con stubs) | URL de penalizaciones de soporte. |
| `M6_SERVICE_URL` | `http://localhost:3000/__stubs/m6` (con stubs) | URL del servicio de viajes. |
| `STUBS_ENABLED` | `false` | Monta los stubs locales solo cuando vale literalmente `true`. |
| `M1_JWT_SECRET` | Solo default de desarrollo del stub | Secreto HS256 del stub de M1; no usar el default en un entorno compartido. |
| `SOPORTE_SECRET_KEY` | `secret-m2` | Clave de servicio que M2 envía a Soporte (header `X-Secret-Key`). |
| `STATUS_SECRET_KEY` | `secret-status` | Clave que aceptan módulos internos en `GET /status` (header `X-Secret-Key`). |
| `PENALIZACIONES_TEMPORAL` | `2` | Penalizaciones vigentes para disparar `BLOQUEADO_TEMPORAL`. |
| `PENALIZACIONES_PERMANENTE` | `3` | Penalizaciones vigentes para disparar `BLOQUEADO_PERMANENTE`. |
| `SERVICE_RETRY_AFTER_SECONDS` | `10` | Valor de `Retry-After` para un `503`. |

Cuando `STUBS_ENABLED=false`, M2 usa las URLs de los módulos reales. Con `STUBS_ENABLED=true`, los stubs se montan bajo `/__stubs/{m1,soporte,m6}` para pruebas locales; sus endpoints de diagnóstico y caos son operativos y no forman parte de `/openapi.json`.

La validación de identidad usa el bearer JWT de M1 (HS256, duración de una hora, payload `{ userId, role, iat, exp }`). M2 conserva en Redis la respuesta de validación en `auth:token:{sha256}` durante el menor de cinco minutos y el tiempo restante del token. Un token ausente o inválido responde `401`; un rol distinto de `CLIENTE` o un perfil ajeno responde `403`; un userId que ya tiene perfil responde `409 ProfileAlreadyExists`; si M1 o PostgreSQL no están disponibles responde `503` con el header `Retry-After`. Redis caído degrada las cachés y M2 continúa consultando M1 o PostgreSQL. Una caída de M1 no se interpreta como token inválido.

---

## Endpoints

La especificación completa e interactiva se encuentra en `/docs` una vez levantado el servidor.

Todos los endpoints marcados con 🔒 requieren:
```
Authorization: Bearer <token>
```
El token es emitido por M1 (Auth). M2 lo valida llamando a `GET /auth/validar-identidad-y-rol` de M1.

| Método | Ruta | Auth | RF | Descripción |
|---|---|---|---|---|
| `POST` | `/v1/customers` | 🔒 CLIENTE | RF-2.1 | Crear perfil (body: preferencias opcionales) |
| `GET` | `/v1/customers/me` | 🔒 | RF-2.1 | Perfil del usuario autenticado; 404 si no existe |
| `GET` | `/v1/customers` | Abierto (🔒 con `?userId=`) | — | Listar clientes |
| `GET` | `/v1/customers/:id` | 🔒 | RF-2.1 | Perfil por ID interno; `X-Data-Source: database` o `cache` |
| `PUT` | `/v1/customers/:id` | 🔒 dueño | RF-2.1 | Actualizar preferencias |
| `GET` | `/v1/customers/:id/status` | 🔒 o `X-Secret-Key` | RF-2.5 | Estado de cuenta (recalcula con Soporte) |
| `PUT` | `/v1/customers/:id/status` | 🔒 dueño | RF-2.5 | Cambiar estado (baja, bloqueo, etc.) |
| `GET` | `/v1/customers/:id/trips` | 🔒 | RF-2.3 | Historial de viajes (via M6) |

El `POST` acepta body vacío o solo `preferences`; sin preferencias aplica `auto` y `email`. El `customerId` interno tiene formato `cust_xxx`. El perfil se devuelve sin datos personales de M1:

```json
{
  "customerId": "cust_823a7b9c",
  "userId": 12,
  "preferences": { "preferredVehicleType": "auto", "notificationChannel": "email" },
  "status": "ACTIVO",
  "createdAt": "2026-10-04T18:00:00.000Z"
}
```

### Códigos de respuesta comunes

| Código | Significado |
|---|---|
| `401` | Sin token o token inválido |
| `403` | Rol incorrecto o el token no pertenece al dueño del recurso |
| `404` | Recurso no encontrado |
| `409` | Ya existe un perfil para ese usuario (`ProfileAlreadyExists`) |
| `503` | PostgreSQL o M1 no disponible. Header `Retry-After` indica cuántos segundos esperar; si el circuito está abierto, indica el tiempo hasta volver a probar. **M1 caído nunca devuelve 401.** |
| `500` | Error inesperado con respuesta genérica; los detalles internos quedan solo en los logs. |

Las respuestas de error siguen `{ "error": "...", "message": "..." }`; los errores de validación pueden incluir `details`.

### Salud y métricas

`GET /health` es público y expone PostgreSQL, Redis y las dependencias registradas, además de los circuit breakers. PostgreSQL es crítico: su caída devuelve `503 DEGRADED`. Redis es no crítico: su caída devuelve `200 DEGRADED`. El registro permite agregar los módulos externos como dependencias no críticas. `GET /metrics` es público y devuelve métricas Prometheus de HTTP, circuit breakers y caché. Los logs estructurados incluyen `requestId` para correlacionar cada solicitud y sus errores.

---

## Lógica de estado de cuenta (RF-2.5)

`GET /v1/customers/:id/status` recalcula el estado en cada consulta:

1. Llama a Soporte (`GET /usuarios/{userId}/penalizaciones`) reenviando el token del usuario.
2. Aplica los umbrales (`PENALIZACIONES_TEMPORAL`, `PENALIZACIONES_PERMANENTE`).
3. Si el nuevo estado difiere del guardado, lo persiste.
4. **Si Soporte está caído** → devuelve el último estado guardado sin error (degradación elegante).

Regla de desbloqueo automático: solo los bloqueos con `blockOrigin = AUTOMATICO` pueden revertirse solos cuando bajan las penalizaciones. Los bloqueos `MANUAL` (aplicados vía `PUT /status`) son intocables por este mecanismo.

---

## Stubs de módulos externos

Con `STUBS_ENABLED=true` se montan en el mismo proceso:

| Ruta base | Módulo | Modo caos |
|---|---|---|
| `/__stubs/m1` | Auth (M1) — creado por Erwin | `POST /__stubs/m1/__chaos` |
| `/__stubs/soporte` | Soporte (penalizaciones) | `POST /__stubs/soporte/__chaos` |
| `/__stubs/m6` | Viajes (M6) | `POST /__stubs/m6/__chaos` |

**Modo caos** (útil para probar resiliencia):
```json
{ "mode": "down" }      // ECONNRESET — simula servicio caído
{ "delayMs": 6000 }     // Respuesta lenta — prueba timeout
{ "failRate": 1 }       // Siempre 500 — abre circuit breaker
{}                      // Vuelve a la normalidad
```

**Datos fijos del stub de Soporte:**

| userId | Penalizaciones | Estado esperado |
|---|---|---|
| 12 | 0 | ACTIVO |
| 13 | 1 | ACTIVO (< umbral temporal) |
| 14 | 3 | BLOQUEADO_PERMANENTE |
| 15 | 5 | BLOQUEADO_PERMANENTE |

---

## Contratos con APIs externas

M2 consume (no provee) estos endpoints:

```
M1:      GET /auth/validar-identidad-y-rol   Authorization: Bearer <jwt>
         → 200 { valid, userId, role } | 401

Soporte: GET /usuarios/{userId}/penalizaciones   Authorization: Bearer <jwt>
         → 200 { userId, total, penalizaciones: [...] }

M6:      GET /v1/trips?userId={id}   Authorization: Bearer <jwt>
         → 200 { userId, tripsCount, trips: [...] }
```

M2 es consumido por:
- **M8 (Notificaciones):** `GET /v1/customers?userId=` con token de usuario.
