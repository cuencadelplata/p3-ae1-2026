# Alcance del Módulo 8

## Módulo

M8 — Notificaciones, Documentos y Soporte.

El Módulo 8 se encarga de las funcionalidades relacionadas con:

- notificaciones de viaje;
- QR de verificación;
- comprobantes PDF;
- reenvío de comprobantes;
- tickets de soporte.

M8 no administra directamente el ciclo de vida del viaje, los usuarios ni los pagos.

Recibe información proveniente de otros módulos y realiza únicamente las acciones correspondientes a sus propias responsabilidades.

---

## Organización del Grupo 6

Nuestro grupo trabaja específicamente sobre:

- Juan Martin Invaldi: RF-8.1 — Notificaciones de viaje.
- Goya Bautista: RF-8.2 — QR de verificación.

Ambos requerimientos deberán formar parte posteriormente del mismo servicio M8 y de una API REST común.

Los demás requerimientos de M8 serán desarrollados por otros grupos.

---

# RF-8.1 — Notificaciones de viaje

RF-8.1 contempla notificaciones relacionadas con:

- solicitud;
- asignación;
- arribo;
- inicio;
- cancelación;
- finalización.

RF-8.1 se desarrolla en su branch correspondiente y no forma parte del trabajo actual.

---

# RF-8.2 — QR de verificación

RF-8.2 deberá generar un QR:

- temporal;
- asociado a un viaje;
- de un solo uso;
- destinado a validar el inicio del viaje;
- sin exposición de información sensible.

La branch actual implementará realmente:

- generación de un token seguro;
- generación de una representación QR;
- asociación del token con un `tripId`;
- fecha de creación;
- fecha de expiración;
- validación;
- control de expiración;
- control de asociación con el viaje;
- invalidación después de su primer uso exitoso;
- rechazo de reutilización.

---

## Responsabilidad de M6

M6 — Viajes y Ciclo de Vida administra los estados del viaje.

Entre otras responsabilidades, M6 sabe cuándo un viaje:

- fue solicitado;
- fue asignado;
- tuvo arribo del conductor;
- está preparado para comenzar;
- está en curso;
- fue completado;
- fue cancelado.

M8 no deberá duplicar estas responsabilidades.

---

## Integración conceptual M6 → M8

El flujo esperado para QR es:

1. M6 necesita un mecanismo de verificación para un viaje.
2. M6 solicita a M8 generar un QR indicando el `tripId`.
3. M8 genera un token opaco.
4. M8 asocia internamente el token con ese `tripId`.
5. M8 establece su fecha de expiración.
6. M8 genera la representación QR.
7. El usuario presenta el QR.
8. M6 recibe o captura el token.
9. M6 consulta a M8 para validarlo.
10. M8 comprueba existencia, asociación, vigencia y uso previo.
11. Si corresponde, M8 consume el QR.
12. M8 devuelve el resultado.
13. M6 decide si realiza la transición de inicio del viaje.

El paso 13 pertenece exclusivamente a M6.

---

## Información administrada por RF-8.2

M8 solamente necesita conservar los datos propios de la funcionalidad.

Modelo conceptual mínimo:

- `id`
- `tripId`
- `tokenHash`
- `createdAt`
- `expiresAt`
- `usedAt`

El token original se utiliza para producir/presentar el QR.

No es necesario conservar información completa del viaje.

---

## Información que NO pertenece a RF-8.2

RF-8.2 no necesita administrar:

- cliente;
- conductor;
- vehículo;
- origen;
- destino;
- tarifa;
- forma de pago;
- estado completo del viaje;
- historial completo del viaje.

En particular, esos datos no deben incluirse dentro del contenido codificado por el QR.

---

## Alcance de integración durante AE1

Durante esta etapa no existe integración real con M6.

El `tripId` recibido representa la información que posteriormente proporcionará M6.

Puede utilizarse información simulada o mocks exclusivamente para representar esa dependencia externa.

No debe simularse la lógica propia de M8.

Por lo tanto deben funcionar realmente:

- token;
- QR;
- expiración;
- validación;
- control de un solo uso.

---

## Persistencia durante AE1

La propiedad lógica de los datos del QR pertenece a M8.

Durante AE1 podrá utilizarse el mecanismo de almacenamiento temporal adoptado por el proyecto.

Si se utiliza almacenamiento en memoria, debe documentarse como decisión transitoria.

M8 no debe acceder directamente a tablas de M6.

---

## RabbitMQ y Redis

RabbitMQ no forma parte del alcance actual de RF-8.2.

Redis tampoco es necesario para implementar RF-8.2 en AE1.

Ambas tecnologías pertenecen a etapas posteriores del escenario salvo decisión explícita de la cátedra.

No incorporarlas únicamente para anticipar trabajo futuro.

---

## Alcance de la branch actual

Branch:

`feature/m8-r82-qr-grupo6`

Implementar solamente RF-8.2.

No implementar ni modificar funcionalidad perteneciente a:

- RF-8.1;
- RF-8.3;
- RF-8.4;
- RF-8.5;
- RF-8.6;
- M1;
- M2;
- M3;
- M4;
- M5;
- M6;
- M7.

Los elementos comunes de infraestructura pueden reutilizarse cuando sea necesario y no alteren funcionalidades ajenas.