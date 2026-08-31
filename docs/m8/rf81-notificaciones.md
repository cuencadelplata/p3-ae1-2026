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

El contrato REST de RF-8.1 fue definido siguiendo el enfoque Design-First y se encuentra especificado en:

`docs/api/openapi.yaml`

RF-8.1 expondrá inicialmente un único endpoint:

`POST /notifications`

Su responsabilidad será recibir información sobre un evento de viaje ya ocurrido y generar la notificación correspondiente.

No se implementará `GET /notifications` durante AE1, ya que RF-8.1 no requiere una bandeja, historial o consulta de notificaciones.

### Datos de entrada

La operación recibirá:

- identificador del viaje;
- identificador del destinatario;
- tipo de evento;
- canal solicitado.

El mensaje de la notificación no será recibido desde otros módulos.

M8 deberá generarlo a partir del tipo de evento.

### Eventos soportados

Los eventos definidos son:

- `TRIP_REQUESTED`;
- `DRIVER_ASSIGNED`;
- `DRIVER_ARRIVED`;
- `TRIP_STARTED`;
- `TRIP_CANCELLED`;
- `TRIP_COMPLETED`.

### Canal soportado en AE1

Durante AE1 se utilizará únicamente:

`PUSH`

El proveedor externo de PUSH será reemplazado mediante un mock.

EMAIL y SMS quedan previstos como posibles extensiones posteriores.

### Resultado

Cuando el procesamiento sea correcto, M8 deberá devolver información como:

- identificador de la notificación;
- identificador del viaje;
- destinatario;
- evento;
- canal;
- mensaje generado;
- estado;
- fecha de creación.

El estado `PROCESSED` representa que M8 completó correctamente su procesamiento.

Durante AE1 no representa confirmación de entrega real al dispositivo porque el proveedor PUSH será simulado.

## Manejo de errores

La API deberá mantener un formato uniforme para los errores.

El contrato contempla:

- `201 Created`: procesamiento correcto;
- `400 Bad Request`: datos de entrada inválidos;
- `415 Unsupported Media Type`: contenido diferente de `application/json`;
- `500 Internal Server Error`: error interno de M8.

Los códigos internos de error definidos inicialmente son:

- `VALIDATION_ERROR`;
- `UNSUPPORTED_MEDIA_TYPE`;
- `NOTIFICATION_PROCESSING_ERROR`.

Los errores internos no deberán exponer información sensible.

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

## Evidencias previstas para RF-8.1

El cumplimiento de RF-8.1 deberá poder demostrarse mediante:

- contrato OpenAPI;
- pruebas unitarias de la lógica de notificaciones;
- pruebas de integración del endpoint;
- pruebas E2E locales contra la solución contenerizada;
- interfaz de usuario;
- ejecución mediante contenedores.

Las evidencias concretas y sus ubicaciones se documentarán a medida que sean implementadas.