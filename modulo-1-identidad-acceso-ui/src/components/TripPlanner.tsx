import { useEffect, useRef, useState } from 'react'
import { Bike, CarFront, Crosshair, LoaderCircle, MapPin, Navigation, Search } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { searchPlaces } from '../places'
import type { Place, RouteInfo, Suggestion, VehicleType } from '../places'
import { RotateCcw, Star } from 'lucide-react'
import { useMisLugares, useRegreso } from '../misLugares'
import { estimarTarifa } from '../rideFlowApi'
import type { FareQuote } from '../rideFlowApi'

type EstadoTarifa = { estado: 'calculando' } | { estado: 'ok'; tarifa: FareQuote } | { estado: 'no-disponible' }

const money = (amount: number, currency: string) =>
  new Intl.NumberFormat('es-AR', { style: 'currency', currency }).format(amount)

export interface Draft {
  origin: Place
  destination: Place
  vehicleType: VehicleType
}

export type PickMode = 'origin' | 'destination'

function AddressField({ id, label, icon: Icon, place, picking, disabled, onSelect, onPickOnMap }: {
  id: string
  label: string
  icon: LucideIcon
  place: Place
  picking: boolean
  disabled: boolean
  onSelect: (place: Place) => void
  onPickOnMap: () => void
}) {
  const [text, setText] = useState(place.address)
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [searching, setSearching] = useState(false)
  const [message, setMessage] = useState('')
  const pending = useRef<AbortController | null>(null)
  const typingTimer = useRef<number | undefined>(undefined)
  // RF-2.2: favoritas y recientes del cliente para este campo (M2).
  const misLugares = useMisLugares(id)
  const [focused, setFocused] = useState(false)
  const [saving, setSaving] = useState(false)

  // Si el punto cambia desde el mapa, el campo muestra la nueva dirección.
  useEffect(() => { setText(place.address) }, [place.address])
  useEffect(() => () => pending.current?.abort(), [])

  async function search(query: string, selectFirst: boolean) {
    // Enter o "Buscar" reemplazan a la búsqueda automática que estaba por salir.
    window.clearTimeout(typingTimer.current)
    pending.current?.abort()
    if (query.trim().length < 3) {
      setSuggestions([])
      return
    }
    const controller = new AbortController()
    pending.current = controller
    setSearching(true)
    setMessage('')
    try {
      const results = await searchPlaces(query, controller.signal)
      if (controller.signal.aborted) return
      if (results.length === 0) setMessage('Sin resultados. Probá agregar la ciudad (por ejemplo, Corrientes).')
      if (selectFirst && results[0]) {
        choose(results[0])
        return
      }
      setSuggestions(results)
    } catch {
      if (!controller.signal.aborted) setMessage('No se pudo buscar la dirección. Volvé a intentar.')
    } finally {
      if (!controller.signal.aborted) setSearching(false)
    }
  }

  // Busca mientras se escribe, con una pausa para respetar el límite de Nominatim (1 consulta/s).
  useEffect(() => {
    if (text === place.address) return
    typingTimer.current = window.setTimeout(() => void search(text, false), 600)
    return () => window.clearTimeout(typingTimer.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text])

  function choose(selected: Suggestion) {
    pending.current?.abort()
    setSearching(false)
    setSuggestions([])
    setMessage('')
    const { latitude, longitude, address } = selected
    setText(address)
    onSelect({ latitude, longitude, address })
  }

  return (
    <div className="ride-field">
      <div className="ride-field-head">
        <label htmlFor={id}><Icon size={15} aria-hidden="true" /> {label}</label>
        {misLugares.disponible && place.address && <button type="button" className="ride-chip" disabled={disabled || saving}
          onClick={async () => { setSaving(true); setMessage(await misLugares.guardar(place)); setSaving(false) }}>
          <Star size={13} aria-hidden="true" /> {saving ? 'Guardando…' : 'Guardar'}
        </button>}
        <button type="button" className="ride-chip" data-active={picking} disabled={disabled} onClick={onPickOnMap}>
          <Crosshair size={13} aria-hidden="true" /> Elegir en mapa
        </button>
      </div>
      <div className="ride-field-input">
        <input id={id} className="input-field" value={text} disabled={disabled} autoComplete="off"
          aria-autocomplete="list" aria-controls={`${id}-sugerencias`}
          onChange={(event) => setText(event.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => window.setTimeout(() => setFocused(false), 150)}
          onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void search(text, true) } }} />
        <button type="button" className="btn-ghost ride-search" disabled={disabled || searching} onClick={() => void search(text, true)}
          aria-label={`Buscar ${label.toLowerCase()}`}>
          {searching ? <LoaderCircle className="ride-spin" size={16} aria-hidden="true" /> : <Search size={16} aria-hidden="true" />}
        </button>
      </div>
      {suggestions.length > 0 && <ul id={`${id}-sugerencias`} className="ride-suggestions" role="listbox">
        {suggestions.map((item) => <li key={`${item.latitude},${item.longitude}`} role="option" aria-selected="false">
          <button type="button" onClick={() => choose(item)}><strong>{item.address}</strong><span>{item.detail}</span></button>
        </li>)}
      </ul>}
      {focused && suggestions.length === 0 && (text === place.address || !text.trim()) && misLugares.lugares.length > 0 && <ul className="ride-suggestions" role="listbox" aria-label="Tus direcciones">
        {misLugares.lugares.map((item) => <li key={`propio-${item.latitude},${item.longitude}`} role="option" aria-selected="false">
          <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => { setFocused(false); choose(item) }}>
            <strong>{item.favorita ? '★ ' : ''}{item.address}</strong><span>{item.detail}</span>
          </button>
        </li>)}
      </ul>}
      {message && <p className="ride-muted ride-field-note">{message}</p>}
    </div>
  )
}

