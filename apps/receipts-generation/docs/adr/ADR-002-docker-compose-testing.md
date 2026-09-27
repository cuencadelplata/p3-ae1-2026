# ADR-002: Contenerización Unificada con Docker Compose y Orquestación de Pruebas (AE1)

* **Estado:** Aceptado  
* **Fecha:** 2026-09-14  
* **Autores:** Juan Gualtieri, Lucas Cremaschi, Meza Santiago (Grupo 14)  
* **Requerimientos Asociados:** RNF-01 (Portabilidad), RNF-04 (Persistencia y aislamiento), RNF-09 (Concurrencia), RNF-17 (Testing)  

---

## 1. Contexto y Problemática

En la entrega AE1 del microservicio de comprobantes (`m8-documentos`), el sistema debe ser evaluado y ejecutado tanto por los integrantes del equipo como por la cátedra docente.  
Originalmente, la ejecución requería:
1. La instalación local de herramientas de desarrollo (Node.js 22 LTS, npm 10).
2. Comandos manuales extensos de la CLI de Docker (`docker build`, `docker run` con múltiples parámetros de puertos, volúmenes y variables de entorno).
3. Dependencia de herramientas de host para la ejecución de pruebas unitarias (`npm test`), lo cual fallaba en equipos sin Node.js instalado o con versiones incompatibles.

Se requería una solución de infraestructura como código que garantice paridad de entornos y permita compilar, operar y evaluar toda la suite de pruebas sin instalar dependencias locales en el sistema operativo anfitrión.

---

## 2. Decisiones Adoptadas

### 2.1. Adopción de Docker Compose como Orquestador Único
Se descarta el uso imperativo de la CLI básica de Docker para la operación diaria y se adopta **Docker Compose** (`docker-compose.yml`) de forma declarativa:
* **Mapeo de red y puertos:** Publicación estandarizada en `3008:3008`.
* **Persistencia declarativa:** Montaje del volumen nombrado `m8-storage` hacia `/app/storage`.
* **Variables de entorno:** Configuración centralizada de `NODE_ENV`, `PORT` y `PUBLIC_BASE_URL`.

### 2.2. Estrategia de Imagen Única Unificada (`m8-documentos:1.0.0`)
Se unificó el `Dockerfile` en una única imagen basada en `node:22-slim` (Debian con glibc, compatible con los binarios nativos del compilador de TypeScript 7):
* La imagen contiene el código compilado de producción (`dist/`), el servidor Express, la especificación OpenAPI, y además las carpetas de pruebas (`tests/`) y scripts de validación (`scripts/`).
* **Ventaja:** Evita la proliferación de múltiples imágenes en el disco del evaluador (por ejemplo, imágenes separadas de test vs. producción). La misma imagen sirve para levantar el servicio productivo y para ejecutar la suite de pruebas bajo demanda.

### 2.3. Orquestación Automatizada de Pruebas (`docker compose run test`)
Se configuró un servicio `test` dentro de `docker-compose.yml` que:
1. Reutiliza la imagen base `m8-documentos:1.0.0`.
2. Depende del servicio principal (`depends_on: [m8-documentos]`).
3. Ejecuta el comando unificado `npm run test:all`, el cual encadena:
   - Chequeo estático de tipos (`typecheck` vía `tsc --noEmit`).
   - Suite de 22 tests automatizados (`test` vía runner nativo de `node:test` y `tsx`).
   - Prueba de estrés y concurrencia (`prueba:concurrencia` con 8 solicitudes simultáneas contra el endpoint HTTP `/api/v1/receipts`).
4. Incorpora un bucle de reintento activo (`waitForHealth`) en el script de concurrencia para sincronizar el arranque del microservicio antes de emitir solicitudes paralelas.

---

## 3. Consecuencias y Beneficios

* **Cero dependencias en el host:** Ni los alumnos ni los docentes necesitan tener Node.js ni npm instalados en su máquina anfitriona. Toda la compilación, ejecución y verificación corre 100% en contenedores.
* **Determinismo y reproducibilidad:** Se elimina por completo el problema del *"en mi máquina funciona"*. Las versiones de TypeScript, motor de ejecución y librerías son estrictamente idénticas en cualquier computadora.
* **Operación en comandos mínimos:**
  - Puesta en marcha: `docker compose up -d`
  - Ejecución integral de pruebas: `docker compose run test`
  - Apagado y limpieza: `docker compose down`
