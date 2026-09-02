import { useState } from 'react'
import { Eye, EyeOff, ArrowLeft } from 'lucide-react'
import axios from 'axios'

interface RegisterProps {
  onRegisterSuccess: (token: string, user: any) => void
  onSwitchToLogin: () => void
}

type UserRole = 'CLIENTE' | 'CONDUCTOR' | 'OPERADOR'

export default function Register({ onRegisterSuccess, onSwitchToLogin }: RegisterProps) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [role, setRole] = useState<UserRole>('CLIENTE')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (password !== confirmPassword) {
      setError('Las contraseñas no coinciden')
      return
    }

    setLoading(true)

    try {
      await axios.post('http://localhost:3001/auth/registrar-usuario', {
        nombre: name,
        email,
        password,
        rol: role,
      })

      const loginResponse = await axios.post('http://localhost:3001/auth/iniciar-sesion', {
        email,
        password,
      })

      const { token } = loginResponse.data
      const parts = token.split('.')
      const decoded = JSON.parse(atob(parts[1]))

      onRegisterSuccess(token, { ...decoded, ...loginResponse.data.usuario })
    } catch (err: any) {
      setError(err.response?.data?.error || err.response?.data?.message || 'Error al registrarse')
    } finally {
      setLoading(false)
    }
  }

  const roles: { value: UserRole; label: string }[] = [
    { value: 'CLIENTE', label: 'Cliente' },
    { value: 'CONDUCTOR', label: 'Conductor' },
    { value: 'OPERADOR', label: 'Operador' },
  ]

  return (
    <div className="w-full max-w-md">
      <div className="glass rounded-[1.75rem] p-9 md:p-11">
        {/* Encabezado */}
        <div className="mb-9">
          <p className="eyebrow">Registro</p>
          <h1 className="display text-[2.6rem] mt-3 mb-2">Creá tu cuenta</h1>
          <p className="text-sm text-[var(--text-soft)]">
            Unos pocos datos y ya formás parte de la plataforma.
          </p>
        </div>

        <div className="hairline mb-8" />

        {error && <div className="alert-error mb-6 text-sm">{error}</div>}

        <form onSubmit={handleRegister} className="space-y-6">
          <div>
            <label className="field-label">Nombre completo</label>
            <div className="relative">
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="input-field"
                placeholder="Juan Pérez"
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
                className="input-field"
                placeholder="tu@email.com"
                required
              />
            </div>
          </div>

          <div>
            <label className="field-label">Tipo de usuario</label>
            <div className="grid grid-cols-3 gap-2.5">
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

          <button type="submit" disabled={loading} className="btn-primary mt-2">
            {loading ? 'Creando cuenta…' : 'Registrarme'}
          </button>
        </form>

        <button
          onClick={onSwitchToLogin}
          className="mt-6 w-full flex items-center justify-center gap-2 text-xs tracking-[0.18em] uppercase text-[var(--text-soft)] hover:text-[var(--gold)] transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Volver al inicio de sesión
        </button>
      </div>
    </div>
  )
}
