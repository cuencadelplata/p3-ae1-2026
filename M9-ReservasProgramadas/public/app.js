const $ = (selector) => document.querySelector(selector);
const form = $('#reserva-form');
const fields = $('#reservation-fields');
const formTitle = $('#form-title');
const origenInput = $('#origen');
const destinoInput = $('#destino');
const fechaInput = $('#fecha-hora');
const submitButton = $('#submit-button');
const cancelEditButton = $('#cancel-edit-button');
const filter = $('#estado-filter');
const refreshButton = $('#refresh-button');
const tableBody = $('#reservas-body');
const detail = $('#reservation-detail');
const toast = $('#toast');
const statusLabels = {
  PROGRAMADA: 'Programada',
  ACTIVANDO: 'Activando',
  ACTIVADA: 'Activada',
  CANCELADA: 'Cancelada',
  FALLIDA: 'Fallida',
};
const pageSize = 20;
let sessionToken = '';
let sessionClientId = '';
let sessionVersion = 0;
let reservas = [];
let editingId = null;
let page = 1;
let loading = false;
let loadVersion = 0;
let toastTimer;

const localDateTimeValue = (value) => {
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
const setMinimumDate = () => {
  fechaInput.min = localDateTimeValue(Date.now() + 60000);
};
const formatDate = (value) =>
  new Intl.DateTimeFormat('es-AR', { dateStyle: 'short', timeStyle: 'short' }).format(
    new Date(value),
  );
const formatFare = (reserva) => {
  if (reserva.tarifaEstimada === null || reserva.tarifaEstimada === undefined)
    return 'Por confirmar';
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: reserva.moneda ?? 'ARS',
  }).format(reserva.tarifaEstimada);
};
const showToast = (message, type = 'success') => {
  window.clearTimeout(toastTimer);
  $('#toast-message').textContent = message;
  toast.classList.toggle('is-error', type === 'error');
  toast.querySelector('.toast-icon').textContent = type === 'error' ? '!' : '✓';
  toast.hidden = false;
  toastTimer = window.setTimeout(() => {
    toast.hidden = true;
  }, 7000);
};
const resetForm = () => {
  editingId = null;
  form.reset();
  formTitle.textContent = 'Nueva reserva';
  submitButton.textContent = 'Programar reserva';
  cancelEditButton.hidden = true;
  setMinimumDate();
};
const updateSession = () => {
  const connected = !!sessionClientId;
  fields.disabled = !connected;
  $('#session-form').hidden = connected;
  $('#disconnect-session').hidden = !connected;
  $('#session-title').textContent = connected ? 'Sesión conectada' : 'Conectá tu sesión';
  $('#session-description').textContent = connected
    ? `Cliente ${sessionClientId} · Solo se muestran tus reservas.`
    : 'Usá el token de tu sesión de cliente para ver tus reservas.';
  $('#session-status').textContent = connected ? 'Sesión activa' : 'Sin sesión';
  $('#session-status').classList.toggle('connected', connected);
  refreshButton.disabled = !connected || loading;
};
const clearSession = () => {
  sessionVersion++;
  loadVersion++;
  sessionToken = '';
  sessionClientId = '';
  reservas = [];
  page = 1;
  loading = false;
  filter.value = 'TODOS';
  $('#session-token').value = '';
  $('#detail-content').replaceChildren();
  if (detail.open) detail.close();
  $('#list-error').hidden = true;
  resetForm();
  updateSession();
  renderReservations();
};
const requestJson = async (url, options = {}) => {
  const version = sessionVersion;
  const response = await fetch(url, {
    ...options,
    headers: { ...options.headers, Authorization: `Bearer ${sessionToken}` },
    signal: AbortSignal.timeout(15000),
  });
  const body = await response.json().catch(() => null);
  if (version !== sessionVersion) throw new Error('La sesión cambió. Repetí la operación.');
  if (!response.ok) {
    if (response.status === 401) {
      clearSession();
      showToast('Tu sesión venció o no es válida. Conectá una sesión de cliente.', 'error');
    }
    throw new Error(
      body?.error?.mensaje ?? `No se pudo completar la operación (HTTP ${response.status}).`,
    );
  }
  if (body === null) throw new Error('El servicio devolvió una respuesta inválida.');
  return body;
};
const createCell = (label, content, className = '') => {
  const cell = document.createElement('td');
  cell.dataset.label = label;
  cell.className = className;
  if (typeof content === 'string') cell.textContent = content;
  else cell.append(content);
  return cell;
};
const createActionButton = (label, className, onClick) => {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `action-button ${className}`.trim();
  button.textContent = label;
  button.addEventListener('click', async () => {
    button.disabled = true;
    try {
      await onClick();
    } catch (error) {
      showToast(error.message, 'error');
    } finally {
      button.disabled = false;
    }
  });
  return button;
};
const beginEdit = (reserva) => {
  editingId = reserva.id;
  formTitle.textContent = 'Editar reserva';
  origenInput.value = reserva.origen;
  destinoInput.value = reserva.destino;
  fechaInput.value = localDateTimeValue(reserva.fechaHoraProgramada);
  form.elements.vehiculo.value = reserva.vehiculo;
  submitButton.textContent = 'Guardar cambios';
  cancelEditButton.hidden = false;
  form.scrollIntoView({
    behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
    block: 'start',
  });
  origenInput.focus({ preventScroll: true });
};
const showDetail = async (id) => {
  const reserva = await requestJson(`/reservas/${encodeURIComponent(id)}`);
  const content = $('#detail-content');
  content.replaceChildren();
  const entries = [
    ['Origen', reserva.origen],
    ['Destino', reserva.destino],
    ['Salida', formatDate(reserva.fechaHoraProgramada)],
    ['Vehículo', reserva.vehiculo === 'AUTO' ? 'Auto' : 'Moto'],
    ['Estado', statusLabels[reserva.estado] ?? reserva.estado],
    ['Tarifa estimada', formatFare(reserva)],
    ['Conductor', reserva.assignedDriverId ?? 'Todavía sin asignar'],
    ['Solicitud de viaje', reserva.idSolicitud ?? 'Todavía no se inició el despacho'],
    ['Identificador de reserva', reserva.id],
  ];
  for (const [label, value] of entries) {
    const term = document.createElement('dt');
    const description = document.createElement('dd');
    term.textContent = label;
    description.textContent = value;
    content.append(term, description);
  }
  if (!detail.open) detail.showModal();
};
const cancelReservation = async (reserva) => {
  if (!window.confirm(`¿Cancelar la reserva de ${reserva.origen} a ${reserva.destino}?`)) return;
  await requestJson(`/reservas/${encodeURIComponent(reserva.id)}`, { method: 'DELETE' });
  showToast('Reserva cancelada. Se conserva en tu historial.');
  if (editingId === reserva.id) resetForm();
  await loadReservations();
};
function renderReservations() {
  const filtered = reservas.filter(
    (reserva) => filter.value === 'TODOS' || reserva.estado === filter.value,
  );
  tableBody.replaceChildren();
  for (const reserva of filtered) {
    const row = document.createElement('tr');
    const trip = document.createElement('div');
    const title = document.createElement('span');
    const meta = document.createElement('span');
    title.className = 'trip-title';
    title.textContent = `${reserva.origen} → ${reserva.destino}`;
    meta.className = 'trip-meta';
    meta.textContent = `${reserva.vehiculo === 'AUTO' ? 'Auto' : 'Moto'} · ${reserva.assignedDriverId ? 'Conductor asignado' : 'Conductor por asignar'}`;
    trip.append(title, meta);
    const status = document.createElement('span');
    status.className = `status status-${Object.hasOwn(statusLabels, reserva.estado) ? reserva.estado.toLowerCase() : 'cancelada'}`;
    status.textContent = statusLabels[reserva.estado] ?? reserva.estado;
    const actions = document.createElement('div');
    actions.append(createActionButton('Detalle', '', () => showDetail(reserva.id)));
    if (reserva.estado === 'PROGRAMADA')
      actions.append(createActionButton('Editar', '', () => beginEdit(reserva)));
    if (reserva.estado === 'PROGRAMADA' || (reserva.estado === 'ACTIVANDO' && reserva.idSolicitud))
      actions.append(createActionButton('Cancelar', 'danger', () => cancelReservation(reserva)));
    row.append(
      createCell('Recorrido', trip),
      createCell('Salida', formatDate(reserva.fechaHoraProgramada), 'date-cell'),
      createCell('Estado', status),
      createCell('Tarifa estimada', formatFare(reserva)),
      createCell('Acciones', actions, 'action-cell'),
    );
    tableBody.append(row);
  }
  $('#table-frame').hidden = filtered.length === 0;
  $('#empty-state').hidden = filtered.length > 0;
  $('#empty-title').textContent = loading
    ? 'Cargando tus reservas…'
    : !sessionClientId
      ? 'Tu próximo viaje empieza acá'
      : filter.value !== 'TODOS'
        ? 'Sin coincidencias en esta página'
        : 'No hay reservas en esta página';
  $('#empty-description').textContent = !sessionClientId
    ? 'Conectá tu sesión para consultar o programar una reserva.'
    : filter.value !== 'TODOS'
      ? 'Elegí otro estado o cambiá de página para seguir buscando.'
      : page > 1
        ? 'Volvé a la página anterior para consultar tus reservas.'
        : 'Completá el formulario para programar tu primer viaje.';
  $('#result-count').textContent =
    `${filtered.length} ${filtered.length === 1 ? 'reserva' : 'reservas'}`;
  $('#list-description').textContent = loading
    ? 'Actualizando reservas…'
    : !sessionClientId
      ? 'Conectá tu sesión para comenzar.'
      : `Página ${page} · El filtro se aplica a las reservas de esta página.`;
  $('#pagination').hidden = !sessionClientId || (page === 1 && reservas.length < pageSize);
  $('#page-label').textContent = `Página ${page}`;
  $('#previous-page').disabled = loading || page === 1;
  $('#next-page').disabled = loading || reservas.length < pageSize;
}
async function loadReservations(targetPage = page) {
  if (!sessionClientId) return;
  const currentLoad = ++loadVersion;
  loading = true;
  refreshButton.disabled = true;
  $('#list-error').hidden = true;
  renderReservations();
  try {
    const response = await requestJson(`/reservas?page=${targetPage}&pageSize=${pageSize}`);
    if (currentLoad !== loadVersion) return;
    if (!Array.isArray(response.reservas))
      throw new Error('El servicio no devolvió un listado válido.');
    reservas = response.reservas;
    page = targetPage;
  } catch (error) {
    if (currentLoad !== loadVersion) return;
    $('#list-error').textContent = `No se pudo actualizar el listado. ${error.message}`;
    $('#list-error').hidden = false;
  } finally {
    if (currentLoad === loadVersion) {
      loading = false;
      updateSession();
      renderReservations();
    }
  }
}
$('#session-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const candidate = $('#session-token')
    .value.trim()
    .replace(/^Bearer\s+/i, '');
  if (!candidate) return;
  clearSession();
  const version = sessionVersion;
  sessionToken = candidate;
  $('#connect-session').disabled = true;
  try {
    const session = await requestJson('/session');
    if (version !== sessionVersion) return;
    if (typeof session.clienteId !== 'string' || !session.clienteId)
      throw new Error('La sesión no identifica a un cliente.');
    sessionClientId = session.clienteId;
    updateSession();
    await loadReservations(1);
  } catch (error) {
    if (version === sessionVersion) clearSession();
    showToast(error.message, 'error');
  } finally {
    $('#connect-session').disabled = false;
  }
});
form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!sessionClientId || !form.reportValidity()) return;
  const version = sessionVersion;
  submitButton.disabled = true;
  cancelEditButton.disabled = true;
  try {
    const fecha = new Date(fechaInput.value);
    if (!Number.isFinite(fecha.getTime()) || fecha.getTime() <= Date.now())
      throw new Error('Indicá una fecha y hora futuras.');
    const payload = {
      origen: origenInput.value.trim(),
      destino: destinoInput.value.trim(),
      vehiculo: form.elements.vehiculo.value,
      fechaHoraProgramada: fecha.toISOString(),
    };
    if (!payload.origen || !payload.destino) throw new Error('Completá el origen y el destino.');
    const editing = editingId !== null;
    await requestJson(editing ? `/reservas/${encodeURIComponent(editingId)}` : '/reservas', {
      method: editing ? 'PATCH' : 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (version !== sessionVersion) return;
    showToast(
      editing
        ? 'Reserva actualizada correctamente.'
        : 'Reserva programada. Podés consultar su estado en Mis reservas.',
    );
    resetForm();
    await loadReservations();
  } catch (error) {
    showToast(error.message, 'error');
  } finally {
    submitButton.disabled = false;
    cancelEditButton.disabled = false;
  }
});
$('#disconnect-session').addEventListener('click', clearSession);
cancelEditButton.addEventListener('click', resetForm);
filter.addEventListener('change', renderReservations);
refreshButton.addEventListener('click', () => void loadReservations());
$('#previous-page').addEventListener('click', () => void loadReservations(page - 1));
$('#next-page').addEventListener('click', () => void loadReservations(page + 1));
$('#close-detail').addEventListener('click', () => detail.close());
$('#toast-close').addEventListener('click', () => {
  toast.hidden = true;
});
fechaInput.addEventListener('focus', setMinimumDate);
setMinimumDate();
updateSession();
renderReservations();
