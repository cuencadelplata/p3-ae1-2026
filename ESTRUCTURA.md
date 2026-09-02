# Estructura del proyecto

El repositorio contiene un backend único para el Módulo 1 y una interfaz web independiente.

## Backend

`modulo-1-identidad-acceso/` concentra todos los requerimientos RF-1.1 a RF-1.5:

- Registro con datos personales, email, contraseña y rol.
- Inicio de sesión y tokens JWT.
- Validación de identidad, roles y bloqueo de usuarios.
- Recuperación de contraseña mediante tokens temporales.
- Contrato OAuth2/OpenID Connect como stub preparado para una integración posterior.
- Persistencia SQLite en `data/identity.db`.
- Especificación OpenAPI en `openapi.yaml`.
- Pruebas unitarias, de integración y E2E.

## Interfaz web

`modulo-1-identidad-acceso-ui/` contiene la aplicación React para probar el registro, el inicio de sesión, el dashboard y la recuperación de contraseña.

## Documentación

- `README.md`: guía general del proyecto.
- `modulo-1-identidad-acceso/README.md`: documentación del backend.
- `modulo-1-identidad-acceso/openapi.yaml`: contrato de la API.
- `modulo-1-identidad-acceso/IMPLEMENTATION_RF14_RF15.md`: detalle técnico de RF-1.4 y RF-1.5.
- `modulo-1-identidad-acceso-ui/README.md`: documentación de la interfaz web.

## Ejecución

Backend:

```bash
cd modulo-1-identidad-acceso
npm install --ignore-scripts
npm start
```

Frontend, en otra terminal:

```bash
cd modulo-1-identidad-acceso-ui
npm install
npm run dev
```
