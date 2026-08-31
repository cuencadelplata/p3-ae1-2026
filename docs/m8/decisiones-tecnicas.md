# Decisiones técnicas — M8 Grupo 6

## API REST

El Módulo 8 se implementará como un servicio que expondrá una API REST.

Dentro de la misma API existirán distintas funcionalidades correspondientes a los requerimientos del módulo.

Nuestro grupo desarrollará inicialmente las funcionalidades correspondientes a RF-8.1 y RF-8.2.

## Node.js y Express

La API será desarrollada utilizando Node.js y Express.

REST será utilizado como estilo arquitectónico para organizar los recursos y operaciones HTTP.

Express será utilizado para implementar el servidor, las rutas y los endpoints de la API.

## OpenAPI y Swagger UI

La API será especificada utilizando OpenAPI.

OpenAPI permitirá definir el contrato de la API, incluyendo:

- endpoints;
- métodos HTTP;
- datos de entrada;
- respuestas;
- códigos HTTP;
- errores;
- esquemas utilizados.

Swagger UI será utilizado para visualizar y probar la especificación OpenAPI.

## Enfoque Design-First

Se utilizará un enfoque Design-First o Contract-First.

Antes de implementar los endpoints con Express se definirá y revisará el contrato de la API.

El orden de trabajo será:

1. Analizar los requerimientos.
2. Definir los endpoints necesarios.
3. Definir datos de entrada, respuestas y errores.
4. Crear la especificación OpenAPI.
5. Revisar el contrato.
6. Implementar la API con Express respetando el contrato definido.

## Uso de mocks

Durante esta etapa las dependencias con otros módulos serán reemplazadas mediante mocks.

Los mocks representarán únicamente información que posteriormente será recibida desde otros servicios.

La lógica propia de M8 no será simulada.

## Organización del código

Se prevé separar las responsabilidades mediante componentes para:

- control de endpoints;
- lógica de negocio;
- validación de datos;
- mocks;
- pruebas.

La estructura definitiva se determinará al comenzar la implementación, evitando agregar componentes que no sean necesarios.

## Git

El repositorio es compartido con los demás grupos.

Nuestro trabajo se realizará únicamente en las branches correspondientes al Grupo 6.

RF-8.1:

`feature/m8-r81-notifications-grupo6`

RF-8.2:

`feature/m8-r82-qr-grupo6`

No se realizarán commits directamente sobre `main` ni se modificarán branches pertenecientes a otros grupos.