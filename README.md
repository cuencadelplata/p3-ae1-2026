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

paso 3 (opcional): levantar docker (Utiliza esto solo si clonaste el repositorio y prefieres compilar y levantar el entorno localmente)
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

paso 7 (OPCIONAL) probar un endpoint  (cmd) (hay que estar en la carpeta m6_viajes)
¡¡TEXTO LARGO PORQUE NO HICE LA INTERFAZ DE QR, POR ESO ES SOLO TEXTO PERO LOS DATOS IMPORTANTES ESTAN ARRIBA!!

primer endpoint : solicitar un viaje, copiar el id de la respuesta 

curl.exe -X POST "http://localhost:3000/api/viajes" -H "Content-Type: application/json" -d "{\"clienteId\":\"cliente-123\",\"origen\":\"Calle A\",\"destino\":\"Calle B\"}"

segundo endpoint: asignar conductor

curl.exe -X POST "http://localhost:3000/api/viajes/id/asignar" -H "Content-Type: application/json" -d "{\"conductorId\":\"conductor-001\"}"

tercer endpoint: registrar arribo 

curl -X PUT http://localhost:3000/api/viajes/id/arribo

cuarto endpoint: iniciar viaje

curl.exe -X POST "http://localhost:3000/api/viajes/id/iniciar" -H "Content-Type: application/json" -d "{\"codigoVerificacion\":\"AB3K8F\"}"

codigodeverificacion está en el primer endpoint (texto largo por el qr)


paso 8 (para apagar y limpiar):
- Si usaste Docker Compose (Opción 3): parado en la carpeta, ejecuta 'docker compose down'
- Si usaste Docker Run directo (Opción 4): desde cualquier lugar, ejecuta 'docker rm -f m6-viajes'

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