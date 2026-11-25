import type { VehicleType } from './places'

export const origin = { latitude: -27.4692, longitude: -58.8306, address: 'Av. 3 de Abril 1050, Corrientes' }
export const destination = { latitude: -27.4459, longitude: -58.7619, address: 'Aeropuerto Internacional Corrientes' }

export interface Identity {
  userId: number
  nombre: string
  apellido: string
  rol: string
  email: string
}

export type Account = Identity & { token: string }
export interface DriverVehicle {
  id: string
  patente: string
  marca?: string
  modelo?: string
  anio: number
  tipoServicio: VehicleType
  activo: boolean
}
export interface RideRequest {
  id: string
  status: string
  createdAt: string
  expiresAt: string
  assignedDriverId?: string | null
  estimatedFare?: { amount: number; currency: string }
  origin?: typeof origin
  destination?: typeof destination
  vehicleType?: 'AUTO' | 'MOTO'
}
export interface Offer {
  id: string
  vehicleType: VehicleType
  requestId: string
  status: string
  createdAt: string
  expiresAt: string
  origin: typeof origin
  destination: typeof destination
  estimatedFare: { amount: number; currency: string; estimatedDistanceKm: number; estimatedDurationMin: number }
}
export interface Trip {
  canceladoPor?: 'cliente' | 'conductor' | null
  id: string
  rideRequestId: string
  conductorId: string
  estado: string
  origen: string
  destino: string
  fechaCreacion: string
  iniciadoAt?: string | null
  completadoAt?: string | null
  destinoConfirmadoAt?: string | null
}
export interface QR {
  token: string
  qrDataUrl: string
  expiresAt: string
}
export interface Payment {
  paymentId: string
  estadoPago: string
  viaje: { total: number; moneda: string; metodoPago: string }
}
export interface TripFinalization {
  paymentId: string
  estadoPago: string
  total: number
  moneda: string
  metodoPago: string
  distanciaKm: number
  tiempoMinutos: number
}
export type TripRecord = Omit<Trip, 'rideRequestId'> & { finalizacion?: TripFinalization | null }
export interface Receipt {
  receiptNumber: string
  driver: { vehicle: { plate: string } }
}

export class DriverSessionExpired extends Error {}

export class FlowError extends Error {
  readonly status: number
  readonly code?: string

  constructor(message: string, status: number, code?: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

type Service = 'M2' | 'M3' | 'M3-vehiculos' | 'M4' | 'M5' | 'M6' | 'M6-cancelacion' | 'M8' | 'M9'
interface Options {
  method?: 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  body?: object
  token?: string
  headers?: Record<string, string>
  signal?: AbortSignal
}

async function fetchService(service: Service, path: string, options: Options): Promise<Response> {
  const { method = 'GET', body, token, headers, signal } = options
  const base = `/flujo-api/${service.toLowerCase()}`
  const timeout = AbortSignal.timeout(35_000)
  let response: Response
  try {
    response = await fetch(`${base}${path}`, {
      method,
      ...(method === 'GET' && { cache: 'no-store' }),
      headers: {
        ...(body && { 'Content-Type': 'application/json' }),
        ...(token && { Authorization: `Bearer ${token}` }),
        ...headers,
      },
      body: body && JSON.stringify(body),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    })
  } catch {
    throw new FlowError(`No se pudo conectar con ${service}. Volvé a intentar.`, 0)
  }

  return response
}

export async function request<T>(service: Service, path: string, options: Options = {}): Promise<T> {
  return (await requestWithHeaders<T>(service, path, options)).data
}

export async function requestWithHeaders<T>(service: Service, path: string, options: Options = {}) {
  const response = await fetchService(service, path, options)
  const data = await response.json().catch(() => null)
  if (!response.ok || data === null) {
    const detail = data?.message || data?.error?.message || data?.error?.mensaje || data?.error?.code || data?.error
    throw new FlowError(`${service} (${response.status})${typeof detail === 'string' ? ` · ${detail}` : ' · Respuesta inesperada'}`, response.status, data?.code ?? data?.error?.code ?? data?.error?.codigo)
  }
  return { data: data as T, headers: response.headers }
}

export async function downloadReceipt(tripId: string, receiptNumber: string, token: string) {
  const response = await fetchService('M8', '/api/v1/receipts/' + encodeURIComponent(tripId) + '/pdf', { token })
  if (!response.ok || !response.headers.get('Content-Type')?.startsWith('application/pdf')) {
    throw new FlowError('No se pudo descargar el comprobante. Volvé a intentar.', response.status)
  }
  const url = URL.createObjectURL(await response.blob())
  const link = document.createElement('a')
  link.href = url
  link.download = 'comprobante-' + receiptNumber + '.pdf'
  document.body.append(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function pollTrip(task: (signal: AbortSignal) => Promise<boolean>) {
  const controller = new AbortController()
  let timer: number
  const tick = async () => {
    if (await task(controller.signal) && !controller.signal.aborted) {
      timer = window.setTimeout(tick, 2000)
    }
  }
  // Un solo ciclo por pantalla, aun cuando React vuelve a montar el efecto en desarrollo.
  timer = window.setTimeout(tick, 0)
  return () => {
    window.clearTimeout(timer)
    controller.abort()
  }
}

export async function ensurePassenger(token: string) {
  try {
    await request('M2', '/v1/customers/me', { token })
  } catch (error) {
    if (!(error instanceof FlowError) || error.status !== 404) throw error
    await request('M2', '/v1/customers', {
      method: 'POST', token, body: { preferences: { preferredVehicleType: 'auto', notificationChannel: 'email' } },
    })
  }
}

export async function prepareDriver(driver: Account) {
  const path = '/api/conductores/' + driver.userId + '/estado'
  const { token } = driver
  const status = await request<{ estado: string; habilitado: boolean }>('M3', path, { token })
  if (!status.habilitado) throw new Error('Tu perfil de conductor debe estar habilitado antes de recibir viajes.')
  const vehicles = await request<DriverVehicle[]>(
    'M3-vehiculos', '/api/v1/drivers/' + driver.userId + '/vehicles', { token },
  )
  const active = vehicles.find((vehicle) => vehicle.activo && (vehicle.tipoServicio === 'AUTO' || vehicle.tipoServicio === 'MOTO'))
  if (!active) throw new Error('Registrá y activá un vehículo para recibir viajes.')
  return active
}

export async function publishDriverLocation(driverId: number, token: string, vehicleType: VehicleType, available: boolean, signal?: AbortSignal) {
  const coords = await new Promise<GeolocationCoordinates>((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('El navegador no permite compartir tu ubicación.'))
      return
    }
    navigator.geolocation.getCurrentPosition(({ coords }) => resolve(coords),
      () => reject(new Error('Permití el acceso a tu ubicación para usar el despacho.')),
      { timeout: 8_000, maximumAge: 15_000, enableHighAccuracy: true },
    )
  })
  signal?.throwIfAborted()
  const location = { latitude: coords.latitude, longitude: coords.longitude, address: 'Tu ubicación' }
  try {
    await request('M4', '/api/v1/drivers/' + driverId + '/location', {
      method: 'PUT', token, signal, body: { latitude: location.latitude, longitude: location.longitude, vehicleType, available },
    })
  } catch (error) {
    if (error instanceof FlowError && error.status === 401) throw new DriverSessionExpired()
    throw error
  }
  return location
}
