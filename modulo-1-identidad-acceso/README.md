# Módulo 1: Identidad y Acceso

Esta carpeta contiene la implementación consolidada del Módulo 1 y todos sus requerimientos, desde RF-1.1 hasta RF-1.5.

## Funcionalidades

### Registro y autenticación

- Registro de usuarios con nombre, apellido, DNI, teléfono, email, contraseña y rol.
- Roles disponibles: `CLIENTE`, `CONDUCTOR` y `OPERADOR`.
- Inicio de sesión mediante email y contraseña.
- Generación de tokens JWT con una duración de una hora.
- Validación protegida de identidad y rol.
- Bloqueo de usuarios.

### Recuperación de acceso (RF-1.4)

- Solicitud de recuperación mediante email.
- Generación de tokens únicos con una duración de 30 minutos.
- Restablecimiento de contraseña con token válido.
- Invalidación del token después de utilizarlo.
- Contraseñas protegidas mediante bcrypt.

Actualmente el proyecto no envía correos reales. El token se registra en la salida del servidor para facilitar las pruebas locales.

### Integración OAuth2/OpenID Connect (RF-1.5)

El requerimiento está implementado como un stub funcional. Se incluyen las rutas, validaciones, contratos y persistencia necesarios para una futura integración con proveedores externos. Las rutas OAuth2 responden `501 Not Implemented` porque todavía no realizan el flujo real de autenticación.

## API

Las rutas principales son:

```text
GET  /health
POST /auth/registrar-usuario
POST /auth/iniciar-sesion
GET  /auth/validar-identidad-y-rol
POST /auth/solicitar-recuperacion
POST /auth/resetear-contrasena
GET  /auth/oauth2/authorize
GET  /auth/oauth2/callback
POST /auth/oauth2/link
```

La especificación completa está en `openapi.yaml`.

## Requisitos

- Node.js 22 o superior.
- npm.

En Windows, si `better-sqlite3` no puede compilarse por falta de herramientas de C++, instalar las dependencias con:

```bash
npm install --ignore-scripts
```

## Configuración

Crear un archivo `.env` en esta carpeta:

```env
PORT=3001
JWT_SECRET=clave-local-desarrollo
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=tu-cuenta@gmail.com
SMTP_PASSWORD=contraseña-de-aplicación
SMTP_FROM=tu-cuenta@gmail.com
```

La variable `JWT_SECRET` es necesaria para generar y validar tokens JWT.
Las variables `SMTP_*` son necesarias para enviar correos reales. Con Gmail se debe utilizar una contraseña de aplicación, no la contraseña habitual de la cuenta.

## Ejecución

Instalar dependencias y levantar el servidor:

```bash
npm install --ignore-scripts
npm start
```

El servicio queda disponible en `http://localhost:3001`.

## Pruebas

La suite E2E se ejecuta con:

```bash
npm test
```

Resultado validado actualmente:

```text
Test Files  1 passed
Tests       47 passed
Tests       0 failed
```

Las pruebas cubren registro, autenticación, validación de tokens, bloqueo de usuarios, recuperación de contraseña, OAuth2 y casos de validación.

## Persistencia

La aplicación utiliza SQLite local. La base de datos se almacena en:

```text
data/identity.db
```

Las tablas principales son:

- `usuarios`
- `password_recovery_tokens`
- `oauth2_providers`

Las columnas personales agregadas al registro se incorporan mediante una migración automática al iniciar el servidor.

## Documentación adicional

- `openapi.yaml`: contrato de la API.
- `IMPLEMENTATION_RF14_RF15.md`: detalle técnico de RF-1.4 y RF-1.5.
- `SUMMARY_RF14_RF15.md`: resumen de la implementación.
- `../ESTRUCTURA.md`: descripción de la estructura del proyecto.

## Estado de implementación

| Requerimiento | Estado |
|---|---|
| RF-1.1: Registro | Completo |
| RF-1.2: Autenticación | Completo |
| RF-1.3: Identidad y rol | Completo |
| RF-1.4: Recuperación de acceso | Completo, sin envío real de emails |
| RF-1.5: OAuth2/OpenID Connect | Stub funcional, pendiente de integración real |
