# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: documentos.spec.ts >> POST /drivers/:driverId/documents — RF-3.4 registrar documentación >> rechaza con 400 una LICENCIA_CONDUCIR con vehicleId
- Location: tests\e2e\documentos.spec.ts:172:3

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: 400
Received: 500
```

# Test source

```ts
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
  157 |     const response = await request.post(
  158 |       `/api/v1/drivers/${driverIdUnico()}/documents`,
  159 |       {
  160 |         data: {
  161 |           tipoDocumento: "SEGURO_VEHICULO",
  162 |           numeroDocumento: "POL-002",
  163 |           fechaVencimiento: fechaFutura(),
  164 |           archivoUrl: "https://ejemplo.com/seguro.pdf",
  165 |         },
  166 |       },
  167 |     );
  168 | 
  169 |     expect(response.status()).toBe(400);
  170 |   });
  171 | 
  172 |   test("rechaza con 400 una LICENCIA_CONDUCIR con vehicleId", async ({
  173 |     request,
  174 |   }) => {
  175 |     const driverId = driverIdUnico();
  176 |     const vehicleId = await crearVehiculoDePrueba(request, driverId);
  177 | 
  178 |     const response = await request.post(
  179 |       `/api/v1/drivers/${driverId}/documents`,
  180 |       {
  181 |         data: {
  182 |           tipoDocumento: "LICENCIA_CONDUCIR",
  183 |           numeroDocumento: "LIC-004",
  184 |           fechaVencimiento: fechaFutura(),
  185 |           archivoUrl: "https://ejemplo.com/x.pdf",
  186 |           vehicleId,
  187 |         },
  188 |       },
  189 |     );
  190 | 
> 191 |     expect(response.status()).toBe(400);
      |                               ^ Error: expect(received).toBe(expected) // Object.is equality
  192 |   });
  193 | 
  194 |   test("rechaza con 404 si el vehicleId no existe para ese conductor", async ({
  195 |     request,
  196 |   }) => {
  197 |     const response = await request.post(
  198 |       `/api/v1/drivers/${driverIdUnico()}/documents`,
  199 |       {
  200 |         data: {
  201 |           tipoDocumento: "SEGURO_VEHICULO",
  202 |           numeroDocumento: "POL-003",
  203 |           fechaVencimiento: fechaFutura(),
  204 |           archivoUrl: "https://ejemplo.com/seguro.pdf",
  205 |           vehicleId: "00000000-0000-0000-0000-000000000000",
  206 |         },
  207 |       },
  208 |     );
  209 | 
  210 |     expect(response.status()).toBe(404);
  211 |   });
  212 | });
  213 | 
  214 | test.describe("GET /drivers/:driverId/documents — listar y obtener", () => {
  215 |   test("lista los documentos del conductor recién creado", async ({
  216 |     request,
  217 |   }) => {
  218 |     const driverId = driverIdUnico();
  219 |     await request.post(`/api/v1/drivers/${driverId}/documents`, {
  220 |       data: {
  221 |         tipoDocumento: "LICENCIA_CONDUCIR",
  222 |         numeroDocumento: "LIC-005",
  223 |         fechaVencimiento: fechaFutura(),
  224 |         archivoUrl: "https://ejemplo.com/x.pdf",
  225 |       },
  226 |     });
  227 | 
  228 |     const response = await request.get(
  229 |       `/api/v1/drivers/${driverId}/documents`,
  230 |     );
  231 | 
  232 |     expect(response.status()).toBe(200);
  233 |     const body = await response.json();
  234 |     expect(Array.isArray(body)).toBe(true);
  235 |     expect(body.length).toBeGreaterThanOrEqual(1);
  236 |   });
  237 | 
  238 |   test("obtiene un documento puntual por id", async ({ request }) => {
  239 |     const driverId = driverIdUnico();
  240 |     const creado = await request.post(
  241 |       `/api/v1/drivers/${driverId}/documents`,
  242 |       {
  243 |         data: {
  244 |           tipoDocumento: "LICENCIA_CONDUCIR",
  245 |           numeroDocumento: "LIC-006",
  246 |           fechaVencimiento: fechaFutura(),
  247 |           archivoUrl: "https://ejemplo.com/x.pdf",
  248 |         },
  249 |       },
  250 |     );
  251 |     const { id } = await creado.json();
  252 | 
  253 |     const response = await request.get(
  254 |       `/api/v1/drivers/${driverId}/documents/${id}`,
  255 |     );
  256 | 
  257 |     expect(response.status()).toBe(200);
  258 |     const body = await response.json();
  259 |     expect(body.id).toBe(id);
  260 |   });
  261 | 
  262 |   test("devuelve 404 si el documento no existe para ese conductor", async ({
  263 |     request,
  264 |   }) => {
  265 |     const response = await request.get(
  266 |       `/api/v1/drivers/${driverIdUnico()}/documents/00000000-0000-0000-0000-000000000000`,
  267 |     );
  268 | 
  269 |     expect(response.status()).toBe(404);
  270 |   });
  271 | });
```