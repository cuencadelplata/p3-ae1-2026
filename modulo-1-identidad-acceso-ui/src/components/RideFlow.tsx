import { useCallback, useEffect, useState } from 'react'
import { ArrowLeft, Banknote, Bike, CarFront, CircleCheck, CreditCard, Landmark, LockKeyhole, MapPin, Navigation, QrCode, Route } from 'lucide-react'
import RideMap from './RideMap'
import TripCancellation from './TripCancellation'
import TripPlanner from './TripPlanner'
import type { Draft, PickMode } from './TripPlanner'
import { destination, downloadReceipt, ensurePassenger, FlowError, origin, pollTrip, request } from '../rideFlowApi'
import type { Account, Payment, QR, Receipt, RideRequest, Trip, TripRecord } from '../rideFlowApi'
import { distanceKm, fetchRoute, reversePlace } from '../places'
import { cardEnabled, cardProblem, emptyCard, formatCardNumber, formatExpiry, tokenizeCard } from '../mercadoPago'
import type { CardInput } from '../mercadoPago'
import type { RouteInfo } from '../places'
import TripClock from './TripClock'
import './RideFlow.css'

interface Journey {
  key: string
  ride?: RideRequest
  trip?: Trip
  qr?: QR
  payment?: Payment
  receipt?: Receipt
  /** Origen, destino y vehículo que eligió el pasajero para este viaje. */
  route?: Draft
}

const defaultDraft: Draft = { origin, destination, vehicleType: 'AUTO' }

function readDraft(key: string): Draft {
  try {
    const saved = JSON.parse(sessionStorage.getItem(key) ?? 'null') as Draft | null
    if (saved?.origin?.address && saved.destination?.address) return { ...saved, vehicleType: saved.vehicleType === 'MOTO' ? 'MOTO' : 'AUTO' }
  } catch {
    // Si no hay un borrador usable, el planificador vuelve a su encuadre inicial.
  }
  return { ...defaultDraft, origin: { ...origin, address: '' }, destination: { ...destination, address: '' } }
}

const routeFromRide = (ride?: RideRequest): Draft | undefined => ride?.origin && ride.destination
  ? { origin: ride.origin, destination: ride.destination, vehicleType: ride.vehicleType ?? 'AUTO' }
  : undefined

function draftProblem({ origin: from, destination: to }: Draft) {
  if (!from.address || !to.address) return 'Elegí un origen y un destino.'
  if (distanceKm(from, to) < 0.1) return 'El destino tiene que estar a más de 100 metros del origen.'
  return ''
}

const newJourney = (): Journey => ({ key: crypto.randomUUID() })
const steps = ['Solicitud', 'Asignación', 'Viaje', 'Pago']
const closed = (status: string) => status === 'EXPIRED' || status === 'CANCELLED'
const terminalTrip = (status: string) => status === 'COMPLETADO' || status === 'CANCELADO'
const money = (amount: number, currency: string) => new Intl.NumberFormat('es-AR', { style: 'currency', currency }).format(amount)

function readJourney(key: string): Journey {
  try {
    const saved = sessionStorage.getItem(key)
    if (saved) {
      // Conserva el viaje y elimina la sesión secundaria guardada por la versión anterior.
      const { key: id, ride, trip, qr, payment, receipt, route } = JSON.parse(saved) as Journey
      return { key: id, ride, trip, qr, payment, receipt, route }
    }
  } catch {
    return newJourney()
  }
  return newJourney()
}

async function findTrip(ride: RideRequest, passengerId: number, token: string, signal: AbortSignal) {
  const filters = new URLSearchParams({ clienteId: String(passengerId) })
  if (ride.assignedDriverId) filters.set('conductorId', ride.assignedDriverId)
  const { viajes } = await request<{ viajes: TripRecord[] }>('M6', `/api/viajes?${filters}`, { token, signal })
  // El listado de M6 omite rideRequestId; el detalle identifica el viaje de esta solicitud.
  for (const item of viajes) {
    if (Date.parse(item.fechaCreacion) < Date.parse(ride.createdAt)) break
    const detail = await request<Trip>('M6', `/api/viajes/${item.id}`, { token, signal })
    if (detail.rideRequestId === ride.id && !terminalTrip(detail.estado)) return detail
  }
}

