# Evidencia de pruebas — RF-5.1 (Solicitud de viaje)

| Campo | Valor |
| :--- | :--- |
| Alumno | Agustín Quetglas |
| Módulo / RF | M5 — RF-5.1 |
| Rama | `ae2/agustin-quetglas` |
| Commit de referencia | `a0d957e` ("feat(rf-5.1): implementar casos de prueba CP-5.1-01 a CP-5.1-14, persistencia en Redis y documentacion AE2") |
| Fecha de ejecución | 2026-11-15 |
| Entorno | Node.js, Jest 30; Redis y RabbitMQ con respaldo en memoria / contenedor; autenticación JWT real en tests de seguridad |

## Comandos ejecutados

```powershell
cd modulo-5
npx tsc --noEmit -p tsconfig.json           # Compilación TypeScript OK (0 errores)
npx jest --selectProjects unit              # 7 suites, 128 tests pasando
npx jest --selectProjects integration       # 2 suites, 28 tests pasando
npx jest tests/unit/rf-5.1-casos-prueba.unit.test.ts --verbose  # Suite oficial CP-5.1: 11 tests pasando
```

## Resumen de Casos de Prueba de la Consigna (Matriz de Cobertura)

| Código | Descripción del Caso | Resultado | Evidencia / Test que lo cubre |
| :--- | :--- | :--- | :--- |
| **CP-5.1-01** | Pedir viaje Auto con datos válidos y sesión iniciada | ✅ PASS | `CP-5.1-01: Iniciar sesión como cliente y pedir un viaje Auto con origen y destino válidos` |
| **CP-5.1-02** | Pedir viaje Moto con datos válidos | ✅ PASS | `CP-5.1-02: Con un cliente sin solicitud activa, pedir un viaje Moto con origen y destino válidos` |
| **CP-5.1-03** | Omitir destino obligatorio | ✅ PASS | `CP-5.1-03: Con sesión válida, enviar origen y tipo Auto, pero omitir el destino` |
| **CP-5.1-04** | Latitud fuera de rango (100) | ✅ PASS | `CP-5.1-04: Enviar un origen con latitud 100 y un destino válido` |
| **CP-5.1-06** | Vehículo no permitido (ej. Camión) | ✅ PASS | `CP-5.1-06: Enviar origen y destino válidos y tipo de vehículo Camión` |
| **CP-5.1-07** | Solicitar sin autenticación ni credencial | ✅ PASS | `CP-5.1-07: Enviar una solicitud válida sin iniciar sesión ni enviar una credencial` (HTTP 401 `UNAUTHENTICATED`) |
| **CP-5.1-09** | Reintentos: Variante S (secuencial) y Variante P (paralelo) | ✅ PASS | `CP-5.1-09 Variante S: enviarlo dos veces seguidas con la misma clave de reintento conserva el mismo ID`<br>`CP-5.1-09 Variante P: lanzar dos copias a la vez en paralelo deja una sola solicitud y devuelve el mismo ID` |
| **CP-5.1-10** | Aislamiento de clave entre clientes distintos | ✅ PASS | `CP-5.1-10: A crea una solicitud con una clave. B envía su propio pedido usando esa misma clave` |
| **CP-5.1-14** | Conservar la solicitud al reiniciar M5 y consultarla | ✅ PASS | `CP-5.1-14: Crear una solicitud, anotar su ID, reiniciar M5 y consultarla nuevamente` |
