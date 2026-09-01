# Funcionamiento interno del código de M9

## Propósito de este documento

Este documento explica cómo funciona internamente el microservicio M9 – Reservas Programadas. A diferencia del `README.md`, que está orientado a instalación, ejecución y uso de la API, este archivo describe las responsabilidades de cada parte del código y cómo colaboran durante una operación real.

## Visión general

M9 administra reservas de viajes futuros y es responsable de:

- crear reservas en estado `PROGRAMADA`;
- consultar y listar reservas persistidas;
- modificar o cancelar reservas mientras sigan programadas;
- pedir una tarifa estimada a M7;
- detectar reservas cuya fecha ya llegó;
- reclamar cada reserva de forma segura ante ejecuciones concurrentes;
- crear una solicitud de despacho en M5;
- guardar el resultado final de la activación.

Supabase es la única fuente de verdad. La aplicación no mantiene una lista productiva de reservas en memoria.

## Arranque de la aplicación

El punto de entrada es `src/server.ts`. Su responsabilidad es construir y conectar las dependencias concretas del sistema.

El arranque ocurre en este orden:

1. `src/config/env.ts` carga `.env` y valida todas las variables con Zod.
2. `src/config/supabase.ts` crea un cliente Supabase tipado y sin persistencia de sesión.
3. Se crea `SupabaseReservaRepository`, responsable del acceso a la tabla `reservas`.
4. Se crea `HttpTarifaClient`, que representa a M7.
5. Se crea `ReservaService`, que coordina las operaciones REST de reservas.
6. Se crea `HttpDespachoClient`, que representa a M5.
7. Se crea `ActivacionReservaService`, que coordina la máquina de estados de activación.
8. Se crea `ReservasScheduler`, configurado con la expresión cron del entorno.
9. `createApp` construye la aplicación Express e inyecta `ReservaService`.
10. Express comienza a escuchar en el puerto configurado.
11. El scheduler inicia sus ejecuciones periódicas.

Las señales `SIGINT` y `SIGTERM` detienen el scheduler y cierran el servidor HTTP. Esto permite finalizar el proceso ordenadamente en desarrollo, Docker o un orquestador.

## Organización por capas

| Carpeta | Responsabilidad |
| --- | --- |
| `src/config` | Validación del entorno y creación del cliente Supabase. |
| `src/domain` | Tipos del negocio y traducción entre filas de base y objetos de API. |
| `src/schemas` | Validación de datos recibidos por HTTP. |
| `src/routes` | Asociación entre rutas HTTP y controllers. |
| `src/controllers` | Adaptación de request/response; no contiene persistencia. |
| `src/services` | Reglas de negocio y coordinación entre repositorios y servicios externos. |
| `src/repositories` | Contrato de persistencia e implementación concreta para Supabase. |
| `src/clients` | Comunicación HTTP con M5 y M7. |
| `src/jobs` | Búsqueda y activación periódica de reservas vencidas. |
| `src/middleware` | Tratamiento de rutas inexistentes y errores. |
| `src/stubs` | Implementaciones simuladas de M5 y M7 para desarrollo y pruebas. |
| `src/types` | Tipos TypeScript generados a partir del esquema real de Supabase. |

La dependencia principal avanza desde HTTP hacia el dominio y la persistencia:

```text
request
  -> middleware de Express
  -> route
  -> controller
  -> schema Zod
  -> service
  -> repository o client externo
  -> response
```

Si una capa produce un error, Express lo entrega al middleware centralizado de errores.

## Construcción de Express

`src/app.ts` contiene la fábrica `createApp`. La fábrica permite crear una aplicación con dependencias inyectadas, lo que evita que las pruebas tengan que conectarse a Supabase real.

La aplicación configura:

- ocultamiento de `x-powered-by`;
- headers de seguridad mediante Helmet;
- CORS;
- lectura de cuerpos JSON;
- `/health` para estado básico;
- `/docs` para Swagger UI;
- `/reservas` cuando se inyecta `ReservaService`;
- middleware de ruta no encontrada;
- middleware global de errores.

El orden es importante: las rutas se registran antes de los middlewares de error. De esa manera, una ruta válida puede responder normalmente y una ruta desconocida termina en `notFoundHandler`.

