import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, Bike, CarFront, CircleCheck, Clock3, LockKeyhole, MapPin, Navigation, Power, Radar } from 'lucide-react'
import RideMap from './RideMap'
import TripCancellation from './TripCancellation'
import { fetchRoute } from '../places'
import type { RouteInfo } from '../places'
import { destination, DriverSessionExpired, FlowError, origin, pollTrip, prepareDriver, publishDriverLocation, request } from '../rideFlowApi'
import type { Account, DriverVehicle, Offer, Trip, TripRecord } from '../rideFlowApi'
import './RideFlow.css'
import TripClock from './TripClock'
import DriverVehicles from './DriverVehicles'
import './DriverDispatch.css'

type QRDetector = new (options: { formats: string[] }) => { detect(image: ImageBitmap): Promise<{ rawValue: string }[]> }
const qrDetector = (globalThis as typeof globalThis & { BarcodeDetector?: QRDetector }).BarcodeDetector

interface Assignment {
  offer?: Offer
  tripId?: string
}

const isActive = (trip: TripRecord) => trip.estado !== 'COMPLETADO' && trip.estado !== 'CANCELADO'
const currency = (total: number, moneda: string) => new Intl.NumberFormat('es-AR', { style: 'currency', currency: moneda }).format(total)
const rideStatus: Record<string, string> = {
  CONDUCTOR_EN_CAMINO: 'En camino al origen',
  ARRIBADO: 'En el punto de encuentro',
  EN_CURSO: 'Viaje en curso',
  COMPLETADO: 'Viaje finalizado',
  CANCELADO: 'Viaje cancelado',
}

function readAssignment(key: string): Assignment | null {
  try {
    return JSON.parse(sessionStorage.getItem(key) ?? 'null') as Assignment | null
  } catch {
    return null
  }
}

function driverOffers(userId: number, token: string, signal?: AbortSignal) {
  return request<{ offers: Offer[] }>('M5', `/api/v1/drivers/${userId}/offers`, { token, signal })
}

async function driverTrip(userId: number, token: string, assignment: Assignment | null, signal?: AbortSignal): Promise<TripRecord | null> {
  const path = `/api/viajes?conductorId=${userId}`
  if (assignment?.tripId) {
    const current = await request<Trip>('M6', `/api/viajes/${assignment.tripId}`, { token, signal })
    if (current.estado !== 'COMPLETADO') return current

    const records = await request<{ viajes: TripRecord[] }>('M6', `${path}&estado=COMPLETADO`, { token, signal }).catch(() => null)
    return { ...current, finalizacion: records?.viajes.find((item) => item.id === current.id)?.finalizacion }
  }

  const { viajes } = await request<{ viajes: TripRecord[] }>('M6', path, { token, signal })
  for (const item of viajes) {
    const offer = assignment?.offer
    const mayMatch = offer && Date.parse(item.fechaCreacion) >= Date.parse(offer.createdAt)
    if (!isActive(item) && !mayMatch) continue

    const detail = await request<Trip>('M6', `/api/viajes/${item.id}`, { token, signal })
    if (isActive(detail) || (offer && detail.rideRequestId === offer.requestId)) return { ...detail, finalizacion: item.finalizacion }
  }
  return null
}

