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

1. Abrí **Crear una cuenta**, elegí **Cliente**, registrate con un correo y DNI de prueba, e ingresá con esa cuenta. Si ya tenés una cuenta de cliente de prueba, usá **Iniciar sesión**.
2. En **Tu cuenta**, elegí **Abrir flujo de viaje**. Ingresá como conductor con otra cuenta o elegí **Crear cuenta de conductor** y usá otro correo y DNI. La sesión del pasajero sigue abierta.
3. Presioná **Preparar conductor de prueba**. La pantalla da de alta al conductor si hace falta, habilita un perfil pendiente para la demo, activa un auto y publica su ubicación en el origen. El recorrido predefinido va de avenida 3 de Abril al aeropuerto de Corrientes.
4. Como pasajero, presioná **Solicitar viaje**. Si falta su perfil, se crea en ese paso. Luego elegí **Buscar conductor y enviar oferta**.
5. Presioná **Aceptar oferta como conductor** antes de que venza la cuenta regresiva. Si venció, usá **Volver a enviar oferta**. Si también venció la solicitud, usá **Renovar solicitud**. Si todavía falta la asignación, presioná **Consultar viaje asignado**.
6. Elegí **Marcar arribo y generar QR**. Cuando aparezca el QR del pasajero, usá **Validar QR e iniciar viaje**. Si venció, elegí **Renovar QR**.
7. Seleccioná **Tarjeta de prueba** si activaste el simulador, o **Efectivo** para dejar registrado un cobro presencial. Presioná **Finalizar y registrar pago**. La pantalla muestra el total, el estado y el identificador devueltos por los servicios.
8. Elegí **Ver comprobante**. Si sigue en emisión, volvé a consultarlo tras unos segundos. Cuando termine la cuenta regresiva de M5, **Hacer otro viaje** inicia otro recorrido con el mismo conductor.

La pestaña conserva el avance si recargás y volvés a **Abrir flujo de viaje**. El flujo es una demo local de viaje inmediato con ruta fija. Para desarrollar con Vite y el stack común ya levantado, ejecutá `npm run dev -- --port 5174` desde esta carpeta con `VITE_API_URL=http://localhost:10000` en su `.env.local`. Agregá ahí `VITE_FLOW_SANDBOX_PAYMENT=true` para seleccionar la tarjeta del simulador. El proxy local usa los puertos publicados por defecto en el stack.

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
