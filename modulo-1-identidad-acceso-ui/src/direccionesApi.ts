// RF-2.2 Direcciones frecuentes (M2): favoritas, recientes, sugerencias y búsqueda de direcciones.
// Todas las llamadas pasan por /flujo-api/m2 (ver nginx.conf) con el token del cliente.
import { FlowError, request } from './rideFlowApi'
import type { Place } from './places'

export type TipoDireccion = 'ORIGEN' | 'DESTINO'

export interface Direccion {
  id: string
  tipo: TipoDireccion
  etiqueta: string | null
  direccion: string
  latitud: number | null
  longitud: number | null
  favorita: boolean
  usos: number
  ultimoUso: string | null
  version: number
}

interface Punto {
  direccion: string
  latitud?: number | null
  longitud?: number | null
}

export interface PuntoSugerido extends Punto {
  id: string
  favorita: boolean
  ultimoUso: string | null
}

export interface Sugerencias {
  origenes: PuntoSugerido[]
  destinos: PuntoSugerido[]
  // Regreso: salir de donde terminó el último viaje y volver a donde empezó.
  regreso: { viajeId: string; origen?: Punto; destino?: Punto; fechaViaje: string } | null
}

const BASE = '/api/v1/direcciones'

// M2 exige una clave única por operación (8 a 100 caracteres) para no duplicar si el pedido se repite.
function claveIdempotencia(operacion: string) {
  const azar = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`
  return `${operacion}-${azar}`
}

export async function listarDirecciones(token: string, filtro: { favorita?: boolean; recientes?: boolean } = {}, signal?: AbortSignal) {
  const params = new URLSearchParams({ limit: '100' })
  if (filtro.favorita !== undefined) params.set('favorita', String(filtro.favorita))
  if (filtro.recientes) params.set('recientes', 'true')
  const body = await request<{ data: Direccion[] }>('M2', `${BASE}?${params}`, { token, signal })
  return body.data
}

export async function obtenerSugerencias(token: string, signal?: AbortSignal) {
  const body = await request<{ data: Sugerencias }>('M2', `${BASE}/sugerencias`, { token, signal })
  return body.data
}

export async function guardarFavorita(token: string, datos: { tipo: TipoDireccion; direccion: string; etiqueta?: string; latitud?: number; longitud?: number }) {
  const body = await request<{ data: Direccion }>('M2', BASE, {
    method: 'POST', token, body: datos, headers: { 'Idempotency-Key': claveIdempotencia('alta') },
  })
  return body.data
}

export async function editarDireccion(token: string, direccion: Direccion, cambios: { etiqueta?: string; favorita?: boolean }) {
  const body = await request<{ data: Direccion }>('M2', `${BASE}/${encodeURIComponent(direccion.id)}`, {
    method: 'PATCH', token, body: cambios,
    headers: { 'Idempotency-Key': claveIdempotencia('edicion'), 'If-Match': `"${direccion.version}"` },
  })
  return body.data
}

export async function eliminarDireccion(token: string, direccion: Direccion) {
  await request('M2', `${BASE}/${encodeURIComponent(direccion.id)}`, {
    method: 'DELETE', token,
    headers: { 'Idempotency-Key': claveIdempotencia('baja'), 'If-Match': `"${direccion.version}"` },
  })
}

// M2 le pide la dirección a M4 y devuelve sus coordenadas; lista vacía si no la encuentra.
export async function buscarDireccion(token: string, texto: string, signal?: AbortSignal) {
  const body = await request<{ data: Punto[] }>('M2', `/api/v1/geocodificacion?q=${encodeURIComponent(texto)}`, { token, signal })
  return body.data
}

export function aLugar(punto?: Punto | null): Place | null {
  if (!punto || punto.latitud == null || punto.longitud == null) return null
  return { latitude: punto.latitud, longitude: punto.longitud, address: punto.direccion }
}

export function mensajeDeError(error: unknown, accion: string) {
  if (error instanceof FlowError) {
    if (error.code === 'DUPLICATE_ADDRESS') return 'Esa dirección ya está en tus favoritas.'
    if (error.status === 412 || error.status === 409) return 'La dirección cambió mientras la editabas. Actualizamos la lista; probá de nuevo.'
    if (error.status === 401) return 'Tu sesión venció. Iniciá sesión de nuevo.'
    if (error.status === 0 || error.status >= 500) return `No pudimos ${accion}: el servicio de clientes no responde. Probá en unos segundos.`
  }
  return `No pudimos ${accion}. Volvé a intentar.`
}
