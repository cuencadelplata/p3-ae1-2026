# p3-ae1-2026
Paradigmas 3 AE1 2026 - Grupo 10 - M6

# M6: Viajes

Implementación del módulo M6 para cancelación de viajes:

 - Cancelación por cliente.
 - Cancelación por conductor.

La API consulta y actualiza viajes en el servicio RF-6 mediante `RF6_API_URL`, y publica eventos de cancelación en RabbitMQ mediante `RABBITMQ_URL`.

## Ejecutar los tests

### Paso 1
Primero, abra Visual Studio Code, luego, presione F1, escriba `Git: Clone` y presione enter, pegue el siguiente link:

`https://github.com/cuencadelplata/p3-ae1-2026.git`

Una vez el repositorio se haya clonado, deberá moverse a la rama correspondiente. Presione F1 nuevamente y escriba 
Git: `Checkout to...`, presione enter y seleccione la rama `Grupo10-M6-Mordka-Mortola`

### Paso 2

Cuando se hayan descargado todos los archivos, vaya arriba a la izquierda `Terminal` -> `New Terminal`

### Paso 3

ahora tenesmos que ubicarnos en la raiz del proyecto, para eso ejecute el siguiente comando

```sh
cd modulo-6.5-6.6
```
### Paso 4
Desde la terminal de Visual Studio Code, ubicada en la raíz del proyecto:

```sh
npm install
npm test
```

Para iniciar la API y RabbitMQ:

```sh
npm run docker:up
npm run docker:down
```

La suite unitaria usa dobles inyectables para RF-6 y RabbitMQ. No requiere Docker.

Para ejecutar el simulador HTTP RF-6 local, desde esta carpeta:

```sh
npm run simulator:rf6
```

El simulador escucha en el puerto `3000` (configurable con `PORT`) y soporta crear,
consultar, asignar y cancelar viajes usando los contratos documentados en
`simulator/m6-rf6.5-rf6.6/rf-6-apis.yaml`. En la cancelación por conductor, M6
publica el evento `cancelacion_conductor` en la cola `despacho.reabrir`, que es la
cola consumida por la rama `ae2/lautaro-romero`.

Para simular también el consumidor M5 de esa rama, con RabbitMQ disponible:

```sh
npm run simulator:m5
```

El simulador M5 escucha en el puerto `3002` (`M5_SIMULATOR_PORT`) y en la cola
`despacho.reabrir`. Antes de cancelar, se puede registrar una solicitud asignada:

```sh
curl -X POST http://localhost:3002/simulator/requests \
	-H 'content-type: application/json' \
	-d '{"viajeId":"viaje-123","clienteId":"cliente-123","conductorId":"conductor-123"}'
```

Luego de cancelar ese viaje desde M6, `GET
http://localhost:3002/simulator/requests/viaje-123` permite verificar que volvió a
`SEARCHING`, se limpió el conductor asignado y se excluyó al conductor que canceló.

Para ejecutar los tests e2e se necesita tener disponible el servicio RF-6 en
`RF6_API_URL` y RabbitMQ en `RABBITMQ_URL`. Por defecto usan `http://127.0.0.1:3000`
y `amqp://127.0.0.1:5672`; la API M6 se espera en `E2E_API_URL`, por defecto
`http://127.0.0.1:3001`.

```sh
RF6_API_URL=http://127.0.0.1:3000 \
RABBITMQ_URL=amqp://127.0.0.1:5672 \
E2E_API_URL=http://127.0.0.1:3001 \
pnpm test:e2e
```

## Endpoints provistos por la API

La especificación completa se encuentra en [docs/m6-rf6.5-rf6.6/openapi.yaml](docs/m6-rf6.5-rf6.6/openapi.yaml).

### Cancelar por cliente

`POST /api/viajes/{viajeId}/cancelacion-cliente`

Consulta el viaje en RF-6, valida que esté en `SOLICITADO` o `CONDUCTOR_EN_CAMINO`, solicita el cambio a `CANCELADO` y publica `cancelacion_cliente` en RabbitMQ.

Respuesta exitosa: `200 OK`, con el viaje cancelado.

### Cancelar por conductor

`POST /api/viajes/{viajeId}/cancelacion-conductor`

Consulta y actualiza el viaje en RF-6 y publica `despacho.reabrir` en RabbitMQ para que despacho retorne al cliente al proceso de búsqueda.

Respuesta exitosa: `200 OK`, con el viaje cancelado y el resultado del retorno al despacho.

## Variables de entorno

 - `RF6_API_URL`: URL base de RF-6. Por defecto: `http://localhost:3000`.
 - `RABBITMQ_URL`: URL del broker. Por defecto: `amqp://rabbitmq:5672`.
 - `PORT`: puerto de esta API. Por defecto: `3001`.

El contrato consumido por esta API se documenta en [simulator/m6-rf6.5-rf6.6/rf-6-apis.yaml](simulator/m6-rf6.5-rf6.6/rf-6-apis.yaml). El directorio conserva ese contrato, pero ya no contiene un servidor simulador.
