import { useEffect, useState } from 'react'
import { ArrowLeft, CarFront, CircleCheck, CreditCard, MapPin, Navigation, QrCode, Route } from 'lucide-react'
import RideMap from './RideMap'
import { destination, ensurePassenger, FlowError, origin, pollTrip, request, sandboxPayment } from '../rideFlowApi'
import type { Account, Payment, QR, Receipt, RideRequest, Trip, TripRecord } from '../rideFlowApi'
import './RideFlow.css'

interface Journey {
  key: string
  ride?: RideRequest
  trip?: Trip
  qr?: QR
  payment?: Payment
  receipt?: Receipt
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
      const { key: id, ride, trip, qr, payment, receipt } = JSON.parse(saved) as Journey
      return { key: id, ride, trip, qr, payment, receipt }
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
    if (detail.rideRequestId === ride.id) return detail
  }
}

async function findActiveTrip(passengerId: number, newerThan: number, token: string, signal: AbortSignal) {
  const { viajes } = await request<{ viajes: TripRecord[] }>('M6', `/api/viajes?clienteId=${passengerId}`, { token, signal })
  for (const item of viajes) {
    if (Date.parse(item.fechaCreacion) <= newerThan) break
    if (terminalTrip(item.estado) || item.origen !== origin.address || item.destino !== destination.address) continue
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

export default function RideFlow({ passenger, onBack }: { passenger: Account; onBack: () => void }) {
  const { token, userId } = passenger
  const storageKey = `movilidad.viaje.${userId}`
  const [journey, setJourney] = useState(() => readJourney(storageKey))
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [searchPaused, setSearchPaused] = useState(false)
  const [verifiedTripId, setVerifiedTripId] = useState<string>()
  const [checkingExistingTrip, setCheckingExistingTrip] = useState(true)
  const [method, setMethod] = useState(sandboxPayment ? 'tarjeta' : 'efectivo')
  const [now, setNow] = useState(Date.now)
  const { ride, trip, qr, payment, receipt } = journey
  const rideId = ride?.id
  const tripId = trip?.id
  const hasPayment = Boolean(payment)
  const canRestore = trip ? terminalTrip(trip.estado) : !ride || closed(ride.status)
  const newerThan = Date.parse(trip?.fechaCreacion ?? ride?.createdAt ?? '') || 0

  useEffect(() => {
    sessionStorage.setItem(storageKey, JSON.stringify(journey))
  }, [storageKey, journey])

  useEffect(() => {
    if (!rideId) return
    const interval = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(interval)
  }, [rideId])

  useEffect(() => {
    if (!canRestore || busy) return

    return pollTrip(async (signal) => {
      try {
        const active = await findActiveTrip(userId, newerThan, token, signal)
        if (signal.aborted) return false
        if (active) {
          const related = active.rideRequestId
            ? await request<RideRequest>('M5', `/api/v1/ride-requests/${active.rideRequestId}`, { token, signal }).catch(() => undefined)
            : undefined
          if (signal.aborted) return false
          setSearchPaused(false)
          setError('')
          setVerifiedTripId(active.id)
          setJourney((previous) => ({ key: previous.key, ride: related, trip: active }))
        }
        setCheckingExistingTrip(false)
        return false
      } catch {
        return !signal.aborted
      }
    })
  }, [busy, canRestore, newerThan, token, userId])

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
        if (current.estado === 'CANCELADO') return false
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
    await ensurePassenger(token)
    const created = await request<RideRequest>('M5', '/api/v1/ride-requests', {
      method: 'POST', token, headers: { 'Idempotency-Key': journey.key },
      body: { origin, destination, vehicleType: 'AUTO' },
    })
    setNow(Date.now())
    setSearchPaused(false)
    update({ ride: created })
  }

  async function prepareStart(id: string) {
    const result = await request<{ qr: QR; viaje: Pick<Trip, 'estado'> }>('M6', `/api/viajes/${id}/arribo`, { method: 'PUT', token, body: {} })
    setNow(Date.now())
    recordTransition(result.viaje.estado, result.qr)
  }

  async function startTrip(id: string, code: string) {
    const { viaje } = await request<{ viaje: Pick<Trip, 'estado'> }>('M6', `/api/viajes/${id}/iniciar`, { method: 'POST', token, body: { codigoVerificacion: code } })
    recordTransition(viaje.estado)
  }

  async function finish(id: string) {
    const result = await request<Payment>('M6', `/api/viajes/${id}/finalizacion`, {
      method: 'POST', token,
      body: {
        origen: origin, destino: destination, tipoVehiculo: 'auto', horaFin: new Date().toISOString(), metodoPago: method,
        ...(method === 'tarjeta' && sandboxPayment && { pago: { token: 'viaje-demo-sandbox', paymentMethodId: 'visa', email: passenger.email } }),
      },
    })
    recordTransition('COMPLETADO', undefined, result)
  }

  async function readReceipt(id: string) {
    try {
      const result = await request<{ data?: Receipt } & Partial<Receipt>>('M8', `/api/v1/receipts/${id}`, { token })
      update({ receipt: result.data ?? (result as Receipt) })
    } catch (err) {
      if (err instanceof FlowError && err.status === 404) throw new Error('M8 todavía está emitiendo el comprobante. Volvé a consultarlo en unos segundos.')
      throw err
    }
  }

  function reset() {
    setError('')
    setSearchPaused(false)
    setCheckingExistingTrip(true)
    setJourney(newJourney())
  }

  const started = trip?.estado === 'EN_CURSO'
  const completed = trip?.estado === 'COMPLETADO'
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
            <aside className="ride-route" aria-label="Recorrido de prueba">
              <h2><Route size={18} aria-hidden="true" /> Recorrido de prueba</h2>
              <div className="ride-stop"><MapPin size={18} aria-hidden="true" /><div><small>Origen</small><p>{origin.address}</p></div></div>
              <div className="ride-stop"><Navigation size={18} aria-hidden="true" /><div><small>Destino</small><p>{destination.address}</p></div></div>
              <div className="ride-vehicle"><CarFront size={18} aria-hidden="true" /><span>Auto{(trip?.conductorId || ride?.assignedDriverId) && ` · Conductor #${trip?.conductorId ?? ride?.assignedDriverId}`}</span></div>
              {ride?.estimatedFare && !completed && !canceled && <p className="ride-muted mt-2 text-sm">Estimación {money(ride.estimatedFare.amount, ride.estimatedFare.currency)}</p>}
            </aside>

            <section className="ride-action" aria-label="Paso actual" aria-busy={locked}>
              {error && <p className="alert-error" role="alert">{error}</p>}
              {busy && <p className="ride-muted" role="status">{busy}</p>}
              {checkingTrip && <p className="ride-muted" role="status">Consultando el estado del viaje…</p>}

              {!ride && !trip && <>
                <h2>Pedí un viaje</h2>
                <p>{checkingExistingTrip ? 'Buscando si tenés un viaje en curso…' : 'Al confirmar el pedido, buscamos autos disponibles cerca del origen.'}</p>
                <button className="btn-primary" disabled={locked || checkingExistingTrip} onClick={() => void run('Creando la solicitud…', createRide)}>Solicitar viaje</button>
              </>}

              {ride && !trip && <>
                <h2>{requestClosed ? 'Solicitud cerrada' : assigned ? 'Conductor asignado' : searchPaused ? 'Búsqueda pausada' : 'Buscando un conductor'}</h2>
                {!requestClosed && !searchPaused && <p role="status">{assigned ? 'Estamos cargando tu viaje…' : 'El viaje se asigna cuando un conductor disponible acepta la oferta.'}</p>}
                {!requestClosed && !assigned && requestSeconds > 0 && <p className="ride-muted">Tiempo de búsqueda {requestSeconds} s</p>}
                {searchPaused && !requestClosed && <button className="btn-primary" onClick={() => { setError(''); setSearchPaused(false) }}>{assigned ? 'Reintentar consulta' : 'Reintentar búsqueda'}</button>}
                {requestClosed && <button className="btn-primary" onClick={reset}>Volver a solicitar</button>}
              </>}

              {trip && !checkingTrip && !started && !completed && !canceled && <>
                <h2>{qr ? 'Validá el inicio' : 'Tu conductor está asignado'}</h2>
                {qr && <div className="ride-qr"><img src={qr.qrDataUrl} alt="QR de verificación del viaje" /><p><QrCode size={16} aria-hidden="true" /> {qrExpired ? 'El QR venció.' : 'QR listo para validar.'}</p></div>}
                {!qr || qrExpired
                  ? <button className="btn-primary" disabled={locked} onClick={() => void run('Solicitando QR…', () => prepareStart(trip.id), ['EN_CURSO'])}>{qr ? 'Renovar QR' : 'Preparar inicio del viaje'}</button>
                  : <button className="btn-primary" disabled={locked} onClick={() => void run('Validando QR…', () => startTrip(trip.id, qr.token), ['EN_CURSO'])}>Iniciar viaje</button>}
              </>}

              {trip && !checkingTrip && started && <>
                <h2>Viaje en curso</h2>
                <form className="ride-form" onSubmit={(event) => { event.preventDefault(); void run('Calculando la tarifa y registrando el pago…', () => finish(trip.id), []) }}>
                  <label>Medio de pago<select className="input-field" disabled={locked} value={method} onChange={(event) => setMethod(event.target.value)}>
                    <option value="efectivo">Efectivo</option>
                    {sandboxPayment && <option value="tarjeta">Tarjeta de prueba</option>}
                  </select></label>
                  <p className="ride-muted">{method === 'tarjeta' ? 'El simulador autoriza la operación sin hacer un cargo.' : 'El importe se abona al conductor. El sistema registra el pago como pendiente.'}</p>
                  <button className="btn-primary" disabled={locked} type="submit">Finalizar y registrar pago</button>
                </form>
              </>}

              {completed && trip && <>
                <h2>Viaje finalizado</h2>
                {payment && <>
                  <div className="ride-total"><CreditCard size={22} aria-hidden="true" /><strong>{money(payment.viaje.total, payment.viaje.moneda)}</strong></div>
                  <p>{payment.estadoPago === 'autorizado' ? 'Pago autorizado' : 'Pago en efectivo pendiente de cobro'}</p>
                </>}
                <dl className="ride-result">
                  {payment && <><dt>Identificador del pago</dt><dd>{payment.paymentId}</dd></>}
                  <dt>Identificador del viaje</dt><dd>{trip.id}</dd>
                </dl>
                {receipt ? <p className="alert-success">Comprobante emitido {receipt.receiptNumber} · Patente {receipt.driver.vehicle.plate}</p>
                  : <button className="btn-primary" disabled={locked} onClick={() => void run('Consultando comprobante…', () => readReceipt(trip.id))}>Ver comprobante</button>}
                {requestSeconds > 0 && <p className="ride-muted">Podés solicitar otro viaje con esta cuenta en {requestSeconds} s.</p>}
                <button className="btn-ghost" disabled={locked || requestSeconds > 0} onClick={reset}>Hacer otro viaje</button>
              </>}
              {canceled && <>
                <h2>Viaje cancelado</h2>
                <button className="btn-ghost" disabled={locked || requestSeconds > 0} onClick={reset}>Hacer otro viaje</button>
              </>}
            </section>
          </div>
          <RideMap />
        </div>
      </div>
    </div>
  )
}
