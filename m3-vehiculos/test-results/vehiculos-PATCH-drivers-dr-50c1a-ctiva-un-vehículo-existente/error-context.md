# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: vehiculos.spec.ts >> PATCH /drivers/:driverId/vehicles/:vehicleId/activar >> activa un vehículo existente
- Location: tests\e2e\vehiculos.spec.ts:145:3

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: 200
Received: 500
```

# Test source

```ts
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
  86  |     expect(primera.status()).toBe(201);
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
> 157 |     expect(response.status()).toBe(200);
      |                               ^ Error: expect(received).toBe(expected) // Object.is equality
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