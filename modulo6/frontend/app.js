const requestForm = document.querySelector('#request-form');
const clientInput = document.querySelector('#client-id');
const filterInput = document.querySelector('#filter-client');
const tripList = document.querySelector('#trip-list');
const emptyState = document.querySelector('#empty-state');
const detailPanel = document.querySelector('#trip-detail');
const notice = document.querySelector('#notice');
const refreshButton = document.querySelector('#refresh-button');

let trips = [];
let selectedTripId = null;
let selectedQr = null;
let noticeTimer;

const stateLabels = {
  SOLICITADO: 'Solicitado',
  CONDUCTOR_EN_CAMINO: 'Conductor en camino',
  ARRIBADO: 'Conductor arribó',
  EN_CURSO: 'En curso',
  COMPLETADO: 'Completado',
  CANCELADO: 'Cancelado',
};

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character]);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...options.headers,
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = body.error?.code || body.error || `HTTP ${response.status}`;
    throw new Error(typeof detail === 'string' ? detail : JSON.stringify(detail));
  }
  return body;
}

function showNotice(message, kind = 'success') {
  clearTimeout(noticeTimer);
  notice.textContent = message;
  notice.dataset.kind = kind;
  notice.hidden = false;
  noticeTimer = setTimeout(() => { notice.hidden = true; }, 4200);
}

function activeTrip() {
  return trips.find((trip) => String(trip.id) === String(selectedTripId));
}

function renderSummary() {
  document.querySelector('#count-active').textContent = trips.filter((trip) => trip.estado === 'EN_CURSO').length;
  document.querySelector('#count-waiting').textContent = trips.filter((trip) => ['SOLICITADO', 'CONDUCTOR_EN_CAMINO', 'ARRIBADO'].includes(trip.estado)).length;
  document.querySelector('#count-total').textContent = trips.length;
  document.querySelector('#list-caption').textContent = trips.length
    ? `${trips.length} ${trips.length === 1 ? 'viaje' : 'viajes'}`
    : 'Sin viajes cargados';
}

function renderTrips() {
  renderSummary();
  emptyState.hidden = trips.length > 0;
  tripList.innerHTML = trips.map((trip) => `
    <button class="trip-row" type="button" data-trip-id="${escapeHtml(trip.id)}" aria-current="${String(trip.id) === String(selectedTripId)}">
      <span class="trip-row-main">
        <span class="trip-row-id">${escapeHtml(String(trip.id).slice(0, 13))}</span>
        <span class="trip-row-route">${escapeHtml(trip.origen)} → ${escapeHtml(trip.destino)}</span>
      </span>
      <span class="state-pill" data-state="${escapeHtml(trip.estado)}">${escapeHtml(stateLabels[trip.estado] ?? trip.estado)}</span>
    </button>
  `).join('');
  renderDetail();
}

function renderDetail() {
  const trip = activeTrip();
  if (!trip) {
    detailPanel.innerHTML = '<div class="detail-empty"><span class="detail-index">02 / 03</span><p>Seleccioná un viaje para ver sus datos y continuar el recorrido.</p></div>';
    return;
  }

  const qr = selectedQr?.tripId === String(trip.id) ? selectedQr : null;
  let action = '<p class="action-title">El recorrido está cerrado</p>';
  if (trip.estado === 'SOLICITADO') {
    action = `
      <p class="action-title">Asignar conductor para continuar</p>
      <form class="action-form" id="assign-form">
        <label>ID conductor<input name="conductorId" required placeholder="conductor-001"></label>
        <button class="button button-secondary" type="submit">Asignar</button>
      </form>`;
  } else if (trip.estado === 'CONDUCTOR_EN_CAMINO') {
    action = '<p class="action-title">El conductor está en camino</p><button class="button button-secondary" id="arrival-button" type="button">Registrar arribo y generar QR</button>';
  } else if (trip.estado === 'ARRIBADO') {
    action = `
      <p class="action-title">Validar QR para iniciar</p>
      ${qr ? `<div class="qr-block"><img class="qr-image" src="${escapeHtml(qr.qrDataUrl)}" alt="QR de inicio del viaje"><div class="qr-data"><strong>QR activo</strong><code>${escapeHtml(qr.token)}</code><span>Vence: ${escapeHtml(new Date(qr.expiresAt).toLocaleString('es-AR'))}</span></div></div>` : ''}
      <button class="button button-secondary" id="refresh-qr-button" type="button">Mostrar QR vigente</button>
      <form class="action-form" id="start-form">
        <label>Token QR<input name="token" required autocomplete="off" placeholder="Ingresá el token del QR" value="${escapeHtml(qr?.token ?? '')}"></label>
        <button class="button button-accent" type="submit">Validar e iniciar</button>
      </form>`;
  } else if (trip.estado === 'EN_CURSO') {
    action = '<p class="action-title">Viaje iniciado correctamente</p>';
  }

  detailPanel.innerHTML = `
    <div class="detail-top">
      <div><p class="eyebrow">VIAJE SELECCIONADO</p><h3>${escapeHtml(trip.id)}</h3><p>Creado ${escapeHtml(new Date(trip.fechaCreacion).toLocaleString('es-AR'))}</p></div>
      <span class="state-pill" data-state="${escapeHtml(trip.estado)}">${escapeHtml(stateLabels[trip.estado] ?? trip.estado)}</span>
    </div>
    <div class="route-line">
      <div class="route-point"><span class="route-dot"></span><span>${escapeHtml(trip.origen)}</span></div>
      <div class="route-point"><span class="route-dot"></span><span>${escapeHtml(trip.destino)}</span></div>
    </div>
    <div class="detail-facts">
      <div class="fact"><span>Cliente</span><strong>${escapeHtml(trip.clienteId)}</strong></div>
      <div class="fact"><span>Conductor</span><strong>${escapeHtml(trip.conductorId || 'Sin asignar')}</strong></div>
    </div>
    <div class="action-area">${action}</div>`;
}

