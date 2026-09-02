import { useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import axios from 'axios'

interface LoginProps {
  onLoginSuccess: (token: string, user: any) => void
  onSwitchToRegister: () => void
}

export default function Login({ onLoginSuccess, onSwitchToRegister }: LoginProps) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    try {
      const response = await axios.post('http://localhost:3001/auth/iniciar-sesion', {
        email,
        password,
      })

      const { token } = response.data
      const parts = token.split('.')
      const decoded = JSON.parse(atob(parts[1]))

      onLoginSuccess(token, decoded)
    } catch (err: any) {
      setError(err.response?.data?.message || 'Error al iniciar sesión')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="w-full max-w-md">
      <div className="glass rounded-[1.75rem] p-9 md:p-11">
        {/* Encabezado */}
        <div className="mb-9">
          <p className="eyebrow">Acceso</p>
          <h1 className="display text-[2.6rem] mt-3 mb-2">Bienvenido</h1>
          <p className="text-sm text-[var(--text-soft)]">
            Ingresá tus credenciales para continuar.
          </p>
        </div>

        <div className="hairline mb-8" />

        {error && <div className="alert-error mb-6 text-sm">{error}</div>}

        <form onSubmit={handleLogin} className="space-y-6">
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
          </div>

          <button type="submit" disabled={loading} className="btn-primary mt-2">
            {loading ? 'Iniciando sesión…' : 'Iniciar sesión'}
          </button>
        </form>

        <div className="relative my-9">
          <div className="hairline" />
          <span className="absolute left-1/2 -translate-x-1/2 -top-2.5 px-3 text-[10px] tracking-[0.3em] uppercase text-[var(--text-dim)] bg-[#111722]">
            o
          </span>
        </div>

        <button onClick={onSwitchToRegister} className="btn-secondary">
          Crear una cuenta
        </button>
      </div>
    </div>
  )
}
