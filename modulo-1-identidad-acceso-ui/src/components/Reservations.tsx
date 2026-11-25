import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { ArrowLeft, CalendarClock, Route } from 'lucide-react'
import { FlowError, destination, origin, request } from '../rideFlowApi'
import { distanceKm, fetchRoute, reversePlace, searchPlaces } from '../places'
import type { RouteInfo } from '../places'
import RideMap from './RideMap'
import TripPlanner from './TripPlanner'
import type { Draft, PickMode } from './TripPlanner'
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

const emptyDraft = (): Draft => ({
  origin: { ...origin, address: '' },
  destination: { ...destination, address: '' },
  vehicleType: 'AUTO',
})

const states = {
  PROGRAMADA: 'Programada',
  ACTIVANDO: 'Activando',
  ACTIVADA: 'Activada',
  CANCELADA: 'Cancelada',
  FALLIDA: 'No se pudo activar',
}

function localTime(iso: string) {
  const date = new Date(iso)
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
}

function minimumLocalTime() {
  return localTime(new Date(Date.now() + 60_000).toISOString())
}

function draftProblem({ origin: from, destination: to }: Draft) {
  if (!from.address.trim() || !to.address.trim()) return 'Elegí un origen y un destino en el mapa o usando el buscador.'
  if (distanceKm(from, to) < 0.1) return 'El destino tiene que estar a más de 100 metros del origen.'
  return ''
}

