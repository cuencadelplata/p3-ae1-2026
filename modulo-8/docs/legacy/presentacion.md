Presentacion del Modulo 8

Módulo 8 — Notificaciones, Documentos y Soporte.

- Responsabilidad principal:
En esta primera version, nuestras seccion del modulo se encarga de procesar notificaciones relacionadas con los viajes y de generar y validar codigos QR temporales para verificar un viaje.

- Requerimientos funcionales implementados:  
* RF 8.1 (Notificaciones de viaje): procesa los eventos de un viaje como inicio y cancelacion.
M8 genera el mensaje correspondiente y lo procesa mediante un canal PUSH simulado.

* RF 8.2 (QR de verificacion): genera un QR temporal asociado a un viaje y permite validarlo una unica vez.
El QR utiliza un token, posee vencimiento y no contiene información sensible.

- Informacion que administra el modulo:
* Para las notificaciones, recibe el identificador del viaje, el destinatario, el evento ocurrido y el canal de envío.
* Para los QR, administra temporalmente el identificador del viaje, el hash del token, su vencimiento y su estado de uso.
Durante AE1, esta información se mantiene en memoria.

- Integracion necesaria:
M8 debe integrarse principalmente con el Modulo 6, responsable de administrar el ciclo de vida del viaje.

- Motivo de la integracion:
M8 necesita conocer los eventos que ocurren en un viaje para generar notificaciones y necesita el identificador del viaje para asociar y validar el QR. Sin embargo, no administra ni modifica el viaje.

- Informacion intercambiada:
El otro modulo enviaria a M8 el tripId.
Ademas, para las notificaciones tambien enviaria el tipo de evento y el destinatario.
Para la validacion QR, M8 devuelve si el codigo es valido, esta vencido, fue utilizado o no corresponde al viaje.

- Quien inicia la comunicacion y resultado esperado:
En una integracion real, M6 u otro modulo responsable iniciaria la comunicacion al informar un evento o solicitar un QR.
M8 procesaria la notificacion o validaria el QR y devolveria el resultado.
Aunque un QR sea valido, M8 no inicia el viaje ni lo cambia a EN_CURSO; esa decision sigue perteneciendo a M6.