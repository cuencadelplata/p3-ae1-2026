# Manual de Despliegue y Operación con Docker - Módulo 8

**Materia:** ISI - Paradigmas de Programación 3 (2026)  
**Módulo:** M8 - Notificaciones, Documentos y Soporte (Comprobantes PDF)  
**Grupo 14:** Juan Gualtieri, Lucas Cremaschi, Meza Santiago  

---

## 1. Requerimientos Previos

Para desplegar y operar este microservicio, **únicamente se requiere**:
* **Git** (v2.x o superior): Para el clonado del repositorio y cambio de ramas.
* **Docker Desktop** (v24.x o superior): Con soporte para contenedores Linux y backend WSL2 habilitado en Windows.
* **Docker Compose** (v2.x o superior): Incluido por defecto con Docker Desktop.

> [!IMPORTANT]
> **Docker Desktop debe estar en ejecución:** Antes de lanzar cualquier comando, verifica que el ícono de Docker Desktop en la barra de tareas se encuentre en color verde con el estado *"Engine running"*.

---

## 2. Comandos Operativos Esenciales

Todos los comandos deben ejecutarse posicionados en la carpeta del microservicio:
```bash
cd m8-documentos
```

### 2.1. Puesta en marcha de la aplicación (Modo Servicio)

```bash
docker compose up -d
```

* **Qué hace:** Construye la imagen (si no existe previamente) y levanta el microservicio en segundo plano (*detached mode*).
* **Puerto:** Queda expuesto y accesible en `http://localhost:3008`.
* **Persistencia:** Monta el volumen persistente `m8-storage` en `/app/storage`.

### 2.2. Visualización de registros (Logs)

```bash
docker compose logs -f
```

* **Qué hace:** Muestra la salida estándar y de errores del servidor en tiempo real.
* **Para salir:** Presiona `Ctrl + C` (esto no apaga la aplicación).

### 2.3. Ejecución de la suite completa de pruebas

```bash
docker compose run test
```

* **Qué hace:** Levanta el entorno de pruebas y ejecuta en secuencia:
  1. `npm run typecheck` (Validación de tipos de TypeScript).
  2. `npm test` (22 pruebas unitarias y de integración HTTP).
  3. `npm run prueba:concurrencia` (8 solicitudes paralelas contra el servicio activo).

### 2.4. Ejecución de pruebas individuales

```bash
# Solo pruebas unitarias y de integración:
docker compose run test npm test

# Solo prueba de concurrencia e idempotencia:
docker compose run test npm run prueba:concurrencia

# Solo verificación estática de tipos:
docker compose run test npm run typecheck
```

### 2.5. Apagado y limpieza del entorno

```bash
docker compose down
```

* **Qué hace:** Detiene y remueve los contenedores en ejecución y la red virtual creada por Compose, liberando los puertos y la memoria RAM del sistema.
* **Nota sobre datos:** Los comprobantes emitidos en el volumen `m8-storage` **no se borran**; sobreviven a la detención.

---

## 3. Recompilación tras Modificaciones de Código

Si realizas cambios en el código TypeScript o en la configuración del servicio:
```bash
docker compose build
```
*(O alternativamente: `docker compose up --build -d` o `docker compose run --build test`)*.

---

## 4. Persistencia de Datos y Volúmenes

El microservicio persiste sus datos en `/app/storage/receipts`:
* `metadata/<tripId>.json`: Registro documental con metadatos del viaje y trazabilidad de entregas.
* `pdf/<tripId>.pdf`: Documento binario generado por el motor vectorial PDFKit.

El volumen nombrado `m8-storage` garantiza que los comprobantes generados no se pierdan al reiniciar o destruir los contenedores. Para inspeccionar el volumen desde la CLI de Docker:
```bash
docker volume inspect m8-storage
```

---

## 5. Resolución de Problemas Frecuentes

| Síntoma / Error | Causa Probable | Solución |
| :--- | :--- | :--- |
| `Cannot connect to the Docker daemon` | Docker Desktop está cerrado o iniciándose. | Abrir Docker Desktop y aguardar a que el motor esté en *"Engine running"*. |
| `port is already allocated: 3008` | Otro proceso o un contenedor previo está usando el puerto 3008. | Ejecutar `docker compose down` o detener el proceso que use el puerto. |
| Los cambios de código no se reflejan al levantar. | Docker está usando una versión en caché de la imagen. | Ejecutar `docker compose build` para forzar la recompilación. |
| `npm: command not found` en terminal del host. | Se intentó correr comandos npm fuera del contenedor sin Node.js instalado. | Usar siempre `docker compose run test <comando>` para ejecutar vía Docker. |
