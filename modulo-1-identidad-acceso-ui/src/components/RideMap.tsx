import { useEffect, useRef } from 'react'
import { control, circleMarker, map, polyline, tileLayer } from 'leaflet'
import type { LatLngTuple } from 'leaflet'
import { destination, origin } from '../rideFlowApi'
import 'leaflet/dist/leaflet.css'

export default function RideMap({ driverView = false, showRoute = true, pickup = origin, dropoff = destination }: {
  driverView?: boolean; showRoute?: boolean; pickup?: typeof origin; dropoff?: typeof destination
}) {
  const container = useRef<HTMLDivElement>(null)
  const { latitude: pickupLat, longitude: pickupLng } = pickup
  const { latitude: dropoffLat, longitude: dropoffLng } = dropoff

  useEffect(() => {
    if (!container.current) return
    const view = map(container.current, { zoomControl: false, scrollWheelZoom: false })
    const from: LatLngTuple = [pickupLat, pickupLng]
    const to: LatLngTuple = [dropoffLat, dropoffLng]
    tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19,
    }).addTo(view)
    control.zoom({ position: 'bottomright' }).addTo(view)
    if (showRoute) {
      const route = polyline([from, to], { color: '#d5ff40', dashArray: '8 8', weight: 4 }).addTo(view)
      circleMarker(to, { radius: 7, color: '#fff', fillOpacity: 1, fillColor: '#fff' })
        .bindTooltip('Destino', { permanent: true, direction: 'top', offset: [0, -8] }).addTo(view)
      view.fitBounds(route.getBounds(), { padding: [34, 46], animate: false })
    } else {
      view.setView(from, 15)
    }

    if (driverView) {
      circleMarker(from, { radius: 19, stroke: false, fillColor: '#d5ff40', fillOpacity: .22, interactive: false }).addTo(view)
    }
    circleMarker(from, { radius: 7, color: driverView ? '#141414' : '#d5ff40', fillOpacity: 1, fillColor: '#d5ff40' })
      .bindTooltip(driverView && !showRoute ? 'Tu ubicación de prueba' : 'Origen', { permanent: true, direction: 'top', offset: [0, -8] }).addTo(view)
    return () => { view.remove() }
  }, [driverView, showRoute, pickupLat, pickupLng, dropoffLat, dropoffLng])

  return <div ref={container} className="ride-map" role="region" aria-label={driverView ? 'Mapa del conductor' : 'Mapa de origen y destino'} />
}