## Modelo de dominio

`src/domain/reserva.ts` define la representación utilizada dentro de M9 y expuesta por la API.

Los estados posibles son:

- `PROGRAMADA`: creada y pendiente de su fecha de activación;
- `ACTIVANDO`: reclamada por un worker que está comunicándose con M5;
- `ACTIVADA`: M5 creó una solicitud y M9 guardó su identificador;
- `CANCELADA`: cancelación lógica solicitada antes de la activación;
- `FALLIDA`: M9 reclamó la reserva, pero M5 no pudo completar la solicitud.

Los vehículos válidos son `AUTO` y `MOTO`.

El dominio usa nombres `camelCase`, como `clienteId` y `fechaHoraProgramada`. La base usa `snake_case`, como `cliente_id` y `fecha_hora_programada`. `src/domain/reserva.mapper.ts` realiza la conversión y comprueba que el estado almacenado pertenezca al conjunto conocido. Una fila con estado nulo o desconocido se considera un error de persistencia.

## Validación de entrada

`src/schemas/reserva.schema.ts` valida los datos antes de llamar al servicio.

Para crear una reserva exige:

- `clienteId` con formato UUID;
- `origen` y `destino` no vacíos y de hasta 500 caracteres;
- vehículo `AUTO` o `MOTO`;
- fecha y hora ISO 8601 con offset;
- fecha estrictamente futura;
- origen distinto de destino.

El esquema es estricto. Por lo tanto, rechaza propiedades adicionales como `estado`, `tarifaEstimada`, `idSolicitud` o timestamps. Esto impide que el consumidor controle campos pertenecientes al backend.

Para actualizar, todos los campos son opcionales, pero debe existir al menos uno. Solo se aceptan origen, destino, vehículo y fecha programada. La validación inicial revisa el cuerpo parcial y el servicio vuelve a validar las reglas sobre la reserva completa resultante.

Los errores relacionados con la fecha se traducen a `FECHA_INVALIDA`. Los demás errores del request se traducen a `DATOS_INVALIDOS`.

## Funcionamiento de los endpoints

### Crear una reserva

El flujo de `POST /reservas` es el siguiente:

1. La ruta delega en el controller.
2. El controller valida el cuerpo con `parseCrearReserva`.
3. `ReservaService.crear` vuelve a proteger las invariantes de fecha y ubicaciones.
4. El servicio consulta a M7 mediante `TarifaClient`.
5. Si M7 responde correctamente, se utilizan su tarifa y moneda.
6. Si M7 falla, la creación continúa con tarifa nula y moneda `ARS`.
7. El repositorio inserta la fila con estado `PROGRAMADA`.
8. Supabase devuelve la fila creada.
9. El mapper la convierte al modelo de API.
10. El controller responde HTTP 201.

La caída de M7 no impide reservar. Esta es una política explícita de degradación controlada.

### Listar reservas

`GET /reservas` delega directamente del controller al servicio y luego al repositorio. Supabase devuelve todas las filas ordenadas por `fecha_hora_programada` en forma ascendente. El resultado se entrega dentro de la propiedad `reservas`.

### Obtener una reserva

`GET /reservas/:id` valida primero que el parámetro sea un UUID. El repositorio busca una sola fila mediante `maybeSingle`. Si no existe, el servicio genera `RESERVA_NO_ENCONTRADA`; si existe, devuelve el objeto de dominio.

### Modificar una reserva

El flujo de `PATCH /reservas/:id` tiene dos niveles de protección:

1. El servicio obtiene la reserva y comprueba que esté `PROGRAMADA`.
2. Combina los campos actuales con los cambios para volver a validar origen, destino y fecha.
3. El repositorio ejecuta la actualización filtrando simultáneamente por ID y estado `PROGRAMADA`.

La tercera condición protege frente a una carrera: aunque la reserva estuviera programada durante la lectura inicial, otra ejecución podría reclamarla antes del update. En ese caso el update no modifica filas y el servicio responde `RESERVA_NO_MODIFICABLE`.

El repositorio también actualiza `actualizado_en`, porque la tabla no posee un trigger por fila que lo haga automáticamente.

