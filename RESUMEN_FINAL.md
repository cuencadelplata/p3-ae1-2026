# Resumen del proyecto

El proyecto está organizado en un único backend y una interfaz web.

## Backend consolidado

La carpeta `modulo-1-identidad-acceso/` contiene todos los requerimientos del Módulo 1:

- RF-1.1: registro de usuarios.
- RF-1.2: autenticación mediante email y contraseña.
- RF-1.3: validación de identidad, rol y bloqueo de usuarios.
- RF-1.4: recuperación de contraseña con tokens temporales de un solo uso.
- RF-1.5: contrato OAuth2/OpenID Connect como stub funcional.

El registro admite nombre, apellido, DNI, teléfono, email, contraseña y rol. La información se almacena en SQLite y las contraseñas se protegen con bcrypt.

## Interfaz web

La carpeta `modulo-1-identidad-acceso-ui/` contiene la interfaz React para el registro, el login, el dashboard y la recuperación de contraseña.

## Verificación

Desde `modulo-1-identidad-acceso/`:

```bash
npm test
npm run build
```

Resultado validado:

```text
Test Files  3 passed
Tests       47 passed
Tests       0 failed
```

La documentación de la API está en `modulo-1-identidad-acceso/openapi.yaml`.
