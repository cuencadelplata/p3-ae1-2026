import { useState } from 'react'
import { Eye, EyeOff, ArrowLeft } from 'lucide-react'
import axios from 'axios'
import { API_URL } from '../api'

// RF-1.5: quien entra con Google o Auth0 queda registrado sin DNI ni teléfono (esos proveedores
// no los informan). En ese caso la app muestra esta misma pantalla en modo "completar": el email
// de la cuenta externa viene cargado y bloqueado, y los datos se guardan con PATCH /auth/me.
export interface DatosACompletar {
  token: string
  perfil: { email: string; nombre: string; apellido: string; dni: string; telefono: string }
}

interface RegisterProps {
  onRegisterSuccess: (token: string) => void
  onSwitchToLogin: () => void
  completar?: DatosACompletar
}

type UserRole = 'CLIENTE' | 'CONDUCTOR' | 'OPERADOR'

export default function Register({ onRegisterSuccess, onSwitchToLogin, completar }: RegisterProps) {
  const previo = completar?.perfil
  const [name, setName] = useState(previo?.nombre ?? '')
  const [surname, setSurname] = useState(previo?.apellido ?? '')
  const [dni, setDni] = useState(previo?.dni ?? '')
  const [phone, setPhone] = useState(previo?.telefono ?? '')
  const [email, setEmail] = useState(previo?.email ?? '')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [role, setRole] = useState<UserRole>('CLIENTE')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // Un dato que la cuenta ya tiene no se puede cambiar (M1 responde 409): ese campo queda bloqueado.
  const yaCargado = (valor?: string) => Boolean(completar && valor?.trim())

  const handleCompletar = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!completar) return
    setError('')

    if (!/^\d{7,9}$/.test(dni.trim())) {
      setError('El DNI debe contener entre 7 y 9 números, sin puntos.')
      return
    }

    // Solo se mandan los campos que estaban vacíos.
    const datos: Record<string, string> = {}
    const campos: [keyof DatosACompletar['perfil'], string][] = [
      ['nombre', name], ['apellido', surname], ['dni', dni], ['telefono', phone],
    ]
    for (const [campo, valor] of campos) {
      if (!completar.perfil[campo]?.trim() && valor.trim()) datos[campo] = valor.trim()
    }

    setLoading(true)
    try {
      await axios.patch(`${API_URL}/auth/me`, datos, {
        headers: { Authorization: `Bearer ${completar.token}` },
      })
      onRegisterSuccess(completar.token)
    } catch (err: any) {
      setError(err.response?.data?.error || 'No se pudieron guardar tus datos')
    } finally {
      setLoading(false)
    }
  }

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (password !== confirmPassword) {
      setError('Las contraseñas no coinciden')
      return
    }

    setLoading(true)

    try {
      await axios.post(`${API_URL}/auth/registrar-usuario`, {
        nombre: name,
        apellido: surname,
        dni,
        telefono: phone,
        email,
        password,
        rol: role,
      })

      const loginResponse = await axios.post(`${API_URL}/auth/iniciar-sesion`, {
        email,
        password,
      })

      const { token } = loginResponse.data
      onRegisterSuccess(token)
    } catch (err: any) {
      setError(err.response?.data?.error || err.response?.data?.message || 'Error al registrarse')
    } finally {
      setLoading(false)
    }
  }

  const roles: { value: UserRole; label: string }[] = [
    { value: 'CLIENTE', label: 'Cliente' },
    { value: 'CONDUCTOR', label: 'Conductor' },
  ]
  // OPERADOR no va: M1 no deja que un operador se registre solo (responde 400).

  return (
    <div className="w-full max-w-md">
      <div className="glass rounded-[1.75rem] p-9 md:p-11">
        {/* Encabezado */}
        <div className="mb-9">
          <p className="eyebrow">Registro</p>
          <h1 className="display text-[2.6rem] mt-3 mb-2">{completar ? 'Completá tu cuenta' : 'Creá tu cuenta'}</h1>
          <p className="text-sm text-[var(--text-soft)]">
            {completar
              ? 'Ingresaste con una cuenta externa. Completá los datos que faltan para continuar.'
              : 'Unos pocos datos y ya formás parte de la plataforma.'}
          </p>
        </div>

        <div className="hairline mb-8" />

        {error && <div className="alert-error mb-6 text-sm">{error}</div>}

        <form onSubmit={completar ? handleCompletar : handleRegister} className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="field-label">Nombre</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="input-field"
                placeholder="Juan"
                readOnly={yaCargado(previo?.nombre)}
                required
              />
            </div>
            <div>
              <label className="field-label">Apellido</label>
              <input
                type="text"
                value={surname}
                onChange={(e) => setSurname(e.target.value)}
                className="input-field"
                placeholder="Pérez"
                readOnly={yaCargado(previo?.apellido)}
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="field-label">DNI</label>
              <input
                type="text"
                value={dni}
                onChange={(e) => setDni(e.target.value)}
                className="input-field"
                placeholder="12345678"
                inputMode="numeric"
                readOnly={yaCargado(previo?.dni)}
                required
              />
            </div>
            <div>
              <label className="field-label">Teléfono</label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="input-field"
                placeholder="11 1234 5678"
                readOnly={yaCargado(previo?.telefono)}
                required
              />
            </div>
          </div>

          <div>
            <label className="field-label">Email</label>
            <div className="relative">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={`input-field${completar ? ' opacity-70 cursor-not-allowed' : ''}`}
                placeholder="tu@email.com"
                readOnly={Boolean(completar)}
                required
              />
            </div>
            {completar && (
              <p className="mt-2 text-[11px] tracking-wide text-[var(--text-dim)]">Es el email de la cuenta con la que ingresaste</p>
            )}
          </div>

          {/* En modo completar el rol ya quedó definido y la cuenta entra con Google o Auth0: no hace falta contraseña. */}
          {!completar && <>
          <div>
            <label className="field-label">Tipo de usuario</label>
            <div className="grid grid-cols-2 gap-2.5">
              {roles.map((r) => (
                <button
                  key={r.value}
                  type="button"
                  data-active={role === r.value}
                  onClick={() => setRole(r.value)}
                  className="role-chip text-xs tracking-[0.12em] uppercase"
                >
                  {r.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="field-label">Contraseña</label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="input-field pr-11"
                placeholder="••••••••"
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-[var(--text-dim)] hover:text-[var(--gold)] transition-colors"
                aria-label="Mostrar contraseña"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <p className="mt-2 text-[11px] tracking-wide text-[var(--text-dim)]">Mínimo 6 caracteres</p>
          </div>

          <div>
            <label className="field-label">Confirmar contraseña</label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="input-field"
                placeholder="••••••••"
                required
              />
            </div>
          </div>
          </>}

          <button type="submit" disabled={loading} className="btn-primary mt-2">
            {completar
              ? (loading ? 'Guardando…' : 'Guardar y continuar')
              : (loading ? 'Creando cuenta…' : 'Registrarme')}
          </button>
        </form>

        <button
          onClick={onSwitchToLogin}
          className="mt-6 w-full flex items-center justify-center gap-2 text-xs tracking-[0.18em] uppercase text-[var(--text-soft)] hover:text-[var(--gold)] transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          {completar ? 'Cancelar y cerrar sesión' : 'Volver al inicio de sesión'}
        </button>
      </div>
    </div>
  )
}
