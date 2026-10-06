# M7: Tarifas, Pagos y Liquidaciones (AE2 Integrado)

Backend del Módulo 7, con estimación de tarifas, métodos de pago, cancelaciones, reintegros e historial financiero. Usa Docker Compose para los servicios locales y Supabase para persistir los pagos.

## Requisitos

- Docker y Docker Compose
- Node.js 20 o superior
- npm

## Requerimientos cubiertos

| RF | Requerimiento | Endpoint o evento |
|---|---|---|
| RF-7.1 | Estimación de tarifa | `POST /tarifas/estimacion` |
| RF-7.2 | Registro de método de pago | `POST /metodo-pago`, `GET /metodo-pago/:viajeId` |
| RF-7.3 | Autorización de pago | `POST /metodo-pago/:viajeId/autorizar` |
| RF-7.4 | Cargo por cancelación | `POST /tarifas/cancelacion` |
| RF-7.5 | Prevención de pagos duplicados | `GET /pagos/:idOrden/duplicado` |
| RF-7.6 | Reintegro por viaje cancelado | Consumer RabbitMQ |
| RF-7.7 | Historial financiero | `/operations` |

## Configuración local

Clona el repositorio y crea un archivo `.env` en su raíz. El archivo está excluido de Git; no lo subas ni compartas sus credenciales.

```dotenv
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/historial
REDIS_URL=redis://localhost:6379
RABBITMQ_URL=amqp://localhost:5672
CARGO_CANCELACION_URL=http://localhost:3007
SUPABASE_URL=https://tu-proyecto.supabase.co
SUPABASE_KEY=tu-publishable-key
```

Usa la URL real de tu proyecto Supabase y una publishable key vigente. No uses una secret key en la aplicación. La configuración de ejemplo usa PostgreSQL, Redis y RabbitMQ locales en Docker; los pagos se guardan en Supabase. Para usar PostgreSQL de Supabase en lugar del contenedor local, configura `DATABASE_URL` con la URI del pooler y la contraseña de la base de datos.

## Ejecutar con Docker Compose

```bash
docker compose up --build -d
docker compose ps
docker compose logs m7-app --tail=50
```

Compose carga las variables desde `.env`. El modo de red `host` requiere una versión de Docker Desktop que lo soporte y tenga habilitada esa opción. Los servicios locales usan los puertos predeterminados de PostgreSQL (5432), Redis (6379), RabbitMQ (5672 y 15672), M7 (3000) y el mock de cargo (3007).

- API y documentación interactiva: <http://localhost:3000/docs>
- Healthcheck: <http://localhost:3000/health>
- Panel de RabbitMQ: <http://localhost:15672> (usuario y contraseña: `guest`)

## Pruebas

```bash
npm install
npx playwright install --with-deps chromium
npx vitest run
npx playwright test
```

## Circuit Breaker

El Circuit Breaker evita sobrecargar Redis o el servicio de cargo cuando no están disponibles. En estado `OPEN`, usa el fallback configurado y el endpoint `GET /health` informa el estado. Luego del período de enfriamiento, prueba la reconexión en estado `HALF-OPEN`.

## Detener los servicios

```bash
docker compose down
```

## Imagen Docker

```bash
docker pull aylen0/m7-tarifas-ae2:4.0
```
