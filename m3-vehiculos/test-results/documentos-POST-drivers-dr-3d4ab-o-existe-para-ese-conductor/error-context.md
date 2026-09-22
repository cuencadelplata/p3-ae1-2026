# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: documentos.spec.ts >> POST /drivers/:driverId/documents — RF-3.4 registrar documentación >> rechaza con 404 si el vehicleId no existe para ese conductor
- Location: tests\e2e\documentos.spec.ts:194:3

# Error details

```
Error: apiRequestContext.post: connect ECONNREFUSED ::1:8083
Call log:
  - → POST http://localhost:8083/api/v1/drivers/driver-test-1790036475395-904/documents
    - user-agent: Playwright/1.62.1 (x64; windows 10.0) node/24.14
    - accept: */*
    - accept-encoding: gzip,deflate,br
    - content-type: application/json
    - content-length: 192

```