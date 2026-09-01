# Entrega AE1 — M8 Grupo 6 — RF-8.2

## 1. Identificación de la entrega

- **Materia:** Paradigmas III.
- **Entrega:** AE1.
- **Módulo:** M8 — Notificaciones, Documentos y Soporte.
- **Grupo:** 6.
- **Requerimiento:** RF-8.2 — QR de verificación.
- **Responsable:** Goya Bautista.
- **Branch de trabajo:** `feature/m8-r82-qr-grupo6`.

RF-8.1 se desarrolla en `feature/m8-r81-notifications-grupo6`. Ambos requerimientos se integrarán posteriormente en el mismo servicio M8 y en el mismo contrato OpenAPI.

## 2. Alcance verificable

La entrega de RF-8.2 demuestra generación de un QR real con token opaco, asociación interna con `tripId`, temporalidad, validación, vencimiento y uso único. También rechaza la reutilización y asegura que, ante concurrencia, como máximo una validación del mismo QR resulta exitosa — verificado con 2 y con 10 validaciones simultáneas (sección 8).

El QR no expone información sensible y M8 no modifica el estado del viaje. El comportamiento funcional completo se encuentra en [rf82-qr.md](rf82-qr.md).

## 3. Requisitos del entorno

- Node.js 24 LTS, alineado con el runtime definido en el Dockerfile del servicio M8.
- pnpm 10.33.0, único gestor de paquetes del proyecto.
- Docker Desktop o Docker Engine para ejecutar el contenedor y las pruebas E2E.
- Git.

No utilizar npm, yarn ni otro gestor de paquetes.

## 4. Instalación

Desde la raíz del proyecto:

```powershell
pnpm install --frozen-lockfile
```

## 5. Configuración

RF-8.2 utiliza la variable externa `QR_TTL_SECONDS` para definir el tiempo de vida del QR. El valor de desarrollo previsto es `300` segundos, que es además el default que aplica el código cuando la variable no está definida.

`pnpm test:e2e` usa deliberadamente un valor distinto del default, `QR_TTL_SECONDS=120`, precisamente para verificar que el TTL efectivo sale del entorno real y no del default de código: si el servicio ignorara la variable y usara siempre `300`, ese test lo detectaría.

Ejemplo temporal en PowerShell:

```powershell
$env:QR_TTL_SECONDS=300
```

No crear archivos `.env` para esta guía ni configurar secretos, M6, Redis, RabbitMQ o una base de datos. La implementación valida esta configuración según lo definido en [decisiones-tecnicas.md](decisiones-tecnicas.md): un valor inválido de `QR_TTL_SECONDS` hace fallar el arranque del servicio, no una request HTTP.

## 6. Verificación técnica

| Verificación | Comando | Resultado |
| --- | --- | --- |
| TypeScript de la aplicación | `pnpm typecheck` | OK, sin errores |
| TypeScript de tests | `pnpm typecheck:test` | OK, sin errores |
| Compilación | `pnpm build` | OK, sin errores |

## 7. Pruebas

| Suite | Comando | Resultado |
| --- | --- | --- |
| Unit + Integration | `pnpm test` | OK — 7 archivos, 81 tests, todos pasando |
| Unit | `pnpm test:unit` | OK — 6 archivos, 67 tests |
| Integration | `pnpm test:integration` | OK — 1 archivo, 14 tests |
| Coverage | `pnpm test:coverage` | 98.51% statements, 94.64% branches, 100% funciones, 98.51% líneas, sobre todos los archivos. Único gap: `src/shared/error-handler.ts` (líneas 7 y 45) — código compartido preexistente de la base neutral, no de RF-8.2 |
| E2E Docker | `pnpm test:e2e` | OK — 1 test. Corrido por Bautista Goya en una máquina con Docker Desktop; no ejecutable en el entorno de desarrollo asistido usado durante la implementación, por no tener el daemon de Docker disponible. Flujo: build de la imagen, `docker run` con `PORT` y `QR_TTL_SECONDS=120` por `-e`, sondeo de readiness sin efectos secundarios, generación → validación → revalidación contra el contenedor real, confirmando que el TTL efectivo refleja el valor pasado por entorno |

