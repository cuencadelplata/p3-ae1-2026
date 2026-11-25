import { ticketStateLabel, type TicketOrder, type TicketStatus } from '../supportTickets'

export default function SupportTicketFilters({ status, order, onStatus, onOrder }: {
  status: TicketStatus | ''
  order: TicketOrder
  onStatus: (status: TicketStatus | '') => void
  onOrder: (order: TicketOrder) => void
}) {
  return <fieldset className="flex w-full flex-wrap gap-2" aria-label="Filtros de consultas">
    <label className="grid min-w-0 flex-[1_1_10rem] gap-1 text-sm">Estado
      <select className="input-field" value={status} onChange={event => onStatus(event.target.value as TicketStatus | '')}>
        <option value="">Todos los estados</option>
        {Object.entries(ticketStateLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select>
    </label>
    <label className="grid min-w-0 flex-[1_1_10rem] gap-1 text-sm">Orden por fecha
      <select className="input-field" value={order} onChange={event => onOrder(event.target.value === 'asc' ? 'asc' : 'desc')}>
        <option value="desc">Más nuevas primero</option>
        <option value="asc">Más antiguas primero</option>
      </select>
    </label>
  </fieldset>
}
