# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: vehiculos.spec.ts >> POST /drivers/:driverId/vehicles — RF-3.2 registrar vehículo >> rechaza con 409 si la patente ya está registrada
- Location: tests\e2e\vehiculos.spec.ts:76:3

# Error details

```
Error: apiRequestContext.post: connect ECONNREFUSED ::1:8083
Call log:
  - → POST http://localhost:8083/api/v1/drivers/driver-test-1790036469941-990/vehicles
    - user-agent: Playwright/1.62.1 (x64; windows 10.0) node/24.14
    - accept: */*
    - accept-encoding: gzip,deflate,br
    - content-type: application/json
    - content-length: 54

```