# M4 - Ubicacion y Disponibilidad

API REST del Modulo 4 de la plataforma de movilidad urbana. Esta aplicacion administra ubicaciones temporales y disponibilidad de conductores. La interfaz grafica se encuentra en `./ui` y se ejecuta en otro contenedor.

Version actual de la API: `2.0.0`.

## Avance AE2 - parte de Juan Tomas Segovia

- RF-4.1: las actualizaciones se guardan en Redis en lugar de un `Map` local.
- RF-4.3: Redis elimina automaticamente cada ubicacion al terminar su TTL.
- Concurrencia: un script atomico evita que una ubicacion vieja reemplace una mas nueva.
- Idempotencia: repetir la misma actualizacion conserva un unico estado consistente.
- El healthcheck comprueba tambien que Redis se encuentre disponible.

## Alcance AE1

- RF-4.1: actualizacion de ubicacion con marca temporal.
- RF-4.2: busqueda por cercania, disponibilidad y tipo AUTO/MOTO.
- RF-4.3: vencimiento automatico mediante TTL.
- RF-4.4: geocodificador simulado.
- RF-4.5: distancia Haversine y ETA urbana aproximada.
- Extension: eliminacion explicita de ubicacion para cierre de sesion.
- Concurrencia: una actualizacion atrasada no puede sobrescribir una ubicacion mas reciente.

## Arquitectura y propiedad de datos

La API es dueña solamente del estado efimero de ubicacion: `driverId`, coordenadas, tipo de vehiculo, disponibilidad, `updatedAt` y `expiresAt`. No almacena perfiles, solicitudes ni viajes.

- M3 es dueño del perfil y vehiculo del conductor.
- M5 consulta candidatos cercanos y puede cambiar su disponibilidad.
- M6 puede informar cambios de disponibilidad al iniciar o finalizar un viaje.

En AE2 Redis es la fuente de verdad para las ubicaciones temporales. La API no consulta bases de datos de otros modulos.

Cada conductor se guarda con una clave de este formato:

```text
driver:{driverId}:location
```

El valor contiene las coordenadas, tipo de vehiculo, disponibilidad, `updatedAt` y `expiresAt`. La comparacion de `updatedAt` y el guardado se realizan en una unica operacion atomica de Redis.

Los diagramas se encuentran en [docs/arquitectura.md](docs/arquitectura.md).

## Ejecutar con Docker Compose

Desde esta carpeta, descargar y ejecutar las imagenes publicadas en Docker Hub:

```bash
docker compose pull
docker compose up -d --no-build
```

Para reconstruirlas desde el codigo fuente durante el desarrollo:

```bash
docker compose up --build -d
```

- UI independiente: `http://localhost:8084`
- API: `http://localhost:3004`
- Redis: servicio interno `redis:6379` (no se publica fuera de Docker)
- Health check: `http://localhost:3004/health`
- Scalar: `http://localhost:3004/docs`
- OpenAPI: `http://localhost:3004/openapi/openapi-m4.yaml`

Para detener todo:

```bash
docker compose down
```

### Integracion con todos los modulos

El archivo `compose.integration.yml` agrega solamente la API, la interfaz demostrativa y la base PostgreSQL exclusiva de M4. No crea Redis ni RabbitMQ: utiliza los servicios compartidos llamados `redis` y `rabbitmq` dentro de la red del Compose general.

Las conexiones se pueden reemplazar sin modificar codigo:

```env
REDIS_URL=redis://redis:6379
RABBITMQ_URL=amqp://guest:guest@rabbitmq:5672
POSTGRES_URL=postgres://postgres:postgres@m4-postgres:5432/m4_locations
```

Al incorporarlo al Compose raiz, `m4-postgres` conserva su propio volumen y no publica el puerto 5432 en la maquina anfitriona. Los puertos 6379, 5672 y 15672 deben publicarse una sola vez desde los servicios compartidos.

La demostracion detallada esta en [comandos.md](comandos.md).

