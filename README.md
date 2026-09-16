# Paradigmas III — AE1

El módulo de reservas programadas está contenido en [M9-ReservasProgramadas](./M9-ReservasProgramadas/README.md).
Allí se encuentran su código, interfaz, pruebas, OpenAPI, configuración y archivos Docker.

## Comandos desde la raíz

Los comandos anteriores siguen disponibles mediante el `package.json` raíz:

```bash
npm ci
npm run verify
npm run build
npm run test:coverage
npm run test:e2e
npm run local:up
```

`npm ci` (o `npm install`) en la raíz instala también las dependencias de M9 mediante
`postinstall`. El módulo conserva su propio `package.json`, lockfile y `node_modules`.
Los comandos de desarrollo, ejecución, pruebas, lint y formato se delegan al módulo.
`verify` incluye tipos, lint, formato y pruebas unitarias/de integración; cobertura y E2E
se ejecutan por separado.

También se puede trabajar de forma independiente:

```bash
cd M9-ReservasProgramadas
npm ci
npm run local:up
```

## Docker y configuración

Se necesita Docker Desktop con Compose 2.20 o superior para usar el archivo raíz,
que incluye la composición de M9. Desde la raíz o desde la carpeta del módulo:

```bash
docker compose up -d --build
docker compose ps
docker compose down
```

Ambas ubicaciones utilizan el proyecto Compose `m9-reservas-programadas`.
El contexto de construcción, el `Dockerfile` y el `.dockerignore` están dentro del módulo.
Para construir la imagen directamente desde la raíz:

```bash
docker build -t m9-reservas-programadas:local ./M9-ReservasProgramadas
```

La configuración opcional se prepara copiando `M9-ReservasProgramadas/.env.example`
a `M9-ReservasProgramadas/.env`. No se necesitan claves para la ejecución local.
La migración de carpetas cambia el nombre de proyecto Compose anterior: los contenedores
creados antes de esta reorganización deben detenerse antes de iniciar los nuevos si ocupan
el puerto 3000. No se recuperan reservas de ejecuciones anteriores porque se guardan en memoria.

- Interfaz: <http://localhost:3000/>
- Swagger UI: <http://localhost:3000/docs/>
- OpenAPI: <http://localhost:3000/openapi.json>
- Salud: <http://localhost:3000/health>
- Reporte de cobertura: `M9-ReservasProgramadas/coverage/index.html`.

## Organización para integrar otros módulos

Los cambios de implementación de M9 se realizan dentro de `M9-ReservasProgramadas/`.
El `.gitignore` raíz aplica a todos los módulos y excluye dependencias, compilaciones,
cobertura y archivos de entorno privados.

Los únicos archivos compartidos de acceso son este README, `package.json`, su lockfile
y `docker-compose.yml`. Al integrar otros módulos, coordinar estos archivos raíz con el grupo;
mantener los comandos desde la raíz requiere conservar estos accesos compartidos.

La [guía de M9](./M9-ReservasProgramadas/README.md) detalla endpoints, variables, pruebas,
imagen pública, límites y preparación de la entrega.
