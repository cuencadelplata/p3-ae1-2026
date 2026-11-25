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
   manual. Desde un ticket resuelto, un operador puede llamar a
   `POST /tickets/{id}/desbloqueo` con `{"motivo":"Motivo de la revisión"}`.
   M8 toma el operador de la sesión M1, obtiene el cliente del viaje en M6
   y pide la revisión a `POST /internal/usuarios/{userId}/desbloqueo` de
   M2 con `X-Secret-Key`. Las penalizaciones se conservan en M8. M2 registra
   la revisión y excluye del recálculo las penalizaciones previas.

Para comprobar la confirmación en el Compose común, usá M6 actualizado y
un operador de prueba de M1. Cargá `SUPPORT_E2E_OPERATOR_EMAIL` y
`SUPPORT_E2E_OPERATOR_PASSWORD` fuera de Git y ejecutá desde `modulo8`:

```powershell
node tests/e2e/shared-compose-penalty.mjs
```

La prueba crea un viaje con valores distintos para `clienteId` y
`clientUserId`. Comprueba que M6 devuelve el ID de M1, que un cliente recibe
`403` cuando intenta confirmar la infracción y que el operador recibe
`201`. Repetir la confirmación devuelve `200` con el mismo registro.
Si el entorno tiene `M2_SOPORTE_SECRET_KEY`, también verifica la consulta
de penalizaciones de M8 con esa clave.

Para probar también el bloqueo y el desbloqueo, usá M2 con la migración
`202611240001_revision_manual_bloqueo` aplicada y la misma clave en ambos
servicios. La prueba crea un cliente sintético y confirma tres penalizaciones
en viajes distintos, verifica los estados de M2 y pide el desbloqueo desde M8.

```powershell
$env:SUPPORT_E2E_VERIFY_M2 = 'true'
node tests/e2e/shared-compose-penalty.mjs
Remove-Item Env:SUPPORT_E2E_VERIFY_M2
```

## Frontend común

- Usar la sesión de M1 para consultar comprobantes y operar sobre los tickets
  según el rol. El panel de operador puede confirmar una penalización o
  pedir el desbloqueo desde un ticket resuelto. La consulta de
  penalizaciones se mantiene en la red interna entre M2 y M8.
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

- **M1.** Para reservas, M1 y M9 deben publicar el contrato de emisión del
  token delegado del cliente. Configurar `M9_DISPATCH_AUTH_URL` y
  `M9_DISPATCH_AUTH_TOKEN` en el entorno privado del Compose común cuando
  esté disponible. Para que el aviso de asignación
  incluya el nombre del conductor, configurar la misma `M1_INTERNAL_API_KEY`
  en M1 y M8. M8 usa el `driverUserId` de RabbitMQ en
  `GET /auth/usuarios/{driverUserId}/nombre`. Para el frontend común, mantener
  el flujo de identidad y recuperación accesible desde el origen final.
- **M2.** Usar el Compose con `M2_SOPORTE_SERVICE_URL=http://m8-app:3000`,
  `M2_STUBS_ENABLED=false` y la `M2_SOPORTE_SECRET_KEY` compartida. Aplicar
  la migración de revisión manual al desplegar M2 sobre un volumen existente.
- **M3.** Asegurar la persistencia de vehículos y documentos para que M8
  pueda consultar el vehículo activo tras un reinicio del Compose común.
- **M4 y M9.** El Compose de M9 usa el resolver de M4 en la red común.
  Comprobar geocodificación y estimación dentro del recorrido de reserva.
- **M5 y M9.** Confirmar que el despacho REST programado acepta el token
  delegado acordado con M1. Mantener documentado el límite de los eventos
  de M5 que no alcanzan a publicarse durante una caída del broker.
- **M6.** Usar una versión que incluya el `clientUserId` numérico de M1 en
  `GET /api/viajes/{id}`. M8 lo consume para confirmar penalizaciones.
  En el recorrido de reserva, completar arribo, QR e inicio, autorizar el
  pago en M7 y finalizar en M6 para que publique `trip.completed`.
- **M7.** Fijar la versión de la imagen que se validará en la entrega con
  M6 y M8. Conservar el medio elegido y su estado real. Usar credenciales
  de prueba para verificar el cobro con tarjeta.
- **Frontend y despliegue.** Publicar el frontend común con sus rutas
  operativas, configurar el origen HTTPS y la red interna. Hacer la prueba
  conjunta de reserva activada, despacho, asignación, aviso en el navegador
  y comprobante descargable.
