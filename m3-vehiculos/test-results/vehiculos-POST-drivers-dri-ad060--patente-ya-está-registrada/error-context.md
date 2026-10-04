# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: vehiculos.spec.ts >> POST /drivers/:driverId/vehicles — RF-3.2 registrar vehículo >> rechaza con 409 si la patente ya está registrada
- Location: tests\e2e\vehiculos.spec.ts:76:3

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: 201
Received: 500
```

# Test source

```ts
  1   | import { test, expect } from "@playwright/test";
  2   | 
  3   | // Cada test usa su propio driverId único, para no chocar entre corridas
  4   | // ni depender del orden en que se ejecutan.
  5   | function driverIdUnico() {
  6   |   return `driver-test-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  7   | }
  8   | 
  9   | // Genera una patente válida y distinta en cada llamada (formato AAA000),
  10  | // para no toparse con el unique de la base entre tests.
  11  | function patenteUnica() {
  12  |   const n = Date.now() % 1000;
  13  |   return `ZZZ${n.toString().padStart(3, "0")}`;
  14  | }
  15  | 
  16  | test.describe("POST /drivers/:driverId/vehicles — RF-3.2 registrar vehículo", () => {
  17  |   test("registra un vehículo válido y devuelve 201 con el objeto creado", async ({
  18  |     request,
  19  |   }) => {
  20  |     const driverId = driverIdUnico();
  21  |     const patente = patenteUnica();
  22  | 
  23  |     const response = await request.post(
  24  |       `/api/v1/drivers/${driverId}/vehicles`,
  25  |       {
  26  |         data: { patente, tipoServicio: "AUTO", anio: 2020 },
  27  |       },
  28  |     );
  29  | 
  30  |     expect(response.status()).toBe(201);
  31  |     const body = await response.json();
  32  |     expect(body.id).toBeTruthy();
  33  |     expect(body.driverId).toBe(driverId);
  34  |     expect(body.patente).toBe(patente);
  35  |     expect(body.tipoServicio).toBe("AUTO");
  36  |     expect(body.activo).toBe(false);
  37  |   });
  38  | 
  39  |   test("rechaza con 400 si falta la patente", async ({ request }) => {
  40  |     const response = await request.post(
  41  |       `/api/v1/drivers/${driverIdUnico()}/vehicles`,
  42  |       { data: { tipoServicio: "AUTO", anio: 2020 } },
  43  |     );
  44  | 
  45  |     expect(response.status()).toBe(400);
  46  |   });
  47  | 
  48  |   test("rechaza con 400 si la patente tiene formato inválido", async ({
  49  |     request,
  50  |   }) => {
  51  |     const response = await request.post(
  52  |       `/api/v1/drivers/${driverIdUnico()}/vehicles`,
  53  |       { data: { patente: "NOVALIDA", tipoServicio: "AUTO", anio: 2020 } },
  54  |     );
  55  | 
  56  |     expect(response.status()).toBe(400);
  57  |   });
  58  | 
  59  |   test("rechaza con 400 si tipoServicio no es AUTO ni MOTO", async ({
  60  |     request,
  61  |   }) => {
  62  |     const response = await request.post(
  63  |       `/api/v1/drivers/${driverIdUnico()}/vehicles`,
  64  |       {
  65  |         data: {
  66  |           patente: patenteUnica(),
  67  |           tipoServicio: "CAMIONETA",
  68  |           anio: 2020,
  69  |         },
  70  |       },
  71  |     );
  72  | 
  73  |     expect(response.status()).toBe(400);
  74  |   });
  75  | 
  76  |   test("rechaza con 409 si la patente ya está registrada", async ({
  77  |     request,
  78  |   }) => {
  79  |     const patente = patenteUnica();
  80  | 
  81  |     // Primera vez: se crea sin problema
  82  |     const primera = await request.post(
  83  |       `/api/v1/drivers/${driverIdUnico()}/vehicles`,
  84  |       { data: { patente, tipoServicio: "AUTO", anio: 2020 } },
  85  |     );
> 86  |     expect(primera.status()).toBe(201);
      |                              ^ Error: expect(received).toBe(expected) // Object.is equality
  87  | 
  88  |     // Segunda vez, misma patente, otro conductor: debe rechazarse
  89  |     const segunda = await request.post(
  90  |       `/api/v1/drivers/${driverIdUnico()}/vehicles`,
  91  |       { data: { patente, tipoServicio: "MOTO", anio: 2021 } },
  92  |     );
  93  |     expect(segunda.status()).toBe(409);
  94  |   });
  95  | });
  96  | 
  97  | test.describe("GET /drivers/:driverId/vehicles — listar y obtener", () => {
  98  |   test("lista los vehículos del conductor recién creado", async ({
  99  |     request,
  100 |   }) => {
  101 |     const driverId = driverIdUnico();
  102 |     await request.post(`/api/v1/drivers/${driverId}/vehicles`, {
  103 |       data: { patente: patenteUnica(), tipoServicio: "AUTO", anio: 2020 },
  104 |     });
  105 | 
  106 |     const response = await request.get(
  107 |       `/api/v1/drivers/${driverId}/vehicles`,
  108 |     );
  109 | 
  110 |     expect(response.status()).toBe(200);
  111 |     const body = await response.json();
  112 |     expect(Array.isArray(body)).toBe(true);
  113 |     expect(body.length).toBeGreaterThanOrEqual(1);
  114 |   });
  115 | 
  116 |   test("obtiene un vehículo puntual por id", async ({ request }) => {
  117 |     const driverId = driverIdUnico();
  118 |     const creado = await request.post(
  119 |       `/api/v1/drivers/${driverId}/vehicles`,
  120 |       { data: { patente: patenteUnica(), tipoServicio: "AUTO", anio: 2020 } },
  121 |     );
  122 |     const { id } = await creado.json();
  123 | 
  124 |     const response = await request.get(
  125 |       `/api/v1/drivers/${driverId}/vehicles/${id}`,
  126 |     );
  127 | 
  128 |     expect(response.status()).toBe(200);
  129 |     const body = await response.json();
  130 |     expect(body.id).toBe(id);
  131 |   });
  132 | 
  133 |   test("devuelve 404 si el vehículo no existe para ese conductor", async ({
  134 |     request,
  135 |   }) => {
  136 |     const response = await request.get(
  137 |       `/api/v1/drivers/${driverIdUnico()}/vehicles/00000000-0000-0000-0000-000000000000`,
  138 |     );
  139 | 
  140 |     expect(response.status()).toBe(404);
  141 |   });
  142 | });
  143 | 
  144 | test.describe("PATCH /drivers/:driverId/vehicles/:vehicleId/activar", () => {
  145 |   test("activa un vehículo existente", async ({ request }) => {
  146 |     const driverId = driverIdUnico();
  147 |     const creado = await request.post(
  148 |       `/api/v1/drivers/${driverId}/vehicles`,
  149 |       { data: { patente: patenteUnica(), tipoServicio: "AUTO", anio: 2020 } },
  150 |     );
  151 |     const { id } = await creado.json();
  152 | 
  153 |     const response = await request.patch(
  154 |       `/api/v1/drivers/${driverId}/vehicles/${id}/activar`,
  155 |     );
  156 | 
  157 |     expect(response.status()).toBe(200);
  158 |     const body = await response.json();
  159 |     expect(body.activo).toBe(true);
  160 |   });
  161 | 
  162 |   test("devuelve 404 al activar un vehículo inexistente", async ({
  163 |     request,
  164 |   }) => {
  165 |     const response = await request.patch(
  166 |       `/api/v1/drivers/${driverIdUnico()}/vehicles/00000000-0000-0000-0000-000000000000/activar`,
  167 |     );
  168 | 
  169 |     expect(response.status()).toBe(404);
  170 |   });
  171 | });
```