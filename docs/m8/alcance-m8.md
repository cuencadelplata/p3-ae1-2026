# Alcance del Módulo 8

## Módulo

M8 — Notificaciones, Documentos y Soporte.

El Módulo 8 se encarga de las funcionalidades relacionadas con:

- notificaciones de viaje;
- QR de verificación;
- comprobantes PDF;
- reenvío de comprobantes;
- tickets de soporte.

M8 no administra directamente el ciclo de vida del viaje, los usuarios ni los pagos. Recibe información proveniente de otros módulos y realiza las acciones que corresponden a sus propias responsabilidades.

## Organización del Grupo 6

Nuestro grupo trabajará específicamente sobre:

- Juan Martin Invaldi: RF-8.1 — Notificaciones de viaje.
- Goya Bautista: RF-8.2 — QR de verificación.

Ambos requerimientos deberán formar parte del mismo servicio M8 y de una API REST común.

Los demás requerimientos del Módulo 8 serán desarrollados por otros grupos.

## RF-8.1 — Notificaciones de viaje

Se deberán contemplar notificaciones relacionadas con:

- solicitud;
- asignación;
- arribo;
- inicio;
- cancelación;
- finalización.

## RF-8.2 — QR de verificación

Se deberá generar un QR:

- temporal;
- asociado a un viaje;
- de un solo uso;
- sin información sensible;
- utilizado para la validación del inicio del viaje.

## Alcance de esta etapa

En esta primera etapa no se realizará una integración real con otros módulos.

Los datos que posteriormente serán recibidos desde módulos como M1, M5, M6 o M7 serán reemplazados temporalmente mediante mocks.

Los mocks solamente reemplazan las dependencias externas.

Las funcionalidades propias de M8 deben funcionar realmente.

Por lo tanto:

- RF-8.1 deberá procesar realmente las notificaciones.
- RF-8.2 deberá generar y validar realmente el QR, incluyendo vencimiento y control de un solo uso.

No se implementará todavía RabbitMQ como parte del trabajo de nuestro grupo.