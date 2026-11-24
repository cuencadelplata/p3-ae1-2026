# Dos rutas críticas de M8 para AE4

Corré ambas rutas en el **Compose común** con cuentas de prueba. Para el
comprobante con tarjeta, M7 debe estar configurado con Mercado Pago en modo
`TEST`. Para el aviso en el navegador, M8 necesita un par VAPID configurado.
Las corridas generan registros de prueba. La configuración privada se mantiene
fuera de Git. [Puesta en marcha del Compose común](INTEGRACION_COMPOSE.md)

Desde la raíz, comprobá que el stack integrado esté levantado y que M8 responda.
Los ejemplos usan los puertos predeterminados de integración.

```powershell
docker compose --env-file .\modulo8\.env.integracion ps
Invoke-RestMethod http://localhost:18000/health/ready
```

Para capturar evidencia en Grafana Cloud, levantá `m8-alloy` con su configuración
privada y seleccioná el intervalo exacto de la prueba.

```powershell
docker compose --env-file .\modulo8\.env.integracion --profile observability up -d m8-alloy
```

## 1. Iniciar un viaje con QR y obtener su comprobante

**RF8.2, RF8.3 y RF8.4.** La ruta termina cuando el pasajero descarga el PDF
del viaje y obtiene un enlace nuevo para el mismo comprobante.

1. **Identificar a los participantes.** M1 registra al cliente y al conductor
   de prueba. M3 habilita al conductor y activa su vehículo. M2 guarda el
   perfil del cliente.
2. **Iniciar el viaje.** M6 crea y asigna el viaje. Al registrar el arribo,
   solicita el QR a M8 con `POST /qr`. M8 guarda su estado temporal en Redis.
   M6 llama a `POST /qr/validate` al iniciar y el viaje pasa a `EN_CURSO`.
   Un segundo consumo del mismo QR con otra clave de idempotencia devuelve
   `409` en M8.
3. **Autorizar, finalizar y emitir.** La prueba registra el pago en M7 y
   comprueba que M6 devuelve `402` mientras esté pendiente. Luego autoriza
   la tarjeta en M7 en modo TEST. M6 verifica la autorización y publica
   `trip.completed` al finalizar. M8 consulta el viaje y el pago, incorpora
   los datos del vehículo y persiste el comprobante con estado `APROBADO`.
4. **Comprobar acceso y reenvío.** El cliente consulta el comprobante con su
   sesión de M1 y abre un enlace temporal. La descarga devuelve `200` y un
   archivo PDF. Otro cliente recibe `403`. El reenvío devuelve `202` y un enlace
   nuevo para el mismo `receiptId`. Repetir la finalización conserva ese ID.

Desde `modulo8`, con las dependencias de Node instaladas:

```powershell
node tests/e2e/shared-compose-qr.mjs
$env:RECEIPT_E2E_METODO_PAGO = 'tarjeta'
node tests/e2e/shared-compose-receipt.mjs
Remove-Item Env:RECEIPT_E2E_METODO_PAGO
```

El primer comando usa su propio viaje y verifica el `409`. El segundo recorre
el mismo `tripId` desde el arribo hasta el PDF y la solicitud de reenvío. Esta
última se acredita con el `202` y el enlace descargable. Para acreditar
recepción por correo, hace falta observarla en el buzón del destinatario.

**Evidencia para presentar.** Guardá la salida del `409`, el `tripId` y número
de comprobante de la segunda corrida, y una captura del PDF. En Grafana,
filtrá RF8.2, RF8.3 y RF8.4 para mostrar la validación del QR, la descarga y
el reenvío durante la ejecución.

## 2. Recibir un aviso de viaje en el navegador

**RF8.1, RF8.6 y RF8.7.** La ruta termina cuando un evento real de M6 genera
un aviso persistido en M8 y el pasajero lo ve en su navegador.

1. **Preparar el destinatario.** Usá un cliente de M1 con perfil en M2 y
   preferencia PUSH. Abrí `http://localhost:18000/push`, iniciá sesión con ese
   cliente y elegí **Activar en este navegador**. Usá **Enviar aviso de
   prueba** para confirmar que la suscripción funciona antes de ejecutar
   el recorrido de viaje.
2. **Generar el evento.** El escenario registra un conductor de prueba y crea
   dos viajes en M6. En el primero, registra el arribo y valida el QR para
   iniciar el viaje. En el segundo, el conductor cancela. M6 publica los eventos
   en RabbitMQ. M8 los consume y usa el `userId` numérico de M1 para determinar
   a quién corresponde cada aviso.
3. **Persistir y entregar.** RF8.1 guarda la notificación y su solicitud de
   entrega en PostgreSQL. RF8.6 procesa el mensaje y controla duplicados.
   El Outbox publica `notification.requested`. RF8.7 consulta la preferencia
   del cliente en M2, usa la suscripción activa de M8 y envía el Web Push.

En una terminal abierta en `modulo8`, con el mismo cliente configurado en el
entorno privado como `DEMO_CLIENTE_EMAIL` y `DEMO_CLIENTE_PASSWORD`:

```powershell
node tests/e2e/demo-avisos-viaje.mjs
```

El script usa los puertos predeterminados de M1, M3 y M6, y consulta el
PostgreSQL de M8 del proyecto `movilidad-urbana`. Mantené abierto el navegador
suscrito. Deben aparecer **Tu conductor ha llegado**, **Viaje en curso** y
**Viaje cancelado**. El script muestra el estado de entrega guardado en M8.
`DELIVERED` confirma la aceptación por el proveedor, y la captura del aviso
en pantalla acredita la recepción en ese navegador.

**Evidencia para presentar.** Guardá la salida de terminal y una captura de
un aviso real. En Grafana, mostrá **RF8.1 - notificaciones creadas (5 min)**
y **RF8.7 - intentos de entrega (5 min)**. Para RF8.6, verificá el procesamiento
en RabbitMQ o en los logs de M8. El panel **Inbox M3 procesado** corresponde
a eventos de documentos de M3.

## Alcance de las dos corridas

Los scripts disparan el viaje directamente en M6. La activación programada
**M9 → M5 → M6 → M8** se valida como recorrido adicional al cerrar la
autorización delegada y el resolver real de M4. Las pruebas de carga con k6
miden capacidad por separado. [Dependencias de integración AE4](docs/integracion-final-ae4.md)
