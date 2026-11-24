import { useEffect, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { ArrowLeft, CarFront, CircleCheck, CreditCard, MapPin, Navigation, QrCode, Route } from 'lucide-react'
import Register from './Register'
import { destination, driverAccount, ensurePassenger, FlowError, origin, prepareDriver, request, sandboxPayment } from '../rideFlowApi'
import type { Account, Offer, Payment, QR, Receipt, RideRequest, Trip } from '../rideFlowApi'
import './RideFlow.css'

interface Journey {
  key: string
  driver?: Account
  plate?: string
  ride?: RideRequest
  offer?: Offer
  accepted?: boolean
  trip?: Trip
  qr?: QR
  started?: boolean
  payment?: Payment
  receipt?: Receipt
}

const newJourney = (): Journey => ({ key: crypto.randomUUID() })
const steps = ['Conductor', 'Solicitud', 'Viaje', 'Pago']

function readJourney(key: string): Journey {
  try {
    const saved = sessionStorage.getItem(key)
    if (saved) return JSON.parse(saved) as Journey
  } catch {
    return newJourney()
  }
  return newJourney()
}

function Action({ children, busy, submit = false, onClick }: {
  children: ReactNode; busy: boolean; submit?: boolean; onClick?: () => void
}) {
  return <button className="btn-primary" type={submit ? 'submit' : 'button'} disabled={busy} onClick={onClick}>{children}</button>
}

export default function RideFlow({ passenger, onBack }: { passenger: Account; onBack: () => void }) {
  const storageKey = `movilidad.viaje.${passenger.userId}`
  const [journey, setJourney] = useState(() => readJourney(storageKey))
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [register, setRegister] = useState(false)
  const [method, setMethod] = useState(sandboxPayment ? 'tarjeta' : 'efectivo')
  const [now, setNow] = useState(Date.now)
  const { driver, plate, ride, offer, accepted, trip, qr, started, payment, receipt } = journey

  useEffect(() => {
    sessionStorage.setItem(storageKey, JSON.stringify(journey))
  }, [storageKey, journey])

  useEffect(() => {
    if ((!ride || accepted) && (!qr || started) && !payment) return
    const interval = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(interval)
  }, [ride, accepted, qr, started, payment])

  const update = (values: Partial<Journey>) => setJourney((current) => ({ ...current, ...values }))

  async function run(label: string, task: () => Promise<void>) {
    setError('')
    setBusy(label)
    try {
      await task()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'El paso no se completó. Volvé a intentar.')
    } finally {
      setBusy('')
    }
  }

  function linkDriver(token: string) {
    return driverAccount(token).then((account) => update({ driver: account, plate: undefined }))
  }

  function loginDriver(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    void run('Ingresando como conductor…', async () => {
      const { token } = await request<{ token: string }>('M1', '/auth/iniciar-sesion', {
        method: 'POST', body: { email: form.get('email'), password: form.get('password') },
      })
      await linkDriver(token)
    })
  }

  async function createRide() {
    await ensurePassenger(passenger.token)
    const created = await request<RideRequest>('M5', '/api/v1/ride-requests', {
      method: 'POST', token: passenger.token, headers: { 'Idempotency-Key': journey.key },
      body: { origin, destination, vehicleType: 'AUTO' },
    })
    setNow(Date.now())
    update({ ride: created })
  }

  async function sendOffer(rideId: string, driverId: number) {
    const path = `/api/v1/ride-requests/${rideId}`
    const current = await request<RideRequest>('M5', path, { token: passenger.token })
    if (current.status === 'ASSIGNED') {
      update({ accepted: true })
      await findTrip(rideId, driverId)
      return
    }
    if (current.status === 'EXPIRED' || current.status === 'CANCELLED') {
      setJourney({ ...newJourney(), driver, plate })
      return
    }
    const options = { method: 'POST' as const, token: passenger.token, headers: { 'X-User-Id': String(passenger.userId) } }
    const { candidates } = await request<{ candidates: { driverId: string }[] }>('M5', `${path}/candidates`, {
      ...options, body: { radiusKm: 1, maxCandidates: 50 },
    })
    if (!candidates.some((candidate) => Number(candidate.driverId) === driverId)) {
      throw new Error('El conductor de la demo todavía no aparece disponible. Volvé a publicar su ubicación e intentá otra vez.')
    }
    const { offers } = await request<{ offers: Offer[] }>('M5', `${path}/offers`, {
      ...options, body: { driverIds: [String(driverId)], ttlSeconds: 120 },
    })
    if (!offers[0]) throw new Error('M5 no emitió una oferta. Volvé a intentar.')
    setNow(Date.now())
    update({ offer: offers[0] })
  }

  async function findTrip(rideId: string, driverId: number) {
    const options = { token: passenger.token }
    const { viajes } = await request<{ viajes: { id: string }[] }>('M6',
      `/api/viajes?clienteId=${passenger.userId}&conductorId=${driverId}`, options)
    // El listado de M6 omite rideRequestId. El detalle permite identificar este viaje entre los anteriores.
    for (const item of viajes) {
      const detail = await request<Trip>('M6', `/api/viajes/${encodeURIComponent(item.id)}`, options)
      if (detail.rideRequestId === rideId) {
        update({ trip: detail })
        return
      }
    }
    throw new Error('M6 todavía está asignando el viaje. Consultalo de nuevo en unos segundos.')
  }

  async function acceptOffer(rideId: string, currentOffer: Offer, account: Account) {
    const { status } = await request<RideRequest>('M5', `/api/v1/ride-requests/${rideId}`, { token: passenger.token })
    if (status !== 'ASSIGNED') {
      const result = await request<{ requestStatus: string }>('M5', `/api/v1/offers/${currentOffer.id}/accept`, {
        method: 'POST', token: account.token, body: {},
      })
      if (result.requestStatus !== 'ASSIGNED') throw new Error('M5 todavía no asignó la solicitud. Consultala de nuevo.')
    }
    update({ accepted: true })
    await findTrip(rideId, account.userId)
  }

  async function arrive(tripId: string, token: string) {
    const result = await request<{ qr: QR }>('M6', `/api/viajes/${tripId}/arribo`, { method: 'PUT', token, body: {} })
    setNow(Date.now())
    update({ qr: result.qr })
  }

  async function startTrip(tripId: string, code: string, token: string) {
    try {
      await request('M6', `/api/viajes/${tripId}/iniciar`, { method: 'POST', token, body: { codigoVerificacion: code } })
    } catch (err) {
      const current = await request<Trip>('M6', `/api/viajes/${tripId}`, { token }).catch(() => null)
      if (current?.estado.toUpperCase() !== 'EN_CURSO') throw err
    }
    update({ started: true, qr: undefined })
  }

  async function finish(tripId: string, account: Account) {
    const result = await request<Payment>('M6', `/api/viajes/${tripId}/finalizacion`, {
      method: 'POST', token: account.token,
      body: {
        origen: origin, destino: destination, tipoVehiculo: 'auto', horaFin: new Date().toISOString(), metodoPago: method,
        ...(method === 'tarjeta' && sandboxPayment && { pago: { token: 'viaje-demo-sandbox', paymentMethodId: 'visa', email: passenger.email } }),
      },
    })
    update({ payment: result })
  }

  async function readReceipt(tripId: string) {
    try {
      const result = await request<{ data?: Receipt } & Partial<Receipt>>('M8', `/api/v1/receipts/${tripId}`, { token: passenger.token })
      update({ receipt: result.data ?? (result as Receipt) })
    } catch (err) {
      if (err instanceof FlowError && err.status === 404) throw new Error('M8 todavía está emitiendo el comprobante. Volvé a consultarlo en unos segundos.')
      throw err
    }
  }

  if (register) {
    return <Register fixedRole="CONDUCTOR" onSwitchToLogin={() => setRegister(false)} onRegisterSuccess={(token) => {
      setRegister(false)
      void run('Vinculando la cuenta…', () => linkDriver(token))
    }} />
  }

  const step = started ? 3 : trip ? 2 : plate ? 1 : 0
  const rideExpired = ride && Date.parse(ride.expiresAt) <= now
  const nextRideSeconds = ride?.expiresAt ? Math.max(0, Math.ceil((Date.parse(ride.expiresAt) - now) / 1000)) : 0
  const offerSeconds = offer && !rideExpired ? Math.max(0, Math.ceil((Date.parse(offer.expiresAt) - now) / 1000)) : 0
  const qrExpired = qr && Date.parse(qr.expiresAt) <= now
  const locked = Boolean(busy)
  const driverName = driver && `${driver.nombre} ${driver.apellido}`

  return (
    <div className="ride-flow">
      <header className="ride-flow-header">
        <button className="btn-ghost" disabled={locked} onClick={onBack}><ArrowLeft size={16} aria-hidden="true" /> Volver a mi cuenta</button>
        <span>{passenger.nombre} {passenger.apellido} · Pasajero</span>
      </header>
      <div className="glass ride-flow-panel">
        <h1 className="display ride-flow-title">Tu viaje</h1>
        <ol className="ride-steps" aria-label="Etapas del viaje">
          {steps.map((label, index) => <li key={label} aria-current={index === step ? 'step' : undefined}>
            {index < step || payment ? <CircleCheck size={17} aria-label="Completado" /> : <span aria-hidden="true">{index + 1}</span>}
            {label}
          </li>)}
        </ol>

        <div className="ride-columns">
          <aside className="ride-route" aria-label="Recorrido de prueba">
            <h2><Route size={18} aria-hidden="true" /> Recorrido de prueba</h2>
            <div className="ride-stop"><MapPin size={18} aria-hidden="true" /><div><small>Origen</small><p>{origin.address}</p></div></div>
            <div className="ride-stop"><Navigation size={18} aria-hidden="true" /><div><small>Destino</small><p>{destination.address}</p></div></div>
            <div className="ride-vehicle"><CarFront size={18} aria-hidden="true" /><span>Auto{plate && ` · ${plate}`}</span></div>
            {driverName && <p className="ride-driver">{driverName} · Conductor</p>}
          </aside>

          <section className="ride-action" aria-label="Paso actual" aria-busy={locked}>
            {error && <p className="alert-error" role="alert">{error}</p>}
            {busy && <p className="ride-muted" role="status">{busy}</p>}

            {!driver && <>
              <h2>Ingresá como conductor</h2>
              <p>Usá una segunda cuenta para recibir la solicitud y hacer el viaje.</p>
              <form className="ride-form" onSubmit={loginDriver}>
                <label>Correo del conductor<input className="input-field" type="email" name="email" autoComplete="username" required /></label>
                <label>Contraseña del conductor<input className="input-field" type="password" name="password" autoComplete="current-password" required /></label>
                <Action busy={locked} submit>Ingresar como conductor</Action>
              </form>
              <button className="btn-ghost" disabled={locked} onClick={() => setRegister(true)}>Crear cuenta de conductor</button>
            </>}

            {driver && !plate && <>
              <h2>Prepará al conductor</h2>
              <p>Para la demo, se habilita el perfil si está pendiente y se publica la ubicación en el origen con un auto activo.</p>
              <Action busy={locked} onClick={() => void run('Preparando al conductor…', async () => update({ plate: await prepareDriver(driver) }))}>Preparar conductor de prueba</Action>
              <button className="btn-ghost" disabled={locked} onClick={() => { update({ driver: undefined }); setError('') }}>Cambiar cuenta de conductor</button>
            </>}

            {plate && !ride && <>
              <h2>Pedí un viaje</h2>
              <p>El pasajero solicita un auto para el recorrido indicado.</p>
              <Action busy={locked} onClick={() => void run('Creando la solicitud…', createRide)}>Solicitar viaje</Action>
            </>}

            {ride && driver && !trip && <>
              <h2>{accepted ? 'Oferta aceptada' : offerSeconds ? 'Oferta para el conductor' : 'Buscá al conductor'}</h2>
              {!accepted && offerSeconds > 0 && <p>La oferta vence en {offerSeconds} s.</p>}
              {!accepted && (rideExpired ? <p>La solicitud venció. Podés renovarla.</p> : offer && !offerSeconds && <p>La oferta venció. Podés emitir otra.</p>)}
              {accepted ? <Action busy={locked} onClick={() => void run('Consultando la asignación…', () => findTrip(ride.id, driver.userId))}>Consultar viaje asignado</Action>
                : offer && offerSeconds > 0 ? <Action busy={locked} onClick={() => void run('Aceptando la oferta…', () => acceptOffer(ride.id, offer, driver))}>Aceptar oferta como conductor</Action>
                  : <Action busy={locked} onClick={() => void run('Consultando la solicitud…', () => sendOffer(ride.id, driver.userId))}>{rideExpired ? 'Renovar solicitud' : offer ? 'Volver a enviar oferta' : 'Buscar conductor y enviar oferta'}</Action>}
              {!accepted && !offerSeconds && <button className="btn-ghost" disabled={locked} onClick={() => void run('Publicando ubicación…', async () => update({ plate: await prepareDriver(driver) }))}>Volver a publicar ubicación</button>}
            </>}

            {trip && driver && !started && <>
              <h2>{qr ? 'Validá el inicio' : 'Marcá el arribo'}</h2>
              {qr && <div className="ride-qr"><img src={qr.qrDataUrl} alt="QR de verificación del viaje" /><p><QrCode size={16} aria-hidden="true" /> {qrExpired ? 'El QR venció.' : 'QR del pasajero listo para validar.'}</p></div>}
              {!qr || qrExpired ? <Action busy={locked} onClick={() => void run('Solicitando QR…', () => arrive(trip.id, driver.token))}>{qr ? 'Renovar QR' : 'Marcar arribo y generar QR'}</Action>
                : <Action busy={locked} onClick={() => void run('Validando QR…', () => startTrip(trip.id, qr.token, driver.token))}>Validar QR e iniciar viaje</Action>}
            </>}

            {trip && driver && started && !payment && <>
              <h2>Finalizá el viaje y registrá el pago</h2>
              <form className="ride-form" onSubmit={(event) => { event.preventDefault(); void run('Calculando la tarifa y registrando el pago…', () => finish(trip.id, driver)) }}>
                <label>Medio de pago<select className="input-field" disabled={locked} value={method} onChange={(event) => setMethod(event.target.value)}>
                  <option value="efectivo">Efectivo</option>
                  {sandboxPayment && <option value="tarjeta">Tarjeta de prueba</option>}
                </select></label>
                <p className="ride-muted">{method === 'tarjeta' ? 'El simulador autoriza la operación sin hacer un cargo.' : 'El importe se abona al conductor. El sistema registra el pago como pendiente.'}</p>
                <Action busy={locked} submit>Finalizar y registrar pago</Action>
              </form>
            </>}

            {payment && trip && <>
              <h2>Viaje finalizado</h2>
              <div className="ride-total"><CreditCard size={22} aria-hidden="true" /><strong>{new Intl.NumberFormat('es-AR', { style: 'currency', currency: payment.viaje.moneda }).format(payment.viaje.total)}</strong></div>
              <p>{payment.estadoPago === 'autorizado' ? 'Pago autorizado' : 'Pago en efectivo pendiente de cobro'}</p>
              <dl className="ride-result"><dt>Identificador del pago</dt><dd>{payment.paymentId}</dd><dt>Identificador del viaje</dt><dd>{trip.id}</dd></dl>
              {receipt ? <p className="alert-success">Comprobante emitido {receipt.receiptNumber} · Patente {receipt.driver.vehicle.plate}</p>
                : <Action busy={locked} onClick={() => void run('Consultando comprobante…', () => readReceipt(trip.id))}>Ver comprobante</Action>}
              {nextRideSeconds > 0 && <p className="ride-muted">Podés solicitar otro viaje con esta cuenta en {nextRideSeconds} s.</p>}
              <button className="btn-ghost" disabled={locked || nextRideSeconds > 0} onClick={() => { setError(''); setJourney({ ...newJourney(), driver }) }}>Hacer otro viaje</button>
            </>}
          </section>
        </div>
      </div>
    </div>
  )
}