### Cancelar una reserva

`DELETE /reservas/:id` no elimina datos físicamente. El servicio comprueba que la reserva exista y esté `PROGRAMADA`; luego el repositorio intenta la transición condicional a `CANCELADA`.

Si el estado cambió entre la lectura y el update, no se modifica ninguna fila y se responde `RESERVA_NO_CANCELABLE`. La fila permanece disponible para auditoría e historial.

## Repositorio Supabase

`src/repositories/reserva.repository.ts` define una interfaz independiente del proveedor de datos. Los servicios conocen este contrato, pero no importan `@supabase/supabase-js`.

`src/repositories/supabase-reserva.repository.ts` implementa el contrato real. Sus operaciones son:

- insertar una reserva;
- buscar por ID;
- listar por fecha;
- actualizar una reserva programada;
- cancelar lógicamente;
- buscar reservas programadas cuya fecha ya venció;
- cambiar de estado únicamente si coincide el estado esperado.

Todos los errores entregados por Supabase se transforman en `ERROR_PERSISTENCIA`. El detalle original queda como causa interna y no se expone en la respuesta HTTP.

El cliente está parametrizado con los tipos de `src/types/database.ts`. Esto permite que TypeScript conozca las columnas, los enums y la nulabilidad del esquema real.

## Uso de la clave Supabase y RLS

M9 es un backend y su scheduler debe procesar reservas pertenecientes a distintos clientes sin una sesión humana. Por eso `SUPABASE_KEY` debe ser una secret key server-side o la clave legacy `service_role`.

Esta credencial opera con privilegios elevados y omite RLS. Debe permanecer solamente en `.env` o en el gestor de secretos del despliegue. Nunca debe enviarse a un navegador, registrarse en logs o versionarse.

RLS continúa habilitado en la tabla. Sus políticas siguen protegiendo accesos realizados con roles públicos o sesiones de usuario, mientras que M9 actúa como componente confiable del servidor.

## Scheduler de reservas

`src/jobs/reservas.scheduler.ts` utiliza `node-cron`. La expresión proviene de `RESERVATION_JOB_INTERVAL` y se valida antes de programar la tarea.

En cada ejecución:

1. Consulta en Supabase hasta 100 reservas en estado `PROGRAMADA`.
2. Solo selecciona filas cuya fecha programada sea menor o igual al instante de ejecución.
3. Ordena las filas desde la más antigua.
4. Intenta activar todas las encontradas.
5. Usa `Promise.allSettled` para que el fallo de una reserva no interrumpa las demás.
6. Devuelve un resumen con encontradas, activadas y no activadas/fallidas.

El scheduler no guarda la lista entre ejecuciones. Si el proceso se reinicia, vuelve a consultar la persistencia y continúa desde el estado almacenado.

## Reclamo concurrente

El paso crítico es `PROGRAMADA -> ACTIVANDO`. `ActivacionReservaService` no decide el ganador mediante una lectura en memoria. Solicita al repositorio un update condicionado por:

- el ID de la reserva;
- el estado esperado `PROGRAMADA`.

Postgres bloquea la fila y vuelve a evaluar la condición del update. Si dos workers intentan reclamar al mismo tiempo, uno actualiza una fila y el otro obtiene cero filas. El worker sin fila devuelve `activada: false` y no llama a M5.

No fue necesaria una RPC porque un único update condicional proporciona la atomicidad requerida.

## Integración con M5

Después de ganar el reclamo:

1. `ActivacionReservaService` entrega la reserva reclamada a `DespachoClient`.
2. `HttpDespachoClient` realiza un POST a `/solicitudes`.
3. La llamada tiene un timeout de tres segundos.
4. La respuesta se valida con Zod y debe contener un UUID de solicitud.
5. Si M5 responde correctamente, el repositorio cambia `ACTIVANDO` a `ACTIVADA` y guarda `id_solicitud`.
6. Si M5 falla, el servicio intenta cambiar `ACTIVANDO` a `FALLIDA` y propaga el error al scheduler.

Marcar `FALLIDA` evita devolver automáticamente la reserva a la cola y realizar reintentos ciegos que podrían duplicar solicitudes en M5.

