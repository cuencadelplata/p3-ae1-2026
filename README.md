Módulo 2 — Clientes · AE1 · Grupo 01
Proyecto de Paradigmas III, Ingeniería en Sistemas de Información, Universidad de la Cuenca del Plata.
Esta entrega implementa RF-2.2: direcciones frecuentes y RF-2.4: calificación del conductor. Ofrece una API HTTP con OpenAPI, persistencia SQLite, pruebas automatizadas y ejecución con Docker.
Alcance de AE1
El grupo implementa su parte del módulo Clientes. La identidad y la consulta de viajes se simulan para ejecutar y probar M2 de manera independiente.
RF-2.2: crear, listar, consultar, reemplazar y eliminar direcciones favoritas o recientes, destinadas a origen, destino o ambos.
RF-2.4: registrar una puntuación de 1 a 5 y un comentario opcional para el conductor de un viaje completado; consultar las calificaciones emitidas.
El servicio valida las entradas, aísla datos por cliente e impide calificaciones duplicadas.
TypeScript, Node.js 24, Express 5, SQLite integrado en Node, OpenAPI 3.0.3, Swagger UI, el ejecutor de pruebas de Node y Docker Compose v2. Las versiones resueltas de dependencias están en `package-lock.json`; instalar con `npm ci`.
Se eligió TypeScript por el control de tipos, Express por la exposición HTTP y SQLite por permitir persistencia local con pocas dependencias. Las decisiones y sus límites están en Decisiones de arquitectura.
Puesta en marcha
Los comandos siguientes se ejecutan desde la raíz del repositorio, donde están `package.json` y `compose.yaml`.
Si se parte de una carpeta vacía y se cuenta con acceso al repositorio del curso:
Si el repositorio ya está abierto, comenzar directamente por una de las opciones siguientes.
Opción A: Node
Requisito: Node 24 y npm.
```bash
npm ci
npm test
npm start
```
`npm test` compila TypeScript y ejecuta las pruebas.
Opción B: Docker
Requisitos: Docker Engine iniciado y Docker Compose v2. No se necesita instalar Node en la máquina anfitriona para esta opción.
En Codespaces se usa Docker en ese entorno; no hace falta instalar Docker Desktop en la PC ni crear una web desde esa aplicación. Docker Hub es un registro para publicar imágenes y no es necesario para ejecutar esta entrega con Compose. La publicación de imágenes en un registro figura dentro de CI/CD para AE4 en el escenario.
```bash
docker compose -f compose.yaml --profile pruebas run --build --rm pruebas
docker compose -f compose.yaml up --build -d clientes
docker compose -f compose.yaml ps
```
El primer comando debe terminar con código de salida 0. El servicio `clientes` debe permanecer activo; su healthcheck pasa a `healthy` cuando responde `/salud`. No iniciar simultáneamente otra API en el puerto 3000.
```bash
curl -i http://localhost:3000/salud
```
Respuesta esperada: HTTP 200 con `{"estado":"OK"}`.
Para consultar logs y detener el servicio:
```bash
docker compose -f compose.yaml logs --tail 80 clientes
docker compose -f compose.yaml down
```
El volumen conserva los datos al recrear o detener el contenedor. No hace falta usar `down -v`: esa opción elimina también el volumen y los datos.
Acceder a la API
En Codespaces, abrir la pestaña PORTS, localizar el puerto 3000 y usar Open in Browser. Agregar `/docs/` a la dirección que abre Codespaces.
Recurso	Ruta
Swagger UI	`/docs/`
OpenAPI generado por el servicio	`/openapi.json`
Salud de la base de datos	`/salud`
Identidad simulada	`/sesion`
Se incluye una copia exportada de OpenAPI. Si cambia el código del contrato, volver a exportarla; la ruta `/openapi.json` muestra el contrato de la versión en ejecución.
Configuración
Variable	Valor local por defecto	Configuración en Compose
`PORT`	`3000`	`3000`
`DB_PATH`	`./data/customer.sqlite`	`/app/data/customer.sqlite`
`CLIENTE_SIMULADO`	`cliente-1`	`cliente-1`
El servidor escucha en `0.0.0.0`. Para cambiar un valor en ejecución local, usar variables de entorno; en Docker, modificar `environment` en `compose.yaml`. Exportar una variable en la terminal no sustituye los valores literales ya escritos en Compose.
`CLIENTE_SIMULADO` configura una identidad fija de demostración. No es una contraseña ni un token y no autentica personas.
Endpoints
Método	Ruta	Función
POST	`/clientes/{clienteId}/direcciones`	Crear una dirección
GET	`/clientes/{clienteId}/direcciones`	Listar; filtro opcional `?tipo=FAVORITA` o `RECIENTE`
GET	`/clientes/{clienteId}/direcciones/{id}`	Consultar una dirección
PUT	`/clientes/{clienteId}/direcciones/{id}`	Reemplazar datos editables
DELETE	`/clientes/{clienteId}/direcciones/{id}`	Eliminar una dirección
POST	`/clientes/{clienteId}/calificaciones`	Calificar un viaje completado
GET	`/clientes/{clienteId}/calificaciones`	Listar calificaciones propias
GET	`/clientes/{clienteId}/calificaciones/{id}`	Consultar una calificación propia
Ejemplo RF-2.2
```bash
curl -i -X POST http://localhost:3000/clientes/cliente-1/direcciones \
  -H 'Content-Type: application/json' \
  -d '{"alias":"Casa","direccion":"Av. 3 de Abril 1200","tipo":"FAVORITA","uso":"ORIGEN"}'
```
Devuelve 201, el identificador generado y la cabecera `Location`. Puede enviarse dirección escrita o un par de coordenadas válidas. Las coordenadas se envían juntas; `uso` toma `AMBOS` si se omite. PUT reemplaza los campos editables: los opcionales omitidos vuelven a sus valores predeterminados.
Ejemplo RF-2.4
```bash
curl -i -X POST http://localhost:3000/clientes/cliente-1/calificaciones \
  -H 'Content-Type: application/json' \
  -d '{"viajeId":"viaje-1","puntuacion":5,"comentario":"Buen trato."}'

curl http://localhost:3000/clientes/cliente-1/calificaciones
```
La primera calificación del viaje devuelve 201; repetirla devuelve 409 y conserva la anterior. El cliente se toma de la ruta validada y el conductor del viaje consultado. No se envían `clienteId`, `conductorId` ni `estado` en el cuerpo. El comentario admite hasta 500 caracteres después de recortar espacios; si se omite, es null o queda vacío, se guarda null.
Viaje de demostración	Situación	Resultado de una calificación válida
`viaje-1`	Propio, completado, conductor-1	201; 409 si ya se calificó
`viaje-2`	Propio, en curso	422
`viaje-3`	Propio, cancelado	422
`viaje-4`	Ajeno, completado	404
`viaje-5`	Propio, completado, conductor-2	201; 409 si ya se calificó
Otro identificador	Inexistente	404
Los viajes propios se asignan al valor de `CLIENTE_SIMULADO`. Los datos del simulador no cambian de estado ni se guardan en SQLite. Reiniciar la aplicación conserva las calificaciones persistidas: no habilita volver a calificar el mismo viaje.
Errores
Formato común: `{"codigo":"...","mensaje":"..."}`.
HTTP	Situación
400	Entrada, filtro o JSON inválido
403	La ruta pertenece a otro cliente
404	Recurso inexistente o ajeno
409	Calificación duplicada
413	Cuerpo superior a 16 KB
422	Viaje no completado
503	No se pudo consultar el viaje; no se guarda la valoración
500	Error interno no previsto
Datos y contenedores
Las tablas `direcciones` y `calificaciones` pertenecen a M2 y están en `customer.sqlite`. No se consultan tablas de otro servicio. SQLite se ejecuta dentro del proceso de Node; no necesita un contenedor de base de datos separado.
El Dockerfile tiene etapas `compilacion`, `pruebas` y `ejecucion`. La última instala dependencias de producción y copia `dist` desde la primera. El servicio usa el usuario `node`; el volumen `datos-clientes` se monta en `/app/data`. La etapa de pruebas utiliza bases en memoria o archivos temporales, no el volumen de demostración.
Diagramas: Componentes y Datos y propiedad.
Pruebas y evidencias
```bash
npm test
```
Archivo	Tipo de prueba	Cantidad en la versión documentada
`test/validaciones.test.ts`	Unidad: direcciones	18
`test/direcciones.test.ts`	Integración HTTP y persistencia: direcciones	12
`test/calificaciones-validaciones.test.ts`	Unidad: calificaciones	21
`test/calificaciones.test.ts`	Integración HTTP, duplicados y persistencia: calificaciones	16
Total		67
Las pruebas no requieren una API previamente iniciada. Los casos HTTP crean un servidor en un puerto libre y una base independiente. Los de persistencia cierran y reabren un archivo temporal. La prueba de solicitudes simultáneas espera una respuesta 201 y una 409; no representa una prueba de carga distribuida.
El responsable informó 67 aprobadas de 67 en Codespaces. Se incluye además una ejecución de referencia sobre la copia documentada, con su procedencia. Todavía se deben adjuntar la captura del entorno de entrega, la ejecución en Docker y el historial real de Git.
Para generarlos sin redactar resultados manualmente, seguir Evidencias y Git. El script opcional `scripts/recolectar-evidencias.sh` captura salidas y códigos de retorno.
Documentación de la entrega
Alcance, identidad y viajes simulados.
Componentes y despliegue.
Datos y propiedad.
Decisiones de arquitectura.
Trazabilidad entre requisitos y evidencias.
Portafolio del trabajo.
Bitácora individual de Lucas Caamaño.
Evidencias, historial Git y presentación.
La consigna de referencia es `ISI-Paradigmas3-AE1-Escenario-MovilidadUrbana-2026(1).docx`. La documentación cubre la parte asignada de M2 y distingue lo implementado de la evolución prevista. La aprobación corresponde a la cátedra.