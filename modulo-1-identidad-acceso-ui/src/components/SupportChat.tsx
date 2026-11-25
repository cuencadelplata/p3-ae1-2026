import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Send } from 'lucide-react'
import { FlowError, request } from '../rideFlowApi'
import { ticketStateLabel, type SupportTicket, type TicketChange, type TicketStatus } from '../supportTickets'
import './SupportChat.css'

const transitions: Record<TicketStatus, TicketStatus[]> = {
  ABIERTO: ['EN_PROCESO', 'RESUELTO'],
  EN_PROCESO: ['RESUELTO', 'ABIERTO'],
  RESUELTO: ['ABIERTO'],
}

type Props = {
  ticket: SupportTicket
  token: string
  operator?: boolean
  onTicketUpdated: (ticket: SupportTicket) => void
}

const messageTime = new Intl.DateTimeFormat('es-AR', { dateStyle: 'short', timeStyle: 'short' })

export default function SupportChat({ ticket, token, operator = false, onTicketUpdated }: Props) {
  const [conversation, setConversation] = useState<{ ticket: SupportTicket; changes: TicketChange[] }>()
  const [text, setText] = useState('')
  const [target, setTarget] = useState<TicketStatus | ''>('')
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState('')
  const [refreshError, setRefreshError] = useState('')
  const [revision, setRevision] = useState(0)
  const [confirmedVersion, setConfirmedVersion] = useState(0)
  const scroller = useRef<HTMLDivElement>(null)
  const stayAtEnd = useRef(true)
  const path = '/tickets/' + encodeURIComponent(ticket.id)
  const current = conversation?.ticket ?? ticket
  const changes = conversation?.changes
  const creator = changes?.find(change => change.estadoAnterior === null)?.cambiadoPor
  const lastEntry = changes?.at(-1)?.id
  const selectedStatus = target && transitions[current.estado].includes(target) ? target : ''
  // El operador marca el reporte como desfavorable: M8 penaliza al cliente del viaje y M2 recalcula su estado.
  const [penalty, setPenalty] = useState<{ sending: boolean; message: string; failed: boolean }>({ sending: false, message: '', failed: false })

  async function markUnfavorable() {
    setPenalty({ sending: true, message: '', failed: false })
    try {
      // Motivo fijo por ticket: si se repite, M8 responde 200 con la misma penalización.
      const motivo = ('Reporte desfavorable confirmado por Soporte: ' + ticket.motivo).slice(0, 500)
      await request('M8', path + '/penalizacion', { token, method: 'POST', body: { motivo } })
      setPenalty({ sending: false, message: 'Penalización registrada para el pasajero de este viaje.', failed: false })
    } catch (error) {
      const message = error instanceof FlowError && error.status === 409
        ? 'Ya hay una penalización registrada para el pasajero de este viaje.'
        : error instanceof Error ? error.message : 'No se pudo registrar la penalización.'
      setPenalty({ sending: false, message, failed: true })
    }
  }

  useEffect(() => {
    const abort = new AbortController()
    let timer: number
    let loadedVersion: number | undefined
    async function refresh() {
      try {
        const updated = await request<SupportTicket>('M8', path, { token, signal: abort.signal })
        if (loadedVersion !== updated.version) {
          const history = await request<TicketChange[]>('M8', path + '/historial', { token, signal: abort.signal })
          if (!abort.signal.aborted) setConversation({ ticket: updated, changes: history })
          loadedVersion = updated.version
        }
        if (!abort.signal.aborted) setRefreshError('')
      } catch (error) {
        if (abort.signal.aborted) return
        if (error instanceof FlowError && [401, 403, 404].includes(error.status)) {
          setConversation(undefined)
          setRefreshError(error.message)
          return
        }
        setRefreshError('No se pudo actualizar la conversación. Reintentando…')
      }
      if (!abort.signal.aborted) timer = window.setTimeout(refresh, 3000)
    }
    void refresh()
    return () => { abort.abort(); window.clearTimeout(timer) }
  }, [path, token, revision])

  useEffect(() => {
    if (scroller.current && stayAtEnd.current) scroller.current.scrollTop = scroller.current.scrollHeight
  }, [lastEntry])

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const message = text.trim()
    if (!message || sending || !conversation || current.version < confirmedVersion) return
    const changeState = operator && selectedStatus
    setSending(true)
    setSendError('')
    try {
      const updated = changeState
        ? await request<SupportTicket>('M8', path + '/estado', {
            token, method: 'PATCH',
            body: { estado: selectedStatus, motivo: message, expectedVersion: current.version, registrarRespuesta: true },
          })
        : await request<SupportTicket>('M8', path + '/mensajes', {
            token, method: 'POST', body: { texto: message, expectedVersion: current.version },
          })
      setConfirmedVersion(updated.version)
      setText('')
      setTarget('')
      stayAtEnd.current = true
      onTicketUpdated(updated)
      setRevision(value => value + 1)
    } catch (error) {
      if (error instanceof FlowError && error.status === 409) {
        setSendError('Llegó una actualización. Revisá la conversación y volvé a enviar tu mensaje.')
        setRevision(value => value + 1)
      } else {
        setSendError(error instanceof Error ? error.message : 'No se pudo enviar el mensaje.')
      }
    } finally {
      setSending(false)
    }
  }

  const available = Boolean(conversation) && current.version >= confirmedVersion
  return <section className="support-chat" aria-label="Conversación de soporte">
    <header className="support-chat__header">
      <h3>{operator ? 'Conversación con el cliente' : 'Chat con soporte'}</h3>
      <span className="support-chat__status">{ticketStateLabel[current.estado]}</span>
    </header>
    <div ref={scroller} className="support-chat__scroll" role="log" aria-label="Mensajes de la consulta"
      onScroll={event => {
        const box = event.currentTarget
        stayAtEnd.current = box.scrollHeight - box.scrollTop - box.clientHeight < 40
      }}>
      {!conversation && !refreshError && <p role="status">Cargando conversación…</p>}
      <ol className="support-chat__messages">
        {changes?.map(change => {
          const initial = change.estadoAnterior === null
          const fromCreator = initial || Boolean(creator && change.cambiadoPor === creator)
          const own = operator ? !fromCreator : fromCreator
          const message = initial ? ticket.motivo : change.motivo
          const stateChanged = !initial && change.estadoAnterior !== change.estadoNuevo
          return <li key={change.id}>
            {stateChanged && <p className="support-chat__event">Estado: {ticketStateLabel[change.estadoNuevo]}</p>}
            {message && <div className="support-chat__bubble" data-own={own}>
              <strong>{fromCreator ? (operator ? 'Cliente' : 'Vos') : (operator ? 'Vos · Soporte' : 'Soporte')}</strong>
              <p>{message}</p>
              <time dateTime={change.fecha}>{messageTime.format(new Date(change.fecha))}</time>
            </div>}
          </li>
        })}
      </ol>
    </div>
    {refreshError && <p className="support-chat__notice" role="status">{refreshError}</p>}
    <form className="support-chat__composer" onSubmit={event => void send(event)}>
      {operator && <label className="support-chat__state">Estado de la consulta
        <select className="input-field" disabled={!available || sending}
          value={selectedStatus}
          onChange={event => setTarget(event.target.value as TicketStatus | '')}>
          <option value="">Mantener {ticketStateLabel[current.estado]}</option>
          {transitions[current.estado].map(status => <option key={status} value={status}>{ticketStateLabel[status]}</option>)}
        </select>
      </label>}
      <div className="support-chat__compose-row">
        <textarea aria-label="Mensaje" className="input-field" value={text} onChange={event => setText(event.target.value)}
          rows={2} maxLength={2000} placeholder="Escribí un mensaje…" disabled={sending} />
        <button className="btn-primary" type="submit" disabled={!text.trim() || !available || sending}>
          <Send size={16} aria-hidden="true" /> {sending ? 'Enviando…' : 'Enviar'}
        </button>
      </div>
      {sendError && <p className="support-chat__notice" role="alert">{sendError}</p>}
    </form>
    {operator && current.estado === 'RESUELTO' && <div className="support-chat__composer">
      <button className="btn-secondary" type="button" disabled={penalty.sending} onClick={() => void markUnfavorable()}>
        {penalty.sending ? 'Registrando…' : 'Marcar desfavorable para el pasajero'}
      </button>
      {penalty.message && <p className="support-chat__notice" role={penalty.failed ? 'alert' : 'status'}>{penalty.message}</p>}
    </div>}
  </section>
}
