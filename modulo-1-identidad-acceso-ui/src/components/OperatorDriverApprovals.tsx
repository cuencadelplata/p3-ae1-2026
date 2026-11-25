import { useEffect, useState } from 'react'
import { ArrowLeft } from 'lucide-react'
import { request } from '../rideFlowApi'

interface PendingDriver {
  usuarioID: string
  createdAt?: string
}

const fecha = new Intl.DateTimeFormat('es-AR', { dateStyle: 'medium', timeStyle: 'short' })

export default function OperatorDriverApprovals({ token, onBack }: { token: string; onBack: () => void }) {
  const [pendientes, setPendientes] = useState<PendingDriver[]>([])
  const [cargando, setCargando] = useState(true)
  const [actualizaciones, setActualizaciones] = useState(0)
  const [habilitando, setHabilitando] = useState('')
  const [mensaje, setMensaje] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    const abort = new AbortController()
    request<PendingDriver[]>('M3', '/api/conductores/pendientes', { token, signal: abort.signal }).then((lista) => {
      if (!abort.signal.aborted) setPendientes(lista.toSorted((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? '')))
    }).catch((cause: unknown) => {
      if (!abort.signal.aborted) setError(cause instanceof Error ? cause.message : 'No se pudieron consultar las solicitudes.')
    }).finally(() => {
      if (!abort.signal.aborted) setCargando(false)
    })
    return () => abort.abort()
  }, [token, actualizaciones])

  async function habilitar(usuarioID: string) {
    setHabilitando(usuarioID)
    setError('')
    setMensaje('')
    try {
      await request('M3', `/api/conductores/${encodeURIComponent(usuarioID)}/habilitado`, {
        method: 'PUT', token, body: { habilitado: 'activo' },
      })
      setPendientes((lista) => lista.filter((perfil) => perfil.usuarioID !== usuarioID))
      setMensaje(`Conductor #${usuarioID} habilitado.`)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo habilitar al conductor.')
    } finally {
      setHabilitando('')
    }
  }

  return <section className="glass w-full max-w-3xl rounded-[1.75rem] p-5 md:p-8">
    <button className="btn-ghost inline-flex items-center gap-2" onClick={onBack}><ArrowLeft size={16} aria-hidden="true" /> Tu cuenta</button>
    <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
      <h1 className="display text-3xl">Habilitar conductores</h1>
      <button className="btn-ghost" disabled={cargando || Boolean(habilitando)} onClick={() => {
        setCargando(true)
        setError('')
        setActualizaciones((valor) => valor + 1)
      }}>Actualizar</button>
    </div>
    {error && <p className="alert-error mt-4" role="alert">{error}</p>}
    {mensaje && <p className="mt-4 text-[var(--accent)]" role="status">{mensaje}</p>}
    {cargando && <p className="mt-4 text-[var(--text-soft)]" role="status">Cargando solicitudes…</p>}
    {!cargando && !error && pendientes.length === 0 && <p className="mt-4 text-[var(--text-soft)]">No hay conductores pendientes de habilitación.</p>}
    <ul className="mt-4 divide-y divide-[var(--line)]" aria-busy={cargando || Boolean(habilitando)}>
      {pendientes.map(({ usuarioID, createdAt }) => <li key={usuarioID} className="flex flex-wrap items-center justify-between gap-3 py-3">
        <div>
          <p className="font-semibold">Conductor #{usuarioID}</p>
          {createdAt && <time className="text-sm text-[var(--text-soft)]" dateTime={createdAt}>{fecha.format(new Date(createdAt))}</time>}
        </div>
        <button className="btn-secondary" disabled={cargando || Boolean(habilitando)} aria-label={`Habilitar conductor #${usuarioID}`}
          onClick={() => void habilitar(usuarioID)}>{habilitando === usuarioID ? 'Habilitando…' : 'Habilitar'}</button>
      </li>)}
    </ul>
  </section>
}
