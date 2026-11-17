# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: conductor\e2e\api.spec.js >> M3 - API Conductores & Valoraciones (E2E Backend) >> RF 3.1 y RF 3.3 - Endpoints /api/conductores/:id/habilitado y /disponible + Resiliencia Redis >> opera con resiliencia cuando Redis cae (fallback a BD en memoria) e invalida/recarga caché al recuperarse
- Location: tests\conductor\e2e\api.spec.js:377:5

# Error details

```
Error: expect(received).toEqual(expected) // deep equality

- Expected  - 1
+ Received  + 1

  Object {
    "habilitado": "activo",
-   "origen": "db",
+   "origen": "cache",
    "usuarioID": "cond_003",
  }
```

# Test source

```ts
  303 | 
  304 |       const initialGet = await request.get('/api/conductores/cond_002/disponible');
  305 |       expect(initialGet.status()).toBe(200);
  306 |       expect(await initialGet.json()).toEqual({
  307 |         usuarioID: 'cond_002',
  308 |         disponible: false
  309 |       });
  310 | 
  311 |       // Cambio de false a true -> eventoEmitido: true
  312 |       const toTrueRes = await request.put('/api/conductores/cond_002/disponible', {
  313 |         data: { disponible: true }
  314 |       });
  315 |       expect(toTrueRes.status()).toBe(200);
  316 |       expect(await toTrueRes.json()).toEqual({
  317 |         usuarioID: 'cond_002',
  318 |         disponible: true,
  319 |         disponibleAnterior: false,
  320 |         eventoEmitido: true
  321 |       });
  322 | 
  323 |       // Verificar con GET
  324 |       const afterTrueGet = await request.get('/api/conductores/cond_002/disponible');
  325 |       expect(afterTrueGet.status()).toBe(200);
  326 |       expect(await afterTrueGet.json()).toEqual({
  327 |         usuarioID: 'cond_002',
  328 |         disponible: true
  329 |       });
  330 | 
  331 |       // Heartbeat repitiendo true -> eventoEmitido: false
  332 |       const heartbeatTrueRes = await request.put('/api/conductores/cond_002/disponible', {
  333 |         data: { disponible: true }
  334 |       });
  335 |       expect(heartbeatTrueRes.status()).toBe(200);
  336 |       expect(await heartbeatTrueRes.json()).toEqual({
  337 |         usuarioID: 'cond_002',
  338 |         disponible: true,
  339 |         disponibleAnterior: true,
  340 |         eventoEmitido: false
  341 |       });
  342 | 
  343 |       // Cambio de true a false -> eventoEmitido: true
  344 |       const toFalseRes = await request.put('/api/conductores/cond_002/disponible', {
  345 |         data: { disponible: false }
  346 |       });
  347 |       expect(toFalseRes.status()).toBe(200);
  348 |       expect(await toFalseRes.json()).toEqual({
  349 |         usuarioID: 'cond_002',
  350 |         disponible: false,
  351 |         disponibleAnterior: true,
  352 |         eventoEmitido: true
  353 |       });
  354 | 
  355 |       // Heartbeat repitiendo false -> eventoEmitido: false
  356 |       const heartbeatFalseRes = await request.put('/api/conductores/cond_002/disponible', {
  357 |         data: { disponible: false }
  358 |       });
  359 |       expect(heartbeatFalseRes.status()).toBe(200);
  360 |       expect(await heartbeatFalseRes.json()).toEqual({
  361 |         usuarioID: 'cond_002',
  362 |         disponible: false,
  363 |         disponibleAnterior: false,
  364 |         eventoEmitido: false
  365 |       });
  366 | 
  367 |       // Valor no booleano -> 400
  368 |       const invalidRes = await request.put('/api/conductores/cond_002/disponible', {
  369 |         data: { disponible: 'si' }
  370 |       });
  371 |       expect(invalidRes.status()).toBe(400);
  372 |       const invalidBody = await invalidRes.json();
  373 |       expect(invalidBody).toHaveProperty('error');
  374 |       expect(invalidBody.error).toContain('booleano');
  375 |     });
  376 | 
  377 |     test('opera con resiliencia cuando Redis cae (fallback a BD en memoria) e invalida/recarga caché al recuperarse', async ({ request }) => {
  378 |       // 1. Con Redis UP, dejar cond_003 en habilitado='activo' y disponible=true en caché y BD
  379 |       const setupHab = await request.put('/api/conductores/cond_003/habilitado', {
  380 |         data: { habilitado: 'activo' }
  381 |       });
  382 |       expect(setupHab.status()).toBe(200);
  383 | 
  384 |       const setupDisp = await request.put('/api/conductores/cond_003/disponible', {
  385 |         data: { disponible: true }
  386 |       });
  387 |       expect(setupDisp.status()).toBe(200);
  388 | 
  389 |       const preCheckHab = await request.get('/api/conductores/cond_003/habilitado');
  390 |       expect(await preCheckHab.json()).toEqual({
  391 |         usuarioID: 'cond_003',
  392 |         habilitado: 'activo',
  393 |         origen: 'cache'
  394 |       });
  395 | 
  396 |       try {
  397 |         // 2. Simular caída de Redis pausando comandos
  398 |         await sendRedisCommand('CLIENT', 'PAUSE', '10000');
  399 | 
  400 |         // Primera lectura detecta el fallo de Redis, activa markDown y responde desde BD
  401 |         const fallbackGetHab = await request.get('/api/conductores/cond_003/habilitado');
  402 |         expect(fallbackGetHab.status()).toBe(200);
> 403 |         expect(await fallbackGetHab.json()).toEqual({
      |                                             ^ Error: expect(received).toEqual(expected) // deep equality
  404 |           usuarioID: 'cond_003',
  405 |           habilitado: 'activo',
  406 |           origen: 'db'
  407 |         });
  408 | 
  409 |         // Actualizar habilitado mientras Redis está caído (se escribe en BD en memoria, Redis queda con 'activo' viejo)
  410 |         const putHabDown = await request.put('/api/conductores/cond_003/habilitado', {
  411 |           data: { habilitado: 'suspendido' }
  412 |         });
  413 |         expect(putHabDown.status()).toBe(200);
  414 |         expect(await putHabDown.json()).toEqual({
  415 |           usuarioID: 'cond_003',
  416 |           habilitado: 'suspendido',
  417 |           habilitadoAnterior: 'activo',
  418 |           eventoEmitido: true
  419 |         });
  420 | 
  421 |         // Lectura de habilitado con Redis caído devuelve el nuevo valor desde BD
  422 |         const getHabWhileDown = await request.get('/api/conductores/cond_003/habilitado');
  423 |         expect(getHabWhileDown.status()).toBe(200);
  424 |         expect(await getHabWhileDown.json()).toEqual({
  425 |           usuarioID: 'cond_003',
  426 |           habilitado: 'suspendido',
  427 |           origen: 'db'
  428 |         });
  429 | 
  430 |         // Actualizar disponibilidad mientras Redis está caído (se persiste en BD en memoria)
  431 |         const putDispDown = await request.put('/api/conductores/cond_003/disponible', {
  432 |           data: { disponible: false }
  433 |         });
  434 |         expect(putDispDown.status()).toBe(200);
  435 |         expect(await putDispDown.json()).toEqual({
  436 |           usuarioID: 'cond_003',
  437 |           disponible: false,
  438 |           disponibleAnterior: true,
  439 |           eventoEmitido: true
  440 |         });
  441 | 
  442 |         const getDispWhileDown = await request.get('/api/conductores/cond_003/disponible');
  443 |         expect(getDispWhileDown.status()).toBe(200);
  444 |         expect(await getDispWhileDown.json()).toEqual({
  445 |           usuarioID: 'cond_003',
  446 |           disponible: false
  447 |         });
  448 |       } finally {
  449 |         // 3. Recuperar Redis
  450 |         await sendRedisCommand('CLIENT', 'UNPAUSE');
  451 |       }
  452 | 
  453 |       // 4. Esperar a que redisHealth detecte PING -> PONG, invalide la caché obsoleta y recargue desde BD
  454 |       await expect
  455 |         .poll(
  456 |           async () => {
  457 |             const res = await request.get('/api/conductores/cond_003/habilitado');
  458 |             return await res.json();
  459 |           },
  460 |           { timeout: 15000, intervals: [200, 300, 500] }
  461 |         )
  462 |         .toEqual({
  463 |           usuarioID: 'cond_003',
  464 |           habilitado: 'suspendido',
  465 |           origen: 'cache'
  466 |         });
  467 | 
  468 |       // La disponibilidad también fue invalidada en Redis y refleja false
  469 |       const dispAfterRecovery = await request.get('/api/conductores/cond_003/disponible');
  470 |       expect(dispAfterRecovery.status()).toBe(200);
  471 |       expect(await dispAfterRecovery.json()).toEqual({
  472 |         usuarioID: 'cond_003',
  473 |         disponible: false
  474 |       });
  475 | 
  476 |       // Restaurar estado base
  477 |       await request.put('/api/conductores/cond_003/habilitado', {
  478 |         data: { habilitado: 'pendiente' }
  479 |       });
  480 |       await request.put('/api/conductores/cond_001/disponible', {
  481 |         data: { disponible: true }
  482 |       });
  483 |     });
  484 | 
  485 |   });
  486 | 
  487 | });
  488 | 
```