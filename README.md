# p3-ae1-2026

Proyecto académico de la materia Paradigmas y Lenguajes de Programación III. El repositorio contiene el Módulo 1 de Identidad y Acceso para una plataforma de movilidad urbana, junto con una interfaz web para probar sus funcionalidades.

## Estructura

### `modulo-1-identidad-acceso`

Versión original del backend. Incluye los requerimientos RF-1.1 a RF-1.3:

- Registro de usuarios.
- Inicio de sesión.
- Validación de identidad y rol mediante JWT.
- Bloqueo de usuarios.

### `modulo-1-identidad-acceso-rf14-rf15`

Versión extendida y recomendada para la entrega. Incluye los requerimientos RF-1.1 a RF-1.5:

- Registro con nombre, apellido, DNI, teléfono, email, contraseña y rol.
- Autenticación mediante email y contraseña.
- Tokens JWT con una duración de una hora.
- Recuperación de contraseña mediante tokens temporales.
- Invalidación de tokens de recuperación después de su uso.
- Contraseñas protegidas con bcrypt.
- Contrato OpenAPI de la API.
- Estructura preparada para OAuth2/OpenID Connect.

RF-1.5 está implementado como un stub funcional: sus rutas y validaciones existen, pero la conexión real con Google, GitHub o Microsoft queda pendiente.

### `modulo-1-identidad-acceso-ui`

Interfaz web desarrollada con React, TypeScript, Vite y Tailwind CSS. Permite:

- Registrarse con todos los datos requeridos.
- Iniciar sesión.
- Consultar los datos de la cuenta y el rol.
- Cerrar sesión.
- Solicitar la recuperación de contraseña.
- Restablecer la contraseña con un token.

## Requisitos

- Node.js 22 o superior.
- npm.

Docker es opcional. En Windows, si `better-sqlite3` no puede compilarse por falta de herramientas de C++, usar `npm install --ignore-scripts`.

## Ejecución

Se necesitan dos terminales.

### Backend

Usar la versión extendida para disponer de RF-1.4 y RF-1.5:

```bash
cd modulo-1-identidad-acceso-rf14-rf15
npm install --ignore-scripts
npm start
```

El backend queda disponible en `http://localhost:3001`.

### Frontend

En otra terminal:

```bash
cd modulo-1-identidad-acceso-ui
npm install
npm run dev
```

La interfaz queda disponible en la dirección que indique Vite, normalmente `http://localhost:5173`.

## Configuración

El backend extendido utiliza un archivo `.env` con la siguiente configuración mínima:

```env
PORT=3001
JWT_SECRET=clave-local-desarrollo
```

La base de datos utilizada es SQLite y se guarda en:

```text
modulo-1-identidad-acceso-rf14-rf15/data/identity.db
```

## API y documentación

La especificación OpenAPI completa está en:

```text
modulo-1-identidad-acceso-rf14-rf15/openapi.yaml
```

Principales rutas:

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

## Pruebas

Las pruebas E2E de la versión extendida se ejecutan con:

```bash
cd modulo-1-identidad-acceso-rf14-rf15
npm test
```

Resultado validado:

```text
Test Files  1 passed
Tests       36 passed
Tests       0 failed
```

Las pruebas cubren registro, autenticación, roles, validación de tokens, bloqueo de usuarios, recuperación de contraseña, OAuth2 y casos inválidos.

## Documentación adicional

- `ESTRUCTURA.md`: descripción de las carpetas del repositorio.
- `modulo-1-identidad-acceso-rf14-rf15/README.md`: documentación específica del backend extendido.
- `modulo-1-identidad-acceso-rf14-rf15/IMPLEMENTATION_RF14_RF15.md`: detalle técnico de RF-1.4 y RF-1.5.
- `modulo-1-identidad-acceso-rf14-rf15/openapi.yaml`: contrato de la API.
- `modulo-1-identidad-acceso-ui/README.md`: documentación de la interfaz web.
