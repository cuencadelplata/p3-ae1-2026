# Comandos para demostrar el Modulo 4

Esta guia permite mostrar, en orden, los tests, el contenedor Docker, la interfaz grafica, la documentacion Scalar y algunos endpoints de la API.

## 1. Abrir el proyecto

Ejecutar en PowerShell o en la terminal de Visual Studio Code:

```powershell
cd "C:\Users\Juan Cruz\OneDrive\Desktop\Facultad\Paradigmas III\modulo-4"
```

Este comando posiciona la terminal dentro de la carpeta del Modulo 4. Los siguientes comandos deben ejecutarse desde esta ubicacion.

## 2. Construir la imagen y ejecutar los tests

```powershell
docker build --no-cache --progress=plain -t segocodee/p3-m4-ubicacion:1.3.0 .
```

Docker instala las dependencias, ejecuta automaticamente los tests, compila el codigo TypeScript y crea la imagen de la API `segocodee/p3-m4-ubicacion:1.3.0`.

La opcion `--no-cache` obliga a Docker a ejecutar nuevamente todos los pasos, aunque la imagen se haya construido antes. La opcion `--progress=plain` muestra la salida completa en la terminal. De esta manera, los resultados de los tests quedan visibles para la demostracion y la captura. Este proceso puede tardar algunos minutos.

Antes de continuar, comprobar que aparezca un resultado similar a este:

```text
Test Files  2 passed (2)
Tests       19 passed (19)
```

Este es el mejor momento para sacar la captura de los tests aprobados.

Si el paso `RUN pnpm test` aparece como `CACHED`, se ejecuto el comando sin `--no-cache`. En ese caso, repetir exactamente el comando indicado arriba para que Docker vuelva a correr los tests y muestre el resultado.

## 3. Iniciar la API y la UI separadas

Para demostrar que las imagenes estan publicadas y se pueden descargar desde Docker Hub:

```powershell
docker compose pull
docker compose up -d --no-build
```

El primer comando descarga las versiones publicadas. El segundo inicia exactamente esas imagenes, sin construirlas desde el codigo local.

Como alternativa, durante el desarrollo se pueden reconstruir ambas imagenes localmente:

```powershell
docker compose up --build -d
```

Este comando crea e inicia dos aplicaciones en segundo plano: `m4-api` para la API REST y `m4-ui` para la interfaz grafica. Cada una utiliza su propio proyecto, imagen y contenedor.

## 4. Comprobar el estado del contenedor

```powershell
docker compose ps
```

Muestra los contenedores activos. Deben aparecer `m4-api` y `m4-ui` con estado saludable.

Tambien se puede consultar directamente la salud de la API:

```powershell
Invoke-RestMethod http://localhost:3004/health
```

Debe responder con estado `ok` y el nombre `m4-location-service`.

## 5. Mostrar la interfaz grafica

Abrir en el navegador:

```text
http://localhost:8084
```

La interfaz se ejecuta en un contenedor independiente y consume los endpoints reales de la API por HTTP. Para hacer una demostracion rapida:

1. Presionar **Cargar 2 demos** para registrar un auto y una moto.
2. Presionar **Buscar candidatos** para buscar autos cercanos.
3. Mostrar que aparece `driver-auto`, junto con su distancia y ETA.
4. Presionar **Marcar no disponible**.
5. Buscar nuevamente y mostrar que el conductor deja de ser candidato.

Las ubicaciones son temporales y vencen despues de 60 segundos. Si vencen durante la demostracion, volver a presionar **Cargar 2 demos**.

## 6. Mostrar Scalar y el contrato OpenAPI

Abrir la documentacion interactiva:

```text
http://localhost:3004/docs
```

Scalar muestra los siete endpoints, sus parametros, cuerpos y respuestas. La documentacion se sirve desde la propia aplicacion y no depende de Swagger Online.

El archivo OpenAPI original tambien se puede abrir en:

```text
http://localhost:3004/openapi/openapi-m4.yaml
```

## 7. Probar los endpoints desde PowerShell

### Publicar la ubicacion de un conductor

```powershell
Invoke-RestMethod -Method Put -Uri "http://localhost:3004/api/v1/drivers/profe-demo/location" -ContentType "application/json" -Body '{"latitude":-27.4692,"longitude":-58.8306,"vehicleType":"AUTO"}'
```

Llama al endpoint `PUT /drivers/{driverId}/location`. Registra a `profe-demo` como conductor disponible, con vehiculo tipo auto y una ubicacion cercana a la facultad.

### Consultar su ubicacion

```powershell
Invoke-RestMethod http://localhost:3004/api/v1/drivers/profe-demo/location
```

Llama al endpoint `GET /drivers/{driverId}/location` y devuelve la ubicacion temporal que se acaba de guardar.

### Buscar conductores cercanos

```powershell
Invoke-RestMethod "http://localhost:3004/api/v1/drivers/nearby?latitude=-27.4692&longitude=-58.8306&vehicleType=AUTO&radiusKm=5" | ConvertTo-Json -Depth 5
```

Llama al endpoint `GET /drivers/nearby`. Busca autos disponibles dentro de un radio de 5 km, los ordena por distancia y calcula su ETA. En la respuesta debe aparecer `profe-demo`.

### Cambiar su disponibilidad

```powershell
Invoke-RestMethod -Method Patch -Uri "http://localhost:3004/api/v1/drivers/profe-demo/availability" -ContentType "application/json" -Body '{"available":false}'
```

Llama al endpoint `PATCH /drivers/{driverId}/availability`. El conductor conserva su ubicacion, pero ya no debe aparecer en una nueva busqueda de candidatos.

## 8. Mostrar los logs

```powershell
docker compose logs
```

Muestra la salida generada por el servicio dentro del contenedor.

## 9. Finalizar la demostracion

```powershell
docker compose down
```

Detiene y elimina los dos contenedores y su red interna, pero conserva las imagenes construidas.

## Resumen para explicar oralmente

El Modulo 4 administra ubicaciones temporales y disponibilidad de conductores. Permite registrar y consultar ubicaciones, buscar candidatos cercanos por tipo de vehiculo, cambiar su disponibilidad, geocodificar direcciones simuladas y estimar distancia y tiempo de llegada. La interfaz grafica utiliza la misma API REST documentada localmente con OpenAPI y Scalar.
