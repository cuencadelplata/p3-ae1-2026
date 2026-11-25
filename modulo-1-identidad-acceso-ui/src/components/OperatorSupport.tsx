import { useState } from 'react'
import { ArrowLeft } from 'lucide-react'
import { ticketStateLabel, type SupportTicket } from '../supportTickets'
import { useSupportTicketList } from '../useSupportTicketList'
import SupportChat from './SupportChat'
import SupportTicketFilters from './SupportTicketFilters'
import './RideFlow.css'

export default function OperatorSupport({ token, onBack }: { token: string; onBack: () => void }) {
  const [selected, setSelected] = useState<SupportTicket | null>(null)
  const list = useSupportTicketList(token, '/tickets', 'ABIERTO')

  return (
    <section className="glass w-full max-w-5xl rounded-[1.75rem] p-5 md:p-8">
      <button className="btn-ghost inline-flex items-center gap-2" onClick={onBack}><ArrowLeft size={16} /> Tu cuenta</button>
      <h1 className="display mt-4 text-3xl">Soporte</h1>
      <div className="mt-5 grid gap-6 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <div aria-busy={list.loading}>
          <div className="flex flex-wrap items-end justify-between gap-2">
            <SupportTicketFilters {...list.filters} />
            <button className="btn-ghost" disabled={list.loading} onClick={list.refresh}>Actualizar</button>
          </div>
          {list.error && <p className="alert-error mt-3" role="alert">{list.error}</p>}
          {!list.loading && !list.error && list.tickets.length === 0 && <p className="ride-muted mt-3">No hay consultas en esta vista.</p>}
          <ul className="mt-3 divide-y divide-[var(--line)]">
            {list.tickets.map(ticket => <li key={ticket.id}>
              <button className="btn-ghost my-1 w-full text-left" aria-pressed={selected?.id === ticket.id} disabled={list.loading}
                onClick={() => setSelected(ticket)}>
                <span className="block break-words font-semibold">{ticket.motivo}</span>
                <span className="ride-muted text-sm">{ticketStateLabel[ticket.estado]} · {new Date(ticket.fechaCreacion).toLocaleString('es-AR')}</span>
              </button>
            </li>)}
          </ul>
          <div className="mt-3 flex flex-wrap gap-2">
            {list.hasPrevious && <button className="btn-ghost" disabled={list.loading} onClick={list.first}>Primera página</button>}
            {list.hasNext && <button className="btn-ghost" disabled={list.loading} onClick={list.next}>Siguiente</button>}
          </div>
        </div>
        <div className="detail-card min-w-0">
          {selected ? <>
            <p className="ride-muted break-words text-sm">Viaje {selected.tripId}</p>
            <SupportChat key={selected.id} ticket={selected} token={token} operator onTicketUpdated={updated => {
              setSelected(current => current?.id === updated.id ? updated : current)
              list.refresh()
            }} />
          </> : <p className="ride-muted text-sm">Elegí una consulta para abrir la conversación.</p>}
        </div>
      </div>
    </section>
  )
}
