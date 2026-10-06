# Funcionamiento con Internet y sin Internet

## Qué significa el requisito

Cortar Internet (WAN) no debe cortar el funcionamiento de los servicios locales. M2, PostgreSQL, Redis, RabbitMQ y M4/M6/M8 se ejecutan en Docker en la misma computadora. No hay mapas, fuentes, autenticación o bases de datos de nube necesarios durante la ejecución de esta demo. Los mapas usan el catálogo local simulado; no ofrecen búsqueda mundial ni cartografía descargada.

Con Internet se usa exactamente el mismo recorrido local. No se intercambian bases ni se reemplazan viajes reales por ficticios según la conexión. Los datos siguen en los volúmenes locales.

**Requisitos previos:** Docker instalado y las cuatro imágenes disponibles. Instalar por primera vez o reconstruir dependencias sí requiere Internet, o recibir las imágenes exportadas en un archivo. Una computadora vacía no puede descargar software sin conexión. Eso es distinto de continuar operando ante un corte durante la clase.

## Preparar antes de la clase (con Internet)

```bash
node scripts/setup.cjs
node scripts/offline.cjs prepare
```

Descarga PostgreSQL, Redis y RabbitMQ; construye la imagen de la aplicación, que incluye sus librerías, Prisma, código compilado y pruebas. La migración usa el ejecutable local, sin intentar descargarlo con npx.

## Arrancar sin Internet

```bash
node scripts/offline.cjs start
```

Comprueba que las imágenes existan y usa `--no-build --pull never`. El archivo `docker-compose.offline.yml` configura la red de los contenedores como `internal: true`, sin salida externa. Los módulos siguen resolviéndose por nombres internos `m6`, `rabbitmq`, `postgres`, etc. El arranque usa sólo Node estándar y Docker: no ejecutar npm install offline.

Los puertos locales siguen declarados para probar desde la misma computadora. Si el host/motor limita puertos publicados en redes internas, las pruebas integrales pueden ejecutarse dentro de la red con el comando siguiente. La ejecución habitual con Compose base también sigue operando al cortar Internet, porque sus dependencias son locales.

```bash
node scripts/offline.cjs test
```

La prueba verifica bloqueo de salida TCP hacia una IP pública, emisión local de token, búsqueda local de mapas, consulta REST M2→M6 y ambos flujos RabbitMQ. No modifica el Wi-Fi ni la conexión general de la computadora. Verificar `docker network inspect ae2-rf22_default --format '{{.Internal}}'` para comprobar que la red está aislada. No conectar a esa red servicios externos para esta prueba.

Para cambiar una instalación ya arrancada a la red aislada, detener primero `docker compose down` (sin `-v`) y luego ejecutar `start`; conserva datos y evita mezclar redes anteriores. No reconstruir mientras se demuestra el corte.

## Llevar las imágenes a otra computadora

```bash
node scripts/offline.cjs export
```

Produce `offline/ae2-images.tar`. Copiar ese archivo y el código a la computadora destino, que debe tener Docker instalado y arquitectura compatible (por ejemplo, ARM64 con ARM64; para un equipo x86_64 preparar imágenes linux/amd64). Luego:

```bash
node scripts/setup.cjs
node scripts/offline.cjs load
node scripts/offline.cjs start
```

El archivo exportado contiene imágenes, no volúmenes ni los datos de viajes existentes. No es una copia de seguridad de la DB. El ZIP de código no incluye ese archivo grande; se genera con `export` cuando Docker tiene las imágenes. Para conservar la misma computadora basta no eliminar las imágenes ni los volúmenes.

## Integración con M6

RF-2.2 reutiliza el cliente HTTP de RF-2.4 y acepta origen/destino como texto. No exige coordenadas ni completadoAt. La configuración real, el cuerpo y las sugerencias B → A se describen en [INTEGRACION-M6.md](INTEGRACION-M6.md). La consulta de sugerencias guardadas no llama a M6. El contrato recibido no documenta el GET que el código heredado utiliza; falta comprobarlo contra el servidor de los compañeros.

## Si también se pierde la conexión a M6

| Situación | Comportamiento |
|---|---|
| Se corta Internet; M6 y broker son locales | Funciona todo el recorrido local |
| M6 está en una nube inaccesible | Favoritos y recientes ya guardados funcionan; no se pueden conocer viajes nuevos |
| M6 se detiene | Importar desde viaje devuelve 503; M2 conserva sus operaciones propias |
| M2 worker se detiene | Broker conserva eventos confirmados hasta la reconexión |
| RabbitMQ se detiene | M2 guarda favoritos y su outbox; al recuperarse publica pendientes |
| Se corta la LAN entre computadoras | No hay comunicación inmediata entre ellas; se requiere reconexión |

Para garantizar todos los recorridos durante el corte, **el M6 real también debe ejecutarse localmente o en una LAN que siga funcionando**, al igual que su autenticación y persistencia. No es posible consultar un módulo remoto inaccesible. El productor M6 real necesita su propio outbox para guardar finalizaciones cuando el broker esté caído; el simulador informa 503 y requiere reintentar con el mismo viajeId/eventId.

Fuentes de las opciones de Docker: [red interna](https://docs.docker.com/reference/compose-file/networks/), [arranque sin build/pull](https://docs.docker.com/reference/cli/docker/compose/up/), [exportación de imágenes](https://docs.docker.com/reference/cli/docker/image/save/).
