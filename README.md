# p3-ae1-2026
Paradigmas 3 AE1 2026 - Grupo 5 - M2

## M2: Clientes

Implementación del módulo M2 para los requisitos RF-2.1, RF-2.3 y RF-2.5:

- **RF-2.1 Perfil de cliente:** alta (asociada al userId de M1 via token JWT), consulta y actualización de preferencias.
- **RF-2.3 Historial de viajes:** consulta del listado de viajes realizados consumiendo M6 por `userId`, reenviando el token del usuario. Respuesta degradada vacía si M6 no está disponible.
- **RF-2.5 Estado de cuenta:** consulta con recálculo automático de bloqueos según penalizaciones vigentes de Soporte; cambio manual de estado por el dueño del perfil. Los clientes nunca se eliminan.

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
```

### Paso 3 — Tests E2E (requiere Docker)

```bash
docker compose up -d
npx playwright install chromium
npm run test:e2e
docker compose down
```

---

## Variables de entorno

| Variable | Default | Descripción |
|---|---|---|
| `PORT` | `3000` | Puerto del servidor |
| `DATABASE_URL` | — | Cadena de conexión PostgreSQL |
| `STUBS_ENABLED` | `false` | Montar stubs internos de M1, Soporte y M6 |
| `M1_SERVICE_URL` | `http://localhost:3000/__stubs/m1` | URL de M1 (Auth) |
| `SOPORTE_SERVICE_URL` | `http://localhost:3000/__stubs/soporte` | URL del módulo de Soporte (penalizaciones) |
| `M6_SERVICE_URL` | `http://localhost:3000/__stubs/m6` | URL del módulo M6 (Viajes) |
| `PENALIZACIONES_TEMPORAL` | `2` | Penalizaciones vigentes para disparar BLOQUEADO_TEMPORAL |
| `PENALIZACIONES_PERMANENTE` | `3` | Penalizaciones vigentes para disparar BLOQUEADO_PERMANENTE |
| `SERVICE_RETRY_AFTER_SECONDS` | `10` | Segundos del header `Retry-After` en respuestas 503 |

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
| `GET` | `/v1/customers` | Abierto | — | Listar clientes; acepta `?userId=` |
| `GET` | `/v1/customers/:id` | 🔒 | RF-2.1 | Perfil por ID interno |
| `PUT` | `/v1/customers/:id` | 🔒 dueño | RF-2.1 | Actualizar preferencias |
| `GET` | `/v1/customers/:id/status` | 🔒 | RF-2.5 | Estado de cuenta (recalcula con Soporte) |
| `PUT` | `/v1/customers/:id/status` | 🔒 dueño | RF-2.5 | Cambiar estado (baja, bloqueo, etc.) |
| `GET` | `/v1/customers/:id/trips` | 🔒 | RF-2.3 | Historial de viajes (via M6) |

### Códigos de respuesta comunes

| Código | Significado |
|---|---|
| `401` | Sin token o token inválido |
| `403` | Rol incorrecto o el token no pertenece al dueño del recurso |
| `404` | Recurso no encontrado |
| `409` | Ya existe un perfil para ese usuario (`ProfileAlreadyExists`) |
| `503` | DB no disponible. Header `Retry-After` indica cuántos segundos esperar. **M1 caído nunca devuelve 401.** |

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
