# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: vehiculos.spec.ts >> GET /drivers/:driverId/vehicles — listar y obtener >> devuelve 404 si el vehículo no existe para ese conductor
- Location: tests\e2e\vehiculos.spec.ts:133:3

# Error details

```
Error: apiRequestContext.get: connect ECONNREFUSED ::1:8083
Call log:
  - → GET http://localhost:8083/api/v1/drivers/driver-test-1790036473974-755/vehicles/00000000-0000-0000-0000-000000000000
    - user-agent: Playwright/1.62.1 (x64; windows 10.0) node/24.14
    - accept: */*
    - accept-encoding: gzip,deflate,br

```