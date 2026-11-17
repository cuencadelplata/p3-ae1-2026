import { friendlyError } from './errors.js';

export function createM8Feature({ page, api, notify = () => {}, hasSession = () => true }) {
const state = { section: 'comprobantes', receipt: null, ticket: null, tickets: [], ticketsLoaded: false, tokens: [], tokensLoaded: false, pendingTicketKey: null };
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const date = (value) => value ? new Intl.DateTimeFormat('es-AR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '—';
const currency = (amount, code = 'ARS') => Number.isFinite(Number(amount)) ? new Intl.NumberFormat('es-AR', { style: 'currency', currency: code }).format(Number(amount)) : '—';
const field = (label, id, placeholder = '', extra = '') => `<label class="field"><span>${label}</span><input id="${id}" name="${id}" placeholder="${placeholder}" ${extra} /></label>`;
const label = (text, value, cls = '') => `<div class="detail-field ${cls}"><span>${text}</span><strong>${escapeHtml(value ?? '—')}</strong></div>`;
const badge = (text, cls = '') => `<span class="badge ${cls}">${escapeHtml(text)}</span>`;

function errorBox(error) { return `<div class="inline-alert" role="alert"><span>!</span>${escapeHtml(friendlyError(error))}</div>`; }
function loading(button, busy) { if (button) { button.disabled = busy; button.classList.toggle('loading', busy); } }
function pathId(value) { return encodeURIComponent(String(value).trim()); }

function intro(kicker, title, description) {
  return `<div class="page-heading"><div><span class="eyebrow">${kicker}</span><h1>${title}</h1><p>${description}</p></div></div>`;
}

function card(title, body, cls = '') { return `<section class="card ${cls}"><div class="card-header"><h2>${title}</h2></div>${body}</section>`; }

function receiptView() {
  const receipt = state.receipt;
  const data = receipt?.data || receipt;
  const trip = data?.trip || {};
  const fare = data?.fare || {};
  const payment = data?.payment || {};
  return `${intro('RF8.3 / RF8.4', 'Tus comprobantes.', 'Buscá el comprobante de un viaje, descargá el PDF o solicitá un reenvío.')}
    <div class="content-grid"><div class="primary-stack">
      ${card('Buscar por viaje', `<p class="card-copy">Ingresá el ID del viaje que figura en el historial de la aplicación.</p><form id="receipt-search" class="inline-form">${field('ID del viaje', 'receipt-trip', 'Ej. viaje-123', 'required')}<button class="button button-primary" type="submit">Buscar <span>→</span></button></form><div id="receipt-error"></div>`)}
      ${receipt ? card('Comprobante encontrado', `<div class="receipt-number">${escapeHtml(data?.receiptNumber || data?.receipt_number || 'Comprobante')}</div><div class="detail-grid">${label('Viaje', data?.tripId || data?.trip_id)}${label('Fecha de emisión', date(data?.issuedAt || data?.issued_at))}${label('Origen', trip.origin)}${label('Destino', trip.destination)}${label('Pago', payment.method)}${label('Total', currency(fare.total, fare.currency || 'ARS'))}</div><div class="card-actions"><button id="download-pdf" class="button button-primary">Descargar PDF ↓</button><button id="resend-receipt" class="button button-outline">Pedir reenvío ↗</button></div><div id="receipt-action-error"></div>`, 'result-card') : card('Listo cuando lo necesites', `<div class="empty-state"><div class="empty-icon">▤</div><h3>Tu comprobante aparece acá</h3><p>Al buscar un viaje con un pago autorizado, vas a ver sus datos y podrás descargar el PDF.</p></div>`, 'empty-card')}
    </div><aside class="aside-stack"><div class="hint-card lime"><span>01 / UN COMPROBANTE</span><h3>Una sola versión por viaje.</h3><p>Si repetís la consulta, M8 te muestra el mismo comprobante. El reenvío no genera un PDF nuevo.</p></div><div class="hint-card"><span>¿NO APARECE?</span><h3>Puede estar en proceso.</h3><p>La emisión requiere que el pago esté autorizado. Si todavía no está listo, volvé a consultar más tarde.</p></div></aside></div>`;
}

function supportView() {
  const ticket = state.ticket;
  return `${intro('RF8.5 / SOPORTE', 'Estamos para ayudarte.', 'Abrí una consulta vinculada a tu viaje y seguí cada cambio de estado.')}
    <div class="content-grid"><div class="primary-stack">
      ${card('Nueva consulta', `<form id="ticket-create" class="stack-form">${field('ID del viaje', 'ticket-trip', 'Ej. viaje-123', 'required')}<label class="field"><span>Contanos qué pasó</span><textarea id="ticket-reason" name="motivo" rows="4" placeholder="Describí tu consulta con el mayor detalle posible" required></textarea></label><div class="form-end"><small>Tu solicitud se vinculará con ese viaje.</small><button class="button button-primary" type="submit">Crear ticket <span>↗</span></button></div></form><div id="ticket-error"></div>`)}
      ${card('Consultas de un viaje', `<p class="card-copy">Ingresá el ID de un viaje para buscar sus tickets.</p><form id="ticket-filter" class="filter-row">${field('ID del viaje', 'ticket-filter-trip', 'Ej. viaje-123', 'required')}<label class="field"><span>Estado</span><select id="ticket-filter-status"><option value="">Todos</option><option>ABIERTO</option><option>EN_PROCESO</option><option>RESUELTO</option></select></label><button class="button button-outline" type="submit">Aplicar</button></form><div id="ticket-list">${ticketList()}</div><div id="ticket-list-error"></div>`)}
      ${ticket ? card(`Ticket ${escapeHtml(ticket.id?.slice(0, 8) || '')}`, `<div class="ticket-heading">${badge(ticket.estado || 'ABIERTO', ticket.estado === 'RESUELTO' ? 'badge-success' : '')}<span>Actualizado ${date(ticket.fechaActualizacion)}</span></div><h3 class="ticket-reason">${escapeHtml(ticket.motivo)}</h3><div class="detail-grid">${label('Viaje', ticket.tripId)}${label('Versión', ticket.version)}</div><div class="card-actions"><button id="ticket-history" class="button button-outline">Ver historial ↗</button></div><div id="history-content"></div>`, 'result-card') : ''}
    </div><aside class="aside-stack"><div class="hint-card lime"><span>SEGUIMIENTO CLARO</span><h3>Cada paso queda registrado.</h3><p>Tu ticket guarda un historial desde que lo abrís hasta su resolución.</p></div><div class="hint-card"><span>ESTADOS</span><div class="status-list"><div><i></i> Abierto</div><div><i></i> En proceso</div><div><i></i> Resuelto</div></div></div></aside></div>`;
}

function ticketList() {
  if (!state.ticketsLoaded) return `<div class="list-empty">Buscá por ID de viaje para ver sus consultas.</div>`;
  if (!state.tickets.length) return `<div class="list-empty">No hay tickets para ese viaje y esos filtros.</div>`;
  return `<div class="ticket-list">${state.tickets.map(t => `<button class="ticket-row" data-ticket-id="${escapeHtml(t.id)}"><div class="ticket-row-icon">◌</div><div class="ticket-row-main"><strong>${escapeHtml(t.motivo)}</strong><span>Viaje ${escapeHtml(t.tripId)} · ${date(t.fechaCreacion)}</span></div>${badge(t.estado || 'ABIERTO', t.estado === 'RESUELTO' ? 'badge-success' : '')}<span class="row-arrow">→</span></button>`).join('')}</div>`;
}

function devicesView() {
  return `${intro('RF8.7 / DISPOSITIVOS', 'Tus dispositivos.', 'Administrá dónde recibís las notificaciones PUSH.')}
    <div class="content-grid"><div class="primary-stack">
      ${card('Tus dispositivos', `<div class="devices-heading"><p class="card-copy">Estos son los dispositivos habilitados para recibir avisos. Podés desactivar uno si dejaste de usarlo.</p><button id="refresh-tokens" class="text-button">Actualizar ↻</button></div><div id="tokens-list">${tokensList()}</div><div id="token-error"></div>`)}
    </div><aside class="aside-stack"><div class="hint-card lime"><span>NOTIFICACIONES PUSH</span><h3>Elegí tus dispositivos.</h3><p>La aplicación común registra el token automáticamente cuando el dispositivo concede permiso. Acá podés revisar o desactivar los dispositivos activos.</p></div></aside></div>`;
}

function tokensList() {
  if (!state.tokens.length) return `<div class="list-empty">No hay dispositivos activos en esta sesión o todavía no se consultaron.</div>`;
  return `<div class="token-list">${state.tokens.map((item, index) => {
    const token = typeof item === 'string' ? item : item.token || '';
    const platform = typeof item === 'string' ? 'Dispositivo' : item.platform || 'Dispositivo';
    return `<div class="token-row"><span class="token-icon">${platform === 'WEB' ? '▣' : '▯'}</span><div><strong>${escapeHtml(platform)}</strong><span>•••• ${escapeHtml(token.slice(-8))}</span></div><button class="text-button danger" data-remove-token="${index}">Desactivar</button></div>`;
  }).join('')}</div>`;
}

function render(section = state.section) {
  state.section = ['comprobantes', 'soporte', 'dispositivos'].includes(section) ? section : 'comprobantes';
  page.innerHTML = ({ comprobantes: receiptView, soporte: supportView, dispositivos: devicesView })[state.section]();
  bindActions();
  if (state.section === 'dispositivos' && !state.tokensLoaded && hasSession()) void loadTokens();
}

function bindActions() {
  page.querySelector('#receipt-search')?.addEventListener('submit', searchReceipt);
  page.querySelector('#download-pdf')?.addEventListener('click', downloadPdf);
  page.querySelector('#resend-receipt')?.addEventListener('click', resendReceipt);
  page.querySelector('#ticket-create')?.addEventListener('submit', createTicket);
  page.querySelector('#ticket-filter')?.addEventListener('submit', listTickets);
  bindTicketRows();
  page.querySelector('#ticket-history')?.addEventListener('click', loadHistory);
  page.querySelector('#refresh-tokens')?.addEventListener('click', loadTokens);
  bindTokenRows();
}

function bindTicketRows() { page.querySelectorAll('[data-ticket-id]').forEach(button => button.addEventListener('click', () => openTicket(button.dataset.ticketId))); }
function bindTokenRows() { page.querySelectorAll('[data-remove-token]').forEach(button => button.addEventListener('click', () => removeToken(Number(button.dataset.removeToken)))); }

async function searchReceipt(event) {
  event.preventDefault(); const button = event.submitter; loading(button, true);
  const tripId = page.querySelector('#receipt-trip').value.trim();
  try { state.receipt = (await api(`/api/v1/receipts/${pathId(tripId)}`)).data; state.receiptTripId = tripId; render(); notify('Comprobante encontrado.'); }
  catch (error) { state.receipt = null; page.querySelector('.result-card')?.remove(); page.querySelector('#receipt-error').innerHTML = errorBox(error); }
  finally { loading(button, false); }
}

async function downloadPdf() {
  const button = page.querySelector('#download-pdf'); loading(button, true);
  try {
    const response = await api(`/api/v1/receipts/${pathId(state.receiptTripId)}/pdf`, { raw: true });
    const blob = await response.blob(); const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `comprobante-${state.receiptTripId}.pdf`; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    notify('Descarga iniciada.');
  } catch (error) { page.querySelector('#receipt-action-error').innerHTML = errorBox(error); }
  finally { loading(button, false); }
}

async function resendReceipt() {
  const button = page.querySelector('#resend-receipt'); loading(button, true);
  try { await api(`/api/v1/receipts/${pathId(state.receiptTripId)}/resend`, { method: 'POST', body: {} }); notify('Solicitud de reenvío registrada.'); }
  catch (error) { page.querySelector('#receipt-action-error').innerHTML = errorBox(error); }
  finally { loading(button, false); }
}

async function createTicket(event) {
  event.preventDefault(); const button = event.submitter; loading(button, true);
  const tripId = page.querySelector('#ticket-trip').value.trim(); const motivo = page.querySelector('#ticket-reason').value.trim();
  if (!tripId || !motivo) { loading(button, false); return; }
  const fingerprint = `${tripId}\u0000${motivo}`;
  if (state.pendingTicketKey?.fingerprint !== fingerprint) state.pendingTicketKey = { fingerprint, value: crypto.randomUUID() };
  try { state.ticket = (await api('/tickets', { method: 'POST', headers: { 'Idempotency-Key': state.pendingTicketKey.value }, body: { tripId, motivo } })).data; state.pendingTicketKey = null; state.ticketsLoaded = false; state.tickets = []; render(); notify('Ticket creado.'); }
  catch (error) { page.querySelector('#ticket-error').innerHTML = errorBox(error); }
  finally { loading(button, false); }
}

async function refreshTickets(tripId = '', status = '') {
  const query = new URLSearchParams({ limit: '50' }); if (tripId) query.set('tripId', tripId); if (status) query.set('estado', status);
  const result = await api(`/tickets?${query}`); state.tickets = Array.isArray(result.data) ? result.data : []; state.ticketsLoaded = true;
}

async function listTickets(event) {
  event?.preventDefault(); const button = event?.submitter; loading(button, true);
  const tripId = page.querySelector('#ticket-filter-trip')?.value.trim() || ''; const status = page.querySelector('#ticket-filter-status')?.value || '';
  if (!tripId) { page.querySelector('#ticket-list-error').innerHTML = '<div class="inline-alert" role="alert">Ingresá el ID del viaje.</div>'; loading(button, false); return; }
  try { await refreshTickets(tripId, status); page.querySelector('#ticket-list').innerHTML = ticketList(); page.querySelector('#ticket-list-error').innerHTML = ''; bindTicketRows(); }
  catch (error) { page.querySelector('#ticket-list-error').innerHTML = errorBox(error); }
  finally { loading(button, false); }
}

async function openTicket(id) {
  try { state.ticket = (await api(`/tickets/${pathId(id)}`)).data; render(); page.querySelector('.result-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  catch (error) { notify(friendlyError(error), 'error'); }
}

async function loadHistory() {
  const target = page.querySelector('#history-content');
  try { const history = (await api(`/tickets/${pathId(state.ticket.id)}/historial`)).data; target.innerHTML = `<div class="timeline">${(Array.isArray(history) ? history : []).map(h => `<div class="timeline-row"><span class="timeline-dot"></span><div><strong>${escapeHtml(h.estadoNuevo || h.estado || 'Actualización')}</strong><p>${escapeHtml(h.motivo || 'Cambio de estado')} · ${date(h.fecha || h.fechaCambio || h.createdAt)}</p></div></div>`).join('')}</div>`; }
  catch (error) { target.innerHTML = errorBox(error); }
}

async function loadTokens() {
  try { const result = (await api('/devices/tokens')).data; state.tokens = Array.isArray(result?.data) ? result.data : []; state.tokensLoaded = true; page.querySelector('#tokens-list').innerHTML = tokensList(); bindTokenRows(); notify('Dispositivos actualizados.'); }
  catch (error) { page.querySelector('#token-error').innerHTML = errorBox(error); }
}

async function removeToken(index) {
  const item = state.tokens[index]; const token = typeof item === 'string' ? item : item?.token;
  if (!token) return;
  try { await api(`/devices/tokens/${pathId(token)}`, { method: 'DELETE' }); await loadTokens(); notify('Dispositivo desactivado.'); }
  catch (error) { page.querySelector('#token-error').innerHTML = errorBox(error); }
}


return {
  show(section) { render(section); },
  reset() {
    state.receipt = null;
    state.ticket = null;
    state.tickets = [];
    state.ticketsLoaded = false;
    state.tokens = [];
    state.tokensLoaded = false;
    state.pendingTicketKey = null;
    render();
  },
};
}
