import { useEffect, useState, type FormEvent } from 'react'
import { ArrowLeft, Pencil, RotateCcw, Star, Trash2 } from 'lucide-react'
import {
  buscarDireccion, editarDireccion, eliminarDireccion, guardarFavorita, listarDirecciones, mensajeDeError, obtenerSugerencias,
} from '../direccionesApi'
import type { Direccion, Sugerencias, TipoDireccion } from '../direccionesApi'
import { FlowError } from '../rideFlowApi'
import './RideFlow.css'

// RF-2.2: el cliente administra sus direcciones favoritas y ve las que usó en sus últimos viajes.
const usoLabel = { ORIGEN: 'Para salir', DESTINO: 'Para llegar' }
const vacio = { etiqueta: '', direccion: '', tipo: 'DESTINO' as TipoDireccion }

export default function MisDirecciones({ token, onBack }: { token: string; onBack: () => void }) {
  const [direcciones, setDirecciones] = useState<Direccion[]>([])
  const [sugerencias, setSugerencias] = useState<Sugerencias | null>(null)
  const [form, setForm] = useState(vacio)
  const [renombrando, setRenombrando] = useState<{ id: string; etiqueta: string } | null>(null)
  const [cargando, setCargando] = useState(true)
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState('')
  const [aviso, setAviso] = useState('')
  const [revision, setRevision] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    setCargando(true)
    Promise.all([listarDirecciones(token, {}, controller.signal), obtenerSugerencias(token, controller.signal)])
      .then(([lista, sug]) => { setDirecciones(lista); setSugerencias(sug) })
      .catch((e) => { if (!controller.signal.aborted) setError(mensajeDeError(e, 'cargar tus direcciones')) })
      .finally(() => { if (!controller.signal.aborted) setCargando(false) })
    return () => controller.abort()
  }, [token, revision])

  const favoritas = direcciones.filter((d) => d.favorita)
  const recientes = direcciones.filter((d) => !d.favorita && d.usos > 0)

  async function ejecutar(accion: string, tarea: () => Promise<unknown>, exito = '') {
    setOcupado(true)
    setError('')
    setAviso('')
    try {
      await tarea()
      if (exito) setAviso(exito)
    } catch (e) {
      setError(mensajeDeError(e, accion))
    } finally {
      setOcupado(false)
      setRevision((n) => n + 1)
    }
  }

  async function agregar(event: FormEvent) {
    event.preventDefault()
    const texto = form.direccion.trim()
    if (texto.length < 3) return setError('Escribí la dirección con calle, altura y ciudad.')
    await ejecutar('guardar la favorita', async () => {
      // Se intenta ubicar la dirección con M4 (a través de M2); si no aparece, se guarda igual solo con el texto.
      let coordenadas: { latitud?: number; longitud?: number } = {}
      try {
        const [encontrada] = await buscarDireccion(token, texto)
        if (encontrada?.latitud != null && encontrada.longitud != null) coordenadas = { latitud: encontrada.latitud, longitud: encontrada.longitud }
      } catch (e) {
        if (e instanceof FlowError && e.status === 401) throw e
      }
      await guardarFavorita(token, { tipo: form.tipo, direccion: texto, ...(form.etiqueta.trim() && { etiqueta: form.etiqueta.trim() }), ...coordenadas })
      setForm(vacio)
    }, 'Dirección guardada en tus favoritas.')
  }

  const regreso = sugerencias?.regreso

  return (
    <section className="glass w-full max-w-3xl rounded-[1.75rem] p-6 md:p-12">
      <button className="btn-ghost inline-flex items-center gap-2" onClick={onBack}><ArrowLeft size={16} /> Tu cuenta</button>
      <h1 className="display mt-4 text-3xl">Mis direcciones</h1>
      <p className="ride-muted mt-2">Guardá los lugares que usás seguido. También vas a ver los de tus últimos viajes y te van a aparecer al pedir uno.</p>
      {error && <p className="alert-error mt-4" role="alert">{error}</p>}
      {aviso && <p className="mt-4 text-sm text-[var(--gold)]" role="status">{aviso}</p>}

      {regreso?.origen && regreso.destino && (
        <div className="mt-6 rounded-xl border border-[var(--accent)] p-4">
          <p className="eyebrow inline-flex items-center gap-2"><RotateCcw size={14} aria-hidden="true" /> Sugerencia de regreso</p>
          <p className="mt-2">Tu último viaje terminó en <strong>{regreso.origen.direccion}</strong>. ¿Volvés a <strong>{regreso.destino.direccion}</strong>?</p>
          <p className="ride-muted mt-1 text-sm">Te lo vamos a ofrecer al pedir un viaje.</p>
        </div>
      )}

      <form className="ride-form mt-6" onSubmit={(event) => void agregar(event)}>
        <h2 className="eyebrow">Agregar una favorita</h2>
        <fieldset className="grid gap-3" disabled={ocupado}>
          <label>Nombre (opcional)<input className="input-field" placeholder="Casa, Trabajo, Facultad…" value={form.etiqueta} maxLength={60} onChange={(e) => setForm({ ...form, etiqueta: e.target.value })} /></label>
          <label>Dirección<input className="input-field" placeholder="Calle, altura y ciudad" value={form.direccion} maxLength={250} required onChange={(e) => setForm({ ...form, direccion: e.target.value })} /></label>
          <label>La uso<select className="input-field" value={form.tipo} onChange={(e) => setForm({ ...form, tipo: e.target.value as TipoDireccion })}>
            <option value="DESTINO">Para llegar</option><option value="ORIGEN">Para salir</option>
          </select></label>
          <button className="btn-primary" type="submit">{ocupado ? 'Guardando…' : 'Guardar favorita'}</button>
        </fieldset>
      </form>

      <div className="mt-8" aria-busy={cargando}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="eyebrow">Favoritas</h2>
          <button className="btn-ghost" disabled={cargando || ocupado} onClick={() => { setError(''); setRevision((n) => n + 1) }}>Actualizar</button>
        </div>
        {cargando ? <p role="status" className="mt-3">Consultando tus direcciones…</p>
          : favoritas.length === 0 && <p className="ride-muted mt-3">Todavía no guardaste ninguna favorita.</p>}
        <ul className="mt-3 grid gap-3">
          {favoritas.map((d) => <li key={d.id} className="rounded-xl border border-[var(--line)] p-4">
            {renombrando?.id === d.id ? (
              <form className="flex flex-wrap gap-2" onSubmit={(event) => {
                event.preventDefault()
                const etiqueta = renombrando.etiqueta.trim()
                if (!etiqueta) return
                void ejecutar('cambiar el nombre', async () => { await editarDireccion(token, d, { etiqueta }); setRenombrando(null) })
              }}>
                <input className="input-field flex-1" aria-label="Nuevo nombre" value={renombrando.etiqueta} maxLength={60} autoFocus
                  onChange={(e) => setRenombrando({ id: d.id, etiqueta: e.target.value })} />
                <button className="btn-primary" type="submit" disabled={ocupado}>Guardar</button>
                <button className="btn-ghost" type="button" onClick={() => setRenombrando(null)}>Cancelar</button>
              </form>
            ) : <>
              <p className="font-semibold inline-flex items-center gap-2"><Star size={15} className="text-[var(--gold)]" aria-hidden="true" /> {d.etiqueta ?? d.direccion}</p>
              {d.etiqueta && <p>{d.direccion}</p>}
              <p className="ride-muted text-sm">{usoLabel[d.tipo]}{d.usos > 0 ? ` · usada en ${d.usos} ${d.usos === 1 ? 'viaje' : 'viajes'}` : ''}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button className="btn-ghost inline-flex items-center gap-1" disabled={ocupado} onClick={() => setRenombrando({ id: d.id, etiqueta: d.etiqueta ?? '' })}><Pencil size={14} aria-hidden="true" /> Cambiar nombre</button>
                <button className="btn-ghost inline-flex items-center gap-1" disabled={ocupado} onClick={() => {
                  if (!window.confirm('¿Querés borrar esta dirección?')) return
                  void ejecutar('borrar la dirección', () => eliminarDireccion(token, d), 'Dirección borrada.')
                }}><Trash2 size={14} aria-hidden="true" /> Borrar</button>
              </div>
            </>}
          </li>)}
        </ul>

        <h2 className="eyebrow mt-8">Usadas en tus últimos viajes</h2>
        {!cargando && recientes.length === 0 && <p className="ride-muted mt-3">Cuando termines un viaje, el origen y el destino aparecen acá.</p>}
        <ul className="mt-3 grid gap-3">
          {recientes.map((d) => <li key={d.id} className="rounded-xl border border-[var(--line)] p-4">
            <p className="font-semibold">{d.direccion}</p>
            <p className="ride-muted text-sm">{usoLabel[d.tipo]} · {d.usos} {d.usos === 1 ? 'viaje' : 'viajes'}{d.ultimoUso ? ` · último: ${new Date(d.ultimoUso).toLocaleDateString('es-AR')}` : ''}</p>
            <button className="btn-ghost mt-2 inline-flex items-center gap-1" disabled={ocupado}
              onClick={() => void ejecutar('guardar la favorita', () => editarDireccion(token, d, { favorita: true }), 'Dirección guardada en tus favoritas.')}>
              <Star size={14} aria-hidden="true" /> Guardar como favorita
            </button>
          </li>)}
        </ul>
      </div>
    </section>
  )
}
