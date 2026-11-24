import { useEffect, useRef } from 'react'
import { control, circleMarker, layerGroup, map, polyline, tileLayer } from 'leaflet'
import type { LatLngBounds, LatLngTuple, LayerGroup, Map as LeafletMap } from 'leaflet'
import { destination, origin } from '../rideFlowApi'
import 'leaflet/dist/leaflet.css'

type Point = Pick<typeof origin, 'latitude' | 'longitude'>

interface Props {
  driverView?: boolean
  showRoute?: boolean
  pickup?: Point
  dropoff?: Point
  /** Recorrido por calles; sin él se dibuja una línea recta punteada. */
  routeCoords?: LatLngTuple[]
  showLocation?: boolean
  vehiclePosition?: { latitude: number; longitude: number }
  /** Si está presente, un clic en el mapa elige ese punto (origen o destino). */
  onPick?: (latitude: number, longitude: number) => void
  pickLabel?: string
}

export default function RideMap({ driverView = false, showRoute = true, pickup = origin, dropoff = destination, routeCoords, onPick, pickLabel, showLocation = true, vehiclePosition }: Props) {
  const container = useRef<HTMLDivElement>(null)
  const view = useRef<LeafletMap | null>(null)
  const layers = useRef<LayerGroup | null>(null)
  const car = useRef<ReturnType<typeof circleMarker> | null>(null)
  // Último encuadre pedido: se repite si el contenedor cambia de tamaño (por ejemplo, cuando
  // el panel del conductor achica el mapa al mostrar la tarjeta del viaje).
  const framing = useRef<{ bounds?: LatLngBounds; center?: LatLngTuple }>({})
  const pick = useRef(onPick)
  const { latitude: pickupLat, longitude: pickupLng } = pickup
  const { latitude: dropoffLat, longitude: dropoffLng } = dropoff

  useEffect(() => { pick.current = onPick }, [onPick])

  // El mapa se crea una vez; los marcadores y la ruta se actualizan sin perder el zoom.
  useEffect(() => {
    if (!container.current) return
    const created = map(container.current, { zoomControl: false, scrollWheelZoom: false })
    tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19,
    }).addTo(created)
    control.zoom({ position: 'bottomright' }).addTo(created)
    created.on('click', (event) => pick.current?.(Number(event.latlng.lat.toFixed(5)), Number(event.latlng.lng.toFixed(5))))
    view.current = created
    layers.current = layerGroup().addTo(created)
    const resize = new ResizeObserver(() => {
      created.invalidateSize({ animate: false })
      const { bounds, center } = framing.current
      if (bounds) created.fitBounds(bounds, { padding: [34, 46], animate: false })
      else if (center) created.setView(center, 15, { animate: false })
    })
    resize.observe(container.current)
    return () => {
      resize.disconnect()
      created.remove()
      view.current = null
      layers.current = null
    }
  }, [])

  const carLatitude = vehiclePosition?.latitude
  const carLongitude = vehiclePosition?.longitude
  useEffect(() => {
    if (carLatitude === undefined || carLongitude === undefined || !view.current) {
      car.current?.remove()
      car.current = null
      return
    }
    const point: LatLngTuple = [carLatitude, carLongitude]
    if (car.current) car.current.setLatLng(point)
    else car.current = circleMarker(point, { radius: 9, color: '#141414', weight: 3, fillColor: '#d5ff40', fillOpacity: 1 })
      .bindTooltip('Ubicación del auto').addTo(view.current)
  }, [carLatitude, carLongitude])

  const routeKey = routeCoords ? `${routeCoords.length}:${routeCoords[0]?.join()}:${routeCoords.at(-1)?.join()}` : ''

  useEffect(() => {
    const current = view.current
    const group = layers.current
    if (!current || !group) return
    group.clearLayers()
    const from: LatLngTuple = [pickupLat, pickupLng]
    const to: LatLngTuple = [dropoffLat, dropoffLng]

    if (showRoute) {
      const line = routeCoords && routeCoords.length > 1 ? routeCoords : [from, to]
      if (routeCoords) polyline(line, { color: '#d5ff40', weight: 9, opacity: .22, lineCap: 'round' }).addTo(group)
      const route = polyline(line, routeCoords
        ? { color: '#d5ff40', weight: 4, opacity: .95, lineCap: 'round', lineJoin: 'round' }
        : { color: '#d5ff40', dashArray: '8 8', weight: 4 }).addTo(group)
      circleMarker(to, { radius: 7, color: '#fff', fillOpacity: 1, fillColor: '#fff' })
        .bindTooltip('Destino', { permanent: true, direction: 'top', offset: [0, -8] }).addTo(group)
      const bounds = route.getBounds().extend(from).extend(to)
      framing.current = { bounds }
      current.fitBounds(bounds, { padding: [34, 46], animate: false })
    } else {
      framing.current = { center: from }
      current.setView(from, 15)
    }

    // Sin recorrido, el conductor ve su ubicación con un halo. Con un viaje u oferta, el mapa se
    // ve igual que el del pasajero.
    const waiting = driverView && !showRoute
    if (!showLocation) return
    if (waiting) {
      circleMarker(from, { radius: 19, stroke: false, fillColor: '#d5ff40', fillOpacity: .22, interactive: false }).addTo(group)
    }
    circleMarker(from, { radius: 7, color: waiting ? '#141414' : '#d5ff40', fillOpacity: 1, fillColor: '#d5ff40' })
      .bindTooltip(waiting ? 'Tu ubicación' : 'Origen', { permanent: true, direction: 'top', offset: [0, -8] }).addTo(group)
    // routeKey resume el recorrido para no redibujar con cada render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [driverView, showRoute, pickupLat, pickupLng, dropoffLat, dropoffLng, routeKey, showLocation])

  useEffect(() => {
    container.current?.classList.toggle('ride-map-picking', Boolean(onPick))
  }, [onPick])

  return (
    <div className="ride-map-wrap">
      <div ref={container} className="ride-map" role="region" aria-label={driverView ? 'Mapa del conductor' : 'Mapa de origen y destino'} />
      {onPick && pickLabel && <p className="ride-map-hint" role="status">{pickLabel}</p>}
    </div>
  )
}
