# Pruebas Unit

Una prueba Unit prueba una pieza aislada. No levanta Express, Docker ni un navegador: verifica directamente la responsabilidad concreta de un módulo.

## RF-8.2 — QR

- `qr-generator.test.ts`: genera el token y la representación o imagen QR.
- `qr.config.test.ts`: verifica configuración, TTL y valores relacionados.
- `qr.controller.test.ts`: verifica la entrada y el control HTTP de QR sin iniciar un servidor.
- `qr.service.test.ts`: verifica las reglas principales del caso de uso QR.
- `qr.store.test.ts`: verifica almacenamiento temporal, consumo y concurrencia.
- `qr.validator.test.ts`: verifica los datos de entrada de generación y validación.

## RF-8.1 — Notificaciones

- `notification.service.test.ts`: verifica mensajes y procesamiento posterior al proveedor PUSH.
- `notification.validator.test.ts`: verifica el cuerpo permitido para una notificación.

RF-8.1 no necesita necesariamente Generator, Store, Config u otras responsabilidades de RF-8.2: su alcance AE1 no las requiere. Las estructuras no tienen que ser simétricas para estar correctamente probadas.
