// Ubicaciones del pasajero: búsqueda de direcciones, dirección de un punto del mapa y ruta por calles.
// Usa los mismos servicios públicos que el front de M5: Nominatim (OpenStreetMap) y OSRM.
export interface Place {
  latitude: number
  longitude: number
  address: string
}

export interface Suggestion extends Place {
  detail: string
}

export interface RouteInfo {
  coords: Array<[number, number]>
  distanceKm: number
  durationMin: number
  byStreets: boolean
}

export type VehicleType = 'AUTO' | 'MOTO'

const NOMINATIM = 'https://nominatim.openstreetmap.org'
// Prioriza resultados en Corrientes capital sin excluir el resto del país.
const CORRIENTES_VIEWBOX = '-58.95,-27.38,-58.68,-27.56'
const headers = { 'Accept-Language': 'es' }

interface NominatimPlace {
  lat: string
  lon: string
  display_name: string
  address?: Record<string, string>
}

function shortAddress(place: NominatimPlace) {
  const a = place.address ?? {}
  const street = a.road || a.pedestrian || a.footway || a.suburb || a.neighbourhood || ''
  const number = a.house_number ? ` ${a.house_number}` : ''
  const city = a.city || a.town || a.village || ''
  const formatted = [street + number, city].filter(Boolean).join(', ')
  return formatted || place.display_name.split(',').slice(0, 2).join(',').trim()
}

const toPlace = (place: NominatimPlace): Suggestion => ({
  latitude: Number(Number(place.lat).toFixed(5)),
  longitude: Number(Number(place.lon).toFixed(5)),
  address: shortAddress(place),
  detail: place.display_name,
})

export async function searchPlaces(query: string, signal?: AbortSignal): Promise<Suggestion[]> {
  const params = new URLSearchParams({
    format: 'json', q: query, limit: '5', addressdetails: '1', countrycodes: 'ar', viewbox: CORRIENTES_VIEWBOX,
  })
  const response = await fetch(`${NOMINATIM}/search?${params}`, { headers, signal })
  if (!response.ok) throw new Error('No se pudo buscar la dirección. Volvé a intentar en unos segundos.')
  return ((await response.json()) as NominatimPlace[]).map(toPlace)
}

export async function reversePlace(latitude: number, longitude: number, signal?: AbortSignal): Promise<Place> {
  const fallback = { latitude, longitude, address: `Punto ${latitude.toFixed(4)}, ${longitude.toFixed(4)}` }
  try {
    const params = new URLSearchParams({ format: 'json', lat: String(latitude), lon: String(longitude), addressdetails: '1' })
    const response = await fetch(`${NOMINATIM}/reverse?${params}`, { headers, signal })
    if (!response.ok) return fallback
    const place = (await response.json()) as NominatimPlace & { error?: string }
    return place.error ? fallback : { latitude, longitude, address: shortAddress(place) }
  } catch (error) {
    if (signal?.aborted) throw error
    return fallback
  }
}

export function distanceKm(a: Pick<Place, 'latitude' | 'longitude'>, b: Pick<Place, 'latitude' | 'longitude'>) {
  const rad = (degrees: number) => (degrees * Math.PI) / 180
  const dLat = rad(b.latitude - a.latitude)
  const dLon = rad(b.longitude - a.longitude)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLon / 2) ** 2
  return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h))
}

// Ruta por calles con OSRM. Si no responde, una línea recta con la distancia en línea recta.
export async function fetchRoute(from: Place, to: Place, signal?: AbortSignal): Promise<RouteInfo> {
  const straight: RouteInfo = {
    coords: [[from.latitude, from.longitude], [to.latitude, to.longitude]],
    distanceKm: distanceKm(from, to),
    durationMin: Math.max(2, Math.round((distanceKm(from, to) / 25) * 60)),
    byStreets: false,
  }
  try {
    const path = `${from.longitude},${from.latitude};${to.longitude},${to.latitude}`
    const response = await fetch(`https://router.project-osrm.org/route/v1/driving/${path}?overview=full&geometries=geojson`, { signal })
    const data = await response.json() as { code: string; routes?: Array<{ distance: number; duration: number; geometry: { coordinates: Array<[number, number]> } }> }
    const route = data.code === 'Ok' ? data.routes?.[0] : undefined
    if (!route) return straight
    return {
      coords: route.geometry.coordinates.map(([lng, lat]) => [lat, lng]),
      distanceKm: route.distance / 1000,
      durationMin: Math.max(2, Math.round(route.duration / 60)),
      byStreets: true,
    }
  } catch (error) {
    if (signal?.aborted) throw error
    return straight
  }
}
