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

Construir la imagen:

```bash
docker build -t historial-financiero .
```

Levantar el contenedor:

```bash
docker run -p 3000:3000 historial-financiero
```

## Endpoints

| Método | Ruta                        | Descripción                          |
|--------|-----------------------------|---------------------------------------|
| GET    | `/operations`                | Consultar el historial de operaciones |
| POST   | `/operations`                | Registrar una nueva operación         |
| PATCH  | `/operations/{id}/status`    | Actualizar el estado de una operación |

La documentación completa de la API está en [`openapi.yaml`](./openapi.yaml).

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

### Pasos para ejecutar los tests

1. Instalar las dependencias del proyecto (si no se hizo antes):

```bash
npm install
```

2. Instalar los navegadores que necesita Playwright (solo la primera vez):

```bash
npx playwright install
```

3. Compilar y levantar el servidor, **en una terminal separada** (los tests necesitan que el servidor esté corriendo):

```bash
npm run build
npm start
```

Debe quedar mostrando `Servidor escuchando en el puerto 3000` — dejar esa terminal abierta.

4. En **otra terminal**, correr los tests:

```bash
npm test
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