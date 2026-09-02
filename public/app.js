const form = document.querySelector('#reserva-form');
const formTitle = document.querySelector('#form-title');
const clienteInput = document.querySelector('#cliente-id');
const origenInput = document.querySelector('#origen');
const destinoInput = document.querySelector('#destino');
const fechaInput = document.querySelector('#fecha-hora');
const submitButton = document.querySelector('#submit-button');
const cancelEditButton = document.querySelector('#cancel-edit-button');
const filter = document.querySelector('#estado-filter');
const refreshButton = document.querySelector('#refresh-button');
const tableFrame = document.querySelector('#table-frame');
const tableBody = document.querySelector('#reservas-body');
const emptyState = document.querySelector('#empty-state');
const toast = document.querySelector('#toast');
const toastMessage = document.querySelector('#toast-message');
const toastClose = document.querySelector('#toast-close');
const menuButton = document.querySelector('#menu-button');
const headerNav = document.querySelector('#header-nav');

let reservas = [];
let editingId = null;
let toastTimer = null;

const localDateTimeValue = (value) => {
  const date = new Date(value);
  const offsetDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return offsetDate.toISOString().slice(0, 16);
};

const setMinimumDate = () => {
  fechaInput.min = localDateTimeValue(Date.now() + 60_000);
};

const showToast = (message, type = 'success') => {
  window.clearTimeout(toastTimer);
  toastMessage.textContent = message;
  toast.classList.toggle('is-error', type === 'error');
  toast.querySelector('.toast-icon').textContent = type === 'error' ? '!' : '✓';
  toast.hidden = false;
  toastTimer = window.setTimeout(() => {
    toast.hidden = true;
  }, 6_000);
};

const parseError = async (response) => {
  try {
    const body = await response.json();
    return body?.error?.mensaje ?? `La operación falló con HTTP ${response.status}.`;
  } catch {
    return `La operación falló con HTTP ${response.status}.`;
  }
};

const requestJson = async (url, options) => {
  const response = await fetch(url, options);
  if (!response.ok) throw new Error(await parseError(response));
  return response.json();
};

const formatDate = (value) =>
  new Intl.DateTimeFormat('es-AR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value));

const formatFare = (reserva) => {
  if (reserva.tarifaEstimada === null) return 'Pendiente';
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: reserva.moneda ?? 'ARS',
    maximumFractionDigits: 2,
  }).format(reserva.tarifaEstimada);
};

const createCell = (label, content, className = '') => {
  const cell = document.createElement('td');
  cell.dataset.label = label;
  if (className) cell.className = className;
  if (typeof content === 'string') cell.textContent = content;
  else cell.append(content);
  return cell;
};

const createActionButton = (label, className, onClick) => {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `action-button ${className}`.trim();
  button.textContent = label;
  button.addEventListener('click', onClick);
  return button;
};

const beginEdit = (reserva) => {
  editingId = reserva.id;
  formTitle.textContent = 'Editar reserva';
  clienteInput.value = reserva.clienteId;
  clienteInput.disabled = true;
  origenInput.value = reserva.origen;
  destinoInput.value = reserva.destino;
  fechaInput.value = localDateTimeValue(reserva.fechaHoraProgramada);
  form.elements.vehiculo.value = reserva.vehiculo;
  submitButton.textContent = 'Guardar cambios';
  cancelEditButton.hidden = false;
  form.scrollIntoView({ behavior: 'smooth', block: 'start' });
};

const resetForm = () => {
  editingId = null;
  form.reset();
  form.elements.vehiculo.value = 'AUTO';
  formTitle.textContent = 'Nueva reserva';
  clienteInput.disabled = false;
  submitButton.textContent = 'Programar reserva';
  cancelEditButton.hidden = true;
  setMinimumDate();
};

const cancelReservation = async (reserva) => {
  const confirmed = window.confirm(
    `¿Cancelar la reserva de ${reserva.origen} a ${reserva.destino}?`,
  );
  if (!confirmed) return;

  try {
    await requestJson(`/reservas/${reserva.id}`, { method: 'DELETE' });
    showToast('La reserva fue cancelada correctamente.');
    if (editingId === reserva.id) resetForm();
    await loadReservations();
  } catch (error) {
    showToast(error.message, 'error');
  }
};

const renderReservations = () => {
  const selectedState = filter.value;
  const filtered = reservas.filter(
    (reserva) => selectedState === 'TODOS' || reserva.estado === selectedState,
  );
  tableBody.replaceChildren();

  filtered.forEach((reserva) => {
    const row = document.createElement('tr');
    const trip = document.createElement('div');
    const tripTitle = document.createElement('span');
    const tripId = document.createElement('span');
    tripTitle.className = 'trip-title';
    tripTitle.textContent = `${reserva.origen} → ${reserva.destino}`;
    tripId.className = 'trip-id';
    tripId.textContent = reserva.id;
    trip.append(tripTitle, tripId);

    const status = document.createElement('span');
    status.className = `status status-${reserva.estado.toLowerCase()}`;
    status.textContent = reserva.estado;

    const actions = document.createElement('div');
    if (reserva.estado === 'PROGRAMADA') {
      actions.append(
        createActionButton('Editar', '', () => beginEdit(reserva)),
        createActionButton('Cancelar', 'danger', () => void cancelReservation(reserva)),
      );
    } else {
      const placeholder = document.createElement('span');
      placeholder.className = 'action-placeholder';
      placeholder.textContent = '—';
      actions.append(placeholder);
    }

    row.append(
      createCell('Viaje', trip),
      createCell('Fecha', formatDate(reserva.fechaHoraProgramada), 'date-cell'),
      createCell('Vehículo', reserva.vehiculo === 'AUTO' ? 'Auto' : 'Moto'),
      createCell('Estado', status),
      createCell('Tarifa', formatFare(reserva)),
      createCell('Acciones', actions, 'action-cell'),
    );
    tableBody.append(row);
  });

  tableFrame.hidden = filtered.length === 0;
  emptyState.hidden = filtered.length > 0;
};

async function loadReservations() {
  refreshButton.disabled = true;
  try {
    const response = await requestJson('/reservas');
    reservas = response.reservas;
    renderReservations();
  } catch (error) {
    reservas = [];
    renderReservations();
    showToast(error.message, 'error');
  } finally {
    refreshButton.disabled = false;
  }
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  submitButton.disabled = true;

  const payload = {
    origen: origenInput.value.trim(),
    destino: destinoInput.value.trim(),
    vehiculo: form.elements.vehiculo.value,
    fechaHoraProgramada: new Date(fechaInput.value).toISOString(),
  };

  try {
    if (editingId === null) {
      const created = await requestJson('/reservas', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ clienteId: clienteInput.value.trim(), ...payload }),
      });
      showToast(
        `Reserva creada correctamente. El viaje ${created.id.slice(0, 8)} ha sido programado.`,
      );
    } else {
      await requestJson(`/reservas/${editingId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      showToast('La reserva fue actualizada correctamente.');
    }

    resetForm();
    await loadReservations();
  } catch (error) {
    showToast(error.message, 'error');
  } finally {
    submitButton.disabled = false;
  }
});

cancelEditButton.addEventListener('click', resetForm);
filter.addEventListener('change', renderReservations);
refreshButton.addEventListener('click', () => void loadReservations());
toastClose.addEventListener('click', () => {
  toast.hidden = true;
});
menuButton.addEventListener('click', () => {
  const open = menuButton.getAttribute('aria-expanded') === 'true';
  menuButton.setAttribute('aria-expanded', String(!open));
  headerNav.classList.toggle('is-open', !open);
});

setMinimumDate();
void loadReservations();
