import { useEffect, useRef, useState, type FormEvent } from 'react'
import { request, type Account, type DriverVehicle } from '../rideFlowApi'
import type { VehicleType } from '../places'

export default function DriverVehicles({ driver, onActivate }: { driver: Account; onActivate: (vehicle: DriverVehicle) => void }) {
  const { token, userId } = driver
  const path = '/api/v1/drivers/' + userId + '/vehicles'
  const [vehicles, setVehicles] = useState<DriverVehicle[]>([])
  const [type, setType] = useState<VehicleType>('AUTO')
  const [busy, setBusy] = useState(true)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState('')
  const pending = useRef<{ body: string; key: string } | null>(null)

  useEffect(() => {
    const abort = new AbortController()
    request<DriverVehicle[]>('M3-vehiculos', path, { token, signal: abort.signal })
      .then((list) => { if (!abort.signal.aborted) { setVehicles(list); setLoaded(true) } })
      .catch((cause: Error) => { if (!abort.signal.aborted) setError(cause.message) })
      .finally(() => { if (!abort.signal.aborted) setBusy(false) })
    return () => abort.abort()
  }, [path, token])

  async function update(action: () => Promise<void>) {
    setBusy(true)
    setError('')
    try { await action() } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo actualizar el vehículo.')
    } finally { setBusy(false) }
  }

  async function register(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const fields = new FormData(form)
    const body = {
      patente: String(fields.get('patente')).trim().toUpperCase(),
      marca: String(fields.get('marca')).trim(),
      modelo: String(fields.get('modelo')).trim(),
      anio: Number(fields.get('anio')),
      tipoServicio: type,
    }
    if (!body.marca || !body.modelo) { setError('Completá la marca y el modelo del vehículo.'); return }
    const encoded = JSON.stringify(body)
    if (pending.current?.body !== encoded) pending.current = { body: encoded, key: crypto.randomUUID() }
    const key = pending.current.key
    await update(async () => {
      const registered = await request<DriverVehicle>('M3-vehiculos', path, { method: 'POST', token, body, headers: { 'Idempotency-Key': key } })
      setVehicles((current) => [registered, ...current.filter(({ id }) => id !== registered.id)])
      pending.current = null
      form.reset()
    })
  }

  async function activate(vehicle: DriverVehicle) {
    await update(async () => {
      const active = await request<DriverVehicle>('M3-vehiculos', path + '/' + encodeURIComponent(vehicle.id) + '/activar', { method: 'PATCH', token })
      setVehicles((current) => current.map((item) => item.id === active.id ? active : { ...item, activo: false }))
      onActivate(active)
    })
  }

  return <section className="mt-4 grid gap-3" aria-label="Tus vehículos" aria-busy={busy}>
    <h3 className="font-semibold">Tus vehículos</h3>
    {error && <p role="alert" className="alert-error">{error}</p>}
    {loaded && !vehicles.length && <p>Todavía no hay vehículos registrados.</p>}
    <ul className="grid gap-2">{vehicles.map((vehicle) => <li key={vehicle.id} className="flex flex-wrap items-center justify-between gap-2">
      <span>{vehicle.tipoServicio === 'MOTO' ? 'Moto' : 'Auto'} · <strong>{vehicle.patente}</strong> · {[vehicle.marca, vehicle.modelo, vehicle.anio].filter(Boolean).join(' ')}</span>
      {vehicle.activo
        ? <span className="text-[var(--accent)]" role="status">Activo</span>
        : <button type="button" className="btn-secondary" disabled={busy} onClick={() => void activate(vehicle)}>Activar</button>}
    </li>)}</ul>
    {loaded && <form className="ride-form" onSubmit={(event) => void register(event)}>
      <fieldset className="grid gap-2" disabled={busy}>
        <legend className="font-semibold">Registrar vehículo</legend>
        <label>Tipo <select className="input-field" value={type} onChange={(event) => setType(event.target.value === 'MOTO' ? 'MOTO' : 'AUTO')}>
          <option value="AUTO">Auto</option><option value="MOTO">Moto</option>
        </select></label>
        <label>Patente <input className="input-field" name="patente"
          pattern={type === 'MOTO' ? '([A-Za-z][0-9]{3}[A-Za-z]{3}|[0-9]{3}[A-Za-z]{3}|[A-Za-z]{3}[0-9]{3}|[A-Za-z]{2}[0-9]{3}[A-Za-z]{2})' : '([A-Za-z]{3}[0-9]{3}|[A-Za-z]{2}[0-9]{3}[A-Za-z]{2})'}
          placeholder={type === 'MOTO' ? 'A123BCD' : 'AA123BB'} required /></label>
        <label>Marca <input className="input-field" name="marca" required /></label>
        <label>Modelo <input className="input-field" name="modelo" required /></label>
        <label>Año <input className="input-field" name="anio" type="number" min={1990} max={new Date().getFullYear()+1} required /></label>
        <button className="btn-primary" type="submit">Registrar vehículo</button>
      </fieldset>
    </form>}
  </section>
}
