import { useState, type FormEvent } from 'react'
import { ArrowLeft } from 'lucide-react'
import { ensureDriverProfile, request, type Account, type DriverVehicle } from '../rideFlowApi'

interface DocumentoGuardado {
  tipoDocumento: string
  cara: string | null
}

function fechaMinima() {
  const date = new Date()
  date.setDate(date.getDate() + 1)
  const mes = String(date.getMonth() + 1).padStart(2, '0')
  const dia = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${mes}-${dia}`
}

const venceMinimo = fechaMinima()

function archivoComoImagen(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('No se pudo leer la imagen.'))
    reader.onload = () => {
      const image = new Image()
      image.onerror = () => reject(new Error('El archivo tiene que ser una imagen.'))
      image.onload = () => {
        const escala = Math.min(1, 1200 / Math.max(image.width, image.height))
        const canvas = document.createElement('canvas')
        canvas.width = Math.max(1, Math.round(image.width * escala))
        canvas.height = Math.max(1, Math.round(image.height * escala))
        const context = canvas.getContext('2d')
        if (!context) { reject(new Error('No se pudo preparar la imagen.')); return }
        context.drawImage(image, 0, 0, canvas.width, canvas.height)
        let quality = 0.72
        let data = canvas.toDataURL('image/jpeg', quality)
        while (data.length > 700_000 && quality > 0.4) {
          quality -= 0.1
          data = canvas.toDataURL('image/jpeg', quality)
        }
        if (data.length > 900_000) { reject(new Error('La imagen sigue siendo demasiado pesada. Probá con una foto más chica.')); return }
        resolve(data)
      }
      image.src = String(reader.result)
    }
    reader.readAsDataURL(file)
  })
}

async function archivoDelFormulario(form: FormData, nombre: string) {
  const file = form.get(nombre)
  if (!(file instanceof File) || file.size === 0) throw new Error('Falta una de las fotos de la documentación.')
  return archivoComoImagen(file)
}

export default function DriverOnboarding({ driver, onBack }: { driver: Account; onBack: () => void }) {
  const [tipo, setTipo] = useState<'AUTO' | 'MOTO'>('AUTO')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [listo, setListo] = useState(false)
  const { token, userId } = driver
  const base = '/api/v1/drivers/' + userId

  async function enviar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const fields = new FormData(form)
    const patente = String(fields.get('patente') || '').trim().toUpperCase()
    const marca = String(fields.get('marca') || '').trim()
    const modelo = String(fields.get('modelo') || '').trim()
    const anio = Number(fields.get('anio'))
    if (!patente || !marca || !modelo || !anio) { setError('Completá los datos del vehículo.'); return }

    setBusy(true)
    setError('')
    try {
      await ensureDriverProfile(token)
      const vehicles = await request<DriverVehicle[]>('M3-vehiculos', base + '/vehicles', { token })
      let vehicle = vehicles.find((item) => item.activo) ?? vehicles[0]
      if (!vehicle) {
        vehicle = await request<DriverVehicle>('M3-vehiculos', base + '/vehicles', {
          method: 'POST', token, headers: { 'Idempotency-Key': crypto.randomUUID() },
          body: { patente, marca, modelo, anio, tipoServicio: tipo },
        })
        vehicle = await request<DriverVehicle>('M3-vehiculos', base + '/vehicles/' + encodeURIComponent(vehicle.id) + '/activar', { method: 'PATCH', token })
      }

      const guardados = await request<DocumentoGuardado[]>('M3-vehiculos', base + '/documents', { token }).catch(() => [])
      const yaEsta = (tipoDocumento: string, cara: string | null) => guardados.some((documento) => documento.tipoDocumento === tipoDocumento && (documento.cara ?? null) === cara)

      const piezas = [
        { tipoDocumento: 'LICENCIA_CONDUCIR', cara: 'FRENTE', numero: 'licenciaNumero', vence: 'licenciaVence', foto: 'licenciaFrente', vehicleId: undefined },
        { tipoDocumento: 'LICENCIA_CONDUCIR', cara: 'DORSO', numero: 'licenciaNumero', vence: 'licenciaVence', foto: 'licenciaDorso', vehicleId: undefined },
        { tipoDocumento: 'CEDULA_VEHICULO', cara: 'FRENTE', numero: 'cedulaNumero', vence: 'cedulaVence', foto: 'cedulaFrente', vehicleId: vehicle.id },
        { tipoDocumento: 'CEDULA_VEHICULO', cara: 'DORSO', numero: 'cedulaNumero', vence: 'cedulaVence', foto: 'cedulaDorso', vehicleId: vehicle.id },
        { tipoDocumento: 'SEGURO_VEHICULO', cara: null, numero: 'seguroNumero', vence: 'seguroVence', foto: 'seguro', vehicleId: vehicle.id },
      ] as const

      for (const pieza of piezas) {
        if (yaEsta(pieza.tipoDocumento, pieza.cara)) continue
        const archivoUrl = await archivoDelFormulario(fields, pieza.foto)
        await request('M3-vehiculos', base + '/documents', {
          method: 'POST', token, headers: { 'Idempotency-Key': crypto.randomUUID() },
          body: {
            tipoDocumento: pieza.tipoDocumento,
            ...(pieza.cara ? { cara: pieza.cara } : {}),
            ...(pieza.vehicleId ? { vehicleId: pieza.vehicleId } : {}),
            numeroDocumento: String(fields.get(pieza.numero) || '').trim(),
            fechaVencimiento: String(fields.get(pieza.vence) || ''),
            archivoUrl,
          },
        })
      }
      setListo(true)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo enviar el alta.')
    } finally {
      setBusy(false)
    }
  }

  return <section className="glass w-full max-w-3xl rounded-[1.75rem] p-6 md:p-12">
    <button className="btn-ghost inline-flex items-center gap-2" onClick={onBack} disabled={busy}><ArrowLeft size={16} /> Tu cuenta</button>
    <h1 className="display mt-4 text-3xl">Alta de conductor</h1>
    <p className="mt-2 text-sm text-[var(--text-soft)]">El vehículo, la licencia, la cédula y el seguro se envían a M3. Un operador los revisa desde Habilitar conductores.</p>
    {error && <p className="alert-error mt-4" role="alert">{error}</p>}
    {listo
      ? <p className="mt-6" role="status">Alta enviada. Quedás pendiente de habilitación hasta que un operador la apruebe.</p>
      : <form className="ride-form mt-6" onSubmit={(event) => void enviar(event)}>
        <fieldset className="grid gap-3" disabled={busy}>
          <legend className="font-semibold">Vehículo</legend>
          <label>Tipo
            <select className="input-field" value={tipo} onChange={(event) => setTipo(event.target.value === 'MOTO' ? 'MOTO' : 'AUTO')}>
              <option value="AUTO">Auto</option>
              <option value="MOTO">Moto</option>
            </select>
          </label>
          <label>Patente
            <input className="input-field" name="patente" required placeholder={tipo === 'MOTO' ? 'A123BCD' : 'AA123BB'}
              pattern={tipo === 'MOTO' ? '([A-Za-z][0-9]{3}[A-Za-z]{3}|[0-9]{3}[A-Za-z]{3}|[A-Za-z]{3}[0-9]{3}|[A-Za-z]{2}[0-9]{3}[A-Za-z]{2})' : '([A-Za-z]{3}[0-9]{3}|[A-Za-z]{2}[0-9]{3}[A-Za-z]{2})'} />
          </label>
          <label>Marca <input className="input-field" name="marca" required /></label>
          <label>Modelo <input className="input-field" name="modelo" required /></label>
          <label>Año <input className="input-field" name="anio" type="number" min={1990} max={new Date().getFullYear() + 1} required /></label>
        </fieldset>

        <fieldset className="mt-6 grid gap-3" disabled={busy}>
          <legend className="font-semibold">Licencia de conducir</legend>
          <label>Número <input className="input-field" name="licenciaNumero" required /></label>
          <label>Vencimiento <input className="input-field" name="licenciaVence" type="date" min={venceMinimo} required /></label>
          <label>Frente <input className="input-field" name="licenciaFrente" type="file" accept="image/*" required /></label>
          <label>Dorso <input className="input-field" name="licenciaDorso" type="file" accept="image/*" required /></label>
        </fieldset>

        <fieldset className="mt-6 grid gap-3" disabled={busy}>
          <legend className="font-semibold">Cédula del vehículo</legend>
          <label>Número <input className="input-field" name="cedulaNumero" required /></label>
          <label>Vencimiento <input className="input-field" name="cedulaVence" type="date" min={venceMinimo} required /></label>
          <label>Frente <input className="input-field" name="cedulaFrente" type="file" accept="image/*" required /></label>
          <label>Dorso <input className="input-field" name="cedulaDorso" type="file" accept="image/*" required /></label>
        </fieldset>

        <fieldset className="mt-6 grid gap-3" disabled={busy}>
          <legend className="font-semibold">Seguro</legend>
          <label>Número <input className="input-field" name="seguroNumero" required /></label>
          <label>Vencimiento <input className="input-field" name="seguroVence" type="date" min={venceMinimo} required /></label>
          <label>Foto o constancia <input className="input-field" name="seguro" type="file" accept="image/*" required /></label>
        </fieldset>

        <button className="btn-primary mt-6" type="submit" disabled={busy}>{busy ? 'Enviando alta…' : 'Enviar alta'}</button>
      </form>}
  </section>
}