## Integración con M7

`HttpTarifaClient` realiza un POST a `/tarifas/estimar` con origen, destino y vehículo. También utiliza un timeout de tres segundos y valida que la tarifa sea no negativa y que exista una moneda.

Cualquier error de red, timeout, HTTP no exitoso o respuesta inválida se transforma en `SERVICIO_EXTERNO_NO_DISPONIBLE`. `ReservaService` captura ese error porque la política de negocio permite continuar sin tarifa.

## Manejo de errores

`AppError` reúne tres datos:

- status HTTP;
- código estable de negocio;
- mensaje legible.

`errorHandler` convierte los errores conocidos al contrato público:

```text
error
  codigo
  mensaje
```

Los errores no reconocidos se responden como HTTP 500 con `ERROR_PERSISTENCIA`, sin filtrar stack traces, respuestas de Supabase ni información sensible.

`notFoundHandler` produce `RUTA_NO_ENCONTRADA` cuando ningún endpoint coincide con la solicitud.

## Stubs de M5 y M7

Los stubs permiten ejecutar el sistema sin disponer todavía de los servicios definitivos.

El stub M7:

- expone `/health`;
- recibe `/tarifas/estimar`;
- devuelve una tarifa fija según el tipo de vehículo;
- utiliza `ARS` como moneda.

El stub M5:

- expone `/health`;
- recibe `/solicitudes`;
- genera un UUID de solicitud;
- responde con estado `CREADA`.

Estos stubs verifican el contrato técnico, pero no reproducen reglas completas de tarifas o despacho.

## Docker Compose

La misma imagen contiene M9 y los dos stubs. Cada servicio cambia solamente el comando de inicio:

- `m9-reservas` inicia `dist/server.js`;
- `m5-stub` inicia su servidor específico;
- `m7-stub` inicia su servidor específico.

Los tres servicios comparten `reservas-network`. M9 usa los nombres DNS internos `m5-stub` y `m7-stub`. Los healthchecks hacen que M9 espere hasta que ambos stubs estén saludables. Solo M9 publica un puerto al host; Supabase permanece en la nube.

## Estrategia de pruebas

Las pruebas se dividen en varios niveles:

- pruebas HTTP con Supertest para el CRUD y el contrato de errores;
- pruebas unitarias de `ReservaService`, incluida la caída de M7;
- pruebas del scheduler y de la política `FALLIDA`;
- prueba concurrente con dos intentos de activación y una sola llamada a M5;
- prueba del repositorio que verifica los filtros por ID y estado esperado;
- pruebas HTTP reales contra los stubs M5 y M7;
- prueba live opt-in contra Supabase, habilitada solo mediante `RUN_SUPABASE_INTEGRATION=true`.

Las pruebas habituales usan `InMemoryReservaRepository` únicamente como doble de prueba. Esta implementación no participa del proceso productivo.

## Recorrido rápido por una reserva

Una reserva exitosa atraviesa el sistema de la siguiente forma:

```text
Cliente
  -> POST /reservas
  -> validación
  -> consulta de tarifa M7
  -> INSERT en Supabase como PROGRAMADA
  -> espera persistida
  -> scheduler detecta fecha vencida
  -> update atómico a ACTIVANDO
  -> solicitud a M5
  -> update a ACTIVADA con idSolicitud
```

Si el cliente cancela antes de la fecha, el recorrido termina en `CANCELADA`. Si M5 falla después del reclamo, termina en `FALLIDA`.

## Decisiones y límites relevantes

- La autenticación HTTP no forma parte del alcance actual; `clienteId` todavía llega en el request.
- El backend requiere una credencial Supabase privilegiada y debe protegerse como servicio interno.
- No hay reintentos automáticos de M5 porque primero se necesita un contrato idempotente.
- Una interrupción del proceso durante `ACTIVANDO` puede requerir reconciliación operativa futura.
- Las optimizaciones RLS y el posible índice del scheduler están documentados como backlog, no aplicados silenciosamente.

Para detalles específicos del esquema y riesgos, consultar `docs/SUPABASE_SCHEMA.md` y `docs/RISK_MANAGEMENT.md`.
