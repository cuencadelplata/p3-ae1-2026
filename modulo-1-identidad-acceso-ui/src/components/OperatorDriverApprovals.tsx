import { useEffect, useState } from 'react'
import { ArrowLeft } from 'lucide-react'
import axios from 'axios'
import { API_URL } from '../api'
import { request } from '../rideFlowApi'

interface VehiculoPendiente {
  id: string
  patente: string
  marca: string | null
  modelo: string | null
  anio: number
  tipoServicio: string
}

interface DocumentoVehiculo {
  id: string
  tipoDocumento: string
  cara: string | null
  numeroDocumento: string
  fechaVencimiento: string
  estado: string
  archivoUrl: string
}

interface PendingDriver {
  usuarioID: string
  createdAt?: string
  actualizadoEn?: string
  vehiculo?: VehiculoPendiente | null
  documentacionVehiculo?: DocumentoVehiculo[]
}

const fecha = new Intl.DateTimeFormat('es-AR', { dateStyle: 'medium', timeStyle: 'short' })
const fechaCorta = new Intl.DateTimeFormat('es-AR', { dateStyle: 'medium' })

const etiquetaDocumento: Record<string, string> = {
  LICENCIA_CONDUCIR: 'Licencia',
  CEDULA_VEHICULO: 'Cédula',
  SEGURO_VEHICULO: 'Seguro',
}

function esImagen(url: string) {
  return url.startsWith('data:image/') || url.startsWith('http://') || url.startsWith('https://')
}

function tituloDocumento(documento: DocumentoVehiculo) {
  const tipo = etiquetaDocumento[documento.tipoDocumento] ?? documento.tipoDocumento
  if (documento.cara === 'FRENTE') return `${tipo} · frente`
  if (documento.cara === 'DORSO') return `${tipo} · dorso`
  return tipo
}

function vence(valor: string) {
  const dia = /^(\d{4})-(\d{2})-(\d{2})/.exec(valor)
  if (!dia) return valor
  return fechaCorta.format(new Date(Number(dia[1]), Number(dia[2]) - 1, Number(dia[3])))
}

function describirVehiculo(vehiculo: VehiculoPendiente) {
  const nombre = [vehiculo.marca, vehiculo.modelo].filter(Boolean).join(' ')
  return [vehiculo.patente, nombre, vehiculo.anio, vehiculo.tipoServicio].filter(Boolean).join(' · ')
}

export default function OperatorDriverApprovals({ token, onBack }: { token: string; onBack: () => void }) {
  const [pendientes, setPendientes] = useState<PendingDriver[]>([])
  const [cargando, setCargando] = useState(true)
  const [actualizaciones, setActualizaciones] = useState(0)
  const [habilitando, setHabilitando] = useState('')
  const [mensaje, setMensaje] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    const abort = new AbortController()
    axios.get<PendingDriver[]>(`${API_URL}/auth/altas-vehiculo`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: abort.signal,
    }).then(({ data }) => {
      if (!abort.signal.aborted) setPendientes(data.toSorted((a, b) => (a.createdAt ?? a.actualizadoEn ?? '').localeCompare(b.createdAt ?? b.actualizadoEn ?? '')))
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

  return <section className="glass w-full max-w-4xl rounded-[1.75rem] p-5 md:p-8">
    <button className="btn-ghost inline-flex items-center gap-2" onClick={onBack}><ArrowLeft size={16} aria-hidden="true" /> Tu cuenta</button>
    <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
      <h1 className="display text-3xl">Habilitar conductores</h1>
      <button className="btn-ghost" disabled={cargando || Boolean(habilitando)} onClick={() => {
        setCargando(true)
        setError('')
        setActualizaciones((valor) => valor + 1)
      }}>Actualizar</button>
    </div>
    <p className="mt-2 text-sm text-[var(--text-soft)]">Estas solicitudes quedaron guardadas en M1 con el vehículo y la documentación enviados por M3.</p>
    {error && <p className="alert-error mt-4" role="alert">{error}</p>}
    {mensaje && <p className="mt-4 text-[var(--accent)]" role="status">{mensaje}</p>}
    {cargando && <p className="mt-4 text-[var(--text-soft)]" role="status">Cargando solicitudes…</p>}
    {!cargando && !error && pendientes.length === 0 && <p className="mt-4 text-[var(--text-soft)]">No hay conductores pendientes de habilitación.</p>}
    <ul className="mt-4 grid gap-4" aria-busy={cargando || Boolean(habilitando)}>
      {pendientes.map((solicitud) => {
        const documentos = solicitud.documentacionVehiculo ?? []
        return <li key={solicitud.usuarioID} className="rounded-2xl border border-[var(--line)] p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="font-semibold">Conductor #{solicitud.usuarioID}</p>
              {(solicitud.actualizadoEn || solicitud.createdAt) && <time className="text-sm text-[var(--text-soft)]" dateTime={solicitud.actualizadoEn || solicitud.createdAt}>{fecha.format(new Date(solicitud.actualizadoEn || solicitud.createdAt || ''))}</time>}
              <p className="mt-2 text-sm">{solicitud.vehiculo ? describirVehiculo(solicitud.vehiculo) : 'Sin vehículo registrado'}</p>
            </div>
            <button className="btn-secondary" disabled={cargando || Boolean(habilitando)} aria-label={`Habilitar conductor #${solicitud.usuarioID}`}
              onClick={() => void habilitar(solicitud.usuarioID)}>{habilitando === solicitud.usuarioID ? 'Habilitando…' : 'Habilitar'}</button>
          </div>
          {documentos.length === 0
            ? <p className="mt-3 text-sm text-[var(--text-soft)]">Todavía no envió la documentación del vehículo.</p>
            : <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {documentos.map((documento) => <figure key={documento.id} className="overflow-hidden rounded-xl border border-[var(--line)]">
                {esImagen(documento.archivoUrl) && <img className="h-40 w-full object-cover" src={documento.archivoUrl} alt={tituloDocumento(documento)} />}
                <figcaption className="px-3 py-2 text-sm">
                  <p className="font-semibold">{tituloDocumento(documento)}</p>
                  <p className="text-[var(--text-soft)]">Nº {documento.numeroDocumento} · vence {vence(documento.fechaVencimiento)} · {documento.estado}</p>
                </figcaption>
              </figure>)}
            </div>}
        </li>
      })}
    </ul>
  </section>
}
