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
- Asignación de chofer al crear y reevaluación al editar mediante M5.
- Estado `PENDIENTE_ASIGNACION` cuando no hay chofer confirmado; reintentos antes del horario.
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

Este README usa rutas relativas a la carpeta `M9-ReservasProgramadas/`. Para trabajar
directamente dentro del módulo, entrar primero con `cd M9-ReservasProgramadas` desde
la raíz del repositorio. También se conservan todos los comandos npm desde la raíz
mediante scripts que los delegan a esta carpeta.

El `.gitignore` compartido está en la raíz; el `.dockerignore`, el `Dockerfile`, la
configuración `.env` y el contexto de construcción están dentro de M9. El Compose raíz
incluye esta composición (requiere Compose 2.20 o superior). Ambas ubicaciones usan
el proyecto `m9-reservas-programadas`.

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

| Recurso         | Dirección                        |
| --------------- | -------------------------------- |
| UI              | `http://localhost:3000/`         |
| API de reservas | `http://localhost:3000/reservas` |
| Swagger UI      | `http://localhost:3000/docs/`    |
| Salud de M9     | `http://localhost:3000/health`   |

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

| Variable                   | Default                 | Descripción                   |
| -------------------------- | ----------------------- | ----------------------------- |
| `PORT`                     | `3000`                  | Puerto HTTP de M9.            |
| `NODE_ENV`                 | `development`           | Entorno de Node.js.           |
| `M5_URL`                   | `http://localhost:3001` | URL del servicio de despacho. |
| `M7_URL`                   | `http://localhost:3002` | URL del servicio de tarifas.  |
| `RESERVATION_JOB_INTERVAL` | `*/30 * * * * *`        | Expresión cron del scheduler. |

## API

| Método | Ruta            | Propósito                                                           |
| ------ | --------------- | ------------------------------------------------------------------- |
| GET    | `/health`       | Consultar salud básica.                                             |
| GET    | `/openapi.json` | Descargar la especificación OpenAPI utilizada por Swagger UI.       |
| POST   | `/reservas`     | Consultar tarifa e intentar asignar chofer; puede quedar pendiente. |
| GET    | `/reservas`     | Listar reservas por fecha ascendente.                               |
| GET    | `/reservas/:id` | Obtener una reserva por UUID.                                       |
| PATCH  | `/reservas/:id` | Modificar una reserva programada o pendiente y reevaluar chofer.    |
| DELETE | `/reservas/:id` | Liberar chofer y cancelar una reserva programada o pendiente.       |
| GET    | `/docs/`        | Abrir Swagger UI.                                                   |

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

## Asignación de choferes

Al crear una reserva, M9 la guarda y consulta M5. Si obtiene un chofer, devuelve
`PROGRAMADA` con `asignacion` (id, choferId, nombreChofer y valoracion); si no hay
disponibilidad o M5 falla, devuelve `PENDIENTE_ASIGNACION` con `asignacion: null`.
Ambos resultados responden HTTP 201. El consumidor no puede enviar estado ni asignación.

El M5 local es un **simulador** con dos autos (4.9 y 4.7) y una moto (4.8), todos
ficticios. Ofrece por mayor valoración y, en empates, por ID. Solo confirma al conductor
que acepta una oferta vigente. Si rechaza o no responde antes del vencimiento, continúa
con el siguiente candidato. Si ninguno acepta, M9 conserva la reserva pendiente.
Considera cada
viaje como un bloque de una hora desde el horario programado e impide solapamientos
para el mismo chofer. No calcula distancias ni duración real, y no integra todavía
los módulos reales de conductores o despacho.

