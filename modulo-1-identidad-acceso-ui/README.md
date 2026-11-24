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

## Guía del flujo de login a pago

El recorrido usa el stack común. Abrí [la interfaz de M1](http://localhost:5173) después de levantarlo desde la raíz. Si el stack ya está arriba, `docker compose up -d --no-deps --build m1-ui` actualiza solo la interfaz. El [README del stack integral](../tests-integracion/README.md) explica la configuración de los servicios y la alternativa con el simulador de M7.

Para ver un pago **autorizado de prueba**, configurá el simulador de M7 de esa guía con `UNREGISTERED_TRIPS=not_found`. Asegurate de que `M6_M7_URL` y `M8_M7_PAYMENTS_URL` del stack apunten al simulador. Agregá `VITE_FLOW_SANDBOX_PAYMENT=true` al `.env` raíz y reconstruí `m1-ui`. Si cambiaste las URL de M7 con el stack corriendo, recreá también los servicios `m6-viajes-app` y `m8-app` para que tomen la configuración nueva. Con el M7 real, dejá desactivada la tarjeta de prueba y usá **Efectivo** para registrar el pago pendiente de cobro.

1. Iniciá sesión como **Cliente**. Para registrar un cliente nuevo, elegí **Crear una cuenta** y usá un correo y DNI de prueba.
2. En **Tu cuenta**, elegí **Pedir un viaje**. El mapa muestra el recorrido predefinido de avenida 3 de Abril al aeropuerto de Corrientes.
3. Presioná **Solicitar viaje**. M5 envía ofertas a los autos disponibles cerca del origen y asigna el viaje al primero que acepta. La pantalla se actualiza automáticamente. Si la solicitud vence, podés usar **Volver a solicitar**.
4. Cuando aparezca **Tu conductor está asignado**, elegí **Preparar inicio del viaje** para generar el QR y luego **Iniciar viaje** para validarlo. Si el QR vence, usá **Renovar QR**.
5. Elegí **Tarjeta de prueba** con el simulador o **Efectivo** para registrar un cobro presencial pendiente. Presioná **Finalizar y registrar pago** para ver el total y el estado.
6. Elegí **Ver comprobante**. Si sigue en emisión, volvé a consultarlo tras unos segundos. Pasado el tiempo de espera, **Hacer otro viaje** abre una nueva solicitud.

El pasajero usa su propia cuenta durante todo el recorrido. Para una demo local sin conductores disponibles, conectá un conductor desde **otra sesión de navegador** (perfil distinto o ventana de incógnito). Entrá en M1 como **Conductor**, abrí **Tu cuenta → Abrir despacho de prueba** y elegí **Conectarme para aceptar una oferta**. Dejá ese panel abierto. Publica un auto disponible en el origen y acepta automáticamente una oferta para el recorrido de prueba. Para otra demo, volvé a conectar al conductor cuando termine el viaje anterior.

La pestaña del pasajero conserva el avance si recargás y volvés a **Pedir un viaje**. Para desarrollar con Vite y el stack común ya levantado, ejecutá `npm run dev -- --port 5174` desde esta carpeta con `VITE_API_URL=http://localhost:10000` en su `.env.local`. Agregá ahí `VITE_FLOW_SANDBOX_PAYMENT=true` para seleccionar la tarjeta del simulador. El proxy local usa los puertos publicados por defecto en el stack.

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
