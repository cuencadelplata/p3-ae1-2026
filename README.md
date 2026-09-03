# M2 — Clientes · AE1

RF-2.2 administra direcciones favoritas y recientes. RF-2.4 registra la
calificación del conductor después de un viaje completado.

El servicio usa TypeScript, Express 5, SQLite y OpenAPI 3.0.3.

## Alcance y límites

- Este proyecto implementa la parte asignada del Modulo M2.
- La identidad es simulada: `CLIENTE_SIMULADO`, por defecto `cliente-1`.
- `ViajesSimulados` proporciona los datos necesarios para comprobar un viaje. No implementa M6 ni lee sus tablas.
- El servicio verifica siempre la existencia, el propietario y el estado del viaje.

## Organización

| Archivo | Responsabilidad |
| `src/app.ts` | Rutas HTTP, identidad simulada y respuestas de error |
| `src/server.ts` | Configuración y arranque del servidor |
| `src/domain/calificaciones.ts` | Modelos y validación de las entradas de RF-2.4 |
| `src/application/calificaciones-service.ts` | Reglas del caso de uso de calificación |
| `src/application/calificaciones-ports.ts` | Contratos de persistencia y consulta de viajes |
| `src/infrastructure/viajes-simulados.ts` | Sustituto local de la consulta a M6 para AE1 |
| `src/infrastructure/sqlite-repository.ts` | SQL de direcciones y calificaciones |
| `src/infrastructure/schema.sql` | Tablas propias de M2 y restricciones |
| `src/openapi.ts` y `src/openapi-calificaciones.ts` | Contrato de la API y ejemplos |
| `test/` | Pruebas unitarias y de integración |

Los archivos originales de RF-2.2 conservan sus responsabilidades. La nueva
`ServicioCalificaciones` sigue el mismo patrón que `ServicioClientes`.
Esta implementación sustituye las clases en inglés del RF-2.4 anterior y su
contrato `customers/ratings`; no son dos APIs paralelas.

## Reglas de RF-2.4

El cuerpo contiene `viajeId`, `puntuacion` y opcionalmente `comentario`.
La puntuación debe ser entera entre 1 y 5. El comentario admite hasta 500
caracteres después de recortar espacios; omitido, vacío o null se guarda como null.
El cliente proviene de la ruta verificada y el conductor del viaje consultado.
No se admite un conductor o estado elegido por quien envía la solicitud.

Se permite una única calificación por cliente y viaje. La restricción SQL
`UNIQUE(clienteId, viajeId)` y el INSERT con manejo del conflicto hacen atómica
esa decisión. Una repetición recibe 409 y no reemplaza la primera calificación.

## Persistencia

M2 posee `direcciones` y `calificaciones` en `customer.sqlite`. No almacena
tablas de Viajes o Pagos. Ambas tablas pertenecen al mismo servicio Clientes.
SQLite corre dentro del proceso de Node; no necesita un servidor de base de datos
ni un contenedor separado. En Docker, el archivo se guarda en el volumen
`datos-clientes`, montado en `/app/data`.

El esquema crea la nueva tabla al iniciar. Las direcciones existentes se conservan.
Recrear el contenedor conserva el volumen. `docker compose down -v` elimina
ese volumen y sus datos; no es necesario para aplicar estos cambios.

## Ejecutar en Codespaces

Se necesita Node 24 y npm. Desde la raíz del repositorio:

```bash
npm ci
npm test
npm start
```

`npm test` compila el código y ejecuta los cuatro archivos `test/*.test.ts`
compilados en `dist/test`. No necesita que la API esté iniciada previamente.
`npm start` utiliza la compilación generada por `npm test` o `npm run build`.

Abrir el puerto 3000 desde la pestaña PORTS de Codespaces. Las rutas son
`/docs/` para Swagger y `/openapi.json` para el contrato JSON.

Variables de entorno:

| Variable | Valor predeterminado |
| --- | --- |
| `PORT` | `3000` |
| `DB_PATH` | `./data/customer.sqlite` (Docker: `/app/data/customer.sqlite`) |
| `CLIENTE_SIMULADO` | `cliente-1` |

## Ejecutar con Docker

