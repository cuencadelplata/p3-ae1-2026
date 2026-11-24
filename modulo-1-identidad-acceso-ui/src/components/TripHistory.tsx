import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, Download } from 'lucide-react'
import { downloadReceipt, request, type Receipt, type TripRecord } from '../rideFlowApi'
import './RideFlow.css'

interface Ticket {
  id: string
  motivo: string
  estado: string
}

export default function TripHistory({ token, userId, onBack }: { token: string; userId: number; onBack: () => void }) {
  const [trips, setTrips] = useState<TripRecord[]>([])
  const [selection, setSelection] = useState<TripRecord | null>(null)
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState('')
  const pending = useRef<{ tripId: string; reason: string; key: string } | null>(null)
  const supportTitle = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    const abort = new AbortController()
    const filters = new URLSearchParams({ clienteId: String(userId), estado: 'COMPLETADO', limit: '100' })
    request<{ viajes: TripRecord[] }>('M6', '/api/viajes?' + filters, { token, signal: abort.signal })
      .then(({ viajes }) => { if (!abort.signal.aborted) setTrips(viajes) })
      .catch((cause: Error) => { if (!abort.signal.aborted) setError(cause.message) })
      .finally(() => { if (!abort.signal.aborted) setBusy(false) })
    return () => abort.abort()
  }, [token, userId])

  useEffect(() => {
    if (selection) supportTitle.current?.focus()
  }, [selection])

  async function perform(action: () => Promise<void>) {
    setError('')
    setBusy(true)
    try { await action() } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'La operación no se pudo completar.')
    } finally { setBusy(false) }
  }

  async function openReceipt(tripId: string) {
    const path = '/api/v1/receipts/' + encodeURIComponent(tripId)
    const receipt = await request<{ data: Receipt }>('M8', path, { token })
    await downloadReceipt(tripId, receipt.data.receiptNumber, token)
  }

  async function loadTickets(tripId: string) {
    const response = await request<Ticket[]>('M8', '/tickets/mios?' + new URLSearchParams({ tripId }), { token })
    setTickets(response)
  }

  async function openSupport(trip: TripRecord) {
    setSelection(trip)
    setTickets([])
    setReason('')
    await loadTickets(trip.id)
  }

  async function createTicket(tripId: string) {
    const motivo = reason.trim()
    if (!motivo) return
    if (pending.current?.tripId !== tripId || pending.current.reason !== motivo) {
      pending.current = { tripId, reason: motivo, key: crypto.randomUUID() }
    }
    const ticket = await request<Ticket>('M8', '/tickets', {
      method: 'POST', token, headers: { 'Idempotency-Key': pending.current.key }, body: { tripId, motivo },
    })
    pending.current = null
    setReason('')
    setTickets((current) => [ticket, ...current.filter((item) => item.id !== ticket.id)])
  }

  return (
    <section className="glass w-full max-w-3xl rounded-[1.75rem] p-6 md:p-12" aria-busy={busy}>
      <button className="btn-ghost inline-flex items-center gap-2" onClick={onBack}><ArrowLeft size={16} /> Tu cuenta</button>
      <h1 className="display mt-4 text-3xl">Historial de viajes</h1>
      {error && <p className="alert-error mt-4" role="alert">{error}</p>}
      {!busy && !trips.length && !error && <p className="mt-4">Todavía no tenés viajes finalizados.</p>}
      <ul className="mt-6 grid gap-3">
        {trips.map((trip) => <li className="rounded-xl border border-[var(--line)] p-4" key={trip.id}>
          <p className="font-semibold">{trip.origen} → {trip.destino}</p>
          <p className="ride-muted">{new Date(trip.fechaCreacion).toLocaleString('es-AR')}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button className="btn-secondary inline-flex items-center gap-2" disabled={busy} onClick={() => void perform(() => openReceipt(trip.id))}>
              <Download size={16} aria-hidden="true" /> Descargar PDF
            </button>
            <button className="btn-ghost" disabled={busy} onClick={() => void perform(() => openSupport(trip))}>Soporte del viaje</button>
          </div>
        </li>)}
      </ul>
      {selection && <div className="mt-6 rounded-xl border border-[var(--line)] p-4">
        <h2 className="font-semibold" ref={supportTitle} tabIndex={-1}>Soporte · {selection.origen} → {selection.destino}</h2>
        <form className="ride-form mt-3" onSubmit={(event) => { event.preventDefault(); void perform(() => createTicket(selection.id)) }}>
          <label>Contanos qué pasó<textarea className="input-field" required value={reason} onChange={(event) => setReason(event.target.value)} /></label>
          <button className="btn-primary" type="submit" disabled={busy || !reason.trim()}>Crear consulta</button>
        </form>
        <ul className="mt-3 grid gap-2">{tickets.map((ticket) => <li key={ticket.id}>{ticket.motivo} · {ticket.estado.replaceAll('_', ' ').toLowerCase()}</li>)}</ul>
      </div>}
    </section>
  )
}
