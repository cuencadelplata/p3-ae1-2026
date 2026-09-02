M1 - Identidad y Acceso

Servicio responsable del registro, la autenticacion y la validacion de identidad y rol de los usuarios de la plataforma distribuida de movilidad urbana bajo demanda.

Enlaces

Repositorio: https://github.com/cuencadelplata/p3-ae1-2026

Branch de M1: https://github.com/cuencadelplata/p3-ae1-2026/tree/M1-Identidad-Acceso

Imagen publica: https://hub.docker.com/r/francok10/m1-identidad-acceso

Alcance asignado para AE1

RF-1.1 - Registro de identidad

Permite registrar identidades con los roles:

CLIENTE

CONDUCTOR

OPERADOR

El email debe ser unico y la contrasena debe contener al menos seis caracteres. Las contrasenas se almacenan protegidas mediante bcrypt y nunca se devuelven en las respuestas de la API.

RF-1.2 - Autenticacion

Permite iniciar sesion utilizando email y contrasena. Cuando las credenciales son correctas, entrega un token JWT Bearer con una duracion de una hora.

RF-1.3 - Roles y permisos

El rol del usuario se incorpora a la credencial JWT y puede consultarse mediante el endpoint protegido de validacion de identidad y rol.

Los requerimientos RF-1.4 y RF-1.5 no forman parte del alcance asignado a este modulo para la presente entrega.

Versiones de la imagen

Version

Contenido

francok10/m1-identidad-acceso:1

Primera version funcional con registro, autenticacion, roles, Docker y pruebas iniciales.

francok10/m1-identidad-acceso:2

Version recomendada para la evaluacion. Incorpora OpenAPI, Swagger UI, pruebas unitarias, pruebas de integracion y E2E contra contenedores.

No se depende exclusivamente de la etiqueta latest.

Requisitos previos

Para ejecutar la solucion mediante la imagen publicada se necesita:

Docker Desktop o Docker Engine.

Docker Compose v2.

Puerto 3001 disponible.

Node.js 24 y npm solamente son necesarios para ejecutar o desarrollar el modulo fuera de Docker y para las pruebas unitarias y de integracion.

Ejecucion con la imagen publicada

Descargar la version recomendada:

docker pull francok10/m1-identidad-acceso:2

Iniciar el servicio sin construirlo nuevamente:

docker compose up -d --no-build

Comprobar el estado:

docker compose ps

El contenedor debe aparecer con estado healthy.

Verificacion y acceso

Recurso

Direccion

API

http://localhost:3001

Health check

http://localhost:3001/health

Documentacion interactiva

http://localhost:3001/docs

Especificacion OpenAPI

http://localhost:3001/openapi.yaml

Respuesta esperada del health check:

{
  "status": "OK",
  "modulo": "M1 - Identidad y Acceso"
}

Ejecucion de los E2E contra contenedores

Con M1 iniciado y saludable, ejecutar:

docker compose --profile test run --rm e2e-tests

El contenedor de pruebas utiliza node:24-alpine, se comunica con M1 mediante HTTP y no accede directamente a IdentityDB.

Resultado esperado:

tests 10
pass 10
fail 0

Detencion y limpieza

Detener y eliminar los contenedores y la red local:

docker compose down

La base de datos permanece almacenada en el volumen identity_data.

Para eliminar tambien los datos persistidos:

docker compose down -v

Este ultimo comando elimina el volumen y todos los usuarios registrados.

Construccion local de la imagen

Construir e iniciar M1 desde el codigo fuente:

docker compose up -d --build

La imagen resultante queda etiquetada como:

francok10/m1-identidad-acceso:2

Ejecucion local sin Docker

Crear un archivo .env utilizando .env.example como referencia:

PORT=3001
JWT_SECRET=reemplazar-por-una-clave-segura

Instalar dependencias:

npm ci

Compilar TypeScript:

npm run build

Iniciar en modo desarrollo:

npm run dev

