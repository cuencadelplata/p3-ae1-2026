# M9 – Reservas Programadas

## Integrantes

- Codermatz, Valentino
- Parra Ingaramo, Ignacio

## Contexto

Microservicio desarrollado para la Actividad AE1 de Ingeniería en Sistemas de Información.

## Objetivo

M9 permitirá administrar reservas de viajes programados para una fecha y hora futuras. Esta primera versión construye únicamente la infraestructura técnica del servicio.

## Responsabilidad del servicio

M9 será el propietario lógico de las reservas futuras y expondrá sus operaciones mediante una API REST. No será responsable del despacho de vehículos, el cálculo de tarifas ni el ciclo de vida completo de un viaje; esas capacidades corresponderán a otros microservicios.

## Tecnologías

- Node.js 22 y TypeScript en modo estricto
- Express, CORS y Helmet
- Supabase Cloud mediante `@supabase/supabase-js`
- Zod para validar la configuración
- OpenAPI y Swagger UI
- Vitest y Supertest
- Docker y Docker Compose
- `node-cron`, reservado para una etapa posterior

## Arquitectura

M9 es un microservicio independiente. Su estructura interna sigue una arquitectura en capas:

- `controllers`: adaptación de solicitudes y respuestas HTTP.
- `services`: futura lógica de negocio.
- `repositories`: futuro acceso a Supabase.
- `clients`: futuras integraciones HTTP con M5 y M7.
- `schemas`: futuras validaciones de entrada con Zod.
- `domain`: futuras entidades, tipos y estados del dominio.
- `jobs`: futuro scheduler de activación de reservas.
- `config`: configuración centralizada del entorno y Supabase.

Los clientes se comunicarán con M9; no accederán a Supabase de forma directa.

## Requisitos previos

- Node.js 22 o superior
- npm
- Docker con Docker Compose
- Una cuenta y un proyecto de Supabase

## Variables de entorno

Copiar `.env.example` como `.env` y completar:

| Variable | Obligatoria | Descripción |
| --- | --- | --- |
| `PORT` | No | Puerto HTTP. Valor predeterminado: `3000`. |
| `NODE_ENV` | No | Entorno: `development`, `test` o `production`. |
| `SUPABASE_URL` | Sí | URL HTTPS del proyecto de Supabase. |
| `SUPABASE_KEY` | Sí | Clave de Supabase de uso exclusivo del servidor. No debe exponerse a clientes. |
| `M5_URL` | No | URL futura de M5 – Solicitud y Despacho. |
| `M7_URL` | No | URL futura de M7 – Tarifas. |
| `RESERVATION_JOB_INTERVAL` | No | Expresión futura para el scheduler de reservas. |

La aplicación valida estas variables al iniciar y termina con un mensaje claro si falta una obligatoria.

## Desarrollo local

```bash
npm install
cp .env.example .env
npm run dev
```

En PowerShell, usar `Copy-Item .env.example .env` en lugar de `cp`.

La API quedará disponible en `http://localhost:3000` salvo que se configure otro puerto.

## Docker

Con el archivo `.env` ya creado:

```bash
docker compose up --build
```

Supabase es externo y no se ejecuta dentro de Docker Compose.

## Testing

```bash
npm test
npm run test:watch
npm run typecheck
npm run build
```

## API

- `GET /health`: devuelve el estado básico de M9.
- `/docs`: interfaz Swagger UI.
- `openapi/openapi.yaml`: especificación OpenAPI portable.

Respuesta de salud:

```json
{
  "service": "m9-reservas-programadas",
  "status": "ok"
}
```

## Estado actual

Infraestructura inicial de M9 implementada. El CRUD de reservas, el scheduler funcional y las integraciones con M5 y M7 todavía no están implementados.
