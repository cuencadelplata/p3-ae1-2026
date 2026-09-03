# p3-ae1-2026
Paradigmas 3 AE1 2026

# M3 — Conductores y Vehículos (m3-drivers)

Módulo M3 de UCP móvil: gestión de vehículos (**RF-3.2**) y documentación
asociada (**RF-3.4**) de los conductores. Parte de la entrega AE1
(Paradigmas y Lenguajes de Programación III — ISI17PL324).

## Stack

- Node.js + TypeScript (Express 5)
- Supabase (PostgreSQL) como persistencia
- Docker / Docker Compose para contenerización
- Jest (pruebas unitarias) + Playwright (pruebas End-to-End)

## Requisitos previos

- Docker y Docker Compose (para correr contenerizado), o
- Node.js 22+ y npm (para correr en local sin Docker)
- Una instancia de Supabase con las tablas `vehiculos` y `documentos` creadas

## Variables de entorno

Crear un archivo `.env` en la raíz del módulo (`m3-vehiculos/`) con:

```env
SUPABASE_URL=https://tu-proyecto.supabase.co
SUPABASE_SERVICE_ROLE_KEY=tu_service_role_key
PORT=8083
```

## Ejecución con Docker (recomendado)

```bash
docker compose up --build -d
```

Verificar que el contenedor esté sano:

```bash
docker compose ps
curl http://localhost:8083/health
```

Detener y limpiar:

```bash
docker compose down
```

### Imagen publicada

La imagen también está disponible en Docker Hub, sin necesidad de build local:

```bash
docker pull vicbladilo/m3-vehiculos:1.1
docker run --env-file .env -p 8083:8083 vicbladilo/m3-vehiculos:1.1
```

- Repositorio: https://hub.docker.com/r/vicbladilo/m3-vehiculos
- Tags publicados: `1.0`, `1.1` (no depende de `latest`)

## Ejecución local (sin Docker)

```bash
npm install
npm run dev
```

El servidor queda escuchando en `http://localhost:8083`.

## Documentación de la API

La especificación OpenAPI está en [`openapi.yaml`](./openapi.yaml). Para
visualizarla de forma interactiva, pegar el contenido en
https://editor.swagger.io, o correr localmente:

```bash
npx @scalar/cli document serve openapi.yaml
```

## Pruebas

**Unitarias (Jest)** — prueban la lógica de negocio del service en
aislamiento (mockeando el repository, sin tocar Supabase real):

```bash
npm test
```

**End-to-End (Playwright)** — prueban los endpoints reales contra el
servidor corriendo (Playwright lo levanta solo si hace falta):

```bash
npx playwright test
```

Cobertura actual: 22 tests E2E (10 de vehículos, 12 de documentos) +
pruebas unitarias del service de vehículos, todos en verde.

## Endpoints principales

| Método | Ruta | Descripción |
|---|---|---|
| POST | `/api/v1/drivers/:driverId/vehicles` | Registrar vehículo (RF-3.2) |
| GET | `/api/v1/drivers/:driverId/vehicles` | Listar vehículos del conductor |
| GET | `/api/v1/drivers/:driverId/vehicles/:vehicleId` | Obtener un vehículo |
| PATCH | `/api/v1/drivers/:driverId/vehicles/:vehicleId/activar` | Activar vehículo |
| POST | `/api/v1/drivers/:driverId/documents` | Registrar documentación (RF-3.4) |
| GET | `/api/v1/drivers/:driverId/documents` | Listar documentos del conductor |
| GET | `/api/v1/drivers/:driverId/documents/:documentId` | Obtener un documento |

Ver `openapi.yaml` para el detalle completo de parámetros, cuerpos de
solicitud y respuestas de error.

## Decisiones técnicas y limitaciones conocidas

- Cada módulo (M3 incluido) es un proyecto Node autocontenido, con su
  propio `package.json`/`node_modules`, alineado con el requisito de
  arquitectura modular por servicios (no monolito).
- Arquitectura en capas: `routes` → `service` (reglas de negocio,
  errores `AppError` con status HTTP) → `repository` (única capa que
  conoce el esquema real de Supabase, snake_case) → `model`/`dto`.
- Un vehículo inexistente (`vehicleId`) devuelve `404`; datos de entrada
  inválidos devuelven `400`; una patente duplicada devuelve `409`.
- `LICENCIA_CONDUCIR` nunca lleva `vehicleId`; `SEGURO_VEHICULO` y
  `CEDULA_VEHICULO` lo requieren siempre (validado tanto en la app como
  con un constraint en la base).
- No implementa autenticación/autorización (fuera del alcance de AE1
  para este módulo; ver M1 — Identidad y Acceso).
