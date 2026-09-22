# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: vehiculos.spec.ts >> PATCH /drivers/:driverId/vehicles/:vehicleId/activar >> devuelve 404 al activar un vehículo inexistente
- Location: tests\e2e\vehiculos.spec.ts:162:3

# Error details

```
Error: apiRequestContext.patch: connect ECONNREFUSED ::1:8083
Call log:
  - → PATCH http://localhost:8083/api/v1/drivers/driver-test-1790036477462-442/vehicles/00000000-0000-0000-0000-000000000000/activar
    - user-agent: Playwright/1.62.1 (x64; windows 10.0) node/24.14
    - accept: */*
    - accept-encoding: gzip,deflate,br

```