## Desarrollo y pruebas

Requiere Node.js 22 y pnpm 10.18.3:

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm test
pnpm run build
```

El Dockerfile tambien ejecuta todos los tests durante la construccion y cancela el build si alguno falla.

## Prueba de punta a punta con M1 y M5

Desde `modulo-4`, ejecutá:

```bash
docker compose -p m4-e2e -f docker-compose.yml -f compose.e2e.yml \
  up --build --exit-code-from m4-e2e m4-e2e
```

La prueba arranca M1, M4 y M5 en una red de Docker separada. Registra un conductor
y un pasajero en M1. Comprueba que M4 exige autenticación para publicar ubicación
y verifica que el conductor aparezca en la búsqueda y en su historial.
El pasajero solicita un viaje en M5 con su token de M1 y se comprueba que M5
encuentra a ese mismo conductor consultando M4. Al terminar, se borra la ubicación
activa.

M1 usa una base temporal y M4 usa Redis y PostgreSQL. M5 usa su almacenamiento
en memoria para las solicitudes de este escenario y su estimador local de tarifas.
El recorrido llega hasta la búsqueda de candidatos en M5.

Para eliminar los contenedores y volúmenes de este escenario de prueba:

```bash
docker compose -p m4-e2e -f docker-compose.yml -f compose.e2e.yml down -v
```

## Rendimiento con k6 y Grafana Cloud

Las pruebas de rendimiento se encuentran en [`k6/`](k6/README.md) y se ejecutan en un contenedor opcional para no mezclar el generador de carga con la API.

Prueba minima:

```bash
docker compose --profile performance run --rm k6 run /scripts/smoke.js
```

Prueba de carga de conductores cercanos:

```bash
docker compose --profile performance run --rm k6 run /scripts/load-nearby.js
```

Los mismos resultados pueden enviarse a Grafana Cloud mediante `k6 cloud run --local-execution`. El token y la URL del stack se reciben exclusivamente por variables de entorno y no se guardan en el repositorio.

## Imagenes publicadas

- API: [segocodee/p3-m4-ubicacion](https://hub.docker.com/r/segocodee/p3-m4-ubicacion), version de trabajo `2.0.0`.
- UI: [segocodee/p3-m4-ui](https://hub.docker.com/r/segocodee/p3-m4-ui), version `1.0.0` y etiqueta `latest`.
- Repositorio: [branch M4-Ubicacion-disponibilidad](https://github.com/cuencadelplata/p3-ae1-2026/tree/M4-Ubicacion-disponibilidad).

## Configuracion

- `PORT`: puerto interno de la API, valor predeterminado `3004`.
- `LOCATION_TTL_SECONDS`: vigencia de una ubicacion, valor predeterminado `60`.
- `REDIS_URL`: conexion a Redis, valor local predeterminado `redis://127.0.0.1:6379`.
- RabbitMQ se conecta con reintentos durante el arranque para evitar fallos transitorios entre contenedores.

## Limitaciones conocidas

- El geocodificador conoce solamente direcciones de demostracion.
- El E2E verifica los recorridos descritos abajo con servicios reales. No cubre todavía todos los módulos ni todos los casos de error.
- RabbitMQ y los flujos de disponibilidad con M5/M6 corresponden a la parte asignada a Manuel.

### Ejecutar el E2E contra el Compose general

Con M1, M4 y M5 del Compose raíz saludables, ejecutar desde la raíz:

```bash
M1_E2E_URL=http://localhost:10000 \
M4_E2E_URL=http://localhost:3004/api/v1 \
M5_E2E_URL=http://localhost:3005/api/v1 \
node --test modulo-4/tests/e2e/driver-location.e2e.mjs
```

Ajustar los puertos si el entorno utiliza otros. La prueba usa el token real
de M1 también para solicitar candidatos en M5. Al finalizar elimina la ubicación
activa y cancela la solicitud de viaje. Las cuentas y el historial generados son
datos de prueba que permanecen en las bases del entorno.

