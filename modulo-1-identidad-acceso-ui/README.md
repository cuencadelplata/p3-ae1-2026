# Interfaz de M1 - Identidad y Acceso

Interfaz web de React y Vite. La cuenta y la autenticación usan la API de M1. El flujo de viaje conecta los demás módulos del stack común.

## Cómo correrla

Con M1 levantado en `http://localhost:3001` (`npm run dev` en `modulo-1-identidad-acceso`, o Docker):

```
cd modulo-1-identidad-acceso-ui
npm install
npm run dev
```

Abrir `http://localhost:5173`.

Si M1 corre en otra URL, crear un archivo `.env` en esta carpeta con `VITE_API_URL=http://otra-url:3001`.

## Viaje en el frontend común

Levantá el Compose de la raíz y abrí http://localhost:5173. Usá una sesión de
cliente y otra de conductor. El conductor necesita un perfil habilitado y un
auto activo en M3. Para recibir ofertas, permite la ubicación del navegador.

1. El cliente elige origen y destino y solicita un viaje. El conductor recibe
   la oferta y la acepta.
2. En el encuentro, el cliente selecciona «Mostrar QR de inicio». El conductor
   ingresa el código y elige «Validar e iniciar viaje». M6 verifica el rol
   y la identidad del participante con M1, valida el código con M8 y registra
   el inicio. El cronómetro en ambas sesiones usa esa hora de M6. Mientras el
   viaje está en curso, el mapa muestra la última posición compartida por el
   navegador del conductor. En el destino, el conductor confirma la llegada
   y M6 habilita el pago del pasajero.
3. Para habilitar tarjeta, agregá `MP_PUBLIC_KEY` al archivo que pasás al Compose
   común con `--env-file`. Usá la clave pública del mismo entorno de Mercado Pago
   configurado en M7 y reconstruí `m1-ui`.
   El navegador envía los datos a Mercado Pago para tokenizar el pago.
4. Cuando M8 emita el comprobante, el cliente puede descargar el PDF al
   finalizar o desde «Historial de viajes». Desde el historial también puede
   consultar y crear tickets de soporte de cada viaje.

«Mis reservas» permite crear, listar, editar y cancelar reservas. La activación
automática depende del token delegado de M1 para M9 en el Compose común.

Para desarrollar con Vite, podés usar npm run dev -- --port 5174 con
VITE_API_URL=http://localhost:10000 y, si usás tarjeta, VITE_MP_PUBLIC_KEY.

## Avisos del navegador

**Tu cuenta → Avisos del viaje** muestra automáticamente los últimos avisos
guardados por M8. La lista funciona con la sesión actual y se actualiza cada
diez segundos mientras la pantalla está visible.

En **Avisos fuera de la aplicación**, el pasajero o conductor puede elegir
**Activar avisos** y aceptar el permiso del sitio para recibir Web Push.
Para el pasajero, la activación también selecciona PUSH como canal en M2.
**Desactivar en este navegador** revoca la suscripción de ese dispositivo.

El service worker recibe avisos cuando la pestaña de la aplicación está cerrada,
si el navegador y el sistema tienen habilitada la entrega en segundo plano.

En AWS, publicá el frontend con HTTPS y conservá sus rutas nginx hacia M1 y
M8 en la red privada. Configurá en M8 un par VAPID persistente y guardá la
clave privada como secreto de despliegue. M8 necesita salida HTTPS hacia los
proveedores Web Push de los navegadores. El permiso y la suscripción se
activan una vez por navegador y origen, así que el dominio nuevo requiere
su propia activación.

### Probar con dos cuentas desde un clon limpio

