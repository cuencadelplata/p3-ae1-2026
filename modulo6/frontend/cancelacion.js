const form = document.querySelector('#cancel-form');
const reasonInput = document.querySelector('#reason');
const reasonCount = document.querySelector('#reason-count');
const reviewButton = document.querySelector('#review-button');
const tripContext = document.querySelector('#trip-context');
const tripContextValue = document.querySelector('#trip-context-value');
const lookupStatus = document.querySelector('#lookup-status');
const dialog = document.querySelector('#confirm-dialog');
const confirmButton = document.querySelector('#confirm-button');
const backButton = document.querySelector('#back-button');
const notice = document.querySelector('#notice');
const result = document.querySelector('#result');
const actor = window.location.pathname === '/conductor' ? 'conductor' : 'cliente';
const actorIdName = actor === 'cliente' ? 'clienteId' : 'conductorId';
const actorStorageKey = actor === 'cliente' ? 'm6-client-id' : 'm6-conductor-id';

const actorContent = actor === 'conductor'
  ? {
      label: 'CONDUCTOR · RF-6.6',
      requirement: 'GESTIÓN DE VIAJES · RF-6.6',
      form: 'CANCELACIÓN COMO CONDUCTOR',
      title: 'Cancelar viaje como conductor',
      confirmation: 'Conductor · RF-6.6',
    }
  : {
      label: 'CLIENTE · RF-6.5',
      requirement: 'GESTIÓN DE VIAJES · RF-6.5',
      form: 'CANCELACIÓN COMO CLIENTE',
      title: 'Cancelar viaje como cliente',
      confirmation: 'Cliente · RF-6.5',
    };

let currentTrip;
let pendingCancellation;

document.querySelector('#requirement-label').textContent = actorContent.requirement;
document.querySelector('#page-title').textContent = actorContent.title;
document.querySelector('#form-context').textContent = actorContent.form;
document.querySelector('#role-label').textContent = actorContent.label;

function showNotice(message) {
  notice.textContent = message;
  notice.hidden = false;
}

function clearNotice() {
  notice.hidden = true;
  notice.textContent = '';
}

function showLookupStatus(message, kind = 'info') {
  lookupStatus.textContent = message;
  lookupStatus.dataset.kind = kind;
  lookupStatus.hidden = false;
  tripContext.dataset.state = kind === 'error' ? 'error' : 'loading';
}

async function loadCurrentTrip() {
  reviewButton.disabled = true;
  const search = new URLSearchParams(window.location.search);
  const tripId = search.get('viajeId');
  const identityId = search.get(actorIdName) || localStorage.getItem(actorStorageKey) || '';

  try {
    if (tripId) {
      showLookupStatus('Consultando viaje…');
      const response = await fetch(`/api/viajes/${encodeURIComponent(tripId)}`);
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || `No se pudo consultar el viaje (HTTP ${response.status}).`);
      currentTrip = payload.viaje;
    } else if (identityId) {
      showLookupStatus('Buscando el viaje activo…');
      const listPath = actor === 'cliente' ? 'clientes' : 'conductores';
      const response = await fetch(`/api/${listPath}/${encodeURIComponent(identityId)}/viajes`);
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || `No se pudieron consultar los viajes (HTTP ${response.status}).`);
      currentTrip = (payload.viajes ?? []).find((viaje) => ['SOLICITADO', 'ASIGNADO', 'CONDUCTOR_EN_CAMINO', 'ARRIBADO', 'EN_CURSO'].includes(viaje.estado));
    } else {
      throw new Error(`No se recibió el contexto de la cuenta. Abre esta pantalla desde el viaje activo o pasa ${actorIdName} en la URL.`);
    }

    if (!currentTrip) throw new Error('No hay un viaje cancelable asociado a esta sesión.');
    if (!['SOLICITADO', 'ASIGNADO', 'CONDUCTOR_EN_CAMINO', 'ARRIBADO', 'EN_CURSO'].includes(currentTrip.estado)) {
      throw new Error(`El viaje no se puede cancelar en estado ${currentTrip.estado}.`);
    }

    tripContextValue.textContent = currentTrip.origen && currentTrip.destino
      ? `${currentTrip.origen} → ${currentTrip.destino}`
      : `Viaje ${currentTrip.id} · ${currentTrip.estado}`;
    tripContext.dataset.state = 'ready';
    lookupStatus.hidden = true;
    reviewButton.disabled = false;
  } catch (error) {
    currentTrip = undefined;
    tripContextValue.textContent = 'No se pudo identificar un viaje activo';
    showLookupStatus(error instanceof Error ? error.message : 'No se pudo identificar un viaje activo.', 'error');
  }
}