Verificación del 24 de noviembre de 2026: recorrido aprobado sobre main 021eb207,
con M1, M4, M5 y sus dependencias del Compose general. Para esta ejecución se
usaron una red propia y puertos 13001, 13004 y 13005, con JWT compartido generado
localmente y validación de autenticación habilitada. Resultado: 1 prueba aprobada,
0 fallidas. El recorrido termina en la búsqueda de candidatos de M5.

### Verificación opcional del ciclo de viaje con M6

Agregar M6_E2E_URL y M3_E2E_URL a las variables del comando E2E, por ejemplo
M6_E2E_URL=http://localhost:15000 y M3_E2E_URL=http://localhost:15003.
El segundo caso requiere M3, M6, M8 y M7 operativos además de M1, M4 y M5.
Si falta alguna de esas dos variables, Node informa el segundo caso como omitido.

El test registra un conductor en M3 y lo habilita mediante su API. Un pasajero
nuevo solicita el viaje en M5; se envía una oferta al conductor y este la acepta
con su token de M1. El test verifica que M5 haya creado y asignado un único viaje
en M6 para ese pasajero. Luego registra el arribo, obtiene un QR real de M8 y
lo valida al iniciar. Comprueba que M4 recibe el evento RabbitMQ y retira al
conductor de nearby. Finalmente solicita la finalización en efectivo con M7 y
espera que M4 vuelva a ofrecer al conductor como disponible.

Verificación ampliada del 24 de noviembre de 2026:
- Dos pruebas aprobadas, cero fallidas y cero omitidas contra el Compose común.
- M5 creó el viaje en M6 a partir de la aceptación; no se creó desde el test.
- M3 respondió con habilitación activa. El log de M6 confirmó que guardó el
  estado del conductor en caché tras consultarlo a M3.
- M3 usa su fallback de persistencia en memoria cuando no se configura Supabase;
  esta ejecución verifica su API y Redis, no su base de datos externa.
- Todos los cambios del test y esta documentación permanecen dentro de modulo-4.

La verificación anterior, antes de ampliar el recorrido, quedó registrada así:

Resultado del 24 de noviembre de 2026:
- PR #66 fusionado y recorrido M1-M4-M5 aprobado.
- M6 con su base y M8 con su base levantaron usando el Compose común.
- Se configuraron claves internas locales de M2 y QR para el arranque de M8.
- Arribo con QR real, inicio del viaje y cambio de disponibilidad en M4 aprobados.
- M3 no estaba levantado. M6 permitió el arribo por su comportamiento de resiliencia.
- Finalización en efectivo aprobada con M7 y su configuración privada de Supabase.
- M4 recibió viaje.finalizado y el conductor volvió a aparecer en nearby.
- Resultado de la ejecución completa: 2 pruebas aprobadas, 0 fallidas, 0 omitidas.
- La imagen aylen0/m7-tarifas-ae2:latest requiere DATABASE_URL, SUPABASE_URL,
  SUPABASE_KEY, M7_API_KEY y MP_ACCESS_TOKEN para arrancar. La conexión corresponde
  al entorno de prueba entregado por M7. El caso en efectivo se ejecutó con un
  valor de prueba de MP_ACCESS_TOKEN y no realiza autorización de tarjeta.
- En Apple Silicon se ejecutó M7 con plataforma linux/amd64.

Las claves privadas del entorno están fuera de Git. El test opcional comprueba el cambio de disponibilidad al iniciar y finalizar el viaje.

### Ejecutar el ciclo integrado enteramente en Docker

Con los servicios M1, M3, M4, M5, M6, M7 y M8 y sus dependencias ya levantados
desde el Compose raíz, ejecutar desde la raíz del repositorio:

```bash
docker compose -f docker-compose.yml -f modulo-4/compose.e2e-general.yml \
  --profile tests run --rm --no-deps m4-e2e-ciclo
```

