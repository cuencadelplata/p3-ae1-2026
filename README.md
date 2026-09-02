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

La instalación inicial con `npm install` prepara las dependencias locales. El segundo comando construye las imágenes locales e inicia M9, M5 stub y M7 stub.

Si se quiere una instalación reproducible a partir del lockfile, también puede usarse:

```bash
npm ci
npm run local:up
```

`npm ci` instala exactamente las versiones registradas en `package-lock.json`. El segundo comando construye la imagen local e inicia coordinadamente M9, M5 stub y M7 stub mediante Docker Compose.

Si se necesita personalizar un valor, copiar `.env.example` como `.env` antes de iniciar. Para la evaluación estándar no es necesario modificarlo porque Compose incluye valores predeterminados.

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

### Verificaciones del código

```bash
npm run typecheck
npm run build
npm test
```

`npm test` ejecuta las pruebas unitarias y de integración. No incluye el E2E, ya que este necesita la solución iniciada en contenedores.

### Cobertura de pruebas

Generar el resumen de cobertura y el informe HTML:

```bash
npm run test:coverage
```

El porcentaje por archivo se muestra en la terminal. El informe navegable se genera en `coverage/index.html`; puede abrirse con:

```powershell
start coverage/index.html
```

En Linux:

```bash
xdg-open coverage/index.html
```

La carpeta `coverage/` es un resultado generado y está excluida del repositorio mediante `.gitignore`. La cobertura corresponde a las pruebas unitarias y de integración; las pruebas E2E se informan por separado porque consumen los servicios reales de Compose.

### End-to-End contra contenedores

Con Docker Desktop iniciado, ejecutar:

```bash
npm run test:e2e
```

El comando es autocontenido: construye la imagen, levanta M9 y los stubs, espera sus health checks, ejecuta las pruebas por HTTP contra `http://127.0.0.1:3909` y desmonta Compose al finalizar, incluso si una prueba falla. No accede directamente al repositorio ni a una base de datos.

Escenarios automatizados:

- disponibilidad de la UI pública;
- creación, consulta, listado, modificación y cancelación lógica de una reserva;
- estimación de tarifa mediante M7;
- activación de una reserva vencida mediante el scheduler y M5;
- salud de M9, M5 y M7 antes de comenzar las pruebas.

Para evitar que la ejecución E2E reemplace una composición iniciada manualmente, detenerla primero con `npm run local:down`. Si se desea seguir usando la aplicación después de las pruebas, ejecutar nuevamente `npm run local:up`.

### Secuencia completa recomendada para la evaluación

```bash
npm ci
npm run typecheck
npm run build
npm test
npm run test:coverage
npm run test:e2e
npm run local:up
```

Luego verificar `http://localhost:3000/health`, abrir `http://localhost:3000/docs/` y operar la UI en `http://localhost:3000/`. Al terminar, ejecutar `npm run local:down`.

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

<<<<<<< HEAD
=======
La limpieza elimina los contenedores, la red y los volúmenes asociados a esta composición. La implementación actual no define volúmenes de datos porque utiliza persistencia en memoria.

## Preparación del archivo de entrega

Para el Campus Virtual se debe incluir una copia `.zip` del repositorio dentro del archivo principal de entrega. Antes de comprimir, verificar que no se incluyan:

- `node_modules/`;
- `dist/`;
- `coverage/`;
- `.env` u otros archivos con secretos;
- logs y archivos temporales.

Sí deben incluirse el código fuente, las pruebas, `Dockerfile`, `docker-compose.yml`, `package.json`, `package-lock.json`, `.env.example`, `.gitignore`, `README.md`, `docs/` y `openapi/openapi.yaml`.

>>>>>>> f404cb6 (Code cleaning y actualizacion de dependencias)
## Documentación

- `docs/FUNCIONAMIENTO.md`: arquitectura, flujos, scheduler, contenedores y limitaciones.
- `openapi/openapi.yaml`: contrato OpenAPI portable.
- `http://localhost:3000/docs/`: visualización interactiva mediante Swagger UI.

## Límites de seguridad

En AE1 M9 no implementa autenticación propia: `clienteId` es declarado por el consumidor. La autenticación pertenece a M1 – Identidad y Acceso y su integración queda fuera del alcance actual del módulo. El servicio no debe exponerse a Internet sin autenticación, autorización, persistencia durable y rate limiting.