En PowerShell puede utilizarse npm.cmd cuando la politica de ejecucion impide invocar directamente npm:

npm.cmd run dev

Endpoints

Metodo

Ruta

Proposito

Autenticacion

GET

/health

Comprobar el estado del modulo

No

POST

/auth/registrar-usuario

Registrar una identidad

No

POST

/auth/iniciar-sesion

Iniciar sesion y obtener un JWT

No

GET

/auth/validar-identidad-y-rol

Validar el JWT y consultar identidad y rol

Bearer JWT

La definicion completa de cuerpos, validaciones, respuestas, errores y ejemplos se encuentra en openapi.yaml y puede consultarse en Swagger UI mediante /docs.

Ejemplo de registro

Solicitud:

POST /auth/registrar-usuario
Content-Type: application/json

{
  "email": "cliente@example.com",
  "password": "123456",
  "rol": "CLIENTE"
}

Respuesta correcta:

{
  "id": 1,
  "email": "cliente@example.com",
  "rol": "CLIENTE",
  "estado": "ACTIVO"
}

Ejemplo de autenticacion

Solicitud:

POST /auth/iniciar-sesion
Content-Type: application/json

{
  "email": "cliente@example.com",
  "password": "123456"
}

La respuesta incluye un token JWT Bearer, su duracion y los datos publicos de la identidad autenticada.

Pruebas automatizadas

Pruebas unitarias

Comprueban de manera aislada:

Normalizacion de email.

Formato de email.

Longitud minima de contrasena.

Roles CLIENTE, CONDUCTOR y OPERADOR.

Ejecutar:

npm run test:unit

Resultado esperado: 4 passed.

Pruebas de integracion

Comprueban la integracion entre rutas, controladores, servicios, repositorios, JWT y SQLite.

npm run test:integration

Resultado esperado: 7 passed.

Pruebas locales completas

npm test

Ejecuta las pruebas unitarias y de integracion. Resultado esperado: 11 passed.

Pruebas End-to-End

Los E2E se ejecutan contra la interfaz HTTP publica del contenedor y comprueban:

Salud del contenedor.

Disponibilidad de OpenAPI.

Registro de cliente.

Registro de conductor.

Registro de operador.

Rechazo de email repetido.

Inicio de sesion.

Rechazo de credenciales incorrectas.

Validacion de identidad y rol.

Rechazo de solicitudes sin token.

Persistencia y propiedad de datos

M1 posee una base SQLite independiente denominada IdentityDB. El archivo se almacena en /app/data/identity.db dentro del volumen Docker identity_data.

La tabla usuarios administra exclusivamente datos de identidad:

id

email

password_hash

rol

estado

created_at

Los perfiles de negocio de clientes y conductores pertenecen a otros modulos y no se almacenan en M1.

Configuracion y seguridad

PORT: puerto HTTP del servicio. Valor predeterminado: 3001.

JWT_SECRET: clave utilizada para firmar y verificar los tokens JWT.

.env esta excluido del repositorio.

Las contrasenas se protegen mediante bcrypt.

Los tokens tienen una duracion de una hora.

El contenedor de produccion se ejecuta con un usuario sin privilegios.

Estructura principal

modulo-1-identidad-acceso/
|-- src/
|   |-- config/
|   |-- controllers/
|   |-- middleware/
|   |-- repositories/
|   |-- routes/
|   |-- services/
|   |-- types/
|   `-- utils/
|-- tests/
|   |-- unit/
|   |-- integration/
|   `-- e2e/
|-- openapi.yaml
|-- Dockerfile
|-- docker-compose.yml
|-- package.json
`-- tsconfig.json

Limitaciones y evolucion

RF-1.4 Recuperacion y revocacion no forma parte del alcance asignado para esta entrega.

RF-1.5 OAuth2/OpenID Connect no forma parte del alcance asignado para esta entrega.

La creacion de perfiles de cliente y conductor corresponde respectivamente a M2 y M3.

La integracion entre modulos se realizara dentro de la vertical funcional definida por el equipo.