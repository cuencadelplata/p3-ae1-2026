// Registro de viajes con historial de transiciones y finalización de viajes en curso.
// Todo el contenido dinámico se arma con textContent para no interpretar como HTML
// datos que vienen de la API.

const PAGINA = 20;
const ETIQUETAS = {
  SOLICITADO: 'Solicitado',
  ASIGNADO: 'Asignado',
  CONDUCTOR_EN_CAMINO: 'En camino',
  ARRIBADO: 'Arribado',
  EN_CURSO: 'En curso',
  COMPLETADO: 'Completado',
  CANCELADO: 'Cancelado',
};
const METODOS = { efectivo: 'Efectivo', tarjeta: 'Tarjeta', transferencia: 'Transferencia' };

const $ = (selector) => document.querySelector(selector);
const estado = { filtros: {}, offset: 0, total: 0, viajes: [], seleccionado: null };

const fechaHora = new Intl.DateTimeFormat('es-AR', { dateStyle: 'short', timeStyle: 'short' });
const horaExacta = new Intl.DateTimeFormat('es-AR', { dateStyle: 'short', timeStyle: 'medium' });
const moneda = (valor, codigo = 'ARS') =>
  new Intl.NumberFormat('es-AR', { style: 'currency', currency: codigo }).format(valor);

function el(tag, props = {}, ...hijos) {
  const nodo = document.createElement(tag);
  for (const [clave, valor] of Object.entries(props)) {
    if (valor === undefined || valor === null) continue;
    if (clave === 'class') nodo.className = valor;
    else if (clave === 'dataset') Object.assign(nodo.dataset, valor);
    else if (clave.startsWith('on')) nodo.addEventListener(clave.slice(2), valor);
    else nodo.setAttribute(clave, valor);
  }
  for (const hijo of hijos.flat()) {
    if (hijo === null || hijo === undefined || hijo === false) continue;
    nodo.append(hijo instanceof Node ? hijo : String(hijo));
  }
  return nodo;
}

const pill = (codigo) => el('span', { class: 'state-pill', dataset: { estado: codigo } }, ETIQUETAS[codigo] ?? codigo);
const corto = (id) => (id && id.length > 13 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id ?? '—');
const fecha = (valor, formato = fechaHora) => (valor ? formato.format(new Date(valor)) : '—');
const capitalizar = (texto) => (texto ? texto.charAt(0).toUpperCase() + texto.slice(1) : texto);

function avisar(texto, tipo = 'info') {
  const aviso = $('#aviso');
  aviso.textContent = texto;
  aviso.dataset.tipo = tipo;
  aviso.hidden = false;
  clearTimeout(avisar.timer);
  avisar.timer = setTimeout(() => { aviso.hidden = true; }, tipo === 'error' ? 8000 : 4000);
}

async function api(ruta, opciones = {}) {
  const respuesta = await fetch(ruta, {
    ...opciones,
    headers: { accept: 'application/json', ...(opciones.body ? { 'content-type': 'application/json' } : {}) },
  });
  let cuerpo = null;
  try { cuerpo = await respuesta.json(); } catch { /* respuesta sin JSON */ }
  if (!respuesta.ok) {
    const mensaje = typeof cuerpo?.error === 'string' ? cuerpo.error : cuerpo?.error?.code ?? `Error ${respuesta.status}`;
    const error = new Error(mensaje);
    error.requestId = respuesta.headers.get('x-request-id');
    throw error;
  }
  return cuerpo;
}

// ---------- Estado en la URL (filtros compartibles) ----------
function leerUrl() {
  const params = new URLSearchParams(location.search);
  estado.filtros = {
    clienteId: params.get('clienteId') ?? '',
    conductorId: params.get('conductorId') ?? '',
    estado: params.get('estado') ?? '',
  };
  estado.offset = Math.max(0, Number(params.get('offset')) || 0);
  sincronizarFormulario();
}

function sincronizarFormulario() {
  $('#f-cliente').value = estado.filtros.clienteId;
  $('#f-conductor').value = estado.filtros.conductorId;
  $('#f-estado').value = estado.filtros.estado;
}

function escribirUrl() {
  const params = new URLSearchParams();
  for (const [clave, valor] of Object.entries(estado.filtros)) if (valor) params.set(clave, valor);
  if (estado.offset) params.set('offset', String(estado.offset));
  const texto = params.toString();
  history.replaceState(null, '', `${location.pathname}${texto ? `?${texto}` : ''}${location.hash}`);
}

