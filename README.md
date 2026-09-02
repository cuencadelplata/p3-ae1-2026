# p3-ae1-2026
Paradigmas 3 AE1 2026
Requisitos previos
Guía paso a paso para levantar el contenedor Docker y correr los tests E2E.

Requisitos previos
Docker Desktop instalado y corriendo
Node.js (versión 18 o superior)
El proyecto descomprimido 

Paso 1: abrir docker desktop
Paso 2: abrir terminal CMD y ejecutar:
docker pull noeediez/m6-viajes:1.0
Paso 3: levantar el contenedor 
docker run -d -p 3000:3000 --name m6-viajes noeediez/m6-viajes:1.0
Paso 4: verificar que está vivo
curl http://localhost:3000/health
respuesta esperada: {"status":"ok"}


Paso 5 (OPCIONAL): probar un endpoint real
//cmd 
curl -X POST "http://localhost:3000/api/viajes" -H "Content-Type: application/json" -d "{\"clienteId\":\"cliente-123\",\"origen\":\"Calle A\",\"destino\":\"Calle B\"}"

curl -X POST "http://localhost:3000/api/viajes/TU_ID/asignar" -H "Content-Type: application/json" -d "{\"conductorId\":\"conductor-123\"}"

ej: curl -X POST "http://localhost:3000/api/viajes/1788358067373/asignar" -H "Content-Type: application/json" -d "{\"conductorId\":\"conductor-123\"}"

curl -X PUT "http://localhost:3000/api/viajes/1788358067373/arribo"

curl -X POST "http://localhost:3000/api/viajes/1788358067373/iniciar" -H "Content-Type: application/json" -d "{\"codigoVerificacion\":\"PWUVA8\"}"


//powershell
Invoke-RestMethod -Uri "http://localhost:3000/api/viajes" `
  -Method POST `
  -ContentType "application/json" `
  -Body '{"clienteId":"cliente-123","origen":"Calle A","destino":"Calle B"}'


Invoke-RestMethod -Uri "http://localhost:3000/api/viajes/id/asignar" `
  -Method POST `
  -ContentType "application/json" `
  -Body '{"conductorId":"conductor-123"}'

  Invoke-RestMethod -Uri "http://localhost:3000/api/viajes/id/asignar" `
  -Method POST `
  -ContentType "application/json" `
  -Body '{"conductorId":"conductor-123"}'


  Invoke-RestMethod -Uri "http://localhost:3000/api/viajes/id/arribo" `
  -Method PUT


  Invoke-RestMethod -Uri "http://localhost:3000/api/viajes/id/iniciar" `
  -Method POST `
  -ContentType "application/json" `
  -Body '{"codigoVerificacion":"I6DJP0"}'

   Invoke-RestMethod -Uri "http://localhost:3000/api/viajes/id/iniciar" `
  -Method POST `
  -ContentType "application/json" `
  -Body '{"codigoVerificacion":"EVA2FS"}'
 

paso 6: apagar el contenedor 
docker stop m6-viajes
docker rm m6-viajes

CORRER TEST E2E
paso 1 : ubicarse dentro de la carpeta m6_viajes 
paso 2: instalar dependecias 
npm ci 
paso 3: ejecutar los test 
npm run test:e2e
:D
ESTRUCTURA DEL PROYECTO

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