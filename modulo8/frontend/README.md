# Vistas de M8 para el frontend común

Esta carpeta contiene **sólo las vistas que M8 puede aportar** a la aplicación del curso. La lógica de las vistas está en `m8.js`: recibe el elemento donde dibujar, una función `api`, una función `notify` y el estado de sesión. El frontend común decide las rutas, el menú y cómo obtiene el JWT de M1.

`preview/` contiene el servidor, la navegación lateral y el formulario manual de JWT para revisarlas localmente. Es una herramienta de prueba, no una pantalla para incorporar a la aplicación común. La paleta usa `#D5FF40`, `#181818`, `#C0C2B8`, blanco y Poppins.

## Vistas que se integrarán

- **Comprobantes (RF8.3 y RF8.4):** buscar por `tripId`, consultar datos, descargar el PDF y pedir el reenvío del mismo comprobante.
- **Soporte (RF8.5):** crear un ticket, buscar tickets de un viaje y consultar detalle e historial. Antes de usar esta vista con usuarios finales, el backend debe restringir esas consultas a los viajes del usuario autenticado.
- **Dispositivos (RF8.7):** listar y desactivar los tokens PUSH del usuario autenticado. El frontend común debe registrar el token automáticamente cuando el dispositivo conceda permiso; no se le pide al usuario que pegue un token técnico.

**RF8.1** necesita una bandeja sólo si M8 publica un endpoint seguro para consultar las notificaciones del usuario. Hoy no existe. **RF8.2** muestra el QR dentro del viaje de M6; las rutas de generación y validación son internas entre servicios. **RF8.6** funciona en segundo plano por RabbitMQ. Por eso no se crearon pantallas separadas para esos tres RF ni un panel de administración del módulo.

## Revisar las vistas localmente

Levantá el backend M8 según el [README principal](../README.md). Después, desde esta carpeta:

```powershell
pnpm run dev
```

Abrí la URL local que imprime el comando (normalmente `http://127.0.0.1:4173`; si el puerto está ocupado prueba el siguiente). El servidor de vista previa dirige las solicitudes a `http://127.0.0.1:8000`. Podés cambiar el destino con `M8_API_TARGET` y el puerto inicial con `M8_FRONTEND_PORT`.

El botón **Conexión M1** de la vista previa acepta un JWT de prueba sólo en la memoria de la pestaña. No se guarda en archivos, cookies ni `localStorage`. En la aplicación final, la autenticación y la navegación vendrán del frontend común; no se copiará este formulario ni ninguna clave interna de M6/M8 al navegador.

La integración final puede montar `createM8Feature({ page, api, notify, hasSession })` desde `m8.js` y llamar `show('comprobantes' | 'soporte' | 'dispositivos')`. La función `api` debe usar la sesión real y el cliente HTTP del frontend común. Se trasladan los estilos de las vistas que se necesiten; no se copian `preview/index.html`, `preview/preview.js` ni `preview/server.mjs`. Antes de exponer soporte a usuarios reales, el backend debe restringir las consultas al dueño del viaje.
