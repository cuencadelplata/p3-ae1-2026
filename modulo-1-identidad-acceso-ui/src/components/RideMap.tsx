import { useEffect, useRef } from 'react'
import { control, circleMarker, map, polyline, tileLayer } from 'leaflet'
import type { LatLngTuple } from 'leaflet'
import { destination, origin } from '../rideFlowApi'
import 'leaflet/dist/leaflet.css'

export default function RideMap() {
  const container = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!container.current) return
    const view = map(container.current, { zoomControl: false, scrollWheelZoom: false })
    const from: LatLngTuple = [origin.latitude, origin.longitude]
    const to: LatLngTuple = [destination.latitude, destination.longitude]
    const route = polyline([from, to], { color: '#d5ff40', dashArray: '8 8', weight: 4 }).addTo(view)
    const fit = () => view.fitBounds(route.getBounds(), { padding: [34, 40], animate: false })

    tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19,
    }).addTo(view)
    control.zoom({ position: 'bottomright' }).addTo(view)
    circleMarker(from, { radius: 7, color: '#d5ff40', fillOpacity: 1, fillColor: '#d5ff40' })
      .bindTooltip('Origen', { permanent: true, direction: 'top', offset: [0, -8] }).addTo(view)
    circleMarker(to, { radius: 7, color: '#fff', fillOpacity: 1, fillColor: '#fff' })
      .bindTooltip('Destino', { permanent: true, direction: 'top', offset: [0, -8] }).addTo(view)
    fit()
    return () => { view.remove() }
  }, [])

  return <div ref={container} className="ride-map" role="region" aria-label="Mapa de origen y destino" />
}
