const apiUrl = process.env.E2E_API_URL ?? 'http://127.0.0.1:3002';
const rf6ApiUrl = process.env.RF6_API_URL ?? 'http://127.0.0.1:3000';

export async function crearViaje(input: {
  clienteId: string;
  iniciar?: boolean;
}): Promise<string> {
  let response: Response | undefined;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    response = await fetch(`${rf6ApiUrl}/api/viajes`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        clienteId: input.clienteId,
        origen: 'Calle A',
        destino: 'Calle B',
      }),
    });
    if (response.status !== 503) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  if (!response || response.status !== 201) {
    const details = response ? `${response.status} ${await response.text()}` : 'sin respuesta';
    throw new Error(`No se pudo crear el viaje ${input.clienteId}: ${details}`);
  }
  const viaje = await response.json() as { id?: string };
  if (!viaje.id) throw new Error('Viajes creó el viaje pero no devolvió su ID');

  if (input.iniciar) {
    const asignacion = await fetch(`${rf6ApiUrl}/api/viajes/${viaje.id}/asignar`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ conductorId: `conductor-${input.clienteId}` }),
    });
    if (!asignacion.ok) {
      throw new Error(`No se pudo asignar el viaje: ${asignacion.status} ${await asignacion.text()}`);
    }
    const arribo = await fetch(`${rf6ApiUrl}/api/viajes/${viaje.id}/arribo`, { method: 'PUT' });
    if (!arribo.ok) {
      throw new Error(`No se pudo registrar el arribo: ${arribo.status} ${await arribo.text()}`);
    }
    const datosArribo = await arribo.json() as { qr?: { token?: string } };
    const token = datosArribo.qr?.token;
    if (!token) throw new Error('RF-6 registró el arribo pero no devolvió el token QR');

    const inicio = await fetch(`${rf6ApiUrl}/api/viajes/${viaje.id}/iniciar`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ codigoVerificacion: token }),
    });
    if (!inicio.ok) {
      throw new Error(`No se pudo iniciar el viaje: ${inicio.status} ${await inicio.text()}`);
    }
  }
  return viaje.id;
}

/** Cuerpo de finalización válido: horaFin es "ahora" y el pago es con tarjeta tokenizada. */
export function datosFinalizacion(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    origen: { latitude: 0, longitude: 0 },
    destino: { latitude: 0, longitude: 0.01 },
    tipoVehiculo: 'auto',
    horaFin: new Date().toISOString(),
    metodoPago: 'tarjeta',
    pago: { token: 'tok-e2e', paymentMethodId: 'visa', email: 'cliente@example.com' },
    ...overrides,
  };
}

export async function post(path: string, body: unknown): Promise<{ response: Response; body: Record<string, any> }> {
  const response = await fetch(`${apiUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { response, body: await response.json() };
}
