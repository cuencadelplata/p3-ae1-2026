# M9 – Reservas Programadas

## Integrantes

- Codermatz, Valentino
- Parra Ingaramo, Ignacio

Microservicio de AE1 para crear, consultar, modificar, cancelar y activar reservas de viajes futuros. El trabajo se realiza exclusivamente en la rama `M9-ReservasProgramadas` y se ejecuta de forma local, sin despliegue cloud.

## Alcance implementado

- CRUD REST con cancelación lógica.
- UI responsive para operar reservas.
- Validación estricta con Zod y errores de dominio estables.
- Persistencia temporal en memoria durante la ejecución del proceso.
- Estimación de tarifa mediante M7 con degradación controlada.
- Scheduler con reclamo atómico `PROGRAMADA → ACTIVANDO`.
- Activación en M5 y almacenamiento de `idSolicitud`.
- Stubs M5/M7 y red interna de Docker Compose.
- OpenAPI portable, Swagger UI y pruebas unitarias, de integración y E2E.

## Requisitos previos

- Node.js 22 o superior.
- npm.
- Docker Desktop con Docker Compose para ejecutar la solución en contenedores.

No se necesitan cuentas externas ni credenciales privadas.

## Preparación desde un entorno limpio

```bash
npm install
npm run local:up
```

El segundo comando construye las imágenes locales e inicia M9, M5 stub y M7 stub.

## Accesos locales

| Recurso | Dirección |
| --- | --- |
| UI | `http://localhost:3000/` |
| API de reservas | `http://localhost:3000/reservas` |
| Swagger UI | `http://localhost:3000/docs/` |
| Salud de M9 | `http://localhost:3000/health` |

M5 y M7 son dependencias internas de `reservas-network` y no publican puertos al host. La solución no define volúmenes porque la persistencia actual es en memoria.

## Verificación de salud

Después de iniciar los contenedores, comprobar su estado:

```bash
docker compose ps
curl -i http://localhost:3000/health
```

El estado de M9 debe ser `healthy` y `GET /health` debe devolver `HTTP 200` con `{"service":"m9-reservas-programadas","status":"ok"}`. M5 y M7 se validan mediante sus health checks internos; también pueden comprobarse desde M9:

```bash
docker compose exec -T m9-reservas wget -qO- http://m5-stub:3001/health
docker compose exec -T m9-reservas wget -qO- http://m7-stub:3002/health
```

## Variables de entorno

Los valores de Compose ya están preparados para la ejecución coordinada. `.env.example` sirve como referencia para ejecutar M9 directamente con npm.

| Variable | Default | Descripción |
| --- | --- | --- |
| `PORT` | `3000` | Puerto HTTP de M9. |
| `NODE_ENV` | `development` | Entorno de Node.js. |
| `M5_URL` | `http://localhost:3001` | URL del servicio de despacho. |
| `M7_URL` | `http://localhost:3002` | URL del servicio de tarifas. |
| `RESERVATION_JOB_INTERVAL` | `*/30 * * * * *` | Expresión cron del scheduler. |

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

La especificación completa está versionada en `openapi/openapi.yaml`.

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

## Persistencia temporal

Las reservas se guardan en un `Map` privado del proceso M9. La implementación conserva el contrato `ReservaRepository`, por lo que una base de datos podrá incorporarse después sin cambiar controladores, servicios ni rutas.

Consecuencias actuales:

- los datos se conservan mientras M9 esté ejecutándose;
- reiniciar o recrear el contenedor elimina todas las reservas;
- no se comparten datos entre varias réplicas de M9;
- el reclamo de una reserva sigue siendo atómico dentro de una única instancia.

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

El E2E construye y levanta los contenedores, consume únicamente la UI y la API pública de M9, verifica CRUD, tarifa M7 y activación M5, y desmonta Compose al finalizar.

## Imágenes Docker y registry

La composición actual construye una única imagen multirol para M9 y los stubs M5/M7:

```text
m9-reservas-programadas:local
```

No existe una registry configurada ni una imagen pública verificada todavía. El remoto GitHub pertenece a `cuencadelplata`, por lo que GitHub Container Registry es el destino previsto para la entrega:

```text
ghcr.io/cuencadelplata/p3-ae1-2026:v1.0.0
```

Estado: **publicación pendiente de autenticación en registry**. No ejecutar este comando hasta que el equipo publique y verifique la imagen:

```bash
docker pull ghcr.io/cuencadelplata/p3-ae1-2026:v1.0.0
```

Al publicarla, se deberá registrar en esta sección el enlace público de GHCR, confirmar el tag `v1.0.0` y verificar el pull desde un entorno sin credenciales.

## Detención y limpieza

Detener la solución:

```bash
npm run local:down
```

Detener y eliminar recursos locales de Compose:

```bash
npm run local:clean
```

## Documentación

- `docs/FUNCIONAMIENTO.md`: arquitectura, flujos, scheduler, contenedores y limitaciones.
- `openapi/openapi.yaml`: contrato OpenAPI portable.
- `http://localhost:3000/docs/`: visualización interactiva mediante Swagger UI.

## Límites de seguridad

En AE1 M9 no implementa autenticación propia: `clienteId` es declarado por el consumidor. La autenticación pertenece a M1 – Identidad y Acceso y su integración queda fuera del alcance actual del módulo. El servicio no debe exponerse a Internet sin autenticación, autorización, persistencia durable y rate limiting.