export default function TripPlanner({ draft, onChange, route, routeLoading, pickMode, onPickMode, disabled, warning }: {
  draft: Draft
  onChange: (draft: Draft) => void
  route: RouteInfo | null
  routeLoading: boolean
  pickMode: PickMode | null
  onPickMode: (mode: PickMode | null) => void
  disabled: boolean
  warning: string
}) {
  // RF-2.2: regreso al origen del último viaje.
  const regreso = useRegreso()
  const vehicles: Array<{ type: VehicleType; label: string; detail: string; icon: LucideIcon }> = [
    { type: 'AUTO', label: 'Automóvil', detail: 'Hasta 4 personas', icon: CarFront },
    { type: 'MOTO', label: 'Moto', detail: 'Una persona', icon: Bike },
  ]

  // RF-7.1: tarifa estimada por M7, se recalcula al cambiar origen, destino o vehículo.
  const [tarifa, setTarifa] = useState<EstadoTarifa>({ estado: 'calculando' })
  const { origin, destination, vehicleType } = draft

  useEffect(() => {
    const abort = new AbortController()
    setTarifa({ estado: 'calculando' })
    // Pequeña espera para no consultar a M7 en cada clic mientras se elige en el mapa.
    const timer = window.setTimeout(() => {
      estimarTarifa(origin, destination, vehicleType, abort.signal)
        .then((resultado) => {
          if (!abort.signal.aborted) setTarifa(resultado ? { estado: 'ok', tarifa: resultado } : { estado: 'no-disponible' })
        })
        .catch(() => { if (!abort.signal.aborted) setTarifa({ estado: 'no-disponible' }) })
    }, 350)
    return () => {
      window.clearTimeout(timer)
      abort.abort()
    }
  }, [origin.latitude, origin.longitude, origin.address, destination.latitude, destination.longitude, destination.address, vehicleType])

  return (
    <div className="ride-planner">
      {regreso && <div className="ride-field">
        <p className="ride-muted ride-field-note">Tu último viaje terminó en {regreso.desde.address}.</p>
        <button type="button" className="ride-chip" disabled={disabled}
          onClick={() => onChange({ ...draft, origin: regreso.desde, destination: regreso.hasta })}>
          <RotateCcw size={13} aria-hidden="true" /> Volver a {regreso.hasta.address}
        </button>
      </div>}
      <AddressField id="viaje-origen" label="Origen" icon={MapPin} place={draft.origin} disabled={disabled}
        picking={pickMode === 'origin'} onPickOnMap={() => onPickMode(pickMode === 'origin' ? null : 'origin')}
        onSelect={(origin) => onChange({ ...draft, origin })} />
      <AddressField id="viaje-destino" label="Destino" icon={Navigation} place={draft.destination} disabled={disabled}
        picking={pickMode === 'destination'} onPickOnMap={() => onPickMode(pickMode === 'destination' ? null : 'destination')}
        onSelect={(destination) => onChange({ ...draft, destination })} />

      <fieldset className="ride-vehicles" disabled={disabled}>
        <legend>Elegí cómo viajar</legend>
        {vehicles.map(({ type, label, detail, icon: Icon }) => (
          <label key={type} className="ride-vehicle-option" data-selected={draft.vehicleType === type}>
            <input type="radio" name="vehiculo" value={type} checked={draft.vehicleType === type}
              onChange={() => onChange({ ...draft, vehicleType: type })} />
            <Icon size={20} aria-hidden="true" />
            <span><strong>{label}</strong><small>{detail}</small></span>
          </label>
        ))}
      </fieldset>

      <div className="ride-estimate" aria-live="polite">
        {routeLoading || !route ? <span className="ride-muted">Calculando el recorrido…</span> : <>
          <div><small>Distancia</small><strong>{route.distanceKm.toLocaleString('es-AR', { maximumFractionDigits: 1 })} km</strong></div>
          <div><small>Tiempo estimado</small><strong>~{route.durationMin} min</strong></div>
          <div className="ride-estimate-fare">
            <small>Tarifa estimada</small>
            {tarifa.estado === 'ok' && <strong>{money(tarifa.tarifa.amount, tarifa.tarifa.currency)}</strong>}
            {tarifa.estado === 'calculando' && <span className="ride-muted">Consultando a M7…</span>}
            {tarifa.estado === 'no-disponible' && <span className="ride-muted">No disponible ahora: se calcula al confirmar.</span>}
          </div>
          <p className="ride-muted">{route.byStreets ? 'Recorrido por calles.' : 'Distancia en línea recta (no se pudo calcular la ruta por calles).'} Tarifa estimada por M7; el total final se calcula al terminar el viaje.</p>
        </>}
      </div>
      {warning && <p className="alert-error" role="alert">{warning}</p>}
    </div>
  )
}
