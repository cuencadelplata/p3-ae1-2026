# M9 – Reservas Programadas

## Integrantes

- Codermatz, Valentino
- Parra Ingaramo, Ignacio

Microservicio de AE1 para crear, consultar, modificar, cancelar y activar reservas de viajes futuros. El trabajo se realiza exclusivamente en la rama `M9-ReservasProgramadas` y se ejecuta de forma local, sin despliegue cloud.

## Alcance implementado

- CRUD REST con cancelación lógica.
- UI responsive para operar reservas.
- Validación estricta con Zod y errores de dominio estables.
- Persistencia local en Supabase con esquema, RLS y seed versionados.
- Estimación de tarifa mediante M7 con degradación controlada.
- Scheduler persistente con reclamo atómico `PROGRAMADA → ACTIVANDO`.
- Activación en M5 y persistencia de `idSolicitud`.
- Stubs M5/M7 y red interna Docker Compose.
- OpenAPI portable, Swagger UI y pruebas unitarias, de integración y E2E.

## Requisitos previos

- Node.js 22 o superior.
- npm.
- Docker Desktop con Docker Compose.
- Al menos 4 GB de memoria disponible para los contenedores locales.

No se necesita una cuenta de Supabase, una URL cloud ni credenciales privadas.

## Preparación desde un entorno limpio

```bash
npm install
npm run local:up
```

La primera ejecución descarga los componentes oficiales mínimos de Supabase, aplica las migraciones y el seed, construye las imágenes locales e inicia M9, M5 stub y M7 stub.

El comando obtiene la clave server-only de Supabase local sin imprimirla ni guardarla y la entrega a M9 únicamente como variable del proceso de Compose.

## Accesos locales

| Recurso | Dirección |
| --- | --- |
| UI | `http://localhost:3000/` |
| API de reservas | `http://localhost:3000/reservas` |
| Swagger UI | `http://localhost:3000/docs/` |
| Salud de M9 | `http://localhost:3000/health` |
| Data API local de Supabase | `http://localhost:54321` |

M5 y M7 son dependencias internas de `reservas-network` y no publican puertos al host. No se utilizan volúmenes definidos por Compose; Supabase CLI administra sus volúmenes locales.

## Variables de entorno

La ejecución recomendada con `npm run local:up` configura Supabase automáticamente. `.env.example` se utiliza solamente para ejecutar M9 directamente con npm.

| Variable | Default | Descripción |
| --- | --- | --- |
| `PORT` | `3000` | Puerto HTTP de M9. |
| `NODE_ENV` | `development` | Entorno de Node.js. |
| `SUPABASE_URL` | `http://127.0.0.1:54321` | Data API local para ejecución directa. |
| `SUPABASE_KEY` | — | Clave server-only local; nunca se versiona. |
| `M5_URL` | `http://localhost:3001` | URL de M5 fuera de Compose. |
| `M7_URL` | `http://localhost:3002` | URL de M7 fuera de Compose. |
| `RESERVATION_JOB_INTERVAL` | `*/30 * * * * *` | Expresión cron del scheduler. |

Nunca se deben copiar claves del proyecto Supabase cloud al repositorio, al ZIP ni a una imagen Docker.

## API

| Método | Ruta | Propósito |
| --- | --- | --- |
| GET | `/health` | Consultar salud básica. |
| POST | `/reservas` | Crear una reserva `PROGRAMADA` y consultar M7. |
| GET | `/reservas` | Listar reservas por fecha ascendente. |
| GET | `/reservas/:id` | Obtener una reserva por UUID. |
| PATCH | `/reservas/:id` | Modificar una reserva `PROGRAMADA`. |
| DELETE | `/reservas/:id` | Cancelar lógicamente una reserva `PROGRAMADA`. |
| GET | `/docs/` | Abrir Swagger UI. |

La especificación portable está versionada en `openapi/openapi.yaml`.

Ejemplo de creación:

```json
{
  "clienteId": "00000000-0000-4000-8000-000000000001",
  "origen": "Terminal de Ómnibus",
  "destino": "Aeropuerto",
  "vehiculo": "AUTO",
  "fechaHoraProgramada": "2099-01-01T14:30:00-03:00"
}
```

## Supabase local

Los archivos reproducibles son:

- `supabase/config.toml`;
- `supabase/migrations/`;
- `supabase/seed.sql`.

Para reconstruir la base desde cero:

```bash
npm run local:reset
```

Este comando destruye únicamente la base local de este repositorio, vuelve a aplicar las migraciones y carga datos ficticios. Nunca utiliza `--linked` ni modifica el proyecto cloud.

## Pruebas

Pruebas unitarias y de integración:

```bash
npm test
npm run typecheck
npm run build
```

Prueba automatizada contra contenedores:

```bash
npm run test:e2e
```

El E2E inicia una base local limpia, construye y levanta los contenedores, consume la UI y las interfaces HTTP públicas, verifica CRUD, tarifa M7 y activación M5, y elimina sus contenedores y datos temporales al finalizar. No accede directamente a tablas para reemplazar operaciones del flujo.

> `npm run test:e2e` elimina cualquier dato existente en la instancia Supabase local de este repositorio. No afecta bases remotas.

## Detención y limpieza

Detener conservando los datos locales:

```bash
npm run local:down
```

Detener y eliminar los datos locales:

```bash
npm run local:clean
```

## Documentación

- `docs/SUPABASE_LOCAL.md`: arquitectura local, migraciones, pruebas, limpieza y seguridad.
- `openapi/openapi.yaml`: contrato OpenAPI portable.
- `http://localhost:3000/docs/`: visualización interactiva mediante Swagger UI.

## Seguridad y límites

RLS permanece habilitado y la clave server-only solo existe en el backend. La API HTTP todavía no implementa autenticación de usuarios finales: `clienteId` es declarado por el consumidor. El servicio no debe exponerse a Internet sin autenticación, autorización y rate limiting.

La instancia local de Supabase utiliza credenciales de desarrollo y tampoco debe exponerse a redes públicas.
