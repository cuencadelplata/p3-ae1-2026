import { useEffect, useState } from 'react'
import './App.css'
import Login from './components/Login'
import Register from './components/Register.tsx'
import Dashboard from './components/Dashboard.tsx'
import PasswordRecovery from './components/PasswordRecovery'
import { PARAMETRO_OAUTH, completarOAuth2, redirectUriPara } from './components/OAuth2Login'

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

  // RF-1.5: al volver de Google o Auth0, la URL trae ?oauth=PROVEEDOR&code=...&state=...
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const provider = params.get(PARAMETRO_OAUTH)
    const code = params.get('code')
    const state = params.get('state')
    if (!provider || !code || !state) return
    window.history.replaceState({}, '', window.location.pathname)
    completarOAuth2(provider, code, state, redirectUriPara(provider))
      .then(handleLoginSuccess)
      .catch((err) => setAviso(`No se pudo ingresar con ${provider}: ${err.response?.data?.error ?? 'error de M1'}`))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
