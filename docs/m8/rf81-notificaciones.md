# RF-8.1 — Notificaciones de viaje

## Responsable

Juan Martin Invaldi  
Grupo 6

## Branch de trabajo

`feature/m8-r81-notifications-grupo6`

## Objetivo

Implementar las notificaciones correspondientes a eventos relevantes del viaje.

RF-8.1 deberá contemplar los siguientes eventos:

- solicitud;
- asignación;
- arribo;
- inicio;
- cancelación;
- finalización.

M8 no decide que uno de estos eventos ocurrió.

La responsabilidad de M8 comienza cuando recibe la información correspondiente al evento y debe generar o procesar la notificación asociada.

## Responsabilidad de RF-8.1

RF-8.1 deberá encargarse de:

- recibir la información necesaria para generar una notificación;
- identificar el evento de viaje recibido;
- validar los datos necesarios;
- generar la notificación correspondiente;
- permitir el uso de uno o más canales de notificación según el alcance definido;
- mantener la funcionalidad desacoplada de los módulos que administran el viaje.

## Información externa

En una etapa posterior, parte de la información necesaria será recibida desde otros módulos del sistema.

Durante esta etapa no existe todavía integración real con esos módulos.

Por lo tanto, se utilizarán mocks para representar información como:

- identificador del viaje;
- identificador del usuario;
- evento ocurrido.

Estos datos simulados representan únicamente la información externa.

El procesamiento de la notificación deberá ser implementado realmente por M8.

## Eventos requeridos

RF-8.1 deberá soportar como mínimo:

### Solicitud

Representa que se realizó una solicitud de viaje.

### Asignación

Representa que un conductor fue asignado al viaje.

### Arribo

Representa que el conductor llegó al punto correspondiente.

### Inicio

Representa que el viaje comenzó.

### Cancelación

Representa que el viaje fue cancelado.

### Finalización

Representa que el viaje finalizó.

## Contrato de API

El contrato REST de RF-8.1 todavía no está definido de manera definitiva.

Como propuesta inicial se habían considerado:

`POST /notifications`

`GET /notifications`

Estos endpoints deberán ser analizados antes de comenzar a programar.

Se deberá determinar:

- si ambos endpoints son realmente necesarios;
- qué información recibirá cada operación;
- qué respuestas devolverá;
- qué códigos HTTP utilizará;
- qué errores deberán contemplarse;
- cómo se representarán los seis eventos del viaje.

La definición definitiva se realizará mediante OpenAPI siguiendo el enfoque Design-First.

## Fuera de alcance

RF-8.1 no deberá implementar:

- generación o validación de QR;
- generación de comprobantes PDF;
- reenvío de comprobantes;
- tickets de soporte;
- RabbitMQ;
- autenticación propia;
- administración del viaje;
- cálculo de tarifas;
- procesamiento de pagos.

Estas responsabilidades corresponden a otros requerimientos o módulos.