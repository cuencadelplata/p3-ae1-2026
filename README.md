# p3-ae1-2026
Paradigmas 3 AE1 2026
# p3-ae1-2026 — M6: Viajes


guia paso a paso para levantar el servicio en Docker

## Requisitos

- Docker Desktop instalado y corriendo
- Node.js versión 18 o superior 
- El proyecto clonado o descomprimido!!
- ubicate en la carpeta m6_viajes 

paso 1: ubicarte en la carpeta m6_viajes , abrir CMD.
cd ruta\hasta\p3-ae1-2026\m6_viajes
 
paso 2 : levantar docker
docker compose up -d

paso 3: verificar que este vivo
curl http://localhost:3000/health

paso 4: ver la documentacion OPENAPI
tenés que estar parado adentro de m6_viajes (porque ahí está el archivo openapi.yaml):
npx @scalar/cli document serve openapi.yaml

paso 5 (OPCIONAL) probar un endpoint 
curl -X POST "http://localhost:3000/api/viajes" -H "Content-Type: application/json" -d "{\"clienteId\":\"cliente-123\",\"origen\":\"Calle A\",\"destino\":\"Calle B\"}"

paso 6 correr los tests 
npm ci
npm test
npm run test:coverage
npm run test:e2e

paso 7 apagar
docker compose down



## Estructura del proyecto
p3-ae1-2026-M6-Viajes/
├── .github/workflows/m6-tests.yml   # CI: corre npm test y npm run test:e2e
└── m6_viajes/
    ├── src/
    │   ├── controllers/viajes.controller.ts
    │   ├── models/viaje.model.ts
    │   ├── routes/viajes.routes.ts
    │   └── index.ts
    ├── tests/                        # unitarios, concurrencia, ciclo completo y e2e
    ├── Dockerfile
    ├── docker-compose.yml
    ├── openapi.yaml
    └── package.json

ESTRUCTURA DEL PROYECTO