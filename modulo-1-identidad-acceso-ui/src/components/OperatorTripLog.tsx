import { useEffect, useState, type FormEvent } from 'react'
import { ArrowLeft } from 'lucide-react'
import { request, type TripRecord } from '../rideFlowApi'

// RF-6.7: registro de viajes de M6 (GET /api/viajes) e historial de transiciones de cada viaje.
interface Registro {
  total: number
  limit: number
  offset: number
  viajes: (TripRecord & { clienteId?: string })[]
}

interface Transicion {
  from: string | null
  to: string
  timestamp: string
  detalle?: string
}

const ESTADOS = ['SOLICITADO', 'CONDUCTOR_EN_CAMINO', 'ARRIBADO', 'EN_CURSO', 'COMPLETADO', 'CANCELADO']
const POR_PAGINA = 20
const fecha = new Intl.DateTimeFormat('es-AR', { dateStyle: 'medium', timeStyle: 'short' })
const etiqueta = (estado: string | null) => (estado ? estado.replaceAll('_', ' ').toLowerCase() : 'inicio')

export default function OperatorTripLog({ token, onBack }: { token: string; onBack: () => void }) {
  const [filtros, setFiltros] = useState({ clienteId: '', conductorId: '', estado: '' })
  const [aplicados, setAplicados] = useState(filtros)
  const [offset, setOffset] = useState(0)
  const [actualizaciones, setActualizaciones] = useState(0)
  const [registro, setRegistro] = useState<Registro | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [abierto, setAbierto] = useState('')
  const [historial, setHistorial] = useState<Record<string, Transicion[] | string>>({})

  useEffect(() => {
    const abort = new AbortController()
    const query = new URLSearchParams({ limit: String(POR_PAGINA), offset: String(offset) })
    for (const [clave, valor] of Object.entries(aplicados)) if (valor.trim()) query.set(clave, valor.trim())
    setCargando(true)
    setError('')
    request<Registro>('M6', '/api/viajes?' + query, { token, signal: abort.signal })
      .then((datos) => { if (!abort.signal.aborted) setRegistro(datos) })
      .catch((cause: unknown) => {
        if (!abort.signal.aborted) setError(cause instanceof Error ? cause.message : 'No se pudo consultar el registro de viajes.')
      })
      .finally(() => { if (!abort.signal.aborted) setCargando(false) })
    return () => abort.abort()
  }, [token, aplicados, offset, actualizaciones])

  function buscar(event: FormEvent) {
    event.preventDefault()
    setOffset(0)
    setAplicados({ ...filtros })
  }

  async function verHistorial(viajeId: string) {
    if (abierto === viajeId) {
      setAbierto('')
      return
    }
    setAbierto(viajeId)
    if (historial[viajeId]) return
    try {
      const datos = await request<{ historial: Transicion[] }>('M6', `/api/viajes/${encodeURIComponent(viajeId)}/historial-transiciones`, { token })
      setHistorial((actual) => ({ ...actual, [viajeId]: datos.historial }))
    } catch (cause) {
      setHistorial((actual) => ({ ...actual, [viajeId]: cause instanceof Error ? cause.message : 'No se pudo consultar el historial.' }))
    }
  }

  const total = registro?.total ?? 0
  const desde = total === 0 ? 0 : offset + 1
  const hasta = Math.min(offset + POR_PAGINA, total)

  return <section className="glass w-full max-w-3xl rounded-[1.75rem] p-5 md:p-8">
    <button className="btn-ghost inline-flex items-center gap-2" onClick={onBack}><ArrowLeft size={16} aria-hidden="true" /> Tu cuenta</button>
    <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
      <h1 className="display text-3xl">Registro de viajes</h1>
      <button className="btn-ghost" disabled={cargando} onClick={() => setActualizaciones((valor) => valor + 1)}>Actualizar</button>
    </div>

    <form className="mt-5 grid gap-3 sm:grid-cols-4 sm:items-end" onSubmit={buscar}>
      <label className="block">
        <span className="field-label">Cliente</span>
        <input className="input-field" inputMode="numeric" placeholder="userId" value={filtros.clienteId}
          onChange={(e) => setFiltros({ ...filtros, clienteId: e.target.value })} />
      </label>
      <label className="block">
        <span className="field-label">Conductor</span>
        <input className="input-field" inputMode="numeric" placeholder="userId" value={filtros.conductorId}
          onChange={(e) => setFiltros({ ...filtros, conductorId: e.target.value })} />
      </label>
      <label className="block">
        <span className="field-label">Estado</span>
        <select className="input-field" value={filtros.estado} onChange={(e) => setFiltros({ ...filtros, estado: e.target.value })}>
          <option value="">Todos</option>
          {ESTADOS.map((estado) => <option key={estado} value={estado}>{etiqueta(estado)}</option>)}
        </select>
      </label>
      <button className="btn-secondary" type="submit" disabled={cargando}>Buscar</button>
    </form>

    {error && <p className="alert-error mt-4" role="alert">{error}</p>}
    {cargando && <p className="mt-4 text-[var(--text-soft)]" role="status">Cargando viajes…</p>}
    {!cargando && !error && total === 0 && <p className="mt-4 text-[var(--text-soft)]">No hay viajes con esos filtros.</p>}
    {!cargando && total > 0 && <p className="mt-4 text-sm text-[var(--text-soft)]">Viajes {desde}–{hasta} de {total}</p>}

    <ul className="mt-2 divide-y divide-[var(--line)]" aria-busy={cargando}>
      {registro?.viajes.map((viaje) => {
        const transiciones = historial[viaje.id]
        return <li key={viaje.id} className="py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="font-semibold">
                {etiqueta(viaje.estado)}
                {viaje.finalizacion && <span className="text-[var(--text-soft)] font-normal"> · {viaje.finalizacion.moneda} {viaje.finalizacion.total.toLocaleString('es-AR')}</span>}
              </p>
              <p className="text-sm text-[var(--text-soft)] truncate">{viaje.origen} → {viaje.destino}</p>
              <p className="text-xs text-[var(--text-dim)]">
                <time dateTime={viaje.fechaCreacion}>{fecha.format(new Date(viaje.fechaCreacion))}</time>
                {' · '}Cliente #{viaje.clienteId ?? '—'}{' · '}Conductor #{viaje.conductorId || '—'}
              </p>
            </div>
            <button className="btn-secondary" aria-expanded={abierto === viaje.id} onClick={() => void verHistorial(viaje.id)}>
              {abierto === viaje.id ? 'Ocultar historial' : 'Ver historial'}
            </button>
          </div>
          {abierto === viaje.id && <div className="mt-3 rounded-2xl border border-[var(--line)] p-4">
            <p className="font-mono text-xs text-[var(--text-dim)] break-all">{viaje.id}</p>
            {!transiciones && <p className="mt-2 text-sm text-[var(--text-soft)]" role="status">Cargando historial…</p>}
            {typeof transiciones === 'string' && <p className="alert-error mt-2" role="alert">{transiciones}</p>}
            {Array.isArray(transiciones) && <ol className="mt-2 space-y-2 text-sm">
              {transiciones.map((t, i) => <li key={i} className="flex flex-wrap gap-x-3">
                <time className="text-[var(--text-dim)]" dateTime={t.timestamp}>{fecha.format(new Date(t.timestamp))}</time>
                <span>{etiqueta(t.from)} → <strong>{etiqueta(t.to)}</strong></span>
                {t.detalle && <span className="text-[var(--text-soft)]">{t.detalle}</span>}
              </li>)}
            </ol>}
          </div>}
        </li>
      })}
    </ul>

    {total > POR_PAGINA && <div className="mt-4 flex items-center justify-between gap-3">
      <button className="btn-ghost" disabled={cargando || offset === 0} onClick={() => setOffset(Math.max(0, offset - POR_PAGINA))}>Anteriores</button>
      <button className="btn-ghost" disabled={cargando || hasta >= total} onClick={() => setOffset(offset + POR_PAGINA)}>Siguientes</button>
    </div>}
  </section>
}
