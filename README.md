# p3-ae1-2026
Paradigmas 3 AE1 2026 - Grupo 5 - M2

## M2: Clientes

Implementación del módulo M2 para los requisitos RF-2.1, RF-2.3 y RF-2.5:

- Perfil de cliente: alta y consulta de `userId`, preferencias y estado. El nombre, teléfono y correo pertenecen a M1 y no se duplican en M2.
- Historial de viajes: consulta del listado de viajes realizados consumiendo la API de M6 sin acceso directo a su base de datos.
- Estado de cuenta: consulta y control de la condición operativa del perfil (activo/inactivo/bloqueado). Los clientes nunca se eliminan: la baja se registra con el estado `INACTIVO`.

---

## Imágenes Docker Hub

Las imágenes publicadas están disponibles en:

- [Backend M2](https://hub.docker.com/r/leangau/m2-perfilhistorialestado/tags?name=api)
- [Frontend M2](https://hub.docker.com/r/leangau/m2-perfilhistorialestado/tags?name=client)

Para descargar las imágenes desde la terminal integrada de VS Code:

```bash
docker pull leangau/m2-perfilhistorialestado:api
docker pull leangau/m2-perfilhistorialestado:client
```

Para comprobar que ambas imágenes quedaron instaladas localmente:

```bash
docker image ls leangau/m2-perfilhistorialestado
```

---

## Ejecutar los tests

### Paso 1

Primero, abra Visual Studio Code, luego, presione F1, escriba `Git: Clone` y presione enter, pegue el siguiente link:

```
https://github.com/cuencadelplata/p3-ae1-2026.git
```

Una vez el repositorio se haya clonado, deberá moverse a la rama correspondiente. Presione F1 nuevamente y escriba `Git: Checkout to...`, presione enter y seleccione la rama `M2-PerfilHistorialEstado`.

### Paso 2

Cuando se hayan descargado todos los archivos, vaya arriba a la izquierda **Terminal → New Terminal**.

### Paso 3

Desde la terminal de Visual Studio Code, ubicada en la raíz del proyecto:

```bash
npm install
npm test
npm run build
```

Para ejecutar los tests end-to-end, que requieren los servicios Docker levantados:

```bash
docker compose up -d
npx playwright install chromium
npm run test:e2e
docker compose down
```

La suite unitaria e integración no requiere Docker. Los tests E2E requieren que la API, PostgreSQL, Redis y el cliente estén disponibles. La definición actual de Compose descarga las imágenes publicadas; `npm run build` valida el código local.

---

## Configuración RF-2.1

La API se configura con variables de entorno. Los valores siguientes son los defaults de desarrollo; las credenciales reales deben inyectarse fuera del repositorio.

| Variable | Default de desarrollo | Uso |
| --- | --- | --- |
| `PORT` | `3000` | Puerto HTTP de M2. |
| `DB_HOST` / `DB_PORT` | `localhost` / `5433` fuera de Docker; `db-profiles` / `5432` dentro | PostgreSQL de perfiles. |
| `DB_USER` / `DB_PASSWORD` / `DB_NAME` | `postgres` / `postgres` / `profiles` | Credenciales de PostgreSQL local. |
| `DB_CONNECTION_TIMEOUT_MS` | `2000` | Límite para abrir una conexión. |
| `DB_QUERY_TIMEOUT_MS` / `DB_STATEMENT_TIMEOUT_MS` | `3000` / `3000` | Límite de consultas y sentencias. |
| `DB_IDLE_TIMEOUT_MS` | `30000` | Tiempo de inactividad del pool. |
| `REDIS_URL` | `redis://localhost:6379` | Redis para caché de perfiles y validación de tokens. |
| `M1_SERVICE_URL` | `http://localhost:3000/__stubs/m1` cuando los stubs están activos | URL del validador de identidad de M1. |
| `SOPORTE_SERVICE_URL` | `http://localhost:3000/__stubs/soporte` cuando los stubs están activos | URL de penalizaciones de soporte. |
| `M6_SERVICE_URL` | `http://localhost:3000/__stubs/m6` cuando los stubs están activos | URL del servicio de viajes. |
| `STUBS_ENABLED` | `false` | Monta los stubs locales solo cuando vale literalmente `true`. |
| `M1_JWT_SECRET` | Solo default de desarrollo del stub | Secreto HS256 del stub de M1; no usar el default en un entorno compartido. |
| `SERVICE_RETRY_AFTER_SECONDS` | `10` | Valor de `Retry-After` para un `503`. |

Cuando `STUBS_ENABLED=false`, M2 usa las URLs de los módulos reales. Con `STUBS_ENABLED=true`, los stubs se montan bajo `/__stubs/{m1,soporte,m6}` para pruebas locales; sus endpoints de diagnóstico y caos son operativos y no forman parte de `/openapi.json`.

La validación de identidad usa el bearer JWT de M1 (HS256, duración de una hora, payload `{ userId, role, iat, exp }`). M2 conserva en Redis la respuesta de validación en `auth:token:{sha256}` durante el menor de cinco minutos y el tiempo restante del token. Un token ausente o inválido responde `401`; un rol distinto de `CLIENTE` o un perfil ajeno responde `403`; un userId que ya tiene perfil responde `409 ProfileAlreadyExists`; si M1, PostgreSQL o Redis no están disponibles responde `503` con el header `Retry-After`. Una caída de M1 no se interpreta como token inválido.

## Endpoints RF-2.1 y observabilidad

La especificación completa y ejecutable se encuentra en [`/openapi.json`](http://localhost:3000/openapi.json) y se visualiza en [`/docs`](http://localhost:3000/docs) cuando la API está levantada. Los endpoints de RF-2.1 requieren `Authorization: Bearer <jwt>` salvo el listado sin filtro.

---

## Endpoints provistos por la API

La especificación completa se encuentra en `/docs` una vez levantado el servidor.

### Crear perfil de cliente
`POST /v1/customers`

Implementa RF-2.1. El rol `CLIENTE` y el `userId` se obtienen del token de M1. El cuerpo puede omitirse o contener únicamente preferencias:

```json
{
  "preferences": {
    "preferredVehicleType": "auto",
    "notificationChannel": "email"
  }
}
```

Si no se envían preferencias se aplican `auto` y `email`. M2 genera el `customerId` interno con formato `cust_xxx`.

Respuesta exitosa: `201 Created`.

### Obtener perfil de cliente
`GET /v1/customers/:id`

Implementa RF-2.1. Devuelve el perfil del `customerId` indicado para el usuario autenticado. `GET /v1/customers/me` resuelve el perfil directamente desde el `userId` del token y responde `404` si todavía no existe. `GET /v1/customers?userId=12` permite la consulta por userId para integraciones autorizadas.

La respuesta tiene esta forma, sin datos personales de M1:

```json
{
  "customerId": "cust_823a7b9c",
  "userId": 12,
  "preferences": {
    "preferredVehicleType": "auto",
    "notificationChannel": "email"
  },
  "status": "ACTIVO",
  "createdAt": "2026-10-04T18:00:00.000Z"
}
```

Respuesta exitosa: `200 OK`.

### Actualizar preferencias
`PUT /v1/customers/:id`

Implementa RF-2.1. Solo el dueño autenticado puede actualizar `preferredVehicleType` y `notificationChannel`; el body no acepta nombre, teléfono, correo ni direcciones.

Respuesta exitosa: `200 OK` con las preferencias y estado actualizados.

### Salud y métricas

`GET /health` es público y expone el estado de PostgreSQL, Redis y las dependencias registradas, incluidos los circuit breakers. `GET /metrics` es público y devuelve métricas Prometheus de HTTP, circuit breakers y caché. Los logs estructurados incluyen `requestId` para correlacionar cada solicitud y sus errores.

Las respuestas de error de la API siguen `{ "error": "...", "message": "..." }`; los errores de validación pueden incluir `details`. Los `503` incluyen `Retry-After` en segundos.

### Consultar estado de cuenta
`GET /v1/customers/:id/status`

Implementa RF-2.5. Devuelve la condición operativa del perfil (activo, inactivo, bloqueado temporal, bloqueado permanente o en revisión) junto al motivo registrado.

Respuesta exitosa: `200 OK`.

### Cambiar estado de cuenta (baja / bloqueo)
`PUT /v1/customers/:id/status`

Implementa RF-2.5. Cambia el estado del cliente y registra el motivo. **No existe borrado de clientes**: la baja se hace enviando `{ "status": "INACTIVO", "reason": "..." }`. La base de datos rechaza cualquier `DELETE` o `TRUNCATE` sobre las tablas de clientes mediante triggers.

Respuesta exitosa: `200 OK` con el estado actualizado. `400` si el estado o el motivo son inválidos, `404` si el cliente no existe.

### Consultar historial de viajes
`GET /v1/customers/:id/trips`

Implementa RF-2.3. Devuelve el listado de viajes realizados por el cliente consumiendo la API de M6 vía HTTP, sin acceso directo a su base de datos. Si M6 no está disponible, retorna datos de demostración.

Respuesta exitosa: `200 OK` con la propiedad `trips`.

---

## Contrato con APIs externas

Este endpoint es consumido por M2 para obtener el historial de viajes; no es un endpoint provisto por nuestra API:

- `GET /v1/trips?customerId={id}` — API de M6 (Viajes)
