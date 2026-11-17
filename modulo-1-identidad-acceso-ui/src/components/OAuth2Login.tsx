import { useEffect, useState } from 'react'
import axios from 'axios'
import { LogIn } from 'lucide-react'
import { API_URL } from '../api'

// RF-1.5 (Maxi): ingreso con un proveedor externo por OAuth2 / OpenID Connect.
// Respuesta de GET /auth/oauth2/providers.
interface Proveedor {
  provider: string
  configured: boolean
  isDefault: boolean
  description: string
}

const NOMBRES: Record<string, string> = {
  GOOGLE: 'Google',
  AUTH0: 'Auth0',
  MOCK: 'Proveedor de prueba',
}

// Parámetro con el que el proveedor real (Google o Auth0) vuelve a la interfaz.
export const PARAMETRO_OAUTH = 'oauth'

export function redirectUriPara(provider: string): string {
  return `${window.location.origin}/?${PARAMETRO_OAUTH}=${provider}`
}

// Paso final: M1 cambia el code por un token del proveedor y emite su propio JWT.
export async function completarOAuth2(
  provider: string,
  code: string,
  state: string,
  redirectUri?: string
): Promise<string> {
  const { data } = await axios.post(`${API_URL}/auth/oauth2/callback`, {
    provider,
    code,
    state,
    redirect_uri: redirectUri,
  })
  return data.token as string
}

interface OAuth2LoginProps {
  onLoginSuccess: (token: string) => void
}

export default function OAuth2Login({ onLoginSuccess }: OAuth2LoginProps) {
  const [proveedores, setProveedores] = useState<Proveedor[]>([])
  const [ingresando, setIngresando] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    axios
      .get<{ providers: Proveedor[] }>(`${API_URL}/auth/oauth2/providers`)
      .then(({ data }) => setProveedores(data.providers))
      .catch(() => setProveedores([]))
  }, [])

  const ingresar = async (provider: string) => {
    setError('')
    setIngresando(provider)
    try {
      if (provider === 'MOCK') {
        // El proveedor de prueba no tiene pantalla propia: se pide el state a M1
        // y se completa el callback con un code de prueba, igual que en los tests E2E.
        const { data } = await axios.get(`${API_URL}/auth/oauth2/authorize`, { params: { provider } })
        const token = await completarOAuth2(provider, `mock_code_${Date.now()}`, data.state)
        onLoginSuccess(token)
        return
      }
      // Google y Auth0: M1 redirige al proveedor, que después vuelve a esta página con code y state.
      const params = new URLSearchParams({
        provider,
        redirect: 'true',
        redirect_uri: redirectUriPara(provider),
      })
      window.location.href = `${API_URL}/auth/oauth2/authorize?${params.toString()}`
    } catch (err: any) {
      setError(err.response?.data?.error || 'No se pudo ingresar con el proveedor')
      setIngresando('')
    }
  }

  if (proveedores.length === 0) return null

  return (
    <div>
      <p className="field-label text-center">O ingresá con</p>
      {error && <div className="alert-error mb-4 text-sm">{error}</div>}
      <div className="space-y-3">
        {proveedores.map((p) => (
          <button
            key={p.provider}
            type="button"
            onClick={() => ingresar(p.provider)}
            disabled={!p.configured || ingresando !== ''}
            className="btn-secondary flex items-center justify-center gap-2"
            title={p.configured ? p.description : 'No configurado en este entorno'}
          >
            <LogIn className="w-4 h-4" />
            {ingresando === p.provider
              ? 'Conectando…'
              : `${NOMBRES[p.provider] ?? p.provider}${p.configured ? '' : ' (no configurado)'}`}
          </button>
        ))}
      </div>
      <p className="mt-3 text-center font-mono text-[10px] text-[var(--text-dim)]">RF-1.5 · OAuth2 / OpenID Connect</p>
    </div>
  )
}