// ---------- Lista ----------
async function buscar({ conservarSeleccion = false } = {}) {
  escribirUrl();
  const params = new URLSearchParams({ limit: String(PAGINA), offset: String(estado.offset) });
  for (const [clave, valor] of Object.entries(estado.filtros)) if (valor) params.set(clave, valor);
  $('#list-caption').textContent = 'Buscando…';
  try {
    const cuerpo = await api(`/api/viajes?${params}`);
    estado.viajes = cuerpo.viajes;
    estado.total = cuerpo.total;
    pintarLista();
    const id = conservarSeleccion ? estado.seleccionado : decodeURIComponent(location.hash.replace(/^#viaje=/, ''));
    const elegido = estado.viajes.find((viaje) => viaje.id === id);
    if (elegido) seleccionar(elegido, { enfocar: false });
    else if (!conservarSeleccion) limpiarDetalle();
  } catch (error) {
    estado.viajes = [];
    estado.total = 0;
    pintarLista();
    avisar(`No se pudo cargar el registro: ${error.message}`, 'error');
  }
}

function pintarLista() {
  $('#lista').replaceChildren(...estado.viajes.map((viaje) => el('button', {
    class: 'trip-row',
    type: 'button',
    role: 'option',
    'aria-selected': String(viaje.id === estado.seleccionado),
    dataset: { id: viaje.id },
    title: viaje.id,
    'aria-label': `Viaje ${viaje.id}, cliente ${viaje.clienteId}, ${ETIQUETAS[viaje.estado] ?? viaje.estado}`,
    onclick: () => seleccionar(viaje),
  },
  el('span', { class: 'trip-row-main' },
    el('span', { class: 'trip-row-id' }, corto(viaje.id)),
    el('span', { class: 'trip-row-route' }, `${viaje.clienteId} · ${viaje.conductorId ?? 'sin conductor'}`)),
  pill(viaje.estado))));

  const vacio = estado.viajes.length === 0;
  $('#vacio').hidden = !vacio;
  const desde = estado.total === 0 ? 0 : estado.offset + 1;
  const hasta = estado.offset + estado.viajes.length;
  $('#resumen').textContent = `${desde}–${hasta} de ${estado.total}`;
  $('#list-caption').textContent = vacio ? 'Sin viajes cargados' : `${estado.viajes.length} en pantalla`;
  $('#anterior').disabled = estado.offset === 0;
  $('#siguiente').disabled = hasta >= estado.total;
  $('#cuenta-total').textContent = String(estado.total);
  $('#cuenta-curso').textContent = String(estado.viajes.filter((v) => v.estado === 'EN_CURSO').length);
  $('#cuenta-completados').textContent = String(estado.viajes.filter((v) => v.estado === 'COMPLETADO').length);
}

// ---------- Detalle ----------
function limpiarDetalle() {
  estado.seleccionado = null;
  $('#detalle').replaceChildren(el('div', { class: 'detail-empty' },
    el('span', { class: 'detail-index' }, '02 / 02'),
    el('p', {}, 'Seleccioná un viaje para ver su historial y, si está en curso, finalizarlo.')));
}

function seleccionar(viaje, { enfocar = true } = {}) {
  estado.seleccionado = viaje.id;
  history.replaceState(null, '', `${location.pathname}${location.search}#viaje=${encodeURIComponent(viaje.id)}`);
  for (const fila of document.querySelectorAll('#lista .trip-row')) {
    fila.setAttribute('aria-selected', String(fila.dataset.id === viaje.id));
  }
  pintarDetalle(viaje);
  if (enfocar && matchMedia('(max-width: 1100px)').matches) $('#detalle').scrollIntoView({ behavior: 'smooth' });
}

function filtroRapido(campo, valor) {
  return el('button', {
    class: 'link-button',
    type: 'button',
    title: `Ver todos los viajes de ${valor}`,
    onclick: () => {
      estado.filtros = { clienteId: '', conductorId: '', estado: '', [campo]: valor };
      estado.offset = 0;
      sincronizarFormulario();
      void buscar({ conservarSeleccion: true });
    },
  }, valor);
}

function duracion(desde, hasta) {
  const segundos = Math.max(0, Math.round((new Date(hasta) - new Date(desde)) / 1000));
  if (segundos < 60) return `${segundos} s`;
  const minutos = Math.round(segundos / 60);
  return minutos < 60 ? `${minutos} min` : `${Math.floor(minutos / 60)} h ${minutos % 60} min`;
}

const fact = (etiqueta, valor) => el('div', { class: 'fact' }, el('span', {}, etiqueta), el('strong', {}, valor));

function lineaDeTiempo(historial) {
  if (!historial?.length) return el('p', { class: 'timeline-empty' }, 'Sin transiciones registradas.');
  return el('ol', { class: 'timeline', 'aria-label': 'Historial de transiciones' }, historial.map((paso, indice) =>
    el('li', {},
      el('div', { class: 'paso' }, paso.from ? `${capitalizar(paso.from)} → ${paso.to}` : `Alta · ${paso.to}`),
      el('div', { class: 'meta' },
        el('time', { datetime: paso.timestamp }, fecha(paso.timestamp, horaExacta)),
        indice > 0 ? ` · +${duracion(historial[indice - 1].timestamp, paso.timestamp)}` : '',
        paso.detalle ? ` · ${paso.detalle}` : ''))));
}

function resumenFinalizacion(fin) {
  return el('div', { class: 'action-area' },
    el('p', { class: 'action-title' }, 'Finalización'),
    el('div', { class: 'stats' },
      el('div', { class: 'stat' }, el('strong', {}, moneda(fin.total, fin.moneda ?? 'ARS')), el('span', {}, 'Total')),
      el('div', { class: 'stat' }, el('strong', {}, `${fin.tiempoMinutos} min`), el('span', {}, 'Duración')),
      el('div', { class: 'stat' }, el('strong', {}, `${fin.distanciaKm} km`), el('span', {}, 'Distancia'))),
    el('div', { class: 'detail-facts' },
      fact('Inicio', fecha(fin.inicio, horaExacta)),
      fact('Fin', fecha(fin.horaFin, horaExacta)),
      fact('Pago', `${METODOS[fin.metodoPago] ?? fin.metodoPago} · ${fin.estadoPago ?? 'autorizado'}`),
      fact('ID de pago', fin.paymentId ?? '—')));
}

function pintarDetalle(viaje) {
  $('#detalle').replaceChildren(...[
    el('div', { class: 'detail-top' },
      el('div', {},
        el('span', { class: 'detail-index' }, '02 / 02'),
        el('h3', {}, viaje.id),
        el('p', {}, `Solicitado ${fecha(viaje.fechaCreacion)}`)),
      pill(viaje.estado)),
    el('div', { class: 'route-line' },
      el('div', { class: 'route-point' }, el('span', { class: 'route-dot' }), viaje.origen ?? '—'),
      el('div', { class: 'route-point' }, el('span', { class: 'route-dot' }), viaje.destino ?? '—')),
    el('div', { class: 'detail-facts' },
      el('div', { class: 'fact' }, el('span', {}, 'Cliente'), filtroRapido('clienteId', viaje.clienteId)),
      el('div', { class: 'fact' }, el('span', {}, 'Conductor'),
        viaje.conductorId ? filtroRapido('conductorId', viaje.conductorId) : el('strong', {}, '—'))),
    viaje.finalizacion ? resumenFinalizacion(viaje.finalizacion) : null,
    el('div', { class: 'action-area' },
      el('p', { class: 'action-title' }, 'Historial de transiciones'),
      lineaDeTiempo(viaje.historialTransiciones)),
    viaje.estado === 'EN_CURSO' ? formularioFinalizar(viaje) : null,
  ].filter(Boolean));
}

// ---------- Finalizar ----------
function formularioFinalizar(viaje) {
  const formulario = $('#tpl-finalizar').content.firstElementChild.cloneNode(true);
  formulario.addEventListener('submit', async (evento) => {
    evento.preventDefault();
    const datos = formulario.elements;
    const numero = (nombre) => Number(datos[nombre].value);
    const metodoPago = datos.metodoPago.value;
    const cuerpo = {
      origen: { latitude: numero('origenLat'), longitude: numero('origenLng') },
      destino: { latitude: numero('destinoLat'), longitude: numero('destinoLng') },
      tipoVehiculo: datos.tipoVehiculo.value,
      metodoPago,
      horaFin: new Date().toISOString(),
    };
    const boton = formulario.querySelector('button[type="submit"]');
    boton.disabled = true;
    boton.firstChild.textContent = 'Finalizando… ';
    try {
      const resultado = await api(`/api/viajes/${encodeURIComponent(viaje.id)}/finalizacion`, {
        method: 'POST',
        body: JSON.stringify(cuerpo),
      });
      avisar(resultado.idempotente
        ? 'El viaje ya estaba finalizado: se muestra la finalización registrada.'
        : `Viaje finalizado: ${moneda(resultado.viaje.total, resultado.viaje.moneda)} · pago ${resultado.estadoPago}.`);
      await buscar({ conservarSeleccion: true });
    } catch (error) {
      const sufijo = error.requestId ? ` (referencia ${error.requestId})` : '';
      avisar(`No se pudo finalizar: ${error.message}${sufijo}`, 'error');
      boton.disabled = false;
      boton.firstChild.textContent = 'Finalizar viaje ';
    }
  });
  return formulario;
}

// ---------- Estado de la API ----------
async function comprobarApi() {
  const indicador = $('#api-status');
  try {
    const respuesta = await fetch('/health');
    indicador.dataset.estado = respuesta.ok ? 'ok' : 'error';
    $('#api-status-texto').textContent = respuesta.ok ? 'API en línea' : 'API con errores';
  } catch {
    indicador.dataset.estado = 'error';
    $('#api-status-texto').textContent = 'Sin conexión';
  }
}

// ---------- Eventos ----------
$('#filtros').addEventListener('submit', (evento) => {
  evento.preventDefault();
  estado.filtros = {
    clienteId: $('#f-cliente').value.trim(),
    conductorId: $('#f-conductor').value.trim(),
    estado: $('#f-estado').value,
  };
  estado.offset = 0;
  void buscar();
});
$('#filtros').addEventListener('reset', () => {
  estado.filtros = { clienteId: '', conductorId: '', estado: '' };
  estado.offset = 0;
  setTimeout(() => void buscar(), 0);
});
$('#anterior').addEventListener('click', () => { estado.offset = Math.max(0, estado.offset - PAGINA); void buscar(); });
$('#siguiente').addEventListener('click', () => { estado.offset += PAGINA; void buscar(); });
$('#actualizar').addEventListener('click', () => void buscar({ conservarSeleccion: true }));

leerUrl();
void comprobarApi();
setInterval(comprobarApi, 15000);
void buscar();
