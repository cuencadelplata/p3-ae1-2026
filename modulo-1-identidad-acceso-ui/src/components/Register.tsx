import { useState } from 'react'
import { Mail, Lock, User, UserCheck, Eye, EyeOff, ArrowLeft } from 'lucide-react'
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
      const response = await axios.post('http://localhost:3001/auth/registrar-usuario', {
        nombre: name,
        email,
        password,
        rol: role,
      })

      const { token } = response.data

      // Decode JWT to get user info
      const parts = token.split('.')
      const decoded = JSON.parse(atob(parts[1]))

      onRegisterSuccess(token, decoded)
    } catch (err: any) {
      setError(err.response?.data?.message || 'Error al registrarse')
    } finally {
      setLoading(false)
    }
  }

  const roles: { value: UserRole; label: string; icon: string }[] = [
    { value: 'CLIENTE', label: 'Cliente', icon: '👤' },
    { value: 'CONDUCTOR', label: 'Conductor', icon: '🚗' },
    { value: 'OPERADOR', label: 'Operador', icon: '⚙️' },
  ]

  return (
    <div className="w-full max-w-md">
      <div className="glass rounded-3xl shadow-2xl p-8 md:p-10">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="flex justify-center mb-4">
            <div className="bg-gradient-to-br from-cyan-500 to-blue-500 p-4 rounded-full">
              <UserCheck className="w-8 h-8 text-white" />
            </div>
          </div>
          <h1 className="text-3xl font-bold text-gray-800 mb-2">Crear Cuenta</h1>
          <p className="text-gray-600">Únete a nuestra plataforma</p>
        </div>

        {/* Error Message */}
        {error && (
          <div className="mb-6 p-4 bg-red-50 border-l-4 border-red-500 rounded">
            <p className="text-red-700 text-sm">{error}</p>
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleRegister} className="space-y-5">
          {/* Name Input */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">Nombre Completo</label>
            <div className="relative">
              <User className={`absolute left-4 top-4 w-5 h-5 transition-opacity ${name ? 'opacity-0' : 'opacity-100 text-gray-400'}`} />
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="input-field pl-12"
                placeholder="Juan Pérez"
                required
              />
            </div>
          </div>

          {/* Email Input */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">Email</label>
            <div className="relative">
              <Mail className={`absolute left-4 top-4 w-5 h-5 transition-opacity ${email ? 'opacity-0' : 'opacity-100 text-gray-400'}`} />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="input-field pl-12"
                placeholder="tu@email.com"
                required
              />
            </div>
          </div>

          {/* Role Selection */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-3">Tipo de Usuario</label>
            <div className="grid grid-cols-3 gap-2">
              {roles.map((r) => (
                <button
                  key={r.value}
                  type="button"
                  onClick={() => setRole(r.value)}
                  className={`p-3 rounded-lg text-center font-semibold transition ${
                    role === r.value
                      ? 'bg-gradient-to-br from-blue-500 to-cyan-500 text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  <div className="text-xl mb-1">{r.icon}</div>
                  <div className="text-xs">{r.label}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Password Input */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">Contraseña</label>
            <div className="relative">
              <Lock className={`absolute left-4 top-4 w-5 h-5 transition-opacity ${password ? 'opacity-0' : 'opacity-100 text-gray-400'}`} />
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="input-field pl-12 pr-12"
                placeholder="••••••••"
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-4 top-4 text-gray-400 hover:text-gray-600"
              >
                {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </div>
            <p className="text-xs text-gray-500 mt-1">Mínimo 6 caracteres</p>
          </div>

          {/* Confirm Password Input */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">Confirmar Contraseña</label>
            <div className="relative">
              <Lock className={`absolute left-4 top-4 w-5 h-5 transition-opacity ${confirmPassword ? 'opacity-0' : 'opacity-100 text-gray-400'}`} />
              <input
                type={showPassword ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="input-field pl-12"
                placeholder="••••••••"
                required
              />
            </div>
          </div>

          {/* Submit Button */}
          <button
            type="submit"
            disabled={loading}
            className="btn-primary w-full mt-6 disabled:opacity-50"
          >
            {loading ? 'Creando cuenta...' : 'Registrarse'}
          </button>
        </form>

        {/* Back to Login */}
        <button
          onClick={onSwitchToLogin}
          className="w-full mt-4 flex items-center justify-center gap-2 text-blue-600 hover:text-blue-700 font-semibold"
        >
          <ArrowLeft className="w-4 h-4" />
          Volver al Login
        </button>

        {/* Footer */}
        <p className="text-center text-gray-500 text-xs mt-6">
          M1 - Identidad y Acceso | Plataforma de Movilidad
        </p>
      </div>
    </div>
  )
}
