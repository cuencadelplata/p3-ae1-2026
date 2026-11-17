import { useCallback, useEffect, useState } from 'react'
import axios from 'axios'
import {
  LogOut,
  Mail,
  Shield,
  Fingerprint,
  Clock,
  Check,
  X,
  Phone,
  IdCard,
  RefreshCw,
  KeyRound,
} from 'lucide-react'
import { API_URL } from '../api'

interface DashboardProps {
  token: string
  onLogout: (aviso?: string) => void
}

// Respuesta de GET /auth/me (RF-1.2): datos reales del usuario, leídos de la base de M1.
interface MiPerfil {
  userId: number
  nombre: string
  apellido: string
  dni: string
  telefono: string
  email: string
  rol: string
  estado: string
  creadoEn: string
}

// Respuesta de GET /auth/validar-identidad-y-rol (RF-1.3): lo mismo que reciben los otros módulos.
interface Validacion {
  valid: boolean
  userId: number
  role: string
  authMethod: string
}

const roleLabel = (rol: string) =>
  ({ CLIENTE: 'Cliente', CONDUCTOR: 'Conductor', OPERADOR: 'Operador' } as Record<string, string>)[rol] || rol

function Fuente({ texto }: { texto: string }) {
  return (
    <span className="font-mono text-[10px] tracking-normal normal-case text-[var(--text-dim)]">{texto}</span>
  )
}

