import { useState } from 'react'
import axios from 'axios'

interface PasswordRecoveryProps {
  onBackToLogin: () => void
}

type RecoveryStep = 'request' | 'reset'

export default function PasswordRecovery({ onBackToLogin }: PasswordRecoveryProps) {
  const [step, setStep] = useState<RecoveryStep>('request')
  const [email, setEmail] = useState('')
  const [token, setToken] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleRequest = async (event: React.FormEvent) => {
    event.preventDefault()
    setLoading(true)
    setMessage('')
    setError('')

    try {
      const response = await axios.post('http://localhost:3001/auth/solicitar-recuperacion', { email })
      setMessage(response.data.message)
      setStep('reset')
    } catch (err: any) {
      setError(err.response?.data?.error || 'No se pudo solicitar la recuperación')
    } finally {
      setLoading(false)
    }
  }

  const handleReset = async (event: React.FormEvent) => {
    event.preventDefault()
    setLoading(true)
    setMessage('')
    setError('')

    try {
      const response = await axios.post('http://localhost:3001/auth/resetear-contrasena', {
        token,
        newPassword,
      })
      setMessage(response.data.message)
      setToken('')
      setNewPassword('')
    } catch (err: any) {
      setError(err.response?.data?.error || 'No se pudo actualizar la contraseña')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="w-full max-w-md">
      <div className="glass rounded-[1.75rem] p-9 md:p-11">
        <div className="mb-9">
          <p className="eyebrow">Recuperación de acceso</p>
          <h1 className="display text-[2.6rem] mt-3 mb-2">
            {step === 'request' ? 'Recuperá tu cuenta' : 'Nueva contraseña'}
          </h1>
          <p className="text-sm text-[var(--text-soft)]">
            {step === 'request'
              ? 'Te ayudamos a recuperar el acceso de forma segura.'
              : 'Ingresá el token recibido y elegí una nueva contraseña.'}
          </p>
        </div>

        <div className="hairline mb-8" />

        {message && <div className="alert-success mb-6 text-sm">{message}</div>}
        {error && <div className="alert-error mb-6 text-sm">{error}</div>}

        {step === 'request' ? (
          <form onSubmit={handleRequest} className="space-y-6">
            <div>
              <label className="field-label">Email</label>
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="input-field"
                placeholder="tu@email.com"
                required
              />
            </div>
            <button type="submit" disabled={loading} className="btn-primary">
              {loading ? 'Enviando solicitud…' : 'Enviar enlace de recuperación'}
            </button>
          </form>
        ) : (
          <form onSubmit={handleReset} className="space-y-6">
            <div>
              <label className="field-label">Token de recuperación</label>
              <input
                type="text"
                value={token}
                onChange={(event) => setToken(event.target.value)}
                className="input-field"
                placeholder="Pegá aquí el token recibido"
                required
              />
            </div>
            <div>
              <label className="field-label">Nueva contraseña</label>
              <input
                type="password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                className="input-field"
                placeholder="Mínimo 6 caracteres"
                minLength={6}
                required
              />
            </div>
            <button type="submit" disabled={loading} className="btn-primary">
              {loading ? 'Actualizando…' : 'Cambiar contraseña'}
            </button>
          </form>
        )}

        <button
          type="button"
          onClick={onBackToLogin}
          className="mt-6 w-full text-xs tracking-[0.18em] uppercase text-[var(--text-soft)] hover:text-[var(--gold)] transition-colors"
        >
          Volver al inicio de sesión
        </button>
      </div>
    </div>
  )
}
