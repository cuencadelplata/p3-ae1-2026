# M9 – Reservas Programadas

## Integrantes

- Codermatz, Valentino
- Parra Ingaramo, Ignacio

Microservicio de la Actividad AE1 para crear, consultar, modificar, cancelar y activar reservas de viajes futuros. El trabajo se realizó directamente en la rama `M9-ReservasProgramadas`.

## Alcance implementado

- CRUD REST con cancelación lógica.
- Validación Zod estricta y errores de dominio estables.
- Persistencia en el proyecto Supabase existente `Modulo9:Reservas`.
- Estimación de tarifa mediante M7 con degradación controlada.
- Scheduler persistente con `node-cron`.
- Reclamo atómico `PROGRAMADA → ACTIVANDO` seguro ante múltiples workers.
- Activación en M5 y persistencia de `idSolicitud`.
- Stubs M5/M7 y red Docker Compose interna.
- OpenAPI, Swagger UI y pruebas unitarias/integración.

## Requisitos

- Node.js 22 o superior.
- npm.
- Docker Desktop con Docker Compose, si se usa contenedores.
- URL y clave server-only del proyecto Supabase existente.

## Configuración

Copiar `.env.example` como `.env` y reemplazar únicamente los placeholders:

| Variable | Default | Descripción |
| --- | --- | --- |
| `PORT` | `3000` | Puerto HTTP de M9. |
| `NODE_ENV` | `development` | `development`, `test` o `production`. |
| `SUPABASE_URL` | — | URL del proyecto Supabase. Obligatoria. |
| `SUPABASE_KEY` | — | Clave secreta/server-only. Obligatoria; nunca usar en frontend o commits. |
| `M5_URL` | `http://localhost:3001` | Base URL de M5. |
| `M7_URL` | `http://localhost:3002` | Base URL de M7. |
| `RESERVATION_JOB_INTERVAL` | `*/30 * * * * *` | Expresión cron del scheduler. |

El scheduler opera reservas de distintos clientes y por eso la clave debe tener privilegios server-side equivalentes a `service_role`. Una publishable/anon key sin JWT de usuario no atraviesa las políticas RLS existentes.

## Ejecución local

```bash
npm install
cp .env.example .env
npm run dev
```

En PowerShell:

```powershell
Copy-Item .env.example .env
npm run dev
```

Para ejecutar M5 y M7 fuera de Docker:

```bash
npx tsx src/stubs/m5/server.ts
npx tsx src/stubs/m7/server.ts
```

## API

| Método | Ruta | Regla principal |
| --- | --- | --- |
| GET | `/health` | Estado básico. |
| POST | `/reservas` | Crea en `PROGRAMADA`; consulta M7. |
| GET | `/reservas` | Lista por fecha ascendente. |
| GET | `/reservas/:id` | Obtiene una reserva. |
| PATCH | `/reservas/:id` | Solo modifica `PROGRAMADA`. |
| DELETE | `/reservas/:id` | Cancela lógicamente solo `PROGRAMADA`. |
| GET | `/docs` | Swagger UI. |

Ejemplo de creación:

```json
{
  "clienteId": "00000000-0000-4000-8000-000000000001",
  "origen": "Terminal de Ómnibus",
  "destino": "Aeropuerto",
  "vehiculo": "AUTO",
  "fechaHoraProgramada": "2026-09-02T14:30:00-03:00"
}
```

Los clientes no pueden enviar `estado`, `tarifaEstimada`, `idSolicitud` ni timestamps. El formato de error es:

```json
{
  "error": {
    "codigo": "RESERVA_NO_MODIFICABLE",
    "mensaje": "Solo se pueden modificar reservas en estado PROGRAMADA."
  }
}
```

La especificación portable está en `openapi/openapi.yaml`.

## Scheduler y estados

Cada ejecución consulta en Supabase las filas `PROGRAMADA` cuya fecha ya venció. No existe una lista de reservas en memoria. El reclamo se hace con un único update condicionado por ID y estado; solo un worker puede obtener la fila.

```text
PROGRAMADA --cancelación--> CANCELADA
PROGRAMADA --reclamo-----> ACTIVANDO --M5 OK----> ACTIVADA
                                      `--M5 falla-> FALLIDA
```

Si M7 falla al crear, la reserva sigue en `PROGRAMADA` con `tarifaEstimada: null`. Si M5 falla después del reclamo, se marca `FALLIDA` para evitar reintentos que puedan duplicar despachos.

## Docker Compose

Con `.env` configurado:

```bash
docker compose up --build
```

Compose inicia `m9-reservas`, `m5-stub` y `m7-stub` en `reservas-network`. Solo M9 publica un puerto al host. Supabase continúa en la nube y no se duplica localmente.

## Verificación

```bash
npm test
npm run typecheck
npm run build
docker compose config --quiet
```

La suite Supabase real escribe exclusivamente filas temporales propias y las elimina al terminar. Está desactivada por defecto. Para habilitarla explícitamente en PowerShell:

```powershell
$env:RUN_SUPABASE_INTEGRATION='true'
npm test -- supabase-reserva.repository.live
```

## Documentación técnica

- `docs/ARCHITECTURE.md`: capas, dependencias y flujo de activación.
- `docs/SUPABASE_SCHEMA.md`: auditoría real de tablas, tipos, constraints, índices, funciones, grants y RLS.
- `docs/DATE_TIME_POLICY.md`: contrato temporal y UTC.
- `docs/RISK_MANAGEMENT.md`: degradación, concurrencia y riesgos pendientes.
- `docs/BACKLOG.md`: estado y mejoras no bloqueantes.

## Límite de seguridad actual

RLS sigue habilitado y la clave de backend no se entrega a consumidores. Sin embargo, autenticación/autorización HTTP está fuera del alcance actual: `clienteId` es un dato declarado por el consumidor. Antes de exposición pública se debe integrar identidad, autorización y rate limiting.
