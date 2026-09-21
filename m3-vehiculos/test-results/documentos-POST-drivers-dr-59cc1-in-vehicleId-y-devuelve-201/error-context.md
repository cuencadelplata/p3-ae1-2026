# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: documentos.spec.ts >> POST /drivers/:driverId/documents — RF-3.4 registrar documentación >> registra una LICENCIA_CONDUCIR válida (sin vehicleId) y devuelve 201
- Location: tests\e2e\documentos.spec.ts:39:3

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
  3   | function driverIdUnico() {
  4   |   return `driver-test-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  5   | }
  6   | 
  7   | function patenteUnica() {
  8   |   const n = Date.now() % 1000;
  9   |   return `ZZ${n.toString().padStart(3, "0")}ZZ`;
  10  | }
  11  | 
  12  | // La fecha de vencimiento tiene que ser futura, así que la generamos
  13  | // siempre a un año desde hoy.
  14  | function fechaFutura() {
  15  |   const d = new Date();
  16  |   d.setFullYear(d.getFullYear() + 1);
  17  |   return d.toISOString().split("T")[0];
  18  | }
  19  | 
  20  | function fechaPasada() {
  21  |   const d = new Date();
  22  |   d.setFullYear(d.getFullYear() - 1);
  23  |   return d.toISOString().split("T")[0];
  24  | }
  25  | 
  26  | // Crea un vehículo de prueba para el conductor y devuelve su id,
  27  | // necesario para probar documentos que requieren vehicleId
  28  | // (SEGURO_VEHICULO, CEDULA_VEHICULO).
  29  | async function crearVehiculoDePrueba(request: any, driverId: string) {
  30  |   const response = await request.post(
  31  |     `/api/v1/drivers/${driverId}/vehicles`,
  32  |     { data: { patente: patenteUnica(), tipoServicio: "AUTO", anio: 2020 } },
  33  |   );
  34  |   const body = await response.json();
  35  |   return body.id as string;
  36  | }
  37  | 
  38  | test.describe("POST /drivers/:driverId/documents — RF-3.4 registrar documentación", () => {
  39  |   test("registra una LICENCIA_CONDUCIR válida (sin vehicleId) y devuelve 201", async ({
  40  |     request,
  41  |   }) => {
  42  |     const driverId = driverIdUnico();
  43  | 
  44  |     const response = await request.post(
  45  |       `/api/v1/drivers/${driverId}/documents`,
  46  |       {
  47  |         data: {
  48  |           tipoDocumento: "LICENCIA_CONDUCIR",
  49  |           numeroDocumento: "LIC-001",
  50  |           fechaVencimiento: fechaFutura(),
  51  |           archivoUrl: "https://ejemplo.com/licencia.pdf",
  52  |         },
  53  |       },
  54  |     );
  55  | 
> 56  |     expect(response.status()).toBe(201);
      |                               ^ Error: expect(received).toBe(expected) // Object.is equality
  57  |     const body = await response.json();
  58  |     expect(body.id).toBeTruthy();
  59  |     expect(body.tipoDocumento).toBe("LICENCIA_CONDUCIR");
  60  |     expect(body.vehicleId).toBeNull();
  61  |     expect(body.estado).toBe("PENDIENTE");
  62  |   });
  63  | 
  64  |   test("registra un SEGURO_VEHICULO válido (con vehicleId) y devuelve 201", async ({
  65  |     request,
  66  |   }) => {
  67  |     const driverId = driverIdUnico();
  68  |     const vehicleId = await crearVehiculoDePrueba(request, driverId);
  69  | 
  70  |     const response = await request.post(
  71  |       `/api/v1/drivers/${driverId}/documents`,
  72  |       {
  73  |         data: {
  74  |           tipoDocumento: "SEGURO_VEHICULO",
  75  |           numeroDocumento: "POL-001",
  76  |           fechaVencimiento: fechaFutura(),
  77  |           archivoUrl: "https://ejemplo.com/seguro.pdf",
  78  |           vehicleId,
  79  |         },
  80  |       },
  81  |     );
  82  | 
  83  |     expect(response.status()).toBe(201);
  84  |     const body = await response.json();
  85  |     expect(body.vehicleId).toBe(vehicleId);
  86  |   });
  87  | 
  88  |   test("rechaza con 400 si el tipoDocumento no es válido", async ({
  89  |     request,
  90  |   }) => {
  91  |     const response = await request.post(
  92  |       `/api/v1/drivers/${driverIdUnico()}/documents`,
  93  |       {
  94  |         data: {
  95  |           tipoDocumento: "CARNET_DE_CLUB",
  96  |           numeroDocumento: "X-1",
  97  |           fechaVencimiento: fechaFutura(),
  98  |           archivoUrl: "https://ejemplo.com/x.pdf",
  99  |         },
  100 |       },
  101 |     );
  102 | 
  103 |     expect(response.status()).toBe(400);
  104 |   });
  105 | 
  106 |   test("rechaza con 400 si falta numeroDocumento", async ({ request }) => {
  107 |     const response = await request.post(
  108 |       `/api/v1/drivers/${driverIdUnico()}/documents`,
  109 |       {
  110 |         data: {
  111 |           tipoDocumento: "LICENCIA_CONDUCIR",
  112 |           fechaVencimiento: fechaFutura(),
  113 |           archivoUrl: "https://ejemplo.com/x.pdf",
  114 |         },
  115 |       },
  116 |     );
  117 | 
  118 |     expect(response.status()).toBe(400);
  119 |   });
  120 | 
  121 |   test("rechaza con 400 si falta archivoUrl", async ({ request }) => {
  122 |     const response = await request.post(
  123 |       `/api/v1/drivers/${driverIdUnico()}/documents`,
  124 |       {
  125 |         data: {
  126 |           tipoDocumento: "LICENCIA_CONDUCIR",
  127 |           numeroDocumento: "LIC-002",
  128 |           fechaVencimiento: fechaFutura(),
  129 |         },
  130 |       },
  131 |     );
  132 | 
  133 |     expect(response.status()).toBe(400);
  134 |   });
  135 | 
  136 |   test("rechaza con 400 si la fecha de vencimiento ya pasó", async ({
  137 |     request,
  138 |   }) => {
  139 |     const response = await request.post(
  140 |       `/api/v1/drivers/${driverIdUnico()}/documents`,
  141 |       {
  142 |         data: {
  143 |           tipoDocumento: "LICENCIA_CONDUCIR",
  144 |           numeroDocumento: "LIC-003",
  145 |           fechaVencimiento: fechaPasada(),
  146 |           archivoUrl: "https://ejemplo.com/x.pdf",
  147 |         },
  148 |       },
  149 |     );
  150 | 
  151 |     expect(response.status()).toBe(400);
  152 |   });
  153 | 
  154 |   test("rechaza con 400 un SEGURO_VEHICULO sin vehicleId", async ({
  155 |     request,
  156 |   }) => {
```