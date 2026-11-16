const form = document.querySelector('#cancel-form');
const identityForm = document.querySelector('#identity-form');
const identityInput = document.querySelector('#identity-id');
const identityLabel = document.querySelector('#identity-label');
const lookupButton = document.querySelector('#lookup-button');
const lookupStatus = document.querySelector('#lookup-status');
const tripPicker = document.querySelector('#trip-picker');
const tripSelect = document.querySelector('#trip-select');
const dialog = document.querySelector('#confirm-dialog');
const reasonInput = document.querySelector('#reason');
const reasonCount = document.querySelector('#reason-count');
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
      description: 'El viaje se cancela y el despacho puede buscar otro conductor.',
      confirmation: 'Conductor · RF-6.6',
    }
  : {
      label: 'CLIENTE · RF-6.5',
      requirement: 'GESTIÓN DE VIAJES · RF-6.5',
      form: 'CANCELACIÓN COMO CLIENTE',
      title: 'Cancelar viaje como cliente',
      description: 'Se registra el motivo y se notifica la cancelación.',
      confirmation: 'Cliente · RF-6.5',
    };

let pendingCancellation;

document.querySelector('#requirement-label').textContent = actorContent.requirement;
document.querySelector('#page-title').textContent = actorContent.title;
document.querySelector('#form-context').textContent = actorContent.form;
document.querySelector('#role-label').textContent = actorContent.label;
document.querySelector('#role-description').textContent = actorContent.description;
identityLabel.textContent = actor === 'cliente' ? 'Identificador de cliente' : 'Identificador de conductor';
identityInput.placeholder = actor === 'cliente' ? 'Ej. cliente-demo-001' : 'ID de tu cuenta de conductor';

function showNotice(message) {
  notice.textContent = message;
  notice.hidden = false;
}

function showLookupStatus(message, kind = 'info') {
  lookupStatus.textContent = message;
  lookupStatus.dataset.kind = kind;
  lookupStatus.hidden = false;
}

async function loadTrips(identityId) {
  const normalizedIdentity = identityId.trim();
  if (!normalizedIdentity) return;

  lookupButton.disabled = true;
  lookupButton.textContent = 'Buscando…';
  lookupStatus.hidden = true;
  tripPicker.hidden = true;
  form.querySelector('#review-button').disabled = true;
  try {
    const response = await fetch(`/api/${actor === 'cliente' ? 'clientes' : 'conductores'}/${encodeURIComponent(normalizedIdentity)}/viajes`);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `No se pudieron consultar los viajes (HTTP ${response.status}).`);

    const viajes = Array.isArray(payload.viajes) ? payload.viajes : [];
    const cancelables = viajes.filter((viaje) => ['SOLICITADO', 'CONDUCTOR_EN_CAMINO'].includes(viaje.estado));
    tripSelect.replaceChildren(new Option('Selecciona un viaje', ''));
    for (const viaje of cancelables) {
      const option = new Option(`${viaje.origen || 'Origen'} → ${viaje.destino || 'Destino'} · ${viaje.estado}`, String(viaje.id));
      tripSelect.add(option);
    }

    if (cancelables.length === 0) {
      showLookupStatus('No se encontraron viajes que puedan cancelarse para esta cuenta.');
      return;
    }

    tripPicker.hidden = false;
    if (cancelables.length === 1) {
      tripSelect.value = String(cancelables[0].id);
      form.querySelector('#review-button').disabled = false;
      showLookupStatus('Se encontró un viaje cancelable y quedó seleccionado.');
    } else {
      showLookupStatus(`Se encontraron ${cancelables.length} viajes cancelables. Selecciona el que deseas cancelar.`);
    }
    localStorage.setItem(actorStorageKey, normalizedIdentity);
  } catch (error) {
    showLookupStatus(error instanceof Error ? error.message : 'No se pudieron consultar los viajes.', 'error');
  } finally {
    lookupButton.disabled = false;
    lookupButton.textContent = 'Buscar viajes';
  }
}

identityForm.addEventListener('submit', (event) => {
  event.preventDefault();
  void loadTrips(identityInput.value);
});

tripSelect.addEventListener('change', () => {
  form.querySelector('#review-button').disabled = !tripSelect.value;
});

function clearNotice() {
  notice.hidden = true;
  notice.textContent = '';
}

reasonInput.addEventListener('input', () => {
  reasonCount.textContent = `${reasonInput.value.length} / 240`;
});

form.addEventListener('submit', (event) => {
  event.preventDefault();
  clearNotice();
  if (!form.reportValidity()) return;

  pendingCancellation = {
    viajeId: tripSelect.value,
    motivo: reasonInput.value.trim(),
  };
  if (!pendingCancellation.viajeId || !pendingCancellation.motivo) {
    showNotice('Selecciona un viaje cancelable e indica el motivo para continuar.');
    return;
  }

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
    const endpoint = actor === 'cliente'
      ? 'cancelacion-cliente'
      : 'cancelacion-conductor';
    const response = await fetch(
      `/api/viajes/${encodeURIComponent(pendingCancellation.viajeId)}/${endpoint}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ motivo: pendingCancellation.motivo }),
      },
    );
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `No se pudo cancelar el viaje (HTTP ${response.status}).`);

    const viaje = payload.viaje;
    if (!viaje || String(viaje.id) !== pendingCancellation.viajeId || viaje.estado !== 'CANCELADO') {
      throw new Error('La API respondió, pero no confirmó el estado cancelado del viaje.');
    }

    dialog.close();
    identityForm.hidden = true;
    tripPicker.hidden = true;
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
    description.textContent = actor === 'cliente'
      ? 'La solicitud del cliente fue registrada y el evento de cancelación publicado.'
      : 'La solicitud del conductor fue registrada y el despacho fue notificado.';
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

const initialIdentity = new URLSearchParams(window.location.search).get(actorIdName)
  || localStorage.getItem(actorStorageKey)
  || '';
if (initialIdentity) {
  identityInput.value = initialIdentity;
  void loadTrips(initialIdentity);
}