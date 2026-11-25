// RF-2.2: direcciones del cliente (favoritas, recientes y regreso) para el planificador de viaje.
// Las sugerencias se guardan en un único lugar y cada campo las lee con un hook, así el planificador
// solo suma líneas y no cambia cómo recibe sus datos. El token es el de la sesión (App lo guarda en localStorage).
// Si M2 no responde, no se muestra nada y el pedido sigue con la búsqueda de direcciones de siempre.
import { useEffect, useSyncExternalStore } from 'react'
import { aLugar, guardarFavorita, mensajeDeError, obtenerSugerencias } from './direccionesApi'
import type { Sugerencias, TipoDireccion } from './direccionesApi'
import type { Place, Suggestion } from './places'

let actual: Sugerencias | null = null
const oyentes = new Set<() => void>()
const sesion = () => localStorage.getItem('token') ?? ''

export async function recargarMisLugares() {
  const token = sesion()
  if (!token) return
  try {
    actual = await obtenerSugerencias(token)
  } catch {
    actual = null
  }
  oyentes.forEach((avisar) => avisar())
}

function useSugerencias() {
  return useSyncExternalStore((avisar) => {
    oyentes.add(avisar)
    return () => { oyentes.delete(avisar) }
  }, () => actual)
}

// Para un campo del planificador ("viaje-origen" o "viaje-destino"): sus direcciones y cómo guardar la elegida.
export function useMisLugares(campoId: string) {
  const sugerencias = useSugerencias()
  const tipo: TipoDireccion = campoId.includes('origen') ? 'ORIGEN' : 'DESTINO'
  const puntos = (tipo === 'ORIGEN' ? sugerencias?.origenes : sugerencias?.destinos) ?? []
  // Solo las que tienen coordenadas: el mapa y la ruta las necesitan.
  const lugares: Array<Suggestion & { favorita: boolean }> = puntos.flatMap((punto) => {
    const lugar = aLugar(punto)
    return lugar ? [{ ...lugar, favorita: punto.favorita, detail: punto.favorita ? 'Favorita' : 'De un viaje anterior' }] : []
  }).slice(0, 5)

  async function guardar(lugar: Place) {
    try {
      await guardarFavorita(sesion(), { tipo, direccion: lugar.address, latitud: lugar.latitude, longitud: lugar.longitude })
      await recargarMisLugares()
      return 'Guardada en tus favoritas.'
    } catch (error) {
      return mensajeDeError(error, 'guardar la favorita')
    }
  }

  return { lugares, guardar, disponible: sugerencias !== null }
}

// Regreso B → A: salir de donde terminó el último viaje y volver a donde empezó. Carga las sugerencias al abrir el planificador.
export function useRegreso() {
  const sugerencias = useSugerencias()
  useEffect(() => { void recargarMisLugares() }, [])
  const desde = aLugar(sugerencias?.regreso?.origen)
  const hasta = aLugar(sugerencias?.regreso?.destino)
  return desde && hasta ? { desde, hasta } : null
}