1. Seguí el [arranque del stack completo](../README.md#levantar-el-stack-completo)
   para configurar los archivos de entorno, crear la red y comprobar los servicios.
2. Abrí `http://localhost:5173` en dos perfiles de navegador. Registrá un
   **cliente** y un **conductor** con datos distintos. El conductor necesita un
   perfil habilitado en M3. En **Abrir despacho**, registrá y activá un auto,
   permití la ubicación y elegí **Conectarme** cerca del origen.
3. Con el cliente, pedí un viaje o programá una reserva. Aceptá la oferta
   con el conductor. Volvé a **Tu cuenta** en ambas sesiones y comprobá sus
   avisos de asignación. Para probar también Web Push, activá la opción en
   ambos perfiles antes de pedir el viaje y configurá las claves VAPID en M8.

Si el conductor acaba de registrarse y todavía carece de perfil en M3, el
equipo que administra el entorno debe crearlo y habilitarlo. En un Compose
local de prueba se puede preparar desde PowerShell con su cuenta de conductor.

```powershell
$credencial = Get-Credential -Message 'Cuenta de conductor de prueba'
$login = Invoke-RestMethod 'http://localhost:10000/auth/iniciar-sesion' -Method Post -ContentType 'application/json' -Body (@{
  email = $credencial.UserName
  password = $credencial.GetNetworkCredential().Password
} | ConvertTo-Json)
$headers = @{ Authorization = "Bearer $($login.token)" }
$conductor = Invoke-RestMethod 'http://localhost:10000/auth/validar-identidad-y-rol' -Headers $headers
Invoke-RestMethod 'http://localhost:5000/api/conductores' -Method Post -Headers $headers -ContentType 'application/json' -Body '{"ciudad":"Corrientes","tipovehiculo":"auto"}'
Invoke-RestMethod "http://localhost:5000/api/conductores/$($conductor.userId)/habilitado" -Method Put -ContentType 'application/json' -Body '{"habilitado":"activo"}'
```

El alta de M3 se hace una vez. Si el perfil ya existe, usá su estado actual y
continuá con el vehículo activo en el paso 2.

## Qué pide a M1 cada pantalla

| Pantalla | Pedido a M1 | RF |
| --- | --- | --- |
| Crear una cuenta | `POST /auth/registrar-usuario` y después `POST /auth/iniciar-sesion` | RF-1.1 |
| Iniciar sesión | `POST /auth/iniciar-sesion`; si responde 429, muestra la cuenta regresiva del bloqueo | RF-1.2 |
| Panel: Mis datos | `GET /auth/me` | RF-1.2 |
| Panel: Cómo te ven los otros módulos | `GET /auth/validar-identidad-y-rol` (lo mismo que consultan M2, M4, M8...) | RF-1.3 |
| Panel: Revocar mis credenciales | `POST /auth/revocar-credenciales`; después el token viejo deja de servir | RF-1.4 |
| ¿Olvidaste tu contraseña? | `POST /auth/solicitar-recuperacion` y `POST /auth/resetear-contrasena` | RF-1.4 |

Si M1 rechaza el token (vencido o revocado), el panel cierra la sesión solo y lo avisa en el login.

## Demo sugerida (con el tablero de Grafana abierto)

1. Crear una cuenta: el panel muestra los datos reales de la base de M1.
2. "Validar de nuevo": sube la métrica de validaciones (RF-1.3).
3. "Revocar mis credenciales": vuelve al login con el aviso (RF-1.4).
4. Equivocarse 6 veces con la contraseña: el botón se bloquea con la cuenta regresiva y en Grafana sube `bloqueado` (RF-1.2).

## Cancelar desde el flujo del viaje (M6)

El pasajero puede elegir **Cancelar viaje** mientras el viaje esté `SOLICITADO` o `CONDUCTOR_EN_CAMINO`. El conductor puede hacerlo mientras esté `CONDUCTOR_EN_CAMINO`. El formulario solicita un motivo de hasta 240 caracteres, permite revisarlo o editarlo y pide confirmación antes de enviar la cancelación.

Las acciones usan la sesión actual y el viaje de la pantalla: `POST /api/viajes/{id}/cancelacion-cliente` o `POST /api/viajes/{id}/cancelacion-conductor`, mediante `/flujo-api/m6-cancelacion`. La interfaz muestra el viaje cancelado después de recibir de M6 el mismo identificador con estado `CANCELADO`. Si la API falla, conserva el motivo para reintentar. La cancelación del conductor conserva el flujo de reapertura del despacho en M5 gestionado por M6.

En desarrollo, `FLOW_M6_CANCELACION_URL` configura el destino del proxy (por defecto `http://127.0.0.1:15001`). En Docker se utiliza `m6-cancelacion:3001`.

Después de cancelar, **Hacer otro viaje** cierra la solicitud anterior en M5 antes de abrir el planificador. Esto libera el candado del pasajero sin esperar el vencimiento original. Si M5 falla, se conserva la pantalla de cancelación y se puede reintentar.

Cuando cancela el conductor, el cliente consulta la solicitud reabierta de M5, retoma la búsqueda y muestra el viaje de reemplazo al aceptar otro conductor. El campo `canceladoPor` del detalle de M6 distingue este caso de una cancelación definitiva del pasajero. Los viajes anteriores cancelados se conservan en el historial y no se seleccionan como asignaciones vigentes.
