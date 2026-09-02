# M1 - Identidad y Acceso - Frontend UI

Interfaz gráfica moderna y elegante para el módulo de Identidad y Acceso de la Plataforma de Movilidad Urbana.

## 🎨 Características

- ✨ Diseño moderno con gradientes y glassmorphism
- 🔐 Autenticación segura con JWT
- 👤 Formulario de registro con selección de roles (Cliente, Conductor, Operador)
- 📱 Interfaz totalmente responsive
- 🎯 Dashboard de usuario con información de sesión
- ⚡ Desarrollado con React, TypeScript y Tailwind CSS

## 🚀 Requisitos previos

- Node.js 18 o superior
- npm o yarn
- Backend M1 ejecutándose en `localhost:3001`

## 📦 Instalación

```bash
# Instalar dependencias
npm install
```

## 🏃 Ejecución

```bash
# Modo desarrollo (con hot reload)
npm run dev

# Compilar para producción
npm run build

# Vista previa de producción
npm run preview
```

## 🌐 Acceso a la Aplicación

Una vez ejecutado `npm run dev`, abre tu navegador en:

```
http://localhost:5173/
```

## 📁 Estructura del Proyecto

```
src/
├── components/
│   ├── Login.tsx       # Formulario de login
│   ├── Register.tsx    # Formulario de registro
│   └── Dashboard.tsx   # Panel de control de usuario
├── App.tsx             # Componente raíz con gestión de estado
├── App.css             # Estilos específicos de la app
├── index.css           # Estilos globales con Tailwind
└── main.tsx            # Punto de entrada
```

## 🔌 API Integration

El frontend se conecta al backend en:
- **Base URL**: `http://localhost:3001`
- **Endpoints utilizados**:
  - `POST /auth/registrar-usuario` - Registro de nuevos usuarios
  - `POST /auth/iniciar-sesion` - Login de usuarios

## 🎯 Flujo de Autenticación

### 1. Registro
- Usuario selecciona su rol (Cliente, Conductor, Operador)
- Ingresa nombre, email y contraseña (mín. 6 caracteres)
- Backend valida y retorna JWT token
- Token se guarda en localStorage

### 2. Login
- Usuario ingresa email y contraseña
- Backend valida credenciales
- Retorna JWT token con información del usuario
- Token se decodifica para obtener datos de sesión

### 3. Dashboard
- Muestra información del usuario autenticado
- Rol y datos de sesión
- Opción para cerrar sesión (limpia token)

## 🎨 Diseño Visual

### Paleta de Colores
- **Gradiente Principal**: Purple → Indigo
- **Primario**: Azul (#3B82F6) - Botones y acciones
- **Secundario**: Gris oscuro (#1E293B) - Texto
- **Acento**: Cyan (#06B6D4) - Highlights

## 🛠️ Tecnologías

- **React 18**: Framework UI
- **TypeScript**: Tipado estático
- **Vite**: Build tool rápido
- **Tailwind CSS**: Utility-first CSS
- **Axios**: Cliente HTTP
- **Lucide React**: Iconos modernos

---

**Proyecto académico - ISI Paradigmas III 2026**

See the [Oxlint rules documentation](https://oxc.rs/docs/guide/usage/linter/rules) for the full list of rules and categories.
