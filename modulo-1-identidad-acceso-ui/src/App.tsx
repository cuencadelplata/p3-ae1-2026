import { useState } from 'react'
import './App.css'
import Login from './components/Login'
import Register from './components/Register.tsx'
import Dashboard from './components/Dashboard.tsx'
import PasswordRecovery from './components/PasswordRecovery'

type AuthState = 'login' | 'register' | 'recovery' | 'dashboard'

function App() {
  const storedToken = localStorage.getItem('token')
  const [authState, setAuthState] = useState<AuthState>(storedToken ? 'dashboard' : 'login')
  const [token, setToken] = useState<string | null>(storedToken)
  // Mensaje que se muestra en el login (por ejemplo, después de revocar credenciales).
  const [aviso, setAviso] = useState('')
  // Solo se guarda el token: los datos del usuario se piden a M1 (GET /auth/me) en el panel.
  const handleLoginSuccess = (authToken: string) => {
    setToken(authToken)
    localStorage.setItem('token', authToken)
    setAviso('')
    setAuthState('dashboard')
  }

  const handleLogout = (mensaje?: string) => {
    setAviso(mensaje ?? '')
    setToken(null)
    localStorage.removeItem('token')
    localStorage.removeItem('user')
    setAuthState('login')
  }

  return (
    <div className="relative min-h-screen flex flex-col items-center justify-start sm:justify-center p-4 py-8 sm:py-12 overflow-y-auto">
      {authState === 'login' && (
        <Login
          aviso={aviso}
          onLoginSuccess={handleLoginSuccess}
          onSwitchToRegister={() => setAuthState('register')}
          onSwitchToRecovery={() => setAuthState('recovery')}
        />
      )}
      {authState === 'register' && (
        <Register onRegisterSuccess={handleLoginSuccess} onSwitchToLogin={() => setAuthState('login')} />
      )}
      {authState === 'recovery' && (
        <PasswordRecovery onBackToLogin={() => setAuthState('login')} />
      )}
      {authState === 'dashboard' && token && (
        <Dashboard token={token} onLogout={handleLogout} />
      )}

    </div>
  )
}

export default App
