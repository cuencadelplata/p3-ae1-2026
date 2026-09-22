# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: health.spec.ts >> El servicio M3 está funcionando
- Location: tests\e2e\health.spec.ts:3:1

# Error details

```
Error: apiRequestContext.get: connect ECONNREFUSED ::1:8083
Call log:
  - → GET http://localhost:8083/health
    - user-agent: Playwright/1.62.1 (x64; windows 10.0) node/24.14
    - accept: */*
    - accept-encoding: gzip,deflate,br

```