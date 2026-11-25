/* global L */
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
const pickOriginButton = $('#pick-origin-button');
const pickDestButton = $('#pick-dest-button');
const mapToggleOrigin = $('#map-toggle-origin');
const mapToggleDest = $('#map-toggle-dest');
const mapCenterButton = $('#map-center-button');
const mapHint = $('#map-hint');
const mapRouteLabel = $('#map-route-label');
const routeSummary = $('#route-summary');
const routeDistanceEl = $('#route-distance');
const routeDurationEl = $('#route-duration');
const routeCaptionEl = $('#route-caption');
const originSuggestions = $('#origin-suggestions');
const destSuggestions = $('#dest-suggestions');

const statusLabels = {
  PROGRAMADA: 'Programada',
  ACTIVANDO: 'Activando',
  ACTIVADA: 'Activada',
  CANCELADA: 'Cancelada',
  FALLIDA: 'Fallida',
};
const pageSize = 20;
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org';
const CORRIENTES_VIEWBOX = '-58.95,-27.38,-58.68,-27.56';
const DEFAULT_ORIGIN = { lat: -27.4692, lng: -58.8306 };
const DEFAULT_DEST = { lat: -27.4648, lng: -58.8425 };

let sessionToken = '';
let sessionClientId = '';
let sessionVersion = 0;
let reservas = [];
let editingId = null;
let page = 1;
let loading = false;
let loadVersion = 0;
let toastTimer;

let map = null;
let originMarker = null;
let destMarker = null;
let routeLine = null;
let routeGlowLine = null;
let mapClickMode = 'origin';
let originCoords = { ...DEFAULT_ORIGIN };
let destCoords = { ...DEFAULT_DEST };
let hasOriginPoint = false;
let hasDestPoint = false;
let geocodeTimers = { origin: null, dest: null };
let routeRequestId = 0;

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

const haversineKm = (a, b) => {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
};

const formatNominatimAddress = (place) => {
  const a = place?.address ?? {};
  const street = a.road || a.pedestrian || a.footway || a.suburb || a.neighbourhood || '';
  const house = a.house_number ? ` ${a.house_number}` : '';
  const city = a.city || a.town || a.village || '';
  const state = a.state && a.state !== city ? a.state : '';
  const parts = [street + house, city, state].filter(Boolean);
  if (parts.length > 0) return parts.join(', ');
  if (typeof place?.display_name === 'string') {
    return place.display_name.split(',').slice(0, 3).join(',').trim();
  }
  return '';
};

const setMapClickMode = (mode) => {
  mapClickMode = mode;
  const isOrigin = mode === 'origin';
  pickOriginButton.classList.toggle('active', isOrigin);
  pickOriginButton.setAttribute('aria-pressed', String(isOrigin));
  pickDestButton.classList.toggle('active', !isOrigin);
  pickDestButton.setAttribute('aria-pressed', String(!isOrigin));
  mapToggleOrigin.classList.toggle('active', isOrigin);
  mapToggleDest.classList.toggle('active', !isOrigin);
  mapHint.textContent = isOrigin
    ? 'Hacé clic en el mapa para marcar el origen'
    : 'Hacé clic en el mapa para marcar el destino';
};

const hideSuggestions = (type) => {
  const box = type === 'origin' ? originSuggestions : destSuggestions;
  box.style.display = 'none';
};

const updateMapRouteLabel = () => {
  const from = origenInput.value.trim().split(',')[0];
  const to = destinoInput.value.trim().split(',')[0];
  if (from && to) {
    mapRouteLabel.textContent = `${from} → ${to}`;
  } else {
    mapRouteLabel.textContent = 'Hacé clic en el mapa o arrastrá los marcadores';
  }
};

const centerMapOnRoute = () => {
  if (!map || typeof L === 'undefined') return;
  const bounds = L.latLngBounds([
    [originCoords.lat, originCoords.lng],
    [destCoords.lat, destCoords.lng],
  ]);
  map.fitBounds(bounds, { padding: [46, 46], maxZoom: 15 });
};

