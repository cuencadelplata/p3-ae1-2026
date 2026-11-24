import { useEffect, useState } from 'react'
import { ArrowLeft, CarFront } from 'lucide-react'
import { destination, FlowError, origin, pollTrip, prepareDriver, publishDriverLocation, request } from '../rideFlowApi'
import type { Account, Offer } from '../rideFlowApi'
import './RideFlow.css'

function isDemoOffer(offer: Offer) {
  return offer.status === 'PENDING' && offer.origin?.latitude === origin.latitude && offer.origin?.longitude === origin.longitude
    && offer.destination?.latitude === destination.latitude && offer.destination?.longitude === destination.longitude
}

export default function DriverDispatch({ driver, onBack }: { driver: Account; onBack: () => void }) {
  const { userId, token } = driver
  const [online, setOnline] = useState(false)
  const [busy, setBusy] = useState(false)
  const [plate, setPlate] = useState('')
  const [assigned, setAssigned] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!online) return
    let lastPublication = Date.now()

    return pollTrip(async (signal) => {
      try {
        if (Date.now() - lastPublication >= 20_000) {
          await publishDriverLocation(userId, token, true, signal)
          lastPublication = Date.now()
        }
        const { offers } = await request<{ offers: Offer[] }>('M5', `/api/v1/drivers/${userId}/offers`, { token, signal })
        const pending = offers.find(isDemoOffer)
        if (!pending || signal.aborted) return !signal.aborted

        const result = await request<{ requestStatus: string }>('M5', `/api/v1/offers/${pending.id}/accept`, {
          method: 'POST', body: {}, token, signal,
        })
        if (result.requestStatus !== 'ASSIGNED') return true
        if (signal.aborted) return false

        setAssigned(true)
        setOnline(false)
        return false
      } catch (err) {
        if (signal.aborted) return false
        // Otra sesión puede haber aceptado la misma solicitud mientras se procesaba esta oferta.
        if (err instanceof FlowError && err.status === 409) return true
        setError(err instanceof Error ? err.message : 'No se pudieron consultar las ofertas.')
        setOnline(false)
        return false
      }
    })
  }, [online, userId, token])

  async function toggleAvailability() {
    setBusy(true)
    setError('')
    try {
      if (online) {
        setOnline(false)
        await publishDriverLocation(userId, token, false)
        return
      }

      const vehiclePlate = await prepareDriver(driver)
      await publishDriverLocation(userId, token, true)
      setPlate(vehiclePlate)
      setAssigned(false)
      setOnline(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cambiar la disponibilidad.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="ride-flow max-w-xl">
      <header className="ride-flow-header">
        <button className="btn-ghost" disabled={busy || online} onClick={onBack}><ArrowLeft size={16} aria-hidden="true" /> Volver a mi cuenta</button>
      </header>
      <section className="glass ride-flow-panel ride-action" aria-label="Despacho del conductor">
        <h1 className="display ride-flow-title">Disponibilidad del conductor</h1>
        <p>{driver.nombre} {driver.apellido}{plate && ` · ${plate}`}</p>
        <p>Esta sesión de prueba publica tu auto en {origin.address} para el recorrido hacia {destination.address} y acepta una oferta de viaje automáticamente.</p>
        {error && <p className="alert-error" role="alert">{error}</p>}
        {online && <p className="alert-success" role="status">Disponible. Esperando una oferta…</p>}
        {assigned && <p className="alert-success" role="status">Oferta aceptada. Esperá a que el pasajero termine el viaje antes de volver a conectarte.</p>}
        <button className="btn-primary inline-flex items-center gap-2" disabled={busy} onClick={() => void toggleAvailability()}>
          <CarFront size={18} aria-hidden="true" /> {busy ? 'Actualizando disponibilidad…' : online ? 'Dejar de recibir ofertas' : 'Conectarme para aceptar una oferta'}
        </button>
      </section>
    </div>
  )
}
