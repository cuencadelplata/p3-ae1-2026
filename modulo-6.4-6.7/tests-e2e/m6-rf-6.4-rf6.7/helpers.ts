const apiUrl = process.env.E2E_API_URL ?? 'http://127.0.0.1:3000';

export async function crearViaje(input: {
  id: string;
  estado: string;
}): Promise<void> {
  let response: Response | undefined;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    response = await fetch(`${apiUrl}/api/viajes`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: input.id,
        clienteId: `cliente-${input.id}`,
        conductorId: `conductor-${input.id}`,
        estado: input.estado,
        tarifaBase: 0,
        tarifaPorKm: 0,
        tarifaPorMinuto: 0,
        inicio: '2026-09-01T10:00:00Z',
      }),
    });
    if (response.status !== 503) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  if (!response || response.status !== 201) {
    const details = response ? `${response.status} ${await response.text()}` : 'sin respuesta';
    throw new Error(`No se pudo crear el viaje ${input.id}: ${details}`);
  }
}

export async function post(path: string, body: unknown): Promise<{ response: Response; body: any }> {
  const response = await fetch(`${apiUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { response, body: await response.json() };
}
