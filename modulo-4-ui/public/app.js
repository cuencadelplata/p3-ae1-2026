const api = '/api/v1';
const output = document.querySelector('#output');
const responseStatus = document.querySelector('#response-status');
const candidates = document.querySelector('#candidates');

async function callApi(url, options = {}) {
  responseStatus.textContent = 'Consultando...';
  try {
    const response = await fetch(url, options);
    const data = response.status === 204 ? null : await response.json();
    responseStatus.textContent = `HTTP ${response.status}`;
    output.textContent = data === null ? 'Operacion completada sin contenido.' : JSON.stringify(data, null, 2);
    if (!response.ok) throw new Error(data?.message ?? 'La API devolvio un error');
    return data;
  } catch (error) {
    responseStatus.textContent = 'Error';
    if (!output.textContent.startsWith('{')) output.textContent = error instanceof Error ? error.message : 'Error inesperado';
    throw error;
  }
}

async function checkHealth() {
  const indicator = document.querySelector('#health');
  try {
    const response = await fetch('/health');
    if (!response.ok) throw new Error();
    indicator.textContent = 'API disponible'; indicator.className = 'status ok';
  } catch { indicator.textContent = 'API no disponible'; indicator.className = 'status error'; }
}

document.querySelector('#location-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const driverId = document.querySelector('#driver-id').value.trim();
  const body = { latitude: Number(document.querySelector('#latitude').value), longitude: Number(document.querySelector('#longitude').value), vehicleType: document.querySelector('#vehicle-type').value, available: document.querySelector('#available').value === 'true' };
  try { await callApi(`${api}/drivers/${encodeURIComponent(driverId)}/location`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); } catch {}
});

document.querySelector('#load-demo').addEventListener('click', async () => {
  const demos = [['driver-auto', { latitude: -27.4693, longitude: -58.8307, vehicleType: 'AUTO', available: true }], ['driver-moto', { latitude: -27.4701, longitude: -58.8312, vehicleType: 'MOTO', available: true }]];
  try {
    for (const [id, body] of demos) await callApi(`${api}/drivers/${id}/location`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    responseStatus.textContent = '2 demos publicadas';
  } catch {}
});

document.querySelector('#search-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const params = new URLSearchParams({ latitude: document.querySelector('#search-latitude').value, longitude: document.querySelector('#search-longitude').value, vehicleType: document.querySelector('#search-vehicle').value, radiusKm: document.querySelector('#radius').value, maxCandidates: '10' });
  try {
    const data = await callApi(`${api}/drivers/nearby?${params}`);
    candidates.replaceChildren();
    if (!data.drivers.length) { candidates.className = 'empty'; candidates.textContent = 'No hay conductores vigentes para estos filtros.'; return; }
    candidates.className = '';
    for (const driver of data.drivers) {
      const row = document.createElement('article'); row.className = 'candidate';
      const info = document.createElement('div'); const title = document.createElement('strong'); title.textContent = driver.driverId; const detail = document.createElement('p'); detail.textContent = `${driver.vehicleType} · ${driver.distanceKm} km · ETA ${driver.estimatedEtaMinutes} min`; info.append(title, detail);
      const badge = document.createElement('span'); badge.className = 'tag'; badge.textContent = 'Disponible';
      const actions = document.createElement('div'); actions.className = 'candidate-actions';
      const toggle = document.createElement('button'); toggle.className = 'secondary'; toggle.textContent = 'Marcar no disponible'; toggle.addEventListener('click', async () => { try { await callApi(`${api}/drivers/${encodeURIComponent(driver.driverId)}/availability`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: '{"available":false}' }); row.remove(); } catch {} });
      const remove = document.createElement('button'); remove.className = 'secondary'; remove.textContent = 'Eliminar ubicacion'; remove.addEventListener('click', async () => { try { await callApi(`${api}/drivers/${encodeURIComponent(driver.driverId)}/location`, { method: 'DELETE' }); row.remove(); } catch {} });
      actions.append(toggle, remove); row.append(info, badge, actions); candidates.append(row);
    }
  } catch { candidates.className = 'empty'; candidates.textContent = 'No se pudo completar la busqueda.'; }
});

checkHealth();