reasonInput.addEventListener('input', () => {
  reasonCount.textContent = `${reasonInput.value.length} / 240`;
});

form.addEventListener('submit', (event) => {
  event.preventDefault();
  clearNotice();
  if (!form.reportValidity()) return;
  if (!currentTrip) {
    showNotice('No hay un viaje activo para cancelar.');
    return;
  }

  pendingCancellation = {
    viajeId: String(currentTrip.id),
    motivo: reasonInput.value.trim(),
  };
  document.querySelector('#review-trip').textContent = pendingCancellation.viajeId;
  document.querySelector('#review-actor').textContent = actorContent.confirmation;
  document.querySelector('#review-reason').textContent = pendingCancellation.motivo;
  dialog.showModal();
});

backButton.addEventListener('click', () => dialog.close());

confirmButton.addEventListener('click', async () => {
  if (!pendingCancellation) return;

  confirmButton.disabled = true;
  confirmButton.textContent = 'Procesando…';
  clearNotice();
  try {
    const endpoint = actor === 'cliente' ? 'cancelacion-cliente' : 'cancelacion-conductor';
    const response = await fetch(`/api/viajes/${encodeURIComponent(pendingCancellation.viajeId)}/${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ motivo: pendingCancellation.motivo }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `No se pudo cancelar el viaje (HTTP ${response.status}).`);

    const viaje = payload.viaje;
    if (!viaje || String(viaje.id) !== pendingCancellation.viajeId || viaje.estado !== 'CANCELADO') {
      throw new Error('La API respondió, pero no confirmó el estado cancelado del viaje.');
    }

    dialog.close();
    form.hidden = true;
    result.innerHTML = '';
    const mark = document.createElement('span');
    mark.className = 'result-mark';
    mark.setAttribute('aria-hidden', 'true');
    mark.textContent = '✓';
    const summary = document.createElement('div');
    const title = document.createElement('h2');
    title.textContent = 'Cancelación confirmada';
    const description = document.createElement('p');
    description.textContent = 'El viaje quedó cancelado.';
    summary.append(title, description);
    const state = document.createElement('code');
    state.textContent = viaje.estado;
    result.append(mark, summary, state);
    result.hidden = false;
    pendingCancellation = undefined;
  } catch (error) {
    dialog.close();
    showNotice(error instanceof Error ? error.message : 'Ocurrió un error al cancelar el viaje.');
  } finally {
    confirmButton.disabled = false;
    confirmButton.textContent = 'Confirmar cancelación';
  }
});

fetch('/health')
  .then((response) => {
    if (!response.ok) throw new Error('API no disponible');
    return response.json();
  })
  .then((health) => {
    const status = document.querySelector('.api-status');
    document.querySelector('#api-label').textContent = health.status === 'ok' ? 'API disponible' : 'API con errores';
    status.dataset.state = health.status === 'ok' ? 'ok' : 'error';
  })
  .catch(() => {
    const status = document.querySelector('.api-status');
    document.querySelector('#api-label').textContent = 'API no disponible';
    status.dataset.state = 'error';
  });

void loadCurrentTrip();