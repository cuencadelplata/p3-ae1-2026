# M7 - Tarifas, Pagos y Liquidaciones
Paradigmas 3 - AE1 2026

Implementa el cálculo de reintegros por cancelación (RF-7.5), la verificación de
idempotencia de pagos (RF-7.6), el registro de métodos de pago (RF-7.2)
y la autorización/rechazo de cobros (RF-7.3).

Repositorio: https://github.com/cuencadelplata/p3-ae1-2026
Rama: M7--Tarifas,-Pagos-y-Liquidaciones

## Requisitos
- Docker Desktop instalado y corriendo
- Proyecto descargado (clonado o descomprimido)
- Terminal para comando (CMD o PowerShell)

## Imagen publicada en Docker Hub
- Nombre: `aylen0/m7-tarifas`
- Enlace: https://hub.docker.com/r/aylen0/m7-tarifas
- Versión: `4.0`


## Levantar con Docker Hub

### Paso 1: abrir la terminal
    Abrir "cmd" o "PowerShell" en el menú de inicio y abrirlo

### Paso 2: descargar la imagen desde Docker Hub
    Escribir el comando en la terminal:     docker pull aylen0/m7-tarifas:4.0

### Paso 3: levantar el contenedor
    Nuevamente en la terminal colocar:      docker run -d -p 3000:3000 --name m7-tarifas aylen0/m7-tarifas:4.0

### Paso 4: verificar que está vivo
    En misma terminal:      curl -X POST http://localhost:3000/reintegro -H "Content-Type: application/json" -d "{\"montoCancelacion\": 1000, \"viajeId\": \"v1\"}"


# Si en PowerShell da error este ùltimo comando intentar con: curl -X POST http://localhost:3000/reintegro -H "Content-Type: application/json" -d '{\"montoCancelacion\": 1000, \"viajeId\": \"v1\"}'


Respuesta esperada:
```json
{"monto":950,"viajeId":"v1"}
```

### Paso 5: ver documentación interactiva de la API
    Abrir Google/Edge/Brave/etc. y entrar a: http://localhost:3000/docs 

### Paso 6: probar el resto de los endpoints (opcional)
En la misma terminal:

- curl http://localhost:3000/pagos/o1/duplicado

- curl -X POST http://localhost:3000/metodo-pago -H "Content-Type: application/json" -d "{\"clienteId\": \"cliente1\", \"viajeId\": \"v1\", \"tipo\": \"efectivo\"}"

- curl http://localhost:3000/metodo-pago/v1

- curl -X POST http://localhost:3000/metodo-pago/v1/autorizar -H "Content-Type: application/json" -d "{\"idOrden\": \"orden-1\"}"

### Paso 7: ver cobertura de tests (opcional)
- npm run test:coverage

Cobertura actual: 100% de los 4 RF implementados

### Paso 8: apagar y borrar el contenedor
En terminal:
- docker stop m7-tarifas
- docker rm m7-tarifas



## Cómo correr los tests (requiere el código fuente y Node.js)
Para probar esta parte es necesario tener el código descargado y Node.js instalado

### Paso 1: instalar Node.js
Descargar e instalar desde: https://nodejs.org (versión 18 o superior)

### Paso 2: descargar el código del repositorio

En la terminal, ubicado en la carpeta donde quiera guardar el proyecto:
- git clone https://github.com/cuencadelplata/p3-ae1-2026.git
- cd p3-ae1-2026
- git checkout "M7--Tarifas,-Pagos-y-Liquidaciones"

### Paso 3: instalar las dependencias del proyecto
Parado dentro de la carpeta del proyecto, en la terminal:
- npm install

### Paso 4: correr los tests unitarios y de integración
- npm run test:unit

### Paso 5: correr los tests End-to-End (requiere el contenedor corriendo)

Con el contenedor ya levantado (Pasos 2-3 de la sección anterior):
- npx playwright test


## Arquitectura del proyecto
p3-ae1-2026/
├── Dockerfile
├── .dockerignore
├── openapi.yaml
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── playwright.config.ts
└── src/
    ├── index.ts
    ├── 6-reintegro/
    │   ├── Reintegro.ts
    │   ├── calculoReintegro.ts
    │   └── rutaReintegro.ts
    ├── 5-pago-duplicado/
    │   ├── IRegistroPago.ts
    │   ├── verificaPagoDuplicado.ts
    │   └── rutaPagoDuplicado.ts
    ├── metodo-pago/
    │   ├── metodoPago.ts
    │   ├── procesoPago.ts
    │   ├── controllerPago.ts
    │   └── rutaPago.ts
    ├── mock/
    │   ├── cancelacionMock.ts
    │   └── registroPagoMock.ts
    └── test/
        ├── calculoReintegro.test.ts
        ├── verificaPagoDuplicado.test.ts
        ├── metodoPago.test.ts
        ├── autorizacionPago.test.ts
        ├── rutaReintegro.test.ts
        ├── rutaPagoDuplicado.test.ts
        ├── rutaPago.test.ts
        └── E2E/
            └── m7Endpoints.e2e.test.ts