export default function DriverDispatch({ driver, onBack, onSessionExpired }: { driver: Account; onBack: () => void; onSessionExpired: () => void }) {
  const { userId, token } = driver
  const storageKey = `movilidad.conductor.viaje.${userId}`
  const [online, setOnline] = useState(false)
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState('')
  const [activeVehicle, setActiveVehicle] = useState<DriverVehicle>()
  const [showVehicles, setShowVehicles] = useState(false)
  const [offer, setOffer] = useState<Offer | null>(null)
  const [assignment, setAssignment] = useState(() => readAssignment(storageKey))
  const [trip, setTrip] = useState<TripRecord | null>(null)
  const [completedOffer, setCompletedOffer] = useState<Offer | null>(null)
  const [error, setError] = useState('')
  const [startCode, setStartCode] = useState('')
  const [driverLocation, setDriverLocation] = useState<typeof origin>()
  const [now, setNow] = useState(Date.now)
  const offerId = offer?.id
  const vehicle = useRef<DriverVehicle>(undefined)

  async function ensureVehicle(refresh = false) {
    if (refresh || !vehicle.current) {
      vehicle.current = await prepareDriver(driver)
      setActiveVehicle(vehicle.current)
    }
    return vehicle.current
  }
  const ensureVehicleRef = useRef(ensureVehicle)
  useEffect(() => { ensureVehicleRef.current = ensureVehicle })

  useEffect(() => {
    if (assignment) sessionStorage.setItem(storageKey, JSON.stringify(assignment))
    else sessionStorage.removeItem(storageKey)
  }, [storageKey, assignment])

  useEffect(() => {
    if (!offerId) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [offerId])

  useEffect(() => {
    if (busy) return
    let lastPublication = 0
    let lastAvailability: boolean | undefined
    return pollTrip(async (signal) => {
      try {
        const current = await driverTrip(userId, token, assignment, signal)
        if (signal.aborted) return false
        setReady(true)

        if (current && isActive(current)) {
          setTrip(current)
          setOffer(null)
          setOnline(true)
          if (assignment?.tripId !== current.id) setAssignment({ ...assignment, tripId: current.id })
        } else if (current && assignment) {
          setTrip(current)
          setOnline(true)
          setCompletedOffer(assignment.offer ?? null)
          setAssignment(null)
        }

        const occupied = Boolean(current ? isActive(current) : assignment)
        if (!online) return occupied
        const available = !occupied
        const selected = await ensureVehicleRef.current()
        if (signal.aborted) return false
        if (available !== lastAvailability || Date.now() - lastPublication >= (current?.estado === 'EN_CURSO' && !current.destinoConfirmadoAt ? 5000 : 20_000)) {
          const position = await publishDriverLocation(userId, token, selected.tipoServicio, available, signal)
          if (!signal.aborted) setDriverLocation(position)
          lastAvailability = available
          lastPublication = Date.now()
        }
        if (occupied || signal.aborted) return !signal.aborted

        const { offers } = await driverOffers(userId, token, signal)
        if (signal.aborted) return false
        const instant = Date.now()
        setNow(instant)
        setOffer(offers.find((item) => item.status === 'PENDING' && item.vehicleType === selected.tipoServicio && Date.parse(item.expiresAt) > instant) ?? null)
        return true
      } catch (err) {
        if (signal.aborted) return false
        if (err instanceof DriverSessionExpired) { onSessionExpired(); return false }
        setError(err instanceof Error ? err.message : 'No se pudo actualizar el despacho.')
        return true
      }
    })
  }, [assignment, busy, online, userId, token, onSessionExpired])

  async function perform(label: string, task: () => Promise<void>) {
    setBusy(label)
    setError('')
    try {
      await task()
    } catch (err) {
      if (err instanceof DriverSessionExpired) { onSessionExpired(); return }
      setError(err instanceof Error ? err.message : 'No se pudo completar la acción.')
    } finally {
      setBusy('')
    }
  }

  async function readQrPhoto(file: File) {
    if (!qrDetector) return
    await perform('Leyendo QR…', async () => {
      const image = await createImageBitmap(file)
      try {
        const [code] = await new qrDetector({ formats: ['qr_code'] }).detect(image)
        if (!code?.rawValue) throw new Error('No se pudo leer el QR. Probá otra foto o ingresá el código del pasajero.')
        setStartCode(code.rawValue)
      } finally {
        image.close()
      }
    })
  }

  async function startAssignedTrip(tripId: string, code: string) {
    await perform('Validando código…', async () => {
      const path = '/api/viajes/' + encodeURIComponent(tripId)
      try {
        const { viaje } = await request<{ viaje: Pick<Trip, 'estado'> }>('M6', path + '/iniciar', {
          method: 'POST', token, body: { codigoVerificacion: code.trim() },
        })
        setTrip((current) => current?.id === tripId ? { ...current, estado: viaje.estado } : current)
      } catch (error) {
        if (!(error instanceof FlowError) || ![0, 502, 503, 504].includes(error.status)) throw error
        const current = await request<Trip>('M6', path, { token }).catch(() => undefined)
        if (current?.estado !== 'EN_CURSO') throw error
        setTrip(current)
      }
      setStartCode('')
    })
  }

  async function confirmDestination(tripId: string) {
    await perform('Confirmando llegada…', async () => {
      const { destinoConfirmadoAt } = await request<{ destinoConfirmadoAt: string }>(
        'M6', '/api/viajes/' + encodeURIComponent(tripId) + '/destino', { method: 'POST', token, body: {} },
      )
      setTrip((current) => current?.id === tripId ? { ...current, destinoConfirmadoAt } : current)
    })
  }

  const active = Boolean(assignment || (trip && isActive(trip)))

  async function toggleAvailability() {
    if (!ready || active) return
    await perform('Actualizando disponibilidad…', async () => {
      const current = await driverTrip(userId, token, null)
      if (current && isActive(current)) {
        setTrip(current)
        setAssignment({ tripId: current.id })
        setOnline(true)
        return
      }

      if (online) {
        const selected = await ensureVehicle()
        await publishDriverLocation(userId, token, selected.tipoServicio, false)
        setOnline(false)
        setOffer(null)
        return
      }

      const selected = await ensureVehicle(true)
      setDriverLocation(await publishDriverLocation(userId, token, selected.tipoServicio, true))
      setTrip(null)
      setCompletedOffer(null)
      setOnline(true)
    })
  }

  function confirmAssignment(pending: Offer) {
    setTrip(null)
    setOffer(null)
    setAssignment({ offer: pending })
  }

  async function respond(pending: Offer, action: 'accept' | 'reject') {
    if (!online || active || Date.parse(pending.expiresAt) <= Date.now()) return
    await perform(action === 'accept' ? 'Confirmando el viaje…' : 'Rechazando la oferta…', async () => {
      try {
        if (action === 'accept' && (await ensureVehicle(true))?.tipoServicio !== pending.vehicleType) {
          setOffer(null)
          throw new Error('El vehículo activo cambió. Esperá una oferta para ese tipo de vehículo.')
        }
        const response = await request<{ requestStatus: string }>('M5', `/api/v1/offers/${pending.id}/${action}`, {
          method: 'POST', token, body: {},
        })
        if (action === 'accept' && response.requestStatus === 'ASSIGNED') confirmAssignment(pending)
        else setOffer(null)
      } catch (err) {
        if (action === 'accept' && err instanceof FlowError) {
          const snapshot = await driverOffers(userId, token).catch(() => null)
          if (snapshot?.offers.some((item) => item.id === pending.id && item.status === 'ACCEPTED')) {
            confirmAssignment(pending)
            return
          }
        }
        if (err instanceof FlowError && (err.status === 404 || err.status === 409)) {
          setOffer(null)
          if (err.code === 'REQUEST_ALREADY_ASSIGNED') {
            throw new Error('M5 informa que la solicitud sigue asignada a otro conductor. Esperamos una nueva oferta.')
          }
          if (err.code === 'OFFER_EXPIRED') {
            throw new Error('Venció el plazo de esta oferta. Te avisamos cuando llegue otra.')
          }
          throw new Error(err.message)
        }
        throw err
      }
    })
  }

  // RF-6.6: el conductor puede cancelar durante cualquier etapa activa. M6 le pide a M5
  // que vuelva a buscar conductor para el pasajero; el conductor queda libre para otra oferta.
  const cancellable = active && trip && ['SOLICITADO', 'ASIGNADO', 'CONDUCTOR_EN_CAMINO', 'ARRIBADO', 'EN_CURSO'].includes(trip.estado)

  const secondsLeft = offer ? Math.max(0, Math.ceil((Date.parse(offer.expiresAt) - now) / 1000)) : 0
  const pending = secondsLeft > 0 && !active ? offer : null
  const routeOffer = assignment?.offer ?? pending ?? completedOffer
  const showSummary = Boolean(active || pending || trip)
  const pickupAddress = active ? assignment?.offer?.origin.address ?? trip?.origen : pending?.origin.address ?? trip?.origen
  const dropoffAddress = active ? assignment?.offer?.destination.address ?? trip?.destino : pending?.destination.address ?? trip?.destino
  const fare = pending || !trip?.finalizacion ? routeOffer?.estimatedFare : undefined
  const finalFare = pending ? null : trip?.finalizacion
  const title = active ? (trip && rideStatus[trip.estado]) || 'Viaje asignado'
    : pending ? 'Nueva oferta de viaje'
      : online ? (trip && rideStatus[trip.estado]) || 'Buscando viajes' : 'Estás desconectado'
  const description = cancellable ? 'Podés cancelar el viaje si no podés continuar. Antes de iniciarlo, validá el código del pasajero.'
    : active ? 'La desconexión se habilita cuando el viaje termina o se cancela.'
    : pending ? 'Revisá el recorrido y confirmá si querés tomarlo.'
      : online ? 'Aceptar viaje se habilita cuando recibís una oferta.' : 'Conectate para recibir ofertas en esta zona.'
  const StatusIcon = active || (online && trip?.estado === 'COMPLETADO') ? CircleCheck : online ? Radar : Power

  // Mismo mapa que "Tu viaje": ruta por calles entre el origen y el destino de la oferta o el viaje.
  const showRoute = Boolean(routeOffer || (pickupAddress === origin.address && dropoffAddress === destination.address))
  const pickupPoint = routeOffer?.origin ?? origin
  const dropoffPoint = routeOffer?.destination ?? destination
  const [routeInfo, setRouteInfo] = useState<RouteInfo | null>(null)
  useEffect(() => {
    if (!showRoute) {
      setRouteInfo(null)
      return
    }
    const controller = new AbortController()
    fetchRoute(pickupPoint, dropoffPoint, controller.signal)
      .then((info) => { if (!controller.signal.aborted) setRouteInfo(info) })
      .catch(() => undefined)
    return () => controller.abort()
    // Se recalcula sólo cuando cambian las coordenadas del recorrido.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showRoute, pickupPoint.latitude, pickupPoint.longitude, dropoffPoint.latitude, dropoffPoint.longitude])

  return (
    <main className="driver-dispatch">
      <header className="driver-topbar">
        <button className="driver-back" aria-label="Volver a mi cuenta" disabled={Boolean(busy) || online || active} onClick={onBack}>
          <ArrowLeft size={19} aria-hidden="true" />
        </button>
        <h1 className="display">Disponibilidad del conductor</h1>
        <div className="driver-account" title={`${driver.nombre} ${driver.apellido}`}>
          <span aria-hidden="true">{`${driver.nombre[0] ?? ''}${driver.apellido[0] ?? ''}`.toUpperCase()}</span>
          <p>{driver.nombre} {driver.apellido}</p>
        </div>
      </header>

      <div className="driver-map-frame" data-trip={showSummary}>
        <RideMap driverView showRoute={showRoute} pickup={showRoute ? pickupPoint : driverLocation} dropoff={dropoffPoint}
          showLocation={Boolean(driverLocation)} vehiclePosition={showRoute && active && !trip?.destinoConfirmadoAt ? driverLocation : undefined}
          routeCoords={showRoute ? routeInfo?.coords : undefined} />
        <div className="driver-map-label"><MapPin size={16} aria-hidden="true" /> Área del viaje</div>
      </div>

      <section className="driver-console" aria-label="Disponibilidad y viajes">
        <div className="driver-status" data-active={online || active}>
          <div className="driver-status-icon"><StatusIcon size={24} aria-hidden="true" /></div>
          <div role="status">
            <h2>{ready || active ? busy || title : 'Consultando disponibilidad…'}</h2>
            <p>{description}</p>
          </div>
        </div>
        <button className="driver-toggle" data-online={online || active} disabled={Boolean(busy) || !ready || active} onClick={() => void toggleAvailability()}>
          {active ? <LockKeyhole size={18} aria-hidden="true" /> : <Power size={19} aria-hidden="true" />}
          {online || active ? 'Desconectarme' : 'Conectarme'}
        </button>
        {trip?.estado === 'EN_CURSO' && <div className="mt-3 grid gap-2">
          <TripClock startedAt={trip.iniciadoAt} endedAt={trip.destinoConfirmadoAt} />
          {trip.destinoConfirmadoAt
            ? <p role="status">Llegada confirmada. El pasajero ya puede finalizar el pago.</p>
            : <button className="btn-primary" disabled={Boolean(busy)} onClick={() => void confirmDestination(trip.id)}>Confirmar llegada al destino</button>}
        </div>}
        {trip?.estado === 'COMPLETADO' && trip.iniciadoAt && trip.completadoAt && (
          <TripClock startedAt={trip.iniciadoAt} endedAt={trip.completadoAt} />
        )}
        {trip?.estado === 'ARRIBADO' && <form className="ride-form" key={`start-${trip.id}`} onSubmit={(event) => {
          event.preventDefault()
          if (startCode.trim()) void startAssignedTrip(trip.id, startCode)
        }}>
          <label htmlFor="trip-start-code">Código de inicio del pasajero</label>
          <p className="ride-muted">Ingresá el código que muestra el pasajero.</p>
          {qrDetector && <label>Leer QR con una foto
            <input className="input-field" type="file" accept="image/*" capture="environment" disabled={Boolean(busy)}
              onChange={(event) => {
                const file = event.currentTarget.files?.[0]
                event.currentTarget.value = ''
                if (file) void readQrPhoto(file)
              }} />
          </label>}
          <input id="trip-start-code" className="input-field" autoComplete="off" value={startCode}
            onChange={(event) => setStartCode(event.target.value)} required />
          <button className="btn-primary" type="submit" disabled={Boolean(busy) || !startCode.trim()}>Validar e iniciar viaje</button>
        </form>}
        {cancellable && trip && <TripCancellation key={`cancel-${trip.id}`} trip={trip} actor="conductor" token={token} disabled={Boolean(busy)}
          onCancelled={(cancelledTrip) => {
            setTrip(cancelledTrip)
            setCompletedOffer(assignment?.offer ?? null)
            setAssignment(null)
          }} />}
        {error && <p className="alert-error driver-error" role="alert">{error}</p>}
        {!online && !active && ready && <div className="driver-trip-card">
          <button className="btn-ghost" type="button" disabled={Boolean(busy)} aria-expanded={showVehicles}
            onClick={() => setShowVehicles((value) => !value)}>{showVehicles ? 'Ocultar vehículos' : 'Gestionar vehículos'}</button>
          {showVehicles && <DriverVehicles driver={driver} onActivate={(selected) => {
            vehicle.current = selected
            setActiveVehicle(selected)
            setError('')
          }} />}
        </div>}

        {online && !active && <div className="driver-offer-actions" role="group" aria-label="Responder a la oferta">
          {pending && <button className="btn-ghost" disabled={Boolean(busy)} onClick={() => void respond(pending, 'reject')}>Rechazar</button>}
          {pending && <button className="btn-primary" disabled={Boolean(busy)} onClick={() => void respond(pending, 'accept')}>Aceptar viaje</button>}
        </div>}

        {showSummary && <div className="driver-trip-card">
          <div className="driver-trip-heading">
            <h3>{pending ? 'Detalles de la oferta' : 'Detalles del viaje'}</h3>
            {!pending && trip && <span className="driver-trip-reference" title={trip.id}>Viaje #{trip.id.slice(0, 8)}</span>}
            {pending && <span className="driver-offer-time" aria-label={`La oferta vence en ${secondsLeft} segundos`}>
              <Clock3 size={15} aria-hidden="true" /> {secondsLeft} s
            </span>}
          </div>
          <dl className="driver-trip-stops">
            <div><MapPin size={18} aria-hidden="true" /><div><dt>Origen</dt><dd>{pickupAddress || 'Cargando origen…'}</dd></div></div>
            <div><Navigation size={18} aria-hidden="true" /><div><dt>Destino</dt><dd>{dropoffAddress || 'Cargando destino…'}</dd></div></div>
          </dl>
          {(fare || finalFare) && <dl className="driver-trip-metrics">
            <div><dt>{finalFare ? 'Total del viaje' : 'Tarifa estimada'}</dt><dd>{finalFare ? currency(finalFare.total, finalFare.moneda) : fare && currency(fare.amount, fare.currency)}</dd></div>
            <div><dt>Distancia</dt><dd>{(finalFare?.distanciaKm ?? fare?.estimatedDistanceKm)?.toLocaleString('es-AR', { maximumFractionDigits: 1 })} km</dd></div>
            <div><dt>{finalFare ? 'Duración' : 'Duración estimada'}</dt><dd>{finalFare?.tiempoMinutos ?? fare?.estimatedDurationMin} min</dd></div>
          </dl>}
        </div>}

        {activeVehicle && <div className="driver-details">
          {activeVehicle.tipoServicio === 'MOTO' ? <Bike size={17} aria-hidden="true" /> : <CarFront size={17} aria-hidden="true" />}
          <span>{activeVehicle.tipoServicio === 'MOTO' ? 'Moto activa' : 'Auto activo'} <strong>{activeVehicle.patente}</strong></span>
        </div>}
      </section>
    </main>
  )
}