// Retoma cualquier viaje del pasajero que siga activo, sea anterior o posterior al que guardó la
// pestaña. Si solo se buscaran viajes más nuevos, uno activo más viejo quedaría invisible: el
// pasajero pediría otro y su conductor quedaría esperando "en camino" sin forma de terminarlo.
async function findActiveTrip(passengerId: number, token: string, signal: AbortSignal) {
  const { viajes } = await request<{ viajes: TripRecord[] }>('M6', `/api/viajes?clienteId=${passengerId}`, { token, signal })
  for (const item of viajes) {
    if (terminalTrip(item.estado)) continue
    const detail = await request<Trip>('M6', `/api/viajes/${item.id}`, { token, signal })
    if (!terminalTrip(detail.estado)) return detail
  }
}

async function completedPayment(trip: Trip, userId: number, token: string, signal: AbortSignal): Promise<Payment | undefined> {
  const filters = new URLSearchParams({ clienteId: String(userId), estado: 'COMPLETADO', limit: '100' })
  if (trip.conductorId) filters.set('conductorId', trip.conductorId)
  const { viajes } = await request<{ viajes: TripRecord[] }>('M6', `/api/viajes?${filters}`, { token, signal })
  const result = viajes.find((item) => item.id === trip.id)?.finalizacion
  if (!result) return
  return { paymentId: result.paymentId, estadoPago: result.estadoPago, viaje: result }
}

async function fetchReceipt(id: string, token: string, signal?: AbortSignal) {
  const result = await request<{ data?: Receipt } & Partial<Receipt>>('M8', `/api/v1/receipts/${id}`, { token, signal })
  return result.data ?? (result as Receipt)
}

