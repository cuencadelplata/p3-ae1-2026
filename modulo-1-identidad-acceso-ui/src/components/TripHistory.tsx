import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, Download } from 'lucide-react'
import { downloadReceipt, request, type Receipt, type TripRecord } from '../rideFlowApi'
import { ticketStateLabel, type SupportTicket, type TicketOrder } from '../supportTickets'
import { useSupportTicketList } from '../useSupportTicketList'
import SupportChat from './SupportChat'
import SupportTicketFilters from './SupportTicketFilters'
import './RideFlow.css'

// Con conductor=true muestra los viajes que hizo como conductor y el soporte sirve para reportar al pasajero.
export default function TripHistory({ token, userId, conductor = false, onBack }: { token: string; userId: number; conductor?: boolean; onBack: () => void }) {
  const [trips, setTrips] = useState<TripRecord[]>([])
  const [tripOrder, setTripOrder] = useState<TicketOrder>('desc')
  const [showSupport, setShowSupport] = useState(false)
  const [selection, setSelection] = useState<TripRecord | null>(null)
  const [selectedChat, setSelectedChat] = useState<SupportTicket | null | 'auto'>(null)
  const list = useSupportTicketList(token, showSupport ? '/tickets/mios' : null, '', selection?.id)
  const chat = selectedChat === 'auto' ? (list.tickets.length === 1 ? list.tickets[0] : null) : selectedChat
  const orderedTrips = [...trips].sort((a, b) => {
    const comparison = Date.parse(a.fechaCreacion) - Date.parse(b.fechaCreacion) || a.id.localeCompare(b.id)
    return tripOrder === 'asc' ? comparison : -comparison
  })
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState('')
  const pending = useRef<{ tripId: string; reason: string; key: string } | null>(null)
  const supportTitle = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    const abort = new AbortController()
    const filters = new URLSearchParams({ [conductor ? 'conductorId' : 'clienteId']: String(userId), estado: 'COMPLETADO', limit: '100' })
    request<{ viajes: TripRecord[] }>('M6', '/api/viajes?' + filters, { token, signal: abort.signal })
      .then(({ viajes }) => { if (!abort.signal.aborted) setTrips(viajes) })
      .catch((cause: Error) => { if (!abort.signal.aborted) setError(cause.message) })
      .finally(() => { if (!abort.signal.aborted) setBusy(false) })
    return () => abort.abort()
  }, [token, userId, conductor])

  useEffect(() => {
    if (showSupport) supportTitle.current?.focus()
  }, [showSupport, selection])

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

  function openSupport(trip: TripRecord | null) {
    setError('')
    setShowSupport(true)
    setSelection(trip)
    setSelectedChat(trip ? 'auto' : null)
    setReason('')
    list.first()
  }

  async function createTicket(tripId: string) {
    // El prefijo le indica al operador que el reporte es del conductor sobre el pasajero.
    const motivo = reason.trim() && (conductor ? 'Reporte del conductor: ' : '') + reason.trim()
    if (!motivo) return
    if (pending.current?.tripId !== tripId || pending.current.reason !== motivo) {
      pending.current = { tripId, reason: motivo, key: crypto.randomUUID() }
    }
    const ticket = await request<SupportTicket>('M8', '/tickets', {
      method: 'POST', token, headers: { 'Idempotency-Key': pending.current.key }, body: { tripId, motivo },
    })
    pending.current = null
    setReason('')
    setSelectedChat(ticket)
    list.refresh()
  }

  return (
    <section className="glass w-full max-w-3xl rounded-[1.75rem] p-6 md:p-12" aria-busy={busy}>
      <button className="btn-ghost inline-flex items-center gap-2" onClick={onBack}><ArrowLeft size={16} /> Tu cuenta</button>
      <h1 className="display mt-4 text-3xl">Historial de viajes</h1>
      <div className="mt-4 flex flex-wrap items-end gap-3">
        {showSupport ? <button className="btn-ghost" disabled={busy} onClick={() => {
          setShowSupport(false)
          setSelectedChat(null)
          setError('')
        }}>Volver a mis viajes</button> : <>
          <label className="grid gap-1 text-sm">Orden de viajes
            <select className="input-field" value={tripOrder} onChange={event => setTripOrder(event.target.value === 'asc' ? 'asc' : 'desc')}>
              <option value="desc">Más nuevos primero</option>
              <option value="asc">Más antiguos primero</option>
            </select>
          </label>
          <button className="btn-ghost" disabled={busy} onClick={() => openSupport(null)}>Mis consultas de soporte</button>
        </>}
      </div>
      {error && <p className="alert-error mt-4" role="alert">{error}</p>}
      {!showSupport && !busy && !trips.length && !error && <p className="mt-4">Todavía no tenés viajes finalizados.</p>}
      {!showSupport && <ul className="mt-6 grid gap-3" aria-label="Viajes finalizados">
        {orderedTrips.map((trip) => <li className="rounded-xl border border-[var(--line)] p-4" key={trip.id}>
          <p className="font-semibold">{trip.origen} → {trip.destino}</p>
          <time className="ride-muted" dateTime={trip.fechaCreacion}>{new Date(trip.fechaCreacion).toLocaleString('es-AR')}</time>
          <div className="mt-3 flex flex-wrap gap-2">
            {!conductor && <button className="btn-secondary inline-flex items-center gap-2" disabled={busy} onClick={() => void perform(() => openReceipt(trip.id))}>
              <Download size={16} aria-hidden="true" /> Descargar PDF
            </button>}
            <button className="btn-ghost" disabled={busy} onClick={() => openSupport(trip)}>{conductor ? 'Reportar al pasajero' : 'Soporte del viaje'}</button>
          </div>
        </li>)}
      </ul>}
      {showSupport && <div className="mt-6 rounded-xl border border-[var(--line)] p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold" ref={supportTitle} tabIndex={-1}>
            {selection ? `Soporte · ${selection.origen} → ${selection.destino}` : 'Mis consultas de soporte'}
          </h2>
          {selection && <button className="btn-ghost" disabled={busy} onClick={() => openSupport(null)}>Ver todas mis consultas</button>}
        </div>
        {selection && <form className="ride-form mt-3" onSubmit={(event) => { event.preventDefault(); void perform(() => createTicket(selection.id)) }}>
          <label>{conductor ? 'Contanos qué pasó con el pasajero' : 'Contanos qué pasó'}<textarea className="input-field" required value={reason} onChange={(event) => setReason(event.target.value)} /></label>
          <button className="btn-primary" type="submit" disabled={busy || !reason.trim()}>{conductor ? 'Enviar reporte' : 'Crear consulta'}</button>
        </form>}
        <section className="mt-5" aria-label={selection ? 'Consultas del viaje' : 'Mis consultas'} aria-busy={list.loading}>
          <SupportTicketFilters {...list.filters} />
          {list.loading && <p className="ride-muted mt-3" role="status">Cargando consultas…</p>}
          {list.error && <div className="mt-3">
            <p className="alert-error" role="alert">{list.error}</p>
            <button className="btn-ghost mt-2" onClick={list.refresh}>Reintentar</button>
          </div>}
          {!list.loading && !list.error && list.tickets.length === 0 && <p className="ride-muted mt-3">No hay consultas para estos filtros.</p>}
          <ul className="mt-2 divide-y divide-[var(--line)]">{list.tickets.map(ticket => (
            <li key={ticket.id} className="py-3">
              <p className="break-words">{ticket.motivo} · {ticketStateLabel[ticket.estado]}</p>
              <time className="ride-muted block text-sm" dateTime={ticket.fechaCreacion}>{new Date(ticket.fechaCreacion).toLocaleString('es-AR')}</time>
              <button className="btn-ghost mt-2" disabled={busy} aria-expanded={chat?.id === ticket.id}
                onClick={() => setSelectedChat(chat?.id === ticket.id ? null : ticket)}>
                {chat?.id === ticket.id ? 'Cerrar chat' : 'Abrir chat'}
              </button>
            </li>
          ))}</ul>
          <div className="flex flex-wrap gap-2">
            {list.hasPrevious && <button className="btn-ghost" disabled={list.loading} onClick={list.first}>Primera página</button>}
            {list.hasNext && <button className="btn-ghost" disabled={list.loading} onClick={list.next}>Siguiente</button>}
          </div>
        </section>
        {chat && <SupportChat key={chat.id} ticket={chat} token={token} onTicketUpdated={updated => {
          setSelectedChat(current => current === 'auto' || current?.id === updated.id ? updated : current)
          list.refresh()
        }} />}
      </div>}
    </section>
  )
}