Un PATCH de origen, destino, vehículo o fecha invalida la ronda de ofertas y libera
la asignación anterior, y abre una ronda nueva con los datos modificados.
Puede conservar al mismo chofer, pero debe aceptar de nuevo: el identificador de
asignación es el de la nueva oferta aceptada. Una respuesta antigua no puede confirmar
la nueva ronda. DELETE invalida las ofertas pendientes y libera la asignación.
Si no consigue chofer, queda pendiente. DELETE libera la ocupación y cancela lógicamente.
Se pueden editar y cancelar reservas PROGRAMADA o PENDIENTE_ASIGNACION.
Si M5 no confirma la liberación, PATCH/DELETE responden 503 sin aplicar cambios locales;
el consumidor debe reintentar. Una liberación remota puede haber ocurrido aunque se
pierda la respuesta: esta versión no proporciona transacciones distribuidas.

Cada ciclo del scheduler reintenta hasta 100 reservas pendientes **futuras**, ordenadas
por horario. Una pendiente cuyo horario ya llegó no se despacha ni se marca FALLIDA
automáticamente: debe reprogramarse con una fecha futura o cancelarse. Todavía no se
definió un período de tolerancia. Para ver cambios del scheduler, actualizar el listado.

La activación usa la asignación vigente; M5 rechaza recorridos/asignaciones obsoletos
y devuelve la misma solicitud ante un despacho repetido de esa reserva. Edición,
cancelación, asignación y activación se serializan por reserva dentro de la instancia M9.
El repositorio y las ocupaciones de M5 siguen en memoria; reiniciar alguno pierde su
estado. La persistencia, reconciliación y garantías distribuidas quedan para la integración
de PostgreSQL/RabbitMQ.

Contrato HTTP del simulador M5 (red interna):

| Operación                         | Entrada                                                 | Resultado                                                                            |
| --------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `PUT /asignaciones/:reservaId`    | `{ reserva }` con id, origen, destino, vehículo y fecha | 200 `{ asignacion }`, objeto o null. 400 si inválida; 409 si ya despachada.          |
| `DELETE /asignaciones/:reservaId` | Sin cuerpo                                              | 204, incluso si ya estaba libre. 409 si ya despachada.                               |
| `POST /solicitudes`               | `{ reserva }` incluyendo asignación vigente             | 201 `{ solicitudId, estado }`. 400 sin asignación válida; 409 si no coincide con M5. |

El contrato completo está versionado en `openapi/m5-stub.yaml`. También incluye
`GET /asignaciones/:reservaId/ofertas` (historial de ofertas simulado) y
`POST /ofertas/:ofertaId/respuesta` con `{ choferId, decision }`, donde `decision`
es `ACEPTAR` o `RECHAZAR`. Respuestas vencidas, repetidas, de otro conductor o de una
ronda invalidada se rechazan con 409. La asignación nunca se confirma solo por ranking.

### Corrección funcional posterior al informe AE1

El informe del 02/09 proponía ofertas al activar. Esta versión aplica la corrección
posterior comunicada por el grupo: ofertas desde la creación y nuevamente al editar.
No se modifica el PDF histórico. M5 conserva la responsabilidad de ofertas y aceptación;
M9 conserva la reserva y activa el despacho al llegar el horario con la asignación confirmada.

### Demostración de aceptación, rechazo y vencimiento

En `.env`, configurar `M5_OFERTAS_ESCENARIO` y ejecutar `npm run local:up`:

| Valor            | Resultado al crear una reserva AUTO sin ocupaciones previas |
| ---------------- | ----------------------------------------------------------- |
| `ACEPTAN`        | Auto A (4.9) acepta. Valor predeterminado.                  |
| `RECHAZA_MEJOR`  | Auto A rechaza; Auto B (4.7) acepta.                        |
| `VENCE_MEJOR`    | Auto A no responde; vence su oferta y Auto B acepta.        |
| `RECHAZAN_TODOS` | Ninguno acepta; la reserva queda pendiente.                 |

Para cambiar de escenario, detener primero con `npm run local:down`; esto descarta
reservas y ofertas en memoria. No cambiar solamente M5 mientras se conservan reservas
de M9: esta versión no reconcilia reinicios independientes. Después restaurar `ACEPTAN`.
Los escenarios `RECHAZA_MEJOR` y `VENCE_MEJOR` afectan al Auto A; la moto acepta.

