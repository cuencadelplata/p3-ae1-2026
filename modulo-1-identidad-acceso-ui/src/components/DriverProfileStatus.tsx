import { useEffect, useState } from 'react'
import { ensureDriverProfile } from '../rideFlowApi'

export default function DriverProfileStatus({ token }: { token: string }) {
  const [estado, setEstado] = useState('')
  const [error, setError] = useState('')
  const [cargando, setCargando] = useState(true)
  const [intento, setIntento] = useState(0)

  useEffect(() => {
    const abort = new AbortController()
    ensureDriverProfile(token, abort.signal).then((perfil) => {
      if (!abort.signal.aborted) setEstado(perfil.habilitado ? 'activo' : perfil.estado)
    }).catch((cause: unknown) => {
      if (!abort.signal.aborted) setError(cause instanceof Error ? cause.message : 'No se pudo consultar tu perfil de conductor.')
    }).finally(() => {
      if (!abort.signal.aborted) setCargando(false)
    })
    return () => abort.abort()
  }, [token, intento])

  if (estado === 'activo' && !error) return null

  const estadoVisible = estado === 'pendiente' ? 'Pendiente de habilitación' : estado === 'suspendido'
    ? 'Perfil suspendido' : estado === 'rechazado' ? 'Perfil rechazado' : 'Perfil de conductor'

  return <section className="detail-card mt-4" aria-busy={cargando} aria-label="Estado del perfil de conductor">
    <p className="font-semibold" role="status">{cargando ? 'Consultando tu perfil de conductor…' : estadoVisible}</p>
    {!cargando && !error && estado === 'pendiente' && <p className="mt-1 text-sm text-[var(--text-soft)]">
      Completá el alta con el vehículo y la documentación. Cuando un operador la revise en M1, vas a poder conectarte.
    </p>}
    {error && <p className="alert-error mt-2" role="alert">{error}</p>}
    {!cargando && <button type="button" className="btn-ghost mt-3" onClick={() => {
      setCargando(true)
      setError('')
      setIntento((valor) => valor + 1)
    }}>{error ? 'Reintentar' : 'Actualizar estado'}</button>}
  </section>
}
