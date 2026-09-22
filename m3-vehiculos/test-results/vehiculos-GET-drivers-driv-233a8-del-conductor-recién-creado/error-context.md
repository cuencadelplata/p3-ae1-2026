# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: vehiculos.spec.ts >> GET /drivers/:driverId/vehicles — listar y obtener >> lista los vehículos del conductor recién creado
- Location: tests\e2e\vehiculos.spec.ts:98:3

# Error details

```
Error: apiRequestContext.post: connect ECONNREFUSED ::1:8083
Call log:
  - → POST http://localhost:8083/api/v1/drivers/driver-test-1790036471252-19/vehicles
    - user-agent: Playwright/1.62.1 (x64; windows 10.0) node/24.14
    - accept: */*
    - accept-encoding: gzip,deflate,br
    - content-type: application/json
    - content-length: 54

```