El plazo demo es 200 ms por oferta y las respuestas automáticas llegan a los 10 ms.
Son tiempos acelerados para pruebas, **no una interfaz para conductores reales**.
Los tests también usan el modo `MANUAL` del simulador para enviar decisiones HTTP,
comprobar aceptación/rechazo concurrentes y rechazar respuestas antiguas. No existe
autenticación de conductores en estos endpoints internos: `choferId` no es una credencial.
No exponerlos a Internet. El historial es efímero y no constituye auditoría durable.

Una ronda sin aceptación puede reintentarse por el scheduler mientras la reserva sea
futura. En esta versión un rechazo vale para esa ronda, no bloquea permanentemente al
conductor en rondas posteriores. La integración real deberá acordar tiempos, identidad,
notificaciones, política de reoferta y contrato asíncrono con M5.

Para probarlo: crear tres reservas AUTO con el mismo horario futuro. Las primeras dos
obtienen chofer y la tercera queda pendiente. Cancelar una y esperar el siguiente ciclo
(30 segundos por defecto): la pendiente obtiene el chofer libre. Cambiar AUTO por MOTO
permite observar la reevaluación. Usar `npm run local:up` para reconstruir este código:
la imagen publicada `v1.0.0` corresponde a la entrega anterior y no incluye este cambio.

## Persistencia en memoria

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

El porcentaje por archivo se muestra en la terminal. El informe navegable se genera en `coverage/index.html` dentro del módulo (`M9-ReservasProgramadas/coverage/index.html` desde la raíz); puede abrirse desde esta carpeta con:

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

La solución utiliza una única imagen multirol para M9 y los stubs M5/M7. La imagen de la entrega está publicada de forma pública en Docker Hub:

```text
ignacioparra1902/m9-reservas-programadas:v1.0.0
```

Enlace público: [Docker Hub – M9 Reservas Programadas](https://hub.docker.com/r/ignacioparra1902/m9-reservas-programadas)

Descargar la versión exacta de la entrega:

```bash
docker pull ignacioparra1902/m9-reservas-programadas:v1.0.0
```

Después de descargarla, iniciar la solución completa sin reconstruir el código:

```bash
docker compose up -d
```

Compose utiliza la imagen publicada como valor predeterminado para los tres contenedores. El comando `npm run local:up` mantiene la alternativa de construirla desde el código fuente mediante `--build`.

La etiqueta `v1.0.0` fue verificada públicamente y corresponde al digest:

```text
sha256:040ba2505836eb2c0d47c3a2f739127a77a26a946ddf2112848f7ab267409ff4
```

## Detención y limpieza

Detener la solución:

```bash
npm run local:down
```

Detener y eliminar recursos locales de Compose:

```bash
npm run local:clean
```

La limpieza elimina los contenedores, la red y los volúmenes asociados a esta composición. La implementación actual no define volúmenes de datos porque utiliza persistencia en memoria.

## Preparación del archivo de entrega

Para el Campus Virtual se debe incluir una copia `.zip` del repositorio dentro del archivo principal de entrega. Antes de comprimir, verificar que no se incluyan:

- `node_modules/`;
- `dist/`;
- `coverage/`;
- `.env` u otros archivos con secretos;
- logs y archivos temporales.

Sí deben incluirse el código fuente, las pruebas, `Dockerfile`, `docker-compose.yml`, `package.json`, `package-lock.json`, `.env.example`, `.gitignore`, `README.md` y `openapi/openapi.yaml`.

## Documentación

- `openapi/openapi.yaml`: contrato OpenAPI portable.
- `http://localhost:3000/openapi.json`: contrato OpenAPI servido por la aplicación.
- `http://localhost:3000/docs/`: visualización interactiva mediante Swagger UI.

## Límites de seguridad

En AE1 M9 no implementa autenticación propia: `clienteId` es declarado por el consumidor. La autenticación pertenece a M1 – Identidad y Acceso y su integración queda fuera del alcance actual del módulo. El servicio no debe exponerse a Internet sin autenticación, autorización, persistencia durable y rate limiting.
