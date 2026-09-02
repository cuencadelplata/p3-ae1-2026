import { LogOut, User, Mail, Shield, CheckCircle } from 'lucide-react'

interface DashboardProps {
  user: any
  onLogout: () => void
}

export default function Dashboard({ user, onLogout }: DashboardProps) {
  const getRoleColor = (role: string) => {
    const colors: { [key: string]: string } = {
      CLIENTE: 'from-blue-500 to-cyan-500',
      CONDUCTOR: 'from-green-500 to-emerald-500',
      OPERADOR: 'from-purple-500 to-pink-500',
    }
    return colors[role] || 'from-gray-500 to-gray-600'
  }

  const getRoleIcon = (role: string) => {
    const icons: { [key: string]: string } = {
      CLIENTE: '👤',
      CONDUCTOR: '🚗',
      OPERADOR: '⚙️',
    }
    return icons[role] || '👤'
  }

  return (
    <div className="w-full max-w-2xl">
      <div className="glass rounded-3xl shadow-2xl p-10">
        {/* Header with Logout */}
        <div className="flex justify-between items-start mb-8">
          <div>
            <h1 className="text-4xl font-bold text-gray-800 mb-2">Panel de Control</h1>
            <p className="text-gray-600">Información de tu cuenta autenticada</p>
          </div>
          <button
            onClick={onLogout}
            className="flex items-center gap-2 px-4 py-2 bg-red-50 text-red-600 rounded-lg hover:bg-red-100 font-semibold transition"
          >
            <LogOut className="w-5 h-5" />
            Cerrar Sesión
          </button>
        </div>

        {/* User Card */}
        <div className={`bg-gradient-to-br ${getRoleColor(user.rol)} rounded-2xl p-8 text-white mb-8 shadow-lg`}>
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-3xl font-bold mb-2">{user.sub}</h2>
              <p className="text-white text-opacity-80">ID: {user.jti}</p>
            </div>
            <div className="text-6xl">{getRoleIcon(user.rol)}</div>
          </div>
          <div className="flex items-center gap-2 mt-4">
            <CheckCircle className="w-5 h-5" />
            <span className="text-lg font-semibold">Sesión activa</span>
          </div>
        </div>

        {/* User Details */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
          {/* Email */}
          <div className="bg-gray-50 rounded-xl p-6">
            <div className="flex items-center gap-3 mb-3">
              <Mail className="w-5 h-5 text-blue-500" />
              <label className="font-semibold text-gray-700">Email (sub)</label>
            </div>
            <p className="text-gray-900 font-mono text-sm break-all">{user.sub}</p>
          </div>

          {/* Role */}
          <div className="bg-gray-50 rounded-xl p-6">
            <div className="flex items-center gap-3 mb-3">
              <Shield className="w-5 h-5 text-purple-500" />
              <label className="font-semibold text-gray-700">Rol</label>
            </div>
            <p className="text-gray-900 font-semibold text-lg">{user.rol}</p>
          </div>

          {/* JWT ID */}
          <div className="bg-gray-50 rounded-xl p-6">
            <div className="flex items-center gap-3 mb-3">
              <User className="w-5 h-5 text-cyan-500" />
              <label className="font-semibold text-gray-700">JWT ID</label>
            </div>
            <p className="text-gray-900 font-mono text-xs break-all">{user.jti}</p>
          </div>

          {/* Issued At */}
          <div className="bg-gray-50 rounded-xl p-6">
            <div className="flex items-center gap-3 mb-3">
              <User className="w-5 h-5 text-green-500" />
              <label className="font-semibold text-gray-700">Emitido el</label>
            </div>
            <p className="text-gray-900 font-mono text-sm">
              {new Date(user.iat * 1000).toLocaleString('es-AR')}
            </p>
          </div>
        </div>

        {/* Token Info */}
        <div className="bg-blue-50 border-2 border-blue-200 rounded-xl p-6 mb-8">
          <h3 className="font-semibold text-blue-900 mb-3">Información de Sesión</h3>
          <ul className="space-y-2 text-sm text-blue-800">
            <li>✓ Token JWT válido y activo</li>
            <li>✓ Permiso de acceso confirmado</li>
            <li>✓ Identidad y rol verificados</li>
            <li>✓ Datos cifrados en tránsito</li>
          </ul>
        </div>

        {/* Action Buttons */}
        <div className="grid grid-cols-2 gap-4">
          <button className="px-6 py-3 bg-blue-100 text-blue-700 rounded-lg font-semibold hover:bg-blue-200 transition">
            Editar Perfil
          </button>
          <button className="px-6 py-3 bg-gray-100 text-gray-700 rounded-lg font-semibold hover:bg-gray-200 transition">
            Ver Documentación
          </button>
        </div>

        {/* Footer */}
        <div className="mt-8 pt-8 border-t border-gray-200 text-center">
          <p className="text-gray-500 text-sm">
            M1 - Identidad y Acceso | Plataforma de Movilidad Urbana
          </p>
          <p className="text-gray-400 text-xs mt-2">
            API: localhost:3001 | Documentación: localhost:3001/docs
          </p>
        </div>
      </div>
    </div>
  )
}