async function loadTrips(preferredId = selectedTripId) {
  const clientId = filterInput.value.trim();
  if (!clientId) {
    trips = [];
    selectedTripId = null;
    renderTrips();
    return;
  }
  const result = await api(`/api/clientes/${encodeURIComponent(clientId)}/viajes`);
  trips = Array.isArray(result.viajes) ? result.viajes : [];
  selectedTripId = trips.some((trip) => String(trip.id) === String(preferredId))
    ? preferredId
    : trips[0]?.id ?? null;
  renderTrips();
}

async function runAction(button, action) {
  if (button) button.disabled = true;
  try {
    await action();
  } catch (error) {
    showNotice(error instanceof Error ? error.message : 'No se pudo completar la operación', 'error');
  } finally {
    if (button?.isConnected) button.disabled = false;
  }
}

clientInput.value = localStorage.getItem('m6-client-id') || clientInput.value;
filterInput.value = clientInput.value;
clientInput.addEventListener('change', () => {
  filterInput.value = clientInput.value.trim();
  localStorage.setItem('m6-client-id', filterInput.value);
});

requestForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const button = requestForm.querySelector('button[type="submit"]');
  runAction(button, async () => {
    const form = new FormData(requestForm);
    const clientId = String(form.get('clienteId')).trim();
    const result = await api('/api/viajes', {
      method: 'POST',
      body: JSON.stringify({
        clienteId: clientId,
        origen: String(form.get('origen')).trim(),
        destino: String(form.get('destino')).trim(),
      }),
    });
    clientInput.value = clientId;
    filterInput.value = clientId;
    localStorage.setItem('m6-client-id', clientId);
    const trip = result.viaje ?? result;
    selectedTripId = trip.id;
    await loadTrips(trip.id);
    showNotice('Viaje solicitado.');
  });
});

refreshButton.addEventListener('click', () => runAction(refreshButton, async () => {
  await loadTrips();
  showNotice('Lista actualizada.');
}));

filterInput.addEventListener('change', () => runAction(null, () => loadTrips(null)));
tripList.addEventListener('click', (event) => {
  const row = event.target.closest('[data-trip-id]');
  if (!row) return;
  selectedTripId = row.dataset.tripId;
  selectedQr = null;
  renderTrips();
});

detailPanel.addEventListener('submit', (event) => {
  event.preventDefault();
  const trip = activeTrip();
  if (!trip) return;

  if (event.target.id === 'assign-form') {
    const form = new FormData(event.target);
    const button = event.target.querySelector('button');
    runAction(button, async () => {
      await api(`/api/viajes/${encodeURIComponent(trip.id)}/asignar`, {
        method: 'POST',
        body: JSON.stringify({ conductorId: String(form.get('conductorId')).trim() }),
      });
      await loadTrips(trip.id);
      showNotice('Conductor asignado.');
    });
  }

  if (event.target.id === 'start-form') {
    const form = new FormData(event.target);
    const button = event.target.querySelector('button');
    runAction(button, async () => {
      await api(`/api/viajes/${encodeURIComponent(trip.id)}/iniciar`, {
        method: 'POST',
        body: JSON.stringify({ token: String(form.get('token')).trim() }),
      });
      selectedQr = null;
      await loadTrips(trip.id);
      showNotice('QR validado. Viaje iniciado.');
    });
  }
});

detailPanel.addEventListener('click', (event) => {
  if (!['arrival-button', 'refresh-qr-button'].includes(event.target.id)) return;
  const trip = activeTrip();
  if (!trip) return;
  runAction(event.target, async () => {
    const result = await api(`/api/viajes/${encodeURIComponent(trip.id)}/arribo`, { method: 'PUT' });
    const qr = result.qr;
    selectedQr = qr ? { ...qr, tripId: String(trip.id) } : null;
    await loadTrips(trip.id);
    showNotice('Arribo registrado.');
  });
});

loadTrips().catch((error) => showNotice(error.message, 'error'));