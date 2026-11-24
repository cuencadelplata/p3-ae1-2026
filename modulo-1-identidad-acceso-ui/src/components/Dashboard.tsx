import { useCallback, useEffect, useState } from 'react'
import axios from 'axios'
import Reservations from './Reservations'
import BrowserNotifications from './BrowserNotifications'
import TripHistory from './TripHistory'
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
  Link2,
  Route,
} from 'lucide-react'
import { API_URL } from '../api'
import DriverDispatch from './DriverDispatch'
import RideFlow from './RideFlow'

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

// Respuesta de GET /auth/oauth2/userinfo (RF-1.5): cuentas externas vinculadas al usuario.
interface ProveedorVinculado {
  provider: string
  email: string | null
  linkedAt: string
  lastLoginAt: string | null
}

const nombreProveedor = (p: string) =>
  ({ GOOGLE: 'Google', AUTH0: 'Auth0', MOCK: 'Proveedor de prueba' } as Record<string, string>)[p] || p

const roleLabel = (rol: string) =>
  ({ CLIENTE: 'Cliente', CONDUCTOR: 'Conductor', OPERADOR: 'Operador' } as Record<string, string>)[rol] || rol

export default function Dashboard({ token, onLogout }: DashboardProps) {
  const [perfil, setPerfil] = useState<MiPerfil | null>(null)
  const [validacion, setValidacion] = useState<Validacion | null>(null)
  const [validadoA, setValidadoA] = useState<Date | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [revocando, setRevocando] = useState(false)
  const [vinculados, setVinculados] = useState<ProveedorVinculado[] | null>(null)
  const [verViaje, setVerViaje] = useState(false)
  const [verReservas, setVerReservas] = useState(false)
  const [verHistorial, setVerHistorial] = useState(false)

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
      setError('No se pudo conectar con el servicio de identidad. Volvé a intentar.')
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
        // RF-1.5: si falla, el panel sigue funcionando sin esta sección.
        try {
          const info = await axios.get<{ linkedProviders: ProveedorVinculado[] }>(`${API_URL}/auth/oauth2/userinfo`, { headers })
          setVinculados(info.data.linkedProviders)
        } catch {
          setVinculados(null)
        }
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
    if (!window.confirm('¿Querés cerrar sesión en todos los dispositivos? También se cerrará la sesión actual.')) return

    setRevocando(true)
    try {
      await axios.post(`${API_URL}/auth/revocar-credenciales`, {}, { headers })
      onLogout('Se cerraron todas tus sesiones. Iniciá sesión de nuevo.')
    } catch (err) {
      manejarError(err)
      setRevocando(false)
    }
  }

  const nombreCompleto = perfil ? `${perfil.nombre} ${perfil.apellido}` : ''
  const iniciales = perfil ? `${perfil.nombre[0] ?? ''}${perfil.apellido[0] ?? ''}`.toUpperCase() : '?'

  if (verHistorial && perfil?.rol === 'CLIENTE') {
    return <TripHistory token={token} userId={perfil.userId} onBack={() => setVerHistorial(false)} />
  }
  if (verReservas && perfil?.rol === 'CLIENTE') {
    return <Reservations token={token} onBack={() => setVerReservas(false)} onOpenTrip={() => {
      setVerReservas(false)
      setVerViaje(true)
    }} />
  }
  if (verViaje && perfil?.rol === 'CLIENTE') {
    return <RideFlow key={perfil.userId} passenger={{ ...perfil, token }} onBack={() => setVerViaje(false)} />
  }
  if (verViaje && perfil?.rol === 'CONDUCTOR') {
    return <DriverDispatch key={perfil.userId} driver={{ ...perfil, token }} onSessionExpired={() => onLogout('Tu sesión terminó. Iniciá sesión de nuevo para compartir tu ubicación.')} onBack={() => setVerViaje(false)} />
  }

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

            {(perfil.rol === 'CLIENTE' || perfil.rol === 'CONDUCTOR') && (
              <button className="btn-primary mt-6 inline-flex items-center gap-2" onClick={() => setVerViaje(true)}>
                <Route className="w-4 h-4" aria-hidden="true" /> {perfil.rol === 'CLIENTE' ? 'Pedir un viaje' : 'Abrir despacho'}
              </button>
            )}

            {perfil.rol === 'CLIENTE' && <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <button className="btn-secondary" onClick={() => setVerReservas(true)}>Mis reservas</button>
              <button className="btn-secondary" onClick={() => setVerHistorial(true)}>Historial de viajes</button>
            </div>}

            {(perfil.rol === 'CLIENTE' || perfil.rol === 'CONDUCTOR') && (
              <BrowserNotifications key={perfil.userId} token={token} role={perfil.rol} />
            )}

            <p className="eyebrow mt-10">Mis datos</p>
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
                  <p className="font-mono text-sm break-all text-[var(--text)]">{valor || '—'}</p>
                </div>
              ))}
            </div>
          </>
        )}

        {/* Validación de identidad y rol: lo que ven los otros módulos (RF-1.3) */}
        {validacion && (
          <div className="mt-8 rounded-2xl border border-[var(--line)] p-6">
            <p className="eyebrow mb-4">Cómo te ven los otros módulos</p>
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

        {/* Cuentas externas vinculadas (RF-1.5) */}
        {perfil && vinculados && (
          <div className="mt-6 rounded-2xl border border-[var(--line)] p-6">
            <p className="eyebrow mb-4">Cuentas externas</p>
            {vinculados.length === 0 ? (
              <p className="text-sm text-[var(--text-soft)]">
                Ninguna: entraste con email y contraseña. Si entrás con Google o Auth0, lo vas a ver acá.
              </p>
            ) : (
              <ul className="space-y-3 text-sm text-[var(--text-soft)]">
                {vinculados.map((v) => (
                  <li key={v.provider} className="flex items-center gap-2.5">
                    <Link2 className="w-4 h-4 text-[var(--gold)] shrink-0" />
                    <span>
                      {nombreProveedor(v.provider)}
                      {v.email ? ` · ${v.email}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* Revocación de credenciales (RF-1.4) */}
        {perfil && (
          <div className="mt-6 rounded-2xl border border-[var(--line)] p-6">
            <p className="eyebrow mb-2">Seguridad</p>
            <p className="text-sm text-[var(--text-soft)] mb-4">
              Cerrá las sesiones abiertas en tus dispositivos, incluido este. Vas a tener que iniciar sesión de nuevo.
            </p>
            <button onClick={revocar} disabled={revocando} className="btn-secondary flex items-center justify-center gap-2">
              <KeyRound className="w-4 h-4" />
              {revocando ? 'Cerrando sesiones…' : 'Cerrar sesión en todos los dispositivos'}
            </button>
          </div>
        )}

      </div>
    </div>
  )
}
