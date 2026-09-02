import { useState } from 'react'
import './App.css'
import Login from './components/Login'
import Register from './components/Register'
import Dashboard from './components/Dashboard'

type AuthState = 'login' | 'register' | 'dashboard'

function App() {
  const [authState, setAuthState] = useState<AuthState>('login')
  const [token, setToken] = useState<string | null>(localStorage.getItem('token'))
  const [user, setUser] = useState<any>(null)

  if (token && authState === 'login') {
    setAuthState('dashboard')
  }

  const handleLoginSuccess = (authToken: string, userData: any) => {
    setToken(authToken)
    setUser(userData)
    localStorage.setItem('token', authToken)
    setAuthState('dashboard')
  }

  const handleLogout = () => {
    setToken(null)
    setUser(null)
    localStorage.removeItem('token')
    setAuthState('login')
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-600 via-purple-500 to-indigo-600 flex items-center justify-center p-4">
      {authState === 'login' && (
        <Login onLoginSuccess={handleLoginSuccess} onSwitchToRegister={() => setAuthState('register')} />
      )}
      {authState === 'register' && (
        <Register onRegisterSuccess={handleLoginSuccess} onSwitchToLogin={() => setAuthState('login')} />
      )}
      {authState === 'dashboard' && token && user && (
        <Dashboard user={user} onLogout={handleLogout} />
      )}
    </div>
  )
}

export default App