const updateRouteOnMap = async (shouldCenter = false) => {
  updateMapRouteLabel();
  if (!map || typeof L === 'undefined') return;

  originMarker.setLatLng([originCoords.lat, originCoords.lng]);
  destMarker.setLatLng([destCoords.lat, destCoords.lng]);

  if (routeLine) map.removeLayer(routeLine);
  if (routeGlowLine) map.removeLayer(routeGlowLine);

  const straightDist = haversineKm(originCoords, destCoords);
  const straightMin = Math.max(2, Math.round((straightDist / 25) * 60));

  routeLine = L.polyline(
    [
      [originCoords.lat, originCoords.lng],
      [destCoords.lat, destCoords.lng],
    ],
    { color: '#d5ff40', weight: 3.5, dashArray: '8 8', opacity: 0.85 },
  ).addTo(map);

  if (hasOriginPoint || hasDestPoint) {
    routeSummary.hidden = false;
    routeDistanceEl.textContent = `${straightDist.toFixed(1)} km`;
    routeDurationEl.textContent = `~${straightMin} min`;
    routeCaptionEl.textContent = 'Calculando ruta por calles…';
  }

  if (shouldCenter) centerMapOnRoute();

  const currentRequest = ++routeRequestId;
  try {
    const path = `${originCoords.lng},${originCoords.lat};${destCoords.lng},${destCoords.lat}`;
    const response = await fetch(
      `https://router.project-osrm.org/route/v1/driving/${path}?overview=full&geometries=geojson`,
      { signal: AbortSignal.timeout(8000) },
    );
    const data = await response.json();
    if (currentRequest !== routeRequestId) return;
    const route = data?.code === 'Ok' ? data.routes?.[0] : null;
    if (!route?.geometry?.coordinates?.length) {
      if (hasOriginPoint || hasDestPoint) {
        routeCaptionEl.textContent = 'Distancia en línea recta (sin ruta por calles disponible).';
      }
      return;
    }
    const latLngs = route.geometry.coordinates.map(([lng, lat]) => [lat, lng]);
    if (routeLine) map.removeLayer(routeLine);
    if (routeGlowLine) map.removeLayer(routeGlowLine);
    routeGlowLine = L.polyline(latLngs, {
      color: '#d5ff40',
      weight: 9,
      opacity: 0.22,
      lineCap: 'round',
      lineJoin: 'round',
    }).addTo(map);
    routeLine = L.polyline(latLngs, {
      color: '#d5ff40',
      weight: 4,
      opacity: 0.95,
      lineCap: 'round',
      lineJoin: 'round',
    }).addTo(map);

    const km = route.distance / 1000;
    const min = Math.max(2, Math.round(route.duration / 60));
    if (hasOriginPoint || hasDestPoint) {
      routeSummary.hidden = false;
      routeDistanceEl.textContent = `${km.toFixed(1)} km`;
      routeDurationEl.textContent = `~${min} min`;
      routeCaptionEl.textContent = 'Recorrido estimado por calles (OSRM).';
    }
    if (shouldCenter) {
      map.fitBounds(routeLine.getBounds(), { padding: [46, 46], maxZoom: 15 });
    }
  } catch {
    if (currentRequest === routeRequestId && (hasOriginPoint || hasDestPoint)) {
      routeCaptionEl.textContent = 'Distancia en línea recta (sin ruta por calles disponible).';
    }
  }
};

