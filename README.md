# p3-ae1-2026
Paradigmas 3 AE1 2026
# p3-ae1-2026 — M6: Viajes


guia paso a paso para levantar el servicio en Docker

## Requisitos

- Docker Desktop instalado y corriendo
- Node.js versión 18 o superior 
- El proyecto clonado o descomprimido!!
- ubicate en la carpeta m6_viajes 

paso 0
git clone https://github.com/cuencadelplata/p3-ae1-2026.git

paso 1: ubicarte en la carpeta m6_viajes , abrir CMD.
cd ruta\hasta\p3-ae1-2026\m6_viajes

paso 2 correr los tests 
npm ci
npm test
npm test -- --coverage
npm run test:e2e

paso 3 : levantar docker (Opción Local)
docker compose up -d --build

paso 4: DESCARGAR Y EJECUTAR LA IMAGEN DE DOCKER
docker pull noeediez/m6-viajes:1.0
docker rm -f m6-viajes 2>nul
docker run -d -p 3000:3000 --name m6-viajes noeediez/m6-viajes:1.0

paso 5: verificar que este vivo
curl.exe http://localhost:3000/health


paso 6: ver la documentacion OPENAPI
tenés que estar parado adentro de m6_viajes (porque ahí está el archivo openapi.yaml):
npx @scalar/cli document serve openapi.yaml --port 3001

paso 7 (OPCIONAL) probar un endpoint  (cmd)
curl.exe -X POST "http://localhost:3000/api/viajes" -H "Content-Type: application/json" -d "{\"clienteId\":\"cliente-123\",\"origen\":\"Calle A\",\"destino\":\"Calle B\"}"

en powershell
Invoke-RestMethod -Uri "http://localhost:3000/api/viajes" -Method Post -Headers @{"Content-Type"="application/json"} -Body '{"clienteId":"cliente-123","origen":"Calle A","destino":"Calle B"}'

paso 8 apagar
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