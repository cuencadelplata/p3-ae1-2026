# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: idempotencia.spec.ts >> Idempotencia en POST /vehicles (Redis) >> dos POST sin Idempotency-Key crean vehículos distintos
- Location: tests\e2e\idempotencia.spec.ts:63:3

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: 201
Received: 500
```

# Test source

```ts
  1  | import { test, expect } from "@playwright/test";
  2  | 
  3  | // Mismos helpers que ya usás en vehiculos.spec.ts
  4  | function driverIdUnico() {
  5  |   return `driver-test-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  6  | }
  7  | 
  8  | function patenteUnica() {
  9  |   const n = Date.now() % 1000;
  10 |   return `ZZZ${n.toString().padStart(3, "0")}`;
  11 | }
  12 | 
  13 | // Genera una key de idempotencia distinta en cada llamada al helper,
  14 | // pero la reusamos DENTRO de un mismo test para simular un reintento.
  15 | function idempotencyKeyUnica() {
  16 |   return `idem-test-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
  17 | }
  18 | 
  19 | test.describe("Idempotencia en POST /vehicles (Redis)", () => {
  20 |   test("dos POST con la misma Idempotency-Key devuelven el mismo vehículo, sin duplicar", async ({
  21 |     request,
  22 |   }) => {
  23 |     const driverId = driverIdUnico();
  24 |     const patente = patenteUnica();
  25 |     const idempotencyKey = idempotencyKeyUnica();
  26 |     const body = { patente, tipoServicio: "AUTO", anio: 2020 };
  27 | 
  28 |     // Primer pedido: se crea normalmente
  29 |     const primera = await request.post(
  30 |       `/api/v1/drivers/${driverId}/vehicles`,
  31 |       {
  32 |         data: body,
  33 |         headers: { "Idempotency-Key": idempotencyKey },
  34 |       },
  35 |     );
  36 |     expect(primera.status()).toBe(201);
  37 |     const primerBody = await primera.json();
  38 | 
  39 |     // Segundo pedido: mismo body, misma key → reintento
  40 |     const segunda = await request.post(
  41 |       `/api/v1/drivers/${driverId}/vehicles`,
  42 |       {
  43 |         data: body,
  44 |         headers: { "Idempotency-Key": idempotencyKey },
  45 |       },
  46 |     );
  47 |     expect(segunda.status()).toBe(201);
  48 |     const segundoBody = await segunda.json();
  49 | 
  50 |     // Tiene que ser EXACTAMENTE el mismo vehículo (mismo id y mismo createdAt),
  51 |     // no uno nuevo con datos iguales.
  52 |     expect(segundoBody.id).toBe(primerBody.id);
  53 |     expect(segundoBody.createdAt).toBe(primerBody.createdAt);
  54 | 
  55 |     // Confirmamos que en la base quedó un solo vehículo para ese conductor
  56 |     const listado = await request.get(
  57 |       `/api/v1/drivers/${driverId}/vehicles`,
  58 |     );
  59 |     const vehiculos = await listado.json();
  60 |     expect(vehiculos.length).toBe(1);
  61 |   });
  62 | 
  63 |   test("dos POST sin Idempotency-Key crean vehículos distintos", async ({
  64 |     request,
  65 |   }) => {
  66 |     const driverId = driverIdUnico();
  67 | 
  68 |     const primera = await request.post(
  69 |       `/api/v1/drivers/${driverId}/vehicles`,
  70 |       { data: { patente: patenteUnica(), tipoServicio: "AUTO", anio: 2020 } },
  71 |     );
> 72 |     expect(primera.status()).toBe(201);
     |                              ^ Error: expect(received).toBe(expected) // Object.is equality
  73 |     const primerBody = await primera.json();
  74 | 
  75 |     const segunda = await request.post(
  76 |       `/api/v1/drivers/${driverId}/vehicles`,
  77 |       { data: { patente: patenteUnica(), tipoServicio: "MOTO", anio: 2021 } },
  78 |     );
  79 |     expect(segunda.status()).toBe(201);
  80 |     const segundoBody = await segunda.json();
  81 | 
  82 |     // Sin key, cada POST es independiente: ids distintos
  83 |     expect(segundoBody.id).not.toBe(primerBody.id);
  84 | 
  85 |     const listado = await request.get(
  86 |       `/api/v1/drivers/${driverId}/vehicles`,
  87 |     );
  88 |     const vehiculos = await listado.json();
  89 |     expect(vehiculos.length).toBe(2);
  90 |   });
  91 | });
```