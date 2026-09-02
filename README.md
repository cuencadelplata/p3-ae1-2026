# p3-ae1-2026
Paradigmas 3 AE1 2026 - Grupo 5 - M2

## M2: Clientes

Implementación del módulo M2 para los requisitos RF-2.1, RF-2.3 y RF-2.5:

- Perfil de cliente: alta y consulta de datos personales y preferencias.
- Historial de viajes: consulta del listado de viajes realizados consumiendo la API de M6 sin acceso directo a su base de datos.
- Estado de cuenta: consulta y control de la condición operativa del perfil (activo/bloqueado).

---

## Imágenes Docker Hub

Las imágenes publicadas están disponibles en:

- [Backend M2](https://hub.docker.com/r/leangau/m2-perfilhistorialestado/tags?name=api)
- [Frontend M2](https://hub.docker.com/r/leangau/m2-perfilhistorialestado/tags?name=client)

Para descargar las imágenes desde la terminal integrada de VS Code:

```bash
docker pull leangau/m2-perfilhistorialestado:api
docker pull leangau/m2-perfilhistorialestado:client
```

Para comprobar que ambas imágenes quedaron instaladas localmente:

```bash
docker image ls leangau/m2-perfilhistorialestado
```

---

## Ejecutar los tests

### Paso 1

Primero, abra Visual Studio Code, luego, presione F1, escriba `Git: Clone` y presione enter, pegue el siguiente link:

```
https://github.com/cuencadelplata/p3-ae1-2026.git
```

Una vez el repositorio se haya clonado, deberá moverse a la rama correspondiente. Presione F1 nuevamente y escriba `Git: Checkout to...`, presione enter y seleccione la rama `M2-PerfilHistorialEstado`.

### Paso 2

Cuando se hayan descargado todos los archivos, vaya arriba a la izquierda **Terminal → New Terminal**.

### Paso 3

Desde la terminal de Visual Studio Code, ubicada en la raíz del proyecto:

```bash
npm install
npm test
```

Para ejecutar los tests end-to-end, que requieren los servicios Docker levantados:

```bash
docker compose up -d
npx playwright install chromium
npm run test:e2e
docker compose down
```

La suite unitaria e integración no requiere Docker. Los tests E2E sí requieren que los 3 contenedores estén corriendo.

---

## Endpoints provistos por la API

La especificación completa se encuentra en `/docs` una vez levantado el servidor.

### Crear perfil de cliente
`POST /v1/customers`

Implementa RF-2.1. Registra un nuevo cliente con sus datos de contacto y preferencias. Genera un identificador único y crea el registro de estado de cuenta inicial.

Respuesta exitosa: `201 Created`.

### Obtener perfil de cliente
`GET /v1/customers/:id`

Implementa RF-2.1. Devuelve los datos del perfil, preferencias y estado del cliente correspondiente al ID proporcionado.

Respuesta exitosa: `200 OK`.

### Actualizar preferencias
`PUT /v1/customers/:id`

Implementa RF-2.1. Actualiza el tipo de vehículo preferido y el canal de notificación del cliente.

Respuesta exitosa: `200 OK` con las preferencias y estado actualizados.

### Consultar estado de cuenta
`GET /v1/customers/:id/status`

Implementa RF-2.5. Devuelve la condición operativa del perfil (activo, bloqueado temporal, bloqueado permanente o en revisión) junto al motivo registrado.

Respuesta exitosa: `200 OK`.

### Consultar historial de viajes
`GET /v1/customers/:id/trips`

Implementa RF-2.3. Devuelve el listado de viajes realizados por el cliente consumiendo la API de M6 vía HTTP, sin acceso directo a su base de datos. Si M6 no está disponible, retorna datos de demostración.

Respuesta exitosa: `200 OK` con la propiedad `trips`.

---

## Contrato con APIs externas

Este endpoint es consumido por M2 para obtener el historial de viajes; no es un endpoint provisto por nuestra API:

- `GET /v1/trips?customerId={id}` — API de M6 (Viajes)