Los 81 tests unit + integration corresponden en su totalidad a RF-8.2 (esta branch no incluye código de RF-8.1). El test E2E es 1 adicional, no incluido en `pnpm test`.

## 8. Casos funcionales verificados

- [x] Generar un QR para un `tripId` válido. — `tests/unit/qr/qr.service.test.ts`, `tests/integration/qr.integration.test.ts` (201), `tests/e2e/qr.e2e.test.ts`.
- [x] Comprobar que se devuelve un token opaco. — `tests/unit/qr/qr-generator.test.ts` (largo y alfabeto base64url).
- [x] Comprobar que se genera una representación QR PNG/Data URL. — `tests/unit/qr/qr-generator.test.ts`, integración (201), E2E.
- [x] Verificar que el QR codifica únicamente el token. — `tests/unit/qr/qr-generator.test.ts`: decodifica el PNG real (`pngjs` + `jsqr`) y compara el contenido con `toBe(token)` (igualdad estricta, no parcial); un test adicional confirma que el contenido decodificado no incluye un `tripId` conocido.
- [x] Comprobar el valor de `expiresAt`. — `tests/unit/qr/qr.service.test.ts` (exacto: `createdAt + ttlSeconds`), integración (formato ISO 8601), E2E (TTL efectivo dentro de tolerancia contra `QR_TTL_SECONDS=120` real).
- [x] Validar correctamente un QR vigente. — `tests/unit/qr/qr.store.test.ts`, `tests/unit/qr/qr.service.test.ts`, integración (200), E2E.
- [x] Comprobar que la validación exitosa consume el QR. — `tests/unit/qr/qr.store.test.ts`, integración (flujo completo generar → validar → revalidar).
- [x] Rechazar la reutilización del QR. — `tests/unit/qr/qr.store.test.ts`, integración (409), E2E (revalidación).
- [x] Rechazar un QR expirado. — `tests/unit/qr/qr.store.test.ts` únicamente, incluido el borde `now === expiresAt`. Deliberadamente no se probó por HTTP ni E2E: requeriría manipular tiempo real o fake timers, algo explícitamente evitado (decisión del bloque de concurrencia).
- [x] Rechazar un token inexistente. — `tests/unit/qr/qr.store.test.ts`, `tests/unit/qr/qr.service.test.ts`, integración (404 `QR_NOT_FOUND`).
- [x] Rechazar un token asociado a otro `tripId`. — `tests/unit/qr/qr.store.test.ts`, `tests/unit/qr/qr.service.test.ts` (misma respuesta que token inexistente), integración (404 idéntico byte a byte al de token inexistente).
- [x] Comprobar que dos validaciones concurrentes no resultan exitosas ambas. — `tests/integration/qr.integration.test.ts`, con 2 y con 10 validaciones simultáneas vía `Promise.all`. Poder de detección verificado deliberadamente: se rompió la atomicidad de `consumeIfValid` de forma temporal y el mismo test pasó de verde a fallar (10/10 exitosas en vez de 1/10); el cambio se revirtió por completo antes de continuar.
- [ ] Comprobar que M8 no cambia el estado del viaje. — **no verificado por un test.** RF-8.2 no implementa ningún concepto de estado de viaje, y M6 no está integrado en AE1, así que no hay nada contra qué aseverar en runtime. Es verdadero por ausencia de esa lógica en el código (revisable en `src/qr/`), no por una prueba ejecutable.

## 9. Verificación de la API

El contrato aprobado está en [docs/api/openapi.yaml](../api/openapi.yaml). Contiene `POST /notifications` de RF-8.1 y los endpoints de RF-8.2: `POST /qr` y `POST /qr/validate`.

### `POST /qr`

