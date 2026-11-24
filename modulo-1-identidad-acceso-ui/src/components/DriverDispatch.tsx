import { useEffect, useState } from 'react'
import { ArrowLeft, CarFront, CircleCheck, MapPin, Power, Radar } from 'lucide-react'
import RideMap from './RideMap'
import { destination, FlowError, origin, pollTrip, prepareDriver, publishDriverLocation, request } from '../rideFlowApi'
import type { Account, Offer } from '../rideFlowApi'
import './RideFlow.css'
import './DriverDispatch.css'

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

  const status = busy ? 'Actualizando disponibilidad…' : assigned ? 'Viaje asignado' : online ? 'Buscando viajes' : 'Estás desconectado'
  const StatusIcon = assigned ? CircleCheck : online ? Radar : Power

  return (
    <main className="driver-dispatch">
      <header className="driver-topbar">
        <button className="driver-back" aria-label="Volver a mi cuenta" disabled={busy || online} onClick={onBack}>
          <ArrowLeft size={19} aria-hidden="true" />
        </button>
        <h1 className="display">Disponibilidad del conductor</h1>
        <div className="driver-account" title={`${driver.nombre} ${driver.apellido}`}>
          <span aria-hidden="true">{`${driver.nombre[0] ?? ''}${driver.apellido[0] ?? ''}`.toUpperCase()}</span>
          <p>{driver.nombre} {driver.apellido}</p>
        </div>
      </header>

      <div className="driver-map-frame">
        <RideMap driverView showRoute={assigned} />
        <div className="driver-map-label"><MapPin size={16} aria-hidden="true" /> Corrientes <span>Zona de prueba</span></div>
      </div>

      <section className="driver-console" aria-label="Disponibilidad y viajes">
        <div className="driver-status" data-active={online || assigned}>
          <div className="driver-status-icon"><StatusIcon size={24} aria-hidden="true" /></div>
          <div role="status">
            <h2>{status}</h2>
            <p>{assigned ? 'Esperá a que el pasajero termine el viaje antes de volver a conectarte.'
              : online ? 'Tu auto ya está disponible. La próxima oferta de prueba se acepta automáticamente.'
                : 'Conectate para recibir una oferta de prueba en esta zona.'}</p>
          </div>
        </div>
        {error && <p className="alert-error driver-error" role="alert">{error}</p>}
        <button className="driver-toggle" data-online={online} disabled={busy} onClick={() => void toggleAvailability()}>
          <Power size={19} aria-hidden="true" /> {online ? 'Desconectarme' : 'Conectarme'}
        </button>
        <div className="driver-details">
          <CarFront size={17} aria-hidden="true" />
          {plate ? <span>Auto de prueba <strong>{plate}</strong></span> : <span>Auto de prueba · {origin.address}</span>}
          {assigned && <span className="driver-destination"><MapPin size={16} aria-hidden="true" /> {destination.address}</span>}
        </div>
      </section>
    </main>
  )
}