```bash
docker compose -f compose.yaml --profile pruebas run --build --rm pruebas
docker compose -f compose.yaml up --build -d clientes
docker compose -f compose.yaml ps
```

El primer comando ejecuta los tests en la etapa `pruebas`. El segundo construye
e inicia la etapa `ejecucion`, que recibe el código compilado con
`COPY --from=compilacion /app/dist ./dist`. El servidor escucha en `0.0.0.0:3000`.
Ambos requerimientos se ejecutan en el mismo contenedor porque son parte de M2.
Las pruebas usan SQLite en memoria o un archivo temporal, sin montar los datos
del servicio de demostración.

## API de calificaciones

| Método | Ruta | Resultado |
| --- | --- | --- |
| POST | `/clientes/{clienteId}/calificaciones` | Registra y devuelve una calificación (201) |
| GET | `/clientes/{clienteId}/calificaciones` | Lista las calificaciones propias (200) |
| GET | `/clientes/{clienteId}/calificaciones/{id}` | Consulta una calificación propia (200) |

```bash
curl -i -X POST http://localhost:3000/clientes/cliente-1/calificaciones \
  -H 'Content-Type: application/json' \
  -d '{"viajeId":"viaje-1","puntuacion":5,"comentario":"Buen trato."}'

curl http://localhost:3000/clientes/cliente-1/calificaciones
```

La primera llamada devuelve 201 si ese viaje aún no fue calificado. Repetirla
devuelve 409. Se puede usar `viaje-5` para una segunda valoración válida.

| Viaje simulado | Situación | Resultado del POST válido |
| --- | --- | --- |
| `viaje-1` | Completado, propio, conductor-1 | 201; luego 409 |
| `viaje-2` | En curso, propio | 422 |
| `viaje-3` | Cancelado, propio | 422 |
| `viaje-4` | Completado, ajeno | 404 |
| `viaje-5` | Completado, propio, conductor-2 | 201; luego 409 |
| Otro identificador | Inexistente | 404 |

Los errores usan el mismo formato que RF-2.2: `{"codigo":"...","mensaje":"..."}`.
También se documentan 400 para entradas inválidas, 403 para rutas de otro cliente,
413 para cuerpos demasiado grandes y 503 si falla la consulta de viajes.

## Evidencia y relación con la consigna

| Requisito de la consigna | Evidencia en esta implementación |
| --- | --- |
| RF-2.2 | CRUD de direcciones y sus 30 pruebas existentes |
| RF-2.4 | Registro condicionado a un viaje completado y 37 pruebas nuevas |
| RNF-02: responsabilidad modular | Servicio M2; contrato `ConsultaViajes` para el límite con M6 |
| RNF-03: contenedores | Dockerfile con compilación, pruebas y ejecución; Compose |
| RNF-04: propiedad de datos | Tablas propias de Clientes en SQLite; sin SQL contra M6 |
| RNF-05: API y contratos | Rutas HTTP, OpenAPI, Swagger y errores consistentes |
| RNF-09: concurrencia | Restricción UNIQUE y prueba con dos POST simultáneos |
| RNF-11: configuración | PORT, DB_PATH y CLIENTE_SIMULADO mediante entorno |
| RNF-17: testing | Validaciones unitarias, HTTP real y persistencia en archivo |
| RNF-22: documentación | Este README; commits, tareas y evidencias corresponden al grupo |

Las 67 pruebas pasaron en la copia de verificación con Node 24. Los tests HTTP
crean un servidor en un puerto libre y una base independiente por caso. La prueba
de persistencia cierra y reabre un archivo temporal. La prueba de concurrencia
cubre solicitudes simultáneas a una instancia, no una prueba de carga distribuida.

Docker se revisó por configuración, pero no se ejecutó en el entorno que preparó
esta adaptación porque no estaba instalado. Conservar como evidencia la salida
de los comandos Docker ejecutados en Codespaces.

Esta tabla relaciona el trabajo con el documento de escenario recibido; no es una
calificación ni reemplaza una rúbrica adicional. El Portafolio, la Bitácora, las
tareas, los commits y la aprobación del alcance/stubs se completan por el grupo.