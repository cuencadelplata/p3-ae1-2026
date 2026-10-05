# p3-ae1-2026
Paradigmas 3 AE1 2026 - Grupo 10 - M6

# M6: Viajes

Implementación del módulo M6 para los requisitos RF-6.4 y RF-6.7:

 - Finalización de viajes.
 - Historial de transiciones.

La API principal delega las operaciones de tarifa y pagos en APIs externas. Esas APIs se ejecutan en la imagen de dependencias y no forman parte de los endpoints provistos por M6. Para finalizar, M6 consulta a M4 `POST /api/v1/estimate` usando las coordenadas de origen y destino, y envía su distancia y ETA estimados a M7 para cotizar la tarifa. Estas métricas son estimaciones, no mediciones reales del viaje. M6 registra el método de pago y solicita su autorización a M7.

En Docker Compose, `M4_URL` y `M7_URL` permiten configurar las URL base de esos módulos. Por defecto apuntan al simulador local; para M4 la URL base incluye `/api/v1`.

Los viajes y sus historiales se persisten en PostgreSQL mediante el volumen `m6-data` de Docker Compose. Si PostgreSQL o una dependencia HTTP deja de responder, M6 devuelve `503` y el proceso permanece activo; `GET /health` verifica la disponibilidad HTTP del proceso, no la de sus dependencias.

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
cd modulo-6.4-6.7 
```
### Paso 4
Desde la terminal de Visual Studio Code, ubicada en la raíz del proyecto:

```sh
npm install
npm test
```

Para ejecutar los tests end-to-end, que requieren los servicios Docker:

```sh
npm run docker:e2e:up
npm run test:e2e
npm run docker:e2e:down
```

La suite E2E incluye pruebas que detienen y vuelven a iniciar el simulador y PostgreSQL para verificar que el contenedor M6 siga disponible. Requiere Docker Compose y permiso para ejecutar `docker compose stop/start`.

La suite unitaria/de integración local usa puertos efímeros y levanta el servicio M6 y el simulador durante cada prueba. No requiere iniciar Docker.

## Endpoints provistos por la API

La especificación completa se encuentra en [openapi.yaml](openapi.yaml).

### Crear un viaje

`POST /api/viajes`

Crea un viaje en memoria para iniciar su ciclo de vida. Recibe los identificadores del cliente y conductor, el estado inicial, las tarifas configuradas y la hora de inicio. `Esta API se creó por necesidad de simulación, ya que se necesitaría la otra mitad del M6 para cumplir los requerimientos dados.`

Respuesta exitosa: `201 Created`.

### Finalizar un viaje

`POST /api/viajes/{viajeId}/finalizacion`

Implementa RF-6.4. Recibe origen, destino, tipo de vehículo, hora de finalización y método de pago. Obtiene distancia y ETA estimados de M4, consulta la tarifa a M7, registra y autoriza el pago, y cambia el viaje a `completado`. La respuesta identifica la fuente de las métricas y aclara que son estimadas.

Respuesta exitosa: `200 OK`, con el viaje actualizado y el identificador del pago.

### Consultar historial de transiciones

`GET /api/viajes/{viajeId}/historial-transiciones`

Implementa RF-6.7. Devuelve el historial inmutable de cambios de estado registrados para el viaje, incluyendo estado anterior, estado nuevo, fecha y detalle.

Respuesta exitosa: `200 OK`, con la propiedad `historial`.

## Contrato de APIs externas

Estos endpoints son consumidos por M6 para simular dependencias de otros módulos; no son endpoints provistos por nuestra API:

 - M4: `POST /api/v1/estimate`
 - M7: `POST /tarifa/estimacion`
 - M7: `POST /metodo-pago`
 - M7: `POST /metodo-pago/{viajeId}/autorizar`
