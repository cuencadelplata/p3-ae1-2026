# Historial Financiero — RF-7.7

API que mantiene la trazabilidad de operaciones financieras y su estado (pendiente, completada, fallida, cancelada).

## Requisitos

- [Node.js](https://nodejs.org/) v20 o superior
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (opcional, para correr en contenedor)

## Instalación

Clonar el repositorio e instalar las dependencias:

```bash
npm install
```

## Ejecutar en local

Compilar el proyecto TypeScript:

```bash
npm run build
```

Levantar el servidor:

```bash
npm start
```

El servidor queda escuchando en `http://localhost:3000`.

## Ejecutar con Docker

La aplicación y PostgreSQL se ejecutan en contenedores separados. Compose crea además un volumen persistente para que los datos no se pierdan al recrear los contenedores.

```bash
docker compose up --build
```

La API queda disponible en `http://localhost:3000`. Para detener los servicios:

```bash
docker compose down
```

Para eliminar también los datos persistidos de PostgreSQL:

```bash
docker compose down -v
```

Cuando `DATABASE_URL` está definida, la API crea automáticamente la tabla `financial_operations` al iniciar y persiste allí las operaciones. Si se ejecuta localmente sin esa variable, conserva el modo en memoria para facilitar el desarrollo.

## Endpoints

| Método | Ruta                        | Descripción                          |
|--------|-----------------------------|---------------------------------------|
| GET    | `/operations`                | Consultar el historial de operaciones |
| POST   | `/operations`                | Registrar una nueva operación         |
| PATCH  | `/operations/{id}/status`    | Actualizar el estado de una operación |

La documentación completa de la API está en [`openapi.yaml`](./openapi.yaml).

## Documentación interactiva (Scalar)

Con el servidor corriendo, se puede explorar y probar la API de forma interactiva en:

```
http://localhost:3000/docs
```

Esta vista se genera automáticamente a partir de `openapi.yaml` usando [Scalar](https://scalar.com/), y permite ver ejemplos de request/response de cada endpoint y ejecutar pedidos de prueba directamente desde el navegador.

**Importante:** si se edita `openapi.yaml`, hay que reiniciar el servidor (`Ctrl+C` y `npm start` de nuevo) para que los cambios se reflejen, ya que el archivo se lee una sola vez al arrancar.

### Ejemplo — crear una operación

```bash
curl -X POST http://localhost:3000/operations \
  -H "Content-Type: application/json" \
  -d '{"type":"payment","amount":1500}'
```

### Ejemplo — actualizar el estado

```bash
curl -X PATCH http://localhost:3000/operations/op_123/status \
  -H "Content-Type: application/json" \
  -d '{"status":"completed"}'
```

## Tests

Los tests automatizados usan [Playwright](https://playwright.dev/) y prueban la API real contra un servidor corriendo en `http://localhost:3000`. Cubren las 3 rutas (`GET`, `POST`, `PATCH`) con casos válidos e inválidos.

### Ejecutar los tests en local

1. Instalar las dependencias del proyecto (si no se hizo antes):

```bash
npm install
```

2. Instalar los navegadores que necesita Playwright (solo la primera vez):

```bash
npx playwright install
```

3. Compilar el proyecto:

```bash
npm run build
```

4. Ejecutar los tests:

```bash
npm test
```

Los tests esperan que la API ya esté disponible en `http://localhost:3000`.

### Ejecutar los tests en Docker

Construir la imagen:

```bash
docker build -f dockerfile -t historial-financiero:test .
```

Levantar la API en segundo plano:

```bash
docker run -d --name historial-financiero -p 3000:3000 lautaro0910/ae1repo:latest
```

Ejecutar los tests desde otra terminal:

```bash
npm test
```

Si se detiene el contenedor, `npm test` debe fallar por conexión rechazada. Para detenerlo:

```bash
docker stop historial-financiero
```

### Resultado esperado

Los 8 tests deberían pasar, cubriendo:
- Consulta del historial (inicial y tras registrar operaciones)
- Registro de una operación válida
- Rechazo de `amount` inválido (no numérico)
- Rechazo de `type` inválido
- Actualización de estado válida
- Rechazo de un nuevo estado inválido
- Actualización sobre un `id` inexistente (`404`)

### Reportes adicionales

Para ver los tests corriendo con más detalle visual, o generar un reporte HTML:

```bash
npm run test:headed
npm run test:report
```

## Estructura del proyecto

```
historial-financiero/
├── src/
│   └── index.ts          # Lógica + servidor Express
├── tests/
│   └── financialHistory.spec.ts
├── openapi.yaml           # Contrato de la API
├── Dockerfile
├── package.json
└── tsconfig.json
```