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

## Canal inicial de notificaciones

RF-8.1 permite utilizar uno o más canales de notificación.

Para AE1 se utilizará PUSH como único canal soportado.

El procesamiento propio de M8 será real, incluyendo:

- validación de la solicitud;
- reconocimiento del evento;
- generación del mensaje;
- creación del identificador de notificación;
- asignación de fecha y estado;
- procesamiento mediante el canal configurado.

El proveedor externo encargado de entregar la notificación PUSH será reemplazado temporalmente mediante un mock.

Por lo tanto, el estado `PROCESSED` indica que M8 completó correctamente su procesamiento, pero no confirma una entrega real al dispositivo del destinatario.

La arquitectura deberá permitir incorporar EMAIL y SMS posteriormente sin modificar la lógica central de RF-8.1.

## Propiedad de datos

M8 será propietario únicamente de los datos correspondientes a sus propias responsabilidades, como notificaciones y QR.

M8 no deberá consultar directamente tablas pertenecientes a M1, M5, M6, M7 u otros servicios.

Durante AE1, cualquier información externa necesaria será proporcionada mediante mocks.

La estrategia concreta de persistencia se definirá durante la implementación, manteniendo la propiedad de los datos dentro del límite del servicio M8.

## Estrategia de pruebas

Desde AE1 se deberán incluir pruebas unitarias y de integración.

Además, para la entrega actual se deberán implementar pruebas E2E ejecutadas localmente contra la solución contenerizada.

Las pruebas se incorporarán de acuerdo con la responsabilidad evaluada:

- pruebas unitarias para lógica de negocio;
- pruebas de integración para API y componentes relacionados;
- pruebas E2E para verificar el flujo funcional contra el servicio ejecutado mediante contenedores.

Las pruebas no deberán depender de servicios externos reales durante AE1.

Cada branch deberá implementar únicamente las pruebas correspondientes al requerimiento que desarrolla.

Una vez integrados RF-8.1 y RF-8.2, la solución conjunta deberá permitir ejecutar las pruebas E2E de ambos requerimientos.

## Interfaz de usuario

La entrega incluirá una interfaz de usuario para demostrar las funcionalidades de RF-8.1 y RF-8.2.

La UI deberá consumir la API de M8 y no duplicar lógica de negocio correspondiente al servicio.

Para RF-8.1 deberá permitir demostrar el procesamiento de los eventos de notificación y visualizar de forma clara el resultado obtenido.

La interfaz deberá contemplar estados claros de carga, éxito y error.

También deberá ser utilizable de manera responsiva y poder ejecutarse junto con la solución contenerizada.

La tecnología específica utilizada para el frontend se definirá antes de comenzar su implementación.

## Infraestructura de la entrega

La solución deberá poder ejecutarse localmente mediante contenedores.

Las imágenes utilizadas para la entrega deberán publicarse en Docker Hub.

No se realizará despliegue cloud en esta etapa.

RabbitMQ, Redis, observabilidad avanzada, alta disponibilidad y demás elementos cuyo nivel mínimo comienza en AE2 o AE4 no deberán incorporarse todavía salvo requerimiento explícito.