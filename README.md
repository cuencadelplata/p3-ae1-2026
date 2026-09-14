# Módulo 2 — Clientes · AE1 · Grupo 01

Proyecto de Paradigmas de Programación III, Ingeniería en Sistemas de Información, Universidad de la Cuenca del Plata.

**Versión:** 1.0.0.

Esta entrega implementa:

- **RF-2.2:** direcciones frecuentes.
- **RF-2.4:** calificación del conductor.

La identidad del cliente y la consulta de viajes se simulan para ejecutar el módulo de manera independiente.

Esta guía explica cómo configurar, ejecutar y comprobar el proyecto en Windows con Visual Studio Code y Docker Desktop.

## 1. Requisitos previos

- Visual Studio Code.
- Docker Desktop iniciado y configurado para utilizar contenedores Linux.
- Docker Compose v2.
- Conexión a Internet durante la primera construcción para descargar la imagen base y las dependencias.

No es necesario instalar Node.js, npm ni SQLite en Windows. Docker prepara el entorno dentro del contenedor.

## 2. Abrir el proyecto

1. Descargar y extraer el ZIP del repositorio.
2. Abrir Visual Studio Code.
3. Seleccionar **Archivo → Abrir carpeta**.
4. Abrir la carpeta que contiene `compose.yaml`, `Dockerfile` y `package.json`.
5. Seleccionar **Terminal → Nueva terminal** y utilizar PowerShell.

Todos los comandos siguientes se ejecutan desde esa carpeta.

## 3. Comprobar Docker

Con Docker Desktop iniciado, ejecutar:

```powershell
docker info
docker compose version
```

El primer comando debe mostrar información del motor sin errores de conexión. El segundo debe mostrar la versión de Docker Compose.

## 4. Configuración y variables de entorno

El proyecto ya incluye la configuración necesaria para iniciarse. No es necesario crear un archivo `.env`.

Las siguientes variables están definidas en `compose.yaml`:

- **PORT:** `3000`. Puerto donde escucha la aplicación dentro del contenedor.
- **DB_PATH:** `/app/data/customer.sqlite`. Ubicación de la base SQLite.
- **CLIENTE_SIMULADO:** `cliente-1`. Identidad fija utilizada para la demostración.

La etapa de ejecución del `Dockerfile` también define:

- **NODE_ENV:** `production`. Modo de ejecución de la aplicación.

`CLIENTE_SIMULADO` no es una contraseña ni un token y no autentica personas. Con la configuración inicial, utilizar `cliente-1` en las operaciones de Swagger que soliciten el identificador del cliente.

### Puertos y persistencia

El mapeo `3000:3000` publica la aplicación en el puerto 3000 de Windows:

- El primer número corresponde al puerto de Windows.
- El segundo corresponde al puerto del contenedor.

El volumen `datos-clientes` se monta en `/app/data` y conserva la base de datos.

### Cambiar la configuración

Para utilizar otro puerto de Windows, cambiar el mapeo a `3001:3000`, por ejemplo. En ese caso, acceder a la aplicación mediante el puerto 3001 y mantener el puerto interno y el healthcheck en 3000.

Si se modifica el puerto interno mediante `PORT`, también deben ajustarse el segundo número del mapeo y el puerto del healthcheck.

Para cambiar el cliente de demostración, modificar `CLIENTE_SIMULADO`. Los registros anteriores conservan su propietario y no se reasignan al nuevo cliente.

Si se modifica `DB_PATH`, mantener el archivo dentro de `/app/data` para conservarlo en el volumen. Elegir otro archivo no migra los datos de la base anterior.

Después de modificar `compose.yaml`, aplicar los cambios:

```powershell
docker compose up -d clientes
```

Los valores de Compose están escritos directamente. Crear un archivo `.env` o definir variables en PowerShell no los reemplaza automáticamente.

## 5. Ejecutar las pruebas

Ejecutar las pruebas dentro de Docker:

```powershell
docker compose --profile pruebas run --build --rm pruebas
```

Este comando construye la etapa de pruebas, compila el proyecto y ejecuta la suite en un contenedor temporal.

Las pruebas no requieren una API previamente iniciada y no utilizan el volumen de datos de demostración.

Resultado esperado para esta versión:

- 67 pruebas aprobadas.
- 0 pruebas fallidas.
- Código de salida 0.

Inmediatamente después del comando, consultar el código de salida en PowerShell:

```powershell
$LASTEXITCODE
```

La suite incluye pruebas de unidad, integración HTTP, persistencia y concurrencia. El caso de dos calificaciones simultáneas debe producir una creación y un conflicto, conservando una sola valoración.

## 6. Iniciar la aplicación

Ejecutar:

```powershell
docker compose up --build -d clientes
```

La primera construcción puede tardar porque descarga la imagen base e instala las dependencias.

Al finalizar, la aplicación queda funcionando en segundo plano.

Comprobar su estado:

```powershell
docker compose ps
```

El servicio `clientes` debe aparecer iniciado y, después de unos segundos, como `healthy`.

Si aparece `health: starting`, esperar y volver a consultar.

## 7. Acceder a la aplicación

Con el puerto predeterminado, abrir en el navegador:

- **Swagger:** http://localhost:3000/docs/
- **Salud del servicio:** http://localhost:3000/salud
- **Identidad simulada:** http://localhost:3000/sesion
- **Especificación OpenAPI:** http://localhost:3000/openapi.json

La comprobación de salud debe responder HTTP 200 con:

```json
{"estado":"OK"}
```

En Swagger, seleccionar una operación, presionar **Try it out**, completar los datos y presionar **Execute**.

### Comprobación básica

1. Registrar una dirección para `cliente-1` utilizando el ejemplo de Swagger. Se espera HTTP 201.
2. Consultar las direcciones del mismo cliente. Se espera HTTP 200 y la dirección guardada.
3. Registrar una calificación para `viaje-1`, completado en el simulador. Se espera HTTP 201 si todavía no fue calificado.
4. Repetir la calificación. Se espera HTTP 409 porque ya existe una valoración para ese cliente y viaje.

`viaje-5` es otro viaje completado disponible para la demostración.

Reiniciar la aplicación no permite volver a calificar un viaje que ya tiene una valoración persistida.

## 8. Detener la aplicación

Ejecutar:

```powershell
docker compose down
```

Este comando detiene y elimina los contenedores del proyecto, pero conserva las direcciones y calificaciones en el volumen.

No agregar `-v` si se desean conservar los datos, porque esa opción elimina también el volumen.

## 9. Volver a iniciar

Con Docker Desktop funcionando, ejecutar:

```powershell
docker compose up -d clientes
```

Si se modificó el código o el Dockerfile, reconstruir la imagen:

```powershell
docker compose up --build -d clientes
```

Para comprobar la persistencia, consultar después del reinicio una dirección o calificación guardada anteriormente. Utilizar el mismo proyecto, volumen y cliente de demostración.

## 10. Consultar logs y resolver problemas

Para consultar los últimos mensajes del servicio:

powershell
docker compose logs --tail 80 clientes