export default function Reservations({ token, onBack, onOpenTrip }: {
  token: string
  onBack: () => void
  onOpenTrip: () => void
}) {
  const [page, setPage] = useState(1)
  const [rows, setRows] = useState<Reservation[]>([])
  const [draft, setDraft] = useState<Draft>(emptyDraft)
  const [horario, setHorario] = useState('')
  const [pickMode, setPickMode] = useState<PickMode | null>('origin')
  const [routeInfo, setRouteInfo] = useState<RouteInfo | null>(null)
  const [routeLoading, setRouteLoading] = useState(false)
  const [locating, setLocating] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  const pageSize = 20

  const problem = draftProblem(draft)

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

  useEffect(() => {
    if (!draft.origin.address || !draft.destination.address) {
      setRouteInfo(null)
      setRouteLoading(false)
      return
    }
    const controller = new AbortController()
    setRouteLoading(true)
    const timer = window.setTimeout(() => {
      fetchRoute(draft.origin, draft.destination, controller.signal)
        .then((info) => { if (!controller.signal.aborted) setRouteInfo(info) })
        .catch(() => undefined)
        .finally(() => { if (!controller.signal.aborted) setRouteLoading(false) })
    }, 300)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [draft.origin, draft.destination])

  const pickOnMap = useCallback(async (latitude: number, longitude: number) => {
    if (!pickMode || busy) return
    const mode = pickMode
    setLocating(true)
    setDraft((current) => ({ ...current, [mode]: { latitude, longitude, address: 'Buscando la dirección…' } }))
    const place = await reversePlace(latitude, longitude).catch(() => ({
      latitude,
      longitude,
      address: `Punto ${latitude}, ${longitude}`,
    }))
    setDraft((current) =>
      current[mode].latitude === latitude && current[mode].longitude === longitude
        ? { ...current, [mode]: place }
        : current,
    )
    setLocating(false)
    if (mode === 'origin') setPickMode('destination')
  }, [pickMode, busy])

  function clear() {
    setDraft(emptyDraft())
    setHorario('')
    setEditing(null)
    setPickMode('origin')
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
        setError('No encontramos una de las direcciones. Revisá el nombre de la calle o marcá el punto en el mapa.')
      } else {
        setError(cause instanceof Error ? cause.message : 'No se pudo actualizar la reserva.')
      }
    } finally {
      setBusy(false)
    }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (problem) {
      setError(problem)
      return
    }
    const time = new Date(horario)
    if (!(time.getTime() > Date.now())) {
      setError('Elegí una fecha y hora futuras.')
      return
    }
    await mutate(async () => {
      const route = editing ? '/reservas/' + encodeURIComponent(editing) : '/reservas'
      await request('M9', route, {
        method: editing ? 'PATCH' : 'POST',
        token,
        body: {
          origen: draft.origin.address.trim(),
          destino: draft.destination.address.trim(),
          vehiculo: draft.vehicleType,
          fechaHoraProgramada: time.toISOString(),
        },
      })
      clear()
    }, !editing)
  }

  function beginEdit(row: Reservation) {
    setEditing(row.id)
    setError('')
    setHorario(localTime(row.fechaHoraProgramada))
    setDraft({
      origin: { ...origin, address: row.origen },
      destination: { ...destination, address: row.destino },
      vehicleType: row.vehiculo,
    })
    setPickMode('origin')
    void Promise.all([
      searchPlaces(row.origen).catch(() => []),
      searchPlaces(row.destino).catch(() => []),
    ]).then(([origMatches, destMatches]) => {
      setDraft((current) => ({
        ...current,
        origin: origMatches[0] && current.origin.address === row.origen
          ? { latitude: origMatches[0].latitude, longitude: origMatches[0].longitude, address: row.origen }
          : current.origin,
        destination: destMatches[0] && current.destination.address === row.destino
          ? { latitude: destMatches[0].latitude, longitude: destMatches[0].longitude, address: row.destino }
          : current.destination,
      }))
    })
  }

  const pickLabel = pickMode === 'origin'
    ? 'Hacé clic en el mapa para fijar el origen'
    : pickMode === 'destination'
      ? 'Hacé clic en el mapa para fijar el destino'
      : undefined

  return (
    <div className="ride-flow ride-flow-wide">
      <header className="ride-flow-header">
        <button className="btn-ghost" disabled={busy} onClick={onBack}><ArrowLeft size={16} aria-hidden="true" /> Tu cuenta</button>
        <span>M9 · Reservas programadas</span>
      </header>

      <section className="glass ride-flow-panel">
        <h1 className="display ride-flow-title">Mis reservas</h1>
        {error && <p className="alert-error mt-4" role="alert">{error}</p>}

        <div className="ride-columns mt-6">
          <div className="ride-sidebar">
            <form className="ride-route" onSubmit={(event) => void save(event)}>
              <h2><Route size={18} aria-hidden="true" /> {editing ? 'Editar reserva' : 'Programar un viaje'}</h2>
              <TripPlanner
                draft={draft}
                onChange={setDraft}
                route={routeInfo}
                routeLoading={routeLoading}
                pickMode={pickMode}
                onPickMode={setPickMode}
                disabled={busy}
                warning={problem}
              />
              <fieldset className="mt-4 grid gap-3" disabled={busy}>
                <label className="grid gap-1 text-xs text-[var(--text-soft)]">
                  <span className="inline-flex items-center gap-1.5"><CalendarClock size={14} className="text-[var(--accent)]" aria-hidden="true" /> Fecha y hora de salida</span>
                  <input
                    className="input-field"
                    type="datetime-local"
                    min={minimumLocalTime()}
                    value={horario}
                    required
                    onChange={(event) => setHorario(event.target.value)}
                  />
                </label>
                <div className="flex flex-wrap gap-2 pt-1">
                  <button className="btn-primary flex-1" type="submit" disabled={busy || locating || Boolean(problem)}>
                    {editing ? 'Guardar cambios' : 'Programar viaje'}
                  </button>
                  {editing && <button className="btn-ghost" type="button" onClick={clear}>Cancelar edición</button>}
                </div>
              </fieldset>
            </form>
          </div>

          <RideMap
            pickup={draft.origin}
            dropoff={draft.destination}
            showRoute={Boolean(draft.origin.address && draft.destination.address)}
            routeCoords={routeInfo?.coords}
            onPick={busy ? undefined : pickOnMap}
            pickLabel={pickLabel}
          />
        </div>

        <div className="mt-8 border-t border-[var(--line)] pt-6" aria-busy={loading}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="eyebrow">Historial y próximas salidas</h2>
            <button className="btn-ghost" disabled={loading || busy} onClick={() => { setError(''); setRevision((value) => value + 1) }}>Actualizar reservas</button>
          </div>
          {loading ? <p className="mt-3" role="status">Consultando tus reservas…</p> : rows.length === 0 && !error && <p className="mt-3">Todavía no hay reservas en esta página.</p>}
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
    </div>
  )
}
