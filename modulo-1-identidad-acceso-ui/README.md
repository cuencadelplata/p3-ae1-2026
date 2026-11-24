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
