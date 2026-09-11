# M4 - Ubicacion y Disponibilidad

API REST del Modulo 4 de la plataforma de movilidad urbana. Esta aplicacion administra ubicaciones temporales y disponibilidad de conductores. La interfaz grafica se encuentra separada en `../modulo-4-ui` y se ejecuta en otro contenedor.

Version actual de la API: `1.3.0`.

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

En AE1 esas integraciones se representan mediante contratos REST y simulaciones. Los datos se mantienen en memoria con un TTL configurable. Redis queda previsto para AE2.

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
- Health check: `http://localhost:3004/health`
- Scalar: `http://localhost:3004/docs`
- OpenAPI: `http://localhost:3004/openapi/openapi-m4.yaml`

Para detener todo:

```bash
docker compose down
```

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

## Imagenes publicadas

- API: [segocodee/p3-m4-ubicacion](https://hub.docker.com/r/segocodee/p3-m4-ubicacion), version `1.3.0` y etiqueta `latest`.
- UI: [segocodee/p3-m4-ui](https://hub.docker.com/r/segocodee/p3-m4-ui), version `1.0.0` y etiqueta `latest`.
- Repositorio: [branch M4-Ubicacion-disponibilidad](https://github.com/cuencadelplata/p3-ae1-2026/tree/M4-Ubicacion-disponibilidad).

## Configuracion

- `PORT`: puerto interno de la API, valor predeterminado `3004`.
- `LOCATION_TTL_SECONDS`: vigencia de una ubicacion, valor predeterminado `60`.

## Limitaciones conocidas

- El estado se pierde al reiniciar la API porque AE1 utiliza memoria local.
- El geocodificador conoce solamente direcciones de demostracion.
- M3, M5 y M6 se representan mediante contratos; la integracion completa corresponde a una evolucion posterior.
- Una unica instancia protege el orden temporal de las actualizaciones. La coordinacion distribuida y Redis corresponden a AE2.
