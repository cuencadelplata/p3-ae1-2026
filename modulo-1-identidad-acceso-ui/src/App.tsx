import { useState } from 'react'
import './App.css'
import Login from './components/Login'
import Register from './components/Register.tsx'
import Dashboard from './components/Dashboard.tsx'
import PasswordRecovery from './components/PasswordRecovery'

type AuthState = 'login' | 'register' | 'recovery' | 'dashboard'

function App() {
  const storedToken = localStorage.getItem('token')
  const storedUser = localStorage.getItem('user')
  const [authState, setAuthState] = useState<AuthState>(
    storedToken && storedUser ? 'dashboard' : 'login'
  )
  const [token, setToken] = useState<string | null>(storedToken)
  const [user, setUser] = useState<any>(() => {
    try {
      return storedUser ? JSON.parse(storedUser) : null
    } catch {
      return null
    }
  })

  const handleLoginSuccess = (authToken: string, userData: any) => {
    setToken(authToken)
    setUser(userData)
    localStorage.setItem('token', authToken)
    localStorage.setItem('user', JSON.stringify(userData))
    setAuthState('dashboard')
  }

  const handleLogout = () => {
    setToken(null)
    setUser(null)
    localStorage.removeItem('token')
    localStorage.removeItem('user')
    setAuthState('login')
  }

  return (
    <div className="relative min-h-screen flex flex-col items-center justify-start sm:justify-center p-4 py-8 sm:py-12 overflow-y-auto">
      {authState === 'login' && (
        <Login
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
      {authState === 'dashboard' && token && user && (
        <Dashboard user={user} onLogout={handleLogout} />
      )}

    </div>
  )
}

export default App
