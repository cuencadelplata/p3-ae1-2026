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
- M3, M5 y M6 se representan mediante contratos; la integracion completa corresponde a una evolucion posterior.
- RabbitMQ y los flujos de disponibilidad con M5/M6 corresponden a la parte asignada a Manuel.
