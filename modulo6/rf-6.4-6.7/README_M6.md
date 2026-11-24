# p3-ae1-2026
Paradigmas 3 AE1 2026 - Grupo 10 - M6

# M6: Viajes

Fachada compatible para los requisitos RF-6.4 y RF-6.7:

 - Finalización de viajes.
 - Historial de transiciones.

El módulo no mantiene un modelo, historial ni base de datos propios para viajes. El módulo central `modulo6/src/rf-6.1-6.2-6.3` es la única fuente de verdad y es responsable del ciclo de vida, la persistencia, las llamadas a M4/M7 y el historial. Esta API conserva las rutas RF-6.4/6.7 como fachada HTTP que reenvía solicitudes y respuestas a Viajes.

`RF6_API_URL` configura la URL base del módulo central (por defecto `http://127.0.0.1:3000`). La fachada responde en su propio puerto; el Compose de integración publica Viajes en `3000` y la fachada en `3002`.

La creación de viajes se reenvía al módulo central y solo admite un estado inicial `SOLICITADO`. Los estados no se pueden fijar arbitrariamente desde esta fachada. Finalización e historial se delegan al mismo viaje central. `GET /health` comprueba la disponibilidad del proceso de la fachada, no la de Viajes ni sus dependencias.

## Imágenes Docker Hub

Las imágenes publicadas están disponibles en:

 - [Código principal M6](https://hub.docker.com/repository/docker/mordkalucas/p3-ae1-2026_g10-m6/general)
 - [Dependencias simuladas](https://hub.docker.com/repository/docker/mordkalucas/p3-ae1-2026_g10-m6-dependencies/general)

Para descargar la versión `2.0` desde la terminal integrada de VS Code:

```sh
docker pull mordkalucas/p3-ae1-2026_g10-m6:2.0
docker pull mordkalucas/p3-ae1-2026_g10-m6-dependencies:2.0
```

Para comprobar que ambas imágenes quedaron instaladas localmente:

```sh
docker image ls mordkalucas/p3-ae1-2026_g10-m6
docker image ls mordkalucas/p3-ae1-2026_g10-m6-dependencies
```

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
cd modulo6
```
### Paso 4
Desde la terminal de Visual Studio Code, ubicada en la raíz del proyecto:

```sh
npm ci
npm run test:rf-6.4-6.7
```

Para ejecutar los tests end-to-end, primero levanta M6 desde esta carpeta. El entorno requiere M7 real (`M7_URL`, `M7_API_KEY`), M8 real (`QR_INTERNAL_API_KEY`) y la red externa M1 configurada por el equipo de M1. Solo M3/M4 quedan simulados en M6.

```sh
npm run docker:e2e:up
```

Luego, desde `modulo8/`, levanta M8 junto con su overlay de integración y el override de puertos alojado en M6:

```sh
docker compose --env-file .env -f compose.yaml -f compose.integracion-real.yaml -f ../modulo6/docker-compose.m8-hostports.yml up -d --build --wait
```

Configura `M8_URL=http://m8-app:3000`, `M8_TEST_URL=http://localhost:3103` y `M8_QR_API_KEY` con el mismo valor de `QR_INTERNAL_API_KEY` al ejecutar el harness E2E.

```sh
npm run test:e2e:rf-6.4-6.7
npm run docker:e2e:down
```

Las suites E2E validan M6 contra servicios reales o proveedores externos E2E configurados por Docker Compose.

La suite unitaria usa dobles inyectables para la API central y no requiere Docker.

## Endpoints provistos por la API

La especificación completa se encuentra en el [OpenAPI consolidado](../openapi.yaml).

### Crear un viaje

`POST /api/viajes`

Reenvía la solicitud al módulo central. Recibe `clienteId`, `origen` y `destino`; la respuesta conserva la envoltura histórica `{ "viaje": ... }`. El ID lo genera Viajes y el estado inicial siempre es `SOLICITADO`.

Respuesta exitosa: `201 Created`.

### Finalizar un viaje

`POST /api/viajes/{viajeId}/finalizacion`

Implementa la fachada de RF-6.4. Reenvía la solicitud y devuelve sin transformar el status ni el JSON producido por Viajes. El módulo central obtiene las métricas y gestiona la tarifa y el pago.

Respuesta exitosa: `200 OK`, con el viaje actualizado y el identificador del pago.

### Consultar historial de transiciones

`GET /api/viajes/{viajeId}/historial-transiciones`

Implementa la fachada de RF-6.7. Devuelve sin transformar el historial de cambios de estado registrado por Viajes, incluyendo estado anterior, estado nuevo, fecha y detalle.

Respuesta exitosa: `200 OK`, con la propiedad `historial`.

## Entorno de integración

M6 consume M3, M4, M7 y M8 mediante sus APIs reales. Las URLs se configuran con `M3_URL`, `M4_URL`, `M7_URL` y `M8_URL`.

En ejecución normal, estas responsabilidades y sus datos pertenecen al módulo central, no a esta fachada.

M6 consume M3/M4/M7/M8 mediante sus APIs reales configuradas por entorno. No incluye proveedores simulados internos.
