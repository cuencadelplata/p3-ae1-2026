export const origin = { latitude: -27.4692, longitude: -58.8306, address: 'Av. 3 de Abril 1050, Corrientes' }
export const destination = { latitude: -27.4459, longitude: -58.7619, address: 'Aeropuerto Internacional Corrientes' }
export const sandboxPayment = import.meta.env.VITE_FLOW_SANDBOX_PAYMENT === 'true'

export interface Identity {
  userId: number
  nombre: string
  apellido: string
  rol: string
  email: string
}

export type Account = Identity & { token: string }
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
  requestId: string
  status: string
  createdAt: string
  expiresAt: string
  origin: typeof origin
  destination: typeof destination
  estimatedFare: { amount: number; currency: string; estimatedDistanceKm: number; estimatedDurationMin: number }
}
export interface Trip {
  id: string
  rideRequestId: string
  conductorId: string
  estado: string
  origen: string
  destino: string
  fechaCreacion: string
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

export class FlowError extends Error {
  readonly status: number
  readonly code?: string

  constructor(message: string, status: number, code?: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

type Service = 'M2' | 'M3' | 'M3-vehiculos' | 'M4' | 'M5' | 'M6' | 'M6-cancelacion' | 'M8'
interface Options {
  method?: 'POST' | 'PUT' | 'PATCH'
  body?: object
  token?: string
  headers?: Record<string, string>
  signal?: AbortSignal
}

export async function request<T>(service: Service, path: string, options: Options = {}): Promise<T> {
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

  const data = await response.json().catch(() => null)
  if (!response.ok || data === null) {
    const detail = data?.message || data?.error?.message || data?.error?.code || data?.error
    throw new FlowError(`${service} (${response.status})${typeof detail === 'string' ? ` · ${detail}` : ' · Respuesta inesperada'}`, response.status, data?.code)
  }
  return data as T
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
  const path = `/api/conductores/${driver.userId}`
  const { token } = driver
  let status = 'pendiente'
  try {
    const info = await request<{ estado: string; habilitado: boolean }>('M3', `${path}/estado`, { token })
    status = info.habilitado ? 'activo' : info.estado
  } catch (error) {
    if (!(error instanceof FlowError) || error.status !== 404) throw error
    await request('M3', '/api/conductores', {
      method: 'POST', token, body: { ciudad: 'Corrientes', tipovehiculo: 'auto' },
    })
  }

  if (status === 'pendiente') {
    await request('M3', `${path}/habilitado`, { method: 'PUT', token, body: { habilitado: 'activo' } })
  } else if (status !== 'activo') {
    throw new Error(`El conductor está ${status}. Usá una cuenta de prueba habilitada o nueva.`)
  }

  const vehiclesPath = `/api/v1/drivers/${driver.userId}/vehicles`
  type Vehicle = { id: string; patente: string; tipoServicio: string; activo: boolean }
  const vehicles = await request<Vehicle[]>('M3-vehiculos', vehiclesPath, { token })
  let car = vehicles.find((vehicle) => vehicle.tipoServicio === 'AUTO' && vehicle.activo)
    ?? vehicles.find((vehicle) => vehicle.tipoServicio === 'AUTO')

  if (!car) {
    const [number, left, right] = crypto.getRandomValues(new Uint16Array(3))
    const plate = `AB${100 + number % 900}${String.fromCharCode(65 + left % 26, 65 + right % 26)}`
    car = await request<Vehicle>('M3-vehiculos', vehiclesPath, {
      method: 'POST', token, headers: { 'Idempotency-Key': crypto.randomUUID() },
      body: { patente: plate, marca: 'Toyota', modelo: 'Etios', anio: 2022, tipoServicio: 'AUTO' },
    })
  }
  if (!car.activo) {
    await request('M3-vehiculos', `${vehiclesPath}/${encodeURIComponent(car.id)}/activar`, { method: 'PATCH', token })
  }

  return car.patente
}

export function publishDriverLocation(driverId: number, token: string, available: boolean, signal?: AbortSignal) {
  return request('M4', `/api/v1/drivers/${driverId}/location`, {
    method: 'PUT', token, signal, body: { latitude: origin.latitude, longitude: origin.longitude, vehicleType: 'AUTO', available },
  })
}
