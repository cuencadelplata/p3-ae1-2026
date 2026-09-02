const apiUrl = process.env.E2E_API_URL ?? 'http://127.0.0.1:3000';

export async function crearViaje(input: {
  id: string;
  estado: string;
}): Promise<void> {
  const response = await fetch(`${apiUrl}/api/viajes`, {
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

  if (response.status !== 201) {
    throw new Error(`No se pudo crear el viaje ${input.id}: ${response.status} ${await response.text()}`);
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