const reverseGeocode = async (type, lat, lng) => {
  const input = type === 'origin' ? origenInput : destinoInput;
  const fallback = `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
  input.value = 'Buscando dirección…';
  try {
    const params = new URLSearchParams({
      format: 'json',
      lat: String(lat),
      lon: String(lng),
      addressdetails: '1',
    });
    const response = await fetch(`${NOMINATIM_URL}/reverse?${params}`, {
      headers: { 'Accept-Language': 'es' },
      signal: AbortSignal.timeout(8000),
    });
    const data = await response.json();
    const address = !data?.error ? formatNominatimAddress(data) : '';
    input.value = address || fallback;
  } catch {
    input.value = fallback;
  }
  updateMapRouteLabel();
};

const selectGeocodedPlace = (type, place) => {
  const lat = Number(Number(place.lat).toFixed(5));
  const lng = Number(Number(place.lon).toFixed(5));
  const address = formatNominatimAddress(place) || place.display_name;
  if (type === 'origin') {
    originCoords = { lat, lng };
    hasOriginPoint = true;
    origenInput.value = address;
    setMapClickMode('dest');
  } else {
    destCoords = { lat, lng };
    hasDestPoint = true;
    destinoInput.value = address;
  }
  hideSuggestions(type);
  void updateRouteOnMap(true);
};

const searchAddress = async (type, query, autoSelectFirst = false) => {
  const box = type === 'origin' ? originSuggestions : destSuggestions;
  const trimmed = query.trim();
  if (trimmed.length < 3) {
    hideSuggestions(type);
    return;
  }
  try {
    const params = new URLSearchParams({
      format: 'json',
      q: trimmed,
      limit: '5',
      addressdetails: '1',
      countrycodes: 'ar',
      viewbox: CORRIENTES_VIEWBOX,
    });
    const response = await fetch(`${NOMINATIM_URL}/search?${params}`, {
      headers: { 'Accept-Language': 'es' },
      signal: AbortSignal.timeout(8000),
    });
    const results = await response.json();
    if (!Array.isArray(results) || results.length === 0) {
      box.replaceChildren();
      const empty = document.createElement('div');
      empty.className = 'autocomplete-item';
      empty.textContent = 'Sin resultados. Probá agregar la ciudad (ej. Corrientes).';
      box.append(empty);
      box.style.display = 'block';
      return;
    }
    if (autoSelectFirst) {
      selectGeocodedPlace(type, results[0]);
      return;
    }
    box.replaceChildren();
    for (const item of results) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'autocomplete-item';
      const title = document.createElement('strong');
      title.textContent = formatNominatimAddress(item) || item.display_name;
      const detailText = document.createElement('span');
      detailText.textContent = item.display_name;
      btn.append(title, detailText);
      btn.addEventListener('click', () => selectGeocodedPlace(type, item));
      box.append(btn);
    }
    box.style.display = 'block';
  } catch {
    hideSuggestions(type);
  }
};

const initMap = () => {
  const container = $('#reservation-map');
  if (!container) return;
  if (typeof L === 'undefined') {
    container.innerHTML =
      '<div class="map-offline">Mapa no disponible sin conexión. Podés escribir el origen y el destino manualmente.</div>';
    mapHint.hidden = true;
    return;
  }

  map = L.map('reservation-map', { zoomControl: false }).setView(
    [DEFAULT_ORIGIN.lat, DEFAULT_ORIGIN.lng],
    14,
  );
  L.control.zoom({ position: 'bottomright' }).addTo(map);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 19,
  }).addTo(map);

  const originIcon = L.divIcon({
    className: 'custom-pin-origin',
    iconSize: [15, 15],
    iconAnchor: [7.5, 7.5],
  });
  const destIcon = L.divIcon({
    className: 'custom-pin-dest',
    iconSize: [15, 15],
    iconAnchor: [7.5, 7.5],
  });

  originMarker = L.marker([originCoords.lat, originCoords.lng], {
    icon: originIcon,
    draggable: true,
  })
    .bindTooltip('Origen', { permanent: true, direction: 'top', offset: [0, -10] })
    .addTo(map);

  destMarker = L.marker([destCoords.lat, destCoords.lng], {
    icon: destIcon,
    draggable: true,
  })
    .bindTooltip('Destino', { permanent: true, direction: 'top', offset: [0, -10] })
    .addTo(map);

  originMarker.on('dragend', () => {
    const pos = originMarker.getLatLng();
    originCoords = { lat: Number(pos.lat.toFixed(5)), lng: Number(pos.lng.toFixed(5)) };
    hasOriginPoint = true;
    void reverseGeocode('origin', originCoords.lat, originCoords.lng);
    void updateRouteOnMap(false);
  });

  destMarker.on('dragend', () => {
    const pos = destMarker.getLatLng();
    destCoords = { lat: Number(pos.lat.toFixed(5)), lng: Number(pos.lng.toFixed(5)) };
    hasDestPoint = true;
    void reverseGeocode('dest', destCoords.lat, destCoords.lng);
    void updateRouteOnMap(false);
  });

  map.on('click', (event) => {
    const lat = Number(event.latlng.lat.toFixed(5));
    const lng = Number(event.latlng.lng.toFixed(5));
    if (mapClickMode === 'origin') {
      originCoords = { lat, lng };
      hasOriginPoint = true;
      void reverseGeocode('origin', lat, lng);
      setMapClickMode('dest');
    } else {
      destCoords = { lat, lng };
      hasDestPoint = true;
      void reverseGeocode('dest', lat, lng);
    }
    void updateRouteOnMap(false);
  });

  void updateRouteOnMap(true);
};

const resetForm = () => {
  editingId = null;
  form.reset();
  formTitle.textContent = 'Nueva reserva';
  submitButton.textContent = 'Programar reserva';
  cancelEditButton.hidden = true;
  hasOriginPoint = false;
  hasDestPoint = false;
  originCoords = { ...DEFAULT_ORIGIN };
  destCoords = { ...DEFAULT_DEST };
  routeSummary.hidden = true;
  hideSuggestions('origin');
  hideSuggestions('dest');
  setMapClickMode('origin');
  setMinimumDate();
  void updateRouteOnMap(true);
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
const geocodeQuietly = async (query) => {
  try {
    const params = new URLSearchParams({
      format: 'json',
      q: query,
      limit: '1',
      countrycodes: 'ar',
      viewbox: CORRIENTES_VIEWBOX,
    });
    const res = await fetch(`${NOMINATIM_URL}/search?${params}`, {
      headers: { 'Accept-Language': 'es' },
      signal: AbortSignal.timeout(6000),
    });
    const list = await res.json();
    if (Array.isArray(list) && list[0]) {
      return { lat: Number(Number(list[0].lat).toFixed(5)), lng: Number(Number(list[0].lon).toFixed(5)) };
    }
  } catch {
    // Best-effort map centering when editing.
  }
  return null;
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
  updateMapRouteLabel();
  void Promise.all([geocodeQuietly(reserva.origen), geocodeQuietly(reserva.destino)]).then(
    ([orig, dest]) => {
      if (editingId !== reserva.id) return;
      if (orig) {
        originCoords = orig;
        hasOriginPoint = true;
      }
      if (dest) {
        destCoords = dest;
        hasDestPoint = true;
      }
      if (orig || dest) void updateRouteOnMap(true);
    },
  );
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

pickOriginButton.addEventListener('click', () => setMapClickMode('origin'));
pickDestButton.addEventListener('click', () => setMapClickMode('dest'));
mapToggleOrigin.addEventListener('click', () => setMapClickMode('origin'));
mapToggleDest.addEventListener('click', () => setMapClickMode('dest'));
mapCenterButton.addEventListener('click', centerMapOnRoute);

$('#search-origin-button').addEventListener('click', () => {
  void searchAddress('origin', origenInput.value, true);
});
$('#search-dest-button').addEventListener('click', () => {
  void searchAddress('dest', destinoInput.value, true);
});

origenInput.addEventListener('input', () => {
  updateMapRouteLabel();
  window.clearTimeout(geocodeTimers.origin);
  geocodeTimers.origin = window.setTimeout(() => void searchAddress('origin', origenInput.value), 550);
});
destinoInput.addEventListener('input', () => {
  updateMapRouteLabel();
  window.clearTimeout(geocodeTimers.dest);
  geocodeTimers.dest = window.setTimeout(() => void searchAddress('dest', destinoInput.value), 550);
});
origenInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    window.clearTimeout(geocodeTimers.origin);
    void searchAddress('origin', origenInput.value, true);
  }
});
destinoInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    window.clearTimeout(geocodeTimers.dest);
    void searchAddress('dest', destinoInput.value, true);
  }
});
document.addEventListener('click', (event) => {
  if (!event.target.closest('.location-field')) {
    hideSuggestions('origin');
    hideSuggestions('dest');
  }
});

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
initMap();
