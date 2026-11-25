import { useCallback, useEffect, useState } from 'react'
import './App.css'
import Login from './components/Login'
import Register from './components/Register.tsx'
import Dashboard from './components/Dashboard.tsx'
import PasswordRecovery from './components/PasswordRecovery'
import { completarOAuth2, proveedorPendiente, redirectUriOAuth2 } from './components/OAuth2Login'
import { FlowError, request } from './rideFlowApi'

type AuthState = 'login' | 'register' | 'recovery' | 'dashboard'
// RF-2.1: un CLIENTE necesita perfil en M2 antes de entrar al panel.
type PerfilM2 = { estado: 'verificando' } | { estado: 'listo' } | { estado: 'error'; mensaje: string }

// Front de M2 donde el cliente completa su perfil ("Completá tu perfil").
const M2_PERFIL_URL = import.meta.env.VITE_M2_PERFIL_URL || 'http://localhost:11001'

function tokenPayload(token: string): Record<string, unknown> | undefined {
  const payload = token.split('.')[1]
  if (!payload) return

  try {
    return JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')))
  } catch {
    // M1 sigue validando el token en el servidor.
  }
}

function getSessionExpiry(token: string): number | undefined {
  const exp = tokenPayload(token)?.exp
  if (typeof exp === 'number' && Number.isFinite(exp)) return exp * 1000
}

function esCliente(token: string) {
  return tokenPayload(token)?.role === 'CLIENTE'
}

function irACompletarPerfil(token: string) {
  const destino = new URL('/', M2_PERFIL_URL)
  destino.searchParams.set('token', token)
  destino.searchParams.set('volver', window.location.origin + '/')
  window.location.assign(destino.toString())
}

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

  // RF-1.5: al volver de Google o Auth0, la URL trae ?code=...&state=...
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const code = params.get('code')
    const state = params.get('state')
    if (!code || !state) return
    window.history.replaceState({}, '', window.location.pathname)
    const provider = proveedorPendiente()
    if (!provider) {
      setAviso('No se pudo completar el ingreso externo: volvé a intentarlo.')
      return
    }
    completarOAuth2(provider, code, state, redirectUriOAuth2())
      .then(handleLoginSuccess)
      .catch((err) => setAviso(`No se pudo ingresar con ${provider}: ${err.response?.data?.error ?? 'error de M1'}`))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleLogout = useCallback((mensaje?: string) => {
    setAviso(mensaje ?? '')
    setToken(null)
    localStorage.removeItem('token')
    localStorage.removeItem('user')
    setAuthState('login')
  }, [])

  useEffect(() => {
    if (!token) return
    const expiresAt = getSessionExpiry(token)
    if (expiresAt === undefined) return

    const checkExpiry = () => {
      if (Date.now() >= expiresAt) {
        handleLogout('Tu sesión venció. Iniciá sesión de nuevo para retomar tu viaje.')
      }
    }

    const timeout = window.setTimeout(checkExpiry, Math.max(0, expiresAt - Date.now()))
    window.addEventListener('focus', checkExpiry)
    document.addEventListener('visibilitychange', checkExpiry)
    return () => {
      window.clearTimeout(timeout)
      window.removeEventListener('focus', checkExpiry)
      document.removeEventListener('visibilitychange', checkExpiry)
    }
  }, [token, handleLogout])

  // Después del login (o al volver con una sesión guardada): si es CLIENTE y no tiene perfil en M2,
  // va a completarlo al front de M2, que lo devuelve acá. Conductor y operador siguen directo al panel.
  const [perfilM2, setPerfilM2] = useState<PerfilM2>({ estado: 'verificando' })
  const [intentoPerfil, setIntentoPerfil] = useState(0)

  useEffect(() => {
    if (authState !== 'dashboard' || !token) return
    if (!esCliente(token)) {
      setPerfilM2({ estado: 'listo' })
      return
    }

    const abort = new AbortController()
    setPerfilM2({ estado: 'verificando' })
    request('M2', '/v1/customers/me', { token, signal: abort.signal })
      .then(() => { if (!abort.signal.aborted) setPerfilM2({ estado: 'listo' }) })
      .catch((error: unknown) => {
        if (abort.signal.aborted) return
        if (error instanceof FlowError && error.status === 404) return irACompletarPerfil(token)
        if (error instanceof FlowError && error.status === 401) return handleLogout('Tu sesión ya no es válida. Iniciá sesión de nuevo.')
        // Sin respuesta de M2 no se puede validar la cuenta: no se deja entrar.
        setPerfilM2({ estado: 'error', mensaje: 'No pudimos validar tu perfil de cliente. Intentá de nuevo en unos minutos.' })
      })
    return () => abort.abort()
  }, [authState, token, intentoPerfil, handleLogout])

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
      {authState === 'dashboard' && token && perfilM2.estado === 'listo' && (
        <Dashboard token={token} onLogout={handleLogout} />
      )}
      {authState === 'dashboard' && token && perfilM2.estado === 'verificando' && (
        <p className="text-sm text-[var(--text-soft)]" role="status">Verificando tu perfil…</p>
      )}
      {authState === 'dashboard' && token && perfilM2.estado === 'error' && (
        <div className="glass w-full max-w-md rounded-[1.75rem] p-9 text-center" role="alert">
          <p className="eyebrow">Perfil de cliente</p>
          <p className="mt-4 text-[var(--text-soft)]">{perfilM2.mensaje}</p>
          <div className="mt-5 flex justify-center gap-3">
            <button className="btn-primary" onClick={() => setIntentoPerfil((n) => n + 1)}>Reintentar</button>
            <button className="btn-secondary" onClick={() => handleLogout()}>Cerrar sesión</button>
          </div>
        </div>
      )}

    </div>
  )
}

export default App
