# p3-ae1-2026
Paradigmas 3 AE1 2026 - Grupo 10 - M6

# M6: Viajes

Implementación del módulo M6 para los requisitos RF-6.4 a RF-6.7:

 - Finalización de viajes.
 - Cancelación por cliente.
 - Cancelación por conductor.
 - Historial de transiciones.

La API principal delega las operaciones de tarifa, pagos y despacho en APIs externas. Esas APIs se ejecutan en la imagen de dependencias y no forman parte de los endpoints provistos por M6.

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

La suite unitaria/de integración local usa puertos efímeros y levanta el servicio M6 y el simulador durante cada prueba. No requiere iniciar Docker.

## Endpoints provistos por la API

La especificación completa se encuentra en [openapi.yaml](openapi.yaml).

### Crear un viaje

`POST /api/viajes`

Crea un viaje en memoria para iniciar su ciclo de vida. Recibe los identificadores del cliente y conductor, el estado inicial, las tarifas configuradas y la hora de inicio. `Esta API se creó por necesidad de simulación, ya que se necesitaría la otra mitad del M6 para cumplir los requerimientos dados.`

Respuesta exitosa: `201 Created`.

### Finalizar un viaje

`POST /api/viajes/{viajeId}/finalizacion`

Implementa RF-6.4. Registra el tiempo, la distancia, la hora de finalización y el método de pago. Consulta la estimación de tarifa a la API externa, cambia el viaje a `completado` y solicita la captura del pago.

Respuesta exitosa: `200 OK`, con el viaje actualizado y el identificador del pago.

### Cancelar por cliente

`POST /api/viajes/{viajeId}/cancelacion-cliente`

Implementa RF-6.5. Cancela el viaje por solicitud del cliente, registra el motivo y consulta a la API externa el eventual cargo de cancelación.

Respuesta exitosa: `200 OK`, con el viaje cancelado.

### Cancelar por conductor

`POST /api/viajes/{viajeId}/cancelacion-conductor`

Implementa RF-6.6. Registra el motivo de la cancelación por parte del conductor y solicita a la API de despacho que retorne el cliente al proceso de búsqueda.

Respuesta exitosa: `200 OK`, con el viaje cancelado y el resultado del retorno al despacho.

### Consultar historial de transiciones

`GET /api/viajes/{viajeId}/historial-transiciones`

Implementa RF-6.7. Devuelve el historial inmutable de cambios de estado registrados para el viaje, incluyendo estado anterior, estado nuevo, fecha y detalle.

Respuesta exitosa: `200 OK`, con la propiedad `historial`.

## Contrato de APIs externas

Estos endpoints son consumidos por M6 para simular dependencias de otros módulos; no son endpoints provistos por nuestra API:

 - `POST /api/tarifas/estimacion`
 - `POST /api/tarifas/cargo-cancelacion`
 - `POST /api/pagos/captura`
 - `POST /api/despacho/reabrir`
