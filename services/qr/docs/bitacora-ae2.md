# Bitácora AE2 — RF-8.2 QR de verificación

Reflexión de proceso sobre la evolución individual de RF-8.2. El detalle técnico está en el
[ADR-001](adr/ADR-001-qr-consumo-atomico-redis.md) y las evidencias en [ae2-rf82.md](ae2-rf82.md).

## Decisión arquitectónica

El uso único del QR pasó de depender del event loop de un proceso (AE1, `Map` en memoria) a un
script Lua en Redis que comprueba y marca el uso en un único paso atómico. Comparé cinco
alternativas: leer y escribir por separado, `WATCH`/`MULTI`, un lock con `SET NX`,
`GETDEL`/`HGETDEL` y Lua.

La comparación decisiva fue con `GETDEL`/`HGETDEL`: también son atómicos, pero al consumir borran
la clave, y con eso se pierde la diferencia entre 409 (ya usado), 410 (vencido) y 404 que el
contrato heredado de AE1 ya ofrecía. Además, `HGETDEL` requiere Redis 8 y el entorno usa Redis 7.
Lua conserva el contrato con una sola ida y vuelta. A cambio, parte de la lógica queda escrita en
otro lenguaje.

## Dificultades y fallas detectadas

- **El timeout que no era.** Configuré el timeout por comando de node-redis creyendo que cubría la
  espera de la respuesta, y así lo escribí en dos mensajes de commit (f6a0e77 y 4f7f70a). Al
  armar las pruebas de resiliencia con un proxy que simula un Redis colgado, las solicitudes
  quedaban pendientes sin límite. Leyendo el código de la biblioteca encontré que el timeout se
  descarta al enviar el comando. Lo corregí con un tope propio por operación (4f93950). La
  lección: una garantía de infraestructura se verifica provocando la falla, no leyendo la opción
  de configuración.
- **Una prueba que dependía de dos relojes.** En la corrida limpia previa al push, un caso del
  contrato falló una vez; en 20 corridas aisladas no se reprodujo. Midiendo el desfase vi que el reloj de Redis
  iba alrededor de 1 ms atrás del de Node, y la prueba los mezclaba. Lo corregí haciendo que cada
  store use su propio reloj (948f4e2). Lo registré en el reporte en lugar de repetir la corrida
  hasta que pasara.
- **La respuesta perdida.** Al probar que un 503 nunca aprueba un QR, apareció un caso que no se
  puede resolver con fail-closed: Redis ejecuta el consumo y la respuesta se pierde. El cliente
  recibe 503 y, al reintentar, 409. Quedó demostrado en una prueba y documentado en el contrato,
  en lugar de ocultarlo.

## Cambios a partir del feedback

- **Otro viaje:** se discutió responder un error distinto cuando el QR es de otro viaje. Se
  mantuvo el 404 de AE1, para no revelar que el token existe, y el motivo pasó sólo a los logs.
- **Vencimiento:** se agregó un margen configurable para seguir respondiendo 410 después del
  vencimiento, en lugar de que Redis borre la clave al vencer.
- **Logs:** el `tripId` se recorta en los logs, porque llega del cliente sin largo máximo.
- **Documentación:** se quitaron afirmaciones que no estaban verificadas, y los números del
  reporte salen de corridas reales con su commit y su fecha.

## Pendiente

Coordinar con M6 el contrato del QR: su cliente actual usa otros nombres de campos y trata
cualquier 4xx como M8 caído (ver [contrato-m6.md](contrato-m6.md)). También queda definir si un
viaje puede tener varios QR activos.