Este complemento agrega solamente el contenedor que ejecuta los tests. Usa la
red `reservas-network` y los nombres internos de los servicios; no requiere
Node instalado en la computadora ni usa puertos publicados para las peticiones.
No levanta ni reconstruye los demás servicios. Si están apagados o mal
configurados, el test falla. No requiere tokens de Grafana: es una prueba
funcional, independiente de las pruebas de carga de k6.

Las credenciales privadas de M7 y las claves compartidas del Compose general
deben estar configuradas localmente antes de levantar los servicios. El test
crea usuarios y registros de prueba, habilita un conductor nuevo en M3 y
finaliza un viaje en efectivo; ejecutarlo en un entorno de prueba. El resultado
esperado es `pass 3`, `fail 0`, `skipped 0`. El contenedor se elimina al terminar,
pero las cuentas y el historial creados permanecen en las bases de los módulos.

Verificado el 24 de noviembre de 2026 en el proyecto aislado
`m4-integration-check`, con el mismo complemento y una red local de prueba:
2 pruebas aprobadas, 0 fallidas y 0 omitidas. Duración total: 3,75 segundos.

### Cancelación integrada antes del inicio

El tercer E2E crea usuarios reales en M1, publica una ubicación en M4 y acepta
una oferta en M5 para crear y asignar el viaje en M6. Como M6 sólo permite
cancelar antes del inicio, el test prepara explícitamente el conductor reservado
con `PATCH /api/v1/drivers/:id/availability` y `available: false`. Esta preparación
no verifica que la asignación de M5 reserve automáticamente al conductor.

Luego llama a `PATCH /api/viajes/:id/cancelacion` con actor `cliente` y motivo.
Comprueba el estado `CANCELADO`, espera que el evento real `viaje.cancelado` de
M6 llegue a M4 por RabbitMQ y verifica que el conductor vuelva a `nearby`,
conservando sus coordenadas. Repetir la cancelación debe responder HTTP 400 y
mantenerlo disponible. No se publica un evento artificial desde el test.

Verificación del 24 de noviembre de 2026: tres pruebas ejecutadas dentro de
Docker, tres aprobadas, cero fallidas y cero omitidas (2,81 segundos).
La prueba de cancelación usa M1, M4, M5, M6, Redis, PostgreSQL y RabbitMQ;
no comprueba cargos por cancelación ni entrega de notificaciones de M8.

### Geocodificación integrada con M2

La interfaz actual de M2 muestra perfiles e historial, no una pantalla para
solicitar viajes. Su conexión directa con M4 es el servicio de geocodificación:
`GET /api/v1/geocodificacion?q=...` de M2 llama a `POST /api/v1/geocode` de M4
y adapta la respuesta a `{data: [{direccion, latitud, longitud}]}`.

Con M1, M2 (gateway, API y base) y M4 levantados en el Compose general, ejecutar
desde la raíz:

```bash
docker compose -f docker-compose.yml -f modulo-4/compose.e2e-general.yml \
  --profile tests run --rm --no-deps m4-e2e-m2
```

El caso `tests/e2e/geocoding-m2.e2e.mjs` registra e inicia sesión de un pasajero
en M1, comprueba que M2 rechaza consultas sin token y compara las coordenadas
del Obelisco consultadas directamente en M4 con las devueltas por M2. Exige
`provider: EXTERNAL_HTTP`: no acepta el geocodificador simulado. Requiere salida
a Internet y disponibilidad del proveedor público; el timeout de M2 es de dos
segundos. Una falla externa puede hacer fallar esta comprobación aunque la
lógica local no haya cambiado. Se ejecuta por separado del ciclo de viajes.

Verificado el 24 de noviembre de 2026 con la imagen publicada de M2 y el
proveedor externo de M4: una prueba aprobada, cero fallidas y cero omitidas
(2,24 segundos). Esta verificación es de API; no automatiza el navegador ni
comprueba una pantalla de solicitud de viajes. La cuenta de prueba permanece
en M1. Las funciones comunes de petición y login están en `tests/e2e/helpers.mjs`.
