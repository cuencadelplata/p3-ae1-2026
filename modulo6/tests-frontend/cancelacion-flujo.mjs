import assert from 'node:assert/strict';
import { writeFile, unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

// Ejecutar con Vite en http://127.0.0.1:5178 (ver README de M6).
const baseURL = process.env.FRONTEND_TEST_URL ?? 'http://127.0.0.1:5178';
const ui = new URL('../../modulo-1-identidad-acceso-ui/', import.meta.url);
const html = new URL('.m6-cancelacion-check.html', ui);
const entry = new URL('src/.m6-cancelacion-check.tsx', ui);
const harness = `import React from 'react';
import { createRoot } from 'react-dom/client';
import DriverDispatch from './components/DriverDispatch';
import RideFlow from './components/RideFlow';
const driver = new URLSearchParams(location.search).get('mode') === 'driver';
const account = { userId: 123, token: 'test-token', nombre: 'Prueba', apellido: 'Cancelación', rol: driver ? 'CONDUCTOR' : 'CLIENTE', email: 'test@example.com' };
if (driver) sessionStorage.setItem('movilidad.conductor.viaje.123', JSON.stringify({ tripId: 'trip-test' }));
else sessionStorage.setItem('movilidad.viaje.123', JSON.stringify({ key: 'search-test', ride: { id: 'request-test', status: 'SEARCHING', createdAt: new Date().toISOString(), expiresAt: new Date(Date.now()+180000).toISOString() } }));
createRoot(document.getElementById('root')!).render(driver
 ? <DriverDispatch driver={account} onBack={() => {}} onSessionExpired={() => {}} />
 : <RideFlow passenger={account} onBack={() => {}} />);`;
let browser;
try {
  await writeFile(html, '<html><body><div id="root"></div><script type="module" src="/src/.m6-cancelacion-check.tsx"></script></body></html>');
  await writeFile(entry, harness);
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext({ permissions: ['geolocation'], geolocation: { latitude: -27.4692, longitude: -58.8306 } });
  for (const mode of ['driver', 'client', 'client-race']) {
    const page = await context.newPage();
    const duplicateKeys = [];
    page.on('console', message => { if (/same key|duplicate key/.test(message.text())) duplicateKeys.push(message.text()); });
    let cancelled = false;
    let fail = mode === 'client';
    let posts = 0;
    let assigned = false;
    const trip = { id: 'trip-test', estado: 'ARRIBADO', conductorId: '123', rideRequestId: 'request-test', origen: 'Origen', destino: 'Destino', fechaCreacion: new Date().toISOString() };
    const offer = { id: 'offer-test', requestId: 'other-request', status: 'PENDING', vehicleType: 'AUTO', createdAt: new Date().toISOString(), expiresAt: new Date(Date.now()+60000).toISOString(), origin: { latitude: -27.4692, longitude: -58.8306, address: 'Origen' }, destination: { latitude: -27.4459, longitude: -58.7619, address: 'Destino' }, estimatedFare: { amount: 1000, currency: 'ARS' } };
    await page.route('**/flujo-api/**', async route => {
      const req = route.request(), path = new URL(req.url()).pathname;
      if (path.endsWith('/cancelacion-conductor')) {
        cancelled = true; posts++;
        return route.fulfill({ json: { viaje: { ...trip, estado: 'CANCELADO', canceladoPor: 'conductor' } } });
      }
      if (path.endsWith('/request-test/cancel')) {
        posts++;
        assert.equal(req.headers().authorization, 'Bearer test-token');
        assert.deepEqual(req.postDataJSON(), { reason: 'Cambio de planes' });
        if (mode === 'client-race') {
          assigned = true;
          return route.fulfill({ status: 409, json: { code: 'REQUEST_ALREADY_ASSIGNED', message: 'La solicitud ya fue asignada' } });
        }
        if (fail) return route.fulfill({ status: 503, json: { message: 'No se pudo cancelar la búsqueda' } });
        cancelled = true;
        return route.fulfill({ json: { status: 'CANCELLED' } });
      }
      if (path.endsWith('/api/viajes/trip-test')) return route.fulfill({ json: { ...trip, estado: cancelled ? 'CANCELADO' : 'ARRIBADO' } });
      if (path.includes('/api/viajes')) return route.fulfill({ json: { viajes: [] } });
      if (path.endsWith('/request-test')) return route.fulfill({ json: { id: 'request-test', status: assigned ? 'ASSIGNED' : cancelled ? 'CANCELLED' : 'SEARCHING', assignedDriverId: assigned ? '456' : null, createdAt: new Date().toISOString(), expiresAt: new Date(Date.now()+180000).toISOString() } });
      if (path.endsWith('/offers') && req.method() === 'GET') return route.fulfill({ json: { offers: cancelled ? [offer] : [] } });
      if (path.endsWith('/vehicles')) return route.fulfill({ json: [{ id: 'car-test', patente: 'TEST123', activo: true, tipoServicio: 'AUTO', anio: 2020 }] });
      if (path.endsWith('/estado')) return route.fulfill({ json: { estado: 'habilitado', habilitado: true } });
      return route.fulfill({ json: {} });
    });
    await page.goto(`${baseURL}/.m6-cancelacion-check.html?mode=${mode}`);
    if (mode === 'driver') await page.getByLabel('Código de inicio del pasajero', { exact: true }).waitFor();
    const cancelButton = page.getByRole('button', { name: mode === 'driver' ? 'Cancelar viaje' : 'Cancelar búsqueda', exact: true });
    await cancelButton.click();
    await page.getByRole('textbox', { name: 'Motivo de cancelación' }).fill('   ');
    assert(await page.getByRole('button', { name: 'Revisar cancelación' }).isDisabled());
    await page.getByRole('textbox', { name: 'Motivo de cancelación' }).fill('Cambio de planes');
    await page.getByRole('button', { name: 'Revisar cancelación' }).click();
    assert.equal(posts, 0, 'No debe cancelar antes de confirmar');
    await page.getByRole('button', { name: 'Confirmar cancelación' }).click();
    if (mode === 'client') {
      await page.getByRole('alert').filter({ hasText: 'No se pudo cancelar la búsqueda' }).waitFor();
      fail = false;
      await page.getByRole('button', { name: 'Confirmar cancelación' }).click();
      await page.getByRole('heading', { name: 'Solicitud cerrada' }).waitFor();
      assert.equal(posts, 2);
    } else if (mode === 'client-race') {
      await page.getByRole('heading', { name: 'Conductor asignado' }).waitFor();
      assert.equal(cancelled, false);
      assert.equal(posts, 1);
      assert.equal(await page.getByRole('button', { name: 'Cancelar búsqueda', exact: true }).count(), 0);
    } else {
      await page.getByRole('button', { name: 'Aceptar viaje', exact: true }).waitFor();
      assert.equal(await page.getByLabel('Código de inicio del pasajero', { exact: true }).count(), 0);
      assert.equal(await page.getByRole('button', { name: 'Validar e iniciar viaje', exact: true }).count(), 0);
      assert.deepEqual(duplicateKeys, []);
    }
    console.log(mode === 'client-race' ? 'PASS client-race: conserva la asignación si el conductor acepta al cancelar' : `PASS ${mode}: cancelación confirmada sin formulario QR residual ni espera bloqueada`);
    await page.close();
  }
  // La política del formulario debe coincidir con M6 para ambos roles y todos los estados.
  for (const actor of ['cliente', 'conductor']) {
    for (const estado of ['SOLICITADO', 'ASIGNADO', 'CONDUCTOR_EN_CAMINO', 'ARRIBADO', 'EN_CURSO', 'COMPLETADO', 'CANCELADO']) {
      await writeFile(entry, `import React from 'react';
import { createRoot } from 'react-dom/client';
import TripCancellation from './components/TripCancellation';
createRoot(document.getElementById('root')!).render(<TripCancellation trip={{ id: 'matrix-trip', estado: '${estado}', origen: 'Origen', destino: 'Destino' }} actor="${actor}" token="test-token" onCancelled={() => { document.title = 'Cancelado'; }} />);`);
      const page = await context.newPage();
      let posts = 0;
      await page.route('**/flujo-api/m6-cancelacion/**', async route => {
        assert(route.request().url().endsWith(`/matrix-trip/cancelacion-${actor}`));
        posts++;
        await route.fulfill({ json: { viaje: { id: 'matrix-trip', estado: 'CANCELADO' } } });
      });
      await page.goto(`${baseURL}/.m6-cancelacion-check.html?matrix=${actor}-${estado}`);
      const button = page.getByRole('button', { name: 'Cancelar viaje', exact: true });
      if (['COMPLETADO', 'CANCELADO'].includes(estado)) assert(await button.isDisabled());
      else {
        await button.click();
        await page.getByRole('textbox', { name: 'Motivo de cancelación' }).fill('No puedo continuar');
        await page.getByRole('button', { name: 'Revisar cancelación' }).click();
        await page.getByRole('button', { name: 'Editar motivo' }).click();
        await page.getByRole('textbox', { name: 'Motivo de cancelación' }).fill('Motivo revisado');
        await page.getByRole('button', { name: 'Revisar cancelación' }).click();
        await page.getByRole('button', { name: 'Confirmar cancelación' }).click();
        await page.waitForFunction(() => document.title === 'Cancelado');
        assert.equal(posts, 1);
      }
      await page.close();
    }
  }
  console.log('PASS: matriz de 14 estados/roles, edición del motivo y bloqueo de terminales');
} finally {
  await browser?.close();
  await Promise.all([html, entry].map(file => unlink(fileURLToPath(file)).catch(() => {})));
}