export default function Dashboard({ token, onLogout }: DashboardProps) {
  const [perfil, setPerfil] = useState<MiPerfil | null>(null)
  const [validacion, setValidacion] = useState<Validacion | null>(null)
  const [validadoA, setValidadoA] = useState<Date | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [revocando, setRevocando] = useState(false)

  const headers = { Authorization: `Bearer ${token}` }

  // Si M1 rechaza el token (venció, se revocó o es inválido), se cierra la sesión.
  const manejarError = useCallback(
    (err: any) => {
      if (err.response?.status === 401) {
        onLogout(`Tu sesión terminó: ${err.response.data?.error || 'token rechazado por M1'}. Iniciá sesión de nuevo.`)
        return
      }
      if (err.response?.status === 403) {
        setError(err.response.data?.error || 'Usuario bloqueado')
        return
      }
      setError('No se pudo conectar con M1 (¿está corriendo en ' + API_URL + '?)')
    },
    [onLogout]
  )

  const validar = useCallback(async () => {
    try {
      const { data } = await axios.get<Validacion>(`${API_URL}/auth/validar-identidad-y-rol`, { headers })
      setValidacion(data)
      setValidadoA(new Date())
    } catch (err) {
      manejarError(err)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, manejarError])

  useEffect(() => {
    const cargar = async () => {
      setCargando(true)
      setError('')
      try {
        const { data } = await axios.get<MiPerfil>(`${API_URL}/auth/me`, { headers })
        setPerfil(data)
        await validar()
      } catch (err) {
        manejarError(err)
      } finally {
        setCargando(false)
      }
    }
    cargar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  // RF-1.4: invalida todos los tokens del usuario (también los de otros dispositivos).
  const revocar = async () => {
    setRevocando(true)
    try {
      await axios.post(`${API_URL}/auth/revocar-credenciales`, {}, { headers })
      onLogout('Credenciales revocadas: todos tus tokens dejaron de funcionar. Iniciá sesión de nuevo.')
    } catch (err) {
      manejarError(err)
      setRevocando(false)
    }
  }

  const nombreCompleto = perfil ? `${perfil.nombre} ${perfil.apellido}` : ''
  const iniciales = perfil ? `${perfil.nombre[0] ?? ''}${perfil.apellido[0] ?? ''}`.toUpperCase() : '?'

  return (
    <div className="w-full max-w-3xl">
      <div className="glass rounded-[1.75rem] p-9 md:p-12">
        {/* Encabezado */}
        <div className="flex items-start justify-between gap-6">
          <div>
            <p className="eyebrow">Panel</p>
            <h1 className="display text-[2.6rem] mt-3">Tu cuenta</h1>
          </div>
          <button onClick={() => onLogout()} className="btn-ghost flex items-center gap-2 shrink-0">
            <LogOut className="w-4 h-4" />
            Cerrar sesión
          </button>
        </div>

        <div className="hairline my-9" />

        {error && <div className="alert-error mb-6 text-sm">{error}</div>}
        {cargando && <p className="text-sm text-[var(--text-soft)]">Consultando a M1…</p>}

        {perfil && (
          <>
            {/* Identidad: GET /auth/me */}
            <div className="flex items-center gap-5">
              <div className="h-16 w-16 rounded-full border border-[var(--accent)] flex items-center justify-center display text-xl text-[var(--gold)]">
                {iniciales}
              </div>
              <div className="min-w-0">
                <p className="display text-2xl truncate">{nombreCompleto}</p>
                <div className="mt-2 flex items-center gap-2 text-[11px] tracking-[0.22em] uppercase text-[var(--text-dim)]">
                  <span>{roleLabel(perfil.rol)}</span>
                  <span>·</span>
                  <span>Usuario #{perfil.userId}</span>
                  <span>·</span>
                  <span className={perfil.estado === 'ACTIVO' ? 'text-[var(--gold)]' : 'text-red-400'}>{perfil.estado}</span>
                </div>
              </div>
            </div>

            <div className="mt-10 flex items-center justify-between">
              <p className="eyebrow">Mis datos</p>
              <Fuente texto="GET /auth/me" />
            </div>
            <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
              {[
                { icono: Mail, titulo: 'Email', valor: perfil.email },
                { icono: IdCard, titulo: 'DNI', valor: perfil.dni },
                { icono: Phone, titulo: 'Teléfono', valor: perfil.telefono },
                { icono: Clock, titulo: 'Cuenta creada', valor: new Date(perfil.creadoEn.replace(' ', 'T') + 'Z').toLocaleString('es-AR') },
              ].map(({ icono: Icono, titulo, valor }) => (
                <div key={titulo} className="detail-card">
                  <div className="flex items-center gap-2.5 mb-3">
                    <Icono className="w-4 h-4 text-[var(--gold)]" />
                    <span className="field-label !mb-0">{titulo}</span>
                  </div>
                  <p className="font-mono text-sm break-all text-[var(--text)]">{valor}</p>
                </div>
              ))}
            </div>
          </>
        )}

        {/* Validación de identidad y rol: lo que ven los otros módulos (RF-1.3) */}
        {validacion && (
          <div className="mt-8 rounded-2xl border border-[var(--line)] p-6">
            <div className="flex items-center justify-between mb-4">
              <p className="eyebrow">Cómo te ven los otros módulos</p>
              <Fuente texto="GET /auth/validar-identidad-y-rol" />
            </div>
            <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm text-[var(--text-soft)]">
              <li className="flex items-center gap-2.5">
                {validacion.valid ? <Check className="w-4 h-4 text-[var(--gold)] shrink-0" /> : <X className="w-4 h-4 text-red-400 shrink-0" />}
                {validacion.valid ? 'Identidad válida' : 'Identidad NO válida'}
              </li>
              <li className="flex items-center gap-2.5">
                <Shield className="w-4 h-4 text-[var(--gold)] shrink-0" />
                Rol: {roleLabel(validacion.role)}
              </li>
              <li className="flex items-center gap-2.5">
                <Fingerprint className="w-4 h-4 text-[var(--gold)] shrink-0" />
                userId {validacion.userId} · ingreso por {validacion.authMethod}
              </li>
              <li className="flex items-center gap-2.5">
                <Clock className="w-4 h-4 text-[var(--gold)] shrink-0" />
                Validado a las {validadoA?.toLocaleTimeString('es-AR')}
              </li>
            </ul>
            <button onClick={validar} className="btn-ghost mt-5 flex items-center gap-2">
              <RefreshCw className="w-4 h-4" />
              Validar de nuevo
            </button>
          </div>
        )}

        {/* Revocación de credenciales (RF-1.4) */}
        {perfil && (
          <div className="mt-6 rounded-2xl border border-[var(--line)] p-6">
            <div className="flex items-center justify-between mb-2">
              <p className="eyebrow">Seguridad</p>
              <Fuente texto="POST /auth/revocar-credenciales" />
            </div>
            <p className="text-sm text-[var(--text-soft)] mb-4">
              Invalida todos tus tokens, también los de otros dispositivos. Vas a tener que iniciar sesión de nuevo.
            </p>
            <button onClick={revocar} disabled={revocando} className="btn-secondary flex items-center justify-center gap-2">
              <KeyRound className="w-4 h-4" />
              {revocando ? 'Revocando…' : 'Revocar mis credenciales'}
            </button>
          </div>
        )}

        <div className="hairline mt-10 mb-5" />
        <p className="text-center text-[11px] tracking-[0.22em] uppercase text-[var(--text-dim)]">
          Datos en vivo de M1 · {API_URL} · Docs /docs
        </p>
      </div>
    </div>
  )
}
