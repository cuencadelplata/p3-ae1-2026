# Cierre de integración AE4 de M8

## Compose común y pruebas

El [Compose integrado de M8](../compose.integracion.yaml) usa PostgreSQL propio,
Redis y RabbitMQ compartidos, M1 para identidad, M2 para preferencias de
clientes, M3 para datos de conductor y vehículo, M6 para viajes y M7 para
pagos. Usa Web Push y SMTP. Las credenciales se cargan fuera de Git.

Los simuladores de M1, M2 y M7 del [Compose local](../compose.yaml) sirven para
pruebas aisladas y de carga. La prueba de entrega integrada debe usar los
servicios reales. La API común recibe avisos por RabbitMQ y la página
`/push` permite comprobar una suscripción con un aviso Web Push real.

## Penalizaciones de clientes

1. El operador resuelve el ticket y confirma la infracción con
   `POST /tickets/{id}/penalizacion` y el cuerpo `{"motivo":"Motivo de la infracción confirmada"}`.
   M8 valida el Bearer y el rol `OPERADOR` con M1. Obtiene el `clientUserId`
   del viaje desde M6. El operador que confirma y el cliente sancionado se
   guardan por separado. Si M6 no devuelve el identificador canónico, M8
   responde `422` y la confirmación no se guarda.
2. M8 conserva una penalización por cliente y viaje. Repetir la misma
   confirmación devuelve el registro existente. Una confirmación distinta
   para un viaje ya penalizado responde `409`.
3. M2 consulta `GET /usuarios/{userId}/penalizaciones` desde la red interna,
   con el encabezado `X-Secret-Key`. La clave se configura con
   `M2_SOPORTE_SECRET_KEY` en el Compose común. M8 devuelve únicamente los
   registros vigentes durante 90 días en el formato
   `{ userId, total, penalizaciones: [{ ticketId, tripId, motivo, fecha }] }`.
4. M2 administra el estado de cuenta. El bloqueo temporal se recalcula con
   las penalizaciones vigentes. El permanente se conserva hasta la revisión
   manual. El desbloqueo requiere el endpoint que publique M2.

## Frontend común

- Usar la sesión de M1 para consultar comprobantes y operar sobre los tickets
  según el rol. El panel de operador puede confirmar una penalización desde
  un ticket resuelto. La consulta de penalizaciones se mantiene en la red
  interna entre M2 y M8.
- Registrar en `POST /devices/tokens` la suscripción del navegador con
  `platform: "WEB"` y su JSON serializado en `token`. En la baja, usar
  `DELETE /devices/tokens/{token}` con el token codificado en la URL. La
  suscripción usa el Bearer de M1 y la clave VAPID pública de M8.
- Verificar en el origen final que el navegador permita la suscripción,
  que su service worker reciba avisos y que la baja detenga los envíos.
  Para usar la pantalla de activación de M8, el frontend debe enlazar a
  `/push` en el origen público configurado y permitir su worker
  `/push/sw.js` con alcance `/push`.
- Configurar `M8_PUBLIC_BASE_URL` con la URL pública que resuelva los enlaces
  de descarga del PDF. Si se usa `/push`, configurar `M8_PUSH_M1_PUBLIC_URL`
  con la URL de M1 accesible desde el navegador.

## Dependencias de otros equipos

- **M1.** Para reservas, acordar con M9 dónde emitir el token delegado del
  cliente y qué autorización se necesita. Para el frontend común, mantener
  el flujo de identidad y recuperación accesible desde el origen final.
- **M2.** Apuntar `M2_SOPORTE_SERVICE_URL` a `http://m8-app:3000`, completar
  la clave compartida y desactivar los stubs en el Compose común con
  `M2_STUBS_ENABLED=false`. Aplicar la regla acordada para bloqueos
  permanentes y publicar el endpoint de revisión manual. Confirmar qué
  sucede si las penalizaciones siguen vigentes tras el desbloqueo.
- **M3.** Confirmar el endpoint que devuelve nombre y apellido del conductor
  por su `userId` de M1 y asegurar la durabilidad de vehículos y documentos
  para que el enriquecimiento funcione tras un reinicio.
- **M4 y M9.** Conectar el resolver de M9 a la geocodificación y estimación
  de M4 en la red común. La prueba final debe usar la ruta real.
- **M5 y M9.** Confirmar que el despacho REST programado acepta el token
  delegado acordado con M1. Mantener documentado el límite de los eventos
  de M5 que no alcanzan a publicarse durante una caída del broker.
- **M6.** Incorporar `clientUserId` numérico de M1 en
  `GET /api/viajes/{id}`. Hoy crear y asignar el viaje lo devuelven, pero
  la consulta devuelve una representación que lo omite. Es necesario para
  confirmar penalizaciones con los servicios reales. En el recorrido de
  reserva, completar arribo, QR e inicio y publicar `trip.completed` al
  finalizar para emitir el comprobante.
- **M7.** Fijar la versión de la imagen que se validará en la entrega con
  M6 y M8. Conservar el medio elegido y su estado real. Usar credenciales
  de prueba para verificar el cobro con tarjeta.
- **Frontend y despliegue.** Publicar el frontend común con sus rutas
  operativas, configurar el origen HTTPS y la red interna. Hacer la prueba
  conjunta de reserva activada, despacho, asignación, aviso en el navegador
  y comprobante descargable.