export default function RideFlow({ passenger, onBack }: { passenger: Account; onBack: () => void }) {
  const { token, userId } = passenger
  const storageKey = `movilidad.viaje.${userId}`
  const [journey, setJourney] = useState(() => readJourney(storageKey))
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [searchPaused, setSearchPaused] = useState(false)
  const [verifiedTripId, setVerifiedTripId] = useState<string>()
  const [checkingExistingTrip, setCheckingExistingTrip] = useState(true)
  const [existingTripError, setExistingTripError] = useState('')
  const [lookupAttempt, setLookupAttempt] = useState(0)
  const [method, setMethod] = useState('efectivo')
  // Los datos de la tarjeta sólo viven en memoria: no se guardan en el navegador ni se mandan a M6.
  const [card, setCard] = useState<CardInput>(emptyCard)
  const setCardField = (field: keyof CardInput, value: string) => setCard((current) => ({ ...current, [field]: value }))
  const [now, setNow] = useState(Date.now)
  const draftKey = `${storageKey}.borrador`
  const [draft, setDraft] = useState(() => readDraft(draftKey))
  const [pickMode, setPickMode] = useState<PickMode | null>('origin')
  const [routeInfo, setRouteInfo] = useState<RouteInfo | null>(null)
  const [routeLoading, setRouteLoading] = useState(true)
  const [locating, setLocating] = useState(false)
  const [livePosition, setLivePosition] = useState<{ latitude: number; longitude: number }>()
  const { ride, trip, qr, payment, receipt } = journey
  const rideId = ride?.id
  const tripId = trip?.id
  const hasPayment = Boolean(payment)
  const waitsForReceipt = trip?.estado === 'COMPLETADO' && !receipt
  const canRestore = trip ? terminalTrip(trip.estado) : !ride || closed(ride.status)
  const planning = !ride && !trip
  // Lo que se muestra: el borrador mientras se arma el pedido, o el recorrido del viaje pedido.
  const shown = planning ? draft : journey.route ?? routeFromRide(ride)
    ?? (trip?.origen === origin.address && trip?.destino === destination.address ? defaultDraft : undefined)
  const problem = planning ? draftProblem(draft) : ''

  useEffect(() => {
    sessionStorage.setItem(storageKey, JSON.stringify(journey))
  }, [storageKey, journey])

  useEffect(() => {
    sessionStorage.setItem(draftKey, JSON.stringify(draft))
  }, [draftKey, draft])

  const from = shown?.origin
  const to = shown?.destination
  useEffect(() => {
    if (!from?.address || !to?.address) {
      setRouteInfo(null)
      setRouteLoading(false)
      return
    }
    const controller = new AbortController()
    setRouteLoading(true)
    const timer = window.setTimeout(() => {
      fetchRoute(from, to, controller.signal)
        .then((info) => { if (!controller.signal.aborted) setRouteInfo(info) })
        .catch(() => undefined)
        .finally(() => { if (!controller.signal.aborted) setRouteLoading(false) })
    }, 300)
    return () => { window.clearTimeout(timer); controller.abort() }
    // Se recalcula sólo cuando cambian las coordenadas.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from?.latitude, from?.longitude, from?.address, to?.latitude, to?.longitude, to?.address])

  // Un clic en el mapa fija el punto elegido y busca su dirección, como en el front de M5.
  const pickOnMap = useCallback(async (latitude: number, longitude: number) => {
    if (!pickMode) return
    const mode = pickMode
    setLocating(true)
    setDraft((current) => ({ ...current, [mode]: { latitude, longitude, address: 'Buscando la dirección…' } }))
    const place = await reversePlace(latitude, longitude).catch(() => ({ latitude, longitude, address: `Punto ${latitude}, ${longitude}` }))
    setDraft((current) => current[mode].latitude === latitude && current[mode].longitude === longitude ? { ...current, [mode]: place } : current)
    setLocating(false)
    // Después del origen, el siguiente clic elige el destino.
    if (mode === 'origin') setPickMode('destination')
  }, [pickMode])

  useEffect(() => {
    if (!rideId) return
    const interval = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(interval)
  }, [rideId])

  useEffect(() => {
    if (!canRestore || busy) return

    setCheckingExistingTrip(true)
    setExistingTripError('')
    return pollTrip(async (signal) => {
      const lookupSignal = AbortSignal.any([signal, AbortSignal.timeout(10000)])
      try {
        const active = await findActiveTrip(userId, token, lookupSignal)
        if (signal.aborted) return false
        if (active) {
          const related = active.rideRequestId
            ? await request<RideRequest>('M5', `/api/v1/ride-requests/${active.rideRequestId}`, { token, signal: lookupSignal }).catch(() => undefined)
            : undefined
          if (signal.aborted) return false
          setSearchPaused(false)
          setError('')
          setVerifiedTripId(active.id)
          setJourney((previous) => ({ key: previous.key, ride: related, trip: active, route: routeFromRide(related) }))
        }
        setCheckingExistingTrip(false)
        return false
      } catch (err) {
        if (!signal.aborted) {
          setCheckingExistingTrip(false)
          setExistingTripError(err instanceof Error ? err.message : 'No se pudo comprobar si tenés un viaje en curso.')
        }
        return false
      }
    })
  }, [busy, canRestore, token, userId, journey.key, lookupAttempt])

  useEffect(() => {
    if (!rideId || tripId || searchPaused) return
    const path = `/api/v1/ride-requests/${rideId}`
    return pollTrip(async (signal) => {
      try {
        const current = await request<RideRequest>('M5', path, { token, signal })
        if (signal.aborted) return false
        setJourney((previous) => ({ ...previous, ride: current }))

        if (closed(current.status)) return false
        if (current.status === 'ASSIGNED' || current.status === 'OFFERED') {
          const assigned = await findTrip(current, userId, token, signal)
          if (assigned && !signal.aborted) {
            setJourney((previous) => ({ ...previous, trip: assigned }))
          }
          return !assigned
        }
        if (Date.parse(current.expiresAt) <= Date.now()) {
          setJourney((previous) => ({ ...previous, ride: { ...current, status: 'EXPIRED' } }))
          return false
        }

        // M5 elige a los conductores cercanos y asigna el viaje al primero que acepta.
        await request('M5', `${path}/offers`, {
          method: 'POST', token, signal, headers: { 'X-User-Id': String(userId) }, body: { ttlSeconds: 30 },
        })
        return true
      } catch (err) {
        if (signal.aborted) return false
        if (err instanceof FlowError && (err.code === 'NO_DRIVERS_AVAILABLE' || err.code === 'DUPLICATE_OFFERS' || err.code === 'REQUEST_EXPIRED' || err.code === 'INVALID_REQUEST_STATE')) return true
        setError(err instanceof Error ? err.message : 'No se pudo buscar un conductor.')
        setSearchPaused(true)
        return false
      }
    })
  }, [rideId, tripId, searchPaused, token, userId])

  useEffect(() => {
    if (!tripId || busy) return

    return pollTrip(async (signal) => {
      try {
        const current = await request<Trip>('M6', `/api/viajes/${tripId}`, { token, signal })
        if (signal.aborted) return false
        setVerifiedTripId(current.id)
        setJourney((previous) => previous.trip?.id === tripId
          ? { ...previous, trip: current, qr: current.estado === 'ARRIBADO' ? previous.qr : undefined }
          : previous)
        if (current.estado === 'CANCELADO') {
          if (current.canceladoPor !== 'conductor' || !current.rideRequestId) return false
          const reopened = await request<RideRequest>('M5', `/api/v1/ride-requests/${encodeURIComponent(current.rideRequestId)}`, { token, signal })
          if (signal.aborted) return false
          // Esperar al consumidor de RabbitMQ sin volver a seleccionar el viaje cancelado.
          if (reopened.status === 'ASSIGNED' && reopened.assignedDriverId === current.conductorId) return true
          setSearchPaused(false)
          setJourney((previous) => previous.trip?.id === tripId
            ? { ...previous, ride: reopened, trip: undefined, qr: undefined, payment: undefined, receipt: undefined }
            : previous)
          return false
        }
        if (current.estado !== 'COMPLETADO') return true

        if (!hasPayment) {
          const savedPayment = await completedPayment(current, userId, token, signal)
          if (savedPayment && !signal.aborted) setJourney((previous) => previous.trip?.id === tripId ? { ...previous, payment: savedPayment } : previous)
        }
        return false
      } catch {
        return !signal.aborted
      }
    })
  }, [tripId, busy, hasPayment, token, userId])

  useEffect(() => {
    if (!tripId || !waitsForReceipt) return
    const deadline = Date.now() + 30_000
    return pollTrip(async (signal) => {
      try {
        const issued = await fetchReceipt(tripId, token, signal)
        if (!signal.aborted) setJourney((previous) => previous.trip?.id === tripId ? { ...previous, receipt: issued } : previous)
        return false
      } catch (error) {
        return error instanceof FlowError && error.status === 404 && Date.now() < deadline
      }
    })
  }, [tripId, token, waitsForReceipt])

  const update = (values: Partial<Journey>) => setJourney((current) => ({ ...current, ...values }))

  function recordTransition(estado: string, qr?: QR, payment?: Payment) {
    setJourney((previous) => ({
      ...previous, trip: previous.trip && { ...previous.trip, estado }, qr,
      ...(payment && { payment }),
    }))
  }

  async function run(label: string, task: () => Promise<void>, advancedStates?: string[]) {
    setError('')
    setBusy(label)
    try {
      await task()
    } catch (err) {
      if (tripId && advancedStates) {
        const current = await request<Trip>('M6', `/api/viajes/${tripId}`, { token }).catch(() => null)
        if (current && [...advancedStates, 'COMPLETADO', 'CANCELADO'].includes(current.estado)) {
          update({ trip: current, qr: undefined })
          return
        }
      }
      setError(err instanceof Error ? err.message : 'El paso no se completó. Volvé a intentar.')
    } finally {
      setBusy('')
    }
  }

  async function createRide() {
    const chosen = draft
    const invalid = draftProblem(chosen)
    if (invalid) throw new Error(invalid)
    await ensurePassenger(token)
    const created = await request<RideRequest>('M5', '/api/v1/ride-requests', {
      method: 'POST', token, headers: { 'Idempotency-Key': journey.key },
      body: { origin: chosen.origin, destination: chosen.destination, vehicleType: chosen.vehicleType },
    })
    setNow(Date.now())
    setSearchPaused(false)
    setPickMode(null)
    update({ ride: created, route: chosen })
  }

  async function prepareStart(id: string) {
    const result = await request<{ qr: QR; viaje: Pick<Trip, 'estado'> }>('M6', `/api/viajes/${id}/arribo`, { method: 'PUT', token, body: {} })
    setNow(Date.now())
    recordTransition(result.viaje.estado, result.qr)
  }

  async function finish(id: string) {
    if (!trip?.destinoConfirmadoAt) throw new Error('Esperá la confirmación de llegada del conductor.')
    // M6 le pide a M4 la distancia entre los puntos que eligió el pasajero.
    const recorrido = journey.route ?? routeFromRide(ride)
    if (!recorrido) throw new Error('No pudimos recuperar el recorrido de este viaje. Volvé a abrirlo desde tu cuenta e intentá de nuevo.')
    // Tarjeta: primero Mercado Pago tokeniza los datos; M6 recibe el token y M7 autoriza el pago.
    const pago = method === 'tarjeta' ? await tokenizeCard(card, passenger.email) : undefined
    const result = await request<Payment>('M6', `/api/viajes/${id}/finalizacion`, {
      method: 'POST', token,
      body: {
        origen: recorrido.origin, destino: recorrido.destination, tipoVehiculo: recorrido.vehicleType.toLowerCase(),
        horaFin: trip.destinoConfirmadoAt, metodoPago: method, gestionarPago: true,
        ...(pago && { pago }),
      },
    })
    setCard(emptyCard)
    recordTransition('COMPLETADO', undefined, result)
  }

  async function readReceipt(id: string) {
    try {
      update({ receipt: await fetchReceipt(id, token) })
    } catch (err) {
      if (err instanceof FlowError && err.status === 404) {
        throw new Error('El comprobante aún no está disponible. Si sigue sin aparecer, abrí Soporte del viaje desde el historial.')
      }
      throw err
    }
  }

  async function requestAnotherRide() {
    // M6 ya cerró el viaje. Cerrar también su solicitud libera el candado del cliente en M5.
    const cancelledRequestId = rideId ?? trip?.rideRequestId
    if (trip?.estado === 'CANCELADO' && cancelledRequestId) {
      const current = await request<RideRequest>('M5', `/api/v1/ride-requests/${encodeURIComponent(cancelledRequestId)}`, { token })
      if (!closed(current.status)) {
        const endpoint = current.status === 'ASSIGNED' ? 'cancel-assigned' : 'cancel'
        try {
          await request('M5', `/api/v1/ride-requests/${encodeURIComponent(cancelledRequestId)}/${endpoint}`, {
            method: 'POST', token,
            body: { actorType: 'CLIENT', reason: 'El pasajero solicita otro viaje después de la cancelación en M6' },
          })
        } catch (err) {
          // Una respuesta perdida o un cierre concurrente pueden haber completado la operación.
          const latest = await request<RideRequest>('M5', `/api/v1/ride-requests/${encodeURIComponent(cancelledRequestId)}`, { token }).catch(() => null)
          if (!latest || !closed(latest.status)) throw err
        }
      }
    }
    reset()
  }

  function reset() {
    setError('')
    setSearchPaused(false)
    setCheckingExistingTrip(true)
    setPickMode('origin')
    setJourney(newJourney())
  }

  const started = trip?.estado === 'EN_CURSO'
  const trackingTripId = started && !trip?.destinoConfirmadoAt ? trip.id : undefined
  const trackingStartedAt = trip?.iniciadoAt
  useEffect(() => {
    setLivePosition(undefined)
    if (!trackingTripId || !trackingStartedAt) return
    return pollTrip(async (signal) => {
      try {
        const point = await request<{ latitude: number; longitude: number; updatedAt: string }>('M4',
          '/api/v1/trips/' + encodeURIComponent(trackingTripId) + '/driver-location', { token, signal })
        if (!signal.aborted) setLivePosition(Date.parse(point.updatedAt) >= Date.parse(trackingStartedAt) ? point : undefined)
      } catch {
        if (!signal.aborted) setLivePosition(undefined)
      }
      return !signal.aborted
    })
  }, [trackingTripId, trackingStartedAt, token])
  const completed = trip?.estado === 'COMPLETADO'
  const replacingDriver = trip?.estado === 'CANCELADO' && trip.canceladoPor === 'conductor'
  const canceled = trip?.estado === 'CANCELADO'
  const step = started || completed ? 3 : trip ? 2 : ride ? 1 : 0
  const requestSeconds = ride?.expiresAt ? Math.max(0, Math.ceil((Date.parse(ride.expiresAt) - now) / 1000)) : 0
  const requestClosed = ride && closed(ride.status)
  const assigned = ride?.status === 'ASSIGNED'
  const qrExpired = qr && Date.parse(qr.expiresAt) <= now
  const locked = Boolean(busy)
  const checkingTrip = Boolean(tripId && verifiedTripId !== tripId && !completed && !canceled)

  return (
    <div className="ride-flow ride-flow-wide">
      <header className="ride-flow-header">
        <button className="btn-ghost" disabled={locked} onClick={onBack}><ArrowLeft size={16} aria-hidden="true" /> Volver a mi cuenta</button>
        <span>{passenger.nombre} {passenger.apellido} · Pasajero</span>
      </header>
      <div className="glass ride-flow-panel">
        <h1 className="display ride-flow-title">Tu viaje</h1>
        <ol className="ride-steps" aria-label="Etapas del viaje">
          {steps.map((label, index) => <li key={label} aria-current={index === step ? 'step' : undefined}>
            {index < step || completed ? <CircleCheck size={17} aria-label="Completado" /> : <span aria-hidden="true">{index + 1}</span>}
            {label}
          </li>)}
        </ol>

        <div className="ride-columns">
          <div className="ride-sidebar">
            <aside className="ride-route" aria-label={planning ? '¿A dónde vamos?' : 'Recorrido del viaje'}>
              <h2><Route size={18} aria-hidden="true" /> {planning ? '¿A dónde vamos hoy?' : 'Tu recorrido'}</h2>
              {planning ? <TripPlanner draft={draft} onChange={setDraft} route={routeInfo} routeLoading={routeLoading}
                pickMode={pickMode} onPickMode={setPickMode} disabled={locked || checkingExistingTrip || Boolean(existingTripError)} warning={problem} />
                : <>
                  <div className="ride-stop"><MapPin size={18} aria-hidden="true" /><div><small>Origen</small><p>{shown?.origin.address ?? trip?.origen}</p></div></div>
                  <div className="ride-stop"><Navigation size={18} aria-hidden="true" /><div><small>Destino</small><p>{shown?.destination.address ?? trip?.destino}</p></div></div>
                  <div className="ride-vehicle">
                    {shown?.vehicleType === 'MOTO' ? <Bike size={18} aria-hidden="true" /> : <CarFront size={18} aria-hidden="true" />}
                    <span>{shown?.vehicleType === 'MOTO' ? 'Moto' : 'Auto'}{(trip?.conductorId || ride?.assignedDriverId) && ` · Conductor #${trip?.conductorId ?? ride?.assignedDriverId}`}</span>
                  </div>
                  {routeInfo && <p className="ride-muted mt-2 text-sm">{routeInfo.distanceKm.toLocaleString('es-AR', { maximumFractionDigits: 1 })} km · ~{routeInfo.durationMin} min</p>}
                  {ride?.estimatedFare && !completed && !canceled && <p className="ride-muted mt-2 text-sm">Tarifa estimada por M7: {money(ride.estimatedFare.amount, ride.estimatedFare.currency)}</p>}
                </>}
            </aside>

            <section className="ride-action" aria-label="Paso actual" aria-busy={locked}>
              {error && <p className="alert-error" role="alert">{error}</p>}
              {busy && <p className="ride-muted" role="status">{busy}</p>}
              {checkingTrip && <p className="ride-muted" role="status">Consultando el estado del viaje…</p>}

              {!ride && !trip && <>
                <h2>Pedí un viaje</h2>
                <p>{checkingExistingTrip ? 'Buscando si tenés un viaje en curso…' : existingTripError ? 'No pudimos comprobar si tenés un viaje activo. Reintentá antes de solicitar otro.' : 'Elegí el origen, el destino y el tipo de vehículo. Al confirmar, buscamos conductores disponibles cerca del origen.'}</p>
                {existingTripError && <>
                  <p role="alert">{existingTripError}</p>
                  <button className="btn-ghost" disabled={locked || checkingExistingTrip} onClick={() => setLookupAttempt((attempt) => attempt + 1)}>Reintentar consulta de viaje</button>
                </>}
                <button className="btn-primary" disabled={locked || checkingExistingTrip || Boolean(existingTripError) || locating || Boolean(problem)} onClick={() => void run('Creando la solicitud…', createRide)}>Pedir viaje ahora</button>
              </>}

              {ride && !trip && <>
                <h2>{requestClosed ? 'Solicitud cerrada' : assigned ? 'Conductor asignado' : searchPaused ? 'Búsqueda pausada' : 'Buscando un conductor'}</h2>
                {!requestClosed && !searchPaused && <p role="status">{assigned ? 'Estamos cargando tu viaje…' : 'El viaje se asigna cuando un conductor disponible acepta la oferta.'}</p>}
                {!requestClosed && !assigned && requestSeconds > 0 && <p className="ride-muted">Tiempo de búsqueda {requestSeconds} s</p>}
                {searchPaused && !requestClosed && <button className="btn-primary" onClick={() => { setError(''); setSearchPaused(false) }}>{assigned ? 'Reintentar consulta' : 'Reintentar búsqueda'}</button>}
                {requestClosed && <button className="btn-primary" onClick={reset}>Volver a solicitar</button>}
              </>}

              {trip && !checkingTrip && !started && !completed && !canceled && <>
                <h2>{qr && !qrExpired ? 'Mostrale el QR al conductor' : 'Confirmá el encuentro'}</h2>
                {qr && !qrExpired
                  ? <div className="ride-qr">
                      <img src={qr.qrDataUrl} alt="QR de verificación del viaje" />
                      <p><QrCode size={16} aria-hidden="true" /> El conductor debe validarlo para iniciar el viaje.</p>
                      <label>Código alternativo
                        <input className="input-field" value={qr.token} readOnly onFocus={(event) => event.currentTarget.select()} />
                      </label>
                    </div>
                  : <>
                      <p>{qrExpired ? 'El código venció. Generá otro para el conductor.' : 'Generá el código cuando estés con tu conductor.'}</p>
                      <button className="btn-primary" disabled={locked} onClick={() => void run('Solicitando QR…', () => prepareStart(trip.id), ['EN_CURSO'])}>{qr ? 'Renovar QR' : 'Mostrar QR de inicio'}</button>
                    </>}
              </>}

              {trip && !checkingTrip && ['SOLICITADO', 'CONDUCTOR_EN_CAMINO'].includes(trip.estado) &&
                <TripCancellation key={trip.id} trip={trip} actor="cliente" token={token} disabled={locked}
                  onCancelled={(cancelledTrip) => update({ trip: cancelledTrip, qr: undefined, payment: undefined, receipt: undefined })} />}

              {trip && !checkingTrip && started && <>
                <h2>Viaje en curso</h2>
                <TripClock startedAt={trip.iniciadoAt} endedAt={trip.destinoConfirmadoAt} />
                {!trip.destinoConfirmadoAt && <p role="status">{livePosition ? 'Seguí la ubicación del conductor en el mapa.' : 'Esperando la ubicación del conductor.'} El pago se habilita cuando el conductor confirma la llegada.</p>}
                {trip.destinoConfirmadoAt && <form className="ride-form" onSubmit={(event) => { event.preventDefault(); void run('Calculando la tarifa y registrando el pago…', () => finish(trip.id), []) }}>
                  <fieldset className="ride-pay-methods" disabled={locked}>
                    <legend>Medio de pago</legend>
                    {[
                      { value: 'efectivo', label: 'Efectivo', icon: Banknote, available: true },
                      { value: 'transferencia', label: 'Transferencia', icon: Landmark, available: true },
                      { value: 'tarjeta', label: 'Tarjeta', icon: CreditCard, available: cardEnabled },
                    ].filter((option) => option.available).map(({ value, label, icon: Icon }) => (
                      <label key={value} className="ride-pay-option" data-selected={method === value}>
                        <input type="radio" name="metodo-pago" value={value} checked={method === value} onChange={() => setMethod(value)} />
                        <Icon size={18} aria-hidden="true" /> {label}
                      </label>
                    ))}
                  </fieldset>
                  {method === 'efectivo' && <p className="ride-muted">El importe se abona al conductor. M7 registra el pago como pendiente de cobro.</p>}
                  {method === 'transferencia' && <p className="ride-muted">Transferí el importe al conductor al llegar. M7 registra el pago como pendiente hasta que se acredite.</p>}
                  {method === 'tarjeta' && <div className="ride-card">
                    <label className="ride-card-wide">Número de tarjeta
                      <input className="input-field" inputMode="numeric" autoComplete="cc-number" placeholder="Ingresá el número de tu tarjeta" value={card.number}
                        onChange={(event) => setCardField('number', formatCardNumber(event.target.value))} />
                    </label>
                    <label>Vencimiento
                      <input className="input-field" inputMode="numeric" autoComplete="cc-exp" placeholder="MM/AA" value={card.expiry}
                        onChange={(event) => setCardField('expiry', formatExpiry(event.target.value))} />
                    </label>
                    <label>Código de seguridad
                      <input className="input-field" inputMode="numeric" autoComplete="cc-csc" placeholder="123" maxLength={4} value={card.cvv}
                        onChange={(event) => setCardField('cvv', event.target.value.replace(/\D/g, ''))} />
                    </label>
                    <label className="ride-card-wide">Titular (como figura en la tarjeta)
                      <input className="input-field" autoComplete="cc-name" placeholder="Nombre y apellido" value={card.holder}
                        onChange={(event) => setCardField('holder', event.target.value.toUpperCase())} />
                    </label>
                    <label className="ride-card-wide">DNI del titular
                      <input className="input-field" inputMode="numeric" placeholder="DNI sin puntos" maxLength={8} value={card.dni}
                        onChange={(event) => setCardField('dni', event.target.value.replace(/\D/g, ''))} />
                    </label>
                    <p className="ride-muted ride-card-wide"><LockKeyhole size={13} aria-hidden="true" /> Los datos de la tarjeta se envían directamente a Mercado Pago para tokenizar el pago.</p>
                  </div>}
                  <button className="btn-primary" disabled={locked || (method === 'tarjeta' && Boolean(cardProblem(card)))} type="submit">
                    {method === 'tarjeta' ? 'Pagar y finalizar viaje' : 'Finalizar y registrar pago'}
                  </button>
                  {method === 'tarjeta' && card.number && cardProblem(card) && <p className="ride-muted">{cardProblem(card)}</p>}
                </form>}
              </>}

              {completed && trip && <>
                <h2>Viaje finalizado</h2>
                {trip.iniciadoAt && trip.completadoAt && <TripClock startedAt={trip.iniciadoAt} endedAt={trip.completadoAt} />}
                {payment && <>
                  <div className="ride-total"><CreditCard size={22} aria-hidden="true" /><strong>{money(payment.viaje.total, payment.viaje.moneda)}</strong></div>
                  <p>{payment.estadoPago === 'autorizado'
                    ? 'Pago con tarjeta autorizado por Mercado Pago'
                    : payment.viaje.metodoPago === 'transferencia' ? 'Transferencia pendiente de acreditación' : 'Pago en efectivo pendiente de cobro'}</p>
                </>}
                <dl className="ride-result">
                  {payment && <><dt>Identificador del pago</dt><dd>{payment.paymentId}</dd></>}
                  <dt>Identificador del viaje</dt><dd>{trip.id}</dd>
                </dl>
                {receipt ? <>
                    <p className="alert-success">Comprobante {receipt.receiptNumber} · Patente {receipt.driver.vehicle.plate}</p>
                    <button className="btn-primary" disabled={locked} onClick={() => void run('Descargando comprobante…', () => downloadReceipt(trip.id, receipt.receiptNumber, token))}>Descargar PDF</button>
                  </>
                  : <button className="btn-primary" disabled={locked} onClick={() => void run('Consultando comprobante…', () => readReceipt(trip.id))}>Ver comprobante</button>}
                <button className="btn-ghost" disabled={locked} onClick={reset}>Hacer otro viaje</button>
              </>}
              {replacingDriver && <>
                <h2>Buscando otro conductor</h2>
                <p role="status">Tu conductor canceló. Estamos retomando la búsqueda para tu recorrido.</p>
                {error && <p role="alert">{error}</p>}
              </>}
              {canceled && !replacingDriver && <>
                <h2>Viaje cancelado</h2>
                <button className="btn-ghost" disabled={locked} onClick={() => void run('Preparando otro viaje…', requestAnotherRide)}>Hacer otro viaje</button>
              </>}
            </section>
          </div>
          <RideMap showRoute={Boolean(from?.address && to?.address)} showLocation={Boolean(from?.address)} pickup={shown?.origin} dropoff={shown?.destination} routeCoords={routeInfo?.coords} vehiclePosition={trackingTripId ? livePosition : undefined}
            onPick={planning && pickMode && !locked ? (latitude, longitude) => void pickOnMap(latitude, longitude) : undefined}
            pickLabel={pickMode === 'origin' ? 'Tocá el mapa para marcar el origen' : 'Tocá el mapa para marcar el destino'} />
        </div>
      </div>
    </div>
  )
}