Solicitud:

```json
{
  "tripId": "trip-demo-001"
}
```

Respuesta exitosa:

```json
{
  "token": "...",
  "qrDataUrl": "data:image/png;base64,...",
  "expiresAt": "..."
}
```

### `POST /qr/validate`

Solicitud:

```json
{
  "tripId": "trip-demo-001",
  "token": "..."
}
```

Respuesta exitosa:

```json
{
  "valid": true
}
```

Los schemas, restricciones, ejemplos y códigos HTTP completos se verifican contra `docs/api/openapi.yaml`; esta guía no los duplica.

## 10. Errores demostrados

| Caso | HTTP | Código | Nivel de prueba |
| --- | --- | --- | --- |
| Entrada inválida | 400 | `VALIDATION_ERROR` | Unit (validador, controller) + integración |
| Tipo de contenido incorrecto | 415 | `UNSUPPORTED_MEDIA_TYPE` | Unit (controller) + integración |
| QR inexistente o viaje no correspondiente | 404 | `QR_NOT_FOUND` | Unit (store, service) + integración |
| QR ya utilizado | 409 | `QR_ALREADY_USED` | Unit (store, service) + integración + E2E |
| QR expirado | 410 | `QR_EXPIRED` | Unit (store) únicamente, ver sección 8 |
| Error interno de QR | 500 | `QR_PROCESSING_ERROR` | Unit (service, controller) únicamente; no se forzó un fallo real de `qrcode` en integración ni E2E |

## 11. Docker

RF-8.2 se ejecuta dentro del mismo Docker existente del servicio M8; no se creó una segunda imagen. El `Dockerfile` no necesitó ningún cambio: `COPY src ./src` en la etapa de build ya incluye `src/qr/` sin que el Dockerfile necesite saber que existe.

Comandos de referencia para verificación manual:

```powershell
docker build -t m8-notifications-service:local .
docker run --rm -e PORT=3000 -e QR_TTL_SECONDS=300 -p 3010:3000 m8-notifications-service:local
```

El tag `m8-notifications-service:local` es el mismo que usa `tests/e2e/qr.e2e.test.ts` (constante `IMAGE_TAG`); no es un ejemplo arbitrario, coincide con la imagen real que construye y corre el test automatizado. El puerto de host (`3010` acá vs. `39481` en el test) sí difiere a propósito: este comando es para verificación manual, el test usa un puerto fijo propio para no depender de que `3010` esté libre.

Además, existe `pnpm test:e2e` (`tests/e2e/qr.e2e.test.ts`, config separada en `vitest.e2e.config.ts` para no solaparse con `pnpm test`), que automatiza la evidencia: construye la imagen, levanta un contenedor con `PORT` y `QR_TTL_SECONDS=120` pasados por `-e` en el puerto de host fijo `39481`, espera a que el servicio esté listo sondeando `POST /qr` con un body inválido (sin crear QRs de basura), y contra el contenedor real genera un QR, lo valida, lo revalida y verifica el 409, además de comprobar que el TTL efectivo de `expiresAt` refleja el `QR_TTL_SECONDS` del entorno y no el default de código. Limpia el contenedor en `afterAll` (`docker stop` + `docker rm`) incluso si el test falla.

**Resultado: OK.** Corrido por Bautista Goya en una máquina con Docker Desktop — 1 test, pasó. No se ejecutó en el entorno de desarrollo asistido usado durante la implementación por no tener el daemon de Docker disponible ahí.

## 12. Persistencia transitoria

Durante AE1 se utiliza almacenamiento en memoria para los registros QR (`qr.store.ts`, un `Map` indexado por `tokenHash`), tal como definió la decisión técnica aprobada. Su estado se pierde al reiniciar el proceso, no representa persistencia definitiva y no se incorporó ninguna base de datos para RF-8.2.

## 13. Requerimientos no funcionales y evidencias

