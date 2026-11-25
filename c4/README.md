# Modelo C4 de Movilidad Urbana

## Despliegue AWS de demostracion

El stack AWS ejecuta los mismos modulos en una EC2 de sa-east-1 con Docker Compose.
Caddy termina HTTPS y es el unico contenedor que publica 80/443; cada modulo
conserva sus contratos internos y sus datos. M9 pide tokens delegados a M1, resuelve
rutas con M4, estima tarifas con M7 y despacha a M5. La asignacion pertenece a M5;
RF-9.7 fue retirado. No hay una dependencia directa M9 -> M8 para despachar.

Los HTML existentes describen componentes; no representan un despliegue de alta
disponibilidad ni certifican integraciones probadas. Estado y limites actuales:
[verificacion AWS](../deployment/aws/VERIFICACION.md).

Diagramas C4 de la plataforma completa (M1–M9), generados con [archify](https://github.com/tt-a1i/archify) v3.3.0. Cada `.html` es autocontenido.

## Ver los diagramas

GitHub muestra el código de los `.html`, no el diagrama. Para verlos en el navegador, usá los enlaces de **Ver online** (sirven el archivo de la rama `main` mediante [raw.githack.com](https://raw.githack.com), un servicio externo):

**[▶ Abrir el C4 online (empieza en el Nivel 1)](https://raw.githack.com/cuencadelplata/p3-ae1-2026/main/c4/c4-nivel1-contexto.html)**

| Nivel | Ver online | Archivo |
| --- | --- | --- |
| 1 · Contexto | [abrir](https://raw.githack.com/cuencadelplata/p3-ae1-2026/main/c4/c4-nivel1-contexto.html) | [c4-nivel1-contexto.html](c4-nivel1-contexto.html) |
| 2 · Contenedores | [abrir](https://raw.githack.com/cuencadelplata/p3-ae1-2026/main/c4/c4-nivel2-contenedores.html) | [c4-nivel2-contenedores.html](c4-nivel2-contenedores.html) |
| 2b · Eventos (RabbitMQ) | [abrir](https://raw.githack.com/cuencadelplata/p3-ae1-2026/main/c4/c4-nivel2-eventos.html) | [c4-nivel2-eventos.html](c4-nivel2-eventos.html) |
| 3 · M1 Identidad y acceso | [abrir](https://raw.githack.com/cuencadelplata/p3-ae1-2026/main/c4/c4-nivel3-componentes-m1.html) | [c4-nivel3-componentes-m1.html](c4-nivel3-componentes-m1.html) |
| 3 · M2 Perfil, historial y estado | [abrir](https://raw.githack.com/cuencadelplata/p3-ae1-2026/main/c4/c4-nivel3-componentes-m2.html) | [c4-nivel3-componentes-m2.html](c4-nivel3-componentes-m2.html) |
| 3 · M3 Conductores y vehículos | [abrir](https://raw.githack.com/cuencadelplata/p3-ae1-2026/main/c4/c4-nivel3-componentes-m3.html) | [c4-nivel3-componentes-m3.html](c4-nivel3-componentes-m3.html) |
| 3 · M4 Ubicación y disponibilidad | [abrir](https://raw.githack.com/cuencadelplata/p3-ae1-2026/main/c4/c4-nivel3-componentes-m4.html) | [c4-nivel3-componentes-m4.html](c4-nivel3-componentes-m4.html) |
| 3 · M5 Solicitud y despacho | [abrir](https://raw.githack.com/cuencadelplata/p3-ae1-2026/main/c4/c4-nivel3-componentes-m5.html) | [c4-nivel3-componentes-m5.html](c4-nivel3-componentes-m5.html) |
| 3 · M6 Viajes | [abrir](https://raw.githack.com/cuencadelplata/p3-ae1-2026/main/c4/c4-nivel3-componentes-m6.html) | [c4-nivel3-componentes-m6.html](c4-nivel3-componentes-m6.html) |
| 3 · M7 Tarifas y pagos | [abrir](https://raw.githack.com/cuencadelplata/p3-ae1-2026/main/c4/c4-nivel3-componentes-m7.html) | [c4-nivel3-componentes-m7.html](c4-nivel3-componentes-m7.html) |
| 3 · M8 QR, comprobantes y notificaciones | [abrir](https://raw.githack.com/cuencadelplata/p3-ae1-2026/main/c4/c4-nivel3-componentes-m8.html) | [c4-nivel3-componentes-m8.html](c4-nivel3-componentes-m8.html) |
| 3 · M9 Reservas programadas | [abrir](https://raw.githack.com/cuencadelplata/p3-ae1-2026/main/c4/c4-nivel3-componentes-m9.html) | [c4-nivel3-componentes-m9.html](c4-nivel3-componentes-m9.html) |

Desde el Nivel 1 se navega hacia abajo: clic en la plataforma abre el Nivel 2, y clic en un módulo abre su Nivel 3.

También se pueden abrir localmente: con el repo clonado, doble clic en cualquier `.html`.

## De dónde sale

- Niveles 1 y 2: el `docker-compose.yml` común resuelto (`docker compose config`).
- Nivel 3: el código de cada módulo. Cada componente cita archivo y línea; archify verifica que la cita exista en el commit indicado en `meta.repository.revision`.

## Actualizar

Los diagramas no se actualizan solos: cuando cambia un módulo, se edita su `.json` y se regenera el `.html`.

```sh
git clone --depth 1 --branch v3.3.0 https://github.com/tt-a1i/archify.git ~/archify

# validar
node ~/archify/archify/bin/archify.mjs validate architecture c4/c4-nivel2-contenedores.json --quality showcase --repo-root .

# regenerar el HTML
node ~/archify/archify/bin/archify.mjs finalize architecture c4/c4-nivel2-contenedores.json c4/c4-nivel2-contenedores.html --quality showcase --repo-root . --browser-check
```

Ejecutar desde la raíz del repositorio. Al cambiar el código citado, actualizar también `meta.repository.revision` y las líneas de `sources`.
