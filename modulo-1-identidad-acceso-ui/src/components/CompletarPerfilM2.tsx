import { useState, type FormEvent } from 'react'
import { FlowError, request } from '../rideFlowApi'

// RF-2.1: alta del perfil de cliente en M2. Nombre, DNI, teléfono y email ya los tiene M1;
// M2 solo pide las preferencias y toma el userId del token.
type Props = {
  token: string
  onCompletado: () => void
  onSesionInvalida: () => void
  onCancelar: () => void
}

export default function CompletarPerfilM2({ token, onCompletado, onSesionInvalida, onCancelar }: Props) {
  const [vehiculo, setVehiculo] = useState<'auto' | 'moto'>('auto')
  const [canal, setCanal] = useState<'email' | 'push'>('email')
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState('')

  async function crearPerfil(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setEnviando(true)
    setError('')
    try {
      await request('M2', '/v1/customers', {
        token, method: 'POST',
        body: { preferences: { preferredVehicleType: vehiculo, notificationChannel: canal } },
      })
      onCompletado()
    } catch (err) {
      // 409: el perfil ya existía (por ejemplo, otra pestaña lo creó antes).
      if (err instanceof FlowError && err.status === 409) return onCompletado()
      if (err instanceof FlowError && err.status === 401) return onSesionInvalida()
      setError(err instanceof Error ? err.message : 'No se pudo crear tu perfil. Intentá de nuevo.')
      setEnviando(false)
    }
  }

  return (
    <div className="w-full max-w-md">
      <div className="glass rounded-[1.75rem] p-9 md:p-11">
        <div className="mb-9">
          <p className="eyebrow">Perfil de cliente</p>
          <h1 className="display text-[2.6rem] mt-3 mb-2">Completá tu perfil</h1>
          <p className="text-sm text-[var(--text-soft)]">
            Tu identidad ya está verificada. Elegí tus preferencias para empezar a pedir viajes.
          </p>
        </div>

        <div className="hairline mb-8" />

        {error && <div className="alert-error mb-6 text-sm" role="alert">{error}</div>}

        <form onSubmit={(event) => void crearPerfil(event)} className="space-y-6">
          <div>
            <label className="field-label" htmlFor="perfil-vehiculo">Vehículo preferido</label>
            <select id="perfil-vehiculo" className="input-field" value={vehiculo} disabled={enviando}
              onChange={(event) => setVehiculo(event.target.value === 'moto' ? 'moto' : 'auto')}>
              <option value="auto">Auto</option>
              <option value="moto">Moto</option>
            </select>
          </div>
          <div>
            <label className="field-label" htmlFor="perfil-canal">Canal de notificaciones</label>
            <select id="perfil-canal" className="input-field" value={canal} disabled={enviando}
              onChange={(event) => setCanal(event.target.value === 'push' ? 'push' : 'email')}>
              <option value="email">Email</option>
              <option value="push">Avisos del navegador</option>
            </select>
          </div>
          <button className="btn-primary w-full" type="submit" disabled={enviando}>
            {enviando ? 'Creando…' : 'Crear perfil'}
          </button>
          <button className="btn-ghost w-full" type="button" disabled={enviando} onClick={onCancelar}>
            Cerrar sesión
          </button>
        </form>
      </div>
    </div>
  )
}