| Aspecto | Evidencia |
| --- | --- |
| Arquitectura modular | RF-8.2 integrado dentro de M8, con responsabilidades separadas (`qr.types`, `qr.config`, `qr.validator`, `qr-generator`, `qr.store`, `qr.service`, `qr.controller`). |
| Contrato REST | `docs/api/openapi.yaml`, sin divergencias detectadas contra la implementación. |
| Contenerización | Sección 11 — imagen construida y contenedor ejecutado, verificado con `pnpm test:e2e`. |
| Propiedad de datos | M8 conserva únicamente los datos propios del QR (`QrRecord`: id, tripId, tokenHash, createdAt, expiresAt, usedAt). |
| Configuración externa | Uso de `QR_TTL_SECONDS`, validado al armar el servicio; falla rápido si es inválido. |
| Testing | Sección 7 — Unit, Integration y E2E, con resultados reales. |
| Consistencia | Sección 8 — prueba de uso único y de concurrencia (2 y 10 validaciones simultáneas), con poder de detección verificado. |
| Protección de información | El QR contiene únicamente un token opaco; ningún mensaje de error incluye el token ni el `tripId` recibidos. |
| Documentación y versionado | Este documento y [decisiones-tecnicas.md](decisiones-tecnicas.md), branch `feature/m8-r82-qr-grupo6`. |

## 14. Evidencias a guardar para la entrega

- [x] Salida de `pnpm typecheck`. — sección 6.
- [x] Salida de `pnpm build`. — sección 6.
- [x] Resultado de pruebas Unit. — sección 7.
- [x] Resultado de pruebas Integration. — sección 7.
- [x] Resultado E2E. — sección 7 y 11.
- [x] Evidencia de ejecución Docker. — sección 11.
- [x] OpenAPI mostrando los endpoints de RF-8.2. — `docs/api/openapi.yaml`, existe desde antes de la implementación (contract-first).
- [x] Generación real de QR. — sección 8.
- [x] Validación exitosa. — sección 8.
- [x] Rechazo por reutilización. — sección 8.
- [x] Rechazo por expiración. — sección 8, con la salvedad de que solo se probó a nivel unit (store).
- [x] Prueba de concurrencia. — sección 8.
- [ ] Historial Git y commit correspondiente cuando se realice la entrega. — pendiente: corresponde al commit final de entrega, todavía no realizado.

La fuente de verdad del contrato HTTP es `docs/api/openapi.yaml`.

## 15. Estado actual

RF-8.2 está implementado y verificado en la branch `feature/m8-r82-qr-grupo6`: tipos, configuración y validadores; store en memoria, token criptográfico y representación QR; service; controller y endpoints; integración HTTP con Supertest; evidencia de concurrencia y uso único; E2E contra Docker. Las tablas de resultados y la lista de evidencias de este documento reflejan una ejecución real, no proyectada.

Quedan pendientes, explícitamente fuera de alcance de AE1:

- la integración real con M6 — el `tripId` sigue siendo un dato externo simulado;
- la integración con RF-8.1 en un único servicio M8 y un único `app.ts`;
- el desajuste entre el `errorHandler` compartido (devuelve `INTERNAL_SERVER_ERROR`, fuera del enum `ErrorCode`) y el contrato, registrado en [decisiones-tecnicas.md](decisiones-tecnicas.md);
- la migración de la garantía de atomicidad del uso único cuando el store deje de ser una única instancia en memoria, también registrada en [decisiones-tecnicas.md](decisiones-tecnicas.md);
- la verificación de que M8 no altera el estado del viaje, sostenida por diseño — ausencia de esa lógica en el código — y no por un test ejecutable (sección 8).

Esta guía se limita a reproducir, verificar y registrar evidencias. Para las decisiones técnicas, el comportamiento funcional y el contrato completo, consultar respectivamente [decisiones-tecnicas.md](decisiones-tecnicas.md), [rf82-qr.md](rf82-qr.md) y [docs/api/openapi.yaml](../api/openapi.yaml).
