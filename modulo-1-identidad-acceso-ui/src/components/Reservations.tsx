import { useEffect, useState, type FormEvent } from 'react'
import { ArrowLeft } from 'lucide-react'
import { FlowError, request } from '../rideFlowApi'
import './RideFlow.css'

interface Reservation {
  id: string
  origen: string
  destino: string
  vehiculo: 'AUTO' | 'MOTO'
  fechaHoraProgramada: string
  estado: 'PROGRAMADA' | 'ACTIVANDO' | 'ACTIVADA' | 'CANCELADA' | 'FALLIDA'
  tarifaEstimada: number | null
  moneda: string | null
}

const empty = { origen: '', destino: '', vehiculo: 'AUTO', horario: '' }
const states = { PROGRAMADA: 'Programada', ACTIVANDO: 'Activando', ACTIVADA: 'Activada', CANCELADA: 'Cancelada', FALLIDA: 'No se pudo activar' }

function localTime(iso: string) {
  const date = new Date(iso)
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
}

export default function Reservations({ token, onBack, onOpenTrip }: {
  token: string
  onBack: () => void
  onOpenTrip: () => void
}) {
  const [page, setPage] = useState(1)
  const [rows, setRows] = useState<Reservation[]>([])
  const [draft, setDraft] = useState(empty)
  const [editing, setEditing] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  const pageSize = 20

  useEffect(() => {
    const abort = new AbortController()
    let nextRefresh: ReturnType<typeof setTimeout>
    setLoading(true)
    async function refresh() {
      try {
        const { reservas } = await request<{ reservas: Reservation[] }>('M9', '/reservas?page=' + page + '&pageSize=' + pageSize, { token, signal: abort.signal })
        if (!abort.signal.aborted) setRows(reservas)
      } catch (cause) {
        if (!abort.signal.aborted) setError(cause instanceof Error ? cause.message : 'No se pudieron consultar las reservas.')
      } finally {
        if (!abort.signal.aborted) {
          setLoading(false)
          nextRefresh = setTimeout(refresh, 5000)
        }
      }
    }
    void refresh()
    return () => {
      abort.abort()
      clearTimeout(nextRefresh)
    }
  }, [page, revision, token])

  function clear() {
    setDraft(empty)
    setEditing(null)
  }

  async function mutate(action: () => Promise<unknown>, firstPage = false) {
    setBusy(true)
    setError('')
    try {
      await action()
      if (firstPage) setPage(1)
      setRevision((value) => value + 1)
    } catch (cause) {
      if (cause instanceof FlowError && cause.code === 'SERVICIO_EXTERNO_RECURSO_NO_ENCONTRADO' && cause.message.includes('M4')) {
        setError('No encontramos una de las direcciones. Revisá el nombre de la calle y agregá la ciudad y la provincia.')
      } else {
        setError(cause instanceof Error ? cause.message : 'No se pudo actualizar la reserva.')
      }
    } finally {
      setBusy(false)
    }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const time = new Date(draft.horario)
    if (!(time.getTime() > Date.now())) {
      setError('Elegí una fecha y hora futuras.')
      return
    }
    await mutate(async () => {
      const route = editing ? '/reservas/' + encodeURIComponent(editing) : '/reservas'
      await request('M9', route, {
        method: editing ? 'PATCH' : 'POST', token,
        body: { origen: draft.origen.trim(), destino: draft.destino.trim(), vehiculo: draft.vehiculo, fechaHoraProgramada: time.toISOString() },
      })
      clear()
    }, !editing)
  }

  function beginEdit(row: Reservation) {
    setEditing(row.id)
    setDraft({ origen: row.origen, destino: row.destino, vehiculo: row.vehiculo, horario: localTime(row.fechaHoraProgramada) })
  }

  return (
    <section className="glass w-full max-w-3xl rounded-[1.75rem] p-6 md:p-12">
      <button className="btn-ghost inline-flex items-center gap-2" onClick={onBack}><ArrowLeft size={16} /> Tu cuenta</button>
      <h1 className="display mt-4 text-3xl">Mis reservas</h1>
      {error && <p className="alert-error mt-4" role="alert">{error}</p>}
      <form className="ride-form mt-6" onSubmit={(event) => void save(event)}>
        <h2 className="eyebrow">{editing ? 'Editar reserva' : 'Programar un viaje'}</h2>
        <fieldset className="grid gap-3" disabled={busy}>
          <label>Origen<input className="input-field" placeholder="Calle, altura, ciudad y provincia" value={draft.origen} maxLength={500} required onChange={(event) => setDraft({ ...draft, origen: event.target.value })} /></label>
          <label>Destino<input className="input-field" placeholder="Calle, altura, ciudad y provincia" value={draft.destino} maxLength={500} required onChange={(event) => setDraft({ ...draft, destino: event.target.value })} /></label>
          <label>Fecha y hora<input className="input-field" type="datetime-local" value={draft.horario} required onChange={(event) => setDraft({ ...draft, horario: event.target.value })} /></label>
          <label>Vehículo<select className="input-field" value={draft.vehiculo} onChange={(event) => setDraft({ ...draft, vehiculo: event.target.value })}><option value="AUTO">Auto</option><option value="MOTO">Moto</option></select></label>
          <button className="btn-primary" type="submit">{editing ? 'Guardar cambios' : 'Programar viaje'}</button>
          {editing && <button className="btn-ghost" type="button" onClick={clear}>Volver</button>}
        </fieldset>
      </form>
      <div className="mt-8" aria-busy={loading}>
        <button className="btn-ghost" disabled={loading || busy} onClick={() => { setError(''); setRevision((value) => value + 1) }}>Actualizar reservas</button>
        {loading ? <p role="status">Consultando tus reservas…</p> : rows.length === 0 && !error && <p>Todavía no hay reservas en esta página.</p>}
        <ul className="mt-4 grid gap-3">
          {rows.map((row) => <li key={row.id} className="rounded-xl border border-[var(--line)] p-4">
            <p className="font-semibold">{row.origen} → {row.destino}</p>
            <p>{new Date(row.fechaHoraProgramada).toLocaleString('es-AR')} · {row.vehiculo === 'AUTO' ? 'Auto' : 'Moto'}</p>
            <p className="ride-muted" aria-live="polite">{states[row.estado]}</p>
            {row.tarifaEstimada !== null && row.moneda && <p>Estimado {new Intl.NumberFormat('es-AR', { style: 'currency', currency: row.moneda }).format(row.tarifaEstimada)}</p>}
            {row.estado === 'ACTIVADA' && <button className="btn-ghost mt-2" onClick={onOpenTrip}>Ver viaje activo</button>}
            {row.estado === 'PROGRAMADA' && <div className="mt-2 flex flex-wrap gap-2">
              <button className="btn-ghost" disabled={busy} onClick={() => beginEdit(row)}>Editar</button>
              <button className="btn-ghost" disabled={busy} onClick={() => {
                if (!window.confirm('¿Querés cancelar esta reserva?')) return
                void mutate(() => request('M9', '/reservas/' + encodeURIComponent(row.id), { method: 'DELETE', token }))
              }}>Cancelar reserva</button>
            </div>}
          </li>)}
        </ul>
        {(page > 1 || rows.length === pageSize) && <div className="mt-4 flex gap-2">
          <button className="btn-ghost" disabled={loading || page === 1} onClick={() => setPage((value) => value - 1)}>Anterior</button>
          <button className="btn-ghost" disabled={loading || rows.length < pageSize} onClick={() => setPage((value) => value + 1)}>Siguiente</button>
        </div>}
      </div>
    </section>
  )
}
