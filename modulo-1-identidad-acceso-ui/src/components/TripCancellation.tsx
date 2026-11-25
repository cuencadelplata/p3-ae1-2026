import { useRef, useState } from 'react'
import { request } from '../rideFlowApi'
import type { Trip } from '../rideFlowApi'
import './TripCancellation.css'

/** RF-6.5/6.6: motivo y confirmación de la cancelación dentro del viaje activo. */
export default function TripCancellation({ trip, actor, token, disabled, onCancelled, requestCancellation }: {
  trip: Pick<Trip, 'id' | 'estado' | 'origen' | 'destino'>
  actor: 'cliente' | 'conductor'
  token: string
  disabled?: boolean
  onCancelled?: (trip: Trip) => void
  requestCancellation?: (motivo: string) => Promise<void>
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const submitting = useRef(false)
  const [reason, setReason] = useState('')
  const [reviewing, setReviewing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const title = requestCancellation ? 'Cancelar búsqueda' : 'Cancelar viaje'
  const cancellable = ['SOLICITADO', 'ASIGNADO', 'CONDUCTOR_EN_CAMINO', 'ARRIBADO', 'EN_CURSO'].includes(trip.estado)

  function open() {
    setReason('')
    setError('')
    setReviewing(false)
    dialog.current?.showModal()
  }

  async function confirm() {
    if (submitting.current || !reason.trim() || !cancellable || disabled) return
    submitting.current = true
    setBusy(true)
    setError('')
    try {
      if (requestCancellation) {
        await requestCancellation(reason.trim())
        dialog.current?.close()
        return
      }
      const { viaje } = await request<{ viaje: Trip }>('M6-cancelacion', `/api/viajes/${encodeURIComponent(trip.id)}/cancelacion-${actor}`, {
        method: 'POST', token, body: { motivo: reason.trim() },
      })
      if (!viaje || viaje.id !== trip.id || viaje.estado !== 'CANCELADO') {
        throw new Error('No se confirmó la cancelación del viaje. Consultá su estado antes de reintentar.')
      }
      dialog.current?.close()
      onCancelled?.(viaje)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cancelar el viaje. Volvé a intentar.')
    } finally {
      submitting.current = false
      setBusy(false)
    }
  }

  return <>
    <button type="button" className={actor === 'conductor' ? 'btn-ghost driver-cancel' : 'btn-ghost'} disabled={disabled || !cancellable} onClick={open}>{title}</button>
    <dialog ref={dialog} className="trip-cancellation" aria-label={title} onCancel={(event) => { if (busy) event.preventDefault() }}>
      <h2>{title}</h2>
      <p>{trip.origen} → {trip.destino}</p>
      <p>{requestCancellation ? 'Se detendrá la búsqueda y se retirarán las ofertas pendientes.' : actor === 'conductor' ? 'El pasajero volverá a la búsqueda de conductor.' : 'Tu viaje quedará cancelado.'} No podrás deshacer esta acción.</p>
      <form onSubmit={(event) => { event.preventDefault(); if (reviewing) void confirm(); else if (reason.trim()) setReviewing(true) }}>
        <label>Motivo de cancelación
          <textarea autoFocus required maxLength={240} value={reason} disabled={busy || reviewing} onChange={(event) => setReason(event.target.value)} />
        </label>
        <p className="ride-muted">{reason.length} / 240</p>
        {reviewing && <p>Revisá el motivo y confirmá la cancelación.</p>}
        {!cancellable && <p role="status">El viaje cambió de estado y ya no puede cancelarse.</p>}
        {error && <p role="alert">{error}</p>}
        <div className="trip-cancellation-actions">
          <button type="button" className="btn-ghost" disabled={busy} onClick={() => dialog.current?.close()}>{requestCancellation ? 'Seguir buscando' : 'Seguir con el viaje'}</button>
          {reviewing && <button type="button" className="btn-ghost" disabled={busy} onClick={() => setReviewing(false)}>Editar motivo</button>}
          <button className="btn-primary" disabled={busy || disabled || !cancellable || !reason.trim()}>{busy ? 'Cancelando…' : reviewing ? 'Confirmar cancelación' : 'Revisar cancelación'}</button>
        </div>
      </form>
    </dialog>
  </>
}
