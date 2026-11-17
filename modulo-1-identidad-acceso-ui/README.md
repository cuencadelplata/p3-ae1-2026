# Interfaz de M1 - Identidad y Acceso

Interfaz web (React + Vite) que usa la API real de M1: todos los datos que muestra salen de M1, no hay datos de ejemplo.

## Cómo correrla

Con M1 levantado en `http://localhost:3001` (`npm run dev` en `modulo-1-identidad-acceso`, o Docker):

```
cd modulo-1-identidad-acceso-ui
npm install
npm run dev
```

Abrir `http://localhost:5173`.

Si M1 corre en otra URL, crear un archivo `.env` en esta carpeta con `VITE_API_URL=http://otra-url:3001`.

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
